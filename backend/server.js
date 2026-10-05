// ============================================================
// SAFARNAAMA HOLIDAYS CRM — BACKEND API SERVER
// Stack: Node.js + Express + Supabase + SendGrid
//
// Setup:
// npm init -y
// npm install express @supabase/supabase-js @sendgrid/mail
// dotenv cors multer pdf-parse mammoth
// node-mailparser axios
//
// Run: node server.js
// Deploy: Railway / Render / Fly.io / VPS
// ============================================================
require("dotenv").config();

// Prevent Node.js 15+ from crashing on unhandled rejections (IMAP timeouts, etc.)
process.on("uncaughtException", (err) => {
 console.error("[FATAL] Uncaught exception — server kept running:", err.message);
});
process.on("unhandledRejection", (reason) => {
 console.error("[FATAL] Unhandled rejection — server kept running:", reason?.message || String(reason));
});

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sgMail = require("@sendgrid/mail");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { createWorker } = require("tesseract.js");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key
const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const ENQUIRY_EMAIL = process.env.ENQUIRY_EMAIL || "enquiry@SafarnaamaHolidays.com";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@safarnaama.com";
const INBOUND_SECRET = process.env.INBOUND_WEBHOOK_SECRET || "safarnaama-secret-2026";
// Guard: only init SendGrid if a real key is supplied
if (SENDGRID_KEY && SENDGRID_KEY.startsWith("SG.")) sgMail.setApiKey(SENDGRID_KEY);
else console.warn("⚠  SendGrid not configured — email sending disabled");
// Guard: only init Supabase if a real URL is supplied
const supabase = (SUPABASE_URL && /^https?:\/\//i.test(SUPABASE_URL))
 ? createClient(SUPABASE_URL, SUPABASE_KEY)
 : null;
if (!supabase) console.warn("⚠  Supabase not configured — database features disabled");

// Chainable no-op mock for when Supabase is not configured.
// Supports any chain depth: .select().eq().order().single() etc.
function dbMock() {
 const m = {
  select: () => m, insert: () => m, upsert: () => m,
  update: () => m, delete: () => m,
  eq: () => m, neq: () => m, in: () => m, order: () => m,
  limit: () => m, ilike: () => m, filter: () => m,
  single: () => Promise.resolve({ data: null, error: null }),
  // makes `await db.from(...).select(...)` work without .single()
  then: (resolve) => resolve({ data: [], error: null }),
 };
 return m;
}

const db = {
 from: tbl => supabase ? supabase.from(tbl) : dbMock(),
};
// Wraps multer middleware so file-upload errors return JSON instead of HTML
const withUpload = (multerMiddleware) => (req, res, next) => {
 multerMiddleware(req, res, (err) => {
  if (err) return res.status(400).json({ error: `File upload error: ${err.message}` });
  next();
 });
};
// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// ─── SERVE REACT BUILD (production only) ─────────────────────────────────────
// In production the backend serves the compiled React app from /frontend/build.
// API routes are registered AFTER this, so /api/... requests fall through correctly.
if (process.env.NODE_ENV === "production") {
 const BUILD = path.join(__dirname, "../frontend/build");
 app.use(express.static(BUILD, { index: "index.html" }));
}
// ─── AUTH ─────────────────────────────────────────────────────────────────────
const crypto = require("crypto");
const AUTH_SECRET = process.env.CRM_AUTH_SECRET || "safarnaama-dev-secret-change-in-prod";
const TOKEN_TTL   = 24 * 60 * 60 * 1000; // 24 hours

function hashPassword(password, salt) {
 return crypto.createHmac("sha256", salt).update(password).digest("hex");
}
function generateSalt() { return crypto.randomBytes(16).toString("hex"); }
function generateToken(userId) {
 const expiry  = Date.now() + TOKEN_TTL;
 const payload = `${userId}:${expiry}`;
 const sig     = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("hex");
 return Buffer.from(`${payload}:${sig}`).toString("base64url");
}
function verifyToken(token) {
 try {
  const decoded = Buffer.from(token, "base64url").toString();
  const lastColon = decoded.lastIndexOf(":");
  const payload = decoded.slice(0, lastColon);
  const sig     = decoded.slice(lastColon + 1);
  const colonIdx = payload.indexOf(":");
  const expiry   = Number(payload.slice(colonIdx + 1));
  if (Date.now() > expiry) return null;
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("hex");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  return payload.slice(0, colonIdx); // userId
 } catch { return null; }
}

// Auth middleware — applied to all /api/* except whitelisted paths
const AUTH_SKIP = new Set(["/api/auth/login", "/api/auth/forgot-password", "/api/auth/health", "/api/health", "/api/debug/email"]);
app.use((req, res, next) => {
 if (!req.path.startsWith("/api/")) return next();
 if (AUTH_SKIP.has(req.path)) return next();
 if (req.path.startsWith("/webhook/")) return next();
 const raw = req.headers.authorization || "";
 if (!raw.startsWith("Bearer ")) return res.status(401).json({ error: "Login required" });
 const userId = verifyToken(raw.slice(7));
 if (!userId) return res.status(401).json({ error: "Session expired — please log in again" });
 req.userId = userId;
 next();
});

// Generate a readable temporary password: Sfn-XXXXXXXX
function generateTempPassword() {
 return "Sfn-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

// Send an email via SendGrid or SMTP
async function sendCrmEmail(toEmail, subject, html) {
 if (SENDGRID_KEY?.startsWith("SG.")) {
  await sgMail.send({ from: { email: ENQUIRY_EMAIL, name: "Safarnaama CRM" }, to: toEmail, subject, html });
 } else {
  const cfg = await getEmailCfg().catch(() => null);
  if (!cfg?.smtp_host) throw new Error("Email not configured — add SendGrid or SMTP in Settings → Email");
  const transport = nodemailer.createTransport({ host: cfg.smtp_host, port: Number(cfg.smtp_port)||465, secure: cfg.smtp_ssl!==false, auth: { user: cfg.username, pass: cfg.password }, tls: { rejectUnauthorized: false } });
  await transport.sendMail({ from: `"Safarnaama CRM" <${cfg.username}>`, to: toEmail, subject, html });
 }
}

// Auto-seed the admin user with default credentials on first start
const DEFAULT_ADMIN_EMAIL = "operations@safarnaamaholidays.com";
const DEFAULT_ADMIN_PASS  = "OP@123456";
async function autoSeedAdmin() {
 if (!supabase) return;
 try {
  // Upsert the admin user row (creates if missing, updates email/role if ID exists)
  await db.from("crm_users").upsert(
   { id: "U001", name: "Admin", email: DEFAULT_ADMIN_EMAIL, role: "Admin", status: "Active" },
   { onConflict: "id", ignoreDuplicates: false }
  );
  // If admin has no password yet, set the default
  const { data: user } = await db.from("crm_users").select("password_hash").ilike("email", DEFAULT_ADMIN_EMAIL).single();
  if (!user?.password_hash) {
   const salt = generateSalt();
   const hash = hashPassword(DEFAULT_ADMIN_PASS, salt);
   await db.from("crm_users").update({ password_hash: hash, password_salt: salt }).ilike("email", DEFAULT_ADMIN_EMAIL);
   console.log("✅ Admin account seeded:", DEFAULT_ADMIN_EMAIL);
  }
 } catch(e) {
  console.warn("⚠  autoSeedAdmin failed:", e.message);
 }
}

// POST /api/auth/login — verify password, return token
app.post("/api/auth/login", async (req, res) => {
 try {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  const { data: user, error } = await db.from("crm_users")
   .select("*").ilike("email", email.trim()).eq("status", "Active").limit(1).single();
  if (error || !user) return res.status(401).json({ error: "Invalid email or password" });
  if (!user.password_hash) return res.status(401).json({ error: "No password set — contact your admin" });

  // Check temp password first (if set)
  let usedTemp = false;
  if (user.temp_password_hash && user.temp_password_salt) {
   const tempHash = hashPassword(password, user.temp_password_salt);
   if (tempHash === user.temp_password_hash) usedTemp = true;
  }
  // Check permanent password
  if (!usedTemp) {
   const hash = hashPassword(password, user.password_salt || "");
   if (hash !== user.password_hash) return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = generateToken(user.id);
  const { password_hash, password_salt, temp_password_hash, temp_password_salt, ...safeUser } = user;
  res.json({ token, user: safeUser, mustChangePassword: usedTemp });
 } catch(e) {
  console.error("[auth/login]", e.message);
  res.status(500).json({ error: e.message });
 }
});

// GET /api/auth/me — validate token + return user
app.get("/api/auth/me", (req, res, next) => {
 const raw = req.headers.authorization || "";
 if (!raw.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
 const userId = verifyToken(raw.slice(7));
 if (!userId) return res.status(401).json({ error: "Session expired" });
 req.userId = userId;
 next();
}, async (req, res) => {
 const { data: user } = await db.from("crm_users").select("*").eq("id", req.userId).single();
 if (!user) return res.status(401).json({ error: "User not found" });
 const { password_hash, password_salt, temp_password_hash, temp_password_salt, ...safeUser } = user;
 res.json(safeUser);
});

// POST /api/auth/forgot-password — generate temp password and email it
app.post("/api/auth/forgot-password", async (req, res) => {
 try {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  const { data: user } = await db.from("crm_users").select("*").ilike("email", email.trim()).eq("status", "Active").limit(1).single();
  // Always return success to prevent email enumeration
  if (!user) return res.json({ ok: true, message: "If that email exists, a temporary password has been sent." });
  const tempPass = generateTempPassword();
  const salt = generateSalt();
  const hash = hashPassword(tempPass, salt);
  await db.from("crm_users").update({ temp_password_hash: hash, temp_password_salt: salt }).eq("id", user.id);
  const html = `
   <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
    <div style="background:#0D2030;padding:24px;border-radius:12px 12px 0 0;text-align:center">
     <h2 style="color:#fff;margin:0;font-size:18px">✈️ Safarnaama CRM</h2>
    </div>
    <div style="background:#f8fafc;padding:28px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
     <p style="color:#374151;font-size:15px">Hi <strong>${user.name}</strong>,</p>
     <p style="color:#374151;font-size:14px">Your temporary password is:</p>
     <div style="background:#fff;border:2px dashed #0D2030;border-radius:10px;padding:20px;text-align:center;margin:20px 0">
      <span style="font-size:28px;font-weight:800;letter-spacing:4px;color:#0D2030;font-family:monospace">${tempPass}</span>
     </div>
     <p style="color:#64748b;font-size:13px">Log in with this password, then you will be asked to set a new permanent password.</p>
     <p style="color:#64748b;font-size:12px">If you did not request this, please ignore this email.</p>
    </div>
   </div>`;
  await sendCrmEmail(user.email, "Safarnaama CRM — Temporary Password", html);
  res.json({ ok: true, message: "Temporary password sent to your email." });
 } catch(e) {
  console.error("[auth/forgot-password]", e.message);
  res.status(500).json({ error: "Failed to send email: " + e.message });
 }
});

// POST /api/auth/change-password — set new permanent password (clears temp)
app.post("/api/auth/change-password", async (req, res) => {
 try {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  const salt = generateSalt();
  const newHash = hashPassword(newPassword, salt);
  await db.from("crm_users").update({
   password_hash: newHash, password_salt: salt,
   temp_password_hash: null, temp_password_salt: null
  }).eq("id", req.userId);
  res.json({ ok: true });
 } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/auth/set-user-password — admin sets another user's default password
app.post("/api/auth/set-user-password", async (req, res) => {
 try {
  const { userId, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  const { data: admin } = await db.from("crm_users").select("role").eq("id", req.userId).single();
  if ((admin?.role || "").toLowerCase() !== "admin") return res.status(403).json({ error: "Admin access required" });
  const salt = generateSalt();
  const hash = hashPassword(newPassword, salt);
  await db.from("crm_users").update({ password_hash: hash, password_salt: salt, temp_password_hash: null, temp_password_salt: null }).eq("id", userId);
  res.json({ ok: true });
 } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const genId = (prefix) => `${prefix}${Date.now().toString().slice(-6)}`;
const genQueryCode = () =>
 `QC-${new Date().getFullYear().toString().slice(-2)}${String(new Date().getMonth()+1).padStart(2,"0")}-${Math.floor(Math.random()*9000+1000)}`;
// Call Claude AI
async function callClaude(prompt, system = "", maxTokens = 1500) {
 if (!CLAUDE_KEY) throw new Error("ANTHROPIC_API_KEY is not set in .env");
 try {
  const res = await axios.post(
   "https://api.anthropic.com/v1/messages",
   {
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: system || "You are a professional travel CRM assistant for Safarnaama Holidays.",
    messages: [{ role: "user", content: prompt }],
   },
   {
    headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
    timeout: 180000,
   }
  );
  const text = res.data.content?.map(b => b.text || "").join("") || "";
  return text;
 } catch (err) {
  const status = err.response?.status;
  const detail = err.response?.data?.error?.message || err.message;
  const friendly =
   status === 401 ? `Claude API key invalid or expired (401). Check ANTHROPIC_API_KEY in .env.` :
   status === 429 ? `Claude API rate limit hit (429). Please wait a moment and retry.` :
   status === 400 ? `Claude API bad request (400): ${detail}` :
   `Claude API error (${status || "network"}): ${detail}`;
  console.error("[callClaude]", friendly);
  throw new Error(friendly);
 }
}
// tesseract.js v4 API: createWorker() is async and returns a ready worker directly
let ocrWorker = null;
async function ensureOcr() {
 if (ocrWorker) return;
 ocrWorker = await createWorker("eng");
}
async function extractTextFromFile(file) {
 if (!file) return "";
 const filename = (file.originalname || "").toLowerCase();
 const mime = file.mimetype || "";
 if (filename.endsWith(".pdf") || mime === "application/pdf") {
  const pdf = await pdfParse(file.buffer);
  return pdf.text || "";
 }
 if (filename.endsWith(".docx") || filename.endsWith(".doc") || mime.includes("word")) {
  const result = await mammoth.extractRawText({ buffer: file.buffer });
  return result.value || "";
 }
 if (filename.endsWith(".xls") || filename.endsWith(".xlsx") || mime.includes("spreadsheet") || mime.includes("excel")) {
  const workbook = XLSX.read(file.buffer, { type: "buffer" });
  let text = "";
  workbook.SheetNames.forEach(sheet => {
   const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { defval: "" });
   text += JSON.stringify(rows, null, 2) + "\n";
  });
  return text;
 }
 if (filename.match(/\.(png|jpe?g|jpg|bmp|gif|tiff|webp)$/i) || mime.startsWith("image/")) {
  await ensureOcr();
  const { data: { text } } = await ocrWorker.recognize(file.buffer);
  return text || "";
 }
 if (filename.endsWith(".csv") || mime === "text/csv") {
  return file.buffer.toString("utf8");
 }
 return file.buffer.toString("utf8");
}
function parseCSV(text) {
 const norm = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
 const firstLine = norm.split("\n")[0] || "";
 const delim = firstLine.includes("\t") ? "\t" : ",";
 const rows = [];
 let inQuote = false, field = "", fields = [];
 for (let i = 0; i < norm.length; i++) {
  const c = norm[i];
  if (c === '"') {
   if (inQuote && norm[i + 1] === '"') { field += '"'; i++; }
   else inQuote = !inQuote;
  } else if (c === delim && !inQuote) {
   fields.push(field.trim()); field = "";
  } else if (c === "\n" && !inQuote) {
   fields.push(field.trim()); rows.push(fields); fields = []; field = "";
  } else {
   field += c;
  }
 }
 if (fields.length || field) { fields.push(field.trim()); rows.push(fields); }
 if (!rows.length) return [];
 const headers = rows[0].map(h => h.toLowerCase());
 return rows.slice(1).filter(r => r.some(v => v)).map(row => {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ""; });
  return obj;
 });
}
function parseKeyValueBlocks(text) {
 const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
 const objs = [];
 blocks.forEach(block => {
  const obj = {};
  block.split(/\r?\n/).forEach(line => {
   const parts = line.split(/[:=]/);
   if (parts.length < 2) return;
   const key = parts[0].trim().toLowerCase().replace(/\s+/g, "_");
   const value = parts.slice(1).join(":").trim();
   obj[key] = value;
  });
  if (Object.keys(obj).length) objs.push(obj);
 });
 return objs;
}
function normalizeLeadRow(row) {
 return {
  name: row.name || row.client_name || row.lead_name || row.customer || "",
  email: row.email || row.email_address || "",
  phone: row.phone || row.mobile || row.contact || "",
  destination: row.destination || row.trip || row.location || "",
  pax: Number(row.pax || row.adults || 0) || 0,
  kids: Number(row.kids || row.children || 0) || 0,
  budget: row.budget || row.budget_inr || "",
  travel_date: row.travel_date || row.start_date || row.departure_date || "",
  end_date: row.end_date || row.return_date || row.finish_date || "",
  notes: row.notes || row.requirements || row.details || "",
  assigned_to: row.assigned_to || row.agent || row.assignee || "",
  status: row.status || "New",
 };
}
function normalizeVendorRow(row) {
 const comm = parseFloat(row["commission %"] || row.commission || "");
 const rat  = parseFloat(row["rating (1-5)"] || row.rating || row.score || "");
 return {
  vendor_code:      row["vendor code"]    || row.vendor_code    || "",
  name:             row["company name"]   || row.name || row.vendor_name || row.company || row.supplier || "",
  contact_person:   row["contact person"] || row.contact_person || "",
  email:            row.email             || row.email_address  || "",
  email2:           row.email2            || row.alt_email      || row.alternate_email || "",
  phone:            row["phone 1"]        || row.phone          || row.mobile || row.contact || "",
  phone2:           row["phone 2"]        || row.phone2         || "",
  website:          row.website           || "",
  city:             row["office / city"]  || row.city           || "",
  country:          row["base country"]   || row.country        || "",
  destination:      row["destinations covered"] || row.destination || row.location || row.region || "",
  category:         row.category          || row.type           || row.business || "",
  services:         row["services / specialty"] || row.services || "",
  hotel_properties: row["hotel properties"]     || row.hotel_properties || "",
  rating:           isNaN(rat)  ? null : rat,
  commission:       isNaN(comm) ? null : comm,
  status:           row.status  || "Active",
  notes:            row.notes   || "",
 };
}
async function parseImportedEntities(rawText, type) {
 if (!rawText || !rawText.trim()) return [];
 const trimmed = rawText.trim();
 let parsed = [];
 try {
  const json = JSON.parse(trimmed);
  if (Array.isArray(json)) parsed = json;
  else if (json.leads) parsed = Array.isArray(json.leads) ? json.leads : [json.leads];
  else if (json.vendors) parsed = Array.isArray(json.vendors) ? json.vendors : [json.vendors];
  else if (json.lead) parsed = [json.lead];
  else if (json.vendor) parsed = [json.vendor];
  else parsed = [json];
 } catch (_) {
  // not pure JSON
 }
 if (!parsed.length) {
  parsed = parseCSV(trimmed).filter(obj => Object.keys(obj).length > 0);
 }
 if (!parsed.length) {
  parsed = parseKeyValueBlocks(trimmed).filter(obj => Object.keys(obj).length > 0);
 }
 if (!parsed.length) {
  const prompt = type === "leads"
   ? `You are a data extraction API. Extract ALL lead/client records from the text below.\nReturn ONLY a raw JSON array (no markdown, no explanation, no code fences). Each object must have these keys: name, email, phone, destination, pax, kids, budget, travel_date, end_date, notes, assigned_to. Use empty string for missing fields.\nIf no leads can be found, return an empty array: []\n\nText:\n${trimmed.slice(0, 20000)}`
   : `You are a data extraction API. Extract ALL vendor/supplier records from the text below.\nReturn ONLY a raw JSON array (no markdown, no explanation, no code fences). Each object must have these keys: vendor_code, name, contact_person, email, email2, phone, phone2, website, city, country, destination, category, services, hotel_properties, rating, commission, status, notes. Use empty string for missing fields.\nIf no vendors can be found, return an empty array: []\n\nText:\n${trimmed.slice(0, 20000)}`;
  try {
   const ai = await callClaude(prompt, "You are a data extraction API. Output ONLY raw JSON. No markdown, no explanation.", 2000);
   const cleaned = ai.replace(/```json\s*|```/gi, "").trim();
   const json = JSON.parse(cleaned);
   parsed = Array.isArray(json) ? json : (json ? [json] : []);
  } catch (e) {
   console.error("[parseImportedEntities] AI extraction failed:", e.message);
   parsed = [];
  }
 }
 if (type === "leads") {
  return parsed.map(normalizeLeadRow).filter(item => item.name || item.email || item.destination);
 }
 return parsed.map(normalizeVendorRow).filter(item => item.name || item.email || item.destination);
}
// Send email via SendGrid + log to DB
async function sendEmail({ to, subject, html, text, queryCode, leadId, vendorId, direction = "outbound" }) {
 const toArr = Array.isArray(to) ? to : [to];
 const msg = { from: { email: ENQUIRY_EMAIL, name: "Safarnaama Holidays" }, to: toArr, subject, html: html || `<pre>${text}</pre>`, text };
 let sgId = null;
 try {
 const [resp] = await sgMail.send(msg);
 sgId = resp?.headers?.["x-message-id"] || null;
 } catch (err) {
 console.error("SendGrid error:", err.response?.body || err.message);
 }
 await db.from("email_log").insert({
 direction, from_addr: ENQUIRY_EMAIL, to_addrs: toArr,
 subject, body: text || html, query_code: queryCode,
 lead_id: leadId, vendor_id: vendorId, sendgrid_id: sgId, status: sgId ? "sent" : "failed"
 });
 return sgId;
}
// Notify users in DB + send email
async function notify(message, type = "info", userId = null) {
 await db.from("notifications").insert({ type, message, read: false, user_id: userId });
}
// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────
// ── Health ────────────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", service: "Safarnaama CRM API", ts: new Date() }));

// Root — simple HTML page to confirm server is running
app.get("/", (req, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Safarnaama CRM API</title></head><body style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;padding:28px;background:#F6F8FC">` +
    `<h2>Safarnaama CRM API — running</h2>` +
    `<p>Service: <strong>Safarnaama CRM API</strong></p>` +
    `<p>Health: <a href="/health">/health</a></p>` +
    `<p>Try your frontend at <code>http://localhost:3000</code> (React dev) or the API at <code>http://localhost:${PORT}</code></p>` +
    `</body></html>`);
});
// ────────────────────────────────────────────────────────────────────────────
// LEADS
// ────────────────────────────────────────────────────────────────────────────
// Sanitize empty strings for DATE and numeric columns so Supabase doesn't reject the insert.
const DATE_FIELDS = ["travel_date", "end_date", "follow_up_date"];
const NUM_FIELDS  = ["pax", "kids"];
function sanitizeLead(obj) {
 const out = { ...obj };
 DATE_FIELDS.forEach(f => { if (out[f] === "" || out[f] === "Invalid Date") out[f] = null; });
 NUM_FIELDS.forEach(f  => { if (out[f] !== undefined) out[f] = Number(out[f]) || 0; });
 return out;
}

app.get("/api/leads", async (req, res) => {
 const { data, error } = await db.from("leads").select("*").order("created_at", { ascending: false });
 if (error) return res.status(500).json({ error: error.message });
 res.json(data);
});
app.post("/api/leads", async (req, res) => {
 const lead = sanitizeLead({ id: genId("L"), ...req.body, status: req.body.status || "New", created_at: new Date() });
 const { data, error } = await db.from("leads").insert(lead).select().single();
 if (error) { console.error("[leads POST]", error.message, lead); return res.status(400).json({ error: error.message }); }
 await notify(`New lead created: ${lead.name} — ${lead.destination}`, "lead");
 res.status(201).json(data);
});
app.patch("/api/leads/:id", async (req, res) => {
 const { data, error } = await db.from("leads").update(sanitizeLead(req.body)).eq("id", req.params.id).select().single();
 if (error) { console.error("[leads PATCH]", error.message); return res.status(400).json({ error: error.message }); }
 res.json(data);
});
app.delete("/api/leads/:id", async (req, res) => {
 const { error } = await db.from("leads").delete().eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
app.post("/api/import/leads", withUpload(upload.single("doc")), async (req, res) => {
 try {
  const file = req.file;
  console.log(`[import/leads] file: ${file?.originalname || "none"} (${file?.mimetype || "n/a"}, ${file?.size || 0} bytes)`);
  const rawText = file ? await extractTextFromFile(file) : (req.body.raw_content || "");
  console.log(`[import/leads] extracted ${rawText.length} chars`);
  const items = await parseImportedEntities(rawText, "leads");
  console.log(`[import/leads] parsed ${items.length} records`);
  if (!items.length) return res.status(422).json({ error: "No lead records could be extracted. The file may not contain recognisable lead data." });
  const prepared = items.map(item => ({ id: genId("L"), ...item, status: item.status || "New", created_at: new Date() }));
  if (supabase) {
   const { data, error } = await db.from("leads").insert(prepared).select();
   if (error) return res.status(400).json({ error: error.message });
   return res.json({ items: data || prepared });
  }
  res.json({ items: prepared });
 } catch (err) {
  console.error("[import/leads] ERROR:", err.message);
  res.status(500).json({ error: err.message || "Import failed" });
 }
});
// ────────────────────────────────────────────────────────────────────────────
// VENDORS
// ────────────────────────────────────────────────────────────────────────────
app.get("/api/vendors", async (req, res) => {
 const { data, error } = await db.from("vendors").select("*, vendor_packages(*)").order("name");
 if (error) return res.status(500).json({ error: error.message });
 res.json(data);
});
app.post("/api/vendors", async (req, res) => {
 const vendor = { id: genId("V"), ...req.body, status: req.body.status || "Active" };
 const { data, error } = await db.from("vendors").insert(vendor).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.patch("/api/vendors/:id", async (req, res) => {
 const { id } = req.params;
 const { data, error } = await db.from("vendors").update(req.body).eq("id", id).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.json(data);
});
app.delete("/api/vendors/:id", async (req, res) => {
 const { id } = req.params;
 const { error } = await db.from("vendors").delete().eq("id", id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ ok: true });
});
app.post("/api/vendors/bulk", async (req, res) => {
 const items = Array.isArray(req.body) ? req.body : req.body?.vendors;
 if (!items?.length) return res.status(400).json({ error: "Send an array of vendor objects" });
 const prepared = items
  .map(item => normalizeVendorRow(item))
  .filter(v => v.name)
  .map(v => ({ id: genId("V"), ...v }));
 if (!prepared.length) return res.status(422).json({ error: "No valid vendors — name field is required" });
 const { data, error } = await db.from("vendors").insert(prepared).select();
 if (error) return res.status(400).json({ error: error.message });
 res.json({ inserted: data.length, vendors: data });
});
app.post("/api/import/vendors", withUpload(upload.single("doc")), async (req, res) => {
 try {
  const file = req.file;
  console.log(`[import/vendors] file: ${file?.originalname || "none"} (${file?.mimetype || "n/a"}, ${file?.size || 0} bytes)`);
  const rawText = file ? await extractTextFromFile(file) : (req.body.raw_content || "");
  console.log(`[import/vendors] extracted ${rawText.length} chars`);
  const items = await parseImportedEntities(rawText, "vendors");
  console.log(`[import/vendors] parsed ${items.length} records`);
  if (!items.length) return res.status(422).json({ error: "No vendor records could be extracted. The file may not contain recognisable vendor data." });
  const prepared = items.map(item => ({ id: genId("V"), ...item, status: item.status || "Active" }));
  if (supabase) {
   const { data, error } = await db.from("vendors").insert(prepared).select();
   if (error) return res.status(400).json({ error: error.message });
   return res.json({ items: data || prepared });
  }
  res.json({ items: prepared });
 } catch (err) {
  console.error("[import/vendors] ERROR:", err.message);
  res.status(500).json({ error: err.message || "Import failed" });
 }
});
// Vendor upload their own package (from vendor portal)
app.post("/api/vendors/:id/packages", withUpload(upload.single("doc")), async (req, res) => {
 const vendorId = req.params.id;
 let rawContent = req.body.raw_content || "";
 if (req.file) {
  try { rawContent = await extractTextFromFile(req.file); }
  catch (e) { rawContent = req.body.raw_content || "Could not extract text"; }
 }
 // Use Claude to parse the package details
 const aiPrompt = `Extract travel package details from this vendor document text and return ONLY JSON:
${rawContent.slice(0, 3000)}
Return: { package_name, destination, duration_nights, price_per_pax, hotel_name, hotel_category, room_type, inclusions:[], valid_from, valid_till }`;
 const aiResult = await callClaude(aiPrompt);
 let pkgData = {};
 try { pkgData = JSON.parse(aiResult.replace(/```json|```/g, "").trim()); } catch {}
 const pkg = { vendor_id: vendorId, ...pkgData, raw_content: rawContent.slice(0, 5000) };
 const { data, error } = await db.from("vendor_packages").insert(pkg).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json({ package: data, extracted: pkgData });
});
// ────────────────────────────────────────────────────────────────────────────
// ITINERARY GENERATION
// ────────────────────────────────────────────────────────────────────────────
app.post("/api/itinerary/generate", async (req, res) => {
 const { destination, pax, budget, nights = 5 } = req.body;
 const prompt = `Create a ${nights}-night, ${pax}-person travel itinerary for ${destination} with a budget of INR ${budget}.
Return ONLY valid JSON:
{
 "days": [{"day":1,"title":"","activities":[]}],
 "hotels": {
 "3star": [{"name":"","price_per_night":0}],
 "4star": [{"name":"","price_per_night":0}]
 }
}`;
 const result = await callClaude(prompt);
 try {
 const itinerary = JSON.parse(result.replace(/```json|```/g, "").trim());
 // If client requested a download, send as an attachment with proper headers
 const wantsDownload = req.query?.download || req.body?.download;
 if (wantsDownload) {
  const safeName = (destination || 'itinerary').toString().replace(/[^a-z0-9-_]/gi, '_').slice(0,40);
  const filename = `itinerary-${safeName}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(JSON.stringify(itinerary, null, 2));
 }
 res.json(itinerary);
 } catch {
 res.status(422).json({ error: "Could not parse itinerary", raw: result });
 }
});
// ────────────────────────────────────────────────────────────────────────────
// QUOTES — Request a Quote (sends to enquiry + all matching vendors)
// ────────────────────────────────────────────────────────────────────────────
app.post("/api/quotes/request", async (req, res) => {
 const { leadId } = req.body;
 // Fetch lead
 const { data: lead, error: lErr } = await db.from("leads").select("*").eq("id", leadId).single();
 if (lErr || !lead) return res.status(404).json({ error: "Lead not found" });
 // Find vendors for destination
 const { data: destVendors } = await db.from("vendors").select("*").eq("destination", lead.destination).eq("status", "Active");
 // Check existing vendor packages first
 const { data: existingPkgs } = await db.from("vendor_packages").select("*, vendors(name,email)").eq("destination", lead.destination);
 const queryCode = genQueryCode();
 // Ask Claude to draft the vendor email
 const emailPrompt = `Draft a professional vendor inquiry email for Safarnaama Holidays.
Query Code: ${queryCode}
Client: ${lead.name} (${lead.pax} pax)
Destination: ${lead.destination}
Travel Date: ${lead.travel_date}
Budget: INR ${lead.budget}
Special Notes: ${lead.notes || "None"}
Existing packages on file: ${existingPkgs?.length || 0}
Write: subject line on first line, then blank line, then email body. Keep under 200 words.`;
 const emailDraft = await callClaude(emailPrompt);
 const lines = emailDraft.split("\n");
 const subject = lines[0].replace(/^Subject:\s*/i, "").trim();
 const body = lines.slice(1).join("\n").trim();
 // Build HTML email
 const htmlBody = `
 <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
 <div style="background:#0D2030;color:#E8F4FD;padding:16px;border-radius:8px;margin-bottom:20px">
 <strong>Safarnaama Holidays</strong><br/>
 <small>Query Code: <strong>${queryCode}</strong></small>
 </div>
 <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;line-height:1.6">${body}</pre>
 <hr style="margin:20px 0;border-color:#eee"/>
 <p style="color:#888;font-size:12px">
 Please reply to this email with your quote mentioning Query Code <strong>${queryCode}</strong>.<br/>
 Safarnaama Holidays | enquiry@SafarnaamaHolidays.com
 </p>
 </div>`;
 // Send to enquiry inbox (self-copy)
 await sendEmail({ to: ENQUIRY_EMAIL, subject, html: htmlBody, text: body, queryCode, leadId, direction: "outbound" });
 // Send to all matching vendors
 const vendorsContacted = [];
 for (const vendor of (destVendors || [])) {
 await sendEmail({ to: vendor.email, subject, html: htmlBody, text: body, queryCode, leadId, vendorId: vendor.id, direction: "outbound" });
 vendorsContacted.push(vendor.name);
 }
 // Notify admin
 await sendEmail({
 to: ADMIN_EMAIL,
 subject: `[Admin Alert] Quote Request ${queryCode} — ${lead.destination}`,
 text: `Quote request sent for lead ${lead.name}.\nQuery Code: ${queryCode}\nVendors contacted: ${vendorsContacted.join(", ") || "none"}`,
 direction: "outbound"
 });
 // Save quote record
 const quoteRecord = {
 id: genId("Q"),
 lead_id: leadId,
 lead_name: lead.name,
 destination: lead.destination,
 query_code: queryCode,
 status: "Quote Requested",
 vendors_contacted: vendorsContacted,
 vendor_replies: [],
 };
 await db.from("quotes").insert(quoteRecord);
 // Update lead status
 await db.from("leads").update({ status: "Quote Requested" }).eq("id", leadId);
 // Notify agents
 await notify(`Quote ${queryCode} sent for ${lead.name} — ${lead.destination}. ${vendorsContacted.length} vendors contacted.`, "quote");
 res.json({ success: true, queryCode, vendorsContacted, existingPackagesFound: existingPkgs?.length || 0 });
});
// ─────────────────────────────────────────────────────────────────────────────
// Vendor plain-text (asterisk-markdown) → HTML converter
// Travel vendors send emails with *bold* markers and pseudo-table structure.
// These functions parse that format without relying on Claude.
// ─────────────────────────────────────────────────────────────────────────────
function renderHotelTable(hotelLines) {
 // Match "1st Night", "1st (Night)", "2nd Night", "3 Nights", "Night 1", etc.
 const isDateLine = l =>
  (/^\d+(st|nd|rd|th)\b/i.test(l) && !/\bstar\b/i.test(l)) ||
  /^(night|day|nite|n)\s*\d+\b/i.test(l) ||
  /^\d+\s*nights?\b/i.test(l);
 const isBold     = l => /^\*[^*]+\*\s*$/.test(l);
 const unbold     = l => l.replace(/\*(.*?)\*/g, "$1").trim();
 const isStar     = l => /^\d\s*[–-]?\s*Star/i.test(l);
 const isMeal     = l => /Breakfast|Dinner|Lunch|Room\s*Only|CP\b|MAP\b|AP\b/i.test(l);

 // Group lines into per-hotel-row chunks
 const chunks = [];
 let cur = null;
 for (const l of hotelLines) {
  if (isDateLine(l)) {
   if (!cur || cur.data.length > 0) { if (cur) chunks.push(cur); cur = { nights: [l], data: [] }; }
   else cur.nights.push(l);
  } else {
   if (!cur) cur = { nights: [], data: [] };
   if (cur.nights.length) cur.data.push(l);
  }
 }
 if (cur && cur.nights.length) chunks.push(cur);

 const rows = chunks.map(({ nights, data }) => {
  let city="", hotel="", star="", meal="", accType="", accExtra=[]; let ph="city";
  for (const d of data) {
   if      (ph==="city"    && isBold(d)) { city=unbold(d);  ph="hotel";  }
   else if (ph==="hotel"   && isBold(d)) { hotel=unbold(d); ph="star";   }
   else if (ph==="star"    && isStar(d)) { star=d;          ph="meal";   }
   else if ((ph==="star"||ph==="meal") && isMeal(d)) { meal=d; ph="mealSfx"; }
   else if (ph==="mealSfx" && /^\(/.test(d)) { meal+=" "+d.replace(/[()]/g,"").trim(); ph="acc"; }
   else if ((ph==="acc"||ph==="mealSfx") && isBold(d)) { accType=unbold(d); ph="accX"; }
   else if (ph==="accX") accExtra.push(d);
  }
  const hotelCell = hotel
   ? `<strong>${hotel}</strong>${star?`<br/><small style="color:#777">${star}</small>`:""}`
   : `<em style="color:#999">Book On Own</em>`;
  const accCell = accType
   ? `<strong>${accType}</strong>${accExtra.length?`<br/><small style="color:#555">${accExtra.join("<br/>")}</small>`:""}`
   : `<em style="color:#999">Book On Own</em>`;
  return { nights:nights.join("<br/>"), city:city||"—", hotel:hotelCell, meal:meal||"—", acc:accCell };
 });

 if (!rows.length) return "";
 const TH = `style="padding:8px 10px;text-align:left;background:#1A6B8A;color:#fff;white-space:nowrap"`;
 const TD = (bg,wnp) => `style="padding:8px 10px;border:1px solid #ddd;vertical-align:top;background:${bg}${wnp?";white-space:nowrap":""}"`;
 let t = `<div style="overflow-x:auto;margin:10px 0"><table style="width:100%;border-collapse:collapse;font-size:13px">
<thead><tr>${["Nights","City","Hotel Name","Meal Plan","Accommodation"].map(c=>`<th ${TH}>${c}</th>`).join("")}</tr></thead><tbody>`;
 rows.forEach((r,i)=>{
  const bg = i%2===0?"#fff":"#f0f7ff";
  t+=`<tr><td ${TD(bg,true)}>${r.nights}</td><td ${TD(bg,false)}><strong>${r.city}</strong></td>
<td ${TD(bg,false)}>${r.hotel}</td><td ${TD(bg,false)}>${r.meal}</td><td ${TD(bg,false)}>${r.acc}</td></tr>`;
 });
 return t+"</tbody></table></div>";
}

function convertVendorEmailToHtml(rawText, vendorName, priceList) {
 console.log(`[conv] input len=${rawText.length} vendorName="${vendorName}" prices=${priceList.length}`);

 const ap = str => {
  let s = str;
  for (const r of priceList) {
   const cf=r.raw.toLocaleString("en-US"), mf=r.mu.toLocaleString("en-US");
   s = s.replace(new RegExp(cf.replace(/\./g,"\\."), "g"), mf);
   if (String(r.raw)!==cf) s = s.replace(new RegExp(`(?<![\\d,])(${r.raw})(?![\\d])`, "g"), mf);
  }
  return s;
 };
 const rb     = s => ap(s).replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
 const isBold = l => /^\*[^*]+\*\s*$/.test(l);
 const unbold = l => l.replace(/\*(.*?)\*/g, "$1").trim();
 // Column names used as table headers (flexible lowercase matching)
 const TABLE_COLS = ["nights","city","hotel name","meal plan","accommodation","room type","room category","hotel/resort"];
 const vendorLc = (vendorName||"").toLowerCase();

 // Lines to skip: vendor greetings, sign-offs, and vendor-identifying lines
 const isVendorLine = l => {
  const s = unbold(l).toLowerCase();
  return /^(dear\b|greetings|hi\b|hello\b|warm\s+greetings|good\s+(morning|afternoon|evening))/i.test(s) ||
         /\bgreetings\s+from\b/i.test(s) ||
         /\bpowered\s+by\b/i.test(s) ||
         /^(warm\s+regards|best\s+regards|kind\s+regards|thanks\s*[&+]\s*regards|with\s+regards|yours\s+truly|sincerely\b|regards\b)/i.test(s) ||
         /^(thank\s+you|thanks\s+for|please\s+do\s+not\s+hesitate|looking\s+forward|we\s+hope|feel\s+free|for\s+any\s+(query|queries|clarification))/i.test(s) ||
         /^(we\s+are\s+(pleased|happy|delighted)|it\s+is\s+our\s+pleasure)/i.test(s) ||
         (vendorLc.length>3 && s.includes(vendorLc));
 };

 // Stop-section keywords (bold heading that means "end of hotels section")
 const isNextSection = t =>
  /^(prices?|transportation|terms|conditions?|note|day[\s-]*wise|itinerary|exclusion|inclusion|important|package overview|option\s*\d)/i.test(t);

 // Collect hotel table lines after a Hotels heading (or TABLE_COL header block)
 const collectAndRenderHotels = (startIdx) => {
  const hotelLines = [];
  let j = startIdx;
  while (j < lines.length) {
   const hl = lines[j].trim();
   if (!hl) { j++; continue; }
   if (/^On .+\d{4}.+wrote:/i.test(hl)) break;
   if (/^>/.test(lines[j].trimStart())) { j++; continue; }
   if (isBold(hl)) {
    const t = unbold(hl);
    if (isNextSection(t)) break;
    // Skip column header lines by name
    if (TABLE_COLS.some(c => c === t.toLowerCase())) { j++; continue; }
   }
   hotelLines.push(hl);
   j++;
  }
  console.log(`[conv] hotel lines collected: ${hotelLines.length}, first: "${hotelLines[0]||""}"`);
  return { tableHtml: renderHotelTable(hotelLines), nextIdx: j };
 };

 const lines = rawText.split("\n");
 let html = "";
 let i = 0;

 while (i < lines.length) {
  const raw = lines[i];
  const l   = raw.trim();

  if (!l)               { i++; continue; }
  if (/^On .+\d{4}.+wrote:/i.test(l)) break;
  if (/^>/.test(raw.trimStart())) { i++; continue; }
  if (isVendorLine(l))  { i++; continue; }
  if (/^-{5,}$/.test(l)) { html+=`<hr style="border:none;border-top:1px solid #e0e0e0;margin:14px 0"/>`; i++; continue; }

  // ── Hotels section heading → collect and render table ───────────────────
  if (isBold(l) && /^Hotels?$/i.test(unbold(l))) {
   html+=`<h3 style="color:#1A6B8A;border-bottom:2px solid #e0e7ef;padding-bottom:5px;margin-top:22px;margin-bottom:8px">Hotels</h3>`;
   const { tableHtml, nextIdx } = collectAndRenderHotels(i + 1);
   html += tableHtml;
   i = nextIdx;
   continue;
  }

  // ── Fallback: detect table by column-header bold-line block ─────────────
  // Look for 3+ consecutive bold lines that are all TABLE_COLS names
  if (isBold(l) && TABLE_COLS.includes(unbold(l).toLowerCase())) {
   // Count consecutive matching bold lines from here
   let jj = i, colCount = 0;
   while (jj < lines.length) {
    const ll2 = lines[jj].trim();
    if (!ll2) { jj++; continue; }
    if (isBold(ll2) && TABLE_COLS.includes(unbold(ll2).toLowerCase())) { colCount++; jj++; }
    else break;
   }
   if (colCount >= 3) {
    const { tableHtml, nextIdx } = collectAndRenderHotels(jj);
    html += tableHtml;
    i = nextIdx;
    continue;
   }
  }

  // Price line (bold, starts with digit or "Total")
  if (isBold(l) && (/^\*\d/.test(l)||/^\*Total/i.test(l))) {
   html+=`<div style="padding:3px 0;font-size:14px">${rb(l)}</div>`; i++; continue;
  }

  // Activity / exclusion list items
  if (/^\s{2,}-\s/.test(raw) || /^♣/.test(l) || /^-\s/.test(l)) {
   html+=`<ul style="margin:4px 0;padding-left:22px">`;
   while (i<lines.length) {
    const rl=lines[i], ll=rl.trim();
    if (!ll) { i++; break; }
    if (/^\s{2,}-\s/.test(rl)||/^-\s/.test(ll)||/^♣/.test(ll)) {
     let content=ll.replace(/^[-♣]\s*/,"");
     i++;
     while (i<lines.length && lines[i].startsWith("   ") && !/^\s{2,}-/.test(lines[i]) && lines[i].trim()) {
      content+=" "+lines[i].trim(); i++;
     }
     html+=`<li style="margin:3px 0">${rb(content)}</li>`;
    } else break;
   }
   html+=`</ul>`; continue;
  }

  // Standalone bold line → section heading or sub-heading
  if (isBold(l)) {
   const t=unbold(l);
   if (/^(Package Overview|Prices?|Transportation|Day[\s-]*Wise|Terms?|Conditions?|EXCLUSION|INCLUSION|IMPORTANT)/i.test(t))
    html+=`<h3 style="color:#1A6B8A;border-bottom:2px solid #e0e7ef;padding-bottom:5px;margin-top:22px;margin-bottom:8px">${ap(t)}</h3>`;
   else if (/^Option\s*\d|^\d+(st|nd|rd|th)\s+Day/i.test(t))
    html+=`<h4 style="color:#2E7D32;margin:12px 0 4px">${ap(t)}</h4>`;
   else
    html+=`<p style="margin:5px 0"><strong>${ap(t)}</strong></p>`;
   i++; continue;
  }

  // Key → value pair: short plain line followed by a bold value
  if (l.length<50) {
   let ni=i+1; while(ni<lines.length && !lines[ni].trim()) ni++;
   const nv=(lines[ni]||"").trim();
   if (isBold(nv)) {
    html+=`<div style="display:flex;gap:12px;padding:2px 0;font-size:13px;line-height:1.5">
<span style="color:#6B7280;min-width:130px;flex-shrink:0">${l}</span>
<strong>${ap(unbold(nv))}</strong></div>`;
    i=ni+1; continue;
   }
  }

  // Regular paragraph
  html+=`<p style="margin:5px 0;font-size:13px;line-height:1.7">${rb(l)}</p>`;
  i++;
 }

 console.log(`[conv] output len=${html.length} hasTable=${/<table/i.test(html)}`);
 return html;
}

// ────────────────────────────────────────────────────────────────────────────
// INBOUND EMAIL WEBHOOK (SendGrid Inbound Parse)
// Configure in SendGrid: Mail Settings → Inbound Parse
// Destination URL: https://your-api.com/webhook/inbound-email
// MX Record: point enquiry subdomain to mx.sendgrid.net
// ────────────────────────────────────────────────────────────────────────────
app.post("/webhook/inbound-email", withUpload(upload.any()), async (req, res) => {
 res.sendStatus(200); // Acknowledge immediately to SendGrid
 const from = req.body.from || "";
 const to = req.body.to || "";
 const subject = req.body.subject || "";
 const text = req.body.text || req.body.html || "";
 console.log(`[INBOUND] From: ${from} | Subject: ${subject}`);
 // Log the inbound email
 await db.from("email_log").insert({
 direction: "inbound", from_addr: from, to_addrs: [to],
 subject, body: text.slice(0, 5000), status: "received"
 });
 // ── Extract query code from subject/body ──────────────────────────────────
 const qcMatch = (subject + " " + text).match(/QC-\d{4}-\d{4}/);
 const queryCode = qcMatch ? qcMatch[0] : null;
 if (!queryCode) {
 console.log("[INBOUND] No query code found — skipping auto-process");
 return;
 }
 // ── Fetch the related quote ───────────────────────────────────────────────
 const { data: quote } = await db.from("quotes").select("*, leads(*)").eq("query_code", queryCode).single();
 if (!quote) {
 console.log(`[INBOUND] No quote found for ${queryCode}`);
 return;
 }
 // ── Extract ALL prices from vendor reply (use plain text for Claude) ────────
 const plainText = req.body.text || req.body.html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") || "";
 const extractPrompt = `A travel vendor has replied to a quote request. Extract ALL prices/costs mentioned.
Email:
${plainText.slice(0, 3000)}

Return ONLY JSON:
{
  "vendorName": "vendor company name only (not powered-by or parent brands)",
  "destination": "destination",
  "nights": 0,
  "currency": "USD or INR or other 3-letter code",
  "validTill": "",
  "prices": [
    {"label": "Per Person Adult", "amount": 0},
    {"label": "Per Child with Extra Bed", "amount": 0},
    {"label": "Total Option 1", "amount": 0}
  ]
}
- amount must be a plain number (no commas, no symbols)
- Include EVERY distinct price, including totals for each option
- If same amount appears for different items, list each separately`;
 const extracted = await callClaude(extractPrompt);
 let vendorQuote = {};
 try { vendorQuote = JSON.parse(extracted.replace(/```json|```/g, "").trim()); } catch {}

 // ── Apply markup from settings ────────────────────────────────────────────
 const { data: settingsRow } = await db.from("app_settings").select("value").eq("key", "markup").single();
 const markupPct = Number(settingsRow?.value?.hotel4star || settingsRow?.value?.default || 22);
 const applyMarkup = n => { const v = Number(n)||0; return v > 0 ? Math.round(v * (1 + markupPct/100)) : 0; };

 const lead = quote.leads;
 const pax  = Number(lead?.pax) || 1;
 const currency = vendorQuote.currency || "";

 // Sort extracted prices largest-first (prevents partial matches when replacing)
 const priceList = (vendorQuote.prices || [])
  .map(p => ({ label: p.label, raw: Number(p.amount)||0, mu: applyMarkup(Number(p.amount)||0) }))
  .filter(p => p.raw > 0)
  .sort((a, b) => b.raw - a.raw);

 // For summary: use the largest total-labeled price, else the largest price overall
 const totalEntry = priceList.find(p => /total/i.test(p.label)) || priceList[0] || {raw:0,mu:0};
 const effectiveRaw  = totalEntry.raw;
 const markedUpTotal = totalEntry.mu;
 const perPaxEntry   = priceList.find(p => /per person|adult|pax/i.test(p.label));
 const markedUpPerPax = perPaxEntry ? perPaxEntry.mu : (markedUpTotal > 0 ? Math.round(markedUpTotal/pax) : 0);

 console.log(`[INBOUND] Markup ${markupPct}% | Prices extracted:`, priceList.map(p=>`${p.label}: ${p.raw}→${p.mu}`).join(", "));

 // ── Build client body ─────────────────────────────────────────────────────
 // Only use raw HTML if the vendor sent a genuinely rich HTML email (has <table>).
 // Most travel vendors send plain text with *asterisk* markdown — detect that and
 // use the custom JS converter which creates proper tables and headings.
 const rawHtml  = req.body.html || "";
 const hasRichHtml = /<table[\s>]/i.test(rawHtml);  // real HTML tables, not a text wrapper
 let clientBody = "";

 console.log(`[INBOUND-DBG] rawHtml.length=${rawHtml.length} hasRichHtml=${hasRichHtml} body.text.length=${(req.body.text||"").length}`);
 console.log(`[INBOUND-DBG] rawHtml[0:200]=${rawHtml.slice(0,200)}`);
 console.log(`[INBOUND-DBG] body.text[0:300]=${(req.body.text||"").slice(0,300)}`);

 if (hasRichHtml) {
  // Vendor sent proper HTML with tables — replace prices in text nodes, strip branding
  clientBody = rawHtml.replace(/(>)([^<]*)(<)/g, (_, o, content, c) => {
   let s = content;
   for (const r of priceList) {
    const cf=r.raw.toLocaleString("en-US"), mf=r.mu.toLocaleString("en-US");
    s = s.replace(new RegExp(cf.replace(/\./g,"\\."), "g"), mf);
    if (String(r.raw)!==cf) s = s.replace(new RegExp(`(?<![\\d,])(${r.raw})(?![\\d])`, "g"), mf);
   }
   return o+s+c;
  });
  clientBody = clientBody.replace(/Greetings from[^<]{0,300}/gi, "");
  clientBody = clientBody.replace(/powered by[^<]{0,150}/gi, "");
 } else {
  // Plain-text vendor email (asterisk-markdown) — use custom parser
  // Prefer req.body.text; fall back to replacing <br> with newlines then stripping tags
  const textSource = req.body.text ||
   rawHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g," ").trim();
  console.log(`[INBOUND-DBG] textSource[0:400]=${textSource.slice(0,400)}`);
  clientBody = convertVendorEmailToHtml(textSource, vendorQuote.vendorName, priceList);
  console.log(`[INBOUND-DBG] clientBody hasTable=${/<table/i.test(clientBody)} len=${clientBody.length} first300=${clientBody.slice(0,300)}`);
 }

 // ── Update quote with vendor reply ────────────────────────────────────────
 const reply = {
  from, receivedAt: new Date().toISOString(),
  vendor: vendorQuote.vendorName || from,
  rawTotal: effectiveRaw, markupPct,
  finalTotal: markedUpTotal, finalPerPax: markedUpPerPax,
  currency, details: vendorQuote,
 };
 const currentReplies = quote.vendor_replies || [];
 await db.from("quotes").update({
  vendor_replies: [...currentReplies, reply],
  status: "Quote Received",
  final_amount: markedUpTotal,
  markup_applied: markupPct,
 }).eq("query_code", queryCode);
 await db.from("leads").update({ status: "Quote Received" }).eq("id", lead.id);

 // ── Forward to client: Safarnaama header + original HTML body ─────────────
 if (lead?.email) {
  const currSym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "INR" ? "₹" : (currency + " ");
  const fmtAmt  = n => currSym + n.toLocaleString("en-US");
  const clientHtml = `
<div style="font-family:Arial,sans-serif;max-width:700px;margin:auto">
 <div style="background:#0D2030;color:#E8F4FD;padding:18px 24px;border-radius:8px 8px 0 0">
  <div style="font-size:20px;font-weight:bold;letter-spacing:.5px">Safarnaama Holidays</div>
  <div style="font-size:12px;opacity:.8;margin-top:4px">Your Travel Quote · Reference: <strong>${queryCode}</strong></div>
 </div>
 <div style="background:#F0FDF4;border-left:4px solid #10B981;padding:14px 20px">
  <div style="font-size:13px;font-weight:bold;color:#065F46;margin-bottom:6px">Quick Price Summary</div>
  <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:center">
   ${perPaxEntry ? `<span style="font-size:14px;color:#0F172A">Per Person: <strong>${fmtAmt(markedUpPerPax)}</strong></span>` : ""}
   <span style="font-size:16px;color:#0D2030">Grand Total: <strong>${fmtAmt(markedUpTotal)}</strong> <small style="font-size:11px;color:#64748B">(${pax} pax)</small></span>
   ${vendorQuote.nights ? `<span style="font-size:13px;color:#475569">Duration: <strong>${vendorQuote.nights} nights</strong></span>` : ""}
  </div>
  ${priceList.length > 1 ? `<div style="margin-top:8px;font-size:12px;color:#047857">${priceList.map(p=>`${p.label}: ${fmtAmt(p.mu)}`).join(" &nbsp;·&nbsp; ")}</div>` : ""}
 </div>
 <div style="border:1px solid #e0e0e0;border-top:none;padding:20px;border-radius:0 0 8px 8px">
  ${clientBody}
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
  <p style="font-size:12px;color:#888;margin:0">
   ${vendorQuote.validTill ? `Valid till: <strong>${vendorQuote.validTill}</strong> &nbsp;·&nbsp; ` : ""}
   To confirm, reply to this email or call us. Quote ref: <strong>${queryCode}</strong>
  </p>
 </div>
</div>`;
  await sendEmail({
   to: lead.email,
   subject: `Your ${lead.destination || vendorQuote.destination} Package Quote — ${queryCode}`,
   html: clientHtml,
   queryCode, leadId: lead.id, direction: "outbound",
  });
  await db.from("leads").update({ status: "Quote Sent" }).eq("id", lead.id);
 }

 // ── Notify admin with full markup breakdown ───────────────────────────────
 await notify(`Vendor quote for ${queryCode} (${lead?.destination}): raw ${currency} ${effectiveRaw.toLocaleString("en-US")} → client ${markedUpTotal.toLocaleString("en-US")} (${markupPct}% markup). Forwarded to ${lead?.name}.`, "vendor");
 const adminPriceLines = priceList.map(p => `  ${p.label}: ${currency} ${p.raw} → ${p.mu} (+${markupPct}%)`).join("\n");
 await sendEmail({
  to: ADMIN_EMAIL,
  subject: `[Admin] Vendor replied: ${queryCode}`,
  text: `Vendor: ${vendorQuote.vendorName || from}\nQuery: ${queryCode}\nDestination: ${lead?.destination}\nMarkup: ${markupPct}%\n\nPrice breakdown:\n${adminPriceLines}\n\nGrand total raw: ${currency} ${effectiveRaw}\nGrand total client: ${currency} ${markedUpTotal}\n\nForwarded to: ${lead?.email}`,
  direction: "outbound",
 });
 console.log(`[INBOUND] ${queryCode} — ${priceList.length} prices marked up at ${markupPct}% — forwarded to ${lead?.email}`);
});
// ────────────────────────────────────────────────────────────────────────────
// INVOICES
// ────────────────────────────────────────────────────────────────────────────
app.get("/api/invoices", async (req, res) => {
 const { data, error } = await db.from("invoices").select("*").order("created_at", { ascending: false });
 if (error) return res.status(500).json({ error: error.message });
 res.json(data);
});
app.post("/api/invoices/generate", async (req, res) => {
 const { leadId } = req.body;
 const { data: lead } = await db.from("leads").select("*").eq("id", leadId).single();
 if (!lead) return res.status(404).json({ error: "Lead not found" });
 const aiPrompt = `Generate a travel invoice JSON for Safarnaama Holidays:
Client: ${lead.name}, Email: ${lead.email}
Destination: ${lead.destination}, Date: ${lead.travel_date}
Pax: ${lead.pax}, Budget: INR ${lead.budget}
Return ONLY JSON: { invoice_no, date, due_date, items:[{description,qty,rate,amount}], subtotal, gst, total, notes }
GST = 5%. invoice_no format: INV-YYMMDD-XXXX`;
 const result = await callClaude(aiPrompt);
 let invoiceData = {};
 try { invoiceData = JSON.parse(result.replace(/```json|```/g, "").trim()); } catch {
 const base = Number(String(lead.budget).replace(/[^0-9]/g,"")) || 45000 * lead.pax;
 invoiceData = {
 invoice_no: `INV-${new Date().toISOString().slice(2,8).replace("-","")}-${Math.floor(Math.random()*9000+1000)}`,
 date: new Date().toISOString().split("T")[0],
 due_date: lead.travel_date,
 items: [{ description: `${lead.destination} Package (${lead.pax} pax)`, qty: lead.pax, rate: Math.round(base/lead.pax), amount: base }],
 subtotal: base, gst: Math.round(base * 0.05), total: Math.round(base * 1.05),
 notes: "50% advance to confirm booking."
 };
 }
 const invoice = { ...invoiceData, lead_id: leadId, lead_name: lead.name, destination: lead.destination, status: "Draft" };
 const { data, error } = await db.from("invoices").insert(invoice).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.post("/api/invoices/:id/send", async (req, res) => {
 const { data: inv } = await db.from("invoices").select("*, leads(email,name)").eq("id", req.params.id).single();
 if (!inv) return res.status(404).json({ error: "Invoice not found" });
 const clientEmail = inv.leads?.email;
 if (clientEmail) {
 const rows = (inv.items || []).map(i => `<tr><td style="padding:8px;border:1px solid #eee">${i.description}</td><td style="padding:8px;border:1px solid #eee">${i.qty}</td><td style="padding:8px;border:1px solid #eee">₹${Number(i.rate).toLocaleString("en-IN")}</td><td style="padding:8px;border:1px solid #eee">₹${Number(i.amount).toLocaleString("en-IN")}</td></tr>`).join("");
 const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
 <div style="background:#0D2030;color:#E8F4FD;padding:16px;border-radius:8px;margin-bottom:20px">
 <strong>Safarnaama Holidays</strong> — Invoice<br/><small>${inv.invoice_no}</small>
 </div>
 <p>Dear ${inv.lead_name},</p>
 <table style="width:100%;border-collapse:collapse">
 <thead><tr style="background:#f5f5f5"><th style="padding:8px;border:1px solid #eee;text-align:left">Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
 <tbody>${rows}</tbody>
 </table>
 <p style="text-align:right">Subtotal: ₹${Number(inv.subtotal).toLocaleString("en-IN")}<br/>GST (5%): ₹${Number(inv.gst).toLocaleString("en-IN")}<br/><strong>Total: ₹${Number(inv.total).toLocaleString("en-IN")}</strong></p>
 <p>${inv.notes || ""}</p>
 </div>`;
 await sendEmail({ to: clientEmail, subject: `Invoice ${inv.invoice_no} — Safarnaama Holidays`, html, leadId: inv.lead_id, direction: "outbound" });
 await db.from("invoices").update({ status: "Sent" }).eq("id", req.params.id);
 }
 res.json({ success: true });
});
// ────────────────────────────────────────────────────────────────────────────
// VOUCHERS
// ────────────────────────────────────────────────────────────────────────────
app.get("/api/vouchers", async (req, res) => {
 const { data, error } = await db.from("vouchers").select("*").order("created_at", { ascending: false });
 if (error) return res.status(500).json({ error: error.message });
 res.json(data);
});
app.post("/api/vouchers/generate", async (req, res) => {
 const { leadId } = req.body;
 const { data: lead } = await db.from("leads").select("*").eq("id", leadId).single();
 if (!lead) return res.status(404).json({ error: "Lead not found" });
 const aiPrompt = `Generate a travel confirmation voucher JSON for Safarnaama Holidays:
Client: ${lead.name}, Destination: ${lead.destination}
Travel Date: ${lead.travel_date}, Pax: ${lead.pax}
Return ONLY JSON: { voucher_no, client_name, destination, travel_date, return_date, pax, hotel, room_type, inclusions:[], special_notes, emergency_contact }`;
 const result = await callClaude(aiPrompt);
 let voucherData = {};
 try { voucherData = JSON.parse(result.replace(/```json|```/g, "").trim()); } catch {
 voucherData = {
 voucher_no: `VCH-${Date.now().toString().slice(-8)}`,
 client_name: lead.name, destination: lead.destination,
 travel_date: lead.travel_date, return_date: lead.travel_date,
 pax: lead.pax, hotel: "To be confirmed", room_type: "Deluxe",
 inclusions: ["Airport Transfer","Breakfast","Guided Tour"],
 special_notes: "Carry this voucher to the hotel.",
 emergency_contact: "+91-9999999999"
 };
 }
 const voucher = { ...voucherData, lead_id: leadId, status: "Active" };
 const { data, error } = await db.from("vouchers").insert(voucher).select().single();
 if (error) return res.status(400).json({ error: error.message });
 // Send voucher to client
 if (lead.email) {
 const html = `<div style="font-family:Arial;max-width:600px;margin:auto;padding:20px">
 <div style="background:#0D2030;color:#E8F4FD;padding:16px;border-radius:8px">
 <strong>Safarnaama Holidays</strong> — Travel Voucher<br/>
 <span style="color:#4FC3F7">${voucherData.voucher_no}</span>
 </div>
 <h2 style="color:#1A6B8A">Booking Confirmed — ${voucherData.destination}</h2>
 <table style="width:100%;border-collapse:collapse">
 <tr><td style="padding:8px;border:1px solid #eee"><strong>Guest</strong></td><td style="padding:8px;border:1px solid #eee">${voucherData.client_name}</td></tr>
 <tr><td style="padding:8px;border:1px solid #eee"><strong>Destination</strong></td><td style="padding:8px;border:1px solid #eee">${voucherData.destination}</td></tr>
 <tr><td style="padding:8px;border:1px solid #eee"><strong>Travel Date</strong></td><td style="padding:8px;border:1px solid #eee">${voucherData.travel_date}</td></tr>
 <tr><td style="padding:8px;border:1px solid #eee"><strong>Hotel</strong></td><td style="padding:8px;border:1px solid #eee">${voucherData.hotel}</td></tr>
 <tr><td style="padding:8px;border:1px solid #eee"><strong>Inclusions</strong></td><td style="padding:8px;border:1px solid #eee">${(voucherData.inclusions||[]).join(", ")}</td></tr>
 </table>
 <p><em>${voucherData.special_notes || ""}</em></p>
 <p style="color:#888;font-size:12px">Emergency: ${voucherData.emergency_contact}</p>
 </div>`;
 await sendEmail({ to: lead.email, subject: `Booking Confirmed — ${voucherData.destination} | ${voucherData.voucher_no}`, html, leadId, direction: "outbound" });
 }
 res.status(201).json(data);
});
// ────────────────────────────────────────────────────────────────────────────
// UPLOAD VENDOR QUOTE DOCUMENT → extract + apply markup
// ────────────────────────────────────────────────────────────────────────────
app.post("/api/quotes/upload-doc", withUpload(upload.single("doc")), async (req, res) => {
 if (!req.file) return res.status(400).json({ error: "No file uploaded" });
 try {
  console.log(`[upload-doc] file: ${req.file.originalname} (${req.file.mimetype}, ${req.file.size} bytes)`);
  let rawText = "";
  try { rawText = await extractTextFromFile(req.file); }
  catch (e) { rawText = req.file.buffer.toString("utf8"); }
  console.log(`[upload-doc] extracted ${rawText.length} chars`);

  const aiPrompt = `Extract travel quote/itinerary details from the document below. Return ONLY valid JSON, no markdown.

JSON structure:
{"vendorName":"","destination":"","pax":0,"totalCost":0,"perPersonCost":0,"validTill":"","inclusions":[],"notes":"",
"hotels":[{"name":"","destination":"","checkIn":"","checkOut":"","roomType":"","meals":"","nights":0,"costPerNight":0}],
"flights":[{"from":"","to":"","date":"","airline":"","flightNo":"","departure":"","arrival":"","class":"Economy","cost":0}],
"days":[{"day":1,"date":"","title":"","location":"","activities":[{"time":"","type":"sightseeing","title":"","desc":"","cost":0}]}]}

Rules: all costs are numbers (INR, 0 if unknown). pax is a number. Arrays empty [] if not found. Extract ALL hotels, flights and days found. For multi-hotel trips extract each hotel separately. Convert USD/EUR to INR at 84x.

Document:
${rawText.slice(0, 7000)}`;

  let extracted = {};
  let rawAiResult = "";
  try {
   rawAiResult = await callClaude(
    aiPrompt,
    "You are a data extraction API. Output ONLY valid JSON. No markdown, no explanation, no code fences.",
    4000
   );
   const cleaned = rawAiResult.replace(/```json\s*|```/gi, "").trim();
   // Find first { and last } to handle any stray text
   const start = cleaned.indexOf("{");
   const end = cleaned.lastIndexOf("}");
   if (start === -1 || end === -1) throw new Error("No JSON object found in response");
   extracted = JSON.parse(cleaned.slice(start, end + 1));
   console.log(`[upload-doc] extracted OK — hotels:${(extracted.hotels||[]).length} flights:${(extracted.flights||[]).length} days:${(extracted.days||[]).length}`);
  } catch (e) {
   console.error("[upload-doc] Claude extraction failed:", e.message);
   console.error("[upload-doc] Raw AI result (first 500):", rawAiResult.slice(0, 500));
  }

  const { data: settingsRow } = await db.from("app_settings").select("value").eq("key", "markup").single();
  const markupCfg = settingsRow?.value || { hotel4star: 22 };
  const markupPct = markupCfg.hotel4star || 22;
  const finalCost = Math.round((Number(extracted.totalCost) || 0) * (1 + markupPct / 100));
  console.log(`[upload-doc] done — destination: ${extracted.destination || "?"}, totalCost: ${extracted.totalCost || 0}, days: ${(extracted.days||[]).length}, hotels: ${(extracted.hotels||[]).length}`);
  res.json({ extracted, markupPct, finalCost, rawTextLength: rawText.length });
 } catch (err) {
  console.error("[upload-doc] ERROR:", err.message);
  res.status(500).json({ error: err.message || "Upload processing failed" });
 }
});
// ────────────────────────────────────────────────────────────────────────────
// SEED — one-time data loader. POST /api/seed/vendors
// Inserts all 131 preset hotels & vendors into Supabase.
// Call once from Postman / browser / curl after tables are created.
// ────────────────────────────────────────────────────────────────────────────
const PRESET_VENDORS = [
 // INDIA: GOA
 { id:"V001", name:"Taj Exotica Resort & Spa Goa",        email:"reservations.goa@tajhotels.com",          phone:"+91-832-6650000",  destination:"Goa",              category:"Resort",       rating:4.9, status:"Active" },
 { id:"V002", name:"Grand Hyatt Goa",                     email:"reservations.goa@hyatt.com",              phone:"+91-832-2721234",  destination:"Goa",              category:"Hotel",        rating:4.7, status:"Active" },
 { id:"V003", name:"The Leela Goa Cavelossim Beach",      email:"reservations@theleela.com",               phone:"+91-832-6622222",  destination:"Goa",              category:"Resort",       rating:4.8, status:"Active" },
 { id:"V004", name:"Club Mahindra Varca Beach Goa",       email:"goa@clubmahindra.com",                    phone:"+91-832-2745555",  destination:"Goa",              category:"Resort",       rating:4.3, status:"Active" },
 { id:"V005", name:"Alila Diwa Goa",                      email:"diwa@alilahotels.com",                    phone:"+91-832-2746800",  destination:"Goa",              category:"Resort",       rating:4.7, status:"Active" },
 { id:"V006", name:"Thomas Cook India - Goa DMC",         email:"goa@thomascook.in",                       phone:"+91-832-2438000",  destination:"Goa",              category:"DMC",          rating:4.5, status:"Active" },
 // INDIA: KERALA
 { id:"V007", name:"Kumarakom Lake Resort Kerala",        email:"reservations@kumarakomlakeresort.com",    phone:"+91-481-2524900",  destination:"Kerala",           category:"Resort",       rating:4.9, status:"Active" },
 { id:"V008", name:"Coconut Lagoon CGH Earth Kumarakom",  email:"coconutlagoon@cghearth.com",              phone:"+91-481-2524491",  destination:"Kerala",           category:"Resort",       rating:4.8, status:"Active" },
 { id:"V009", name:"Spice Village CGH Earth Thekkady",    email:"spicevillage@cghearth.com",               phone:"+91-486-9222315",  destination:"Kerala",           category:"Resort",       rating:4.7, status:"Active" },
 { id:"V010", name:"Somatheeram Ayurvedic Health Resort", email:"info@somatheeram.in",                     phone:"+91-471-2268101",  destination:"Kerala",           category:"Resort",       rating:4.6, status:"Active" },
 { id:"V011", name:"Kerala Premium Houseboats Alleppey",  email:"bookings@keralahouseboats.net",           phone:"+91-477-2232444",  destination:"Kerala",           category:"Villa",        rating:4.7, status:"Active" },
 { id:"V012", name:"KTDC Kerala Tourism DMC",             email:"info@ktdc.com",                           phone:"+91-471-2330031",  destination:"Kerala",           category:"Tour Operator",rating:4.5, status:"Active" },
 // INDIA: KASHMIR
 { id:"V013", name:"The Lalit Grand Palace Srinagar",         email:"reservations.srinagar@thelalit.com",  phone:"+91-194-2501001",  destination:"Kashmir",          category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V014", name:"Houseboat New King Dal Lake Srinagar",    email:"bookings@newkingdalview.com",          phone:"+91-194-2422282",  destination:"Kashmir",          category:"Villa",        rating:4.5, status:"Active" },
 { id:"V015", name:"Hotel Highland Park Gulmarg",             email:"reservations@highlandparkgulmarg.com",phone:"+91-1954-254455",  destination:"Kashmir",          category:"Hotel",        rating:4.4, status:"Active" },
 { id:"V016", name:"Pahalgam Hotel Pahalgam Valley",          email:"reservations@hotelpahalgam.com",       phone:"+91-1936-243013",  destination:"Kashmir",          category:"Hotel",        rating:4.2, status:"Active" },
 { id:"V017", name:"Kashmir Himalayan Expedition Tours",      email:"info@kashmirhimalayan.com",            phone:"+91-194-2456789",  destination:"Kashmir",          category:"Tour Operator",rating:4.6, status:"Active" },
 // INDIA: RAJASTHAN
 { id:"V018", name:"Rambagh Palace Jaipur by Taj",        email:"rambagh.jaipur@tajhotels.com",            phone:"+91-141-2385700",  destination:"Rajasthan",        category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V019", name:"Umaid Bhawan Palace Jodhpur by Taj",  email:"umaidbhawan.jodhpur@tajhotels.com",       phone:"+91-291-2510101",  destination:"Rajasthan",        category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V020", name:"Taj Lake Palace Udaipur",             email:"lakepalace.udaipur@tajhotels.com",        phone:"+91-294-2428800",  destination:"Rajasthan",        category:"Hotel",        rating:5.0, status:"Active" },
 { id:"V021", name:"Suryagarh Jaisalmer Heritage Hotel",  email:"reservations@suryagarh.com",              phone:"+91-2992-269269",  destination:"Rajasthan",        category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V022", name:"RAAS Jodhpur Boutique Hotel",         email:"reservations@raasjodhpur.com",            phone:"+91-291-2636455",  destination:"Rajasthan",        category:"Hotel",        rating:4.7, status:"Active" },
 { id:"V023", name:"Heritage Hotels Rajasthan DMC",       email:"bookings@heritagehotelsrajasthan.com",    phone:"+91-141-2571741",  destination:"Rajasthan",        category:"DMC",          rating:4.6, status:"Active" },
 // INDIA: HIMACHAL PRADESH
 { id:"V024", name:"Wildflower Hall Shimla by Oberoi",    email:"reservations@oberoihotels.com",           phone:"+91-177-2648585",  destination:"Himachal Pradesh", category:"Resort",       rating:4.9, status:"Active" },
 { id:"V025", name:"Span Resort & Spa Manali",            email:"span@spanresorts.com",                    phone:"+91-1902-252138",  destination:"Himachal Pradesh", category:"Resort",       rating:4.5, status:"Active" },
 { id:"V026", name:"The Himalayan Manali by Taj",         email:"himalayan.manali@tajhotels.com",          phone:"+91-1902-252555",  destination:"Himachal Pradesh", category:"Hotel",        rating:4.7, status:"Active" },
 { id:"V027", name:"Club Mahindra Manali Resort",         email:"manali@clubmahindra.com",                 phone:"+91-1902-252341",  destination:"Himachal Pradesh", category:"Resort",       rating:4.3, status:"Active" },
 { id:"V028", name:"Solang Valley Resort Manali",         email:"info@solangvalleyresorts.com",            phone:"+91-1902-253333",  destination:"Himachal Pradesh", category:"Resort",       rating:4.4, status:"Active" },
 // INDIA: ANDAMAN
 { id:"V029", name:"Barefoot at Havelock Andaman",            email:"reservations@barefootindia.com",      phone:"+91-3192-282323",  destination:"Andaman Islands",  category:"Resort",       rating:4.8, status:"Active" },
 { id:"V030", name:"Fortune Resort Bay Island Port Blair",    email:"fortbay@fortunehotels.in",            phone:"+91-3192-234101",  destination:"Andaman Islands",  category:"Hotel",        rating:4.4, status:"Active" },
 { id:"V031", name:"Munjoh Ocean Resort Havelock Island",     email:"info@munjoh.com",                     phone:"+91-3192-282328",  destination:"Andaman Islands",  category:"Resort",       rating:4.6, status:"Active" },
 { id:"V032", name:"Symphony Palms Beach Resort Havelock",    email:"reservations@symphonypalms.com",      phone:"+91-3192-282526",  destination:"Andaman Islands",  category:"Resort",       rating:4.5, status:"Active" },
 { id:"V033", name:"Andaman & Nicobar Tourism",               email:"andaman.tourism@nic.in",              phone:"+91-3192-232747",  destination:"Andaman Islands",  category:"Tour Operator",rating:4.4, status:"Active" },
 // INDIA: LEH-LADAKH
 { id:"V034", name:"The Grand Dragon Ladakh Leh",             email:"reservations@granddragonladakh.com",  phone:"+91-1982-257786",  destination:"Leh-Ladakh",       category:"Hotel",        rating:4.7, status:"Active" },
 { id:"V035", name:"Hotel Ladakh Sarai Leh",                  email:"info@ladakhsarai.com",                phone:"+91-1982-251360",  destination:"Leh-Ladakh",       category:"Hotel",        rating:4.3, status:"Active" },
 { id:"V036", name:"Chamba Camp Thiksey Ladakh by Shakti",    email:"info@shaktihimalaya.com",             phone:"+91-11-41661000",  destination:"Leh-Ladakh",       category:"Villa",        rating:4.9, status:"Active" },
 { id:"V037", name:"Adventure Leh Ladakh Tours",              email:"info@adventureladakhtours.com",       phone:"+91-1982-250756",  destination:"Leh-Ladakh",       category:"Tour Operator",rating:4.6, status:"Active" },
 // INDIA: SOUTH INDIA
 { id:"V038", name:"Orange County Coorg Resort",          email:"reservations@orangecounty.in",            phone:"+91-8272-265100",  destination:"Coorg",            category:"Resort",       rating:4.8, status:"Active" },
 { id:"V039", name:"Club Mahindra Madikeri Coorg",        email:"madikeri@clubmahindra.com",               phone:"+91-8272-228889",  destination:"Coorg",            category:"Resort",       rating:4.3, status:"Active" },
 { id:"V040", name:"Windermere Estate Munnar",            email:"info@windermereresort.com",               phone:"+91-4865-230512",  destination:"Munnar",           category:"Resort",       rating:4.7, status:"Active" },
 { id:"V041", name:"Savoy Hotel Ooty by Taj",             email:"savoy.ooty@tajhotels.com",                phone:"+91-423-2244142",  destination:"Ooty",             category:"Hotel",        rating:4.5, status:"Active" },
 // INDIA: DELHI / AGRA
 { id:"V042", name:"The Imperial New Delhi",              email:"luxury@theimperialindia.com",             phone:"+91-11-23341234",  destination:"Delhi",            category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V043", name:"ITC Maurya New Delhi",                email:"itcmaurya@itchotels.in",                  phone:"+91-11-26112233",  destination:"Delhi",            category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V044", name:"The Oberoi Agra",                     email:"reservations.agra@oberoihotels.com",      phone:"+91-562-4011234",  destination:"Agra",             category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V045", name:"ITC Mughal Agra",                     email:"reservations.mughalagra@itchotels.com",   phone:"+91-562-4021700",  destination:"Agra",             category:"Hotel",        rating:4.7, status:"Active" },
 { id:"V046", name:"Cox & Kings India - Golden Triangle", email:"goldentriangle@coxandkings.com",          phone:"+91-11-23351722",  destination:"Delhi",            category:"Tour Operator",rating:4.7, status:"Active" },
 // INDIA: VARANASI / RISHIKESH
 { id:"V047", name:"Nadesar Palace Varanasi by Taj",      email:"nadesar.varanasi@tajhotels.com",          phone:"+91-542-6660000",  destination:"Varanasi",         category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V048", name:"Ananda in the Himalayas Rishikesh",   email:"sales@anandaspa.com",                     phone:"+91-1378-227500",  destination:"Rishikesh",        category:"Resort",       rating:4.9, status:"Active" },
 { id:"V049", name:"The Haveli Hari Ganga Haridwar",      email:"info@harganharidwar.com",                 phone:"+91-133-2226443",  destination:"Rishikesh",        category:"Hotel",        rating:4.4, status:"Active" },
 // INDIA: DARJEELING / SIKKIM
 { id:"V050", name:"Glenburn Tea Estate Darjeeling",      email:"info@glenburnteaestate.com",              phone:"+91-33-22883633",  destination:"Darjeeling",       category:"Resort",       rating:4.8, status:"Active" },
 { id:"V051", name:"Elgin Hotel Darjeeling Heritage",     email:"reservations@elginhotels.com",            phone:"+91-354-2257226",  destination:"Darjeeling",       category:"Hotel",        rating:4.4, status:"Active" },
 { id:"V052", name:"Sikkim Holiday Treks & Tours DMC",    email:"info@sikkimholidaytreks.com",             phone:"+91-3592-202681",  destination:"Darjeeling",       category:"Tour Operator",rating:4.5, status:"Active" },
 // INDIA: MUMBAI
 { id:"V053", name:"The Taj Mahal Palace Mumbai",         email:"tmhp.bom@tajhotels.com",                  phone:"+91-22-66653366",  destination:"Mumbai",           category:"Hotel",        rating:5.0, status:"Active" },
 { id:"V054", name:"The Oberoi Mumbai",                   email:"reservations.obm@oberoihotels.com",       phone:"+91-22-66325757",  destination:"Mumbai",           category:"Hotel",        rating:4.9, status:"Active" },
 // DUBAI
 { id:"V055", name:"Burj Al Arab Jumeirah Dubai",         email:"reservations@jumeirah.com",               phone:"+971-4-3017777",   destination:"Dubai",            category:"Hotel",        rating:5.0, status:"Active" },
 { id:"V056", name:"Atlantis The Palm Dubai",             email:"reservations@atlantisthepalm.com",        phone:"+971-4-4260000",   destination:"Dubai",            category:"Resort",       rating:4.8, status:"Active" },
 { id:"V057", name:"Jumeirah Beach Hotel Dubai",          email:"jbhreservations@jumeirah.com",            phone:"+971-4-3480000",   destination:"Dubai",            category:"Hotel",        rating:4.7, status:"Active" },
 { id:"V058", name:"Address Downtown Dubai",              email:"addressdowntown@addresshotels.com",       phone:"+971-4-4368888",   destination:"Dubai",            category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V059", name:"One&Only Royal Mirage Dubai",         email:"royalmirage@oneandonlyresorts.com",       phone:"+971-4-3999999",   destination:"Dubai",            category:"Resort",       rating:4.9, status:"Active" },
 { id:"V060", name:"Waldorf Astoria Dubai Palm Jumeirah", email:"wapj.reservations@waldorfastoria.com",    phone:"+971-4-8181000",   destination:"Dubai",            category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V061", name:"Arabian Adventures Dubai DMC",        email:"arabian.adventures@emiratesgroup.com",    phone:"+971-4-3034888",   destination:"Dubai",            category:"DMC",          rating:4.7, status:"Active" },
 // SINGAPORE
 { id:"V062", name:"Marina Bay Sands Singapore",          email:"reservations@marinabaysands.com",         phone:"+65-6688-8888",    destination:"Singapore",        category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V063", name:"Raffles Hotel Singapore",             email:"singapore@raffles.com",                   phone:"+65-6337-1886",    destination:"Singapore",        category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V064", name:"The Fullerton Hotel Singapore",       email:"info@fullertonhotel.com",                 phone:"+65-6733-8388",    destination:"Singapore",        category:"Hotel",        rating:4.7, status:"Active" },
 { id:"V065", name:"Capella Singapore Sentosa Island",    email:"singapore@capellahotels.com",             phone:"+65-6377-8888",    destination:"Singapore",        category:"Resort",       rating:4.9, status:"Active" },
 { id:"V066", name:"Mandarin Oriental Singapore",         email:"mosin-reservations@mohg.com",             phone:"+65-6338-0066",    destination:"Singapore",        category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V067", name:"Chan Brothers Travel Singapore DMC",  email:"info@chanbrothers.com.sg",                phone:"+65-6212-3000",    destination:"Singapore",        category:"DMC",          rating:4.6, status:"Active" },
 // MALDIVES
 { id:"V068", name:"Velaa Private Island Maldives",       email:"reservations@velaaprivateisland.com",     phone:"+960-660-3000",    destination:"Maldives",         category:"Villa",        rating:5.0, status:"Active" },
 { id:"V069", name:"Soneva Fushi Maldives",               email:"enquiries@soneva.com",                    phone:"+960-660-0304",    destination:"Maldives",         category:"Resort",       rating:5.0, status:"Active" },
 { id:"V070", name:"Anantara Veli Maldives Resort",       email:"veli@anantara.com",                       phone:"+960-664-4100",    destination:"Maldives",         category:"Resort",       rating:4.8, status:"Active" },
 { id:"V071", name:"Niyama Private Islands Maldives",     email:"discover@niyama.com",                     phone:"+960-676-0011",    destination:"Maldives",         category:"Resort",       rating:4.9, status:"Active" },
 { id:"V072", name:"LUX* South Ari Atoll Maldives",       email:"luxsaa@luxresorts.com",                   phone:"+960-668-0901",    destination:"Maldives",         category:"Resort",       rating:4.8, status:"Active" },
 { id:"V073", name:"Milaidhoo Island Maldives",           email:"info@milaidhoo.com",                      phone:"+960-528-2002",    destination:"Maldives",         category:"Resort",       rating:4.9, status:"Active" },
 { id:"V074", name:"Cheval Blanc Randheli Maldives",      email:"reservations.randheli@chevalblanc.com",   phone:"+960-656-1515",    destination:"Maldives",         category:"Villa",        rating:5.0, status:"Active" },
 { id:"V075", name:"Maldives Overwater Specialists DMC",  email:"bookings@maldivesspecialists.com",        phone:"+960-330-0999",    destination:"Maldives",         category:"DMC",          rating:4.7, status:"Active" },
 // MAURITIUS
 { id:"V076", name:"LUX* Le Morne Mauritius",             email:"luxmorne@luxresorts.com",                 phone:"+230-401-4000",    destination:"Mauritius",        category:"Resort",       rating:4.8, status:"Active" },
 { id:"V077", name:"The Oberoi Mauritius",                email:"reservations@oberoihotels.com",           phone:"+230-204-3600",    destination:"Mauritius",        category:"Resort",       rating:4.9, status:"Active" },
 { id:"V078", name:"Constance Belle Mare Plage Mauritius",email:"bellemareplage@constancehotels.com",      phone:"+230-402-2600",    destination:"Mauritius",        category:"Resort",       rating:4.8, status:"Active" },
 { id:"V079", name:"Shanti Maurice Wellness Resort",      email:"res@shantimaurice.com",                   phone:"+230-603-7200",    destination:"Mauritius",        category:"Resort",       rating:4.7, status:"Active" },
 { id:"V080", name:"Heritage Awali Golf & Spa Resort",    email:"awali@heritageresorts.mu",                phone:"+230-623-5500",    destination:"Mauritius",        category:"Resort",       rating:4.6, status:"Active" },
 { id:"V081", name:"Air Mauritius Holidays DMC",          email:"holidays@airmauritius.com",               phone:"+230-207-7575",    destination:"Mauritius",        category:"Tour Operator",rating:4.5, status:"Active" },
 // SRI LANKA
 { id:"V082", name:"Shangri-La Colombo Sri Lanka",        email:"slc@shangri-la.com",                      phone:"+94-11-788-5700",  destination:"Sri Lanka",        category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V083", name:"Anantara Peace Haven Tangalle",       email:"tangalle@anantara.com",                   phone:"+94-47-808-0800",  destination:"Sri Lanka",        category:"Resort",       rating:4.8, status:"Active" },
 { id:"V084", name:"Aman Amangalla Galle Fort",           email:"amangalla@aman.com",                      phone:"+94-91-223-3388",  destination:"Sri Lanka",        category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V085", name:"The Fortress Resort & Spa Galle",     email:"info@thefortress.lk",                     phone:"+94-91-438-9400",  destination:"Sri Lanka",        category:"Resort",       rating:4.7, status:"Active" },
 { id:"V086", name:"Wild Coast Tented Lodge Yala Safari", email:"wildcoast@resplendent.lk",                phone:"+94-115-300-700",  destination:"Sri Lanka",        category:"Villa",        rating:4.9, status:"Active" },
 { id:"V087", name:"Jetwing Travels Sri Lanka DMC",       email:"leisure@jetwing.net",                     phone:"+94-11-234-5700",  destination:"Sri Lanka",        category:"DMC",          rating:4.6, status:"Active" },
 // VIETNAM
 { id:"V088", name:"Four Seasons The Nam Hai Hoi An",     email:"hoian@fourseasons.com",                   phone:"+84-235-394-0000", destination:"Vietnam",          category:"Resort",       rating:4.9, status:"Active" },
 { id:"V089", name:"Anantara Hoi An Resort",              email:"hoian@anantara.com",                      phone:"+84-235-391-4555", destination:"Vietnam",          category:"Resort",       rating:4.7, status:"Active" },
 { id:"V090", name:"Park Hyatt Saigon Ho Chi Minh City",  email:"saigon.park@hyatt.com",                   phone:"+84-28-3824-1234", destination:"Vietnam",          category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V091", name:"Paradise Elegance Cruise Ha Long Bay",email:"info@paradisecruises.vn",                 phone:"+84-24-3942-4443", destination:"Vietnam",          category:"Villa",        rating:4.8, status:"Active" },
 { id:"V092", name:"La Siesta Premium Hoi An Hotel",      email:"reservation@lasiesta-hoian.com",          phone:"+84-235-391-5915", destination:"Vietnam",          category:"Hotel",        rating:4.6, status:"Active" },
 { id:"V093", name:"Destination Asia Vietnam DMC",        email:"vietnam@destination-asia.com",            phone:"+84-28-3925-2055", destination:"Vietnam",          category:"DMC",          rating:4.7, status:"Active" },
 // MALAYSIA
 { id:"V094", name:"The Ritz-Carlton Kuala Lumpur",       email:"rckl.reservations@ritzcarlton.com",       phone:"+60-3-2142-8000",  destination:"Malaysia",         category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V095", name:"The Datai Langkawi",                  email:"reservations@thedatai.com",               phone:"+60-4-952-4000",   destination:"Malaysia",         category:"Resort",       rating:5.0, status:"Active" },
 { id:"V096", name:"Mandarin Oriental Kuala Lumpur",      email:"mokul-reservations@mohg.com",             phone:"+60-3-2380-8888",  destination:"Malaysia",         category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V097", name:"Four Seasons Resort Langkawi",        email:"reservations.langkawi@fourseasons.com",   phone:"+60-4-950-8888",   destination:"Malaysia",         category:"Resort",       rating:4.9, status:"Active" },
 { id:"V098", name:"Shangri-La Rasa Sayang Penang",       email:"slrsp@shangri-la.com",                    phone:"+60-4-888-8888",   destination:"Malaysia",         category:"Resort",       rating:4.7, status:"Active" },
 { id:"V099", name:"Asian Overland Services Malaysia DMC",email:"info@asianoverland.com.my",               phone:"+60-3-4252-9100",  destination:"Malaysia",         category:"DMC",          rating:4.5, status:"Active" },
 // BALI
 { id:"V100", name:"Amandari Ubud Bali",                  email:"amandari@aman.com",                       phone:"+62-361-975333",   destination:"Bali",             category:"Resort",       rating:5.0, status:"Active" },
 { id:"V101", name:"Four Seasons Bali at Sayan Ubud",     email:"sayan.bali@fourseasons.com",              phone:"+62-361-977577",   destination:"Bali",             category:"Resort",       rating:4.9, status:"Active" },
 { id:"V102", name:"The Mulia Nusa Dua Bali",             email:"reservation@themulia.com",                phone:"+62-361-3017777",  destination:"Bali",             category:"Resort",       rating:4.9, status:"Active" },
 { id:"V103", name:"Alila Villas Uluwatu Bali",           email:"uluwatu@alilahotels.com",                 phone:"+62-361-848-2166", destination:"Bali",             category:"Villa",        rating:4.9, status:"Active" },
 { id:"V104", name:"COMO Shambhala Estate Ubud Bali",     email:"csebali@comohotels.com",                  phone:"+62-361-978888",   destination:"Bali",             category:"Resort",       rating:4.9, status:"Active" },
 { id:"V105", name:"Komaneka at Bisma Ubud Bali",         email:"reservation@komaneka.com",                phone:"+62-361-971933",   destination:"Bali",             category:"Resort",       rating:4.8, status:"Active" },
 { id:"V106", name:"Bali DMC - Discovery Destination Mgmt",email:"info@ddmbali.com",                       phone:"+62-361-754754",   destination:"Bali",             category:"DMC",          rating:4.7, status:"Active" },
 // EUROPE: PARIS
 { id:"V107", name:"Hotel Le Bristol Paris",              email:"resa@lebristolparis.com",                 phone:"+33-1-5343-4300",  destination:"Paris",            category:"Hotel",        rating:5.0, status:"Active" },
 { id:"V108", name:"Shangri-La Paris Eiffel Tower View",  email:"reservations.slpa@shangri-la.com",        phone:"+33-1-5367-1998",  destination:"Paris",            category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V109", name:"Le Meurice Paris Luxury Hotel",       email:"reservations@lemeurice.com",              phone:"+33-1-4458-1010",  destination:"Paris",            category:"Hotel",        rating:4.9, status:"Active" },
 // EUROPE: SWITZERLAND
 { id:"V110", name:"Victoria-Jungfrau Grand Hotel Interlaken",email:"welcome@victoria-jungfrau.ch",        phone:"+41-33-828-2828",  destination:"Switzerland",      category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V111", name:"Badrutt's Palace Hotel St. Moritz",   email:"info@badruttspalace.com",                 phone:"+41-81-837-1000",  destination:"Switzerland",      category:"Hotel",        rating:5.0, status:"Active" },
 { id:"V112", name:"The Dolder Grand Zurich",             email:"reservations@thedoldergrand.com",         phone:"+41-44-456-6000",  destination:"Switzerland",      category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V113", name:"Fairmont Le Montreux Palace",         email:"montreux@fairmont.com",                   phone:"+41-21-962-1212",  destination:"Switzerland",      category:"Hotel",        rating:4.7, status:"Active" },
 // EUROPE: ITALY
 { id:"V114", name:"Hotel Splendido Portofino Italy",     email:"reservations@hotelsplendido.com",         phone:"+39-0185-267801",  destination:"Italy",            category:"Hotel",        rating:5.0, status:"Active" },
 { id:"V115", name:"Four Seasons Hotel Firenze Florence", email:"firenze@fourseasons.com",                 phone:"+39-055-2626-1",   destination:"Italy",            category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V116", name:"Belmond Cipriani Venice",             email:"reservation.cipriani@belmond.com",        phone:"+39-041-240-801",  destination:"Italy",            category:"Hotel",        rating:5.0, status:"Active" },
 { id:"V117", name:"Rome Cavalieri Waldorf Astoria",      email:"romecavalieri.reservations@waldorfastoria.com",phone:"+39-06-35091",destination:"Italy",            category:"Hotel",        rating:4.8, status:"Active" },
 // EUROPE: GREECE
 { id:"V118", name:"Canaves Oia Suites Santorini",        email:"info@canaves.com",                        phone:"+30-22860-71453",  destination:"Greece",           category:"Villa",        rating:5.0, status:"Active" },
 { id:"V119", name:"Mystique Hotel Santorini",            email:"info@mystique.gr",                        phone:"+30-22860-71114",  destination:"Greece",           category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V120", name:"Bill & Coo Suites Mykonos",           email:"info@bill-coo-hotel.com",                 phone:"+30-22890-26292",  destination:"Greece",           category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V121", name:"Hotel Grande Bretagne Athens",        email:"sales.hgb@marriott.com",                  phone:"+30-210-333-0000", destination:"Greece",           category:"Hotel",        rating:4.8, status:"Active" },
 // EUROPE: SPAIN
 { id:"V122", name:"Mandarin Oriental Barcelona",         email:"mobcn-reservations@mohg.com",             phone:"+34-93-151-8888",  destination:"Spain",            category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V123", name:"Hotel Arts Barcelona Ritz-Carlton",   email:"reservations.barcelona@ritzcarlton.com",  phone:"+34-93-221-1000",  destination:"Spain",            category:"Hotel",        rating:4.8, status:"Active" },
 // EUROPE: LONDON
 { id:"V124", name:"The Langham London",                  email:"tllon.reservations@langhamhotels.com",    phone:"+44-20-7636-1000", destination:"London",           category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V125", name:"Rosewood London Holborn",             email:"enquiries.london@rosewoodhotels.com",     phone:"+44-20-7781-8888", destination:"London",           category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V126", name:"Claridge's Hotel London Mayfair",     email:"info@claridges.co.uk",                    phone:"+44-20-7629-8860", destination:"London",           category:"Hotel",        rating:5.0, status:"Active" },
 // EUROPE: TURKEY
 { id:"V127", name:"Mandarin Oriental Bosphorus Istanbul",email:"mobosph-reservations@mohg.com",           phone:"+90-212-232-2000", destination:"Turkey",           category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V128", name:"Argos in Cappadocia Cave Hotel",      email:"reservation@argosincappadocia.com",       phone:"+90-384-219-3130", destination:"Turkey",           category:"Hotel",        rating:4.8, status:"Active" },
 { id:"V129", name:"Museum Hotel Cappadocia",             email:"reservation@museumhotel.com.tr",          phone:"+90-384-219-2220", destination:"Turkey",           category:"Hotel",        rating:4.9, status:"Active" },
 // EUROPE: AMSTERDAM / PRAGUE
 { id:"V130", name:"Waldorf Astoria Amsterdam",           email:"waldorf.amsterdam@waldorfastoria.com",    phone:"+31-20-718-4600",  destination:"Amsterdam",        category:"Hotel",        rating:4.9, status:"Active" },
 { id:"V131", name:"Four Seasons Hotel Prague",           email:"prague@fourseasons.com",                  phone:"+420-221-427-000", destination:"Prague",           category:"Hotel",        rating:4.9, status:"Active" },
];

app.post("/api/seed/vendors", async (req, res) => {
 if (!supabase) return res.status(503).json({ error: "Supabase not configured" });
 try {
  // Upsert all vendors (insert or update if id already exists)
  const { data, error } = await supabase.from("vendors").upsert(PRESET_VENDORS, { onConflict:"id" }).select();
  if (error) return res.status(400).json({ error: error.message });
  // Upsert default settings
  await supabase.from("app_settings").upsert([
   { key:"markup",  value:{ star3:18, star4:22, transport:15, activities:20, hotel4star:22 } },
   { key:"company", value:{ name:"Safarnaama Holidays", email:"enquiry@SafarnaamaHolidays.com", phone:"+91-9999999999" } },
  ], { onConflict:"key" });
  res.json({ success:true, inserted: data?.length || PRESET_VENDORS.length, message:`${data?.length || PRESET_VENDORS.length} vendors seeded into Supabase` });
 } catch(err) {
  res.status(500).json({ error: err.message });
 }
});

// ────────────────────────────────────────────────────────────────────────────
// REFERENCE DATA — single endpoint, localStorage-cached in frontend
// Returns: destinations+cities, activities, room_types, airlines,
//          vehicle_types, meal_plans, flight_classes
// ────────────────────────────────────────────────────────────────────────────
app.get("/api/reference", async (req, res) => {
 if (!supabase) return res.status(503).json({ error: "Supabase not configured" });
 try {
  const [destRes, actRes, roomRes, airlineRes, vehicleRes, settingsRes, incRes, excRes, siRes, bedRes] = await Promise.all([
   db.from("destinations").select("name, cities").order("name"),
   db.from("activities").select("destination, name, type, description, duration, image_url").order("destination").order("sort_order"),
   db.from("room_types").select("name").order("sort_order"),
   db.from("airlines").select("name").order("sort_order"),
   db.from("vehicle_types").select("name").order("sort_order"),
   db.from("app_settings").select("value").eq("key", "biz_settings").single(),
   db.from("destination_inclusions").select("destination, text").order("destination").order("sort_order"),
   db.from("destination_exclusions").select("destination, text").order("destination").order("sort_order"),
   Promise.resolve(db.from("special_instructions").select("id, destination, tour_type, title, instruction").order("tour_type").order("sort_order")).catch(() => ({ data: [] })),
   Promise.resolve(db.from("bedding_types").select("id, name").order("sort_order")).catch(() => ({ data: [] })),
  ]);
  // Log any per-query errors to server console for diagnosis
  const qErrors = { destRes, actRes, roomRes, airlineRes, vehicleRes, incRes, excRes, siRes, bedRes };
  Object.entries(qErrors).forEach(([name, r]) => {
   if (r.error) console.error(`[/api/reference] ${name} error:`, r.error.message || r.error);
   else console.log(`[/api/reference] ${name}: ${(r.data||[]).length} rows`);
  });
  const biz = settingsRes.data?.value || {};
  const destinations_cities = {};
  (destRes.data || []).forEach(d => { destinations_cities[d.name] = d.cities || []; });
  const activities_by_destination = {};
  (actRes.data || []).forEach(a => {
   if (!activities_by_destination[a.destination]) activities_by_destination[a.destination] = [];
   activities_by_destination[a.destination].push(a.name);
  });
  // Full activity catalog (with descriptions) keyed by destination
  const activities_catalog = actRes.data || [];
  const inclusions_by_destination = {};
  (incRes.data || []).forEach(i => {
   if (!inclusions_by_destination[i.destination]) inclusions_by_destination[i.destination] = [];
   inclusions_by_destination[i.destination].push(i.text);
  });
  const exclusions_by_destination = {};
  (excRes.data || []).forEach(e => {
   if (!exclusions_by_destination[e.destination]) exclusions_by_destination[e.destination] = [];
   exclusions_by_destination[e.destination].push(e.text);
  });
  res.json({
   destinations:              (destRes.data    || []).map(d => d.name),
   destinations_cities,
   activities_catalog,
   activities_by_destination,
   inclusions_by_destination,
   exclusions_by_destination,
   special_instructions_catalog: siRes.data || [],
   bedding_types:             (bedRes.data    || []).map(b => b.name),
   room_types:                (roomRes.data    || []).map(r => r.name),
   airlines:                  (airlineRes.data || []).map(a => a.name),
   vehicle_types:             (vehicleRes.data || []).map(v => v.name),
   meal_plans:                biz.meal_plans    || ["Room Only","CP (Breakfast Only)","MAP (Breakfast + Dinner)","AP (All Meals)","All Inclusive"],
   flight_classes:            biz.flight_classes || ["Economy","Premium Economy","Business","First"],
  });
 } catch (err) {
  res.status(500).json({ error: err.message });
 }
});

// GET /api/reference/debug — shows raw query results + errors (remove after diagnosis)
app.get("/api/reference/debug", async (req, res) => {
 if (!supabase) return res.json({ supabase: false });
 const [destRes, roomRes, actRes] = await Promise.all([
  db.from("destinations").select("name").limit(3),
  db.from("room_types").select("name").limit(3),
  db.from("activities").select("destination, name").limit(3),
 ]);
 res.json({
  destinations: { count: (destRes.data||[]).length, error: destRes.error?.message, sample: destRes.data?.slice(0,2) },
  room_types:   { count: (roomRes.data||[]).length, error: roomRes.error?.message, sample: roomRes.data?.slice(0,2) },
  activities:   { count: (actRes.data||[]).length,  error: actRes.error?.message,  sample: actRes.data?.slice(0,2) },
 });
});

// POST /api/reference/inclusion — add an inclusion for a destination
app.post("/api/reference/inclusion", async (req, res) => {
 const { destination, text } = req.body;
 if (!text) return res.status(400).json({ error: "text is required" });
 const { data, error } = await db.from("destination_inclusions")
  .upsert({ destination, text }, { onConflict: "destination,text" })
  .select("id, destination, text")
  .single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});

// POST /api/reference/exclusion — add an exclusion for a destination
app.post("/api/reference/exclusion", async (req, res) => {
 const { destination, text } = req.body;
 if (!text) return res.status(400).json({ error: "text is required" });
 const { data, error } = await db.from("destination_exclusions")
  .upsert({ destination, text }, { onConflict: "destination,text" })
  .select("id, destination, text")
  .single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});

// POST /api/reference/special-instruction — save a new special instruction template
app.post("/api/reference/special-instruction", async (req, res) => {
 try {
  const { destination, tour_type, instruction } = req.body;
  if (!instruction?.trim()) return res.status(400).json({ error: "instruction text is required" });
  const norm = v => (!v || v === "") ? null : v;
  const autoTitle = instruction.trim().split(/[\n.]/)[0].slice(0, 80).trim();
  const { data, error } = await db.from("special_instructions")
   .insert({ destination: norm(destination), tour_type: tour_type || "General", title: autoTitle || null, instruction: instruction.trim() })
   .select("id, destination, tour_type, title, instruction")
   .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
 } catch (e) {
  console.error("[POST /api/reference/special-instruction]", e.message);
  res.status(500).json({ error: e.message });
 }
});

// GET /api/debug/special-instructions — verify table access and row count
app.get("/api/debug/special-instructions", async (req, res) => {
 const { data, error } = await db.from("special_instructions").select("id, destination, tour_type, title, instruction").order("id");
 if (error) return res.status(500).json({ ok: false, error: error.message });
 res.json({ ok: true, count: (data||[]).length, rows: data });
});

// GET /api/bedding-types — list all bedding types
app.get("/api/bedding-types", async (req, res) => {
 try {
  const { data, error } = await db.from("bedding_types").select("id, name").order("sort_order");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
 } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bedding-types — create a new bedding type
app.post("/api/bedding-types", async (req, res) => {
 try {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  const { data, error } = await db.from("bedding_types")
   .insert({ name: name.trim() })
   .select("id, name")
   .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
 } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/special-instructions — all templates (used directly by itinerary builder)
app.get("/api/special-instructions", async (req, res) => {
 try {
  const { data, error } = await db.from("special_instructions")
   .select("id, destination, tour_type, title, instruction")
   .order("tour_type").order("sort_order");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
 } catch (e) {
  res.status(500).json({ error: e.message });
 }
});

// PATCH /api/activities/description — save/update activity description in DB
// Updates ALL rows with that name (regardless of destination) so the description
// appears regardless of which destination context the user is in.
app.patch("/api/activities/description", async (req, res) => {
 const { name, description, destination } = req.body;
 if (!name || !description) return res.status(400).json({ error: "name and description are required" });
 // Update every activity row with this name
 const { data, error } = await db.from("activities").update({ description }).eq("name", name).select("id");
 if (error) return res.status(400).json({ error: error.message });
 if (!data?.length) {
  // Activity not in DB at all — insert using the destination sent from the client
  const { error: e2 } = await db.from("activities").insert({ destination: destination || "Global", name, description });
  if (e2) return res.status(400).json({ error: e2.message });
 }
 res.json({ ok: true, updated: data?.length || 0 });
});

// ────────────────────────────────────────────────────────────────────────────
// MEDIA LIBRARY
// ────────────────────────────────────────────────────────────────────────────

// GET /api/media — list all active media assets
// Query params: type, destination, category, vendor_name, featured, search
app.get("/api/media", async (req, res) => {
 const { type, destination, category, vendor_name, featured, search } = req.query;
 let q = db.from("media_library").select("*").eq("is_active", true);
 if (type)        q = q.eq("type", type);
 if (destination) q = q.eq("destination", destination);
 if (category)    q = q.eq("category", category);
 if (vendor_name) q = q.eq("vendor_name", vendor_name);
 if (featured === "true") q = q.eq("is_featured", true);
 if (search)      q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
 q = q.order("type").order("destination", { nullsLast: true }).order("sort_order");
 const { data, error } = await q;
 if (error) return res.status(500).json({ error: error.message });
 res.json(data || []);
});

// POST /api/media — upload a new media asset record
app.post("/api/media", async (req, res) => {
 const { title, type, category, destination, vendor_name, url, thumbnail_url, description, tags, format, source, is_featured } = req.body;
 if (!title || !type || !url) return res.status(400).json({ error: "title, type, and url are required" });
 // Normalise: empty strings → null so nullable columns stay clean
 const norm = v => (v === "" || v === undefined) ? null : v;
 const row = {
  title, type,
  category:     norm(category),
  destination:  norm(destination),
  vendor_name:  norm(vendor_name),
  url,
  thumbnail_url: norm(thumbnail_url),
  description:  norm(description),
  format:       norm(format) || "jpg",
  source:       norm(source) || "uploaded",
  is_featured:  !!is_featured,
  is_active:    true,
 };
 // Only include tags if explicitly provided — let DB default handle absence
 if (Array.isArray(tags)) row.tags = tags;
 const { data, error } = await db.from("media_library").insert(row).select("*").single();
 if (error) {
  console.error("[POST /api/media] Supabase error:", error);
  return res.status(400).json({ error: error.message, details: error.details, hint: error.hint });
 }
 res.status(201).json(data);
});

// PUT /api/media/:id — update a media asset
app.put("/api/media/:id", async (req, res) => {
 const allowed = ["title","category","destination","vendor_name","thumbnail_url","description","tags","is_featured","is_active","sort_order"];
 const updates = {};
 for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
 const { data, error } = await db.from("media_library").update(updates).eq("id", req.params.id).select("*").single();
 if (error) return res.status(400).json({ error: error.message });
 res.json(data);
});

// DELETE /api/media/:id — soft delete (set is_active = false)
app.delete("/api/media/:id", async (req, res) => {
 const { error } = await db.from("media_library").update({ is_active: false }).eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ────────────────────────────────────────────────────────────────────────────
app.get("/api/settings/:key", async (req, res) => {
 const { data } = await db.from("app_settings").select("value").eq("key", req.params.key).single();
 res.json(data?.value || {});
});
app.put("/api/settings/:key", async (req, res) => {
 const { error } = await db.from("app_settings").upsert({ key: req.params.key, value: req.body, updated_at: new Date() });
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
// ────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ────────────────────────────────────────────────────────────────────────────
app.get("/api/notifications", async (req, res) => {
 const { data } = await db.from("notifications").select("*").order("created_at", { ascending: false }).limit(30);
 res.json(data || []);
});
app.patch("/api/notifications/read-all", async (req, res) => {
 await db.from("notifications").update({ read: true }).eq("read", false);
 res.json({ success: true });
});
// ────────────────────────────────────────────────────────────────────────────
// GENERIC CLAUDE PROXY — used by all front-end AI features
// Keeps the Anthropic API key server-side; never exposed to the browser.
// ────────────────────────────────────────────────────────────────────────────
app.post("/api/ai/claude", async (req, res) => {
 const { prompt, system, maxTokens = 1500 } = req.body;
 if (!prompt) return res.status(400).json({ error: "prompt is required" });
 try {
  const text = await callClaude(prompt, system, maxTokens);
  res.json({ text });
 } catch (err) {
  console.error("Claude proxy error:", err.message);
  res.status(502).json({ error: err.message || "AI request failed" });
 }
});
// ────────────────────────────────────────────────────────────────────────────
// AI CHAT — Free-text assistant (invoice from chat, lead confirm, etc.)
// ────────────────────────────────────────────────────────────────────────────
app.post("/api/ai/chat", async (req, res) => {
 const { message, context } = req.body;
 const system = `You are a CRM assistant for Safarnaama Holidays. Context: ${JSON.stringify(context || {})}.
If user wants to confirm a lead, generate an invoice, or create a voucher, detect the intent and return:
{ "intent": "confirm_lead|generate_invoice|generate_voucher|general", "leadId": "...", "response": "..." }
Always return valid JSON.`;
 const result = await callClaude(message, system);
 try {
 const parsed = JSON.parse(result.replace(/```json|```/g, "").trim());
 res.json(parsed);
 } catch {
 res.json({ intent: "general", response: result });
 }
});
// ────────────────────────────────────────────────────────────────────────────
// EMAIL MODULE — IMAP (read) + SMTP (send)
// Primary storage: Supabase app_settings key "email_config"
// Fallback storage: backend/data/email_config.json (survives Supabase outages)
// Password is never returned to the frontend — write-only from UI perspective.
// ────────────────────────────────────────────────────────────────────────────
const EMAIL_CFG_FILE = path.join(__dirname, "data", "email_config.json");

function readEmailCfgFile() {
 try {
  if (!fs.existsSync(EMAIL_CFG_FILE)) return null;
  const raw = fs.readFileSync(EMAIL_CFG_FILE, "utf8");
  return JSON.parse(raw) || null;
 } catch { return null; }
}

function writeEmailCfgFile(cfg) {
 try {
  const dir = path.dirname(EMAIL_CFG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(EMAIL_CFG_FILE, JSON.stringify(cfg, null, 2), "utf8");
 } catch (e) { console.warn("[email-cfg-file] write failed:", e.message); }
}

async function getEmailCfg() {
 // Try Supabase first
 try {
  const { data, error } = await db.from("app_settings").select("value").eq("key", "email_config").limit(1);
  if (!error && data?.[0]?.value?.imap_host) {
   // Sync to file so fallback stays fresh
   writeEmailCfgFile(data[0].value);
   return data[0].value;
  }
  if (error) console.warn("[getEmailCfg] Supabase error:", error.message, "— trying file backup");
 } catch (e) { console.warn("[getEmailCfg] Supabase threw:", e.message, "— trying file backup"); }
 // Fallback: local file
 const fileCfg = readEmailCfgFile();
 if (fileCfg?.imap_host) { console.log("[getEmailCfg] loaded from file backup"); return fileCfg; }
 return null;
}

// ── NOTIFICATION CONFIG ────────────────────────────────────────────────────
// Only user preferences (phone, timeout, enabled) are in DB.
// Provider credentials live in .env — see NOTIF_PROVIDER / TWILIO_* / MSG91_* below.
async function getNotifCfg() {
 try {
  const { data } = await db.from("app_settings").select("value").eq("key","notif_config").limit(1);
  return data?.[0]?.value || {};
 } catch { return {}; }
}

async function getSchedCfg() {
 try {
  const { data } = await db.from("app_settings").select("value").eq("key","schedule_config").limit(1);
  return data?.[0]?.value || {};
 } catch { return {}; }
}

function getISTHour() {
 const now = new Date();
 // IST = UTC + 5:30 = 330 minutes
 const istMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % (24 * 60);
 return istMinutes / 60; // fractional hour in IST
}

function isWithinCheckWindow(schedCfg) {
 if (!schedCfg?.window_enabled) return true; // no window = always run
 const start = Number(schedCfg.start_hour ?? 9);
 const end   = Number(schedCfg.end_hour   ?? 19);
 const h = getISTHour();
 return h >= start && h < end;
}

// Notification credentials come from .env only — never stored in DB or sent to frontend
const NOTIF_PROVIDER      = (process.env.NOTIF_PROVIDER      || "none").toLowerCase();
const MSG91_AUTHKEY        =  process.env.MSG91_AUTHKEY       || "";
const MSG91_SENDER         =  process.env.MSG91_SENDER_ID     || "SAFARN";
const MSG91_WA_NUMBER      =  process.env.MSG91_WA_INTEGRATED_NUMBER || "";
const MSG91_WA_TPL         =  process.env.MSG91_WA_TEMPLATE_ID || "";
const FAST2SMS_KEY         =  process.env.FAST2SMS_API_KEY    || "";

async function sendNotification(notifCfg, message) {
 if (!notifCfg?.enabled) return;
 const phone = (notifCfg.phone || "").trim().replace(/^\+91/, ""); // MSG91/Fast2SMS expect 10-digit
 if (!phone) return;
 if (NOTIF_PROVIDER === "none") { console.log("[notif] provider=none — skipping:", message.slice(0,60)); return; }

 if (NOTIF_PROVIDER === "msg91") {
  const channel = notifCfg.channel || "sms";
  // WhatsApp via MSG91 — requires WhatsApp Business API approval + approved template
  if (channel === "whatsapp" && MSG91_WA_NUMBER && MSG91_WA_TPL && MSG91_AUTHKEY) {
   try {
    await axios.post(
     "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
     {
      integrated_number: MSG91_WA_NUMBER,
      message_type: "HSM",
      to: [{ user_whatsapp_number: "91" + phone, template_id: MSG91_WA_TPL, body_values: { "1": message } }]
     },
     { headers: { authkey: MSG91_AUTHKEY, "Content-Type": "application/json" }, timeout: 12000 }
    );
    console.log("[notif] MSG91 WhatsApp sent to", phone);
   } catch (e) {
    console.warn("[notif] MSG91 WhatsApp failed, falling back to SMS:", e.response?.data?.message || e.message);
    channel === "whatsapp" && await _msg91Sms(phone, message); // fallback
   }
  } else {
   await _msg91Sms(phone, message);
  }

 } else if (NOTIF_PROVIDER === "fast2sms") {
  if (!FAST2SMS_KEY) { console.warn("[notif] FAST2SMS_API_KEY not set"); return; }
  try {
   await axios.post(
    "https://www.fast2sms.com/dev/bulkV2",
    { route: "q", message, language: "english", flash: 0, numbers: phone },
    { headers: { authorization: FAST2SMS_KEY }, timeout: 12000 }
   );
   console.log("[notif] Fast2SMS sent to", phone);
  } catch (e) { console.warn("[notif] Fast2SMS error:", e.response?.data?.message || e.message); }
 }
}

async function _msg91Sms(phone, message) {
 if (!MSG91_AUTHKEY) { console.warn("[notif] MSG91_AUTHKEY not set"); return; }
 try {
  const resp = await axios.post(
   "https://api.msg91.com/api/v5/flow/",
   { template_id: "", sender: MSG91_SENDER, short_url: "0", mobiles: "91" + phone, VAR1: message },
   { headers: { authkey: MSG91_AUTHKEY, "Content-Type": "application/json" }, timeout: 12000 }
  );
  // v5 flow API needs a template; fall back to legacy sendhttp if no template configured
  if (resp.data?.type === "error") throw new Error(resp.data.message);
  console.log("[notif] MSG91 SMS sent to", phone);
 } catch {
  // Legacy transactional SMS API (works without flow template)
  try {
   await axios.get("https://api.msg91.com/api/sendhttp.php", {
    params: { authkey: MSG91_AUTHKEY, mobiles: "91" + phone, message, sender: MSG91_SENDER, route: 4, country: 91 },
    timeout: 12000
   });
   console.log("[notif] MSG91 SMS (legacy) sent to", phone);
  } catch (e2) { console.warn("[notif] MSG91 SMS error:", e2.message); }
 }
}

async function checkVendorTimeouts() {
 const notifCfg = await getNotifCfg();
 if (!notifCfg?.enabled) return;
 const hours  = Number(notifCfg.timeout_hours) || 3;
 const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
 const { data } = await db.from("vendor_requests")
  .select("id,vendor_name,vendor_email,destination,lead_name,sent_at")
  .eq("status","sent")
  .lt("sent_at", cutoff)
  .is("notif_sent_at", null);
 for (const vr of data || []) {
  const msg = `⚠️ No vendor reply after ${hours}h: ${vr.vendor_name||vr.vendor_email} | ${vr.destination||""} for ${vr.lead_name||""} [${vr.id}]`;
  await sendNotification(notifCfg, msg);
  await db.from("vendor_requests").update({ notif_sent_at: new Date(), updated_at: new Date() }).eq("id", vr.id);
 }
}
// ──────────────────────────────────────────────────────────────────────────────

async function saveEmailCfg(body) {
 // Step 1: Write to local file (instant, offline-safe)
 let fileOk = false;
 try {
  const dir = path.dirname(EMAIL_CFG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(EMAIL_CFG_FILE, JSON.stringify(body, null, 2), "utf8");
  fileOk = true;
  console.log("[saveEmailCfg] written to file backup");
 } catch (e) { console.warn("[saveEmailCfg] file write failed:", e.message); }

 // Step 2: Persist to Supabase with three fallback strategies
 if (!supabase) {
  const msg = "Supabase not configured — add SUPABASE_URL and SUPABASE_SERVICE_KEY to backend/.env";
  console.warn("[saveEmailCfg]", msg);
  return { fileOk, dbOk: false, dbError: msg };
 }
 try {
  const ts = new Date().toISOString();
  const row = { key: "email_config", value: body, updated_at: ts };
  let dbErr = null;

  // Strategy A: upsert (fastest)
  { const { error } = await supabase.from("app_settings").upsert(row, { onConflict: "key" }); dbErr = error || null; }
  if (dbErr) {
   console.warn("[saveEmailCfg] upsert failed:", dbErr.message, "— trying update");
   // Strategy B: explicit UPDATE (row already exists case)
   const { error: updErr } = await supabase.from("app_settings")
    .update({ value: body, updated_at: ts }).eq("key", "email_config");
   dbErr = updErr || null;
  }
  if (dbErr) {
   console.warn("[saveEmailCfg] update failed:", dbErr.message, "— trying delete+insert");
   // Strategy C: delete then insert (handles all edge cases)
   await supabase.from("app_settings").delete().eq("key", "email_config");
   const { error: insErr } = await supabase.from("app_settings").insert(row);
   dbErr = insErr || null;
  }
  if (dbErr) throw new Error(dbErr.message);

  // Verify the row is actually readable
  const { data: chk } = await supabase.from("app_settings")
   .select("value").eq("key", "email_config").limit(1);
  if (!chk?.[0]?.value) {
   throw new Error("Saved but row not readable — check Supabase RLS (disable RLS on app_settings or add a service_role policy)");
  }

  console.log("[saveEmailCfg] ✓ saved and verified in Supabase");
  return { fileOk, dbOk: true };
 } catch (e) {
  console.error("[saveEmailCfg] all DB strategies failed:", e.message);
  return { fileOk, dbOk: false, dbError: e.message };
 }
}

function buildSmtpTransport(cfg) {
 const port   = Number(cfg.smtp_port) || 465;
 const secure = [true, "true", 1, "1"].includes(cfg.smtp_ssl);
 return nodemailer.createTransport({
  host: cfg.smtp_host || cfg.imap_host,
  port,
  secure,
  auth: { user: cfg.username, pass: cfg.password },
  tls: { rejectUnauthorized: false },
  connectionTimeout: 10000,
  greetingTimeout:   8000,
  socketTimeout:     15000,
 });
}

function buildImapClient(cfg) {
 return new ImapFlow({
  host: cfg.imap_host,
  port: Number(cfg.imap_port) || 993,
  secure: cfg.imap_ssl !== false,
  auth: { user: cfg.username, pass: cfg.password },
  tls: { rejectUnauthorized: false },
  connectionTimeout: 10000,
  greetingTimeout: 8000,
  socketTimeout: 20000,
  logger: false,
 });
}

// GET /api/email/config — returns config without password
app.get("/api/email/config", async (req, res) => {
 try {
  const cfg = await getEmailCfg();
  if (!cfg) return res.json({ configured: false });
  const { password, ...safe } = cfg;
  res.json({ ...safe, configured: true, passwordSet: !!password });
 } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/debug/email — diagnostic: shows DB + email config state + SMTP test
app.get("/api/debug/email", async (req, res) => {
 const net = require("net");
 const steps = [];
 steps.push({ step: "sendgrid", ok: !!SENDGRID_KEY?.startsWith("SG."), detail: SENDGRID_KEY?.startsWith("SG.") ? "SENDGRID_API_KEY is set ✓ — emails will use SendGrid" : "SENDGRID_API_KEY NOT set — will fall back to SMTP" });
 steps.push({ step: "supabase_env", ok: !!supabase, detail: supabase ? "SUPABASE_URL and key set" : "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env" });
 if (supabase) {
  try {
   const { data, error } = await supabase.from("app_settings").select("key").limit(5);
   if (error) steps.push({ step: "app_settings_read", ok: false, detail: error.message });
   else steps.push({ step: "app_settings_read", ok: true, detail: `table OK — rows: ${(data||[]).map(r=>r.key).join(", ")||"(empty)"}` });
  } catch (e) { steps.push({ step: "app_settings_read", ok: false, detail: e.message }); }
 }
 steps.push({ step: "file_backup", ok: fs.existsSync(EMAIL_CFG_FILE), detail: fs.existsSync(EMAIL_CFG_FILE) ? EMAIL_CFG_FILE : "No file backup" });
 const cfg = await getEmailCfg();
 steps.push({ step: "email_config", ok: !!cfg, detail: cfg ? `smtp=${cfg.smtp_host||"(blank)"}:${cfg.smtp_port} imap=${cfg.imap_host||"(blank)"}:${cfg.imap_port} user=${cfg.username||"(blank)"} password=${cfg.password?"SET":"MISSING"}` : "No config found — save in Settings → Email" });
 // Quick TCP test to SMTP
 if (cfg?.smtp_host) {
  const tcpOk = await new Promise(resolve => {
   const s = net.createConnection({ host: cfg.smtp_host, port: Number(cfg.smtp_port)||465 });
   s.setTimeout(5000);
   s.on("connect", () => { s.destroy(); resolve(true); });
   s.on("timeout", () => { s.destroy(); resolve(false); });
   s.on("error",   () => { s.destroy(); resolve(false); });
  });
  steps.push({ step: "smtp_tcp", ok: tcpOk, detail: tcpOk ? `${cfg.smtp_host}:${cfg.smtp_port} reachable` : `${cfg.smtp_host}:${cfg.smtp_port} NOT reachable from Railway — GoDaddy may block cloud IPs. Try port 587 or use SendGrid.` });
 }
 res.json({ steps });
});

// PUT /api/email/config — save (preserves existing password if not changed)
app.put("/api/email/config", async (req, res) => {
 try {
  const existing = await getEmailCfg();
  const body = { ...req.body };
  // Preserve existing password if blank/placeholder sent
  if (!body.password || body.password.startsWith("●") || body.password === "********") {
   body.password = existing?.password || "";
  }
  if (!body.password) return res.status(400).json({ error: "Password is required — enter your email account password" });

  console.log("[email-config] saving for:", body.username || "(no username)");
  const result = await saveEmailCfg(body);

  if (result.dbOk) {
   // Saved to both Supabase and file — fully persistent
   return res.json({ success: true });
  }
  if (result.fileOk && !result.dbOk) {
   // Saved to file only — will survive this session but not a fresh deploy
   return res.status(207).json({
    success: true,
    warning: `Config saved locally but NOT in database. On next backend restart it may be lost. DB error: ${result.dbError||"Supabase not configured"}. Fix: check Settings → Email, re-enter password and save again after fixing DB.`,
   });
  }
  // Both failed
  return res.status(500).json({ error: `Save failed — file: ${result.fileOk?"ok":"failed"}, DB: ${result.dbError||"not configured"}` });
 } catch (e) {
  console.error("[email-config] unexpected error:", e.message);
  res.status(500).json({ error: e.message });
 }
});

// POST /api/email/test — test IMAP connection with phased diagnostics
app.post("/api/email/test", async (req, res) => {
 const net = require("net");
 const cfg = await getEmailCfg();
 if (!cfg?.imap_host) return res.status(400).json({ error: "IMAP host not configured" });
 if (!cfg?.password)  return res.status(400).json({ error: "Password not saved — re-enter password and click Save Configuration first" });

 // Phase 1: TCP reachability
 const tcpOk = await new Promise(resolve => {
  const sock = net.createConnection({ host: cfg.imap_host, port: Number(cfg.imap_port)||993 });
  sock.setTimeout(8000);
  sock.on("connect", () => { sock.destroy(); resolve(true); });
  sock.on("timeout", () => { sock.destroy(); resolve(false); });
  sock.on("error",   () => { sock.destroy(); resolve(false); });
 });
 if (!tcpOk) return res.status(400).json({ error: `Cannot reach ${cfg.imap_host}:${cfg.imap_port||993} — host unreachable or port blocked by firewall` });

 // Phase 2: IMAP auth
 try {
  const client = buildImapClient(cfg);
  await client.connect();
  const status = await client.status("INBOX", { messages: true, unseen: true });
  await client.logout();
  res.json({ success: true, messages: status.messages, unseen: status.unseen });
 } catch (e) {
  console.error("[email-test-imap]", e.message, e.responseText || "");
  const detail = e.responseText || e.serverResponse || "";
  res.status(400).json({ error: `TCP OK but IMAP failed: ${e.message}${detail ? " — " + detail : ""}` });
 }
});

// GET /api/email/folders — list IMAP folders (helps identify Sent folder name)
app.get("/api/email/folders", async (req, res) => {
 try {
  const cfg = await getEmailCfg();
  if (!cfg?.password) return res.status(400).json({ error: "Email not configured" });
  const client = buildImapClient(cfg);
  await client.connect();
  const list = await client.list();
  await client.logout();
  res.json(list.map(f => ({ path: f.path, delimiter: f.delimiter, flags: [...(f.flags||[])] })));
 } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/email/fetch — fetch email list (headers only) for a lead email address
app.post("/api/email/fetch", async (req, res) => {
 try {
  const { emailAddress } = req.body;
  if (!emailAddress) return res.status(400).json({ error: "emailAddress required" });
  const cfg = await getEmailCfg();
  if (!cfg?.password) return res.status(400).json({ error: "Email not configured" });

  const emails = [];
  const client = buildImapClient(cfg);
  await client.connect();

  // Search INBOX (both directions)
  try {
   const lock = await client.getMailboxLock("INBOX");
   try {
    const uids = await client.search({ or: [{ from: emailAddress }, { to: emailAddress }] }, { uid: true });
    if (uids.length > 0) {
     for await (const msg of client.fetch(uids.slice(-60), { uid: true, flags: true, envelope: true }, { uid: true })) {
      emails.push({
       uid: msg.uid,
       folder: "INBOX",
       messageId: msg.envelope.messageId,
       from: msg.envelope.from?.[0] || null,
       to: msg.envelope.to || [],
       subject: msg.envelope.subject || "(No Subject)",
       date: msg.envelope.date,
       seen: msg.flags.has("\\Seen"),
       direction: (msg.envelope.from?.[0]?.address || "").toLowerCase() === cfg.username.toLowerCase() ? "sent" : "received",
      });
     }
    }
   } finally { lock.release(); }
  } catch (_) {}

  // Search Sent folder
  const sentFolder = cfg.sent_folder || "Sent";
  try {
   const lock2 = await client.getMailboxLock(sentFolder);
   try {
    const uids2 = await client.search({ to: emailAddress }, { uid: true });
    if (uids2.length > 0) {
     for await (const msg of client.fetch(uids2.slice(-60), { uid: true, flags: true, envelope: true }, { uid: true })) {
      if (!emails.some(e => e.messageId === msg.envelope.messageId)) {
       emails.push({
        uid: msg.uid,
        folder: sentFolder,
        messageId: msg.envelope.messageId,
        from: msg.envelope.from?.[0] || null,
        to: msg.envelope.to || [],
        subject: msg.envelope.subject || "(No Subject)",
        date: msg.envelope.date,
        seen: true,
        direction: "sent",
       });
      }
     }
    }
   } finally { lock2.release(); }
  } catch (_) {}

  await client.logout();
  emails.sort((a, b) => new Date(a.date) - new Date(b.date));
  res.json(emails);
 } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/email/body — fetch full body of a single email (marks as read)
app.post("/api/email/body", async (req, res) => {
 try {
  const { uid, folder = "INBOX" } = req.body;
  if (!uid) return res.status(400).json({ error: "uid required" });
  const cfg = await getEmailCfg();
  if (!cfg?.password) return res.status(400).json({ error: "Email not configured" });

  const client = buildImapClient(cfg);
  await client.connect();
  const lock = await client.getMailboxLock(folder);
  let result = null;
  try {
   const { content } = await client.download(uid, undefined, { uid: true });
   const chunks = [];
   for await (const chunk of content) chunks.push(chunk);
   const parsed = await simpleParser(Buffer.concat(chunks));
   await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });
   result = {
    html: parsed.html || null,
    text: parsed.text || null,
    attachments: (parsed.attachments || []).map(a => ({
     filename: a.filename, size: a.size, contentType: a.contentType,
    })),
   };
  } finally { lock.release(); }
  await client.logout();
  res.json(result);
 } catch (e) { res.status(500).json({ error: e.message }); }
});

// Extract data: URLs from HTML and replace with CID inline attachments for email clients
function extractCidImages(html) {
 const cidAttachments = [];
 let idx = 0;
 const out = html.replace(/src="data:([^;]+);base64,([^"]{1,5000000})"/g, (_, mime, b64) => {
  const cid = `img${idx++}@safarnaama`;
  const ext = mime.split("/")[1]?.replace("jpeg","jpg") || "jpg";
  cidAttachments.push({ cid, content: Buffer.from(b64, "base64"), contentType: mime, filename: `img${idx}.${ext}` });
  return `src="cid:${cid}"`;
 });
 return { html: out, cidAttachments };
}

// POST /api/email/send
app.post("/api/email/send", async (req, res) => {
 try {
  const { to, subject, body, html, inReplyTo, references, attachments } = req.body;
  if (!to || !subject) return res.status(400).json({ error: "to and subject required" });

  const useSendGrid = SENDGRID_KEY?.startsWith("SG.");
  const cfg = await getEmailCfg();
  if (!useSendGrid && !cfg?.password) return res.status(400).json({ error: "Email not configured — add SendGrid key or configure SMTP in Settings" });

  let finalHtml = html || body || "";
  const fileAttachments = Array.isArray(attachments) ? attachments.map(a => ({
   filename: a.filename,
   content: Buffer.from(a.content, "base64"),
   contentType: a.contentType || "application/octet-stream",
  })) : [];

  // ── SendGrid path (fast, no SMTP, no CID conversion needed) ──────────────
  if (useSendGrid) {
   const fromEmail = cfg?.username || ENQUIRY_EMAIL;
   const fromName  = cfg?.from_name || "Safarnaama Holidays";
   const sgMsg = {
    from: { email: fromEmail, name: fromName },
    to, subject,
    text: body || subject,
    html: finalHtml || body || subject,
   };
   if (fileAttachments.length) {
    sgMsg.attachments = fileAttachments.map(a => ({
     filename: a.filename,
     content: a.content.toString("base64"),
     type: a.contentType,
     disposition: "attachment",
    }));
   }
   await sgMail.send(sgMsg);
   console.log("[email-send] SendGrid → to:", to);
   return res.json({ success: true });
  }

  // ── SMTP path (with CID image conversion + IMAP Sent copy) ───────────────
  let cidAttachments = [];
  if (finalHtml.includes("data:")) {
   const extracted = extractCidImages(finalHtml);
   finalHtml = extracted.html;
   cidAttachments = extracted.cidAttachments;
  }
  const mail = {
   from: cfg.from_name ? `"${cfg.from_name}" <${cfg.username}>` : cfg.username,
   to, subject,
   text: body || "",
   html: finalHtml,
  };
  if (inReplyTo)  mail.inReplyTo  = inReplyTo;
  if (references) mail.references = references;
  if (cidAttachments.length || fileAttachments.length) {
   mail.attachments = [...cidAttachments, ...fileAttachments];
  }
  const transporter = buildSmtpTransport(cfg);
  await transporter.sendMail(mail);
  console.log("[email-send] SMTP → to:", to);

  // Respond immediately, save to Sent folder in background
  res.json({ success: true });
  (async () => {
   try {
    const stream = nodemailer.createTransport({ streamTransport: true, newline: "unix" });
    const info = await stream.sendMail({ ...mail });
    const chunks = [];
    for await (const chunk of info.message) chunks.push(chunk);
    const rawMessage = Buffer.concat(chunks);
    const imap = buildImapClient(cfg);
    await imap.connect();
    await imap.append(cfg.sent_folder || "Sent", rawMessage, ["\\Seen"]);
    await imap.logout();
   } catch (e) { console.warn("[email-send] Sent folder append failed:", e.message); }
  })();

 } catch (e) {
  console.error("[email-send]", e.message);
  res.status(500).json({ error: e.message });
 }
});

// ─── VENDOR REQUESTS ─────────────────────────────────────────────────────────

// Currency symbols/codes — order matters (longer codes first to avoid prefix collisions)
const CURRENCY_RE = "(?:" + [
 // Codes
 "inr","usd","eur","gbp","sgd","aed","thb","cad","aud","myr","jpy",
 "vnd","idr","hkd","nzd","lkr","npr","bdt","zar","bhd","qar","omr","sar","czk",
 // Symbols
 "₹","₫","\\$","€","£","฿","¥","Rp","Rs\\.?",
].join("|") + ")";
const NUM_RE = "([0-9]{2,}(?:[,\\.0-9]*)?(?:\\.[0-9]{1,2})?)";

function cleanNum(s) { return parseFloat(String(s).replace(/,/g, "")); }

function extractPrices(text) {
 if (!text) return [];
 const prices = new Set();
 const t = text.replace(/\r\n/g, "\n");

 const pats = [
  // Currency before number: ₹45,000  $1,200  INR 45000  USD 1200  VND 500000
  new RegExp(`${CURRENCY_RE}\\s*${NUM_RE}`, "gi"),
  // Number before currency: 45000 INR  1200 USD  500000 VND  45,000 ₹
  new RegExp(`${NUM_RE}\\s*${CURRENCY_RE}`, "gi"),
  // Indian /- notation: 1500/-  ₹45,000/-  45000/-  (with or without currency prefix)
  new RegExp(`(?:${CURRENCY_RE}\\s*)?${NUM_RE}\\s*\\/\\-`, "gi"),
  // Keyword + optional currency + number: "Total: 45000"  "Price: $1200"  "Rate: VND 500000"
  new RegExp(`(?:total|grand\\s*total|package\\s*(?:cost|price|rate)?|amount|cost|rate|net\\s*rate|price|quote|fare|per\\s*pax|per\\s*person|per\\s*adult|per\\s*head)\\s*[:\\-]?\\s*(?:${CURRENCY_RE})?\\s*${NUM_RE}`, "gi"),
 ];

 for (const p of pats) {
  p.lastIndex = 0;
  let m;
  while ((m = p.exec(t)) !== null) {
   // Last capture group is always the number (CURRENCY_RE groups are non-capturing)
   const raw = m[m.length - 1]; // works regardless of how many optional groups matched
   const v = cleanNum(raw);
   if (Number.isFinite(v) && v >= 100 && v <= 99_999_999) prices.add(v);
  }
 }
 return [...prices].sort((a, b) => b - a);
}

function detectCurrency(text) {
 if (!text) return "INR";
 const t = text.slice(0, 2000);
 if (/₹|(?<!\w)inr(?!\w)|(?<!\w)rs\.?(?!\w)/i.test(t)) return "INR";
 if (/₫|(?<!\w)vnd(?!\w)|(?<!\w)dong(?!\w)/i.test(t)) return "VND";
 if (/(?<!\w)usd(?!\w)|us\$|\$(?![0-9]*\s*(?:sgd|cad|aud))/i.test(t)) return "USD";
 if (/€|(?<!\w)eur(?!\w)/i.test(t)) return "EUR";
 if (/£|(?<!\w)gbp(?!\w)/i.test(t)) return "GBP";
 if (/(?<!\w)sgd(?!\w)|s\$/i.test(t)) return "SGD";
 if (/(?<!\w)aed(?!\w)|(?<!\w)dh(?!\w)/i.test(t)) return "AED";
 if (/฿|(?<!\w)thb(?!\w)|(?<!\w)baht(?!\w)/i.test(t)) return "THB";
 if (/(?<!\w)cad(?!\w)/i.test(t)) return "CAD";
 if (/(?<!\w)aud(?!\w)/i.test(t)) return "AUD";
 if (/(?<!\w)myr(?!\w)|(?<!\w)rm(?!\w)/i.test(t)) return "MYR";
 if (/¥|(?<!\w)jpy(?!\w)/i.test(t)) return "JPY";
 if (/(?<!\w)hkd(?!\w)/i.test(t)) return "HKD";
 if (/(?<!\w)lkr(?!\w)/i.test(t)) return "LKR";
 if (/(?<!\w)nrp?(?!\w)/i.test(t)) return "NPR";
 if (/(?<!\w)bdt(?!\w)/i.test(t)) return "BDT";
 if (/(?<!\w)sar(?!\w)/i.test(t)) return "SAR";
 if (/(?<!\w)qar(?!\w)/i.test(t)) return "QAR";
 if (/(?<!\w)omr(?!\w)/i.test(t)) return "OMR";
 if (/(?<!\w)bhd(?!\w)/i.test(t)) return "BHD";
 return "INR"; // default for travel CRM
}

// Replace vendor prices in email body with markup-applied final prices.
// Handles: "466 /-", "*466 /-", "₹466", "USD 466", "466 VND", "466 per pax"
function applyMarkupToBody(text, pricedItems, currency) {
 let result = text;
 const sortedItems = [...pricedItems].sort((a, b) => b.vendorPrice - a.vendorPrice);
 for (const { vendorPrice, finalPrice } of sortedItems) {
  if (vendorPrice === finalPrice) continue;
  const numPat = String(vendorPrice).replace(/(\d)(?=(\d{3})+$)/g, "$1,?");
  const fmtFinal = currency === "INR"
   ? Number(finalPrice).toLocaleString("en-IN")
   : Number(finalPrice).toLocaleString();
  // /- notation: 466/-, *466 /-, ₹466/- — lookbehind just "not a digit"
  result = result.replace(new RegExp(`(?<!\\d)${numPat}(?:\\.00)?(?=\\s*\\/)`, "gi"), fmtFinal);
  // Currency before number: ₹466, $466, USD 466, VND 500000
  result = result.replace(new RegExp(`(${CURRENCY_RE}\\s*)${numPat}(?!\\.?\\d)`, "gi"), (_, pfx) => pfx + fmtFinal);
  // Number before currency: 466 USD, 500000 VND
  result = result.replace(new RegExp(`(?<!\\d)${numPat}(?:\\.00)?(?=\\s*${CURRENCY_RE}(?!\\w))`, "gi"), fmtFinal);
  // Per-pax prices: "466 per person", "466 per pax", "466/pp"
  result = result.replace(new RegExp(`(?<!\\d)${numPat}(?:\\.00)?(?=\\s*(?:per\\b|\\/pax\\b|\\/pp\\b))`, "gi"), fmtFinal);
 }
 return result;
}

// Extract prices with category labels by scanning surrounding text context
const PRICE_CATEGORIES = [
 { label: "Hotel",        re: /hotel|resort|villa|property|accommodation|room|stay|lodge/i },
 { label: "Land Package", re: /land\s*(?:package|cost|rate)?|ground\s*(?:package|cost|transfer)?|sightseeing|excursion|activity|tour\s*(?:cost|rate|price)?|transfer/i },
 { label: "Flights",      re: /flight|airfare|air\s*(?:fare|ticket)|aviation/i },
 { label: "Visa",         re: /visa/i },
 { label: "Total Package",re: /total|grand\s*total|all[\s-]inclu|package\s*(?:cost|price|rate|total)?|combined/i },
 { label: "Per Person",   re: /per\s*(?:person|pax|adult|head|child|kid)\b|\/pax\b|\/pp\b/i },
];
// Any number adjacent to a currency indicator (same line OR within ±5 lines) is a price.
// "Label: number" and bare numbers are both accepted when currency is nearby.
const CURR_LINE_RE  = /(?:usd|inr|eur|gbp|sgd|aed|thb|cad|aud|myr|jpy|vnd|idr|hkd|nzd|lkr|npr|bdt|sar|qar|omr|bhd|₹|₫|\$|€|£|฿|¥|Rp|Rs\.?)/i;
// Bare number: 1,234.50  or  500000  — also catches number/- for Indian notation
const BARE_NUM_RE   = /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:\s*\/\-)?|\d{4,8}(?:\.\d{1,2})?(?:\s*\/\-)?)/g;

function extractPricesWithContext(text) {
 if (!text) return [];
 const lines = text.replace(/\r\n/g, "\n").split("\n");
 const seenPrices = new Set();
 const lineResults = new Array(lines.length).fill(null).map(() => []);

 // Pass 1 — standard extraction: currency symbol/code on the SAME line as the number
 for (let i = 0; i < lines.length; i++) {
  for (const p of extractPrices(lines[i])) {
   if (!seenPrices.has(p)) { seenPrices.add(p); lineResults[i].push(p); }
  }
 }

 // Pass 2 — proximity extraction: find currency lines, then scan ±5 lines for bare numbers
 // This handles "Price in USD\n1500\n800" and table formats where currency is in the header
 for (let i = 0; i < lines.length; i++) {
  if (!CURR_LINE_RE.test(lines[i])) continue; // skip non-currency lines
  const lo = Math.max(0, i - 5);
  const hi = Math.min(lines.length - 1, i + 5);
  for (let j = lo; j <= hi; j++) {
   if (j === i) continue; // already handled by pass 1
   const trimmed = lines[j].trim();
   if (!trimmed) continue;
   let m;
   BARE_NUM_RE.lastIndex = 0;
   while ((m = BARE_NUM_RE.exec(trimmed)) !== null) {
    const v = cleanNum(m[1]);
    if (!Number.isFinite(v) || v < 100 || v > 9_999_999) continue;
    if (seenPrices.has(v)) continue;
    seenPrices.add(v);
    lineResults[j].push(v);
   }
  }
 }

 // Collect results with category labels (±2 line context window)
 const results = [];
 for (let i = 0; i < lines.length; i++) {
  if (!lineResults[i].length) continue;
  const ctxLines = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(" ");
  let label = "";
  for (const { label: l, re } of PRICE_CATEGORIES) { if (re.test(ctxLines)) { label = l; break; } }
  for (const price of lineResults[i]) results.push({ price, label });
 }

 // Ultimate fallback — extract anything price-like from the full text
 if (!results.length) {
  return extractPrices(text).map(p => ({ price: p, label: "" }));
 }

 let idx = 1;
 return results.map(r => ({ ...r, label: r.label || `Price ${idx++}` }));
}

// GET all vendor requests (admin only)
app.get("/api/vendor-requests", async (req, res) => {
 const { data, error } = await db.from("vendor_requests").select("*").order("created_at", { ascending: false });
 if (error) return res.status(500).json({ error: error.message });
 res.json(data || []);
});

// GET quote status for a lead — employee-safe view: no vendor names, no markup, no prices until forwarded
app.get("/api/vendor-requests/lead-status/:lead_id", async (req, res) => {
 const { data, error } = await db.from("vendor_requests")
  .select("id,status,destination,sent_at,received_at,forwarded_at,final_price,forwarded_to")
  .eq("lead_id", req.params.lead_id)
  .order("created_at", { ascending: false });
 if (error) return res.status(500).json({ error: error.message });
 // Strip any sensitive fields — only expose what employee should see
 const safe = (data||[]).map(r => ({
  id: r.id,
  status: r.status,
  destination: r.destination,
  sent_at: r.sent_at,
  received_at: r.received_at,
  // final_price only visible once admin has forwarded the quote
  final_price: r.status === "forwarded" ? r.final_price : null,
  forwarded_at: r.forwarded_at,
 }));
 res.json(safe);
});

// POST send quote request email to vendor + record it
app.post("/api/vendor-requests/send", async (req, res) => {
 try {
  const { lead_id, lead_name, lead_ref, destination, vendor_id, vendor_name, vendor_email, markup_type, markup_value, subject, body } = req.body;
  if (!vendor_email || !subject) return res.status(400).json({ error: "vendor_email and subject required" });
  const cfg = await getEmailCfg();
  if (!cfg?.password) return res.status(400).json({ error: "Email not configured — go to Settings → Email and save your SMTP credentials first" });
  console.log(`[vendor-requests/send] to=${vendor_email} via ${cfg.smtp_host}:${cfg.smtp_port}`);

  const transporter = buildSmtpTransport(cfg);
  const mail = {
   from: cfg.from_name?`"${cfg.from_name}" <${cfg.username}>`:cfg.username,
   to: vendor_email, subject,
   text: body||"", html: (body||"").replace(/\n/g,"<br/>"),
  };
  const info = await transporter.sendMail(mail);
  const messageId = info.messageId || "";

  // Save copy to IMAP Sent folder
  try {
   const stream = nodemailer.createTransport({ streamTransport:true, newline:"unix" });
   const si = await stream.sendMail({ ...mail });
   const chunks = []; for await (const c of si.message) chunks.push(c);
   const imap = buildImapClient(cfg);
   await imap.connect();
   await imap.append(cfg.sent_folder||"Sent", Buffer.concat(chunks), ["\\Seen"]);
   await imap.logout();
  } catch (e) { console.warn("[vr-send] IMAP append:", e.message); }

  const id = genId("VR");
  const { error } = await db.from("vendor_requests").insert({
   id, lead_id, lead_name, lead_ref, destination,
   vendor_id, vendor_name, vendor_email,
   markup_type: markup_type||"percent", markup_value: markup_value||0,
   subject, body_sent: body||"", message_id: messageId,
   status:"sent", sent_at:new Date(), created_at:new Date(), updated_at:new Date(),
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success:true, id });
 } catch (e) { console.error("[vendor-requests/send] ERROR:", e.message); res.status(500).json({ error: e.message }); }
});

// ── Standalone check-replies logic (used by HTTP endpoint AND auto-scheduler) ──
let _scanLock = false;
async function runCheckReplies() {
 if (_scanLock) {
  console.log("[vr-check] scan already in progress — skipping this run");
  return { updated:0, scanned:0, autoForwarded:0, detail:"Scan in progress" };
 }
 _scanLock = true;
 try {
  return await _runCheckRepliesInner();
 } catch (e) {
  console.error("[vr-check] unexpected top-level error:", e.message);
  return { updated:0, scanned:0, autoForwarded:0, detail:`Error: ${e.message}` };
 } finally {
  _scanLock = false;
 }
}
async function _runCheckRepliesInner() {
  const cfg = await getEmailCfg();
  if (!cfg?.password) return { updated:0, scanned:0, autoForwarded:0, detail:"Email not configured" };
  if (!cfg.forward_email) console.warn("[vr-check] forward_email not set — replies will be received but NOT auto-forwarded to employee. Set it in Settings → Email.");

  const { data: openReqs } = await db.from("vendor_requests").select("id,vendor_email,message_id,subject,lead_name,destination").eq("status","sent");
  if (!openReqs?.length) return { updated:0, scanned:0, autoForwarded:0, detail:"No pending requests" };

  // Build lookup maps for matching
  const stripBrackets = s => (s||"").replace(/[<>]/g,"").trim();
  const byMsgId = {}, byEmail = {}, byDomain = {}, bySubject = {};
  for (const r of openReqs) {
   // Message-ID match (most reliable when vendor client sends In-Reply-To)
   const mid = stripBrackets(r.message_id);
   if (mid) { byMsgId[mid] = r; byMsgId[`<${mid}>`] = r; }
   // Exact email match
   const em = (r.vendor_email||"").toLowerCase().trim();
   if (em) { if (!byEmail[em]) byEmail[em]=[]; byEmail[em].push(r); }
   // Domain match (catches vendor replying from different address @same domain)
   const dom = em.split("@")[1] || "";
   if (dom) { if (!byDomain[dom]) byDomain[dom]=[]; byDomain[dom].push(r); }
   // Subject match: "Re: <original subject>"
   if (r.subject) {
    const base = r.subject.toLowerCase().replace(/^re:\s*/i,"").trim();
    const key = `re: ${base}`;
    if (!bySubject[key]) bySubject[key]=[];
    bySubject[key].push(r);
    // Also index without the "Re:" so we can do partial checks
    if (!bySubject[base]) bySubject[base]=[];
    bySubject[base].push(r);
   }
  }
  const vendorEmails = Object.keys(byEmail);
  console.log(`[vr-check] scanning for ${openReqs.length} open request(s) from: ${vendorEmails.join(", ")}`);

  const client = buildImapClient(cfg);
  // ImapFlow emits 'error' on socket timeout — listen so it doesn't become an uncaughtException
  let connectionDied = false;
  client.on('error', (err) => {
   connectionDied = true;
   console.warn('[imap] socket error (scan aborted):', err.message);
  });
  try { await client.connect(); } catch(e) { return { updated:0, scanned:0, autoForwarded:0, detail:`IMAP connect failed: ${e.message}` }; }
  try { await client.mailboxOpen("INBOX"); } catch(e) { try { await client.logout(); } catch {} return { updated:0, scanned:0, autoForwarded:0, detail:`INBOX open failed: ${e.message}` }; }

  // ── Targeted search: FROM each vendor address + UNSEEN, then fallbacks ──
  let uids = [];

  // Pass 1: UNSEEN FROM specific vendor emails (tiny result set, very fast)
  for (const em of vendorEmails) {
   if (connectionDied) break;
   try {
    const found = await client.search({ from: em, seen: false }, { uid: true });
    if (Array.isArray(found) && found.length) {
     uids.push(...found);
     console.log(`[vr-check] ${found.length} unseen email(s) from ${em}`);
    }
   } catch(e) { console.warn(`[vr-check] search(FROM ${em} UNSEEN) failed:`, e.message); }
  }

  // Pass 2: FROM search unsupported — fall back to last 30 messages by sequence
  if (!uids.length && !connectionDied) {
   console.warn("[vr-check] FROM search returned nothing — falling back to last 30 messages");
   try {
    const st = await client.status("INBOX", { messages: true });
    const total = st?.messages || 0;
    if (total > 0) { const s = Math.max(1, total - 29); for (let i = s; i <= total; i++) uids.push(i); }
   } catch(e) { console.warn("[vr-check] STATUS fallback failed:", e.message); }
  }

  uids = [...new Set(uids)];
  console.log(`[vr-check] ${uids.length} candidate email(s) to check`);
  if (!uids.length) {
   try { await client.logout(); } catch {}
   const fwd0 = await runAutoForwardReceived(cfg);
   return { updated:0, scanned:0, autoForwarded:fwd0, detail:"No emails found from vendor addresses" };
  }

  let updated = 0, scanned = 0;
  const done = new Set();
  const toMarkRead = [];

  const BATCH = 10;
  const seqNums = uids; // UIDs from search, or seq numbers from fallback
  for (let i = 0; i < seqNums.length; i += BATCH) {
   if (connectionDied) { console.warn('[vr-check] connection lost — stopping scan early'); break; }
   const batch = seqNums.slice(i, i + BATCH);
   try {
   for await (const msg of client.fetch(batch, { envelope: true, headers: ["in-reply-to","references"], source: true }, { uid: true })) {
    if (connectionDied) break;
    try {
     scanned++;
     const fromAddr = (msg.envelope?.from?.[0]?.address || "").toLowerCase().trim();
     const fromDomain = fromAddr.split("@")[1] || "";
     if (!fromAddr) continue;

     // Pre-filter: skip emails not from any known vendor (exact email OR same domain)
     const isKnownVendor = !!byEmail[fromAddr] || (fromDomain && !!byDomain[fromDomain]);
     if (!isKnownVendor) continue;

     const msgSubj = (msg.envelope?.subject || "").toLowerCase().trim();
     console.log(`[vr-check] checking seq ${msg.seq} from <${fromAddr}> subj="${msgSubj}"`);

     // Strategy 1: In-Reply-To header (most reliable)
     let matched = null;
     const irt = stripBrackets(msg.headers?.get?.("in-reply-to") || "");
     if (irt) { matched = byMsgId[irt] || byMsgId[`<${irt}>`]; if (matched) console.log(`[vr-check]  → matched by In-Reply-To`); }

     // Strategy 2: References header chain
     if (!matched) {
      const refs = (msg.headers?.get?.("references") || "").split(/\s+/).map(stripBrackets).filter(Boolean);
      for (const ref of refs) { matched = byMsgId[ref] || byMsgId[`<${ref}>`]; if (matched) { console.log(`[vr-check]  → matched by References`); break; } }
     }

     // Strategy 3: only one open request from this exact vendor email
     if (!matched && byEmail[fromAddr]?.length === 1) { matched = byEmail[fromAddr][0]; console.log(`[vr-check]  → matched by exact vendor email (sole open request)`); }

     // Strategy 4: exact subject match "Re: <original subject>"
     if (!matched) {
      const sMatches = bySubject[msgSubj];
      if (sMatches?.length === 1) { matched = sMatches[0]; console.log(`[vr-check]  → matched by exact subject`); }
     }

     // Strategy 5: partial subject (email subject contains or is contained in original)
     if (!matched) {
      for (const [key, reqs] of Object.entries(bySubject)) {
       const base = key.replace(/^re:\s*/i,"").trim();
       const msgBase = msgSubj.replace(/^re:\s*/i,"").trim();
       if (msgBase.length > 6 && (msgBase.includes(base) || base.includes(msgBase))) {
        if (reqs.length === 1 && !done.has(reqs[0].id)) { matched = reqs[0]; console.log(`[vr-check]  → matched by partial subject`); break; }
       }
      }
     }

     // Strategy 6: domain match — ONLY for private/company domains, never public providers
     const PUBLIC_DOMAINS = new Set(["gmail.com","yahoo.com","yahoo.in","hotmail.com","outlook.com","live.com","icloud.com","me.com","aol.com","rediffmail.com","ymail.com"]);
     if (!matched && fromDomain && !PUBLIC_DOMAINS.has(fromDomain)) {
      const domMatches = (byDomain[fromDomain] || []).filter(r => !done.has(r.id));
      if (domMatches.length === 1) { matched = domMatches[0]; console.log(`[vr-check]  → matched by vendor domain @${fromDomain}`); }
     }

     if (!matched) { console.log(`[vr-check]  → no match found (irt=${irt||"none"}, known vendor emails: ${(byEmail[fromAddr]||[]).length})`); continue; }
     if (done.has(matched.id)) { console.log(`[vr-check]  → already processed in this run`); continue; }

     // Parse the full message source so MIME parts, quoted-printable, base64, etc. are decoded
     console.log(`[vr-check] matched UID ${msg.uid} from ${fromAddr} → request ${matched.id}`);
     let emailText = "";
     let emailHtml = "";
     let emailDate = msg.envelope?.date || new Date();
     let bodyClient = null;
     try {
      if (msg.source) {
       const parsed = await simpleParser(msg.source);
       emailText = (parsed.text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
       emailHtml = parsed.html || "";
       if (parsed.date) emailDate = parsed.date;
      }
     } catch (parseErr) { console.warn("[vr-check] simpleParser error:", parseErr.message); }
     console.log(`[vr-check] body length=${emailText.length}`);

     const priceItems = extractPricesWithContext(emailText);
     const currency = detectCurrency(emailText);
     const CURR_SYM2 = { INR:"₹", USD:"$", EUR:"€", GBP:"£", SGD:"S$", AED:"AED ", THB:"฿", CAD:"C$", AUD:"A$", MYR:"RM ", JPY:"¥", VND:"₫", IDR:"Rp ", HKD:"HK$", NZD:"NZ$", LKR:"Rs ", NPR:"Rs ", BDT:"৳", SAR:"SAR ", QAR:"QAR ", OMR:"OMR ", BHD:"BHD " };
     const sym = CURR_SYM2[currency] || (currency + " ");
     const fmt = (n) => currency === "INR" ? `₹${Number(n).toLocaleString("en-IN")}` : `${sym}${Number(n).toLocaleString()}`;
     console.log(`[vr-check] body=${emailText.length}chars prices=${JSON.stringify(priceItems)} currency=${currency}`);

     // Fetch full vendor_request record (for markup settings + vendor_id)
     const { data: vrRows } = await db.from("vendor_requests").select("*").eq("id", matched.id).limit(1);
     const vr = vrRows?.[0];

     // Get markup — prefer vendor_requests value, fall back to vendors table
     const mt = vr?.markup_type || "percent";
     let mv = Number(vr?.markup_value) || 0;
     if (!mv && vr?.vendor_id) {
      const { data: vndRow } = await db.from("vendors").select("markup_type,markup_value").eq("id", vr.vendor_id).limit(1);
      if (vndRow?.[0]?.markup_value) { mv = Number(vndRow[0].markup_value) || 0; }
     }
     if (!mv) { mv = 10; console.log("[vr-check] no markup configured — using default 10%"); }
     console.log(`[vr-check] markup: ${mv}${mt === "percent" ? "%" : " flat"}`);

     // Apply markup to every extracted price
     const pricedItems = priceItems.map(({ price, label }) => {
      const final = mv > 0
       ? (mt === "percent" ? Math.round(price * (1 + mv / 100)) : Math.round(price + mv))
       : price;
      return { label, vendorPrice: price, finalPrice: final };
     });

     const origPrice = priceItems[0]?.price || null;
     const fp = pricedItems[0]?.finalPrice || null;
     const forwardTo = (cfg.forward_email || "").trim();
     const canAutoForward = pricedItems.length > 0 && forwardTo;
     if (!canAutoForward) {
      const nc = await getNotifCfg();
      if (!pricedItems.length) {
       console.warn(`[vr-check] no prices found in email — will mark "received" only`);
       await sendNotification(nc, `⚠️ Vendor replied but no prices detected. Request ${matched.id} (${vr?.destination||""}) — check email manually.`).catch(()=>{});
      }
      if (!forwardTo) {
       console.warn(`[vr-check] forward_email not set — go to Settings → Email`);
       await sendNotification(nc, `⚠️ Vendor replied but no Forward Email is configured. Set it in Settings → Email to auto-forward quotes.`).catch(()=>{});
      }
     }

     // Always save as "received" first — update to "forwarded" only AFTER email is sent successfully
     console.log(`[vr-check] saving ${matched.id} as received`);
     const { error } = await db.from("vendor_requests").update({
      status: "received",
      response_uid: String(msg.uid || ""),
      response_from: fromAddr,
      response_subject: msg.envelope?.subject || "",
      response_body: emailText,
      response_html: emailHtml,
      extracted_prices: priceItems.map(p => p.price),
      original_price: origPrice,
      markup_type: mt, markup_value: mv, final_price: fp,
      received_at: emailDate,
      updated_at: new Date(),
     }).eq("id", matched.id).eq("status", "sent");

     if (!error) {
      updated++; done.add(matched.id);
      if (msg.uid) toMarkRead.push(msg.uid);

      // Send forwarded email — only mark "forwarded" in DB on success
      if (canAutoForward) {
       try {
        const transporter = buildSmtpTransport(cfg);
        const fwdSubject = `Quote Ready — ${vr.destination||""} | ${vr.lead_name||"Lead"} [Ref: ${vr.lead_ref||vr.lead_id||""}]`;

        // Build priceList for the converter (raw → mu pairs, largest first)
        const priceListForConv = pricedItems
         .map(p => ({ raw: p.vendorPrice, mu: p.finalPrice, label: p.label || "" }))
         .filter(p => p.raw > 0).sort((a, b) => b.raw - a.raw);
        // Plain-text fallback (for email text/plain part)
        const fwdBody = applyMarkupToBody(emailText, pricedItems, currency);
        // Rich HTML using the vendor email converter (creates proper tables, bold headings, strips vendor name)
        const bodyHtml = convertVendorEmailToHtml(emailText, vr?.vendor_name || "", priceListForConv);

        const header = `Quote for: ${vr.lead_name||""} | ${vr.destination||""} | Ref: ${vr.lead_ref||vr.lead_id||""}\n${"─".repeat(60)}\n`;
        const fwdText = `${header}${fwdBody}`;
        const fwdHtml = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto">
<div style="background:#0D2030;color:#E8F4FD;padding:18px 24px;border-radius:8px 8px 0 0">
 <div style="font-size:20px;font-weight:bold;letter-spacing:.5px">Safarnaama Holidays</div>
 <div style="font-size:12px;opacity:.8;margin-top:4px">Travel Quote · ${vr.destination||""}</div>
</div>
<div style="border:1px solid #E6ECF5;border-top:none;border-radius:0 0 8px 8px;padding:18px 24px;background:#fff">
<p style="font-size:14px;color:#1E293B;margin:0 0 14px">Greetings from <strong>Safarnaama Holidays</strong>!<br>
Please find your customised travel package quote below.</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
<tr><td style="color:#64748B;width:120px;padding:4px 0">Lead</td><td style="font-weight:700">${vr.lead_name||""}</td></tr>
<tr><td style="color:#64748B;padding:4px 0">Destination</td><td style="font-weight:700">${vr.destination||""}</td></tr>
<tr><td style="color:#64748B;padding:4px 0">Reference</td><td style="font-weight:700">${vr.lead_ref||vr.lead_id||""}</td></tr>
</table>
<div style="padding:4px 0">${bodyHtml}</div>
<hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
<p style="font-size:12px;color:#94A3B8;margin:0">Warm regards,<br><strong>Safarnaama Holidays</strong></p>
</div></div>`;

        const smtpRes = await transporter.sendMail({
         from: cfg.from_name ? `"${cfg.from_name}" <${cfg.username}>` : cfg.username,
         to: forwardTo, subject: fwdSubject, text: fwdText, html: fwdHtml,
        });
        console.log(`[vr-check] SMTP accepted: messageId=${smtpRes.messageId} accepted=${JSON.stringify(smtpRes.accepted)} rejected=${JSON.stringify(smtpRes.rejected)}`);

        if (smtpRes.rejected?.length) {
         throw new Error(`SMTP rejected recipient(s): ${smtpRes.rejected.join(", ")}`);
        }

        // Email sent successfully — NOW mark as forwarded
        await db.from("vendor_requests").update({
         status: "forwarded", forwarded_to: forwardTo, forwarded_at: new Date(), updated_at: new Date(),
        }).eq("id", matched.id);
        console.log(`[vr-check] auto-forwarded ${matched.id} → ${forwardTo} (${pricedItems.length} price(s) with markup)`);
       } catch (fwdErr) {
        console.warn(`[vr-check] auto-forward email failed for ${matched.id}:`, fwdErr.message);
        // Status stays "received" — runAutoForwardReceived will retry on next cycle
        try {
         const nc = await getNotifCfg();
         await sendNotification(nc, `❌ Failed to forward vendor quote. Request ${matched.id} (${vr?.destination||""}). Error: ${fwdErr.message.slice(0,120)}`);
        } catch {}
       }
      }
     } else {
      console.warn("[vr-check] DB update error:", error.message);
      try {
       const nc = await getNotifCfg();
       await sendNotification(nc, `❌ DB error saving vendor reply for ${matched.id} (${vr?.destination||""}): ${error.message.slice(0,100)}`);
      } catch {}
     }
    } catch (e) {
     console.warn("[vr-check] msg error:", e.message);
     try {
      const nc = await getNotifCfg();
      await sendNotification(nc, `❌ Unexpected error processing vendor email: ${e.message.slice(0,120)}`);
     } catch {}
    }
   }
   } catch (e) {
    if (connectionDied || (e.message||"").includes("Connection not available")) {
     console.warn("[vr-check] connection lost during fetch, stopping scan");
     break;
    }
    console.warn("[vr-check] batch fetch error:", e.message);
   }
  }

  // Mark all processed emails as read now that fetching is fully complete
  if (toMarkRead.length) {
   try {
    await client.messageFlagsAdd(toMarkRead, ["\\Seen"], { uid: true });
    console.log(`[vr-check] marked ${toMarkRead.length} email(s) as read: UIDs ${toMarkRead.join(",")}`);
   } catch(flagErr) { console.warn("[vr-check] could not mark as read:", flagErr.message); }
  }

  try { await client.logout(); } catch {}
  console.log(`[vr-check] done: scanned=${scanned} updated=${updated}`);

  // Second pass: auto-forward any already-"received" entries that have a price
  const fwdCount = await runAutoForwardReceived(cfg);
  return { updated, scanned, autoForwarded: fwdCount, detail: `Scanned ${scanned} emails · ${updated} new · ${fwdCount} auto-forwarded` };
} // end _runCheckRepliesInner

// Forward all "received" entries that have a price — uses pre-stored markup from vendor record
async function runAutoForwardReceived(cfgArg) {
 let count = 0;
 try {
  const cfg = cfgArg || await getEmailCfg();
  if (!cfg?.password) return count;
  const forwardTo = (cfg.forward_email || "").trim();
  if (!forwardTo) { console.log("[auto-fwd] no forward_email configured — skipping auto-forward"); return count; }

  const { data: received } = await db.from("vendor_requests").select("*").eq("status","received");
  if (!received?.length) return count;
  console.log(`[auto-fwd] checking ${received.length} received entries for auto-forward...`);

  const transporter = buildSmtpTransport(cfg);

  const CURR_SYM = { INR:"₹", USD:"$", EUR:"€", GBP:"£", SGD:"S$", AED:"AED ", THB:"฿", CAD:"C$", AUD:"A$", MYR:"RM ", JPY:"¥" };

  for (const vr of received) {
   const storedPrices = (vr.extracted_prices || []).filter(p => p > 0);
   if (!storedPrices.length && !vr.original_price) {
    console.log(`[auto-fwd] ${vr.id}: no price stored — skipping`);
    continue;
   }
   const mt = vr.markup_type || "percent";
   const mv = Number(vr.markup_value) || 10;
   const currency = detectCurrency(vr.response_body || "");

   // Build price items from stored extracted_prices (same structure as main scan)
   const pricedItems = storedPrices.map(vendorPrice => ({
    vendorPrice,
    finalPrice: mt === "percent" ? Math.round(vendorPrice * (1 + mv / 100)) : Math.round(vendorPrice + mv),
   }));
   const origPrice = storedPrices[0] || vr.original_price;
   const fp = pricedItems[0]?.finalPrice || origPrice;

   // Build forwarded body from stored vendor email body with prices replaced
   const emailText = (vr.response_body || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
   const priceListForConv = pricedItems
    .map(p => ({ raw: p.vendorPrice, mu: p.finalPrice, label: "" }))
    .filter(p => p.raw > 0).sort((a, b) => b.raw - a.raw);
   const fwdBody  = applyMarkupToBody(emailText, pricedItems, currency); // plain-text fallback
   const bodyHtml = convertVendorEmailToHtml(emailText, vr.vendor_name || "", priceListForConv);

   const subject  = `Quote Ready — ${vr.destination||""} | ${vr.lead_name||"Lead"} [Ref: ${vr.lead_ref||vr.lead_id||""}]`;
   const header   = `Quote for: ${vr.lead_name||""} | ${vr.destination||""} | Ref: ${vr.lead_ref||vr.lead_id||""}\n${"─".repeat(60)}\n`;
   const fwdText  = `${header}${fwdBody}`;
   const fwdHtml  = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto">
<div style="background:#0D2030;color:#E8F4FD;padding:18px 24px;border-radius:8px 8px 0 0">
 <div style="font-size:20px;font-weight:bold;letter-spacing:.5px">Safarnaama Holidays</div>
 <div style="font-size:12px;opacity:.8;margin-top:4px">Travel Quote · ${vr.destination||""}</div>
</div>
<div style="border:1px solid #E6ECF5;border-top:none;border-radius:0 0 8px 8px;padding:18px 24px;background:#fff">
<p style="font-size:14px;color:#1E293B;margin:0 0 14px">Greetings from <strong>Safarnaama Holidays</strong>!<br>
Please find your customised travel package quote below.</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
<tr><td style="color:#64748B;width:120px;padding:4px 0">Lead</td><td style="font-weight:700">${vr.lead_name||""}</td></tr>
<tr><td style="color:#64748B;padding:4px 0">Destination</td><td style="font-weight:700">${vr.destination||""}</td></tr>
<tr><td style="color:#64748B;padding:4px 0">Reference</td><td style="font-weight:700">${vr.lead_ref||vr.lead_id||""}</td></tr>
</table>
<div style="padding:4px 0">${bodyHtml}</div>
<hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
<p style="font-size:12px;color:#94A3B8;margin:0">Warm regards,<br><strong>Safarnaama Holidays</strong></p>
</div></div>`;

   // Send email FIRST — only update DB to "forwarded" on success
   try {
    const smtpRes = await transporter.sendMail({
     from: cfg.from_name ? `"${cfg.from_name}" <${cfg.username}>` : cfg.username,
     to: forwardTo, subject, text: fwdText, html: fwdHtml,
    });
    console.log(`[auto-fwd] SMTP accepted: messageId=${smtpRes.messageId} accepted=${JSON.stringify(smtpRes.accepted)} rejected=${JSON.stringify(smtpRes.rejected)}`);
    if (smtpRes.rejected?.length) throw new Error(`SMTP rejected recipient(s): ${smtpRes.rejected.join(", ")}`);
    // Email sent — now mark as forwarded
    const { error } = await db.from("vendor_requests").update({
     status: "forwarded", final_price: fp, forwarded_to: forwardTo,
     forwarded_at: new Date(), markup_type: mt, markup_value: mv,
     original_price: origPrice, updated_at: new Date(),
    }).eq("id", vr.id).eq("status", "received");
    if (error) console.warn(`[auto-fwd] DB update error for ${vr.id}:`, error.message);
    else { count++; console.log(`[auto-fwd] ✓ forwarded ${vr.id} → ${forwardTo}`); }
   } catch (emailErr) {
    console.warn(`[auto-fwd] email send failed for ${vr.id}:`, emailErr.message);
    // Status stays "received" — will be retried next cycle
    try {
     const nc = await getNotifCfg();
     await sendNotification(nc, `❌ Failed to forward quote for ${vr.destination||vr.id}: ${emailErr.message.slice(0,100)}`);
    } catch {}
   }
  }
 } catch (e) { console.error("[auto-fwd] error:", e.message); }
 return count;
}

// HTTP endpoint — manual trigger ("Sync Now" button)
// Responds immediately (avoids 504) and runs IMAP scan in background.
// Frontend polls the vendor-requests list after a short delay to show results.
app.post("/api/vendor-requests/check-replies", async (req, res) => {
 // Check email is configured before firing off background task
 const cfg = await getEmailCfg().catch(() => null);
 if (!cfg?.password) return res.json({ updated:0, scanned:0, autoForwarded:0, detail:"Email not configured — go to Settings → Email" });
 // Respond immediately so the proxy never sees a timeout
 res.json({ status:"running", detail:"IMAP check started — list will refresh automatically in ~20 seconds" });
 // Run scan in background
 runCheckReplies().then(r => {
  console.log(`[vr-check] background scan done: scanned=${r.scanned} updated=${r.updated} fwd=${r.autoForwarded}`);
 }).catch(e => console.error("[vr-check] background error:", e.message));
});

// POST — manually trigger auto-forward of received entries (for testing / unblocking)
app.post("/api/vendor-requests/auto-forward-received", async (req, res) => {
 try {
  const count = await runAutoForwardReceived();
  res.json({ forwarded: count, detail: count > 0 ? `${count} request(s) forwarded` : "No forwardable entries found — check that vendors replied with a price and that forward_email is set in Settings → Email" });
 } catch (e) { res.status(500).json({ error: e.message }); }
});

// Auto-check every 1 minute — respects IST time window from schedule_config
const AUTO_CHECK_MS = 60 * 1000;
setInterval(async () => {
 try {
  const schedCfg = await getSchedCfg();
  if (!isWithinCheckWindow(schedCfg)) {
   const h = Math.floor(getISTHour());
   console.log(`[auto-check] outside active window (${h}:xx IST) — skipping`);
   return;
  }
  console.log("[auto-check] scheduled scan...");
  const r = await runCheckReplies();
  if (r.updated > 0 || r.autoForwarded > 0)
   console.log(`[auto-check] ✓ ${r.updated} new replies · ${r.autoForwarded} auto-forwarded`);
 } catch (e) { console.error("[auto-check] error:", e.message); }
}, AUTO_CHECK_MS);

// Vendor reply timeout notifications — runs every 15 minutes
setInterval(async () => {
 try {
  const schedCfg = await getSchedCfg();
  if (!isWithinCheckWindow(schedCfg)) return;
  await checkVendorTimeouts();
 } catch (e) { console.warn("[timeout-check] error:", e.message); }
}, 15 * 60 * 1000);

// First scan 30s after startup
setTimeout(async () => {
 console.log("[auto-check] startup scan...");
 try { await runCheckReplies(); } catch (e) { console.error("[auto-check] startup error:", e.message); }
}, 30 * 1000);

// GET /api/notifications/status — returns active provider info (no credentials)
app.get("/api/notifications/status", async (req, res) => {
 const configured =
  (NOTIF_PROVIDER === "msg91"    && !!MSG91_AUTHKEY) ||
  (NOTIF_PROVIDER === "fast2sms" && !!FAST2SMS_KEY);
 const waReady = NOTIF_PROVIDER === "msg91" && !!MSG91_WA_NUMBER && !!MSG91_WA_TPL;
 res.json({ provider: NOTIF_PROVIDER, configured, waReady });
});

// POST /api/notifications/test — send a test notification with current user settings
app.post("/api/notifications/test", async (req, res) => {
 try {
  const notifCfg = await getNotifCfg();
  if (!notifCfg?.phone) return res.status(400).json({ error: "Phone number not set in Notification Settings" });
  if (NOTIF_PROVIDER === "none") return res.status(400).json({ error: "No notification provider configured — set NOTIF_PROVIDER in server .env" });
  await sendNotification({ ...notifCfg, enabled: true }, `✅ Test from Safarnaama CRM — ${new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}`);
  res.json({ success: true });
 } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH update markup / price on a vendor request
app.patch("/api/vendor-requests/:id", async (req, res) => {
 const { error } = await db.from("vendor_requests").update({ ...req.body, updated_at:new Date() }).eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success:true });
});

// POST apply markup and forward processed quote to employee
app.post("/api/vendor-requests/:id/forward", async (req, res) => {
 try {
  const { id } = req.params;
  const { original_price, markup_type, markup_value, final_price, forward_to, note } = req.body;
  const { data } = await db.from("vendor_requests").select("*").eq("id",id).limit(1);
  const vr = data?.[0];
  if (!vr) return res.status(404).json({ error:"Request not found" });
  const cfg = await getEmailCfg();
  if (!cfg?.password) return res.status(400).json({ error:"Email not configured" });
  const to = (forward_to||"").trim() || (cfg.forward_email||"").trim();
  if (!to) return res.status(400).json({ error:"No employee email — add Forward Email in Settings → Email" });

  const fp = final_price || vr.final_price || 0;
  const subject = `Quote Ready — ${vr.destination||""} | ${vr.lead_name||"Lead"} [Ref: ${vr.lead_ref||vr.lead_id||""}]`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1A6B8A;color:#fff;padding:16px 22px;border-radius:10px 10px 0 0"><div style="font-size:16px;font-weight:700">Quote Ready for Client</div><div style="font-size:12px;opacity:.8;margin-top:2px">Admin processed · Vendor details confidential</div></div>
<div style="border:1px solid #E6ECF5;border-top:none;padding:20px 22px;border-radius:0 0 10px 10px;background:#fff">
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
<tr><td style="padding:6px 0;color:#64748B;width:130px">Lead Name</td><td style="padding:6px 0;font-weight:700">${vr.lead_name||""}</td></tr>
<tr><td style="padding:6px 0;color:#64748B">Destination</td><td style="padding:6px 0;font-weight:700">${vr.destination||""}</td></tr>
<tr><td style="padding:6px 0;color:#64748B">Lead Reference</td><td style="padding:6px 0;font-weight:700">${vr.lead_ref||vr.lead_id||""}</td></tr>
</table>
<div style="background:#F0FDF4;border:2px solid #10B981;border-radius:10px;padding:14px;text-align:center;margin-bottom:14px">
<div style="font-size:11px;color:#15803D;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Package Price per Person</div>
<div style="font-size:30px;font-weight:900;color:#0F172A">₹${Number(fp).toLocaleString("en-IN")}</div>
</div>
${note?`<div style="background:#FFF7ED;border-left:3px solid #F59E0B;padding:10px 14px;border-radius:0 8px 8px 0;font-size:12px;color:#92400E;margin-bottom:14px"><strong>Note:</strong> ${note}</div>`:""}
<div style="font-size:11px;color:#94A3B8">Vendor details are not shared to protect margins. Please quote ₹${Number(fp).toLocaleString("en-IN")}/person to the client.</div>
</div></div>`;

  const transporter = buildSmtpTransport(cfg);
  await transporter.sendMail({ from:cfg.from_name?`"${cfg.from_name}" <${cfg.username}>`:cfg.username, to, subject, text:subject, html });

  await db.from("vendor_requests").update({
   status:"forwarded", forwarded_to:to, forwarded_at:new Date(),
   original_price:original_price||vr.original_price, markup_type:markup_type||vr.markup_type,
   markup_value:markup_value||vr.markup_value, final_price:fp, updated_at:new Date(),
  }).eq("id",id);

  res.json({ success:true });
 } catch (e) { res.status(500).json({ error:e.message }); }
});

// ─── AMADEUS FLIGHT SEARCH & BOOKING ─────────────────────────────────────────
const AMADEUS_BASE = process.env.AMADEUS_ENV === "production"
 ? "https://api.amadeus.com"
 : "https://test.api.amadeus.com";
const AMADEUS_CLIENT_ID     = process.env.AMADEUS_CLIENT_ID;
const AMADEUS_CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET;

let _amToken = null, _amTokenExp = 0;
async function getAmadeusToken() {
 if (_amToken && Date.now() < _amTokenExp) return _amToken;
 if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) throw new Error("Amadeus credentials not set in .env (AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET)");
 const r = await axios.post(`${AMADEUS_BASE}/v1/security/oauth2/token`,
  new URLSearchParams({ grant_type:"client_credentials", client_id:AMADEUS_CLIENT_ID, client_secret:AMADEUS_CLIENT_SECRET }),
  { headers:{ "Content-Type":"application/x-www-form-urlencoded" } }
 );
 _amToken = r.data.access_token;
 _amTokenExp = Date.now() + (r.data.expires_in - 60) * 1000;
 return _amToken;
}
async function amGet(path, params={}) {
 const token = await getAmadeusToken();
 const r = await axios.get(`${AMADEUS_BASE}${path}`, { headers:{ Authorization:`Bearer ${token}` }, params });
 return r.data;
}
async function amPost(path, body) {
 const token = await getAmadeusToken();
 const r = await axios.post(`${AMADEUS_BASE}${path}`, body, { headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" } });
 return r.data;
}

// ─── TRIPJACK B2B API ─────────────────────────────────────────────────────────
const TJ_BASE = process.env.TRIPJACK_ENV === "production"
 ? "https://tripjack.com"
 : "https://apitest.tripjack.com";
const TJ_KEY = process.env.TRIPJACK_API_KEY;
const TJ_HDRS = () => ({ apikey: TJ_KEY, "Content-Type": "application/json" });

// ── UAT log capture ──────────────────────────────────────────────────────────
// ── UAT LOGGING — produces TripJack-standard folder structure ─────────────────
// Output: uat_logs/Tripjack API logs/{oneway|roundtrip|multicity}/{ROUTE-PAX-FLIGHTTYPE}/
//   SearchRequest.json / SearchResponse.json
//   ReviewRequest.json / ReviewResponse.json
//   BookingRequest.json / BookingResponse.json
//   BookingDetailRequest.json / BookingDetailResponse.json

const UAT_BASE = path.join(__dirname, "uat_logs", "Tripjack API logs");
let _uatMode    = false;   // toggled via POST /api/uat/enable|disable
let _uatSession = null;    // { tripType, folderName } — set on each TJ search

function uatInitSession(searchQuery) {
 if (!_uatMode) return;
 const ri = searchQuery.routeInfos || [];
 const p  = searchQuery.paxInfo    || {};
 const A  = parseInt(p.ADULT  || 0);
 const C  = parseInt(p.CHILD  || 0);
 const I  = parseInt(p.INFANT || 0);
 const pax = [A > 0 ? `${A}A` : "", C > 0 ? `${C}C` : "", I > 0 ? `${I}I` : ""].filter(Boolean).join("-");
 const ft  = searchQuery.searchModifiers?.isDirectFlight ? "DIRECT" : "CONNECTING";
 let tripType, route;
 if (ri.length <= 1) {
  tripType = "oneway";
  route = `${ri[0]?.fromCityOrAirport?.code || "XXX"}-${ri[0]?.toCityOrAirport?.code || "XXX"}`;
 } else {
  const last = ri[ri.length - 1];
  const isReturn = ri.length === 2 && last.toCityOrAirport?.code === ri[0].fromCityOrAirport?.code;
  if (isReturn) {
   tripType = "roundtrip";
   route = `${ri[0].fromCityOrAirport.code}-${ri[0].toCityOrAirport.code}`;
  } else {
   tripType = "multicity";
   route = ri.map(r => r.fromCityOrAirport.code).join("-") + "-" + last.toCityOrAirport.code;
  }
 }
 _uatSession = { tripType, folderName: `${route}-${pax}-${ft}` };
 console.log(`[UAT] session: ${tripType}/${_uatSession.folderName}`);
}

function uatSave(filename, payload) {
 if (!_uatMode || !_uatSession) return;
 const dir = path.join(UAT_BASE, _uatSession.tripType, _uatSession.folderName);
 if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
 fs.writeFileSync(path.join(dir, filename), JSON.stringify(payload, null, 4));
 console.log(`[UAT] ${_uatSession.tripType}/${_uatSession.folderName}/${filename}`);
}

async function tjGet(path) {
 try {
  const r = await axios.get(`${TJ_BASE}${path}`, { headers: TJ_HDRS() });
  return r.data;
 } catch(e) {
  const errData = e.response?.data;
  console.error(`[TJ GET] ${path} HTTP ${e.response?.status}:`, JSON.stringify(errData));
  throw e;
 }
}
async function tjPost(path, body) {
 try {
  const r = await axios.post(`${TJ_BASE}${path}`, body, { headers: TJ_HDRS() });
  return r.data;
 } catch(e) {
  const errData = e.response?.data;
  console.error(`[TJ POST] ${path} HTTP ${e.response?.status}:`, JSON.stringify(errData));
  throw e;
 }
}

// Enable UAT capture mode
app.post("/api/uat/enable", (req, res) => {
 _uatMode = true;
 _uatSession = null;
 console.log("[UAT] capture mode ON");
 res.json({ ok: true, uatMode: true, outputDir: UAT_BASE });
});

// Disable UAT capture mode
app.post("/api/uat/disable", (req, res) => {
 _uatMode = false;
 const last = _uatSession;
 _uatSession = null;
 console.log("[UAT] capture mode OFF");
 res.json({ ok: true, uatMode: false, lastSession: last });
});

// List all captured cases grouped by trip type
app.get("/api/uat/cases", (req, res) => {
 if (!fs.existsSync(UAT_BASE)) return res.json({ cases: [], uatMode: _uatMode });
 const result = [];
 for (const tripType of ["oneway","roundtrip","multicity"]) {
  const dir = path.join(UAT_BASE, tripType);
  if (!fs.existsSync(dir)) continue;
  for (const folder of fs.readdirSync(dir)) {
   const full = path.join(dir, folder);
   if (!fs.statSync(full).isDirectory()) continue;
   const files = fs.readdirSync(full);
   result.push({ tripType, folder, files, complete: files.length >= 8 });
  }
 }
 res.json({ cases: result, uatMode: _uatMode, outputDir: UAT_BASE });
});

// Normalize TripJack ONWARD trip list to the same shape as Amadeus flight offers
function normalizeTjFlights(trips, searchId, leg = "outbound") {
 const out = [];
 for (const trip of (trips || [])) {
  const segs = trip.sI || [];
  if (!segs.length) continue;
  const carriers = {};
  segs.forEach(s => { if (s.fD?.aI) carriers[s.fD.aI.code] = s.fD.aI.name || s.fD.aI.code; });
  const totalMins = segs.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const duration = `PT${Math.floor(totalMins / 60)}H${totalMins % 60}M`;
  for (const price of (trip.totalPriceList || [])) {
   out.push({
    _source: "tripjack",
    _leg:    leg,
    _priceId: price.id,
    _searchId: searchId,
    _fareIdentifier: price.fareIdentifier || "",
    itineraries: [{
     duration,
     segments: segs.map(s => ({
      carrierCode: s.fD?.aI?.code || "",
      number:      s.fD?.fn  || "",
      departure: { iataCode: s.da?.code || "", at: s.dt || "" },
      arrival:   { iataCode: s.aa?.code || "", at: s.at || "" },
     })),
    }],
    price: { grandTotal: String((price.fD || price.fd)?.ADULT?.fC?.TF || 0), currency: "INR" },
    dictionaries: { carriers },
    numberOfBookableSeats: (price.fD || price.fd)?.ADULT?.sR || 9,
   });
  }
 }
 return out;
}

// Airport / city autocomplete — searches local Supabase table first, merges Amadeus if configured
app.get("/api/flights/airports", async (req, res) => {
 try {
  const { q="" } = req.query;
  if (q.length < 1) return res.json({ data:[] });
  const sq = q.trim();
  const results = [];
  const seen = new Set();

  // ── Local DB (always available, no credentials needed) ──────────────────
  if (supabase) {
   const isCode = sq.length <= 3;
   let qb = db.from("airports").select("iata_code,name,city,country,country_code");
   if (isCode) {
    qb = qb.ilike("iata_code", `${sq}%`);
   } else {
    qb = qb.or(`city.ilike.%${sq}%,name.ilike.%${sq}%,iata_code.ilike.${sq}%`);
   }
   const { data: local } = await qb.order("country_code", { ascending: true }).limit(12);
   (local || []).forEach(a => {
    const key = a.iata_code;
    if (!seen.has(key)) {
     seen.add(key);
     results.push({ id: a.iata_code, iataCode: a.iata_code, name: a.name, cityName: a.city, subType:"AIRPORT", address:{ cityName: a.city, countryName: a.country, countryCode: a.country_code } });
    }
   });
  }

  // ── Amadeus (optional enrichment if credentials set) ────────────────────
  if (AMADEUS_CLIENT_ID && results.length < 5) {
   try {
    const amData = await amGet("/v1/reference-data/locations", { keyword:sq, subType:"AIRPORT,CITY", view:"LIGHT", "page[limit]":8 });
    (amData.data || []).forEach(a => {
     if (!seen.has(a.iataCode)) { seen.add(a.iataCode); results.push(a); }
    });
   } catch { /* Amadeus failed — local results still served */ }
  }

  res.json({ data: results.slice(0, 15) });
 } catch(e) {
  console.error("[airports] search:", e.message);
  res.status(500).json({ error: e.message });
 }
});

// Flight offer search — calls Amadeus + TripJack in parallel, returns combined sorted by price
app.post("/api/flights/search", async (req, res) => {
 const { origin, destination, date, returnDate, adults=1, children=0, infants=0, travelClass="ECONOMY", nonStop=false, max=20 } = req.body;
 if (!origin || !destination || !date) return res.status(400).json({ error:"origin, destination and date are required" });
 const results = [];
 const errors  = {};

 await Promise.all([
  // ── Amadeus ───────────────────────────────────────────────────────────────
  (async () => {
   if (!AMADEUS_CLIENT_ID) return;
   try {
    const params = {
     originLocationCode: origin.toUpperCase(), destinationLocationCode: destination.toUpperCase(),
     departureDate: date, adults: Math.max(1, Number(adults)),
     travelClass: travelClass.toUpperCase(), currencyCode: "INR",
     nonStop: Boolean(nonStop), max: Math.min(40, Number(max)||20),
    };
    if (returnDate) params.returnDate = returnDate;
    if (Number(children) > 0) params.children = Number(children);
    const amData = await amGet("/v2/shopping/flight-offers", params);
    const dicts  = amData.dictionaries || {};
    (amData.data || []).forEach(offer => {
     offer._source = "amadeus";
     offer.dictionaries = offer.dictionaries || dicts;
     results.push(offer);
    });
   } catch(e) {
    errors.amadeus = e.response?.data?.errors?.[0]?.detail || e.message;
    console.error("[amadeus] search:", errors.amadeus);
   }
  })(),
  // ── TripJack ──────────────────────────────────────────────────────────────
  (async () => {
   if (!TJ_KEY) return;
   try {
    const routeInfos = [{ fromCityOrAirport:{ code:origin.toUpperCase() }, toCityOrAirport:{ code:destination.toUpperCase() }, travelDate:date }];
    if (returnDate) routeInfos.push({ fromCityOrAirport:{ code:destination.toUpperCase() }, toCityOrAirport:{ code:origin.toUpperCase() }, travelDate:returnDate });
    const searchQuery = {
     cabinClass: travelClass.toUpperCase(),
     paxInfo: { ADULT: String(Math.max(1, Number(adults))), CHILD: String(Math.max(0, Number(children))), INFANT: String(Math.max(0, Number(infants))) },
     routeInfos,
     searchModifiers: { isDirectFlight: Boolean(nonStop), isConnectingFlight: !Boolean(nonStop) },
    };
    uatInitSession(searchQuery);
    uatSave("SearchRequest.json", { searchQuery });
    console.log("[TJ search]", JSON.stringify({ searchQuery }));
    const tjData = await tjPost("/fms/v1/air-search-all", { searchQuery });
    uatSave("SearchResponse.json", tjData);
    const searchId = tjData?.searchResult?.searchId || "";
    const tripInfos = tjData?.searchResult?.tripInfos || {};
    results.push(...normalizeTjFlights(tripInfos.ONWARD, searchId, "outbound"));
    if (returnDate) {
     results.push(...normalizeTjFlights(tripInfos.RETURN, searchId, "return"));
     results.push(...normalizeTjFlights(tripInfos.COMBO,  searchId, "outbound")); // intl return combo fares
    }
   } catch(e) {
    const tjBody = e.response?.data;
    const tjStatus = e.response?.status;
    console.error("[tripjack] search HTTP status:", tjStatus);
    console.error("[tripjack] search error body:", JSON.stringify(tjBody));
    const tjMsg =
     tjBody?.errors?.[0]?.errMsg ||
     tjBody?.message ||
     tjBody?.error ||
     JSON.stringify(tjBody) ||
     e.message;
    errors.tripjack = `HTTP ${tjStatus}: ${tjMsg}`;
    console.error("[tripjack] search:", errors.tripjack);
   }
  })(),
 ]);

 results.sort((a, b) => Number(a.price?.grandTotal||0) - Number(b.price?.grandTotal||0));
 res.json({ data: results, errors, meta: { sources: { amadeus: !!AMADEUS_CLIENT_ID, tripjack: !!TJ_KEY } } });
});

// Confirm live pricing — routes to TripJack review or Amadeus pricing based on _source
app.post("/api/flights/price", async (req, res) => {
 try {
  const { flightOffer } = req.body;
  if (!flightOffer) return res.status(400).json({ error:"flightOffer is required" });

  if (flightOffer._source === "tripjack") {
   if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
   if (!flightOffer._priceId) return res.status(400).json({ error:"Missing _priceId on flight offer — search again and retry" });
   const reviewReq = { priceIds: [flightOffer._priceId] };
   uatSave("ReviewRequest.json", reviewReq);
   const data = await tjPost("/fms/v1/review", reviewReq);
   uatSave("ReviewResponse.json", data);
   console.log("[TJ review] raw response keys:", Object.keys(data||{}));
   // bookingId may live at root or inside a wrapper — try all known paths
   const bookingId =
    data?.bookingId ||
    data?.data?.bookingId ||
    data?.results?.[0]?.bookingId ||
    data?.response?.bookingId ||
    null;
   if (!bookingId) {
    console.error("[TJ review] bookingId not found in response:", JSON.stringify(data).slice(0,500));
    return res.status(502).json({ error:"TripJack review did not return a bookingId — check server logs for the raw response" });
   }
   const conditions = data?.conditions || data?.data?.conditions || {};
   const tpi = data?.totalPriceInfo || data?.data?.totalPriceInfo;
   const reviewedTF =
    tpi?.totalFareDetail?.fC?.TF ||
    tpi?.fc?.TF ||
    (tpi?.fD || tpi?.fd)?.ADULT?.fC?.TF ||
    Number(flightOffer.price?.grandTotal) || 0;
   const alerts = (data?.alerts || data?.data?.alerts || []).filter(a => a.type === "FAREALERT");
   const confirmedOffer = {
    ...flightOffer,
    _bookingId: bookingId,
    _conditions: conditions,
    price: { ...flightOffer.price, grandTotal: String(reviewedTF) },
   };
   console.log(`[TJ review] OK bookingId=${bookingId} fare=${reviewedTF}`);
   res.json({ data: { flightOffers:[confirmedOffer], _conditions: conditions, _alerts: alerts } });
  } else {
   if (!AMADEUS_CLIENT_ID) return res.status(503).json({ error:"Amadeus not configured" });
   const data = await amPost("/v1/shopping/flight-offers/pricing", { data:{ type:"flight-offers-pricing", flightOffers:[flightOffer] } });
   res.json(data);
  }
 } catch(e) {
  const msg = e.response?.data?.errors?.[0]?.detail || e.response?.data?.message || e.message;
  console.error("[flights] price:", msg);
  res.status(500).json({ error:msg });
 }
});

// Create a flight booking order — routes to TripJack or Amadeus based on _source
app.post("/api/flights/book", async (req, res) => {
 try {
  const { flightOffer, travelers, contacts=[] } = req.body;
  if (!flightOffer || !travelers?.length) return res.status(400).json({ error:"flightOffer and travelers[] are required" });

  if (flightOffer._source === "tripjack") {
   if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
   const tjBookingId = flightOffer._bookingId;
   if (!tjBookingId) return res.status(400).json({ error:"Missing bookingId — please re-price the flight before booking" });
   const travellerInfo = travelers.map(t => {
    const pt     = t.pt || (t.travelerType === "CHILD" ? "CHILD" : t.travelerType === "HELD_INFANT" ? "INFANT" : "ADULT");
    const isAdult = pt === "ADULT";
    const gender  = (t.gender || "MALE").toUpperCase();
    const ti = isAdult ? (gender === "FEMALE" ? "Ms" : "Mr") : (gender === "FEMALE" ? "Ms" : "Master");
    const doc = t.documents?.[0] || {};
    const entry = { ti, fN: (t.name?.firstName || "").toUpperCase(), lN: (t.name?.lastName || "").toUpperCase(), pt };
    if (t.dateOfBirth) entry.dob = t.dateOfBirth;
    if (doc.number)     entry.pNum = doc.number;
    if (doc.expiryDate) entry.eD   = doc.expiryDate;
    if (doc.nationality) entry.pNat = doc.nationality;
    if (doc.issuanceDate) entry.pid = doc.issuanceDate;
    return entry;
   });
   const allEmails   = travelers.map(t => t.contact?.emailAddress).filter(Boolean);
   const allContacts = travelers.map(t => {
    const ph = t.contact?.phones?.[0];
    if (!ph?.number) return null;
    const cc  = String(ph.countryCallingCode || "91").replace(/^\+/, "");
    const num = ph.number.replace(/\D/g, "").replace(new RegExp(`^${cc}`), "");
    return `+${cc}${num}`;
   }).filter(Boolean);
   const bookPayload = {
    bookingId: tjBookingId,
    paymentInfos: [{ amount: Number(flightOffer.price?.grandTotal || 0) }],
    travellerInfo,
    deliveryInfo: {
     emails:   allEmails.length   ? allEmails.slice(0,1)   : ["noreply@safarnaama.com"],
     contacts: allContacts.length ? allContacts.slice(0,1) : ["+919999999999"],
    },
   };
   console.log("[TJ book] payload:", JSON.stringify(bookPayload, null, 2));
   uatSave("BookingRequest.json", bookPayload);
   const data = await tjPost("/oms/v1/air/book", bookPayload);
   uatSave("BookingResponse.json", data);
   const confirmedId = data?.order?.bookingId || data?.bookingId || data?.data?.bookingId || "TJ-"+Date.now();
   const status      = data?.order?.status    || data?.status    || "BOOKING_SUBMITTED";
   console.log(`[TJ book] OK id=${confirmedId} status=${status}`);
   res.json({ data: { id: confirmedId, status, _source:"tripjack", raw:data } });
  } else {
   if (!AMADEUS_CLIENT_ID) return res.status(503).json({ error:"Amadeus not configured" });
   const data = await amPost("/v1/booking/flight-orders", { data:{ type:"flight-order", flightOffers:[flightOffer], travelers, contacts } });
   res.json(data);
  }
 } catch(e) {
  const errData = e.response?.data;
  const msg =
   errData?.errors?.[0]?.detail ||
   errData?.message ||
   errData?.status?.message ||
   errData?.error ||
   (typeof errData === "string" ? errData : null) ||
   e.message;
  console.error("[flights] book error:", JSON.stringify(errData));
  res.status(500).json({ error: msg, _detail: errData });
 }
});

// TripJack: Fare rule — cancellation / reschedule / no-show policy
app.post("/api/flights/fare-rule", async (req, res) => {
 if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
 const { priceId, bookingId, flowType="SEARCH" } = req.body;
 const id = bookingId || priceId;
 if (!id) return res.status(400).json({ error:"priceId or bookingId required" });
 try {
  const data = await tjPost("/fms/v2/farerule", { flowType, id });
  res.json({ data });
 } catch(e) {
  res.status(500).json({ error: e.response?.data?.message || e.message });
 }
});

// TripJack: Booking details — PNR, ticket numbers, status
app.post("/api/flights/booking-details", async (req, res) => {
 if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
 const { bookingId, requirePaxPricing=false } = req.body;
 if (!bookingId) return res.status(400).json({ error:"bookingId required" });
 try {
  const detailReq = { bookingId, requirePaxPricing };
  uatSave("BookingDetailRequest.json", { bookingId });
  const data = await tjPost("/oms/v1/booking-details", detailReq);
  uatSave("BookingDetailResponse.json", data);
  res.json({ data });
 } catch(e) {
  res.status(500).json({ error: e.response?.data?.message || e.message });
 }
});

// TripJack: Get cancellation / void amendment charges
app.post("/api/flights/amendment-charges", async (req, res) => {
 if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
 const { bookingId, type, remarks, trips } = req.body;
 if (!bookingId || !type) return res.status(400).json({ error:"bookingId and type required" });
 try {
  const body = { bookingId, type, remarks: remarks || "Cancellation request" };
  if (trips?.length) body.trips = trips;
  const data = await tjPost("/oms/v1/air/amendment/amendment-charges", body);
  res.json({ data });
 } catch(e) {
  res.status(500).json({ error: e.response?.data?.message || e.message });
 }
});

// TripJack: Submit cancellation / void / full-refund amendment
app.post("/api/flights/submit-amendment", async (req, res) => {
 if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
 const { bookingId, type, remarks, trips } = req.body;
 if (!bookingId || !type || !remarks) return res.status(400).json({ error:"bookingId, type and remarks required" });
 try {
  const body = { bookingId, type, remarks };
  if (trips?.length) body.trips = trips;
  const data = await tjPost("/oms/v1/air/amendment/submit-amendment", body);
  res.json({ data });
 } catch(e) {
  res.status(500).json({ error: e.response?.data?.message || e.message });
 }
});

// TripJack: Poll amendment status
app.post("/api/flights/amendment-details", async (req, res) => {
 if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
 const { amendmentId } = req.body;
 if (!amendmentId) return res.status(400).json({ error:"amendmentId required" });
 try {
  const data = await tjPost("/oms/v1/air/amendment/amendment-details", { amendmentId });
  res.json({ data });
 } catch(e) {
  res.status(500).json({ error: e.response?.data?.message || e.message });
 }
});

// ─── TRIPJACK HOTEL SEARCH & BOOKING ─────────────────────────────────────────

// Diagnostic: probe TripJack hotel city endpoints to find the correct one
// Usage: GET /api/hotels/probe-city?q=Delhi
app.get("/api/hotels/probe-city", async (req, res) => {
 if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
 const q = req.query.q || "Delhi";
 const probes = [
  { method:"GET",  path:`/hms/v1/city?search=${encodeURIComponent(q)}` },
  { method:"GET",  path:`/hms/v1/city?name=${encodeURIComponent(q)}` },
  { method:"GET",  path:`/hms/v1/city?query=${encodeURIComponent(q)}` },
  { method:"GET",  path:`/hms/v1/static/city?search=${encodeURIComponent(q)}` },
  { method:"GET",  path:`/hms/v1/common/city?search=${encodeURIComponent(q)}` },
  { method:"GET",  path:`/hms/v1/master/city?search=${encodeURIComponent(q)}` },
  { method:"GET",  path:`/hms/v2/city?search=${encodeURIComponent(q)}` },
  { method:"POST", path:`/hms/v1/city`, body:{ search:q } },
  { method:"POST", path:`/hms/v1/city-master`, body:{ cityName:q } },
  { method:"POST", path:`/hms/v1/static/city`, body:{ name:q } },
 ];
 const results = [];
 for (const p of probes) {
  try {
   const r = p.method === "POST" ? await tjPost(p.path, p.body) : await tjGet(p.path);
   results.push({ probe: `${p.method} ${p.path}`, status:"OK", data: JSON.stringify(r).substring(0,300) });
  } catch(e) {
   results.push({ probe: `${p.method} ${p.path}`, status:`ERR ${e.response?.status||"?"}`, msg: e.response?.data?.message || e.message });
  }
 }
 res.json({ query:q, results });
});

// Static TripJack city ID map — used as fallback when live city search unavailable
const TJ_CITY_MAP = [
 { cityName:"Delhi",       country_code:"IN", countryName:"India",     cityId:"130443" },
 { cityName:"Mumbai",      country_code:"IN", countryName:"India",     cityId:"130414" },
 { cityName:"Goa",         country_code:"IN", countryName:"India",     cityId:"130552" },
 { cityName:"Bangalore",   country_code:"IN", countryName:"India",     cityId:"130444" },
 { cityName:"Hyderabad",   country_code:"IN", countryName:"India",     cityId:"130449" },
 { cityName:"Chennai",     country_code:"IN", countryName:"India",     cityId:"130416" },
 { cityName:"Kolkata",     country_code:"IN", countryName:"India",     cityId:"130447" },
 { cityName:"Jaipur",      country_code:"IN", countryName:"India",     cityId:"130453" },
 { cityName:"Agra",        country_code:"IN", countryName:"India",     cityId:"130440" },
 { cityName:"Udaipur",     country_code:"IN", countryName:"India",     cityId:"130455" },
 { cityName:"Kochi",       country_code:"IN", countryName:"India",     cityId:"130458" },
 { cityName:"Pune",        country_code:"IN", countryName:"India",     cityId:"130459" },
 { cityName:"Ahmedabad",   country_code:"IN", countryName:"India",     cityId:"130460" },
 { cityName:"Amritsar",    country_code:"IN", countryName:"India",     cityId:"130462" },
 { cityName:"Srinagar",    country_code:"IN", countryName:"India",     cityId:"130463" },
 { cityName:"Leh",         country_code:"IN", countryName:"India",     cityId:"130464" },
 { cityName:"Manali",      country_code:"IN", countryName:"India",     cityId:"130465" },
 { cityName:"Shimla",      country_code:"IN", countryName:"India",     cityId:"130466" },
 { cityName:"Darjeeling",  country_code:"IN", countryName:"India",     cityId:"130467" },
 { cityName:"Mysore",      country_code:"IN", countryName:"India",     cityId:"130471" },
 { cityName:"Ooty",        country_code:"IN", countryName:"India",     cityId:"130472" },
 { cityName:"Munnar",      country_code:"IN", countryName:"India",     cityId:"130474" },
 { cityName:"Alleppey",    country_code:"IN", countryName:"India",     cityId:"130475" },
 { cityName:"Port Blair",  country_code:"IN", countryName:"India",     cityId:"130476" },
 { cityName:"Rishikesh",   country_code:"IN", countryName:"India",     cityId:"130477" },
 { cityName:"Varanasi",    country_code:"IN", countryName:"India",     cityId:"130454" },
 { cityName:"Bangkok",     country_code:"TH", countryName:"Thailand",  cityId:"138001" },
 { cityName:"Phuket",      country_code:"TH", countryName:"Thailand",  cityId:"138002" },
 { cityName:"Singapore",   country_code:"SG", countryName:"Singapore", cityId:"138003" },
 { cityName:"Dubai",       country_code:"AE", countryName:"UAE",       cityId:"138004" },
 { cityName:"Bali",        country_code:"ID", countryName:"Indonesia",  cityId:"138005" },
 { cityName:"London",      country_code:"GB", countryName:"UK",        cityId:"138006" },
 { cityName:"Paris",       country_code:"FR", countryName:"France",    cityId:"138007" },
 { cityName:"Maldives",    country_code:"MV", countryName:"Maldives",  cityId:"138009" },
 { cityName:"Colombo",     country_code:"LK", countryName:"Sri Lanka", cityId:"138010" },
 { cityName:"Kathmandu",   country_code:"NP", countryName:"Nepal",     cityId:"138011" },
 { cityName:"Abu Dhabi",   country_code:"AE", countryName:"UAE",       cityId:"138012" },
];

// Hotel city search autocomplete — searches local Supabase table first, merges TripJack if configured
app.get("/api/hotels/cities", async (req, res) => {
 try {
  const { q="" } = req.query;
  if (q.length < 1) return res.json({ data:[] });
  const sq = q.trim();
  const results = [];
  const seen = new Set();

  // ── Local DB (always available) ─────────────────────────────────────────
  if (supabase) {
   const { data: local } = await db.from("travel_cities")
    .select("id,name,state,country,country_code,tj_city_id")
    .ilike("name", `%${sq}%`)
    .order("country_code", { ascending: true })
    .limit(12);
   (local || []).forEach(c => {
    const key = c.name + "|" + c.country_code;
    if (!seen.has(key)) {
     seen.add(key);
     results.push({ id: c.id, cityId: c.tj_city_id || null, cityName: c.name, state: c.state, countryName: c.country, countryCode: c.country_code });
    }
   });
  }

  // ── TripJack city ID enrichment — try known HMS city search patterns ──────
  if (TJ_KEY && results.filter(r=>r.cityId).length < 3) {
   const tjCityEndpoints = [
    `/hms/v1/city?search=${encodeURIComponent(sq)}`,
    `/hms/v1/static/city?name=${encodeURIComponent(sq)}`,
    `/hms/v1/common/city?query=${encodeURIComponent(sq)}`,
   ];
   for (const ep of tjCityEndpoints) {
    try {
     const tjData = await tjGet(ep);
     const tjList = tjData?.data || tjData?.cities || tjData?.results || [];
     if (!tjList.length) continue;
     tjList.forEach(c => {
      const key = (c.cityName||c.name||"") + "|" + (c.countryCode||"IN");
      if (!seen.has(key)) {
       seen.add(key);
       results.unshift({ id: null, cityId: c.cityId||c.id, cityName: c.cityName||c.name, countryName: c.countryName||c.country, countryCode: c.countryCode||"IN" });
      } else {
       const ex = results.find(r => r.cityName===(c.cityName||c.name) && r.countryCode===(c.countryCode||"IN"));
       if (ex && !ex.cityId && (c.cityId||c.id)) ex.cityId = c.cityId||c.id;
      }
     });
     const toCache = tjList.filter(c => c.cityId||c.id).map(c => ({
      name: c.cityName||c.name, country: c.countryName||"", country_code: c.countryCode||"IN", tj_city_id: String(c.cityId||c.id),
     }));
     if (toCache.length && supabase) db.from("travel_cities").upsert(toCache, { onConflict:"name,country_code" }).catch(()=>{});
     break;
    } catch { /* try next endpoint */ }
   }
  }

  // ── Static map fallback — fills cityId gaps when HMS live search returns nothing ─
  if (results.filter(r => r.cityId).length < 3) {
   const ql = sq.toLowerCase();
   TJ_CITY_MAP.forEach(c => {
    if (!c.cityName.toLowerCase().includes(ql)) return;
    const key = c.cityName + "|" + c.country_code;
    if (!seen.has(key)) {
     seen.add(key);
     results.push({ id: null, cityId: c.cityId, cityName: c.cityName, countryName: c.countryName, countryCode: c.country_code });
    } else {
     const ex = results.find(r => r.cityName === c.cityName && r.countryCode === c.country_code);
     if (ex && !ex.cityId) ex.cityId = c.cityId;
    }
   });
  }

  res.json({ data: results.slice(0, 15) });
 } catch(e) {
  console.error("[hotels/cities] search:", e.message);
  res.status(500).json({ error: e.message });
 }
});

// Hotel search — resolves TripJack city ID from name if not provided, then searches
app.post("/api/hotels/search", async (req, res) => {
 try {
  if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured — add TRIPJACK_API_KEY to .env" });
  let { cityId, cityName, checkinDate, checkoutDate, adults=2, children=0, rooms=1, nationality="IN" } = req.body;
  if (!checkinDate || !checkoutDate) return res.status(400).json({ error:"checkinDate and checkoutDate are required" });

  // Resolve city ID from Supabase cache or static map
  if (!cityId && cityName) {
   if (supabase) {
    const { data: cached } = await db.from("travel_cities").select("tj_city_id").ilike("name", cityName).not("tj_city_id","is",null).limit(1);
    if (cached?.[0]?.tj_city_id) cityId = cached[0].tj_city_id;
   }
   // Static fallback for common Indian cities
   if (!cityId) {
    const CITY_MAP = {
     "delhi":130443,"new delhi":130443,"mumbai":130414,"bombay":130414,"goa":130552,
     "panaji":130552,"bangalore":130444,"bengaluru":130444,"hyderabad":130449,
     "chennai":130416,"madras":130416,"kolkata":130447,"calcutta":130447,
     "jaipur":130453,"agra":130440,"varanasi":130454,"udaipur":130455,
     "kochi":130458,"cochin":130458,"pune":130459,"ahmedabad":130460,
     "chandigarh":130461,"amritsar":130462,"srinagar":130463,"leh":130464,
     "manali":130465,"shimla":130466,"darjeeling":130467,"gangtok":130468,
     "bhubaneswar":130469,"coimbatore":130470,"mysore":130471,"mysuru":130471,
     "ooty":130472,"kodaikanal":130473,"munnar":130474,"alleppey":130475,
     "andaman":130476,"port blair":130476,"rishikesh":130477,"haridwar":130478,
     "bangkok":138001,"phuket":138002,"singapore":138003,"dubai":138004,
     "bali":138005,"london":138006,"paris":138007,"new york":138008,
    };
    cityId = CITY_MAP[(cityName||"").toLowerCase().trim()];
   }
  }

  const roomInfo = Array.from({ length: Math.max(1, Number(rooms)) }, () => ({
   numberOfAdults: Math.max(1, Number(adults)),
   numberOfChild:  Math.max(0, Number(children)),
   childAge:       [],
  }));

  if (!cityId) return res.status(400).json({
   error:`No TripJack city ID found for "${cityName}". Enter the ID manually in the City ID field, or check the TripJack B2B portal Hotels section for the correct ID.`,
  });

  const searchQuery = { checkinDate, checkoutDate, roomInfo, nationality, currency:"INR", countryCode:"IN", cityId: String(cityId) };

  let data;
  try {
   data = await tjPost("/hms/v1/hotel-search", { searchQuery });
  } catch(e) {
   const errCode = e.response?.data?.errors?.[0]?.errCode;
   const msg     = e.response?.data?.errors?.[0]?.message || e.response?.data?.message || e.message;
   // errCode 810 = hotel module not activated on this API key
   if (errCode === "810") {
    return res.status(503).json({
     error: "TripJack Hotel (HMS) module is not activated for this API key. Please log into your TripJack B2B portal (apitest.tripjack.com), go to Settings → API Configuration, and ensure the Hotel module is enabled. Or contact apitechsupport@tripjack.com with your account ID 312747 to activate it.",
     errCode: "HMS_NOT_ACTIVATED",
    });
   }
   console.error("[hotels/search]", errCode, msg);
   return res.status(500).json({ error: msg });
  }
  res.json(data);
 } catch(e) {
  const msg = e.response?.data?.message || e.response?.data?.errors?.[0]?.message || e.message;
  console.error("[hotels/search]", msg);
  res.status(500).json({ error: msg });
 }
});

// Hotel room details — call after user picks a hotel to see room options
app.post("/api/hotels/rooms", async (req, res) => {
 try {
  if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
  const { hotelId, searchId } = req.body;
  if (!hotelId || !searchId) return res.status(400).json({ error:"hotelId and searchId are required" });
  const data = await tjPost("/hms/v1/room-details", { hotelId: String(hotelId), searchId });
  res.json(data);
 } catch(e) {
  res.status(500).json({ error: e.response?.data?.message || e.message });
 }
});

// Hotel pre-book — confirms live price, returns bookingId
app.post("/api/hotels/prebook", async (req, res) => {
 try {
  if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
  const { searchId, hotelId, rooms } = req.body;
  if (!searchId || !hotelId || !rooms?.length) return res.status(400).json({ error:"searchId, hotelId and rooms[] are required" });
  const data = await tjPost("/hms/v1/hotel-pre-book", { searchId, hotelId: String(hotelId), rooms });
  res.json(data);
 } catch(e) {
  res.status(500).json({ error: e.response?.data?.message || e.message });
 }
});

// Hotel booking — finalises booking using pre-book bookingId
app.post("/api/hotels/book", async (req, res) => {
 try {
  if (!TJ_KEY) return res.status(503).json({ error:"TripJack not configured" });
  const { bookingId, guestDetails, paymentInfo } = req.body;
  if (!bookingId || !guestDetails) return res.status(400).json({ error:"bookingId and guestDetails are required" });
  const data = await tjPost("/hms/v1/hotel-book", { bookingId, guestDetails, paymentInfo });
  res.json(data);
 } catch(e) {
  res.status(500).json({ error: e.response?.data?.message || e.message });
 }
});

// ─────────────────────────────────────────────────────────────────────────────
// ITINERARIES — full CRUD
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/itineraries", async (req, res) => {
 const { data, error } = await db.from("itineraries").select("*").order("created_at", { ascending: false });
 if (error) return res.status(500).json({ error: error.message });
 res.json(data || []);
});
app.post("/api/itineraries", async (req, res) => {
 const row = { ...req.body, created_at: req.body.created_at || new Date() };
 if (!row.id) row.id = genId("IT");
 const { data, error } = await db.from("itineraries").upsert(row, { onConflict: "id" }).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.patch("/api/itineraries/:id", async (req, res) => {
 const { data, error } = await db.from("itineraries").update({ ...req.body, updated_at: new Date() }).eq("id", req.params.id).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.json(data);
});
app.delete("/api/itineraries/:id", async (req, res) => {
 const { error } = await db.from("itineraries").delete().eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
// ─────────────────────────────────────────────────────────────────────────────
// TASKS — full CRUD
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/tasks", async (req, res) => {
 const { data, error } = await db.from("tasks").select("*").order("created_at", { ascending: false });
 if (error) return res.status(500).json({ error: error.message });
 res.json(data || []);
});
app.post("/api/tasks", async (req, res) => {
 const row = { ...req.body, created_at: req.body.created_at || new Date() };
 if (!row.id) row.id = genId("T");
 const { data, error } = await db.from("tasks").upsert(row, { onConflict: "id" }).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.patch("/api/tasks/:id", async (req, res) => {
 const { data, error } = await db.from("tasks").update(req.body).eq("id", req.params.id).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.json(data);
});
app.delete("/api/tasks/:id", async (req, res) => {
 const { error } = await db.from("tasks").delete().eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
// ─────────────────────────────────────────────────────────────────────────────
// QUOTES — full CRUD (supplements existing AI-generate endpoint)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/quotes", async (req, res) => {
 const { data, error } = await db.from("quotes").select("*").order("created_at", { ascending: false });
 if (error) return res.status(500).json({ error: error.message });
 res.json(data || []);
});
app.post("/api/quotes", async (req, res) => {
 const row = { ...req.body, created_at: req.body.created_at || new Date() };
 if (!row.id) row.id = genId("Q");
 const { data, error } = await db.from("quotes").upsert(row, { onConflict: "id" }).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.patch("/api/quotes/:id", async (req, res) => {
 const { data, error } = await db.from("quotes").update(req.body).eq("id", req.params.id).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.json(data);
});
app.delete("/api/quotes/:id", async (req, res) => {
 const { error } = await db.from("quotes").delete().eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
// ─────────────────────────────────────────────────────────────────────────────
// INVOICES — manual create + update + delete (supplement existing endpoints)
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/invoices", async (req, res) => {
 const row = { ...req.body, created_at: req.body.created_at || new Date() };
 if (!row.id) row.id = genId("INV");
 const { data, error } = await db.from("invoices").upsert(row, { onConflict: "id" }).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.patch("/api/invoices/:id", async (req, res) => {
 const { data, error } = await db.from("invoices").update(req.body).eq("id", req.params.id).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.json(data);
});
app.delete("/api/invoices/:id", async (req, res) => {
 const { error } = await db.from("invoices").delete().eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
// ─────────────────────────────────────────────────────────────────────────────
// VOUCHERS — manual create + update + delete (supplement existing endpoints)
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/vouchers", async (req, res) => {
 const row = { ...req.body, created_at: req.body.created_at || new Date() };
 if (!row.id) row.id = genId("VCH");
 const { data, error } = await db.from("vouchers").upsert(row, { onConflict: "id" }).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.patch("/api/vouchers/:id", async (req, res) => {
 const { data, error } = await db.from("vouchers").update({ ...req.body, updated_at: new Date() }).eq("id", req.params.id).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.json(data);
});
app.delete("/api/vouchers/:id", async (req, res) => {
 const { error } = await db.from("vouchers").delete().eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
// ─────────────────────────────────────────────────────────────────────────────
// USERS (crm_users) — full CRUD
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/users", async (req, res) => {
 const { data, error } = await db.from("crm_users").select("*").order("name");
 if (error) return res.status(500).json({ error: error.message });
 res.json(data || []);
});
app.post("/api/users", async (req, res) => {
 const row = { ...req.body, created_at: req.body.created_at || new Date(), updated_at: new Date() };
 if (!row.id) row.id = genId("U");
 const { data, error } = await db.from("crm_users").upsert(row, { onConflict: "id" }).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.patch("/api/users/:id", async (req, res) => {
 const { data, error } = await db.from("crm_users").update({ ...req.body, updated_at: new Date() }).eq("id", req.params.id).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.json(data);
});
app.delete("/api/users/:id", async (req, res) => {
 const { error } = await db.from("crm_users").delete().eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
// ─────────────────────────────────────────────────────────────────────────────
// ROLES (crm_roles) — full CRUD
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/roles", async (req, res) => {
 const { data, error } = await db.from("crm_roles").select("*").order("name");
 if (error) return res.status(500).json({ error: error.message });
 res.json(data || []);
});
app.post("/api/roles", async (req, res) => {
 const row = { ...req.body, created_at: req.body.created_at || new Date() };
 if (!row.id) row.id = genId("R");
 const { data, error } = await db.from("crm_roles").upsert(row, { onConflict: "id" }).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.patch("/api/roles/:id", async (req, res) => {
 const { data, error } = await db.from("crm_roles").update(req.body).eq("id", req.params.id).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.json(data);
});
app.delete("/api/roles/:id", async (req, res) => {
 const { error } = await db.from("crm_roles").delete().eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS — create + delete (GET + mark-all-read already exist above)
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/notifications", async (req, res) => {
 const { data, error } = await db.from("notifications").insert(req.body).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.delete("/api/notifications/:id", async (req, res) => {
 const { error } = await db.from("notifications").delete().eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
// ─────────────────────────────────────────────────────────────────────────────
// LEAD DOCUMENTS — Supabase Storage bucket: "lead-docs"
// Create the bucket once: Supabase Dashboard → Storage → New bucket →
//   Name: lead-docs  |  Public: OFF  |  File size limit: 20 MB
// ─────────────────────────────────────────────────────────────────────────────
const LEAD_DOCS_BUCKET = "lead-docs";

// Auto-create the storage bucket on startup if it doesn't exist
(async () => {
 if (!supabase) return;
 try {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = (buckets || []).some(b => b.name === LEAD_DOCS_BUCKET);
  if (!exists) {
   const { error } = await supabase.storage.createBucket(LEAD_DOCS_BUCKET, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024, // 20 MB
   });
   if (error) console.warn("[Storage] Could not create bucket:", error.message);
   else console.log(`[Storage] Bucket "${LEAD_DOCS_BUCKET}" created.`);
  } else {
   console.log(`[Storage] Bucket "${LEAD_DOCS_BUCKET}" ready.`);
  }
 } catch (e) { console.warn("[Storage] Bucket check failed:", e.message); }
})();

app.get("/api/leads/:id/documents", async (req, res) => {
 const { data, error } = await db.from("lead_documents").select("*").eq("lead_id", req.params.id).order("created_at", { ascending: false });
 if (error) return res.status(500).json({ error: error.message });
 res.json(data || []);
});

app.post("/api/leads/:id/documents", withUpload(upload.single("file")), async (req, res) => {
 if (!req.file) return res.status(400).json({ error: "No file uploaded" });
 if (!supabase) return res.status(503).json({ error: "Supabase not configured" });
 const leadId = req.params.id;
 const { doc_type = "other", notes = "", uploaded_by = "" } = req.body;

 // Ensure the lead exists in Supabase so the FK constraint is satisfied.
 // The lead may only exist in the browser's localStorage (not yet synced to DB).
 if (req.body.lead_data) {
  try {
   const ld = JSON.parse(req.body.lead_data);
   await db.from("leads").upsert(sanitizeLead({ id: leadId, name: ld.name || "Unknown", email: ld.email || null, phone: ld.phone || null, destination: ld.destination || null, status: ld.status || "New" }), { onConflict: "id", ignoreDuplicates: true });
  } catch (e) { console.warn("[docs upload] lead upsert failed:", e.message); }
 }

 const safeName = req.file.originalname.replace(/[^\w.\-]/g, "_");
 const storagePath = `${leadId}/${Date.now()}_${safeName}`;
 // Upload file to Supabase Storage
 const { error: stErr } = await supabase.storage
  .from(LEAD_DOCS_BUCKET)
  .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
 if (stErr) return res.status(400).json({ error: `Storage error: ${stErr.message}` });
 // Save metadata
 const row = {
  lead_id: leadId, file_name: safeName, original_name: req.file.originalname,
  file_type: req.file.mimetype, doc_type, storage_path: storagePath,
  file_size: req.file.size, uploaded_by, notes,
 };
 const { data, error: dbErr } = await db.from("lead_documents").insert(row).select().single();
 if (dbErr) {
  await supabase.storage.from(LEAD_DOCS_BUCKET).remove([storagePath]).catch(() => {});
  return res.status(400).json({ error: dbErr.message });
 }
 res.status(201).json(data);
});

app.get("/api/leads/documents/:docId/url", async (req, res) => {
 if (!supabase) return res.status(503).json({ error: "Supabase not configured" });
 const { data: doc } = await db.from("lead_documents").select("storage_path,file_name,file_type").eq("id", req.params.docId).single();
 if (!doc) return res.status(404).json({ error: "Document not found" });
 const { data, error } = await supabase.storage.from(LEAD_DOCS_BUCKET).createSignedUrl(doc.storage_path, 3600);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ url: data.signedUrl, file_name: doc.file_name, file_type: doc.file_type });
});

app.delete("/api/leads/documents/:docId", async (req, res) => {
 if (!supabase) return res.status(503).json({ error: "Supabase not configured" });
 const { data: doc } = await db.from("lead_documents").select("storage_path").eq("id", req.params.docId).single();
 if (!doc) return res.status(404).json({ error: "Document not found" });
 await supabase.storage.from(LEAD_DOCS_BUCKET).remove([doc.storage_path]).catch(() => {});
 const { error } = await db.from("lead_documents").delete().eq("id", req.params.docId);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// REACT ROUTER FALLBACK (production) — any non-API route serves index.html
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
 const BUILD = path.join(__dirname, "../frontend/build");
 app.get(/^(?!\/api|\/health|\/webhook).*/, (req, res) => {
  res.sendFile(path.join(BUILD, "index.html"));
 });
}
// Global error handler — catches anything Express v5 auto-forwards via next(err)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
 console.error("[global-error]", err.message, err.stack?.split("\n")[1] || "");
 if (res.headersSent) return;
 res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
 console.log(`\n Safarnaama CRM API running on port ${PORT}`);
 console.log(` Supabase: ${supabase ? "configured ✓" : "NOT configured ✗ — check .env"}`);
 console.log(` File backup path: ${EMAIL_CFG_FILE}`);
 // Verify email config is loadable on startup
 try {
  const cfg = await getEmailCfg();
  if (cfg?.imap_host) {
   const src = (() => { try { return require("fs").existsSync(EMAIL_CFG_FILE) && !supabase ? "file" : supabase ? "Supabase" : "file"; } catch { return "?"; } })();
   console.log(` Email config: ${cfg.username} → IMAP ${cfg.imap_host}:${cfg.imap_port} (loaded from ${src}) ✓`);
  } else {
   console.log(` Email config: NOT FOUND — go to Settings → Email and save your config`);
  }
 } catch (e) { console.warn(` Email config check failed: ${e.message}`); }
 console.log(` Inbound webhook: POST /webhook/inbound-email\n`);
 await autoSeedAdmin();
});
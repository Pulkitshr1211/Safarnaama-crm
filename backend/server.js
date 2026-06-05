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
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sgMail = require("@sendgrid/mail");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { createWorker } = require("tesseract.js");
const XLSX = require("xlsx");
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
// Supabase helper — no-ops gracefully when DB not configured
const db = {
 from: tbl => supabase
  ? db.from(tbl)
  : { select: () => Promise.resolve({ data:[], error:null }),
      insert: () => Promise.resolve({ data:null, error:null }),
      upsert: () => Promise.resolve({ data:null, error:null }),
      update: () => ({ eq: () => Promise.resolve({ data:null, error:null }) }),
      delete: () => ({ eq: () => Promise.resolve({ data:null, error:null }) }),
    },
};
// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// ─── HELPERS ─────────────────────────────────────────────────────────────────
const genId = (prefix) => `${prefix}${Date.now().toString().slice(-6)}`;
const genQueryCode = () =>
 `QC-${new Date().getFullYear().toString().slice(-2)}${String(new Date().getMonth()+1).padStart(2,"0")}-${Math.floor(Math.random()*9000+1000)}`;
// Call Claude AI
async function callClaude(prompt, system = "", maxTokens = 1500) {
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
  timeout: 180000, // 3 minute timeout
 }
 );
 const text = res.data.content?.map(b => b.text || "").join("") || "";
 return text;
}
const ocrWorker = createWorker();
let ocrReady = false;
async function ensureOcr() {
 if (ocrReady) return;
 await ocrWorker.load();
 await ocrWorker.loadLanguage("eng");
 await ocrWorker.initialize("eng");
 ocrReady = true;
}
async function extractTextFromFile(file) {
 if (!file) return "";
 const filename = (file.originalname || "").toLowerCase();
 if (filename.endsWith(".pdf")) {
  const pdf = await pdfParse(file.buffer);
  return pdf.text || "";
 }
 if (filename.endsWith(".docx") || file.mimetype.includes("word")) {
  const result = await mammoth.extractRawText({ buffer: file.buffer });
  return result.value || "";
 }
 if (filename.endsWith(".xls") || filename.endsWith(".xlsx")) {
  const workbook = XLSX.read(file.buffer, { type: "buffer" });
  const sheets = workbook.SheetNames;
  let text = "";
  sheets.forEach(sheet => {
   const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { defval: "" });
   text += JSON.stringify(rows, null, 2) + "\n";
  });
  return text;
 }
 if (filename.match(/\.(png|jpe?g|bmp)$/i) || file.mimetype.startsWith("image/")) {
  await ensureOcr();
  const { data: { text } } = await ocrWorker.recognize(file.buffer);
  return text || "";
 }
 return file.buffer.toString("utf8");
}
function parseCSV(text) {
 const lines = text.split(/\r?\n/).filter(l => l.trim());
 if (!lines.length) return [];
 const headers = lines[0].split(/,|\t/).map(h => h.trim().toLowerCase());
 return lines.slice(1).map(line => {
  const values = line.split(/,|\t/).map(c => c.trim());
  const row = {};
  headers.forEach((header, idx) => { row[header] = values[idx] || ""; });
  return row;
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
 return {
  name: row.name || row.vendor_name || row.company || row.supplier || "",
  email: row.email || row.email_address || "",
  email2: row.email2 || row.alt_email || row.alternate_email || "",
  phone: row.phone || row.mobile || row.contact || "",
  destination: row.destination || row.location || row.region || "",
  category: row.category || row.type || row.business || "",
  rating: row.rating || row.score || "",
  status: row.status || "Active",
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
    ? `Extract lead records from the following text and return ONLY valid JSON array of objects with keys: name, email, phone, destination, pax, kids, budget, travel_date, end_date, notes, assigned_to. If a field is missing, use an empty string or omit it. Text:\n${trimmed.slice(0, 20000)}`
    : `Extract vendor records from the following text and return ONLY valid JSON array of objects with keys: name, email, email2, phone, destination, category, rating, status. If a field is missing, use an empty string or omit it. Text:\n${trimmed.slice(0, 20000)}`;
  const ai = await callClaude(prompt);
  const cleaned = ai.replace(/```json\s*|```/gi, "").trim();
  try {
   const json = JSON.parse(cleaned);
   parsed = Array.isArray(json) ? json : [json];
  } catch (e) {
   throw new Error("Could not extract structured data from the uploaded file.");
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
app.get("/api/leads", async (req, res) => {
 const { data, error } = await db.from("leads").select("*").order("created_at", { ascending: false });
 if (error) return res.status(500).json({ error: error.message });
 res.json(data);
});
app.post("/api/leads", async (req, res) => {
 const lead = { id: genId("L"), ...req.body, status: "New", created_at: new Date() };
 const { data, error } = await db.from("leads").insert(lead).select().single();
 if (error) return res.status(400).json({ error: error.message });
 await notify(`New lead created: ${lead.name} — ${lead.destination}`, "lead");
 res.status(201).json(data);
});
app.patch("/api/leads/:id", async (req, res) => {
 const { data, error } = await db.from("leads").update(req.body).eq("id", req.params.id).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.json(data);
});
app.delete("/api/leads/:id", async (req, res) => {
 const { error } = await db.from("leads").delete().eq("id", req.params.id);
 if (error) return res.status(400).json({ error: error.message });
 res.json({ success: true });
});
app.post("/api/import/leads", upload.single("doc"), async (req, res) => {
 try {
  const rawText = req.file ? await extractTextFromFile(req.file) : (req.body.raw_content || "");
  const items = await parseImportedEntities(rawText, "leads");
  if (!items.length) return res.status(422).json({ error: "No lead records could be extracted from the uploaded file." });
  const prepared = items.map(item => ({ id: genId("L"), ...item, status: item.status || "New", created_at: new Date() }));
  if (supabase) {
   const { data, error } = await db.from("leads").insert(prepared).select();
   if (error) return res.status(400).json({ error: error.message });
   return res.json({ items: data || prepared });
  }
  res.json({ items: prepared });
 } catch (err) {
  console.error(err);
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
 const vendor = { id: genId("V"), ...req.body, status: "Active" };
 const { data, error } = await db.from("vendors").insert(vendor).select().single();
 if (error) return res.status(400).json({ error: error.message });
 res.status(201).json(data);
});
app.post("/api/import/vendors", upload.single("doc"), async (req, res) => {
 try {
  const rawText = req.file ? await extractTextFromFile(req.file) : (req.body.raw_content || "");
  const items = await parseImportedEntities(rawText, "vendors");
  if (!items.length) return res.status(422).json({ error: "No vendor records could be extracted from the uploaded file." });
  const prepared = items.map(item => ({ id: genId("V"), ...item, status: item.status || "Active" }));
  if (supabase) {
   const { data, error } = await db.from("vendors").insert(prepared).select();
   if (error) return res.status(400).json({ error: error.message });
   return res.json({ items: data || prepared });
  }
  res.json({ items: prepared });
 } catch (err) {
  console.error(err);
  res.status(500).json({ error: err.message || "Import failed" });
 }
});
// Vendor upload their own package (from vendor portal)
app.post("/api/vendors/:id/packages", upload.single("doc"), async (req, res) => {
 const vendorId = req.params.id;
 let rawContent = req.body.raw_content || "";
 // If file uploaded, extract text
 if (req.file) {
 try {
 if (req.file.mimetype === "application/pdf") {
 const pdf = await pdfParse(req.file.buffer);
 rawContent = pdf.text;
 } else if (req.file.mimetype.includes("word") || req.file.originalname.endsWith(".docx")) {
 const result = await mammoth.extractRawText({ buffer: req.file.buffer });
 rawContent = result.value;
 } else {
 rawContent = req.file.buffer.toString("utf8");
 }
 } catch (e) {
 rawContent = req.body.raw_content || "Could not extract text";
 }
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
// ────────────────────────────────────────────────────────────────────────────
// INBOUND EMAIL WEBHOOK (SendGrid Inbound Parse)
// Configure in SendGrid: Mail Settings → Inbound Parse
// Destination URL: https://your-api.com/webhook/inbound-email
// MX Record: point enquiry subdomain to mx.sendgrid.net
// ────────────────────────────────────────────────────────────────────────────
app.post("/webhook/inbound-email", upload.any(), async (req, res) => {
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
 // ── Use Claude to extract pricing from vendor reply ───────────────────────
 const extractPrompt = `A travel vendor has replied to a quote request. Extract key pricing and package information from their email.
Email From: ${from}
Subject: ${subject}
Body:
${text.slice(0, 2000)}
Return ONLY JSON: { vendorName, destination, hotelName, roomType, pricePerPax, totalCost, inclusions:[], validTill, notes }`;
 const extracted = await callClaude(extractPrompt);
 let vendorQuote = {};
 try { vendorQuote = JSON.parse(extracted.replace(/```json|```/g, "").trim()); } catch {}
 // ── Apply markup from settings ────────────────────────────────────────────
 const { data: settingsRow } = await db.from("app_settings").select("value").eq("key", "markup").single();
 const markup = settingsRow?.value || { hotel4star: 22 };
 const markupPct = markup.hotel4star || 22;
 const rawCost = Number(vendorQuote.totalCost) || 0;
 const markedUpCost = rawCost > 0 ? Math.round(rawCost * (1 + markupPct / 100)) : 0;
 // ── Update quote with vendor reply ───────────────────────────────────────
 const reply = {
 from, receivedAt: new Date().toISOString(),
 vendor: vendorQuote.vendorName || from,
 rawCost, markupPct, finalCost: markedUpCost, details: vendorQuote
 };
 const lead = quote.leads;
 const currentReplies = quote.vendor_replies || [];
 await db.from("quotes").update({
 vendor_replies: [...currentReplies, reply],
 status: "Quote Received",
 final_amount: markedUpCost,
 markup_applied: markupPct,
 }).eq("query_code", queryCode);
 await db.from("leads").update({ status: "Quote Received" }).eq("id", lead.id);
 // ── Build and send quote to the main user (lead) ──────────────────────────
 if (lead?.email) {
 const clientHtml = `
 <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
 <div style="background:#0D2030;color:#E8F4FD;padding:16px;border-radius:8px;margin-bottom:20px">
 <strong>Safarnaama Holidays</strong> — Your Travel Quote<br/>
 <small>Reference: <strong>${queryCode}</strong></small>
 </div>
 <h2 style="color:#1A6B8A">Quote for ${lead.destination}</h2>
 <table style="width:100%;border-collapse:collapse">
 <tr><td style="padding:8px;border:1px solid #eee"><strong>Hotel</strong></td><td style="padding:8px;border:1px solid #eee">${vendorQuote.hotelName || "To be confirmed"}</td></tr>
 <tr><td style="padding:8px;border:1px solid #eee"><strong>Room Type</strong></td><td style="padding:8px;border:1px solid #eee">${vendorQuote.roomType || "N/A"}</td></tr>
 <tr><td style="padding:8px;border:1px solid #eee"><strong>Per Person</strong></td><td style="padding:8px;border:1px solid #eee">₹${(markedUpCost / (lead.pax || 1)).toLocaleString("en-IN")}</td></tr>
 <tr style="background:#f9f9f9"><td style="padding:8px;border:1px solid #eee"><strong>Total (${lead.pax} pax)</strong></td><td style="padding:8px;border:1px solid #eee"><strong style="color:#2E7D32">₹${markedUpCost.toLocaleString("en-IN")}</strong></td></tr>
 </table>
 ${vendorQuote.inclusions?.length ? `<p><strong>Inclusions:</strong> ${vendorQuote.inclusions.join(", ")}</p>` : ""}
 <p style="color:#888;font-size:12px">Valid till: ${vendorQuote.validTill || "Please confirm"}<br/>
 To confirm, reply to this email or call us. Quote Reference: ${queryCode}</p>
 </div>`;
 await sendEmail({
 to: lead.email,
 subject: `Your ${lead.destination} Travel Quote — ${queryCode}`,
 html: clientHtml,
 queryCode, leadId: lead.id, direction: "outbound"
 });
 await db.from("leads").update({ status: "Quote Sent" }).eq("id", lead.id);
 }
 // ── Notify admin & agents ─────────────────────────────────────────────────
 await notify(`Vendor reply received for ${queryCode} — ${lead?.destination}. Final quote ₹${markedUpCost.toLocaleString("en-IN")} forwarded to ${lead?.name}.`, "vendor");
 await sendEmail({
 to: ADMIN_EMAIL,
 subject: `[Admin] Vendor replied: ${queryCode}`,
 text: `Vendor ${vendorQuote.vendorName || from} replied for ${queryCode}.\nRaw cost: ₹${rawCost}\nMarkup (${markupPct}%): ₹${markedUpCost - rawCost}\nFinal sent to client: ₹${markedUpCost}`,
 direction: "outbound"
 });
 console.log(`[INBOUND] Processed ${queryCode} — final ₹${markedUpCost} sent to ${lead?.email}`);
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
app.post("/api/quotes/upload-doc", upload.single("doc"), async (req, res) => {
 let rawText = "";
 if (!req.file) return res.status(400).json({ error: "No file uploaded" });
 try {
 if (req.file.mimetype === "application/pdf") {
 const pdf = await pdfParse(req.file.buffer);
 rawText = pdf.text;
 } else if (req.file.originalname.endsWith(".docx") || req.file.mimetype.includes("word")) {
 const out = await mammoth.extractRawText({ buffer: req.file.buffer });
 rawText = out.value;
 } else {
 rawText = req.file.buffer.toString("utf8");
 }
 } catch (e) { rawText = req.file.buffer.toString("utf8"); }
 const aiPrompt = `Extract a vendor travel quote from this document. Return ONLY JSON:
${rawText.slice(0, 3000)}
{ vendorName, destination, pax, hotelName, roomType, perPersonCost, totalCost, inclusions:[], validTill, notes }`;
 const result = await callClaude(aiPrompt);
 let extracted = {};
 try { extracted = JSON.parse(result.replace(/```json|```/g, "").trim()); } catch {}
 const { data: settingsRow } = await db.from("app_settings").select("value").eq("key", "markup").single();
 const markup = settingsRow?.value || { hotel4star: 22 };
 const markupPct = markup.hotel4star || 22;
 const finalCost = Math.round((Number(extracted.totalCost) || 0) * (1 + markupPct / 100));
 res.json({ extracted, markupPct, finalCost, rawTextLength: rawText.length });
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
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
 console.log(`\n Safarnaama CRM API running on port ${PORT}`);
 console.log(` Enquiry inbox: ${ENQUIRY_EMAIL}`);
 console.log(` Inbound webhook: POST /webhook/inbound-email\n`);
});
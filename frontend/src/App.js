import { useState, useEffect, useRef } from "react";
// ─── BACKEND API BASE ─────────────────────────────────────────────────────────
// React dev server proxies /api/* → http://localhost:3002 via package.json "proxy"
const API = async (method, path, body, isForm = false) => {
 const opts = { method, headers: isForm ? {} : { "Content-Type": "application/json" } };
 if (body) opts.body = isForm ? body : JSON.stringify(body);
 // Try relative path first (CRA proxy in dev). If it returns 404, retry against backend host:3001.
 let res = await fetch(path, opts).catch(e => null);
 if (!res || res.status === 404) {
  try {
   const alt = `${window.location.protocol}//${window.location.hostname}:3001${path}`;
   res = await fetch(alt, opts);
  } catch (e) { /* fall through */ }
 }
 const data = await (res ? res.json().catch(() => ({})) : Promise.resolve({}));
 if (!res || !res.ok) throw new Error(data?.error || `HTTP ${res ? res.status : 'NO_RESPONSE'}`);
 return data;
};
// ─── CLAUDE AI HELPER — all calls proxied through backend ────────────────────
// Backend endpoint: POST /api/ai/claude  { prompt, system, maxTokens? }
// Returns: { text: "..." }
async function askClaude(prompt, system = "", maxTokens = 1500) {
 const data = await API("POST", "/api/ai/claude", {
  prompt,
  system: system || "You are a professional travel CRM assistant for Safarnaama Holidays. Always respond with valid JSON only when asked for JSON — no markdown fences, no extra text.",
  maxTokens,
 });
 return data.text || "";
}
async function askClaudeJSON(prompt, system = "", maxTokens = 1500) {
 const raw = await askClaude(prompt, system, maxTokens);
 // Helper: find the matching closing brace by counting brackets
 const extractJSON = (text) => {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
   if (text[i] === '{') depth++;
   else if (text[i] === '}') { depth--; if (depth === 0) return text.substring(start, i + 1); }
  }
  return null; // truncated — no matching }
 };
 // Strip markdown fences first
 const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
 // Try 1: direct parse of stripped text
 try { return JSON.parse(stripped); } catch {}
 // Try 2: bracket-counting extraction (handles preamble/postamble text)
 const extracted = extractJSON(stripped) || extractJSON(raw);
 if (extracted) {
  try { return JSON.parse(extracted); } catch {}
 }
 // All attempts failed
 console.error("[askClaudeJSON] Could not parse. Raw response:", raw);
 const preview = raw.substring(0, 150).replace(/\n/g, " ");
 throw new Error("AI returned unexpected format: " + preview);
}
// ─── LOCAL STORAGE DB (persists data across refresh) ─────────────────────────
const useDB = (key, initial) => {
 const [state, setState] = useState(() => {
 try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; }
 });
 const set = v => { const next = typeof v === "function" ? v(state) : v; setState(next); localStorage.setItem(key, JSON.stringify(next)); };
 return [state, set];
};
const genId = prefix => `${prefix}${Date.now().toString().slice(-6)}`;
const genQC = () => `QC-${new Date().getFullYear().toString().slice(-2)}${String(new Date().getMonth()+1).padStart(2,"0")}-${Math.floor(Math.random()*9000+1000)}`;
const today = () => new Date().toISOString().split("T")[0];
// ─── PORTAL URL HELPER ────────────────────────────────────────────────────────
// Returns the ?portal=<id> param from the current URL, or null
const getPortalIdFromURL = () => new URLSearchParams(window.location.search).get("portal");
// Reads a white-label config directly from localStorage (used at render time, before state is set)
const getPortalConfig = id => {
 try {
  const wls = JSON.parse(localStorage.getItem("sfn_whitelabels") || "[]");
  return wls.find(w => w.id === id) || null;
 } catch { return null; }
};
// Builds the full launch URL for a portal
const portalURL = id => `${window.location.origin}${window.location.pathname}?portal=${id}`;
// ─── SEED DATA ────────────────────────────────────────────────────────────────
const SEED_LEADS = [
 { id:"L001", name:"Rajesh Sharma", email:"rajesh@gmail.com", phone:"9876543210", destination:"Maldives", pax:2, kids:0, budget:"1,50,000", travel_date:"2026-07-15", end_date:"2026-07-18", status:"New", notes:"Honeymoon trip", assigned_to:"Priya", created_at: today() },
 { id:"L002", name:"Neha Gupta", email:"neha.g@yahoo.com", phone:"9812345678", destination:"Bali, Indonesia", pax:4, kids:1, budget:"2,00,000", travel_date:"2026-08-10", end_date:"2026-08-16", status:"Quote Sent", notes:"Family vacation", assigned_to:"Arjun", created_at: today() },
 { id:"L003", name:"Amit Verma", email:"amit.v@hotmail.com", phone:"9934567890", destination:"Switzerland", pax:2, kids:0, budget:"3,50,000", travel_date:"2026-09-01", end_date:"2026-09-07", status:"Confirmed", notes:"Anniversary", assigned_to:"Priya", created_at: today() },
];
const SEED_VENDORS = [
 { id:"V001", name:"Paradise Hotels Maldives", email:"sales@paradisemaldives.com", destination:"Maldives", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V002", name:"Bali Bliss Resorts", email:"bookings@balibliss.com", destination:"Bali, Indonesia", category:"Resort", rating:4.6, status:"Active" },
 { id:"V003", name:"Swiss Alpine Tours", email:"info@swissalpine.ch", destination:"Switzerland", category:"Tour Operator", rating:4.9, status:"Active" },
 { id:"V004", name:"Maldives Water Villas", email:"res@maldivesWV.com", destination:"Maldives", category:"Villa", rating:4.7, status:"Active" },
];
// ─── PERMISSIONS ─────────────────────────────────────────────────────────────
const PERMISSIONS = [
 { id:"leads",       label:"Leads Management" },
 { id:"quotes",      label:"Quotes" },
 { id:"invoices",    label:"Invoices" },
 { id:"vouchers",    label:"Vouchers" },
 { id:"vendors",     label:"Vendors" },
 { id:"tasks",       label:"Tasks" },
 { id:"assign_task", label:"Assign Task" },
 { id:"users",       label:"User Management" },
 { id:"roles",       label:"Role Management" },
 { id:"chat",        label:"AI Chat" },
 { id:"settings",    label:"Settings" },
 { id:"whitelabel",  label:"White Label Portals" },
 { id:"itinerary",   label:"Itinerary Builder" },
];
const ALL_PERMS = PERMISSIONS.map(p => p.id);
const SEED_ROLES = [
 { id:"R001", name:"Admin", description:"Full access to all modules", permissions: ALL_PERMS, created_at: today() },
 { id:"R002", name:"User", description:"Can work on assigned leads and tasks", permissions: ["leads","tasks","quotes","chat"], created_at: today() },
];
const SEED_USERS = [
 { id:"U001", name:"Admin User", email:"enquiry@SafarnaamaHolidays.com", role:"Admin", status:"Active", created_at: today() },
 { id:"U002", name:"Priya", email:"priya@SafarnaamaHolidays.com", role:"User", status:"Active", created_at: today() },
 { id:"U003", name:"Arjun", email:"arjun@SafarnaamaHolidays.com", role:"User", status:"Active", created_at: today() },
];
// ─── ICONS ────────────────────────────────────────────────────────────────────
const ICONS = {
 dashboard:"M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
 leads:"M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
 quote:"M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
 vendor:"M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z",
 invoice:"M9 5H7c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2h-2V3H9v2zm0 2h6v2H9V7zm-2 4h10v2H7v-2zm0 4h7v2H7v-2z",
 voucher:"M20 12c0-1.1.9-2 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-1.99.9-1.99 2v4c1.1 0 1.99.9 1.99 2s-.89 2-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2zm-5 5.5H9v-2h6v2zm0-4H9v-2h6v2zm0-4H9v-2h6v2z",
 settings:"M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
 bell:"M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
 plus:"M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
 search:"M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
 check:"M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
 close:"M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
 upload:"M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z",
 airplane:"M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z",
 send:"M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
 itinerary:"M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z",
 flight:"M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z",
 hotel_star:"M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4zM12 2.5l1.09 2.26L15.5 5l-1.68 1.64.39 2.36L12 7.76 9.79 9l.39-2.36L8.5 5l2.41-.24L12 2.5z",
 place:"M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
 route:"M17 10.43V2h-2v8.43c-.58.35-1 .99-1 1.57 0 1.1.9 2 2 2s2-.9 2-2c0-.58-.42-1.22-1-1.57zM11 5.5c0-1.1-.9-2-2-2s-2 .9-2 2c0 .58.42 1.22 1 1.57V14H6l4 4 4-4h-3V7.07c.58-.35 1-.99 1-1.57z",
 adventure:"M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z",
 meal:"M18.06 22.99h1.66c.84 0 1.53-.64 1.63-1.46L23 5.05h-5V1h-1.97v4.05h-4.97l.3 2.34c1.71.47 3.31 1.32 4.27 2.26 1.44 1.42 2.43 2.89 2.43 5.29v8.05zM1 21.99V21h15.03v.99c0 .55-.45 1-1.01 1H2.01c-.56 0-1.01-.45-1.01-1zm15.03-7c0-8-15.03-8-15.03 0h15.03zM1.02 17h15v2H1.02v-2z",
 leisure:"M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7zm3.5-9.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5 1.5.67 1.5 1.5zm-7 0c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5 1.5.67 1.5 1.5zm3.5 6.5c-1.93 0-3.5-1.57-3.5-3.5h7c0 1.93-1.57 3.5-3.5 3.5z",
 shopping:"M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3zm0 10c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z",
 mapview:"M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z",
 invoice2:"M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
 chat:"M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z",
 warning:"M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
 refresh:"M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
 hotel:"M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z",
 edit:"M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
 users:"M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.67 0-8 1.34-8 4v2h10v-2c0-1.19.47-2.28 1.24-3.17C10.1 13.29 8.84 13 8 13zm8 0c-.84 0-2.1.29-3.24.83.77.89 1.24 1.98 1.24 3.17v2h10v-2c0-2.66-5.33-4-8-4z",
 roles:"M12 2l7 4v6c0 5.25-3.67 10.17-7 11-3.33-.83-7-5.75-7-11V6l7-4zm0 4.3L8 8.57V12c0 3.77 2.34 7.57 4 8.63 1.66-1.06 4-4.86 4-8.63V8.57L12 6.3z",
 tasks:"M19 3H5c-1.1 0-2 .9-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14H7v-2h3v2zm7-4H7v-2h10v2zm0-4H7V7h10v2z",
 whitelabel:"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z",
 copy:"M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
 download:"M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
 palette:"M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
 globe:"M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
};
const Icon = ({ name, size=18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d={ICONS[name]||ICONS.chat}/></svg>;
// ─── UI ATOMS ─────────────────────────────────────────────────────────────────
const Badge = ({ status }) => {
 const C = { New:"#4FC3F7","Quote Requested":"#64B5F6","Quote Received":"#BA68C8","Quote Sent":"#FFB74D",Confirmed:"#81C784",Cancelled:"#EF9A9A",Active:"#81C784",Paid:"#81C784",Draft:"#90A4AE",Sent:"#4FC3F7",Replied:"#CE93D8" };
 const c = C[status]||"#90A4AE";
 return <span style={{ background:c+"22",color:c,border:`1px solid ${c}44`,padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:.5 }}>{status}</span>;
};
const Modal = ({ open, onClose, title, children, width=660 }) => !open ? null : (
 <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
 <div style={{ background:"#FFFFFF",border:"1px solid #D5E1EE",borderRadius:16,width:"100%",maxWidth:width,maxHeight:"90vh",overflow:"auto",boxShadow:"0 30px 70px rgba(0,0,0,.6)" }}>
 <div style={{ padding:"18px 22px",borderBottom:"1px solid #D5E1EE",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
 <h3 style={{ margin:0,color:"#0F172A",fontSize:15,fontFamily:"'Playfair Display',serif" }}>{title}</h3>
 <button onClick={onClose} style={{ background:"none",border:"none",color:"#64748B",cursor:"pointer",padding:4 }}><Icon name="close"/></button>
 </div>
 <div style={{ padding:22 }}>{children}</div>
 </div>
 </div>
);
const F = ({ label, children, req }) => (
 <div style={{ marginBottom:14 }}>
 <label style={{ display:"block",color:"#64748B",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:5 }}>{label}{req&&<span style={{ color:"#FF6B6B",marginLeft:3 }}>*</span>}</label>
 {children}
 </div>
);
const IS = { width:"100%",background:"#FFFFFF",border:"1px solid #D5E1EE",borderRadius:8,padding:"9px 13px",color:"#0F172A",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit" };
const Inp = p => <input {...p} style={{...IS,...p.style}}/>;
const Sel = ({children,...p}) => <select {...p} style={{...IS,...p.style}}>{children}</select>;
const TA = p => <textarea {...p} style={{...IS,resize:"vertical",minHeight:75,...p.style}}/>;
const Btn = ({ children, onClick, v="primary", icon, s, disabled, spin }) => {
 const VS = { primary:{background:"linear-gradient(135deg,#1A6B8A,#0D4D6B)",color:"#0F172A",border:"none"}, secondary:{background:"transparent",color:"#4FC3F7",border:"1px solid #D5E1EE"}, success:{background:"linear-gradient(135deg,#2E7D32,#1B5E20)",color:"#0F172A",border:"none"}, ghost:{background:"transparent",color:"#64748B",border:"none"}, danger:{background:"linear-gradient(135deg,#b71c1c,#7f0000)",color:"#0F172A",border:"none"} };
 return (
 <button onClick={onClick} disabled={disabled||spin} style={{...VS[v],padding:"8px 16px",borderRadius:8,cursor:(disabled||spin)?"not-allowed":"pointer",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:5,fontFamily:"inherit",opacity:(disabled||spin)?.55:1,transition:"all .2s",...s}}>
 {spin ? <span style={{ display:"inline-block",width:12,height:12,border:"2px solid currentColor",borderTopColor:"transparent",borderRadius:"50%",animation:"spin .7s linear infinite" }}/> : icon ? <Icon name={icon} size={14}/> : null}
 {children}
 </button>
 );
};
// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
 const [page, setPage] = useState("dashboard");
 // ── PORTAL MODE ────────────────────────────────────────────────────────────
 // If ?portal=<id> is in the URL, load that white-label config and apply its branding
 const portalId = getPortalIdFromURL();
 const activePortal = portalId ? getPortalConfig(portalId) : null;
 // Branding tokens — fall back to Safarnaama defaults when not in portal mode
 const brand = {
  companyName:   activePortal?.company_name  || "Safarnaama",
  tagline:       activePortal?.tagline        || "HOLIDAYS CRM",
  logoUrl:       activePortal?.logo_url       || "",
  primaryColor:  activePortal?.primary_color  || "#1A6B8A",
  accentColor:   activePortal?.accent_color   || "#4FC3F7",
  bgColor:       activePortal?.bg_color       || "#F6F8FC",
  textColor:     activePortal?.text_color     || "#0F172A",
  poweredBy:     activePortal?.powered_by     ?? false,
  modules:       activePortal?.modules        || null, // null = all
  contactEmail:  activePortal?.contact_email  || "enquiry@SafarnaamaHolidays.com",
 };
 // ── DATA KEYS — portal-scoped when in portal mode ─────────────────────────
 // portalId is constant for the session (from URL), so dynamic keys are safe.
 const K = key => portalId ? `sfn_wl_${portalId}_${key}` : `sfn_${key}`;

 // Portal-specific seed roles/users derived from activePortal config
 const PORTAL_SEED_ROLES = activePortal ? [
  { id:"PR001", name:"Admin",   description:"Full portal access",       permissions: ALL_PERMS, created_at: today() },
  { id:"PR002", name:"User",    description:"Standard portal user",     permissions: ["leads","tasks","quotes","chat"], created_at: today() },
 ] : SEED_ROLES;
 const PORTAL_SEED_USERS = activePortal ? [
  { id:"PU001", name: activePortal.admin_name || "Portal Admin", email: activePortal.admin_email || activePortal.contact_email || "admin@portal.com", role:"Admin", status:"Active", created_at: today() },
 ] : SEED_USERS;

 const [leads, setLeads]         = useDB(K("leads"),        SEED_LEADS);
 const [vendors, setVendors]     = useDB(K("vendors"),      SEED_VENDORS);
 const [quotes, setQuotes]       = useDB(K("quotes"),       []);
 const [invoices, setInvoices]   = useDB(K("invoices"),     []);
 const [vouchers, setVouchers]   = useDB(K("vouchers"),     []);
 const [roles, setRoles]         = useDB(K("roles"),        PORTAL_SEED_ROLES);
 const [users, setUsers]         = useDB(K("users"),        PORTAL_SEED_USERS);
 const [tasks, setTasks]         = useDB(K("tasks"),        []);
 const [itineraries, setItineraries] = useDB(K("itineraries"), []);
 const [whiteLabels, setWhiteLabels] = useDB("sfn_whitelabels", []); // never portal-scoped
 const [currentUserId, setCurrentUserId] = useDB(K("current_user"), activePortal ? "PU001" : "U001");
 const [notifs, setNotifs]       = useDB(K("notifs"),       [
  { id:1, msg:"Welcome to your portal — start by adding leads!", time:"Just now", read:false },
 ]);
 const [markup]                  = useDB(K("markup"),       { star3:18, star4:22, transport:15, activities:20 });
 const [modal, setModal] = useState(null); // { type, lead, data }
 const [initItinerary, setInitItinerary] = useState(null); // seed data when jumping from Leads page
 const [toast, setToast] = useState(null);
 const [showBell, setShowBell] = useState(false);
 const [busy, setBusy] = useState(false); // eslint-disable-line no-unused-vars
 const fileRef = useRef();
 const toast$ = (msg, err) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); };
 const addNotif = msg => setNotifs(p => [{ id:Date.now(), msg, time:"Just now", read:false }, ...p.slice(0,19)]);
 const unread = notifs.filter(n => !n.read).length;
 const currentUser = users.find(u => u.id === currentUserId) || users[0] || { id:"", name:"", role:"User" };
 const isAdmin = (currentUser.role || "").toLowerCase() === "admin";
 const currentRole = roles.find(r => r.name === currentUser.role);
 const userPerms = new Set(isAdmin ? ALL_PERMS : (currentRole?.permissions?.length ? currentRole.permissions : ["leads","tasks","quotes","chat"]));
 const hasPermission = perm => userPerms.has(perm);
 const closeModal = () => setModal(null);
 const downloadJSON = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
 };
 const importEntityFile = async (type, file) => {
  if (!file) return [];
  const form = new FormData();
  form.append("doc", file);
  setBusy(true);
  try {
   const result = await API("POST", `/api/import/${type}`, form, true);
   return result.items || [];
  } catch (err) {
   console.error(err);
   toast$(err.message || "Import failed", true);
   return [];
  } finally {
   setBusy(false);
  }
 };
 const downloadLeads = () => downloadJSON(leads, `leads-${today()}.json`);
 const downloadVendors = () => downloadJSON(vendors, `vendors-${today()}.json`);
 const uploadLeadsFile = async file => {
  const items = await importEntityFile("leads", file);
  if (items.length) {
   setLeads(p => [...items, ...p]);
   toast$(`${items.length} lead${items.length>1?"s":""} imported successfully`);
  }
 };
 const uploadVendorsFile = async file => {
  const items = await importEntityFile("vendors", file);
  if (items.length) {
   setVendors(p => [...items, ...p]);
   toast$(`${items.length} vendor${items.length>1?"s":""} imported successfully`);
  }
 };

 // Migrate old roles that don't have permissions yet (backward compat)
 useEffect(() => {
  if (roles.some(r => !r.permissions)) {
   setRoles(prev => prev.map(r => r.permissions ? r : {
    ...r,
    permissions: (r.name||"").toLowerCase() === "admin" ? ALL_PERMS : ["leads","tasks","quotes","chat"],
   }));
  }
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 // ── BACKEND SYNC — on mount load live data from API (non-portal mode) ──────
 // Falls back silently to localStorage when backend is offline / not configured.
 useEffect(() => {
  if (portalId) return; // portal instances use localStorage-only isolation
  (async () => {
   try {
    const [bLeads, bVendors, bInvoices, bVouchers] = await Promise.all([
     API("GET", "/api/leads").catch(() => null),
     API("GET", "/api/vendors").catch(() => null),
     API("GET", "/api/invoices").catch(() => null),
     API("GET", "/api/vouchers").catch(() => null),
    ]);
    if (Array.isArray(bLeads)   && bLeads.length)   setLeads(bLeads);
    if (Array.isArray(bVendors) && bVendors.length) setVendors(bVendors);
    if (Array.isArray(bInvoices)&& bInvoices.length)setInvoices(bInvoices);
    if (Array.isArray(bVouchers)&& bVouchers.length)setVouchers(bVouchers);
   } catch { /* backend unavailable — local data stays */ }
  })();
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 const openTaskModal = () => {
 const defaultAssigneeId = isAdmin
 ? (users.find(u => (u.role || "").toLowerCase() === "user" && u.status === "Active")?.id || currentUser.id)
 : currentUser.id;
 setModal({
 type:"taskCreate",
 title:"Add / Assign Task",
 data:{
 task_title:"",
 description:"",
 assigned_to: defaultAssigneeId || "",
 due_date: today(),
 priority:"Medium",
 status:"Open",
 lead_id:"",
 lead_name:"",
 created_by: currentUser.name || "Admin User",
 }
 });
 };

 const saveTask = () => {
 if (!modal?.data?.task_title?.trim()) return toast$("Task title is required", true);
 if (!modal?.data?.assigned_to) return toast$("Please assign task to a user", true);
 const assignedUser = users.find(u => u.id === modal.data.assigned_to);
 const task = {
 id: genId("T"),
 ...modal.data,
 assigned_user_name: assignedUser?.name || "",
 created_at: today(),
 };
 setTasks(p => [task, ...p]);
 addNotif(`Task assigned: ${task.task_title} -> ${task.assigned_user_name}`);
 toast$("Task created and assigned!");
 closeModal();
 };
 // ── AI ITINERARY ────────────────────────────────────────────────────────────
 const asArray = v => Array.isArray(v) ? v : (typeof v === "string" ? [v] : []);
 const asObject = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
 const doItinerary = async lead => {
 const leadItins = itineraries.filter(it => it.lead_id === lead.id);
 const latest = leadItins.sort((a,b) => (b.version||0) - (a.version||0) || (new Date(b.created_at) - new Date(a.created_at)))[0];
 if (latest) {
  setModal({ type:"itinerary", title:`Itinerary — ${lead.destination}`, lead, data: latest });
  return;
 }
 setModal({ type:"loading", title:`Generating Itinerary — ${lead.destination}` });
 setBusy(true);
 try {
 const data = await askClaudeJSON(
 `Create a travel itinerary for ${lead.destination}, ${lead.pax} adults and ${lead.kids||0} kids, ${lead.notes||""}. Return JSON:
{"days":[{"day":1,"title":"","activities":[""]}],
"hotels":{"3star":[{"name":"","price_per_night":0}],"4star":[{"name":"","price_per_night":0}]}}`
 );
 const latestVersion = Math.max(0, ...leadItins.map(it => Number(it.version||0)));
 const generatedItin = {
  id: `ITN${Date.now().toString().slice(-6)}`,
  lead_id: lead.id,
  lead_name: lead.name,
  destination: lead.destination,
  start_date: lead.travel_date || "",
  end_date: lead.end_date || "",
  pax: lead.pax || 2,
  kids: lead.kids || 0,
  notes: lead.notes || "",
  title: `Itinerary — ${lead.destination}`,
  status: "Draft",
  version: latestVersion + 1,
  created_at: today(),
  highlights: asArray(data.highlights),
  flights: asArray(data.flights),
  hotels: asObject(data.hotels),
  days: asArray(data.days),
 };
 setItineraries(p => [generatedItin, ...p]);
 setModal({ type:"itinerary", title:`Itinerary — ${lead.destination}`, lead, data: generatedItin });
 } catch(e) {
    toast$("AI error: "+e.message+" — opening editor with lead data.", true);
    setInitItinerary({ lead_id: lead.id, lead_name: lead.name, destination: lead.destination, start_date: lead.travel_date || "", end_date: lead.end_date || "", pax: lead.pax || 2, kids: lead.kids || 0, notes: lead.notes || "" });
    setPage("itinerary");
    closeModal();
  } finally { setBusy(false); }
 };

 // ── AI QUOTE EMAIL ──────────────────────────────────────────────────────────
 const quoteDraftFromItinerary = (lead, itinerary) => {
  const start = itinerary.start_date || lead.travel_date || "TBD";
  const end = itinerary.end_date || lead.end_date || "TBD";
  const tripDays = (Array.isArray(itinerary.days) ? itinerary.days : [])
   .slice(0, 3)
   .map(d => `Day ${d.day}: ${d.title}${d.date ? ` (${d.date})` : ""}`)
   .join("\n") || "Trip details will be shared on request.";
  const hotelNames = (Array.isArray(itinerary.hotels) ? itinerary.hotels.map(h => h.name).filter(Boolean) : []);
  const hotels = hotelNames.length > 0
   ? hotelNames.join(", ")
   : "Hotel details to follow.";
  return `Subject: Vendor enquiry for ${lead.destination} itinerary\n\nDear Team,\n\nPlease share your best rates and availability for the following itinerary for ${lead.pax} adult${lead.pax===1?"":"s"}${lead.kids ? ` and ${lead.kids} child${lead.kids===1?"":"ren"}` : ""} travelling to ${lead.destination} from ${start}${end && end !== "TBD" ? ` to ${end}` : ""}.\n\nTrip highlights:\n${tripDays}\n\nHotels: ${hotels}\n\nNotes: ${lead.notes || itinerary.notes || "N/A"}\n\nThank you,\nSafarnaama Holidays`;
 };
 const doQuote = async payload => {
 const lead = payload?.lead || payload;
 const itinerary = payload?.itinerary || (payload && payload.days ? payload : null);
 const existingQuote = quotes
  .filter(q => q.lead_id === lead.id && q.destination === lead.destination)
  .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
 const destVendors = vendors.filter(v => v.destination === lead.destination && v.status === "Active");
 if (existingQuote) {
  const body = existingQuote.body || (itinerary ? quoteDraftFromItinerary(lead, itinerary) : `Existing quote request for ${lead.destination} found. Regenerate with AI if needed.`);
  setModal({ type:"quote", title:"Existing Vendor Email", lead, data:{
   qc: existingQuote.query_code,
   body,
   destVendors,
   selectedVendors: existingQuote.vendor_ids?.length ? existingQuote.vendor_ids : destVendors.map(v=>v.id),
   existingQuoteId: existingQuote.id,
   existingQuote: true,
   created_at: existingQuote.created_at,
  }});
  return;
 }
 setModal({ type:"loading", title:"Drafting Vendor Emails…" });
 setBusy(true);
 try {
 const qc = genQC();
 const body = await askClaude(
 `Draft a professional vendor inquiry email for Safarnaama Holidays.
Query Code: ${qc}
Client: ${lead.name}, ${lead.pax} adults ${lead.kids||0} kids
Destination: ${lead.destination}
Travel Date: ${lead.travel_date}
Budget: INR ${lead.budget}
Notes: ${lead.notes||"None"}
Write the subject on the first line, then a blank line, then the email body. Keep it under 180 words.`
 );
 setModal({ type:"quote", title:"Review & Send Vendor Email", lead, data:{ qc, body, destVendors, selectedVendors: destVendors.map(v=>v.id) } });
 } catch(e) { toast$("AI error: "+e.message, true); closeModal(); }
 finally { setBusy(false); }
 };
 const regenerateQuoteEmail = async lead => {
 setModal({ type:"loading", title:"Regenerating Vendor Email…" });
 setBusy(true);
 try {
 const qc = modal.data?.qc || genQC();
 const destVendors = vendors.filter(v => v.destination === lead.destination && v.status === "Active");
 const body = await askClaude(
 `Draft a professional vendor inquiry email for Safarnaama Holidays.
Query Code: ${qc}
Client: ${lead.name}, ${lead.pax} adults ${lead.kids||0} kids
Destination: ${lead.destination}
Travel Date: ${lead.travel_date}
Budget: INR ${lead.budget}
Notes: ${lead.notes||"None"}
Write the subject on the first line, then a blank line, then the email body. Keep it under 180 words.`
 );
 setModal({ type:"quote", title:"Review & Send Vendor Email", lead, data:{
   qc,
   body,
   destVendors,
   selectedVendors: modal.data?.selectedVendors || destVendors.map(v=>v.id),
   existingQuoteId: modal.data?.existingQuoteId,
   existingQuote: true,
 }});
 } catch(e) { toast$("AI error: "+e.message, true); closeModal(); }
 finally { setBusy(false); }
 };
 const confirmQuote = lead => {
 const { qc, destVendors, selectedVendors=[], existingQuoteId } = modal.data;
 const vendorsToSend = (destVendors||[]).filter(v => selectedVendors.includes(v.id));
 if (!vendorsToSend.length) return toast$("Select at least one vendor before sending.", true);
 const q = {
  id: existingQuoteId || genId("Q"),
  lead_id: lead.id,
  lead_name: lead.name,
  destination: lead.destination,
  query_code: qc,
  body: modal.data.body,
  vendor_ids: vendorsToSend.map(v => v.id),
  vendors_contacted: vendorsToSend.map(v=>v.name),
  status: "Quote Requested",
  created_at: existingQuoteId ? modal.data.created_at || today() : today(),
 };
 setQuotes(p => existingQuoteId ? p.map(item => item.id === existingQuoteId ? q : item) : [q,...p]);
 setLeads(p => p.map(l => l.id===lead.id ? {...l, status:"Quote Requested"} : l));
 addNotif(`Quote ${qc} requested from ${vendorsToSend.length} vendors for ${lead.destination}`);
 toast$(` Quote request sent! Code: ${qc}`);
 closeModal();
 };
 // ── AI INVOICE ──────────────────────────────────────────────────────────────
 const doInvoice = async lead => {
 setModal({ type:"loading", title:"Generating Invoice…" });
 setBusy(true);
 try {
 const data = await askClaudeJSON(
 `Generate a travel invoice JSON for Safarnaama Holidays.
Client: ${lead.name}, Destination: ${lead.destination}
Travel Date: ${lead.travel_date}, Adults: ${lead.pax}, Kids: ${lead.kids||0}
Budget: INR ${lead.budget}, Notes: ${lead.notes||""}
Return JSON only:
{"invoice_no":"INV-XXXXXX","date":"${today()}","due_date":"${lead.travel_date}",
"items":[{"description":"","qty":1,"rate":0,"amount":0}],
"subtotal":0,"gst":0,"total":0,"notes":""}`
 );
 setModal({ type:"invoice", title:"Generated Invoice", lead, data });
 } catch(e) { toast$("AI error: "+e.message, true); closeModal(); }
 finally { setBusy(false); }
 };
 const saveInvoice = () => {
 const inv = { ...modal.data, lead_id:modal.lead.id, lead_name:modal.lead.name, destination:modal.lead.destination, status:"Draft", id:genId("INV") };
 setInvoices(p => [inv,...p]);
 addNotif(`Invoice ${inv.invoice_no} generated for ${modal.lead.name}`);
 toast$("Invoice saved!");
 closeModal();
 };
 // ── AI VOUCHER ──────────────────────────────────────────────────────────────
 const doVoucher = async lead => {
 setModal({ type:"loading", title:"Generating Voucher…" });
 setBusy(true);
 try {
 const data = await askClaudeJSON(
 `Generate a travel confirmation voucher JSON for Safarnaama Holidays.
Client: ${lead.name}, Destination: ${lead.destination}
Travel Date: ${lead.travel_date}, Adults: ${lead.pax}, Kids: ${lead.kids||0}
Return JSON only:
{"voucher_no":"VCH-XXXXXX","client_name":"","destination":"","travel_date":"","return_date":"","adults":0,"kids":0,"hotel":"","room_type":"","inclusions":[""],"special_notes":"","emergency_contact":"+91-9999999999"}`
 );
 setModal({ type:"voucher", title:"Travel Voucher", lead, data });
 } catch(e) { toast$("AI error: "+e.message, true); closeModal(); }
 finally { setBusy(false); }
 };
 const saveVoucher = () => {
 const v = { ...modal.data, lead_id:modal.lead.id, status:"Active", id:genId("VCH") };
 setVouchers(p => [v,...p]);
 addNotif(`Voucher ${v.voucher_no} generated for ${modal.lead.name}`);
 toast$("Voucher saved!");
 closeModal();
 };
 // ── UPLOAD VENDOR QUOTE DOC ─────────────────────────────────────────────────
 const doUpload = async e => {
 const file = e.target.files[0];
 if (!file) return;
 e.target.value = "";
 setModal({ type:"loading", title:`Reading "${file.name}"…` });
 setBusy(true);
 try {
 // POST file to backend — supports PDF, DOCX, TXT via server-side extraction
 const fd = new FormData();
 fd.append("doc", file);
 const result = await API("POST", "/api/quotes/upload-doc", fd, true);
 const data = result.extracted || {};
 const markupPct = result.markupPct ?? markup.star4;
 const finalCost = result.finalCost ?? Math.round((data.total_cost||data.totalCost||0) * (1 + markupPct/100));
 // normalise field names (backend uses camelCase, legacy used snake_case)
 const norm = {
  vendor_name: data.vendorName||data.vendor_name||"",
  destination: data.destination||"",
  hotel_name: data.hotelName||data.hotel_name||"",
  room_type: data.roomType||data.room_type||"",
  per_person_cost: data.perPersonCost||data.per_person_cost||0,
  total_cost: data.totalCost||data.total_cost||0,
  pax: data.pax||2,
  inclusions: data.inclusions||[],
  valid_till: data.validTill||data.valid_till||"",
  notes: data.notes||"",
 };
 setModal({ type:"uploadResult", title:"Extracted Vendor Quote", data:{ ...norm, file_name:file.name, markup_pct:markupPct, final_cost:finalCost } });
 } catch(e) { toast$("Upload failed: "+e.message, true); closeModal(); }
 finally { setBusy(false); }
 };
 // ── AI CHAT ─────────────────────────────────────────────────────────────────
 // Chat is its own page component — passes leads/setLeads down
 const NAV = [
 { id:"dashboard",  label:"Dashboard",         icon:"dashboard" },
 { id:"leads",      label:"Leads",             icon:"leads",      perm:"leads" },
 { id:"itinerary",  label:"Itinerary Builder", icon:"itinerary",  perm:"itinerary" },
 { id:"tasks",      label:"Tasks",             icon:"tasks",      perm:"tasks" },
 { id:"quotes",     label:"Quotes",            icon:"quote",      perm:"quotes" },
 { id:"vendors",    label:"Vendors",           icon:"vendor",     perm:"vendors" },
 { id:"invoices",   label:"Invoices",          icon:"invoice2",   perm:"invoices" },
 { id:"vouchers",   label:"Vouchers",          icon:"voucher",    perm:"vouchers" },
 { id:"users",      label:"Users",             icon:"users",      perm:"users" },
 { id:"roles",      label:"Roles",             icon:"roles",      perm:"roles" },
 { id:"whitelabel", label:"White Label",        icon:"whitelabel", perm:"whitelabel" },
 { id:"chat",       label:"AI Chat",            icon:"chat",       perm:"chat" },
 { id:"settings",   label:"Settings",          icon:"settings",   perm:"settings" },
 ].filter(n => !n.perm || hasPermission(n.perm))
  .filter(n => !activePortal || !brand.modules || n.id === "dashboard" || brand.modules.includes(n.id));

 // Root background driven by portal brand
 const rootBg = brand.bgColor;
 return (
 <div style={{ display:"flex", height:"100vh", background:rootBg, color:"#334155", fontFamily:"'DM Sans',sans-serif", overflow:"hidden" }}>
 <style>{`
 @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700&family=Playfair+Display:wght@400;600;700&display=swap');
 *{box-sizing:border-box;margin:0;padding:0;}
 ::-webkit-scrollbar{width:4px;height:4px;}
 ::-webkit-scrollbar-track{background:#FFFFFF;}
 ::-webkit-scrollbar-thumb{background:#D5E1EE;border-radius:4px;}
 input::placeholder,textarea::placeholder{color:#2A4A5A;}
 select option{background:#FFFFFF;}
 .nav-btn:hover{background:#F2F6FB!important;}
 .row:hover{background:#F6FAFF!important;}
 .card:hover{border-color:#2A5A7A!important;}
 @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
 @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
 @keyframes spin{to{transform:rotate(360deg)}}
 .fadein{animation:fadeUp .25s ease;}
 .shimmer{animation:pulse 1.5s infinite;}
 `}</style>
 {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
 <div style={{ width:215, background:"#FFFFFF", borderRight:"1px solid #E6ECF5", display:"flex", flexDirection:"column", flexShrink:0 }}>
 <div style={{ padding:"20px 16px 14px", borderBottom:"1px solid #E6ECF5" }}>
 <div style={{ display:"flex", alignItems:"center", gap:10 }}>
  {brand.logoUrl
   ? <img src={brand.logoUrl} alt="logo" style={{ width:36, height:36, borderRadius:9, objectFit:"cover", border:"1px solid #E6ECF5" }}/>
   : <div style={{ width:36, height:36, background:`linear-gradient(135deg,${brand.primaryColor},${brand.accentColor})`, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon name="airplane" size={19}/></div>
  }
  <div>
   <div style={{ fontSize:13, fontWeight:700, color:"#0F172A", letterSpacing:.2 }}>{brand.companyName}</div>
   <div style={{ fontSize:10, color:brand.primaryColor, letterSpacing:1.2, fontWeight:600, textTransform:"uppercase" }}>{brand.tagline}</div>
  </div>
 </div>
 </div>
 <nav style={{ flex:1, padding:"10px 8px", overflow:"auto" }}>
 {NAV.map(n => (
 <button key={n.id} className="nav-btn" onClick={() => setPage(n.id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:9, padding:"9px 11px", borderRadius:8, background: page===n.id?brand.primaryColor+"18":"transparent", border:"none", cursor:"pointer", color: page===n.id?brand.primaryColor:"#64748B", fontSize:13, fontWeight: page===n.id?600:400, textAlign:"left", marginBottom:2, borderLeft: page===n.id?`2px solid ${brand.primaryColor}`:"2px solid transparent", transition:"all .15s" }}>
 <Icon name={n.icon} size={15}/>{n.label}
 </button>
 ))}
 </nav>
 <div style={{ padding:"11px 14px", borderTop:"1px solid #E6ECF5", fontSize:11, color:"#94A3B8" }}>
  {brand.poweredBy
   ? <><div style={{ fontWeight:600, color:brand.primaryColor, marginBottom:2 }}>{brand.companyName}</div><div style={{ fontSize:9, marginTop:1 }}>Powered by Safarnaama CRM</div></>
   : <><div style={{ fontWeight:600, color:"#3A8A9A", marginBottom:2 }}>Admin User</div><div>{brand.contactEmail}</div></>
  }
 </div>
 </div>
 {/* ── MAIN ────────────────────────────────────────────────────────────── */}
 <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
 {/* TOPBAR */}
 <div style={{ height:52, background:"#FFFFFF", borderBottom:"1px solid #E6ECF5", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 22px", flexShrink:0 }}>
 <h2 style={{ fontSize:15, fontFamily:"'Playfair Display',serif", color:"#0F172A", fontWeight:600 }}>{NAV.find(n=>n.id===page)?.label}</h2>
 <div style={{ display:"flex", alignItems:"center", gap:10 }}>
 {/* Active user selector */}
 <Sel value={currentUser.id} onChange={e=>setCurrentUserId(e.target.value)} style={{ width:180, padding:"5px 9px", fontSize:11 }}>
 {users.filter(u=>u.status === "Active").map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
 </Sel>
 {/* Task button */}
 {hasPermission("assign_task") && <Btn v="primary" icon="plus" s={{ fontSize:11, padding:"5px 10px" }} onClick={openTaskModal}>Add / Assign Task</Btn>}
 {/* Upload button always visible */}
 <Btn v="secondary" icon="upload" s={{ fontSize:11, padding:"5px 10px" }} onClick={()=>fileRef.current?.click()}>Upload Quote</Btn>
 <input ref={fileRef} type="file" onChange={doUpload} style={{ display:"none" }} accept=".pdf,.doc,.docx,.txt,.csv,.xlsx"/>
 {/* Bell */}
 <div style={{ position:"relative" }}>
 <button onClick={()=>setShowBell(!showBell)} style={{ background:"none", border:"none", color:"#64748B", cursor:"pointer", padding:6, position:"relative" }}>
 <Icon name="bell" size={20}/>
 {unread>0 && <span style={{ position:"absolute", top:2, right:2, width:15, height:15, background:"#FF6B6B", borderRadius:10, fontSize:9, fontWeight:700, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}>{unread}</span>}
 </button>
 {showBell && (
 <div className="fadein" style={{ position:"absolute", right:0, top:44, width:300, background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:12, boxShadow:"0 16px 40px rgba(0,0,0,.5)", zIndex:300 }}>
 <div style={{ padding:"11px 14px", borderBottom:"1px solid #E6ECF5", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
 <span style={{ fontWeight:700, fontSize:13, color:"#0F172A" }}>Notifications</span>
 <button onClick={()=>{setNotifs(p=>p.map(n=>({...n,read:true}))); setShowBell(false);}} style={{ background:"none", border:"none", color:"#4FC3F7", cursor:"pointer", fontSize:11 }}>Mark all read</button>
 </div>
 {notifs.slice(0,7).map((n,i) => (
 <div key={n.id||i} style={{ padding:"9px 14px", borderBottom:"1px solid #EEF3F9", background:n.read?"transparent":"#F2F6FB", display:"flex", gap:8 }}>
 <div style={{ width:6, height:6, borderRadius:3, background:n.read?"transparent":"#4FC3F7", marginTop:5, flexShrink:0 }}/>
 <div><div style={{ fontSize:12, color:"#334155", lineHeight:1.5 }}>{n.msg}</div><div style={{ fontSize:10, color:"#94A3B8", marginTop:2 }}>{n.time}</div></div>
 </div>
 ))}
 {notifs.length===0 && <div style={{ padding:20, textAlign:"center", color:"#94A3B8", fontSize:12 }}>No notifications</div>}
 </div>
 )}
 </div>
 </div>
 </div>
 {/* PAGE */}
 <div style={{ flex:1, overflow:"auto", padding:22 }}>
 {page==="dashboard" && <PageDashboard leads={leads} quotes={quotes} invoices={invoices} vendors={vendors} setPage={setPage}/>}
 {page==="leads" && <PageLeads leads={leads} setLeads={setLeads} users={users} currentUser={currentUser} onItinerary={doItinerary} onQuote={doQuote} onInvoice={doInvoice} onVoucher={doVoucher} onDownloadLeads={downloadLeads} onUploadLeads={uploadLeadsFile} toast$={toast$}/>}
 {page==="itinerary" && <PageItinerary leads={leads} itineraries={itineraries} setItineraries={setItineraries} initData={initItinerary} setInitData={setInitItinerary} toast$={toast$} onRequestQuote={doQuote} brand={brand}/>}
 {page==="tasks" && <PageTasks tasks={tasks} setTasks={setTasks} users={users} leads={leads} currentUser={currentUser} isAdmin={isAdmin} onCreateTask={openTaskModal}/>}
 {page==="quotes" && <PageQuotes quotes={quotes} setQuotes={setQuotes} vendors={vendors} toast$={toast$}/>}
 {page==="vendors" && <PageVendors vendors={vendors} setVendors={setVendors} onDownloadVendors={downloadVendors} onUploadVendors={uploadVendorsFile} toast$={toast$}/>}
 {page==="invoices" && <PageInvoices invoices={invoices} setInvoices={setInvoices} leads={leads} onGenerate={doInvoice}/>}

 {page==="vouchers" && <PageVouchers vouchers={vouchers} leads={leads} onGenerate={doVoucher}/>}
 {page==="users" && <PageUsers users={users} setUsers={setUsers} roles={roles} currentUser={currentUser} isAdmin={isAdmin} toast$={toast$}/>}
 {page==="roles" && <PageRoles roles={roles} setRoles={setRoles} users={users} isAdmin={isAdmin} toast$={toast$}/>}
 {page==="whitelabel" && <PageWhiteLabel whiteLabels={whiteLabels} setWhiteLabels={setWhiteLabels} isAdmin={isAdmin} toast$={toast$}/>}
 {page==="chat" && <PageChat leads={leads} setLeads={setLeads} quotes={quotes} invoices={invoices} addNotif={addNotif} toast$={toast$} setPage={setPage}/>}
 {page==="settings" && <PageSettings markup={markup} toast$={toast$}/>}
 </div>
 </div>
 {/* ── TOAST ───────────────────────────────────────────────────────────── */}
 {toast && (
 <div className="fadein" style={{ position:"fixed", bottom:22, right:22, background:toast.err?"#FEF2F2":"#ECFDF3", border:`1px solid ${toast.err?"#7D2E2E":"#1E6A42"}`, borderRadius:10, padding:"11px 18px", color:"#0F172A", fontSize:13, zIndex:2000, boxShadow:"0 8px 24px rgba(0,0,0,.5)", display:"flex", alignItems:"center", gap:8, maxWidth:360 }}>
 <Icon name={toast.err?"warning":"check"} size={15}/>{toast.msg}
 </div>
 )}
 {/* ── MODALS ──────────────────────────────────────────────────────────── */}
 {/* Loading */}
 <Modal open={modal?.type==="loading"} onClose={closeModal} title={modal?.title||"Processing…"}>
 <div style={{ textAlign:"center", padding:"30px 0" }}>
 <div style={{ width:40, height:40, border:"3px solid #D5E1EE", borderTopColor:"#4FC3F7", borderRadius:"50%", margin:"0 auto 16px", animation:"spin .8s linear infinite" }}/>
 <div className="shimmer" style={{ color:"#475569", fontSize:13 }}>Claude AI is working on this…</div>
 </div>
 </Modal>
 {/* Itinerary */}
 <Modal open={modal?.type==="itinerary"} onClose={closeModal} title={modal?.title} width={820}>
 {modal?.data && (
 <div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
 {["3star","4star"].map(tier => (
 <div key={tier} style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:10, padding:14 }}>
 <div style={{ fontWeight:700, color:"#0F172A", fontSize:13, marginBottom:10 }}>{tier==="3star"?"★★★ 3-Star":"★★★★ 4-Star"} Hotels</div>
 {(modal.data.hotels?.[tier]||[]).map((h,i) => (
 <div key={i} style={{ background:"#F6F8FC", borderRadius:8, padding:10, marginBottom:6 }}>
 <div style={{ fontWeight:600, fontSize:13, color:"#334155" }}>{h.name}</div>
 <div style={{ fontSize:12, color:"#475569", marginTop:2 }}>₹{Number(h.price_per_night||0).toLocaleString("en-IN")}/night · Total: <span style={{ color:"#FFB74D" }}>Need to Confirm</span></div>
 </div>
 ))}
 </div>
 ))}
 </div>
 <div style={{ marginBottom:18 }}>
 {(modal.data.days||[]).map((d,i) => (
 <div key={i} style={{ display:"flex", gap:11, marginBottom:10 }}>
 <div style={{ width:34, height:34, background:"linear-gradient(135deg,#1A6B8A,#0D4D6B)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#0F172A", flexShrink:0 }}>D{d.day}</div>
 <div style={{ flex:1, background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:8, padding:"10px 13px" }}>
 <div style={{ fontWeight:600, color:"#0F172A", fontSize:13, marginBottom:3 }}>{d.title}</div>
 <div style={{ color:"#64748B", fontSize:12, lineHeight:1.6 }}>{(d.activities||[]).join(" · ")}</div>
 </div>
 </div>
 ))}
 </div>
 <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
 <Btn v="secondary" onClick={() => {
  setPage("itinerary");
  setInitItinerary({
   ...(modal.data || {}),
   lead_id: modal.lead.id,
   lead_name: modal.lead.name,
   destination: modal.lead.destination,
   start_date: modal.data.start_date || modal.lead.travel_date || "",
   end_date: modal.data.end_date || modal.lead.end_date || "",
   pax: modal.lead.pax || 2,
   kids: modal.lead.kids || 0,
   notes: modal.lead.notes || "",
   title: modal.data.title || `${modal.lead.destination} Itinerary`,
   status: modal.data.status || "Draft",
  });
  closeModal();
 }}>Edit Itinerary</Btn>
 <Btn v="secondary" onClick={closeModal}>Close</Btn>
 <Btn v="primary" icon="send" onClick={()=>doQuote(modal.lead)}>Request Quote from Vendors</Btn>
 </div>
 </div>
 )}
 </Modal>
 {/* Quote Email */}
 <Modal open={modal?.type==="quote"} onClose={closeModal} title={modal?.title} width={700}>
 {modal?.data && (
 <div>
 <div style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:10, padding:13, marginBottom:13 }}>
 <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
 <span style={{ fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:1 }}>Query Code</span>
 <span style={{ fontWeight:700, color:"#4FC3F7" }}>{modal.data.qc}</span>
 </div>
 <div style={{ fontSize:12, color:"#64748B", marginBottom:8 }}>Select vendors to send this request to. Only selected vendors will be emailed.</div>
 {modal.data.destVendors?.length ? (
  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
   {modal.data.destVendors.map(v => (
    <label key={v.id} style={{ display:"flex", alignItems:"center", gap:8, padding:8, borderRadius:10, border:"1px solid #E6ECF5", background:"#F8FAFC", fontSize:12, color:"#334155" }}>
     <input type="checkbox" checked={modal.data.selectedVendors?.includes(v.id)} onChange={e => setModal(p => ({ ...p, data: { ...p.data, selectedVendors: e.target.checked ? [...(p.data.selectedVendors||[]), v.id] : (p.data.selectedVendors||[]).filter(id => id !== v.id) } }))} />
     <span>{v.name}{v.email ? ` (${v.email})` : ""}</span>
    </label>
   ))}
  </div>
 ) : (
  <div style={{ fontSize:12, color:"#64748B" }}>No vendors registered for this destination yet.</div>
 )}
 </div>
 <div style={{ background:"#F6F8FC", border:"1px solid #E6ECF5", borderRadius:10, padding:15, marginBottom:18, maxHeight:260, overflow:"auto" }}>
 <pre style={{ margin:0, whiteSpace:"pre-wrap", fontSize:12, color:"#334155", lineHeight:1.7 }}>{modal.data.body}</pre>
 </div>
 <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
  {modal.data?.existingQuote && (
   <Btn v="secondary" onClick={()=>regenerateQuoteEmail(modal.lead)} icon="refresh">
    Regenerate with AI
   </Btn>
  )}
  <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
  <Btn v="success" icon="send" onClick={()=>confirmQuote(modal.lead)}>Confirm & Send</Btn>
 </div>
 </div>
 )}
 </Modal>
 {/* Invoice */}
 <Modal open={modal?.type==="invoice"} onClose={closeModal} title={modal?.title} width={700}>
 {modal?.data && (
 <div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:13, marginBottom:16 }}>
 {[["Invoice No",modal.data.invoice_no],["Client",modal.lead?.name],["Date",modal.data.date],["Due",modal.data.due_date]].map(([k,v])=>(
 <div key={k}><div style={{ fontSize:10, color:"#475569", textTransform:"uppercase", letterSpacing:1, marginBottom:3 }}>{k}</div><div style={{ fontWeight:600, color:"#0F172A", fontSize:13 }}>{v}</div></div>
 ))}
 </div>
 <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, marginBottom:13 }}>
 <thead><tr style={{ background:"#FFFFFF" }}>{["Description","Qty","Rate (₹)","Amount (₹)"].map(h=><th key={h} style={{ padding:"8px 11px", textAlign:"left", fontSize:11, color:"#475569", textTransform:"uppercase" }}>{h}</th>)}</tr></thead>
 <tbody>
 {(modal.data.items||[]).map((it,i)=>(
 <tr key={i} style={{ borderBottom:"1px solid #E6ECF5" }}>
 <td style={{ padding:"9px 11px", color:"#334155" }}>{it.description}</td>
 <td style={{ padding:"9px 11px" }}>{it.qty}</td>
 <td style={{ padding:"9px 11px" }}>₹{Number(it.rate||0).toLocaleString("en-IN")}</td>
 <td style={{ padding:"9px 11px", fontWeight:600, color:"#0F172A" }}>₹{Number(it.amount||0).toLocaleString("en-IN")}</td>
 </tr>
 ))}
 </tbody>
 </table>
 <div style={{ textAlign:"right", marginBottom:16 }}>
 <div style={{ fontSize:12, color:"#64748B" }}>Subtotal: ₹{Number(modal.data.subtotal||0).toLocaleString("en-IN")}</div>
 <div style={{ fontSize:12, color:"#64748B" }}>GST (5%): ₹{Number(modal.data.gst||0).toLocaleString("en-IN")}</div>
 <div style={{ fontSize:16, fontWeight:700, color:"#81C784" }}>Total: ₹{Number(modal.data.total||0).toLocaleString("en-IN")}</div>
 </div>
 {modal.data.notes && <div style={{ background:"#FFFFFF", borderRadius:8, padding:10, fontSize:12, color:"#64748B", marginBottom:16 }}>{modal.data.notes}</div>}
 <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
 <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
 <Btn v="success" icon="check" onClick={saveInvoice}>Save Invoice</Btn>
 </div>
 </div>
 )}
 </Modal>
 {/* Voucher */}
 <Modal open={modal?.type==="voucher"} onClose={closeModal} title={modal?.title} width={640}>
 {modal?.data && (
 <div>
 <div style={{ background:"linear-gradient(135deg,#F2F6FB,#EEF3F9)", border:"1px solid #D5E1EE", borderRadius:12, padding:20, marginBottom:16 }}>
 <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14, paddingBottom:12, borderBottom:"1px solid #D5E1EE" }}>
 <div><div style={{ fontSize:10, color:"#475569", letterSpacing:1.2 }}>SAFARNAAMA HOLIDAYS</div><div style={{ fontFamily:"'Playfair Display',serif", fontSize:19, color:"#0F172A" }}>Travel Voucher</div></div>
 <div style={{ fontWeight:700, color:"#4FC3F7" }}>{modal.data.voucher_no}</div>
 </div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14, fontSize:13 }}>
 {[["Guest",modal.data.client_name],["Destination",modal.data.destination],["Travel Date",modal.data.travel_date],["Return",modal.data.return_date],["Adults",modal.data.adults],["Kids",modal.data.kids],["Hotel",modal.data.hotel],["Room",modal.data.room_type]].map(([k,v])=>(
 <div key={k}><div style={{ fontSize:10, color:"#475569", textTransform:"uppercase", letterSpacing:1 }}>{k}</div><div style={{ color:"#0F172A", fontWeight:600 }}>{v||"—"}</div></div>
 ))}
 </div>
 <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:10 }}>
 {(modal.data.inclusions||[]).map((inc,i)=><span key={i} style={{ background:"#E6ECF5", border:"1px solid #D5E1EE", borderRadius:6, padding:"2px 8px", fontSize:11, color:"#4FC3F7" }}>{inc}</span>)}
 </div>
 {modal.data.special_notes && <div style={{ fontSize:12, color:"#64748B", fontStyle:"italic" }}>{modal.data.special_notes}</div>}
 <div style={{ fontSize:11, color:"#475569", marginTop:8 }}>Emergency: {modal.data.emergency_contact}</div>
 </div>
 <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
 <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
 <Btn v="success" icon="check" onClick={saveVoucher}>Save Voucher</Btn>
 </div>
 </div>
 )}
 </Modal>
 {/* Upload Result */}
 <Modal open={modal?.type==="uploadResult"} onClose={closeModal} title={modal?.title} width={660}>
 {modal?.data && (
 <div>
 <div style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:10, padding:15, marginBottom:14 }}>
 <div style={{ fontWeight:700, color:"#0F172A", marginBottom:11, fontSize:13 }}> {modal.data.file_name}</div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, fontSize:13 }}>
 {[["Vendor",modal.data.vendor_name],["Destination",modal.data.destination],["Hotel",modal.data.hotel_name],["Room",modal.data.room_type],["Pax",modal.data.pax],["Valid Till",modal.data.valid_till]].map(([k,v])=>(
 <div key={k}><span style={{ color:"#475569" }}>{k}: </span><span style={{ color:"#0F172A", fontWeight:600 }}>{v||"—"}</span></div>
 ))}
 </div>
 {(modal.data.inclusions||[]).length>0 && <div style={{ marginTop:10, fontSize:12, color:"#64748B" }}>Inclusions: {modal.data.inclusions.join(", ")}</div>}
 </div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16, textAlign:"center", background:"#F6F8FC", border:"1px solid #E6ECF5", borderRadius:10, padding:16, marginBottom:18 }}>
 {[["Vendor Cost","₹"+Number(modal.data.total_cost||0).toLocaleString("en-IN"),"#334155"],["Markup ("+modal.data.markup_pct+"%)","Applied","#FFB74D"],["Final to Client","₹"+Number(modal.data.final_cost||0).toLocaleString("en-IN"),"#81C784"]].map(([l,v,c])=>(
 <div key={l}><div style={{ fontSize:10, color:"#475569", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>{l}</div><div style={{ fontSize:17, fontWeight:700, color:c }}>{v}</div></div>
 ))}
 </div>
 <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
 <Btn v="secondary" onClick={closeModal}>Close</Btn>
 <Btn v="success" icon="send" onClick={()=>{ toast$("Quote with markup forwarded to client! "); closeModal(); }}>Forward to Client</Btn>
 </div>
 </div>
 )}
 </Modal>

 {/* Task Create */}
 <Modal open={modal?.type==="taskCreate"} onClose={closeModal} title={modal?.title || "Add / Assign Task"} width={700}>
 {modal?.data && (
 <div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
 <F label="Task Title" req><Inp value={modal.data.task_title} onChange={e=>setModal(p=>({...p,data:{...p.data,task_title:e.target.value}}))} placeholder="Follow up with hotel for revised rates"/></F>
 <F label="Assign To" req>
 <Sel value={modal.data.assigned_to} onChange={e=>setModal(p=>({...p,data:{...p.data,assigned_to:e.target.value}}))}>
 {users.filter(u=>u.status === "Active").map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
 </Sel>
 </F>
 <F label="Related Lead">
 <Sel value={modal.data.lead_id} onChange={e=>{
 const l = leads.find(x => x.id === e.target.value);
 setModal(p=>({...p,data:{...p.data,lead_id:e.target.value,lead_name:l?.name || ""}}));
 }}>
 <option value="">No lead linked</option>
 {leads.map(l => <option key={l.id} value={l.id}>{l.id} - {l.name}</option>)}
 </Sel>
 </F>
 <F label="Due Date"><Inp type="date" value={modal.data.due_date} onChange={e=>setModal(p=>({...p,data:{...p.data,due_date:e.target.value}}))}/></F>
 <F label="Priority">
 <Sel value={modal.data.priority} onChange={e=>setModal(p=>({...p,data:{...p.data,priority:e.target.value}}))}>
 <option>Low</option><option>Medium</option><option>High</option>
 </Sel>
 </F>
 <F label="Status">
 <Sel value={modal.data.status} onChange={e=>setModal(p=>({...p,data:{...p.data,status:e.target.value}}))}>
 <option>Open</option><option>In Progress</option><option>Done</option>
 </Sel>
 </F>
 </div>
 <F label="Description"><TA value={modal.data.description} onChange={e=>setModal(p=>({...p,data:{...p.data,description:e.target.value}}))} placeholder="Add details for the assignee"/></F>
 <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
 <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
 <Btn v="success" icon="check" onClick={saveTask}>Create Task</Btn>
 </div>
 </div>
 )}
 </Modal>
 </div>
 );
}
// ─── PAGE: DASHBOARD ──────────────────────────────────────────────────────────
function PageDashboard({ leads, quotes, invoices, vendors, setPage }) {
 const stats = [
 { label:"Total Leads", value:leads.length, color:"#4FC3F7", icon:"leads" },
 { label:"Quotes Sent", value:quotes.length, color:"#FFB74D", icon:"quote" },
 { label:"Confirmed", value:leads.filter(l=>l.status==="Confirmed").length, color:"#81C784", icon:"check" },
 { label:"Active Vendors",value:vendors.filter(v=>v.status==="Active").length, color:"#CE93D8", icon:"vendor" },
 ];
 return (
 <div>
 <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:22 }}>
 {stats.map(s => (
 <div key={s.label} className="card" style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:18, transition:"border-color .2s", cursor:"default" }}>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
 <div><div style={{ fontSize:10, color:"#475569", textTransform:"uppercase", letterSpacing:1, marginBottom:7 }}>{s.label}</div><div style={{ fontSize:30, fontWeight:700, color:s.color, fontFamily:"'Playfair Display',serif" }}>{s.value}</div></div>
 <div style={{ color:s.color, opacity:.45 }}><Icon name={s.icon} size={22}/></div>
 </div>
 </div>
 ))}
 </div>
 <div style={{ display:"grid", gridTemplateColumns:"3fr 2fr", gap:14 }}>
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:18 }}>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
 <span style={{ fontWeight:700, color:"#0F172A", fontSize:14 }}>Recent Leads</span>
 <Btn v="ghost" s={{ fontSize:11, color:"#4FC3F7" }} onClick={()=>setPage("leads")}>View All →</Btn>
 </div>
 {leads.slice(0,6).map(l => (
 <div key={l.id} className="row" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 8px", borderBottom:"1px solid #EEF3F9", borderRadius:6, transition:"background .15s" }}>
 <div><div style={{ fontWeight:600, color:"#0F172A", fontSize:13 }}>{l.name}</div><div style={{ fontSize:11, color:"#475569" }}>{l.destination} · {l.pax} adults{l.kids>0?` ${l.kids} kids`:""}</div></div>
 <div style={{ display:"flex", alignItems:"center", gap:10 }}><span style={{ fontSize:11, color:"#64748B" }}>{l.travel_date}</span><Badge status={l.status}/></div>
 </div>
 ))}
 {leads.length===0 && <div style={{ padding:30, textAlign:"center", color:"#94A3B8", fontSize:13 }}>No leads yet. Use AI Chat to add one!</div>}
 </div>
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:18 }}>
 <div style={{ fontWeight:700, color:"#0F172A", fontSize:14, marginBottom:14 }}>Pipeline</div>
 {[["New","#4FC3F7"],["Quote Requested","#64B5F6"],["Quote Received","#BA68C8"],["Quote Sent","#FFB74D"],["Confirmed","#81C784"],["Cancelled","#EF9A9A"]].map(([s,c]) => {
 const cnt = leads.filter(l=>l.status===s).length;
 return (
 <div key={s} style={{ marginBottom:14 }}>
 <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#64748B", marginBottom:4 }}><span>{s}</span><span style={{ color:c, fontWeight:700 }}>{cnt}</span></div>
 <div style={{ height:5, background:"#F6F8FC", borderRadius:3 }}><div style={{ height:"100%", width:leads.length?`${(cnt/leads.length)*100}%`:"0%", background:c, borderRadius:3, transition:"width .6s" }}/></div>
 </div>
 );
 })}
 <div style={{ marginTop:18, paddingTop:14, borderTop:"1px solid #E6ECF5" }}>
 <div style={{ fontSize:10, color:"#475569", textTransform:"uppercase", letterSpacing:1 }}>Invoices Generated</div>
 <div style={{ fontSize:24, fontWeight:700, color:"#81C784", fontFamily:"'Playfair Display',serif" }}>{invoices.length}</div>
 </div>
 </div>
 </div>
 </div>
 );
}
// ─── PAGE: LEADS ──────────────────────────────────────────────────────────────
 function PageLeads({ leads, setLeads, users, currentUser, onItinerary, onQuote, onInvoice, onVoucher, onDownloadLeads, onUploadLeads, toast$ }) {
 const [showAdd, setShowAdd] = useState(false);
 const [search, setSearch] = useState("");
 const [form, setForm] = useState({ name:"", email:"", phone:"", destination:"", pax:2, kids:0, budget:"", travel_date:"", end_date:"", notes:"", assigned_to:"" });
 const [editingId, setEditingId] = useState(null);
 const fileRef = useRef();
 const fld = k => e => setForm(p=>({...p,[k]:e.target.value}));
 const calcDuration = (start, end) => {
  if (!start || !end) return { days: 0, nights: 0 };
  const diff = Math.round((new Date(end) - new Date(start)) / 86400000);
  if (diff < 0) return { days: 0, nights: 0 };
  return { days: diff + 1, nights: diff };
 };
 const duration = calcDuration(form.travel_date, form.end_date);
 const isAdmin = (currentUser?.role || "").toLowerCase() === "admin";
 const save = () => {
 if (!form.name.trim()||!form.destination.trim()) return toast$("Name and destination required", true);
 if (form.travel_date && form.end_date && new Date(form.end_date) < new Date(form.travel_date)) return toast$("End date cannot be before travel date", true);
 const assignee = form.assigned_to || (isAdmin ? "" : currentUser?.name || "");
 if (editingId) {
  // update existing lead
  setLeads(prev => prev.map(l => l.id === editingId ? { ...l, ...form, assigned_to: assignee } : l));
  toast$(`Lead "${form.name}" updated!`);
 } else {
  const lead = { ...form, assigned_to:assignee, id:genId("L"), status:"New", created_at:today() };
  setLeads(p => [lead,...p]);
  toast$(`Lead "${form.name}" created!`);
 }
 setShowAdd(false);
 setEditingId(null);
 setForm({ name:"",email:"",phone:"",destination:"",pax:2,kids:0,budget:"",travel_date:"",end_date:"",notes:"",assigned_to:"" });
 };
 const del = id => { if (window.confirm("Delete this lead?")) { setLeads(p=>p.filter(l=>l.id!==id)); toast$("Lead deleted"); } };
 const updateStatus = (id, status) => setLeads(p=>p.map(l=>l.id===id?{...l,status}:l));
 const filtered = leads
 .filter(l => isAdmin || (l.assigned_to || "") === (currentUser?.name || ""))
 .filter(l => (l.name||"").toLowerCase().includes(search.toLowerCase()) || (l.destination||"").toLowerCase().includes(search.toLowerCase()));
 return (
 <div>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, gap:10 }}>
 <div style={{ position:"relative" }}>
 <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"#94A3B8" }}><Icon name="search" size={14}/></span>
 <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or destination…" style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:8, padding:"8px 12px 8px 32px", color:"#0F172A", fontSize:13, width:240, outline:"none", fontFamily:"inherit" }}/>
 </div>
 <Btn icon="plus" onClick={()=>{ setShowAdd(s=>!s); if (!showAdd) setEditingId(null); }}>{showAdd?"Cancel":"New Lead"}</Btn>
 </div>
 <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
 <Btn v="secondary" icon="upload" onClick={()=>fileRef.current?.click()}>Upload Leads</Btn>
 <Btn v="secondary" icon="download" onClick={onDownloadLeads}>Download Leads</Btn>
 </div>
 <input ref={fileRef} type="file" accept=".json,.csv,.txt,.xls,.xlsx,.pdf,.doc,.docx,.png,.jpg,.jpeg" style={{ display:"none" }} onChange={e=>{ const file = e.target.files?.[0]; if (file) { onUploadLeads(file); e.target.value = null; } }}/>
 {showAdd && (
 <div className="fadein" style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:12, padding:18, marginBottom:18 }}>
 <div style={{ fontWeight:700, color:"#0F172A", marginBottom:14, fontSize:14 }}>Add New Lead</div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:11 }}>
 <F label="Client Name" req><Inp value={form.name} onChange={fld("name")} placeholder="Full name"/></F>
 <F label="Email"><Inp type="email" value={form.email} onChange={fld("email")} placeholder="email@example.com"/></F>
 <F label="Phone"><Inp value={form.phone} onChange={fld("phone")} placeholder="+91 XXXXXXXXXX"/></F>
 <F label="Destination" req><Inp value={form.destination} onChange={fld("destination")} placeholder="e.g. Vietnam, Maldives"/></F>
 <F label="Adults"><Inp type="number" value={form.pax} onChange={fld("pax")} min={1}/></F>
 <F label="Kids"><Inp type="number" value={form.kids} onChange={fld("kids")} min={0}/></F>
 <F label="Budget (INR)"><Inp value={form.budget} onChange={fld("budget")} placeholder="e.g. 2,50,000"/></F>
 <F label="Travel Date"><Inp type="date" value={form.travel_date} onChange={fld("travel_date")}/></F>
 <F label="End Date"><Inp type="date" value={form.end_date} onChange={fld("end_date")}/></F>
 {duration.days > 0 && (
  <div style={{ gridColumn: "1 / -1", display:"flex", gap:12, alignItems:"center", padding:"0 8px" }}>
   <div style={{ fontSize:12, color:"#334155" }}><strong>{duration.days}</strong> day{duration.days!==1?"s":""}</div>
   <div style={{ fontSize:12, color:"#334155" }}><strong>{duration.nights}</strong> night{duration.nights!==1?"s":""}</div>
  </div>
 )}
 <F label="Assigned To">
 <Sel value={form.assigned_to} onChange={fld("assigned_to")}> <option value="">{isAdmin ? "Select user" : (currentUser?.name || "Current user")}</option>
 {users.filter(u=>u.status === "Active").map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
 </Sel>
 </F>
 </div>
 <F label="Notes / Requirements"><TA value={form.notes} onChange={fld("notes")} placeholder="Special requests, trip purpose, preferences…"/></F>
 <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
 <Btn v="secondary" onClick={()=>{ setShowAdd(false); setEditingId(null); setForm({ name:"",email:"",phone:"",destination:"",pax:2,kids:0,budget:"",travel_date:"",end_date:"",notes:"",assigned_to:"" }); }}>Cancel</Btn>
 <Btn v="success" icon="check" onClick={save}>{editingId?"Update Lead":"Save Lead"}</Btn>
 </div>
 </div>
 )}
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, overflow:"hidden" }}>
 <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
 <thead><tr style={{ background:"#F6F8FC" }}>
 {["ID","Client","Destination","Assigned To","Pax","Date","Budget","Status","Actions"].map(h=><th key={h} style={{ padding:"9px 13px", textAlign:"left", fontSize:10, color:"#475569", fontWeight:700, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>)}
 </tr></thead>
 <tbody>
 {filtered.map(lead => (
 <tr key={lead.id} className="row" style={{ borderBottom:"1px solid #EEF3F9", transition:"background .15s" }}>
 <td style={{ padding:"10px 13px", color:"#2A6A8A", fontSize:11, fontWeight:700 }}>{lead.id}</td>
 <td style={{ padding:"10px 13px" }}>
 <div style={{ fontWeight:600, color:"#0F172A" }}>{lead.name}</div>
 <div style={{ fontSize:11, color:"#475569" }}>{lead.email}</div>
 </td>
 <td style={{ padding:"10px 13px", color:"#334155" }}>{lead.destination}</td>
 <td style={{ padding:"10px 13px", color:"#475569", fontSize:12 }}>{lead.assigned_to || "Unassigned"}</td>
 <td style={{ padding:"10px 13px", color:"#334155", fontSize:12 }}>{lead.pax}A {lead.kids>0?`${lead.kids}K`:""}</td>
 <td style={{ padding:"10px 13px", color:"#334155", fontSize:12 }}>
  {lead.travel_date}{lead.end_date ? ` → ${lead.end_date}` : ""}
  {lead.end_date && (() => {
    const leadDuration = calcDuration(lead.travel_date, lead.end_date);
    return leadDuration.days > 0 ? <div style={{ fontSize:11, color:"#64748B", marginTop:4 }}>{leadDuration.days} day{leadDuration.days!==1?"s":""} · {leadDuration.nights} night{leadDuration.nights!==1?"s":""}</div> : null;
  })()}
 </td>
 <td style={{ padding:"10px 13px", color:"#FFB74D", fontSize:12 }}>₹{lead.budget}</td>
 <td style={{ padding:"10px 13px" }}>
 <Sel value={lead.status} onChange={e=>updateStatus(lead.id,e.target.value)} style={{ padding:"3px 7px", fontSize:11, width:"auto" }}>
 {["New","Quote Requested","Quote Received","Quote Sent","Confirmed","Cancelled"].map(s=><option key={s}>{s}</option>)}
 </Sel>
 </td>
 <td style={{ padding:"10px 13px" }}>
  <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
 <Btn v="secondary" s={{ padding:"3px 7px", fontSize:11 }} icon="itinerary" onClick={()=>onItinerary(lead)}>Itin</Btn>
 <Btn v="secondary" s={{ padding:"3px 7px", fontSize:11 }} icon="send" onClick={()=>onQuote(lead)}>Quote</Btn>
 <Btn v="secondary" s={{ padding:"3px 7px", fontSize:11 }} icon="invoice" onClick={()=>onInvoice(lead)}>Inv</Btn>
 <Btn v="secondary" s={{ padding:"3px 7px", fontSize:11 }} icon="voucher" onClick={()=>onVoucher(lead)}>Vchr</Btn>
  <Btn v="ghost" s={{ padding:"3px 7px", fontSize:11 }} onClick={()=>{ setShowAdd(true); setEditingId(lead.id); setForm({ name:lead.name||"", email:lead.email||"", phone:lead.phone||"", destination:lead.destination||"", pax:lead.pax||2, kids:lead.kids||0, budget:lead.budget||"", travel_date:lead.travel_date||"", end_date:lead.end_date||"", notes:lead.notes||"", assigned_to:lead.assigned_to||"" }); window.scrollTo({ top:0, behavior:'smooth' }); }}>Edit</Btn>
  <Btn v="ghost" s={{ padding:"3px 7px", fontSize:11, color:"#EF9A9A" }} onClick={()=>del(lead.id)}>✕</Btn>
 </div>
 </td>
 </tr>
 ))}
 {filtered.length===0 && <tr><td colSpan={9} style={{ padding:30, textAlign:"center", color:"#94A3B8" }}>No leads found</td></tr>}
 </tbody>
 </table>
 </div>
 </div>
 );
}
// ─── PAGE: QUOTES ─────────────────────────────────────────────────────────────
function PageQuotes({ quotes, setQuotes, vendors, toast$ }) {
 const updateQuoteStatus = (id, newStatus) => {
  setQuotes(prev => prev.map(q => q.id === id ? { ...q, status: newStatus } : q));
  toast$(`Quote status updated to ${newStatus}`);
 };
 return (
 <div>
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:18, marginBottom:16 }}>
 <div style={{ fontWeight:700, color:"#0F172A", marginBottom:13, fontSize:14 }}>Registered Vendors</div>
 <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:11 }}>
 {vendors.map(v=>(
 <div key={v.id} className="card" style={{ background:"#F6F8FC", border:"1px solid #E6ECF5", borderRadius:10, padding:13, transition:"border-color .2s" }}>
 <div style={{ fontWeight:700, color:"#0F172A", fontSize:13, marginBottom:3 }}>{v.name}</div>
 <div style={{ fontSize:11, color:"#475569", marginBottom:4 }}>{v.destination} · {v.category}</div>
 <div style={{ fontSize:11, color:"#64748B" }}>★ {v.rating}</div>
 <div style={{ marginTop:5 }}><Badge status={v.status}/></div>
 </div>
 ))}
 </div>
 </div>
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, overflow:"hidden" }}>
 <div style={{ padding:"13px 18px", borderBottom:"1px solid #E6ECF5", fontWeight:700, color:"#0F172A", fontSize:14 }}>Quote Log ({quotes.length})</div>
 {quotes.length===0 ? <div style={{ padding:40, textAlign:"center", color:"#94A3B8" }}>No quotes yet. Go to Leads → click Quote button.</div> : (
 <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
 <thead><tr style={{ background:"#F6F8FC" }}>{["Query Code","Lead","Destination","Vendors","Date","Status","Actions"].map(h=><th key={h} style={{ padding:"9px 13px", textAlign:"left", fontSize:10, color:"#475569", fontWeight:700, textTransform:"uppercase" }}>{h}</th>)}</tr></thead>
 <tbody>
 {quotes.map(q=>(
 <tr key={q.id} className="row" style={{ borderBottom:"1px solid #EEF3F9" }}>
 <td style={{ padding:"10px 13px", fontWeight:700, color:"#4FC3F7" }}>{q.query_code}</td>
 <td style={{ padding:"10px 13px", color:"#0F172A" }}>{q.lead_name}</td>
 <td style={{ padding:"10px 13px" }}>{q.destination}</td>
 <td style={{ padding:"10px 13px", fontSize:11, color:"#64748B" }}>{(q.vendors_contacted||[]).length || "—"}</td>
 <td style={{ padding:"10px 13px", fontSize:11, color:"#64748B" }}>{q.created_at}</td>
 <td style={{ padding:"10px 13px" }}>
  <Sel value={q.status} onChange={e => updateQuoteStatus(q.id, e.target.value)} style={{ padding:"3px 7px", fontSize:11, width:"auto" }}>
   {["Quote Requested","Quote Received","Quote Sent"].map(s=><option key={s}>{s}</option>)}
  </Sel>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 )}
 </div>
 </div>
 );
}
// ─── PAGE: VENDORS ────────────────────────────────────────────────────────────
function PageVendors({ vendors, setVendors, onDownloadVendors, onUploadVendors, toast$ }) {
 const [showAdd, setShowAdd] = useState(false);
 const [editingVendorId, setEditingVendorId] = useState(null);
 const [form, setForm] = useState({ name:"", email:"", email2:"", phone:"", destination:"", category:"", rating:"", status:"Active" });
 const fileRef = useRef();
 const fld = k => e => setForm(p=>({...p,[k]:e.target.value}));
 const resetForm = () => setForm({ name:"", email:"", email2:"", phone:"", destination:"", category:"", rating:"", status:"Active" });
 const startEditing = vendor => {
 setForm({ ...vendor });
 setEditingVendorId(vendor.id);
 setShowAdd(true);
 };
 const save = () => {
 if (!form.name||!form.email||!form.destination) return toast$("Name, email and destination required", true);
 if (editingVendorId) {
 setVendors(p=>p.map(v=>v.id===editingVendorId ? { ...v, ...form } : v));
 toast$(`Vendor "${form.name}" updated!`);
 } else {
 setVendors(p=>[...p,{ ...form, id:genId("V"), status:"Active" }]);
 toast$(`Vendor "${form.name}" registered!`);
 }
 setShowAdd(false);
 setEditingVendorId(null);
 resetForm();
 };
 const isEditing = Boolean(editingVendorId);
 return (
 <div>
 <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16, gap:10, flexWrap:"wrap" }}>
 <span style={{ fontSize:13, color:"#475569" }}>{vendors.length} vendors registered</span>
 <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
 <Btn v="secondary" icon="upload" onClick={()=>fileRef.current?.click()}>Upload Vendors</Btn>
 <Btn v="secondary" icon="download" onClick={onDownloadVendors}>Download Vendors</Btn>
 <Btn icon="plus" onClick={()=>{ if (showAdd) { setShowAdd(false); setEditingVendorId(null); resetForm(); } else { setShowAdd(true); setEditingVendorId(null); resetForm(); } }}>{showAdd?"Cancel":"Register Vendor"}</Btn>
 </div>
 </div>
 <input ref={fileRef} type="file" accept=".json,.csv,.txt,.xls,.xlsx,.pdf,.doc,.docx,.png,.jpg,.jpeg" style={{ display:"none" }} onChange={e=>{ const file = e.target.files?.[0]; if (file) { onUploadVendors(file); e.target.value = null; } }}/>
 {showAdd && (
 <div className="fadein" style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:12, padding:18, marginBottom:18 }}>
 <div style={{ fontWeight:700, color:"#0F172A", marginBottom:14 }}>{isEditing?"Edit Vendor":"New Vendor"}</div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:11 }}>
 <F label="Vendor Name" req><Inp value={form.name} onChange={fld("name")} placeholder="Company name"/></F>
 <F label="Email" req><Inp type="email" value={form.email} onChange={fld("email")} placeholder="vendor@email.com"/></F>
 <F label="Email 2"><Inp type="email" value={form.email2} onChange={fld("email2")} placeholder="alternate@email.com"/></F>
 <F label="Phone"><Inp value={form.phone} onChange={fld("phone")} placeholder="+91 XXXXXXXXXX"/></F>
 <F label="Destination" req><Inp value={form.destination} onChange={fld("destination")} placeholder="e.g. Vietnam"/></F>
 <F label="Category"><Sel value={form.category} onChange={fld("category")}><option value="">Select</option>{["Hotel","Resort","Villa","Tour Operator","DMC","Activity"].map(c=><option key={c}>{c}</option>)}</Sel></F>
 <F label="Rating"><Inp type="number" min="1" max="5" step="0.1" value={form.rating} onChange={fld("rating")} placeholder="4.5"/></F>
 </div>
 <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
 <Btn v="secondary" onClick={()=>{ setShowAdd(false); setEditingVendorId(null); resetForm(); }}>Cancel</Btn>
 <Btn v="success" icon="check" onClick={save}>{isEditing?"Save":"Register"}</Btn>
 </div>
 </div>
 )}
 <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:14 }}>
 {vendors.map(v=>(
 <div key={v.id} className="card" style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:18, transition:"border-color .2s" }}>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
 <div><div style={{ fontWeight:700, color:"#0F172A", fontSize:14 }}>{v.name}</div><div style={{ fontSize:12, color:"#475569", marginTop:2 }}>{v.category} · {v.destination}</div></div>
 <Badge status={v.status}/>
 </div>
 <div style={{ fontSize:12, color:"#64748B", marginBottom:6 }}>{v.email}{v.email2 ? ` · ${v.email2}` : ""}</div>
 <div style={{ fontSize:12, color:"#64748B", marginBottom:6 }}>{v.phone || ""}</div>
 <div style={{ fontSize:12, color:"#475569" }}>★ {v.rating||"N/A"}</div>
 <div style={{ marginTop:10, display:"flex", gap:8, flexWrap:"wrap" }}>
 <Btn v="ghost" s={{ fontSize:11, color:"#0284C7", padding:"3px 0" }} onClick={()=>startEditing(v)}>Edit</Btn>
 <Btn v="ghost" s={{ fontSize:11, color:v.status==="Active"?"#EF9A9A":"#16A34A", padding:"3px 0" }} onClick={()=>{ setVendors(p=>p.map(x=>x.id===v.id?{...x,status:x.status==="Active"?"Inactive":"Active"}:x)); toast$(`Vendor "${v.name}" ${v.status==="Active"?"deactivated":"activated"}`); }}>{v.status==="Active"?"Deactivate":"Activate"}</Btn>
 <Btn v="ghost" s={{ fontSize:11, color:"#EF9A9A", padding:"3px 0" }} onClick={()=>{ setVendors(p=>p.filter(x=>x.id!==v.id)); toast$("Vendor removed"); }}>Remove</Btn>
 </div>
 </div>
 ))}
 </div>
 </div>
 );
}
// ─── PAGE: INVOICES ───────────────────────────────────────────────────────────
function PageInvoices({ invoices, setInvoices, leads, onGenerate }) {
 return (
 <div>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
 <span style={{ fontSize:13, color:"#475569" }}>{invoices.length} invoices</span>
 <Sel style={{ width:230, padding:"7px 11px", fontSize:12 }} onChange={e=>{ const l=leads.find(x=>x.id===e.target.value); if(l) onGenerate(l); e.target.value=""; }}>
 <option value=""> Generate Invoice for Lead…</option>
 {leads.map(l=><option key={l.id} value={l.id}>{l.name} – {l.destination}</option>)}
 </Sel>
 </div>
 {invoices.length===0 ? (
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:60, textAlign:"center", color:"#94A3B8" }}>Select a lead above or click "Inv" on any lead row</div>
 ) : (
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, overflow:"hidden" }}>
 <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
 <thead><tr style={{ background:"#F6F8FC" }}>{["Invoice No","Client","Destination","Total","Date","Status"].map(h=><th key={h} style={{ padding:"9px 13px", textAlign:"left", fontSize:10, color:"#475569", fontWeight:700, textTransform:"uppercase" }}>{h}</th>)}</tr></thead>
 <tbody>
 {invoices.map((inv,i)=>(
 <tr key={inv.id||i} className="row" style={{ borderBottom:"1px solid #EEF3F9" }}>
 <td style={{ padding:"10px 13px", fontWeight:700, color:"#4FC3F7" }}>{inv.invoice_no}</td>
 <td style={{ padding:"10px 13px", color:"#0F172A" }}>{inv.lead_name}</td>
 <td style={{ padding:"10px 13px" }}>{inv.destination}</td>
 <td style={{ padding:"10px 13px", fontWeight:700, color:"#81C784" }}>₹{Number(inv.total||0).toLocaleString("en-IN")}</td>
 <td style={{ padding:"10px 13px", fontSize:11 }}>{inv.date}</td>
 <td style={{ padding:"10px 13px" }}><Badge status={inv.status}/></td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 );
}
// ─── PAGE: VOUCHERS ───────────────────────────────────────────────────────────
function PageVouchers({ vouchers, leads, onGenerate }) {
 return (
 <div>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
 <span style={{ fontSize:13, color:"#475569" }}>{vouchers.length} vouchers</span>
 <Sel style={{ width:240, padding:"7px 11px", fontSize:12 }} onChange={e=>{ const l=leads.find(x=>x.id===e.target.value); if(l) onGenerate(l); e.target.value=""; }}>
 <option value=""> Generate Voucher for Lead…</option>
 {leads.map(l=><option key={l.id} value={l.id}>{l.name} – {l.destination}</option>)}
 </Sel>
 </div>
 {vouchers.length===0 ? (
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:60, textAlign:"center", color:"#94A3B8" }}>No vouchers yet. Select a lead above.</div>
 ) : (
 <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:14 }}>
 {vouchers.map((v,i)=>(
 <div key={v.id||i} className="card" style={{ background:"linear-gradient(135deg,#F2F6FB,#EEF3F9)", border:"1px solid #D5E1EE", borderRadius:12, padding:18, transition:"border-color .2s" }}>
 <div style={{ display:"flex", justifyContent:"space-between", marginBottom:11 }}><div style={{ fontFamily:"'Playfair Display',serif", fontSize:15, color:"#0F172A" }}>Travel Voucher</div><div style={{ fontWeight:700, color:"#4FC3F7", fontSize:12 }}>{v.voucher_no}</div></div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7, fontSize:12, marginBottom:10 }}>
 {[["Guest",v.client_name],["Destination",v.destination],["Date",v.travel_date],["Hotel",v.hotel]].map(([k,val])=>(
 <div key={k}><span style={{ color:"#475569" }}>{k}: </span><span style={{ color:"#0F172A" }}>{val||"—"}</span></div>
 ))}
 </div>
 <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
 {(v.inclusions||[]).map((inc,j)=><span key={j} style={{ background:"#E6ECF5", border:"1px solid #D5E1EE", borderRadius:6, padding:"2px 7px", fontSize:10, color:"#4FC3F7" }}>{inc}</span>)}
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 );
}
// ─── PAGE: AI CHAT ────────────────────────────────────────────────────────────
function PageChat({ leads, setLeads, quotes, invoices, addNotif, toast$, setPage }) {
 const [log, setLog] = useState([
 { role:"ai", text:" Hello! I'm your Safarnaama AI assistant. I can:\n\n• Create leads from natural text\n• Generate itineraries, invoices, vouchers\n• Answer questions about your leads & quotes\n• Give travel recommendations\n\nTry: *\"Create a lead for Pulkit Bhardwaj travelling to Vietnam for 7N8D from 14 June, 4 adults 2 kids\"*" }
 ]);
 const [input, setInput] = useState("");
 const [thinking, setThinking] = useState(false);
 const endRef = useRef();
 useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [log]);
 const send = async () => {
 const msg = input.trim();
 if (!msg || thinking) return;
 setInput("");
 setLog(p=>[...p,{ role:"user", text:msg }]);
 setThinking(true);
 try {
 const system = `You are a smart CRM assistant for Safarnaama Holidays, an Indian travel company.
Current CRM data:
- Total leads: ${leads.length}
- Recent leads: ${leads.slice(0,5).map(l=>`${l.name} (${l.destination}, ${l.status})`).join(", ")||"none"}
- Quotes: ${quotes.length}
- Invoices: ${invoices.length}
Your job:
1. If the user wants to CREATE A LEAD, extract details and return JSON action:
{"action":"create_lead","lead":{"name":"","email":"","phone":"","destination":"","pax":0,"kids":0,"budget":"","travel_date":"","notes":"","assigned_to":""}}
travel_date format: YYYY-MM-DD. If they say "14 June" use "2026-06-14". If "7N8D" use 8 days from travel_date as notes.
pax = adults only. kids = children count.
2. If the user asks to NAVIGATE somewhere, return:
{"action":"navigate","page":"leads|quotes|vendors|invoices|vouchers|settings"}
3. For any other question, return:
{"action":"reply","text":"your helpful response here"}
Always return valid JSON only. No markdown, no extra text.`;
 const raw = await askClaude(msg, system);
 let parsed;
 try { parsed = JSON.parse(raw.replace(/```json|```/g,"").trim()); }
 catch { parsed = { action:"reply", text: raw }; }
 if (parsed.action === "create_lead" && parsed.lead) {
 const lead = { ...parsed.lead, id:genId("L"), status:"New", created_at:today() };
 // Fill blanks
 if (!lead.pax || lead.pax < 1) lead.pax = 1;
 if (!lead.kids) lead.kids = 0;
 setLeads(p=>[lead,...p]);
 addNotif(`Lead created: ${lead.name} → ${lead.destination}`);
 const summary = ` Lead created successfully!\n\n**Name:** ${lead.name}\n**Destination:** ${lead.destination}\n**Travel Date:** ${lead.travel_date||"Not specified"}\n**Adults:** ${lead.pax} | **Kids:** ${lead.kids}\n**Notes:** ${lead.notes||"—"}\n\nYou can now go to the Leads page to generate an itinerary, quote, invoice or voucher for this lead.`;
 setLog(p=>[...p,{ role:"ai", text:summary, leadCreated:lead }]);
 } else if (parsed.action === "navigate") {
 setPage(parsed.page);
 setLog(p=>[...p,{ role:"ai", text:`Navigating to ${parsed.page} page…` }]);
 } else {
 setLog(p=>[...p,{ role:"ai", text: parsed.text || raw }]);
 }
 } catch(e) {
 setLog(p=>[...p,{ role:"ai", text:"Sorry, I had trouble processing that. Please try again.\nError: "+e.message }]);
 } finally {
 setThinking(false);
 }
 };
 const suggestions = [
 "Create a lead for Pulkit Bhardwaj travelling Vietnam 7N8D from 14 June, 4 adults 2 kids",
 "How many leads do I have?",
 "Show me the leads page",
 "What destinations are most popular in my leads?",
 "Create lead for Priya Singh, Maldives, 2 adults, 15 July 2026, budget 2 lakhs",
 ];
 return (
 <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 96px)" }}>
 <div style={{ background:"linear-gradient(135deg,#F2F6FB,#EEF3F9)", border:"1px solid #D5E1EE", borderRadius:10, padding:"10px 14px", marginBottom:13, fontSize:12, color:"#4FC3F7", display:"flex", alignItems:"center", gap:8 }}>
 <Icon name="chat" size={14}/>
 AI Chat powered by Claude AI via backend proxy — secure, no API key in browser.
 </div>
 {/* Chat log */}
 <div style={{ flex:1, overflow:"auto", background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:16, marginBottom:11 }}>
 {log.map((m,i)=>(
 <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start", marginBottom:13 }}>
 <div style={{ background:m.role==="user"?"#1A4A6A":"#E6ECF5", border:`1px solid ${m.role==="user"?"#2A6A8A":"#D5E1EE"}`, borderRadius:m.role==="user"?"12px 12px 3px 12px":"12px 12px 12px 3px", padding:"10px 14px", maxWidth:"78%", fontSize:13, color:"#0F172A", lineHeight:1.65, whiteSpace:"pre-wrap" }}>
 {m.text}
 {m.leadCreated && (
 <div style={{ marginTop:10, display:"flex", gap:7 }}>
 <Btn v="primary" s={{ fontSize:11, padding:"4px 10px" }} onClick={()=>setPage("leads")}>View in Leads →</Btn>
 </div>
 )}
 </div>
 </div>
 ))}
 {thinking && (
 <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:13 }}>
 <div style={{ background:"#E6ECF5", border:"1px solid #D5E1EE", borderRadius:"12px 12px 12px 3px", padding:"10px 14px" }}>
 <div style={{ display:"flex", gap:5, alignItems:"center" }}>
 {[0,1,2].map(i=><div key={i} style={{ width:7, height:7, borderRadius:"50%", background:"#4FC3F7", animation:`pulse 1.2s ${i*.2}s infinite` }}/>)}
 </div>
 </div>
 </div>
 )}
 <div ref={endRef}/>
 </div>
 {/* Suggestions */}
 {log.length <= 2 && (
 <div style={{ display:"flex", gap:7, flexWrap:"wrap", marginBottom:10 }}>
 {suggestions.map((s,i)=>(
 <button key={i} onClick={()=>setInput(s)} style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:8, padding:"6px 11px", color:"#4A8A9A", fontSize:11, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}>{s.slice(0,50)}{s.length>50?"…":""}</button>
 ))}
 </div>
 )}
 {/* Input */}
 <div style={{ display:"flex", gap:9 }}>
 <input
 value={input}
 onChange={e=>setInput(e.target.value)}
 onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); } }}
 placeholder="Type naturally… e.g. 'Create lead for Pulkit Bhardwaj travelling Vietnam 7N8D from 14 June, 4 adults 2 kids'"
 style={{ flex:1, background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:9, padding:"11px 14px", color:"#0F172A", fontSize:13, outline:"none", fontFamily:"inherit" }}
 />
 <Btn icon="send" onClick={send} spin={thinking}>Send</Btn>
 </div>
 </div>
 );
}

// ─── PAGE: TASKS ──────────────────────────────────────────────────────────────
function PageTasks({ tasks, setTasks, users, leads, currentUser, isAdmin, onCreateTask }) {
 const [search, setSearch] = useState("");
 const visibleTasks = tasks
 .filter(t => isAdmin || (t.assigned_user_name || "") === (currentUser?.name || ""))
 .filter(t => (t.task_title || "").toLowerCase().includes(search.toLowerCase()) || (t.lead_name || "").toLowerCase().includes(search.toLowerCase()));

 const updateTaskStatus = (id, status) => setTasks(p => p.map(t => t.id === id ? { ...t, status } : t));

 return (
 <div>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, gap:10 }}>
 <div style={{ position:"relative" }}>
 <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"#94A3B8" }}><Icon name="search" size={14}/></span>
 <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search task or lead..." style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:8, padding:"8px 12px 8px 32px", color:"#0F172A", fontSize:13, width:250, outline:"none", fontFamily:"inherit" }}/>
 </div>
 <Btn icon="plus" onClick={onCreateTask}>Add / Assign Task</Btn>
 </div>

 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, overflow:"hidden" }}>
 <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
 <thead><tr style={{ background:"#F6F8FC" }}>
 {["Task","Assigned To","Lead","Due Date","Priority","Status","Created By"].map(h => <th key={h} style={{ padding:"9px 13px", textAlign:"left", fontSize:10, color:"#475569", fontWeight:700, textTransform:"uppercase" }}>{h}</th>)}
 </tr></thead>
 <tbody>
 {visibleTasks.map(t => (
 <tr key={t.id} className="row" style={{ borderBottom:"1px solid #EEF3F9" }}>
 <td style={{ padding:"10px 13px" }}>
 <div style={{ color:"#0F172A", fontWeight:600 }}>{t.task_title}</div>
 <div style={{ color:"#64748B", fontSize:11 }}>{t.description || "No description"}</div>
 </td>
 <td style={{ padding:"10px 13px", color:"#334155" }}>{t.assigned_user_name || "-"}</td>
 <td style={{ padding:"10px 13px", color:"#334155" }}>{t.lead_name || "-"}</td>
 <td style={{ padding:"10px 13px", color:"#334155" }}>{t.due_date || "-"}</td>
 <td style={{ padding:"10px 13px" }}><Badge status={t.priority || "Medium"}/></td>
 <td style={{ padding:"10px 13px" }}>
 <Sel value={t.status || "Open"} onChange={e=>updateTaskStatus(t.id, e.target.value)} style={{ padding:"3px 7px", fontSize:11, width:"auto" }}>
 <option>Open</option><option>In Progress</option><option>Done</option>
 </Sel>
 </td>
 <td style={{ padding:"10px 13px", color:"#64748B", fontSize:12 }}>{t.created_by || "System"}</td>
 </tr>
 ))}
 {visibleTasks.length === 0 && <tr><td colSpan={7} style={{ padding:30, textAlign:"center", color:"#94A3B8" }}>No tasks found</td></tr>}
 </tbody>
 </table>
 </div>
 </div>
 );
}

// ─── PAGE: USERS ──────────────────────────────────────────────────────────────
function PageUsers({ users, setUsers, roles, currentUser, isAdmin, toast$ }) {
 const [showAdd, setShowAdd] = useState(false);
 const [form, setForm] = useState({ name:"", email:"", role:"User" });

 const saveUser = () => {
 if (!isAdmin) return toast$("Only Admin can create users", true);
 if (!form.name.trim() || !form.email.trim()) return toast$("Name and email are required", true);
 setUsers(p => [...p, { id:genId("U"), name:form.name, email:form.email, role:form.role, status:"Active", created_at:today() }]);
 setForm({ name:"", email:"", role:"User" });
 setShowAdd(false);
 toast$("User created successfully");
 };

 const updateUserRole = (id, role) => {
 if (!isAdmin) return;
 setUsers(p => p.map(u => u.id === id ? { ...u, role } : u));
 };

 const toggleUserStatus = (id) => {
 if (!isAdmin) return;
 setUsers(p => p.map(u => u.id === id ? { ...u, status:u.status === "Active" ? "Inactive" : "Active" } : u));
 };

 return (
 <div>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
 <span style={{ fontSize:13, color:"#475569" }}>Current login: {currentUser?.name} ({currentUser?.role})</span>
 <Btn icon="plus" onClick={()=>setShowAdd(!showAdd)} disabled={!isAdmin}>{showAdd ? "Cancel" : "Add User"}</Btn>
 </div>

 {showAdd && (
 <div className="fadein" style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:12, padding:18, marginBottom:18 }}>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:11 }}>
 <F label="Name" req><Inp value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} /></F>
 <F label="Email" req><Inp type="email" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} /></F>
 <F label="Role">
 <Sel value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))}>
 {roles.map(r => <option key={r.id}>{r.name}</option>)}
 </Sel>
 </F>
 </div>
 <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
 <Btn v="secondary" onClick={()=>setShowAdd(false)}>Cancel</Btn>
 <Btn v="success" icon="check" onClick={saveUser}>Create User</Btn>
 </div>
 </div>
 )}

 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, overflow:"hidden" }}>
 <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
 <thead><tr style={{ background:"#F6F8FC" }}>
 {["Name","Email","Role","Status","Actions"].map(h => <th key={h} style={{ padding:"9px 13px", textAlign:"left", fontSize:10, color:"#475569", fontWeight:700, textTransform:"uppercase" }}>{h}</th>)}
 </tr></thead>
 <tbody>
 {users.map(u => (
 <tr key={u.id} className="row" style={{ borderBottom:"1px solid #EEF3F9" }}>
 <td style={{ padding:"10px 13px", color:"#0F172A", fontWeight:600 }}>{u.name}</td>
 <td style={{ padding:"10px 13px", color:"#334155" }}>{u.email}</td>
 <td style={{ padding:"10px 13px" }}>
 <Sel value={u.role} onChange={e=>updateUserRole(u.id, e.target.value)} disabled={!isAdmin} style={{ padding:"3px 7px", fontSize:11, width:"auto" }}>
 {roles.map(r => <option key={r.id}>{r.name}</option>)}
 </Sel>
 </td>
 <td style={{ padding:"10px 13px" }}><Badge status={u.status}/></td>
 <td style={{ padding:"10px 13px" }}>
 <Btn v="secondary" s={{ padding:"3px 8px", fontSize:11 }} disabled={!isAdmin} onClick={()=>toggleUserStatus(u.id)}>{u.status === "Active" ? "Deactivate" : "Activate"}</Btn>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 );
}

// ─── PAGE: ROLES ──────────────────────────────────────────────────────────────
function PageRoles({ roles, setRoles, users, isAdmin, toast$ }) {
 const [showAdd, setShowAdd] = useState(false);
 const [editId, setEditId] = useState(null);
 const [form, setForm] = useState({ name:"", description:"", permissions:[] });

 const PERM_COLORS = {
  leads:"#4FC3F7", quotes:"#FFB74D", invoices:"#81C784", vouchers:"#CE93D8",
  vendors:"#F48FB1", tasks:"#80CBC4", assign_task:"#FFD54F",
  users:"#90CAF9", roles:"#A5D6A7", chat:"#FFAB91", settings:"#B0BEC5",
 };

 const toggleFormPerm = perm =>
  setForm(p => ({ ...p, permissions: p.permissions.includes(perm) ? p.permissions.filter(x=>x!==perm) : [...p.permissions, perm] }));

 const toggleRolePerm = (roleId, perm) => {
  if (!isAdmin) return;
  setRoles(p => p.map(r => r.id !== roleId ? r : {
   ...r,
   permissions: (r.permissions||[]).includes(perm)
    ? (r.permissions||[]).filter(x=>x!==perm)
    : [...(r.permissions||[]), perm],
  }));
 };

 const createRole = () => {
  if (!isAdmin) return toast$("Only Admin can create roles", true);
  if (!form.name.trim()) return toast$("Role name is required", true);
  if (roles.some(r => (r.name||"").toLowerCase() === form.name.trim().toLowerCase())) return toast$("Role already exists", true);
  setRoles(p => [...p, { id:genId("R"), name:form.name.trim(), description:form.description.trim()||"Custom role", permissions:form.permissions, created_at:today() }]);
  setForm({ name:"", description:"", permissions:[] });
  setShowAdd(false);
  toast$("Role created");
 };

 const deleteRole = id => {
  if (!isAdmin) return;
  if (users.some(u => { const r = roles.find(r=>r.id===id); return r && u.role===r.name; })) return toast$("Cannot delete role with assigned users", true);
  setRoles(p => p.filter(r => r.id !== id));
  toast$("Role deleted");
 };

 const PermChip = ({ permId, active, onClick, size="sm" }) => {
  const color = PERM_COLORS[permId] || "#90A4AE";
  const label = PERMISSIONS.find(p=>p.id===permId)?.label || permId;
  return (
   <span onClick={onClick} style={{ display:"inline-flex", alignItems:"center", gap:4, background: active ? color+"22" : "#F6F8FC", border:`1px solid ${active ? color : "#E6ECF5"}`, borderRadius:6, padding: size==="sm" ? "3px 9px" : "5px 11px", fontSize: size==="sm" ? 11 : 12, fontWeight:600, color: active ? color : "#94A3B8", cursor: onClick ? "pointer" : "default", transition:"all .15s", opacity: active ? 1 : 0.45, userSelect:"none" }}>
    {active && <Icon name="check" size={9}/>}{label}
   </span>
  );
 };

 return (
  <div>
   <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
    <span style={{ fontSize:13, color:"#475569" }}>Create role groups, assign module permissions, then assign users to roles</span>
    {isAdmin && <Btn icon="plus" onClick={()=>{ setShowAdd(!showAdd); setEditId(null); }}>{showAdd ? "Cancel" : "Create Role"}</Btn>}
   </div>

   {showAdd && (
    <div className="fadein" style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:12, padding:18, marginBottom:18 }}>
     <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:11, marginBottom:14 }}>
      <F label="Role Name" req><Inp value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Finance Team"/></F>
      <F label="Description"><Inp value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="What can this role do?"/></F>
     </div>
     <F label="Permissions — click to toggle">
      <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginTop:4 }}>
       {PERMISSIONS.map(p => <PermChip key={p.id} permId={p.id} active={form.permissions.includes(p.id)} onClick={()=>toggleFormPerm(p.id)} size="md"/>)}
      </div>
     </F>
     <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:12 }}>
      <Btn v="secondary" onClick={()=>setShowAdd(false)}>Cancel</Btn>
      <Btn v="success" icon="check" onClick={createRole}>Save Role</Btn>
     </div>
    </div>
   )}

   <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
    {roles.map(r => {
     const count = users.filter(u => u.role === r.name).length;
     const isEditing = editId === r.id;
     const isBuiltin = (r.name||"").toLowerCase() === "admin";
     return (
      <div key={r.id} className="card" style={{ background:"#FFFFFF", border:`1px solid ${isEditing?"#4FC3F7":"#E6ECF5"}`, borderRadius:12, padding:16, transition:"border .15s" }}>
       <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
         <div style={{ fontWeight:700, color:"#0F172A", fontSize:14, display:"flex", alignItems:"center", gap:8 }}>
          {r.name}
          {isBuiltin && <span style={{ fontSize:10, background:"#4FC3F722", color:"#4FC3F7", border:"1px solid #4FC3F744", borderRadius:4, padding:"1px 7px", fontWeight:600 }}>BUILT-IN</span>}
         </div>
         <div style={{ fontSize:12, color:"#64748B", marginTop:2 }}>{r.description} · <b style={{ color:"#334155" }}>{count}</b> user{count!==1?"s":""}</div>
        </div>
        {isAdmin && !isBuiltin && (
         <div style={{ display:"flex", gap:7 }}>
          <Btn v="secondary" s={{ padding:"4px 10px", fontSize:11 }} onClick={()=>setEditId(isEditing ? null : r.id)}>
           {isEditing ? "Done" : "Edit Permissions"}
          </Btn>
          <Btn v="danger" s={{ padding:"4px 10px", fontSize:11 }} onClick={()=>deleteRole(r.id)}>Delete</Btn>
         </div>
        )}
       </div>
       {isEditing && (
        <div style={{ marginBottom:10, fontSize:12, color:"#4FC3F7", fontWeight:600 }}>Click permissions below to toggle on/off:</div>
       )}
       <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        {PERMISSIONS.map(p => (
         <PermChip key={p.id} permId={p.id}
          active={(r.permissions||[]).includes(p.id)}
          onClick={isEditing && !isBuiltin ? ()=>toggleRolePerm(r.id, p.id) : undefined}/>
        ))}
       </div>
      </div>
     );
    })}
   </div>
  </div>
 );
}
// ─── PAGE: WHITE LABEL ────────────────────────────────────────────────────────
const WL_MODULES = [
 { id:"leads",     label:"Leads" },
 { id:"itinerary", label:"Itinerary Builder" },
 { id:"quotes",    label:"Quotes" },
 { id:"invoices",  label:"Invoices" },
 { id:"vouchers",  label:"Vouchers" },
 { id:"vendors",   label:"Vendors" },
 { id:"tasks",     label:"Tasks" },
 { id:"users",     label:"User Management" },
 { id:"roles",     label:"Role Management" },
 { id:"chat",      label:"AI Chat" },
];

const DEFAULT_WL_FORM = {
 company_name:"", tagline:"", contact_email:"", contact_phone:"",
 website:"", address:"", logo_url:"", primary_color:"#1A6B8A",
 accent_color:"#4FC3F7", bg_color:"#F6F8FC", text_color:"#0F172A",
 modules:["leads","quotes","invoices","vouchers","vendors","tasks","users","roles","chat"],
 powered_by:true, status:"Active", notes:"",
 admin_name:"", admin_email:"",
};

function PageWhiteLabel({ whiteLabels, setWhiteLabels, isAdmin, toast$ }) {
 const [view, setView] = useState("list"); // list | create | preview
 const [form, setForm] = useState({ ...DEFAULT_WL_FORM });
 const [editId, setEditId] = useState(null);
 const [previewPortal, setPreviewPortal] = useState(null);
 const [logoPreview, setLogoPreview] = useState("");

 const setF = (key, val) => setForm(p => ({ ...p, [key]: val }));
 const toggleModule = mod => setF("modules", form.modules.includes(mod) ? form.modules.filter(m=>m!==mod) : [...form.modules, mod]);

 const handleLogoUpload = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { setLogoPreview(ev.target.result); setF("logo_url", ev.target.result); };
  reader.readAsDataURL(file);
 };

 const savePortal = () => {
  if (!form.company_name.trim()) return toast$("Company name is required", true);
  if (!form.contact_email.trim()) return toast$("Contact email is required", true);
  if (!form.admin_email.trim()) return toast$("Portal admin email is required", true);

  const id = editId || genId("WL");
  const portalRecord = { id, ...form, created_at: editId ? undefined : today(), updated_at: today() };
  if (!editId) portalRecord.created_at = today();

  // Seed portal-isolated roles & users into their own localStorage namespace
  // only when creating (not on edit, to preserve existing portal data)
  if (!editId) {
   const seedRoles = [
    { id:"PR001", name:"Admin",   description:"Full portal access",   permissions: ALL_PERMS,                                  created_at: today() },
    { id:"PR002", name:"Manager", description:"Manage leads & quotes", permissions: ["leads","quotes","invoices","vouchers","vendors","tasks","assign_task","chat"], created_at: today() },
    { id:"PR003", name:"User",    description:"Handle assigned work",  permissions: ["leads","tasks","quotes","chat"],           created_at: today() },
   ];
   const seedUsers = [
    { id:"PU001", name: form.admin_name || "Portal Admin", email: form.admin_email, role:"Admin", status:"Active", created_at: today() },
   ];
   localStorage.setItem(`sfn_wl_${id}_roles`, JSON.stringify(seedRoles));
   localStorage.setItem(`sfn_wl_${id}_users`, JSON.stringify(seedUsers));
   localStorage.setItem(`sfn_wl_${id}_current_user`, JSON.stringify("PU001"));
   localStorage.setItem(`sfn_wl_${id}_tasks`,   JSON.stringify([]));
   localStorage.setItem(`sfn_wl_${id}_leads`,   JSON.stringify([]));
   localStorage.setItem(`sfn_wl_${id}_quotes`,  JSON.stringify([]));
   localStorage.setItem(`sfn_wl_${id}_invoices`,JSON.stringify([]));
   localStorage.setItem(`sfn_wl_${id}_vouchers`,JSON.stringify([]));
   localStorage.setItem(`sfn_wl_${id}_vendors`, JSON.stringify([]));
   localStorage.setItem(`sfn_wl_${id}_notifs`,  JSON.stringify([{ id:1, msg:`Welcome to ${form.company_name} CRM! Add your first lead to get started.`, time:"Just now", read:false }]));
  }

  if (editId) {
   setWhiteLabels(p => p.map(w => w.id === editId ? { ...w, ...form, updated_at:today() } : w));
   toast$(`Portal "${form.company_name}" updated`);
  } else {
   setWhiteLabels(p => [...p, portalRecord]);
   toast$(`Portal "${form.company_name}" created! Admin: ${form.admin_email}`);
  }
  setView("list"); setEditId(null); setForm({ ...DEFAULT_WL_FORM }); setLogoPreview("");
 };

 const editPortal = wl => {
  setForm({ ...DEFAULT_WL_FORM, ...wl });
  setLogoPreview(wl.logo_url || "");
  setEditId(wl.id);
  setView("create");
 };

 const deletePortal = id => {
  setWhiteLabels(p => p.filter(w => w.id !== id));
  toast$("Portal deleted");
 };

 const downloadConfig = wl => {
  const config = {
   _info: "Safarnaama CRM — White Label Config",
   generated_at: new Date().toISOString(),
   generated_by: "Safarnaama Holidays CRM",
   branding: {
    company_name: wl.company_name,
    tagline: wl.tagline,
    logo_url: wl.logo_url?.startsWith("data:") ? "(base64 logo — paste manually)" : wl.logo_url,
    primary_color: wl.primary_color,
    accent_color: wl.accent_color,
    bg_color: wl.bg_color,
    text_color: wl.text_color,
    powered_by_safarnaama: wl.powered_by,
   },
   contact: { email:wl.contact_email, phone:wl.contact_phone, website:wl.website, address:wl.address },
   enabled_modules: wl.modules,
   notes: wl.notes,
  };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${wl.company_name.replace(/\s+/g,"-").toLowerCase()}-crm-config.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast$("Config downloaded!");
 };

 const copyEmbed = wl => {
  const code = `<!-- ${wl.company_name} CRM Embed -->\n<script>\n  window.SAFARNAAMA_WL = {\n    company: "${wl.company_name}",\n    primaryColor: "${wl.primary_color}",\n    accentColor: "${wl.accent_color}",\n    contactEmail: "${wl.contact_email}",\n    modules: ${JSON.stringify(wl.modules)}\n  };\n<\/script>`;
  navigator.clipboard?.writeText(code).then(() => toast$("Embed snippet copied!")).catch(()=>toast$("Copy failed — use Download instead",true));
 };

 // ── PREVIEW MODAL ────────────────────────────────────────────────────────────
 const PreviewModal = ({ wl, onClose }) => {
  const NAV_PREVIEW = WL_MODULES.filter(m => (wl.modules||[]).includes(m.id));
  return (
   <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
    <div style={{ background:"#F6F8FC",borderRadius:16,width:"100%",maxWidth:900,maxHeight:"90vh",overflow:"hidden",boxShadow:"0 30px 70px rgba(0,0,0,.7)",display:"flex",flexDirection:"column" }}>
     {/* Preview header */}
     <div style={{ background:"#FFFFFF",padding:"12px 18px",borderBottom:"1px solid #E6ECF5",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
      <span style={{ fontWeight:700,fontSize:13,color:"#0F172A" }}>Preview — {wl.company_name}</span>
      <button onClick={onClose} style={{ background:"none",border:"none",color:"#64748B",cursor:"pointer",padding:4 }}><Icon name="close"/></button>
     </div>
     {/* Mock CRM shell */}
     <div style={{ display:"flex",flex:1,overflow:"hidden",background:wl.bg_color||"#F6F8FC" }}>
      {/* Mock sidebar */}
      <div style={{ width:200,background:"#FFFFFF",borderRight:"1px solid #E6ECF5",display:"flex",flexDirection:"column",flexShrink:0 }}>
       <div style={{ padding:"16px 14px 12px",borderBottom:"1px solid #E6ECF5" }}>
        <div style={{ display:"flex",alignItems:"center",gap:9 }}>
         {wl.logo_url
          ? <img src={wl.logo_url} alt="logo" style={{ width:34,height:34,borderRadius:8,objectFit:"cover" }}/>
          : <div style={{ width:34,height:34,background:`linear-gradient(135deg,${wl.primary_color},${wl.accent_color})`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff" }}>{(wl.company_name||"?")[0]}</div>
         }
         <div>
          <div style={{ fontSize:12,fontWeight:700,color:wl.text_color||"#0F172A",letterSpacing:.2 }}>{wl.company_name||"Company"}</div>
          <div style={{ fontSize:9,color:wl.primary_color,letterSpacing:1.1,fontWeight:600,textTransform:"uppercase" }}>{wl.tagline||"CRM"}</div>
         </div>
        </div>
       </div>
       <nav style={{ flex:1,padding:"8px 6px" }}>
        {[{ label:"Dashboard",active:true },...NAV_PREVIEW].slice(0,8).map((n,i) => (
         <div key={i} style={{ padding:"8px 10px",borderRadius:7,marginBottom:2,background:n.active?wl.primary_color+"18":"transparent",color:n.active?wl.primary_color:wl.text_color+"99",fontSize:12,fontWeight:n.active?600:400,borderLeft:n.active?`2px solid ${wl.primary_color}`:"2px solid transparent",display:"flex",alignItems:"center",gap:7 }}>
          <div style={{ width:6,height:6,borderRadius:3,background:n.active?wl.primary_color:"#D5E1EE" }}/>{n.label||n}
         </div>
        ))}
       </nav>
       {wl.powered_by && <div style={{ padding:"8px 12px",borderTop:"1px solid #E6ECF5",fontSize:9,color:"#94A3B8",textAlign:"center" }}>Powered by Safarnaama CRM</div>}
      </div>
      {/* Mock content */}
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
       <div style={{ height:46,background:"#FFFFFF",borderBottom:"1px solid #E6ECF5",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 18px" }}>
        <span style={{ fontSize:13,fontWeight:600,color:wl.text_color||"#0F172A" }}>Dashboard</span>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
         <div style={{ background:`linear-gradient(135deg,${wl.primary_color},${wl.accent_color})`,color:"#fff",fontSize:11,padding:"5px 12px",borderRadius:7,fontWeight:600 }}>+ New Lead</div>
        </div>
       </div>
       <div style={{ padding:16,overflow:"auto" }}>
        {/* Mock stat cards */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12 }}>
         {["Total Leads","Active Quotes","Invoices","Vouchers"].map((lbl,i)=>(
          <div key={lbl} style={{ background:"#FFFFFF",border:"1px solid #E6ECF5",borderRadius:10,padding:"12px 14px" }}>
           <div style={{ fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.8,marginBottom:6 }}>{lbl}</div>
           <div style={{ fontSize:22,fontWeight:700,color:wl.primary_color }}>{[24,8,15,12][i]}</div>
          </div>
         ))}
        </div>
        <div style={{ background:"#FFFFFF",border:"1px solid #E6ECF5",borderRadius:10,padding:14 }}>
         <div style={{ fontWeight:700,color:wl.text_color||"#0F172A",marginBottom:10,fontSize:13 }}>Recent Leads</div>
         {["Rajesh Sharma — Maldives","Neha Gupta — Bali","Amit Verma — Switzerland"].map((l,i)=>(
          <div key={i} style={{ display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #EEF3F9",fontSize:12,color:"#334155" }}>
           <span>{l}</span>
           <span style={{ color:wl.accent_color,fontWeight:600,fontSize:11 }}>New</span>
          </div>
         ))}
        </div>
       </div>
      </div>
     </div>
    </div>
   </div>
  );
 };

 // ── LIST VIEW ────────────────────────────────────────────────────────────────
 if (view === "list") return (
  <div>
   <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
    <div>
     <div style={{ fontSize:15,fontWeight:700,color:"#0F172A",fontFamily:"'Playfair Display',serif" }}>White Label Portals</div>
     <div style={{ fontSize:12,color:"#64748B",marginTop:2 }}>Create branded CRM instances for other travel agencies</div>
    </div>
    {isAdmin && <Btn icon="plus" onClick={()=>{ setForm({...DEFAULT_WL_FORM}); setLogoPreview(""); setEditId(null); setView("create"); }}>New White Label Portal</Btn>}
   </div>

   {whiteLabels.length === 0 && (
    <div style={{ textAlign:"center",padding:"60px 20px",background:"#FFFFFF",border:"1px dashed #D5E1EE",borderRadius:16 }}>
     <div style={{ width:56,height:56,background:"linear-gradient(135deg,#1A6B8A22,#4FC3F722)",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px" }}><Icon name="globe" size={26}/></div>
     <div style={{ fontWeight:700,color:"#0F172A",fontSize:15,marginBottom:6 }}>No White Label Portals Yet</div>
     <div style={{ fontSize:13,color:"#64748B",marginBottom:18 }}>Create a branded CRM for another travel agency in minutes</div>
     {isAdmin && <Btn icon="plus" onClick={()=>setView("create")}>Create First Portal</Btn>}
    </div>
   )}

   <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:16 }}>
    {whiteLabels.map(wl => (
     <div key={wl.id} className="card" style={{ background:"#FFFFFF",border:"1px solid #E6ECF5",borderRadius:14,overflow:"hidden",transition:"border .15s" }}>
      {/* Color band */}
      <div style={{ height:6,background:`linear-gradient(90deg,${wl.primary_color},${wl.accent_color})` }}/>
      <div style={{ padding:"14px 16px" }}>
       <div style={{ display:"flex",alignItems:"center",gap:11,marginBottom:10 }}>
        {wl.logo_url
         ? <img src={wl.logo_url} alt="" style={{ width:42,height:42,borderRadius:9,objectFit:"cover",border:"1px solid #E6ECF5" }}/>
         : <div style={{ width:42,height:42,background:`linear-gradient(135deg,${wl.primary_color},${wl.accent_color})`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:700,color:"#fff",flexShrink:0 }}>{(wl.company_name||"?")[0]}</div>
        }
        <div style={{ flex:1,minWidth:0 }}>
         <div style={{ fontWeight:700,color:"#0F172A",fontSize:14,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{wl.company_name}</div>
         <div style={{ fontSize:11,color:"#64748B",marginTop:1 }}>{wl.contact_email}</div>
        </div>
        <Badge status={wl.status||"Active"}/>
       </div>
       {wl.tagline && <div style={{ fontSize:12,color:"#475569",marginBottom:8,fontStyle:"italic" }}>"{wl.tagline}"</div>}
       <div style={{ display:"flex",flexWrap:"wrap",gap:5,marginBottom:12 }}>
        {(wl.modules||[]).map(m => {
         const mod = WL_MODULES.find(x=>x.id===m);
         return <span key={m} style={{ fontSize:10,background:"#F2F6FB",color:"#475569",border:"1px solid #E6ECF5",borderRadius:5,padding:"2px 7px",fontWeight:600 }}>{mod?.label||m}</span>;
        })}
       </div>
       <div style={{ display:"flex",gap:7,flexWrap:"wrap" }}>
        <Btn v="primary" s={{ fontSize:11,padding:"4px 10px",background:`linear-gradient(135deg,${wl.primary_color},${wl.accent_color})` }} icon="globe" onClick={()=>window.open(portalURL(wl.id),"_blank")}>Launch Portal</Btn>
        <Btn v="secondary" s={{ fontSize:11,padding:"4px 10px" }} icon="copy" onClick={()=>{ navigator.clipboard?.writeText(portalURL(wl.id)).then(()=>toast$("Portal URL copied!")).catch(()=>toast$("Copy failed",true)); }}>Copy URL</Btn>
        <Btn v="secondary" s={{ fontSize:11,padding:"4px 10px" }} icon="search" onClick={()=>{ setPreviewPortal(wl); }}>Preview</Btn>
        <Btn v="secondary" s={{ fontSize:11,padding:"4px 10px" }} icon="download" onClick={()=>downloadConfig(wl)}>Download Config</Btn>
        <Btn v="secondary" s={{ fontSize:11,padding:"4px 10px" }} icon="copy" onClick={()=>copyEmbed(wl)}>Embed Snippet</Btn>
        {isAdmin && <Btn v="ghost" s={{ fontSize:11,padding:"4px 10px" }} icon="edit" onClick={()=>editPortal(wl)}>Edit</Btn>}
        {isAdmin && <Btn v="danger" s={{ fontSize:11,padding:"4px 10px" }} onClick={()=>deletePortal(wl.id)}>Delete</Btn>}
       </div>
      </div>
      <div style={{ background:"#F6F8FC",padding:"7px 16px",borderTop:"1px solid #E6ECF5",display:"flex",gap:14,alignItems:"center" }}>
       {[["Primary",wl.primary_color],[wl.accent_color?"Accent":null,wl.accent_color]].filter(x=>x[0]).map(([lbl,c])=>(
        <div key={lbl} style={{ display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#64748B" }}>
         <div style={{ width:12,height:12,background:c,borderRadius:3 }}/>{lbl}: {c}
        </div>
       ))}
       {wl.powered_by && <span style={{ fontSize:10,color:"#94A3B8",marginLeft:"auto" }}>Powered by Safarnaama</span>}
      </div>
      {/* Portal URL row */}
      <div style={{ background:"#FFFFFF",padding:"6px 16px",borderTop:"1px solid #E6ECF5",display:"flex",alignItems:"center",gap:8 }}>
       <Icon name="globe" size={12}/>
       <span style={{ fontSize:10,color:"#64748B",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{portalURL(wl.id)}</span>
       <button onClick={()=>{ navigator.clipboard?.writeText(portalURL(wl.id)).then(()=>toast$("URL copied!")).catch(()=>toast$("Copy failed",true)); }} style={{ background:"none",border:"none",color:"#4FC3F7",fontSize:10,cursor:"pointer",fontWeight:600,flexShrink:0 }}>Copy</button>
      </div>
     </div>
    ))}
   </div>

   {previewPortal && <PreviewModal wl={previewPortal} onClose={()=>setPreviewPortal(null)}/>}
  </div>
 );

 // ── CREATE / EDIT VIEW ───────────────────────────────────────────────────────
 return (
  <div style={{ maxWidth:820 }}>
   <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:20 }}>
    <Btn v="ghost" s={{ padding:"5px 8px" }} icon="close" onClick={()=>{ setView("list"); setEditId(null); }}>Back</Btn>
    <div>
     <div style={{ fontSize:15,fontWeight:700,color:"#0F172A",fontFamily:"'Playfair Display',serif" }}>{editId ? "Edit Portal" : "Create White Label Portal"}</div>
     <div style={{ fontSize:12,color:"#64748B",marginTop:1 }}>Configure branding & modules for {form.company_name||"the new agency"}</div>
    </div>
   </div>

   {/* Live mini-preview strip */}
   <div style={{ background:`linear-gradient(135deg,${form.primary_color},${form.accent_color})`,borderRadius:10,padding:"12px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:12,color:"#fff" }}>
    {logoPreview
     ? <img src={logoPreview} alt="" style={{ width:38,height:38,borderRadius:8,objectFit:"cover",background:"#fff" }}/>
     : <div style={{ width:38,height:38,background:"rgba(255,255,255,.2)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700 }}>{(form.company_name||"?")[0]||"?"}</div>
    }
    <div>
     <div style={{ fontWeight:700,fontSize:14 }}>{form.company_name||"Company Name"}</div>
     <div style={{ fontSize:10,opacity:.8,letterSpacing:1,textTransform:"uppercase" }}>{form.tagline||"Your Tagline Here"}</div>
    </div>
    <div style={{ marginLeft:"auto",fontSize:11,opacity:.7 }}>Live Preview</div>
   </div>

   <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14 }}>
    <F label="Company Name" req><Inp value={form.company_name} onChange={e=>setF("company_name",e.target.value)} placeholder="e.g. Horizon Travel Agency"/></F>
    <F label="Tagline"><Inp value={form.tagline} onChange={e=>setF("tagline",e.target.value)} placeholder="e.g. YOUR TRAVEL PARTNER"/></F>
    <F label="Contact Email" req><Inp type="email" value={form.contact_email} onChange={e=>setF("contact_email",e.target.value)} placeholder="info@horizontravel.com"/></F>
    <F label="Contact Phone"><Inp value={form.contact_phone} onChange={e=>setF("contact_phone",e.target.value)} placeholder="+91 9999999999"/></F>
    <F label="Website"><Inp value={form.website} onChange={e=>setF("website",e.target.value)} placeholder="https://horizontravel.com"/></F>
    <F label="Status">
     <Sel value={form.status} onChange={e=>setF("status",e.target.value)}>
      <option>Active</option><option>Draft</option><option>Inactive</option>
     </Sel>
    </F>
   </div>

   <F label="Address"><Inp value={form.address} onChange={e=>setF("address",e.target.value)} placeholder="123 Travel Street, Mumbai, India"/></F>

   {/* Logo */}
   <F label="Logo">
    <div style={{ display:"flex",alignItems:"center",gap:12 }}>
     {logoPreview
      ? <img src={logoPreview} alt="logo" style={{ width:54,height:54,borderRadius:10,objectFit:"cover",border:"1px solid #D5E1EE" }}/>
      : <div style={{ width:54,height:54,background:"#F6F8FC",border:"1px dashed #D5E1EE",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",color:"#94A3B8",fontSize:10 }}>No Logo</div>
     }
     <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
      <label style={{ background:"#F2F6FB",border:"1px solid #D5E1EE",borderRadius:7,padding:"6px 13px",fontSize:12,fontWeight:600,color:"#475569",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6 }}>
       <Icon name="upload" size={13}/> Upload Logo
       <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display:"none" }}/>
      </label>
      <Inp value={form.logo_url?.startsWith("data:") ? "" : form.logo_url} onChange={e=>{setF("logo_url",e.target.value);setLogoPreview(e.target.value);}} placeholder="…or paste image URL" style={{ fontSize:11 }}/>
     </div>
    </div>
   </F>

   {/* Colors */}
   <div style={{ background:"#FFFFFF",border:"1px solid #E6ECF5",borderRadius:10,padding:16,marginBottom:14 }}>
    <div style={{ fontWeight:700,color:"#0F172A",fontSize:12,marginBottom:12,display:"flex",alignItems:"center",gap:6 }}><Icon name="palette" size={14}/>Brand Colors</div>
    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12 }}>
     {[["primary_color","Primary"],["accent_color","Accent"],["bg_color","Background"],["text_color","Text"]].map(([k,lbl])=>(
      <div key={k}>
       <label style={{ display:"block",fontSize:10,color:"#64748B",fontWeight:700,textTransform:"uppercase",letterSpacing:.8,marginBottom:5 }}>{lbl}</label>
       <div style={{ display:"flex",alignItems:"center",gap:7 }}>
        <input type="color" value={form[k]||"#000000"} onChange={e=>setF(k,e.target.value)} style={{ width:34,height:34,padding:0,border:"1px solid #D5E1EE",borderRadius:6,cursor:"pointer",background:"none" }}/>
        <Inp value={form[k]||""} onChange={e=>setF(k,e.target.value)} style={{ fontSize:11,padding:"5px 8px" }}/>
       </div>
      </div>
     ))}
    </div>
   </div>

   {/* Modules */}
   <div style={{ background:"#FFFFFF",border:"1px solid #E6ECF5",borderRadius:10,padding:16,marginBottom:14 }}>
    <div style={{ fontWeight:700,color:"#0F172A",fontSize:12,marginBottom:12,display:"flex",alignItems:"center",gap:6 }}><Icon name="tasks" size={14}/>Enabled Modules</div>
    <div style={{ display:"flex",flexWrap:"wrap",gap:9 }}>
     {WL_MODULES.map(m => {
      const on = form.modules.includes(m.id);
      return (
       <label key={m.id} style={{ display:"flex",alignItems:"center",gap:7,background:on?"#1A6B8A18":"#F6F8FC",border:`1px solid ${on?"#1A6B8A":"#E6ECF5"}`,borderRadius:8,padding:"7px 13px",cursor:"pointer",fontSize:12,fontWeight:600,color:on?"#1A6B8A":"#64748B",userSelect:"none",transition:"all .15s" }}>
        <input type="checkbox" checked={on} onChange={()=>toggleModule(m.id)} style={{ display:"none" }}/>
        {on && <Icon name="check" size={12}/>}{m.label}
       </label>
      );
     })}
    </div>
   </div>

   {/* Options */}
   <div style={{ background:"#FFFFFF",border:"1px solid #E6ECF5",borderRadius:10,padding:16,marginBottom:14 }}>
    <label style={{ display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none" }}>
     <div onClick={()=>setF("powered_by",!form.powered_by)} style={{ width:40,height:22,background:form.powered_by?"#1A6B8A":"#D5E1EE",borderRadius:11,position:"relative",transition:"background .2s",flexShrink:0 }}>
      <div style={{ position:"absolute",top:3,left:form.powered_by?20:3,width:16,height:16,background:"#fff",borderRadius:8,transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.2)" }}/>
     </div>
     <div>
      <div style={{ fontSize:13,fontWeight:600,color:"#0F172A" }}>Show "Powered by Safarnaama CRM"</div>
      <div style={{ fontSize:11,color:"#64748B" }}>Display attribution in the portal sidebar footer</div>
     </div>
    </label>
   </div>

   <F label="Internal Notes"><TA value={form.notes} onChange={e=>setF("notes",e.target.value)} placeholder="Notes about this client portal setup…" style={{ minHeight:60 }}/></F>

   {/* Admin Setup */}
   <div style={{ background:"#FFFFFF",border:`2px solid ${editId?"#E6ECF5":"#1A6B8A44"}`,borderRadius:10,padding:16,marginBottom:14 }}>
    <div style={{ fontWeight:700,color:"#0F172A",fontSize:12,marginBottom:4,display:"flex",alignItems:"center",gap:6 }}>
     <Icon name="users" size={14}/>Portal Admin Account
     {!editId && <span style={{ fontSize:10,background:"#1A6B8A18",color:"#1A6B8A",border:"1px solid #1A6B8A44",borderRadius:4,padding:"1px 7px",fontWeight:600 }}>Required for new portal</span>}
    </div>
    <div style={{ fontSize:11,color:"#64748B",marginBottom:12 }}>
     This person will be the first Admin user of the white-label portal. They can log in and add more users/roles from inside the portal.
    </div>
    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:11 }}>
     <F label="Admin Name" req><Inp value={form.admin_name} onChange={e=>setF("admin_name",e.target.value)} placeholder="e.g. Rahul Mehra"/></F>
     <F label="Admin Email" req><Inp type="email" value={form.admin_email} onChange={e=>setF("admin_email",e.target.value)} placeholder="admin@clientcompany.com"/></F>
    </div>
    {editId && <div style={{ fontSize:11,color:"#94A3B8",marginTop:4 }}>Updating admin details here does not change the user inside the live portal — edit users from within the portal.</div>}
    {!editId && (
     <div style={{ background:"#F6F8FC",border:"1px solid #E6ECF5",borderRadius:7,padding:"9px 12px",marginTop:6 }}>
      <div style={{ fontSize:11,color:"#475569",fontWeight:600,marginBottom:3 }}>What gets created automatically:</div>
      <div style={{ fontSize:11,color:"#64748B",lineHeight:1.8 }}>
       ✓ 3 default roles: <b>Admin</b> (full access), <b>Manager</b> (leads+quotes+tasks), <b>User</b> (assigned work only)<br/>
       ✓ 1 Admin user with the email above<br/>
       ✓ Isolated data namespace — completely separate from Safarnaama's data
      </div>
     </div>
    )}
   </div>

   <div style={{ display:"flex",justifyContent:"flex-end",gap:10,marginTop:16 }}>
    <Btn v="secondary" onClick={()=>{ setView("list"); setEditId(null); }}>Cancel</Btn>
    <Btn v="success" icon="check" onClick={savePortal}>{editId ? "Update Portal" : "Create Portal"}</Btn>
   </div>
  </div>
 );
}
// ─── PAGE: SETTINGS ───────────────────────────────────────────────────────────
function PageSettings({ markup, toast$ }) {
 const [local, setLocal] = useState({...markup});
 return (
 <div style={{ maxWidth:660 }}>
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:22, marginBottom:18 }}>
 <div style={{ fontWeight:700, color:"#0F172A", marginBottom:18, fontSize:15 }}>Markup Configuration</div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
 {[["star3","3★ Hotel Markup (%)"],["star4","4★ Hotel Markup (%)"],["transport","Transport Markup (%)"],["activities","Activities Markup (%)"]].map(([k,lbl])=>(
 <F key={k} label={lbl}><Inp type="number" value={local[k]} min={0} max={100} onChange={e=>setLocal(p=>({...p,[k]:Number(e.target.value)}))} /></F>
 ))}
 </div>
 <Btn v="success" icon="check" onClick={()=>{ localStorage.setItem("sfn_markup",JSON.stringify(local)); toast$("Markup saved!"); }}>Save Markup</Btn>
 </div>
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:22 }}>
 <div style={{ fontWeight:700, color:"#0F172A", marginBottom:14, fontSize:15 }}>What Works Right Now vs After Deployment</div>
 {[
 [" AI Itinerary Builder","Full page — hotels, flights, maps, images"],
 [" AI Quote Email Drafting","Works now — Claude API"],
 [" AI Invoice Generation","Works now — Claude API"],
 [" AI Voucher Generation","Works now — Claude API"],
 [" AI Chat + Lead Creation","Works now — Claude API"],
 [" Upload Vendor Quote Doc","Works now — Claude API"],
 [" All data saved locally","Works now — Browser storage"],
 [" Actually send emails","Needs SendGrid + Backend"],
 [" Cloud database","Needs Supabase + Backend"],
 [" Auto vendor reply processing","Needs Backend webhook"],
 [" Multi-user access","Needs Backend + Auth"],
 ].map(([f,s])=>(
 <div key={f} style={{ display:"flex", justifyContent:"space-between", padding:"9px 0", borderBottom:"1px solid #EEF3F9", fontSize:13 }}>
 <span style={{ color:"#334155" }}>{f}</span>
 <span style={{ color: s.startsWith("Full")||s.startsWith("Works")?"#81C784":"#FFB74D", fontSize:12 }}>{s}</span>
 </div>
 ))}
 </div>
 </div>
 );
}

// ─── PAGE: ITINERARY BUILDER ─────────────────────────────────────────────────
const ACT_TYPES = {
 flight:      { color:"#4FC3F7", bg:"#E3F6FC", label:"Flight",       icon:"flight" },
 transfer:    { color:"#90A4AE", bg:"#ECEFF1", label:"Transfer",      icon:"route" },
 sightseeing: { color:"#81C784", bg:"#E8F5E9", label:"Sightseeing",   icon:"place" },
 adventure:   { color:"#CE93D8", bg:"#F3E5F5", label:"Adventure",     icon:"adventure" },
 meal:        { color:"#EF9A9A", bg:"#FFEBEE", label:"Meal",          icon:"meal" },
 leisure:     { color:"#80CBC4", bg:"#E0F2F1", label:"Leisure",       icon:"leisure" },
 hotel:       { color:"#FFB74D", bg:"#FFF3E0", label:"Hotel",         icon:"hotel_star" },
 shopping:    { color:"#F48FB1", bg:"#FCE4EC", label:"Shopping",      icon:"shopping" },
 other:       { color:"#B0BEC5", bg:"#ECEFF1", label:"Other",         icon:"itinerary" },
};

// Pollinations image API — free, no API key, strong CORS support for PDF capture
// seed keeps image stable for same query/signature
const unsplashUrl = (query, w=800, h=360, sig=1) => {
 const kw = encodeURIComponent((query||"travel").replace(/[^a-zA-Z0-9 ,]/g," ").trim().replace(/ +/g," "));
 return `https://image.pollinations.ai/prompt/${kw}?width=${w}&height=${h}&seed=${sig}&nologo=true&model=flux`;
};

const EMPTY_ITIN = {
 id:"", lead_id:"", lead_name:"", title:"", destination:"", start_date:"", end_date:"",
 pax:2, kids:0, notes:"", status:"Draft", highlights:[],
 flights:[], hotels:[], days:[],
};

const hotelsFrom = h => Array.isArray(h) ? h : (h && typeof h === "object" ? Object.values(h).flat() : []);

function PageItinerary({ leads, itineraries, setItineraries, initData, setInitData, toast$, onRequestQuote, brand = {} }) {
 const co = {
  name:    brand.companyName  || "Safarnaama",
  tagline: brand.tagline      || "HOLIDAYS CRM",
  logo:    brand.logoUrl      || "",
  color:   brand.primaryColor || "#1A6B8A",
  email:   brand.contactEmail || "enquiry@safarnaama.com",
 };
 const [view, setView] = useState("list"); // "list" | "edit"
 const [itin, setItin] = useState(EMPTY_ITIN);
 const [tab, setTab] = useState("days"); // "overview"|"days"|"flights"|"hotels"|"map"
 const [aiLoading, setAiLoading] = useState(false);
 const [imgErrors, setImgErrors] = useState({});
 const [expandedGroups, setExpandedGroups] = useState({});
 const [saveMode, setSaveMode] = useState("update");
 useEffect(() => { setSaveMode("update"); }, [itin.id]);
 const linkedLead = leads.find(l => l.id === itin.lead_id) || (itin.lead_id ? {
  id: itin.lead_id,
  name: itin.lead_name || "",
  destination: itin.destination || "",
  travel_date: itin.start_date || "",
  end_date: itin.end_date || "",
  pax: itin.pax || 2,
  kids: itin.kids || 0,
  budget: "",
  notes: itin.notes || "",
 } : null);

 // Open create form seeded from a lead (triggered from Leads page)
 useEffect(() => {
  if (initData) {
   if (initData.id && (initData.days || initData.hotels || initData.flights)) {
    setItin({
     ...EMPTY_ITIN,
     ...initData,
     flights: Array.isArray(initData.flights) ? initData.flights : [],
     hotels: hotelsFrom(initData.hotels),
     days: Array.isArray(initData.days) ? initData.days : [],
    });
   } else {
    const numDays = (() => {
     if (!initData.start_date) return 5;
     const end = initData.end_date || initData.start_date;
     const diff = Math.round((new Date(end) - new Date(initData.start_date)) / 86400000);
     return Math.max(diff, 1) || 5;
    })();
    setItin({
     ...EMPTY_ITIN,
     ...initData,
     id: `ITN${Date.now().toString().slice(-6)}`,
     title: `${initData.destination || "Trip"} — ${numDays}N/${numDays+1}D`,
     flights: Array.isArray(initData.flights) ? initData.flights : [],
     hotels: hotelsFrom(initData.hotels),
     days: Array.isArray(initData.days) ? initData.days : [],
    });
   }
   setView("edit");
   setTab("days");
   setInitData(null);
  }
 }, [initData]); // eslint-disable-line react-hooks/exhaustive-deps

 const upd = (field, val) => setItin(p => ({ ...p, [field]: val }));

 // ── DERIVED ────────────────────────────────────────────────────────────────
 const numDays = (() => {
  if (!itin.start_date || !itin.end_date) return (itin.days||[]).length || 5;
  const diff = Math.round((new Date(itin.end_date) - new Date(itin.start_date)) / 86400000);
  return Math.max(diff, 1);
 })();

 const addDay = () => {
  const dayNum = (itin.days||[]).length + 1;
  const dateObj = itin.start_date ? new Date(new Date(itin.start_date).getTime() + (dayNum-1)*86400000) : null;
  const dateStr = dateObj ? dateObj.toISOString().split("T")[0] : "";
  setItin(p => ({
   ...p,
   days: [...(p.days||[]), {
    day: dayNum, date: dateStr,
    title: `Day ${dayNum}`, location: p.destination,
    hotel: "", image_query: p.destination,
    activities: [],
   }],
  }));
 };

 const removeDay = idx => setItin(p => ({
  ...p,
  days: p.days.filter((_,i) => i !== idx).map((d,i) => ({ ...d, day: i+1 })),
 }));

 const updDay = (idx, field, val) => setItin(p => ({
  ...p,
  days: p.days.map((d,i) => i===idx ? { ...d, [field]: val } : d),
 }));

 const addActivity = (dayIdx) => {
  const act = { id:`A${Date.now().toString().slice(-5)}`, time:"09:00", type:"sightseeing", title:"", desc:"", cost:0 };
  setItin(p => ({
   ...p,
   days: p.days.map((d,i) => i===dayIdx ? { ...d, activities: [...(d.activities||[]), act] } : d),
  }));
 };

 const updActivity = (dayIdx, actIdx, field, val) => setItin(p => ({
  ...p,
  days: p.days.map((d,i) => i!==dayIdx ? d : {
   ...d,
   activities: d.activities.map((a,ai) => ai!==actIdx ? a : { ...a, [field]: val }),
  }),
 }));

 const removeActivity = (dayIdx, actIdx) => setItin(p => ({
  ...p,
  days: p.days.map((d,i) => i!==dayIdx ? d : {
   ...d, activities: d.activities.filter((_,ai) => ai!==actIdx),
  }),
 }));

 // ── FLIGHTS ────────────────────────────────────────────────────────────────
 const addFlight = () => setItin(p => ({
  ...p,
  flights: [...(p.flights||[]), { id:`F${Date.now().toString().slice(-4)}`, from:"", to:"", date:p.start_date||"", airline:"", flight_no:"", departure:"", arrival:"", class:"Economy", cost:0 }],
 }));
 const updFlight = (idx, field, val) => setItin(p => ({
  ...p, flights: p.flights.map((f,i) => i===idx ? { ...f, [field]: val } : f),
 }));
 const removeFlight = idx => setItin(p => ({ ...p, flights: p.flights.filter((_,i) => i!==idx) }));

 // ── HOTELS ─────────────────────────────────────────────────────────────────
 const addHotel = () => setItin(p => ({
  ...p,
  hotels: [...(p.hotels||[]), { id:`H${Date.now().toString().slice(-4)}`, name:"", destination:p.destination||"", check_in:p.start_date||"", check_out:p.end_date||"", room_type:"", meals:"Breakfast", rating:4, cost_per_night:0, nights:numDays }],
 }));
 const updHotel = (idx, field, val) => setItin(p => ({
  ...p, hotels: p.hotels.map((h,i) => i===idx ? { ...h, [field]: val } : h),
 }));
 const removeHotel = idx => setItin(p => ({ ...p, hotels: p.hotels.filter((_,i) => i!==idx) }));

 // ── SAVE ───────────────────────────────────────────────────────────────────
 const saveItin = () => {
  if (!itin.destination.trim()) return toast$("Destination is required", true);
  if (!itin.days.length) return toast$("Add at least one day", true);
  const cleanItin = (({ displayVersion, numericVersion, createdAtMs, ...rest }) => rest)(itin);
  const normalizedItin = {
   ...cleanItin,
   hotels: hotelsFrom(cleanItin.hotels),
   flights: Array.isArray(cleanItin.flights) ? cleanItin.flights : [],
   days: Array.isArray(cleanItin.days) ? cleanItin.days : [],
  };
  const isNew = !itineraries.find(x => x.id === normalizedItin.id);
  const saveAsNewVersion = saveMode === "newVersion" && !isNew && normalizedItin.lead_id;
  const latestVersion = saveAsNewVersion
   ? Math.max(0, ...itineraries.filter(x => x.lead_id === normalizedItin.lead_id).map(x => Number(x.version||0)))
   : Number(normalizedItin.version||0);
  const savedItin = saveAsNewVersion
   ? { ...normalizedItin, id: `ITN${Date.now().toString().slice(-6)}`, version: latestVersion + 1, created_at: today() }
   : { ...normalizedItin, version: (normalizedItin.version || 1), created_at: normalizedItin.created_at || today() };
  setItineraries(p => saveAsNewVersion
   ? [savedItin, ...p]
   : isNew
     ? [savedItin, ...p]
     : p.map(x => x.id===cleanItin.id ? savedItin : x)
  );
  toast$(saveAsNewVersion ? "Itinerary saved as new version!" : isNew ? "Itinerary created!" : "Itinerary updated!");
  setView("list");
 };

 // ── AI GENERATE ────────────────────────────────────────────────────────────
 const aiGenerate = async () => {
  if (!itin.destination.trim()) return toast$("Enter destination first", true);
  const days = numDays || 5;
  const endDate = itin.end_date || (itin.start_date
   ? new Date(new Date(itin.start_date).getTime() + days*86400000).toISOString().split("T")[0]
   : "");
  setAiLoading(true);
  try {
   const data = await askClaudeJSON(
    `Create a detailed ${days}-day travel itinerary for the following trip and return ONLY a raw JSON object with no markdown, no code fences, no explanation text.

Trip details:
- Destination: ${itin.destination}
- Dates: ${itin.start_date || "flexible"} to ${endDate || "flexible"}
- Travelers: ${itin.pax} adult(s), ${itin.kids} child(ren)
- Preferences: ${itin.notes || "standard sightseeing"}

Required JSON structure (return exactly this shape, filled with real data):
- title: catchy trip title string
- highlights: array of 3 short highlight strings
- flights: array of 2 flight objects (outbound + return), each with id, from, to, date, airline, flight_no, departure, arrival, class, cost (number in INR)
- hotels: array of hotel objects, each with id, name, destination, check_in, check_out, room_type, meals, rating (1-5), cost_per_night (number), nights (number)
- days: array of ${days} day objects, each with day (number), date, title, location, hotel (hotel name), image_query (photo search keywords), activities (array of objects each with id, time, type, title, desc, cost)

Rules:
- Activity types must be one of: sightseeing, flight, transfer, adventure, meal, leisure, hotel, shopping, other
- All costs must be numbers in INR with realistic Indian travel prices
- Maximum 3 activities per day (keep descriptions under 10 words each)
- Keep all string values short and concise`,
    "You are a professional travel planner API. Output ONLY a single raw JSON object. No markdown fences, no backticks, no code blocks, no explanation. Just the JSON.",
    Math.min(8000, 2500 + (numDays || 5) * 600)
   );
   setItin(p => ({
    ...p,
    title: data.title || p.title,
    highlights: data.highlights || [],
    flights: (data.flights||[]).map(f => ({ ...f, cost: Number(f.cost)||0 })),
    hotels: (data.hotels||[]).map(h => ({ ...h, cost_per_night: Number(h.cost_per_night)||0, nights: Number(h.nights)||days, rating: Number(h.rating)||4 })),
    days: (data.days||[]).map(d => ({
     ...d,
     day: Number(d.day),
     activities: (d.activities||[]).map((a,ai) => ({
      ...a,
      id: a.id || `A${ai}`,
      cost: Number(a.cost)||0,
      type: ACT_TYPES[a.type] ? a.type : "sightseeing",
     })),
    })),
   }));
   setTab("days");
   toast$("AI itinerary generated! Review and customise each day.");
  } catch(e) {
   console.error("[aiGenerate] Error:", e);
   toast$("AI error: " + e.message, true);
  } finally {
   setAiLoading(false);
  }
 };

 // ── COST TOTALS ────────────────────────────────────────────────────────────
 const flightTotal = (itin.flights||[]).reduce((s,f) => s + (Number(f.cost)||0), 0);
 const hotelTotal  = (Array.isArray(itin.hotels) ? itin.hotels : []).reduce((s,h) => s + (Number(h.cost_per_night)||0)*(Number(h.nights)||1), 0);
 const actTotal    = (itin.days||[]).flatMap(d => d.activities||[]).reduce((s,a) => s + (Number(a.cost)||0), 0);
 const grandTotal  = flightTotal + hotelTotal + actTotal;

 const fmtINR = n => `₹${Number(n).toLocaleString("en-IN")}`;

 // ══════════════════════════════════════════════════════════════════════════════
 // LIST VIEW
 // ══════════════════════════════════════════════════════════════════════════════
 if (view === "list") {
  const grouped = itineraries.reduce((acc, it) => {
   const key = it.lead_id || `standalone_${it.id}`;
   const label = it.lead_name || "Standalone";
   if (!acc[key]) acc[key] = { key, label, lead_id: it.lead_id, items: [] };
   acc[key].items.push(it);
   return acc;
  }, {});
  const groups = Object.values(grouped).sort((a,b) => {
   if (a.lead_id && !b.lead_id) return -1;
   if (!a.lead_id && b.lead_id) return 1;
   return a.label.localeCompare(b.label);
  }).map(g => {
   const sorted = g.items
    .map(it => ({ ...it, numericVersion: Number(it.version||0), createdAtMs: new Date(it.created_at || 0).getTime() }))
    .sort((a,b) => (a.numericVersion || a.createdAtMs) - (b.numericVersion || b.createdAtMs));
   return {
    ...g,
    items: sorted.map((it, idx) => ({ ...it, displayVersion: it.numericVersion || idx + 1 })),
   };
  });

  return (
   <div>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
     <div>
      <div style={{ fontSize:20, fontWeight:700, color:"#0F172A", fontFamily:"'Playfair Display',serif" }}>Itinerary Builder</div>
      <div style={{ fontSize:12, color:"#64748B", marginTop:2 }}>Create detailed day-by-day travel plans with hotels, flights, images & maps</div>
     </div>
     <Btn v="primary" icon="itinerary" onClick={() => { setItin({ ...EMPTY_ITIN, id:`ITN${Date.now().toString().slice(-6)}` }); setView("edit"); setTab("overview"); }}>
      + New Itinerary
     </Btn>
    </div>

    {itineraries.length === 0 && (
     <div style={{ background:"#FFFFFF", border:"2px dashed #D5E1EE", borderRadius:16, padding:60, textAlign:"center" }}>
      <Icon name="itinerary" size={40}/>
      <div style={{ fontSize:16, fontWeight:600, color:"#334155", marginTop:12, marginBottom:6 }}>No itineraries yet</div>
      <div style={{ fontSize:13, color:"#64748B", marginBottom:18 }}>Create your first day-by-day travel plan with AI assistance</div>
      <Btn v="primary" icon="itinerary" onClick={() => { setItin({ ...EMPTY_ITIN, id:`ITN${Date.now().toString().slice(-6)}` }); setView("edit"); setTab("overview"); }}>
       Create Itinerary
      </Btn>
     </div>
    )}

    {itineraries.length > 0 && (
     <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {groups.map(group => {
       const expanded = expandedGroups[group.key] !== false;
       return (
        <div key={group.key} style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:14, overflow:"hidden" }}>
         <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:16, cursor:"pointer", background:"#F8FAFC" }} onClick={() => setExpandedGroups(p => ({ ...p, [group.key]: !expanded }))}>
          <div>
           <div style={{ fontSize:15, fontWeight:700, color:"#0F172A" }}>{group.label}{group.lead_id ? ` (${group.items.length} version${group.items.length>1?"s":""})` : ""}</div>
           <div style={{ fontSize:12, color:"#64748B", marginTop:4 }}>{group.lead_id ? `${group.items[0].destination || ""}` : "No lead linked"}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
           <div style={{ fontSize:12, color:"#475569" }}>{expanded ? "Collapse" : "Expand"}</div>
           <Icon name={expanded ? "chevron_up" : "chevron_down"} size={16}/>
          </div>
         </div>
         {expanded && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))", gap:16, padding:16 }}>
           {group.items.map(it => (
            <div key={it.id} style={{ background:"#FDFDFD", border:"1px solid #E6ECF5", borderRadius:14, padding:14, display:"flex", flexDirection:"column", gap:10 }}>
             <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"flex-start" }}>
              <div>
               <div style={{ fontSize:13, fontWeight:700, color:"#0F172A" }}>{it.title || "Untitled Itinerary"}</div>
               <div style={{ fontSize:11, color:"#64748B", marginTop:5 }}>{it.destination || "Destination not set"}</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
               <span style={{ fontSize:11, color:"#334155", fontWeight:700, background:"#E3F6FC", padding:"4px 8px", borderRadius:999 }}>{`Version ${it.displayVersion || it.version || 1}`}</span>
               <Badge status={it.status || "Draft"}/>
              </div>
             </div>
             <div style={{ fontSize:11, color:"#64748B", display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:8 }}>
              <div>Dates: {it.start_date || "N/A"}{it.end_date ? ` → ${it.end_date}` : ""}</div>
              <div>Days: {it.days?.length || 0} · Hotels: {Array.isArray(it.hotels)?it.hotels.length:0}</div>
             </div>
             <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <Btn v="primary" s={{ flex:1 }} icon="edit" onClick={() => {
               const { displayVersion, numericVersion, createdAtMs, ...cleanIt } = it;
               setItin({
                ...cleanIt,
                hotels: hotelsFrom(cleanIt.hotels),
                flights: Array.isArray(cleanIt.flights) ? cleanIt.flights : [],
                days: Array.isArray(cleanIt.days) ? cleanIt.days : [],
               });
               setView("edit");
               setTab("days");
              }}>
               Edit
              </Btn>
              <Btn v="ghost" s={{ flex:1, minWidth:120 }} icon="close" onClick={() => {
               if (window.confirm("Delete this itinerary version?")) {
                setItineraries(p => p.filter(x => x.id !== it.id));
                toast$("Itinerary deleted");
               }
              }}>
               Delete
              </Btn>
             </div>
            </div>
           ))}
          </div>
         )}
        </div>
       );
      })}
     </div>
    )}
   </div>
  );
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // EDIT VIEW
 // ══════════════════════════════════════════════════════════════════════════════
 const TABS = ["overview","days","flights","hotels","map"];
 const TAB_LABELS = { overview:"Overview", days:"Days", flights:"Flights", hotels:"Hotels", map:"Map & Preview" };

 return (
  <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 96px)" }}>
   {/* Header */}
   <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
    <Btn v="ghost" icon="close" onClick={() => setView("list")} s={{ paddingLeft:0 }}>Back</Btn>
    <div style={{ flex:1 }}>
     <input
      value={itin.title}
      onChange={e => upd("title", e.target.value)}
      placeholder="Itinerary title (e.g. Maldives Honeymoon — 7N/8D)"
      style={{ background:"transparent", border:"none", outline:"none", fontSize:17, fontWeight:700, color:"#0F172A", width:"100%", fontFamily:"'Playfair Display',serif" }}
     />
    </div>
    <select value={itin.status} onChange={e=>upd("status",e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:7, padding:"6px 10px", fontSize:12, color:"#334155" }}>
     {["Draft","Confirmed","Sent","Archived"].map(s => <option key={s}>{s}</option>)}
    </select>
    <Btn v="secondary" icon="itinerary" onClick={aiGenerate} spin={aiLoading} disabled={aiLoading}>
     {aiLoading ? "AI Generating…" : "AI Generate"}
    </Btn>
    {linkedLead && onRequestQuote && (
     <Btn v="primary" icon="send" onClick={() => onRequestQuote({ lead: linkedLead, itinerary: itin })}>
      Request Quote
     </Btn>
    )}
    {itin.lead_id && itineraries.some(x => x.id === itin.id) && (
     <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
      <span style={{ fontSize:12, color:"#475569" }}>Save as:</span>
      <Btn v={saveMode === "update" ? "primary" : "ghost"} s={{ fontSize:11, padding:"5px 10px" }} onClick={() => setSaveMode("update")}>
       Update this version
      </Btn>
      <Btn v={saveMode === "newVersion" ? "primary" : "ghost"} s={{ fontSize:11, padding:"5px 10px" }} onClick={() => setSaveMode("newVersion")}>
       Create new version
      </Btn>
     </div>
    )}
    <Btn v="ghost" icon="mapview" onClick={() => {
     // Build clean PDF HTML — CORS-safe images + reliable download fallback for Edge
     const imgUrl = (query, w, h, lock) => {
      const kw = encodeURIComponent((query||"travel").replace(/[^a-zA-Z0-9 ,]/g," ").trim().replace(/ +/g," "));
      return `https://image.pollinations.ai/prompt/${kw}?width=${w}&height=${h}&seed=${lock}&nologo=true&model=flux`;
     };
     const fallbackImg = (query, w, h, lock) => {
      const q = encodeURIComponent((query || "travel").replace(/[^a-zA-Z0-9 ,]/g," ").trim().replace(/ +/g," "));
      return `https://image.pollinations.ai/prompt/${q}?width=${w}&height=${h}&seed=${lock+777}&nologo=true&model=flux`;
     };
    const imgTag = (primary, fallback, cls, alt) => {
     const safeAlt = String(alt || "Travel Image").replace(/["'<>]/g, "");
     // Simpler onerror: try fallback once, then hide the image. Avoid injecting HTML via string interpolation.
     return `<img src="${primary}" alt="${safeAlt}" class="${cls}" onerror="if(this.dataset.fallback!=='1'){this.dataset.fallback='1';this.src='${fallback}';}else{this.style.display='none';}"/>`;
    };
     const pc = co.color;
     const flightsHtml = itin.flights.length === 0 ? "" : `
      <h2>✈️ Flights</h2>
      <table><thead><tr><th>Flight</th><th>Route</th><th>Date</th><th>Time</th><th>Class</th><th>Cost</th></tr></thead><tbody>
      ${itin.flights.map(f=>`<tr><td>${f.airline} ${f.flight_no}</td><td>${f.from} → ${f.to}</td><td>${f.date}</td><td>${f.departure}–${f.arrival}</td><td>${f.class}</td><td><strong>${fmtINR(f.cost||0)}</strong></td></tr>`).join("")}
      </tbody></table>`;
      const hotelsHtml = itin.hotels.length === 0 ? "" : `
      <h2>🏨 Hotels</h2>
      ${itin.hotels.map((h,hi)=>`
       <div class="hotel-card">
        ${imgTag(
        imgUrl(h.name+" "+h.destination+" luxury hotel", 860, 180, hi+50),
        fallbackImg(h.name+" "+h.destination+" hotel", 860, 180, hi+50),
        "hotel-img",
        h.name
        )}
        <div class="hotel-body">
         <div class="hotel-name">${"★".repeat(Math.min(h.rating||4,5))} ${h.name}</div>
         <div class="hotel-meta">📍 ${h.destination} &nbsp;·&nbsp; 📅 ${h.check_in} – ${h.check_out} &nbsp;·&nbsp; ${h.room_type} &nbsp;·&nbsp; ${h.meals}</div>
         <div class="hotel-cost">${h.nights} night${h.nights!==1?"s":""} &nbsp;·&nbsp; <strong>${fmtINR((h.cost_per_night||0)*(h.nights||1))}</strong></div>
        </div>
       </div>`).join("")}`;
     const daysHtml = itin.days.map((day,di) => {
      const dayImg = imgUrl(day.image_query||day.location||itin.destination, 860, 200, di+1);
      const actsHtml = (day.activities||[]).map((a,ai) => {
       const actImg = imgUrl(a.title+" "+day.location+" "+a.type, 100, 75, di*10+ai+100);
       return `<div class="act">
        ${imgTag(
         actImg,
         fallbackImg(a.title+" "+day.location+" "+a.type, 100, 75, di*10+ai+100),
         "act-img",
         a.title
        )}
        <div class="act-body">
         <div class="act-top"><span class="act-time">${a.time}</span><span class="act-badge">${a.type}</span><span class="act-title">${a.title}</span>${a.cost?`<span class="act-cost">${fmtINR(a.cost)}</span>`:""}</div>
         ${a.desc?`<div class="act-desc">${a.desc}</div>`:""}
        </div>
       </div>`;
      }).join("");
      return `<div class="day-card">
       <div class="day-img-wrap">${imgTag(
        dayImg,
        fallbackImg(day.image_query||day.location||itin.destination, 860, 200, di+1),
        "day-img",
        day.location || "day image"
       )}<div class="day-overlay"><span class="day-num">Day ${day.day}</span><span class="day-title-ov">${day.title}</span><span class="day-loc-ov">📍 ${day.location}${day.date?" · "+day.date:""}</span></div></div>
       ${day.hotel?`<div class="day-hotel">🏨 ${day.hotel}</div>`:""}
       <div class="acts-wrap">${actsHtml}</div>
      </div>`;
     }).join("");
     const logoHtml = co.logo ? `<img src="${co.logo}" alt="logo" style="height:52px;object-fit:contain;margin-bottom:6px"/>` : `<div style="font-size:28px;font-weight:900;letter-spacing:-1px">${co.name}</div>`;
     const coverImg = imgUrl(itin.destination+" travel scenic landscape", 900, 300, 999);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${itin.title||"Itinerary"}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;background:#fff}
.page{max-width:900px;margin:auto}
.cover-hero-wrap{position:relative;height:260px;overflow:hidden;background:#E2E8F0}
.cover-hero{width:100%;height:100%;object-fit:cover;display:block}
.img-ph{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;background:linear-gradient(135deg,#1A6B8A,#4FC3F7);color:#fff;text-align:center;padding:16px}
.img-ph-title{font-size:18px;font-weight:800;line-height:1.2;max-width:90%}
.img-ph-sub{font-size:11px;opacity:.85;margin-top:6px}
.cover{background:linear-gradient(135deg,${pc}f0,${pc});color:#fff;padding:28px 36px 30px}
.cover h1{font-size:24px;font-weight:900;margin:14px 0 6px;line-height:1.2}
.cover .sub{font-size:12px;opacity:.85}
.cover .highlights{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.cover .hl{background:rgba(255,255,255,.22);padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600}
.content{padding:20px 36px 32px}
.cost-bar{display:flex;background:#F8FAFC;border:1px solid #E6ECF5;border-radius:10px;overflow:hidden;margin:16px 0}
.cost-cell{flex:1;padding:11px 14px;text-align:center;border-right:1px solid #E6ECF5}
.cost-cell:last-child{border-right:none}
.cost-cell .lbl{font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:.5px}
.cost-cell .val{font-size:14px;font-weight:800;color:#0F172A;margin-top:3px}
.cost-cell.total .val{color:${pc}}
h2{font-size:13px;font-weight:700;color:${pc};border-bottom:2px solid #E6ECF5;padding-bottom:5px;margin:22px 0 10px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#F1F5F9;text-align:left;padding:7px 10px;font-weight:600;color:#334155}
td{padding:7px 10px;border-bottom:1px solid #F1F5F9;vertical-align:top}
.hotel-card{border:1px solid #E6ECF5;border-radius:10px;margin-bottom:12px;overflow:hidden;page-break-inside:avoid;position:relative}
.hotel-img{width:100%;height:150px;object-fit:cover;display:block}
.hotel-body{padding:10px 14px}
.hotel-name{font-size:14px;font-weight:700;margin-bottom:3px}
.hotel-meta{font-size:11px;color:#64748B;margin-bottom:3px}
.hotel-cost{font-size:12px;color:#334155}
.day-card{border:1px solid #E6ECF5;border-radius:10px;margin-bottom:14px;overflow:hidden;page-break-inside:avoid}
.day-img-wrap{position:relative;height:160px;overflow:hidden;background:#e6ecf5}
.day-img{width:100%;height:160px;object-fit:cover;display:block}
.day-overlay{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(to top,rgba(0,0,0,.78),transparent);padding:10px 14px;color:#fff;display:flex;align-items:flex-end;gap:8px}
.day-num{background:${pc};padding:2px 9px;border-radius:5px;font-weight:900;font-size:11px;flex-shrink:0}
.day-title-ov{font-weight:700;font-size:13px;flex:1}
.day-loc-ov{font-size:11px;opacity:.82;flex-shrink:0}
.day-hotel{background:#FFF3E0;padding:6px 14px;font-size:11px;color:#E65100;font-weight:600;border-bottom:1px solid #FFE0B2}
.acts-wrap{padding:6px 14px 2px}
.act{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #F8FAFC;align-items:flex-start;position:relative}
.act:last-child{border-bottom:none}
.act-img{width:80px;height:58px;object-fit:cover;border-radius:6px;flex-shrink:0}
.act .img-ph{position:relative;inset:auto;width:80px;height:58px;border-radius:6px;padding:6px}
.act .img-ph-title{font-size:9px;font-weight:700;line-height:1.1}
.act .img-ph-sub{font-size:8px;margin-top:3px}
.act-body{flex:1}
.act-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.act-time{font-weight:700;color:${pc};font-size:11px;flex-shrink:0}
.act-badge{background:#E3F6FC;color:${pc};padding:1px 7px;border-radius:20px;font-size:10px;flex-shrink:0}
.act-title{font-weight:600;font-size:12px;flex:1}
.act-cost{font-weight:700;font-size:11px;color:#0F172A;margin-left:auto}
.act-desc{font-size:11px;color:#64748B;margin-top:2px}
.footer{padding:14px 0;border-top:2px solid #E6ECF5;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#94A3B8;margin-top:20px}
@media print{
 button{display:none!important}
 *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
 body{background:#fff!important}
}
</style></head><body>
<div class="page">
 <div class="cover-hero-wrap">
  ${imgTag(
   coverImg,
   fallbackImg(itin.destination+" travel scenic landscape", 900, 300, 999),
   "cover-hero",
   itin.destination || "destination"
  )}
 </div>
 <div class="cover">
  <div>${logoHtml}<div style="font-size:11px;opacity:.72;margin-top:2px">${co.tagline||""}</div></div>
  <h1>${itin.title||"Travel Itinerary"}</h1>
  <div class="sub">📍 ${itin.destination}${itin.start_date?` &nbsp;·&nbsp; 📅 ${itin.start_date}${itin.end_date?" – "+itin.end_date:""}`:""} &nbsp;·&nbsp; 👥 ${itin.pax} adult${itin.pax!==1?"s":""}${itin.kids?`, ${itin.kids} child${itin.kids!==1?"ren":""}`:""}</div>
  ${itin.highlights.length>0?`<div class="highlights">${itin.highlights.map(h=>`<span class="hl">✔ ${h}</span>`).join("")}</div>`:""}
 </div>
 <div class="content">
  ${grandTotal>0?`<div class="cost-bar"><div class="cost-cell"><div class="lbl">✈ Flights</div><div class="val">${fmtINR(flightTotal)}</div></div><div class="cost-cell"><div class="lbl">🏨 Hotels</div><div class="val">${fmtINR(hotelTotal)}</div></div><div class="cost-cell"><div class="lbl">🗺 Activities</div><div class="val">${fmtINR(actTotal)}</div></div><div class="cost-cell total"><div class="lbl">Total Estimate</div><div class="val">${fmtINR(grandTotal)}</div></div></div>`:""}
  ${flightsHtml}${hotelsHtml}
  ${itin.days.length>0?`<h2>🗺 Day-by-Day Itinerary</h2>${daysHtml}`:""}
  <div class="footer"><div><strong>${co.name}</strong> &nbsp;·&nbsp; ${co.email}</div><div>Generated ${new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</div></div>
 </div>
</div>
<div style="text-align:center;padding:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
 <button id="downloadPdfBtn" style="background:${pc};color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600">⬇ Download PDF</button>
 <button id="printPdfBtn" style="background:#475569;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600">🖨 Print</button>
</div>
<script>
(() => {
 // Forward uncaught errors/rejections to parent for diagnostics
 window.addEventListener('error', (ev) => {
  try { window.parent.postMessage({ type: 'ITIN_PDF_ERROR', message: '[error] ' + (ev && ev.message ? ev.message : '') + ' @ ' + (ev && ev.filename ? ev.filename : '') + ':' + (ev && ev.lineno ? ev.lineno : '') }, '*'); } catch(e){}
 });
 window.addEventListener('unhandledrejection', (ev) => {
  try { window.parent.postMessage({ type: 'ITIN_PDF_ERROR', message: '[unhandledrejection] ' + (ev && ev.reason && ev.reason.message ? ev.reason.message : String(ev && ev.reason)) }, '*'); } catch(e){}
 });
 const safeName = ${(JSON.stringify((itin.title || "itinerary").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)))};
 const contentEl = document.querySelector('.page');
 const downloadBtn = document.getElementById('downloadPdfBtn');
 const printBtn = document.getElementById('printPdfBtn');

 const waitForImages = async (root = document, timeout = 15000) => {
  const imgs = Array.from((root || document).querySelectorAll('img'));
  if (!imgs.length) return;
  const waitForSingle = img => new Promise(resolve => {
   if (img.complete && img.naturalWidth) return resolve();
   const onDone = () => { cleanup(); resolve(); };
   const onErr = () => { cleanup(); resolve(); };
   function cleanup() { img.removeEventListener('load', onDone); img.removeEventListener('error', onErr); }
   img.addEventListener('load', onDone);
   img.addEventListener('error', onErr);
  });
  await Promise.race([
   Promise.all(imgs.map(waitForSingle)),
   new Promise(resolve => setTimeout(resolve, timeout))
  ]);
 };

 const waitForPdfLibs = async () => {
  const started = Date.now();
  while (Date.now() - started < 12000) {
   if (window.html2pdf && window.html2canvas) return true;
   await new Promise(resolve => setTimeout(resolve, 120));
  }
  return false;
 };

 // Convert image URLs to base64 data URLs to avoid CORS/pdf drops.
 // Try fetch+blob first (preferred), fallback to Image->canvas when needed.
 const toDataUrl = async (url) => {
  if (!url || url.startsWith('data:')) return url || '';
  // Try fetch+blob -> dataURL (requires CORS on the image host)
  try {
   const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
   if (!res.ok) throw new Error('fetch-failed');
   const blob = await res.blob();
   return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('fr-failed'));
    fr.readAsDataURL(blob);
   });
  } catch (e) {
   // fallback: draw via Image onto canvas (may fail if CORS blocks it)
   return await new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
     try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
     } catch (err) { resolve(url); }
    };
    img.onerror = () => resolve(url);
    img.src = url;
   });
  }
 };

 const inlineImages = async (root = document, perImageTimeout = 15000) => {
  const imgs = Array.from((root || document).querySelectorAll('img'));
  if (!imgs.length) return;
  await Promise.all(imgs.map(async (img) => {
   try {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    // set crossorigin so canvas attempts have a chance if the server allows it
    img.crossOrigin = 'anonymous';
    const dataUrl = await Promise.race([toDataUrl(src), new Promise(r => setTimeout(() => r(src), perImageTimeout))]);
    if (dataUrl && dataUrl !== src) img.setAttribute('src', dataUrl);
   } catch (e) { /* leave original src if inlining fails */ }
  }));
 };

 const doDownload = async () => {
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Preparing PDF...';
   try {
    const libsReady = await waitForPdfLibs();
    if (!libsReady) throw new Error('PDF libraries failed to load. Check internet/CDN access.');
     if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch {}
     }
    const opt = {
   margin: [8, 8, 8, 8],
   filename: safeName + '.pdf',
   image: { type: 'jpeg', quality: 0.92 },
   html2canvas: { scale: 2, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', imageTimeout: 20000 },
   jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
   pagebreak: { mode: ['css', 'legacy'] }
  };
    // First, try a fast direct export (this was the original working flow).
    try {
     await window.html2pdf().set(opt).from(contentEl).save();
     // success — skip fallback
     return;
    } catch (fastErr) {
     // If direct export fails, fall back to waiting/inline approach and retry.
     try { window.parent.postMessage({ type: 'ITIN_PDF_ERROR', message: 'Direct html2pdf export failed, falling back: ' + (fastErr && fastErr.message ? fastErr.message : String(fastErr)) }, '*'); } catch(e){}
    }
    // Fallback: attempt to inline images and wait, then retry.
    try {
     await waitForImages(contentEl);
     await inlineImages(contentEl);
     await waitForImages(contentEl);
    } catch (imgErr) {
     try { window.parent.postMessage({ type: 'ITIN_PDF_ERROR', message: 'Image processing error: ' + (imgErr && imgErr.message ? imgErr.message : String(imgErr)) }, '*'); } catch(e){}
    }
    // Retry export after inline
    await window.html2pdf().set(opt).from(contentEl).save();
  } catch (e) {
   console.error('Download PDF failed:', e);
   if (window.parent) {
    window.parent.postMessage({
     type: 'ITIN_PDF_ERROR',
     message: e?.message || 'PDF download failed'
    }, '*');
   }
  } finally {
   downloadBtn.disabled = false;
   downloadBtn.textContent = '⬇ Download PDF';
   if (window.parent) window.parent.postMessage({ type: 'ITIN_PDF_DONE' }, '*');
  }
 };

 const doPrint = async () => {
  await waitForImages();
  window.print();
 };

 if (downloadBtn) downloadBtn.addEventListener('click', doDownload);
 if (printBtn) printBtn.addEventListener('click', doPrint);
 // Auto-run download only after document is fully ready in worker context.
 if (document.readyState === 'complete') {
  setTimeout(doDownload, 500);
 } else {
  window.addEventListener('load', () => setTimeout(doDownload, 500), { once:true });
 }
})();
</script>
</body></html>`;
  // Run download inside hidden iframe so no preview popup opens.
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "0";
  iframe.style.top = "0";
  iframe.style.width = "1280px";
  iframe.style.height = "2200px";
  iframe.style.opacity = "0.01";
  iframe.style.zIndex = "-9999";
  iframe.style.pointerEvents = "none";
  iframe.style.border = "0";
  const cleanup = () => {
   window.removeEventListener("message", onMsg);
   if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };
  const onMsg = (ev) => {
    if (ev?.data?.type === "ITIN_PDF_DONE") cleanup();
    if (ev?.data?.type === "ITIN_PDF_ERROR") {
     toast$(ev?.data?.message || "PDF download failed. Please try again.", true);
     cleanup();
    }
  };
  window.addEventListener("message", onMsg);
  document.body.appendChild(iframe);
  const d = iframe.contentWindow.document;
  d.open();
  d.write(html);
  d.close();
  // Hard timeout cleanup in case postMessage is blocked.
  setTimeout(cleanup, 30000);
    }}>Download PDF</Btn>
    <Btn v="success" icon="check" onClick={saveItin}>Save</Btn>
   </div>

   {/* Cost summary strip */}
   {grandTotal > 0 && (
    <div style={{ display:"flex", gap:10, marginBottom:12, flexWrap:"wrap" }}>
     {[["Flights", flightTotal, "flight"],["Hotels", hotelTotal, "hotel_star"],["Activities", actTotal, "adventure"],["Total", grandTotal, "check"]].map(([lbl,amt,icon])=>(
      <div key={lbl} style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:9, padding:"7px 14px", display:"flex", alignItems:"center", gap:7 }}>
       <Icon name={icon} size={13}/>
       <span style={{ fontSize:11, color:"#64748B" }}>{lbl}</span>
       <span style={{ fontSize:13, fontWeight:700, color: lbl==="Total"?"#1A6B8A":"#0F172A" }}>{fmtINR(amt)}</span>
      </div>
     ))}
    </div>
   )}

   {/* Tabs */}
   <div style={{ display:"flex", gap:4, marginBottom:14, borderBottom:"1px solid #E6ECF5", paddingBottom:0 }}>
    {TABS.map(t => (
     <button key={t} onClick={() => setTab(t)} style={{
      background: tab===t ? "#1A6B8A" : "transparent",
      color: tab===t ? "#fff" : "#475569",
      border: tab===t ? "none" : "1px solid transparent",
      borderRadius:"8px 8px 0 0", padding:"7px 16px", fontSize:12, fontWeight:tab===t?700:400, cursor:"pointer", fontFamily:"inherit",
     }}>{TAB_LABELS[t]}</button>
    ))}
   </div>

   {/* Tab content */}
   <div style={{ flex:1, overflow:"auto" }}>

    {/* ─── OVERVIEW TAB ─── */}
    {tab==="overview" && (
     <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, maxWidth:780 }}>
      <F label="Destination *">
       <Inp value={itin.destination} onChange={e=>upd("destination",e.target.value)} placeholder="e.g. Maldives, Bali, Switzerland"/>
      </F>
      <F label="Link to Lead">
       <Sel value={itin.lead_id} onChange={e=>{
        const l = leads.find(x=>x.id===e.target.value);
        upd("lead_id", e.target.value);
        if(l) { upd("lead_name", l.name); if(l.destination && !itin.destination) upd("destination", l.destination); }
       }}>
        <option value="">— No lead —</option>
        {leads.map(l => <option key={l.id} value={l.id}>{l.name} — {l.destination}</option>)}
       </Sel>
      </F>
      <F label="Start Date"><Inp type="date" value={itin.start_date} onChange={e=>upd("start_date",e.target.value)}/></F>
      <F label="End Date"><Inp type="date" value={itin.end_date} onChange={e=>upd("end_date",e.target.value)}/></F>
      <F label="Adults"><Inp type="number" min={1} value={itin.pax} onChange={e=>upd("pax",Number(e.target.value))}/></F>
      <F label="Kids"><Inp type="number" min={0} value={itin.kids} onChange={e=>upd("kids",Number(e.target.value))}/></F>
      <div style={{ gridColumn:"1/-1" }}>
       <F label="Preferences / Notes"><TA value={itin.notes} onChange={e=>upd("notes",e.target.value)} placeholder="E.g. honeymoon, adventure activities, vegetarian food, 4-star hotels only…"/></F>
      </div>
      {itin.highlights?.length > 0 && (
       <div style={{ gridColumn:"1/-1" }}>
        <F label="Trip Highlights">
         <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          {itin.highlights.map((h,i) => (
           <span key={i} style={{ background:"#E3F6FC", color:"#1A6B8A", border:"1px solid #B3E0EE", fontSize:12, padding:"4px 10px", borderRadius:20, display:"flex", alignItems:"center", gap:5 }}>
            {h}
            <button onClick={()=>setItin(p=>({...p,highlights:p.highlights.filter((_,j)=>j!==i)}))} style={{ background:"none",border:"none",cursor:"pointer",color:"#1A6B8A",padding:0,lineHeight:1 }}>×</button>
           </span>
          ))}
         </div>
        </F>
       </div>
      )}
      <div style={{ gridColumn:"1/-1", textAlign:"right" }}>
       <Btn v="secondary" icon="itinerary" onClick={aiGenerate} spin={aiLoading} disabled={aiLoading}>
        {aiLoading ? "Generating with AI…" : "Generate Full Itinerary with AI →"}
       </Btn>
      </div>
     </div>
    )}

    {/* ─── DAYS TAB ─── */}
    {tab==="days" && (
     <div>
      {itin.days.length === 0 && (
       <div style={{ background:"#FFFFFF", border:"2px dashed #D5E1EE", borderRadius:12, padding:40, textAlign:"center", marginBottom:16 }}>
        <div style={{ color:"#64748B", fontSize:13, marginBottom:14 }}>No days yet. Use AI Generate or add days manually.</div>
        <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
         <Btn v="secondary" icon="itinerary" onClick={aiGenerate} spin={aiLoading} disabled={!itin.destination||aiLoading}>
          {aiLoading ? "Generating…" : "AI Generate Days"}
         </Btn>
         <Btn v="primary" onClick={addDay}>+ Add Day Manually</Btn>
        </div>
       </div>
      )}

      {itin.days.map((day, dayIdx) => {
       const imgSrc = imgErrors[dayIdx]
        ? null
        : unsplashUrl(day.image_query || day.location || itin.destination, 800, 280, dayIdx+1);
       return (
        <div key={dayIdx} style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:14, marginBottom:16, overflow:"hidden" }}>
         {/* Day image */}
         {imgSrc && (
          <div style={{ height:180, position:"relative", overflow:"hidden", background:"#E6ECF5" }}>
           <img
            src={imgSrc}
            alt={day.location}
            style={{ width:"100%", height:"100%", objectFit:"cover" }}
            onError={() => setImgErrors(p => ({ ...p, [dayIdx]: true }))}
           />
           <div style={{ position:"absolute", inset:0, background:"linear-gradient(to right, rgba(0,0,0,.55) 0%, transparent 60%)" }}/>
           <div style={{ position:"absolute", top:12, left:14, color:"#fff" }}>
            <div style={{ background:"linear-gradient(135deg,#1A6B8A,#0D4D6B)", borderRadius:8, padding:"3px 10px", fontSize:11, fontWeight:700, display:"inline-block", marginBottom:5 }}>Day {day.day}</div>
            <div style={{ fontSize:16, fontWeight:700, textShadow:"0 1px 3px rgba(0,0,0,.5)", maxWidth:300 }}>{day.title}</div>
            <div style={{ fontSize:12, opacity:.9, display:"flex", alignItems:"center", gap:4, marginTop:2 }}><Icon name="place" size={12}/>{day.location}</div>
           </div>
           <div style={{ position:"absolute", top:10, right:10, display:"flex", gap:6 }}>
            <button onClick={() => setImgErrors(p => ({ ...p, [dayIdx]: true }))} style={{ background:"rgba(255,255,255,.2)", border:"1px solid rgba(255,255,255,.4)", borderRadius:6, color:"#fff", fontSize:10, padding:"3px 7px", cursor:"pointer" }}>Hide image</button>
            <button onClick={() => removeDay(dayIdx)} style={{ background:"rgba(183,28,28,.7)", border:"none", borderRadius:6, color:"#fff", fontSize:10, padding:"3px 8px", cursor:"pointer" }}>✕</button>
           </div>
          </div>
         )}

         <div style={{ padding:14 }}>
          {!imgSrc && (
           <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span style={{ background:"linear-gradient(135deg,#1A6B8A,#0D4D6B)", borderRadius:8, padding:"3px 10px", fontSize:11, fontWeight:700, color:"#fff" }}>Day {day.day}</span>
            <button onClick={() => removeDay(dayIdx)} style={{ background:"#FEE2E2", border:"none", borderRadius:6, color:"#B91C1C", fontSize:11, padding:"3px 9px", cursor:"pointer" }}>Remove Day</button>
           </div>
          )}

          {/* Day meta row */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1.5fr", gap:8, marginBottom:12 }}>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Title</div>
            <input value={day.title} onChange={e=>updDay(dayIdx,"title",e.target.value)} style={{ ...IS, padding:"6px 9px", fontSize:12 }}/>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Date</div>
            <input type="date" value={day.date} onChange={e=>updDay(dayIdx,"date",e.target.value)} style={{ ...IS, padding:"6px 9px", fontSize:12 }}/>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Location</div>
            <input value={day.location} onChange={e=>updDay(dayIdx,"location",e.target.value)} style={{ ...IS, padding:"6px 9px", fontSize:12 }}/>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Image search query</div>
            <input value={day.image_query} onChange={e=>{ updDay(dayIdx,"image_query",e.target.value); setImgErrors(p=>({...p,[dayIdx]:false})); }} style={{ ...IS, padding:"6px 9px", fontSize:12 }} placeholder="e.g. Maldives overwater villa"/>
           </div>
          </div>
          {/* Hotel for this day */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Hotel / Accommodation</div>
            <select value={day.hotel} onChange={e=>updDay(dayIdx,"hotel",e.target.value)} style={{ ...IS, padding:"6px 9px", fontSize:12 }}>
             <option value="">— Select / type name —</option>
             {(itin.hotels||[]).map((h,i) => <option key={i} value={h.name}>{h.name}</option>)}
            </select>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Hotel name (manual)</div>
            <input value={day.hotel} onChange={e=>updDay(dayIdx,"hotel",e.target.value)} style={{ ...IS, padding:"6px 9px", fontSize:12 }} placeholder="Hotel name for tonight"/>
           </div>
          </div>

          {/* Activities */}
          <div style={{ marginBottom:8 }}>
           <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
            <div style={{ fontSize:11, color:"#475569", fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>Activities ({(day.activities||[]).length})</div>
            <button onClick={() => addActivity(dayIdx)} style={{ background:"#EEF3F9", border:"1px solid #D5E1EE", borderRadius:7, padding:"4px 10px", fontSize:11, cursor:"pointer", color:"#1A6B8A", fontWeight:600 }}>+ Add Activity</button>
           </div>

           {(day.activities||[]).map((act, actIdx) => {
            const at = ACT_TYPES[act.type] || ACT_TYPES.other;
            return (
             <div key={actIdx} style={{ display:"flex", gap:8, marginBottom:6, alignItems:"flex-start", background:"#F8FAFB", border:"1px solid #E6ECF5", borderRadius:9, padding:"8px 10px" }}>
              <div style={{ background:at.bg, color:at.color, borderRadius:7, padding:"4px 7px", fontSize:10, fontWeight:700, whiteSpace:"nowrap", minWidth:72, textAlign:"center", marginTop:2 }}>
               <Icon name={at.icon} size={11}/> {at.label}
              </div>
              <div style={{ flex:1, display:"grid", gridTemplateColumns:"60px 2fr 3fr 80px", gap:5 }}>
               <input type="time" value={act.time} onChange={e=>updActivity(dayIdx,actIdx,"time",e.target.value)} style={{ ...IS, padding:"4px 6px", fontSize:11 }}/>
               <input value={act.title} onChange={e=>updActivity(dayIdx,actIdx,"title",e.target.value)} placeholder="Activity name" style={{ ...IS, padding:"4px 8px", fontSize:11 }}/>
               <input value={act.desc} onChange={e=>updActivity(dayIdx,actIdx,"desc",e.target.value)} placeholder="Short description" style={{ ...IS, padding:"4px 8px", fontSize:11 }}/>
               <input type="number" value={act.cost||0} min={0} onChange={e=>updActivity(dayIdx,actIdx,"cost",Number(e.target.value))} placeholder="₹ Cost" style={{ ...IS, padding:"4px 7px", fontSize:11 }}/>
              </div>
              <select value={act.type} onChange={e=>updActivity(dayIdx,actIdx,"type",e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:7, padding:"4px 7px", fontSize:11, color:"#334155" }}>
               {Object.entries(ACT_TYPES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <button onClick={() => removeActivity(dayIdx, actIdx)} style={{ background:"none", border:"none", color:"#94A3B8", cursor:"pointer", fontSize:16, lineHeight:1, padding:"2px 0" }}>×</button>
             </div>
            );
           })}
          </div>
         </div>
        </div>
       );
      })}

      <Btn v="secondary" onClick={addDay} icon="itinerary">+ Add Day</Btn>
     </div>
    )}

    {/* ─── FLIGHTS TAB ─── */}
    {tab==="flights" && (
     <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
       <div style={{ fontSize:13, color:"#475569" }}>Add all flight segments for this itinerary</div>
       <Btn v="primary" icon="flight" onClick={addFlight}>+ Add Flight</Btn>
      </div>
      {itin.flights.length === 0 && (
       <div style={{ background:"#F6F8FC", border:"2px dashed #D5E1EE", borderRadius:12, padding:40, textAlign:"center", color:"#94A3B8", fontSize:13 }}>
        No flights added yet. Click "+ Add Flight" or use AI Generate to auto-fill.
       </div>
      )}
      {itin.flights.map((fl, idx) => (
       <div key={idx} style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:14, marginBottom:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
         <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <Icon name="flight" size={16}/>
          <span style={{ fontWeight:600, fontSize:13, color:"#1A6B8A" }}>{fl.from || "Origin"} → {fl.to || "Destination"}</span>
         </div>
         <button onClick={() => removeFlight(idx)} style={{ background:"#FEE2E2", border:"none", borderRadius:6, color:"#B91C1C", fontSize:11, padding:"3px 9px", cursor:"pointer" }}>Remove</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:9 }}>
         {[["from","From City"],["to","To City"],["date","Date"],["airline","Airline"]].map(([f,lbl])=>(
          <div key={f}>
           <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>{lbl}</div>
           <Inp type={f==="date"?"date":"text"} value={fl[f]} onChange={e=>updFlight(idx,f,e.target.value)} placeholder={lbl}/>
          </div>
         ))}
         {[["flight_no","Flight No"],["departure","Departure"],["arrival","Arrival"],["class","Class"]].map(([f,lbl])=>(
          <div key={f}>
           <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>{lbl}</div>
           {f==="class"
            ? <Sel value={fl.class} onChange={e=>updFlight(idx,"class",e.target.value)}>{["Economy","Business","First"].map(c=><option key={c}>{c}</option>)}</Sel>
            : <Inp type={f.includes("ture")||f.includes("val")?"time":"text"} value={fl[f]} onChange={e=>updFlight(idx,f,e.target.value)} placeholder={lbl}/>
           }
          </div>
         ))}
         <div>
          <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Cost (₹)</div>
          <Inp type="number" min={0} value={fl.cost||0} onChange={e=>updFlight(idx,"cost",Number(e.target.value))}/>
         </div>
        </div>
       </div>
      ))}
      {itin.flights.length > 0 && (
       <div style={{ background:"#EEF3F9", borderRadius:9, padding:"10px 14px", fontSize:13, color:"#0F172A", fontWeight:600, textAlign:"right" }}>
        Total Flight Cost: {fmtINR(flightTotal)}
       </div>
      )}
     </div>
    )}

    {/* ─── HOTELS TAB ─── */}
    {tab==="hotels" && (
     <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
       <div style={{ fontSize:13, color:"#475569" }}>Add hotels and accommodation details</div>
       <Btn v="primary" icon="hotel_star" onClick={addHotel}>+ Add Hotel</Btn>
      </div>
      {itin.hotels.length === 0 && (
       <div style={{ background:"#F6F8FC", border:"2px dashed #D5E1EE", borderRadius:12, padding:40, textAlign:"center", color:"#94A3B8", fontSize:13 }}>
        No hotels added yet. Click "+ Add Hotel" or use AI Generate to auto-fill.
       </div>
      )}
      {itin.hotels.map((h, idx) => {
       const hotelPrimary = unsplashUrl((h.name || h.destination || "hotel") + " luxury hotel resort", 1000, 280, idx + 100);
       const hotelFallback = `https://picsum.photos/seed/${encodeURIComponent((h.name || h.destination || "hotel") + (idx+1))}/1000/280`;
       return (
        <div key={idx} style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, overflow:"hidden", marginBottom:12 }}>
         <div style={{ height:140, position:"relative", background:"#E6ECF5" }}>
          <img
           src={hotelPrimary}
           alt={h.name}
           style={{ width:"100%", height:"100%", objectFit:"cover" }}
           onError={e => {
            if (!e.currentTarget.dataset.fallback) {
             e.currentTarget.dataset.fallback = "1";
             e.currentTarget.src = hotelFallback;
            } else {
            const ph = e.currentTarget.parentElement?.querySelector(".hotel-ph");
            if (ph) ph.style.display = "flex";
             e.currentTarget.style.display = "none";
            }
           }}
          />
          <div style={{ position:"absolute", inset:0, display:"none", justifyContent:"center", alignItems:"center", background:"linear-gradient(135deg,#64748B,#94A3B8)", color:"#fff", textAlign:"center", padding:12 }} className="hotel-ph">
           <div>
            <div style={{ fontSize:14, fontWeight:800, lineHeight:1.2 }}>{h.name || "Hotel"}</div>
            <div style={{ fontSize:11, opacity:.9, marginTop:4 }}>{h.destination || itin.destination || "Destination"}</div>
            <div style={{ fontSize:10, opacity:.85, marginTop:4 }}>Image unavailable</div>
           </div>
          </div>
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(0,0,0,.6) 0%, transparent 60%)" }}/>
          <div style={{ position:"absolute", bottom:10, left:12, color:"#fff" }}>
           <div style={{ fontSize:14, fontWeight:700 }}>{h.name || "Hotel Name"}</div>
           <div style={{ fontSize:11, opacity:.9 }}>
            {"★".repeat(Math.min(h.rating||4,5))} · {h.destination}
           </div>
          </div>
          <button onClick={() => removeHotel(idx)} style={{ position:"absolute", top:8, right:8, background:"rgba(183,28,28,.7)", border:"none", borderRadius:6, color:"#fff", fontSize:11, padding:"3px 9px", cursor:"pointer" }}>Remove</button>
         </div>
         <div style={{ padding:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:9 }}>
           {[["name","Hotel Name"],["destination","City / Destination"],["room_type","Room Type"],["meals","Meal Plan"]].map(([f,lbl])=>(
            <div key={f}>
             <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>{lbl}</div>
             {f==="meals"
              ? <Sel value={h.meals} onChange={e=>updHotel(idx,"meals",e.target.value)}>{["Room Only","Breakfast","Half Board","Full Board","All Inclusive"].map(m=><option key={m}>{m}</option>)}</Sel>
              : <Inp value={h[f]} onChange={e=>updHotel(idx,f,e.target.value)} placeholder={lbl}/>
             }
            </div>
           ))}
           {[["check_in","Check-in"],["check_out","Check-out"],["rating","Star Rating"],["nights","Nights"],["cost_per_night","Cost/Night (₹)"]].map(([f,lbl])=>(
            <div key={f}>
             <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>{lbl}</div>
             {f==="rating"
              ? <Sel value={h.rating} onChange={e=>updHotel(idx,"rating",Number(e.target.value))}>{[2,3,4,5].map(r=><option key={r} value={r}>{r} Star</option>)}</Sel>
              : <Inp type={f.includes("_in")||f.includes("_out")?"date":"number"} min={0} value={h[f]} onChange={e=>updHotel(idx,f,f.includes("_in")||f.includes("_out")?e.target.value:Number(e.target.value))}/>
             }
            </div>
           ))}
          </div>
          <div style={{ background:"#EEF3F9", borderRadius:8, padding:"8px 12px", marginTop:10, fontSize:13, color:"#0F172A", textAlign:"right" }}>
           Hotel subtotal: <strong>{fmtINR((Number(h.cost_per_night)||0) * (Number(h.nights)||1))}</strong> ({h.nights || 1} nights × {fmtINR(h.cost_per_night||0)})
          </div>
         </div>
        </div>
       );
      })}
      {itin.hotels.length > 0 && (
       <div style={{ background:"#EEF3F9", borderRadius:9, padding:"10px 14px", fontSize:13, color:"#0F172A", fontWeight:600, textAlign:"right" }}>
        Total Hotel Cost: {fmtINR(hotelTotal)}
       </div>
      )}
     </div>
    )}

    {/* ─── MAP & PREVIEW TAB ─── */}
    {tab==="map" && (
     <div id="itin-print-area">
      {/* Print header — only visible in PDF */}
      <div className="print-only" style={{ marginBottom:16 }}>
       <h1 style={{ fontFamily:"'Playfair Display',serif", margin:0, fontSize:22, color:"#0F172A" }}>{itin.title}</h1>
       <div style={{ fontSize:12, color:"#64748B", marginTop:4 }}>
        {itin.destination} · {itin.start_date||""}{itin.end_date ? " → "+itin.end_date : ""} · {itin.pax} adults{itin.kids?`, ${itin.kids} kids`:""}
       </div>
       {itin.highlights.length > 0 && (
        <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:6 }}>
         {itin.highlights.map((h,i) => <span key={i} style={{ background:"#E3F6FC", color:"#1A6B8A", padding:"3px 10px", borderRadius:20, fontSize:11 }}>{h}</span>)}
        </div>
       )}
       {grandTotal > 0 && (
        <div style={{ display:"flex", gap:20, background:"#F8FAFC", padding:"10px 16px", borderRadius:8, marginTop:12 }}>
         {[["✈ Flights",flightTotal],["🏨 Hotels",hotelTotal],["🗺 Activities",actTotal],["💰 Total",grandTotal]].map(([l,v])=>(
          <div key={l}><div style={{ fontSize:10, color:"#64748B" }}>{l}</div><div style={{ fontSize:14, fontWeight:700 }}>{fmtINR(v)}</div></div>
         ))}
        </div>
       )}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
       {/* Map */}
       <div>
        <div style={{ fontWeight:700, fontSize:13, color:"#0F172A", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
         <Icon name="mapview" size={15}/>Destination Map
        </div>
        <div style={{ borderRadius:12, overflow:"hidden", border:"1px solid #D5E1EE", height:380 }}>
         <iframe
          title="destination-map"
          width="100%"
          height="380"
          style={{ border:0 }}
          loading="lazy"
          src={`https://maps.google.com/maps?q=${encodeURIComponent(itin.destination || "India")}&output=embed&z=8`}
          allowFullScreen
         />
        </div>
        <a
         href={`https://www.google.com/maps/dir/${[...new Set((itin.days||[]).map(d => d.location).filter(Boolean))].map(encodeURIComponent).join("/")}`}
         target="_blank"
         rel="noreferrer"
         style={{ display:"block", marginTop:8, textAlign:"center", fontSize:12, color:"#1A6B8A", textDecoration:"none" }}
        >
         Open full route in Google Maps →
        </a>
       </div>

       {/* Travel Path */}
       <div>
        <div style={{ fontWeight:700, fontSize:13, color:"#0F172A", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
         <Icon name="route" size={15}/>Travel Path
        </div>
        <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:14 }}>
         {itin.days.length === 0 && <div style={{ color:"#94A3B8", fontSize:12, textAlign:"center", padding:30 }}>No days yet — add them in the Days tab</div>}
         {itin.days.map((d, i) => (
          <div key={i} style={{ display:"flex", gap:10, marginBottom:12 }}>
           <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
            <div style={{ width:28, height:28, background:"linear-gradient(135deg,#1A6B8A,#0D4D6B)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff", flexShrink:0 }}>{d.day}</div>
            {i < itin.days.length-1 && <div style={{ width:2, flex:1, background:"#D5E1EE", margin:"3px 0" }}/>}
           </div>
           <div style={{ flex:1, paddingBottom:8 }}>
            <div style={{ fontWeight:600, fontSize:13, color:"#0F172A" }}>{d.title}</div>
            <div style={{ fontSize:11, color:"#64748B", display:"flex", alignItems:"center", gap:4, marginTop:2, marginBottom:4 }}>
             <Icon name="place" size={11}/>{d.location}
             {d.date && <span style={{ marginLeft:4, opacity:.7 }}>· {d.date}</span>}
            </div>
            {d.hotel && <div style={{ fontSize:11, color:"#FFB74D", display:"flex", alignItems:"center", gap:4 }}><Icon name="hotel_star" size={11}/>{d.hotel}</div>}
            <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:5 }}>
             {(d.activities||[]).slice(0,4).map((a,ai) => {
              const at = ACT_TYPES[a.type]||ACT_TYPES.other;
              return (
               <span key={ai} style={{ background:at.bg, color:at.color, fontSize:10, padding:"2px 7px", borderRadius:20 }}>{a.time} {a.title}</span>
              );
             })}
             {d.activities.length > 4 && <span style={{ fontSize:10, color:"#94A3B8" }}>+{d.activities.length-4} more</span>}
            </div>
           </div>
          </div>
         ))}
        </div>
       </div>
      </div>

      {/* Day-by-day summary for print */}
      {itin.days.length > 0 && (
       <div style={{ marginTop:16 }}>
        <div style={{ fontWeight:700, fontSize:13, color:"#0F172A", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
         <Icon name="adventure" size={14}/>Day-by-Day Summary
        </div>
        {itin.days.map((day, di) => (
         <div key={di} style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:10, marginBottom:10, overflow:"hidden" }}>
          <div style={{ display:"flex", gap:0 }}>
           <div style={{ width:80, flexShrink:0, background:"linear-gradient(135deg,#1A6B8A,#0D4D6B)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"10px 0", color:"#fff" }}>
            <div style={{ fontSize:18, fontWeight:700 }}>Day</div>
            <div style={{ fontSize:28, fontWeight:900, lineHeight:1 }}>{day.day}</div>
           </div>
           <img
            src={unsplashUrl(day.image_query||day.location||itin.destination, 200, 90, di+10)}
            alt={day.location}
            style={{ width:120, height:90, objectFit:"cover", flexShrink:0 }}
            onError={e => e.target.style.display="none"}
           />
           <div style={{ padding:"8px 12px", flex:1 }}>
            <div style={{ fontWeight:700, fontSize:13, color:"#0F172A" }}>{day.title}</div>
            <div style={{ fontSize:11, color:"#64748B", marginBottom:6 }}>{day.location}{day.date?` · ${day.date}`:""}{day.hotel?` · 🏨 ${day.hotel}`:""}</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
             {(day.activities||[]).map((a,ai) => {
              const at = ACT_TYPES[a.type]||ACT_TYPES.other;
              return <span key={ai} style={{ background:at.bg, color:at.color, fontSize:10, padding:"2px 8px", borderRadius:20 }}>{a.time} · {a.title}</span>;
             })}
            </div>
           </div>
          </div>
         </div>
        ))}
       </div>
      )}

      {/* Quick summary cards */}
      {(itin.flights.length > 0 || itin.hotels.length > 0) && (
       <div style={{ marginTop:16, display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {itin.flights.length > 0 && (
         <div style={{ background:"#E3F6FC", border:"1px solid #B3E0EE", borderRadius:11, padding:13 }}>
          <div style={{ fontWeight:700, fontSize:12, color:"#1A6B8A", marginBottom:8, display:"flex", alignItems:"center", gap:5 }}><Icon name="flight" size={13}/> Flights</div>
          {itin.flights.map((f,i) => (
           <div key={i} style={{ fontSize:11, color:"#334155", marginBottom:4 }}>
            {f.from} → {f.to} · {f.date} · {f.airline} {f.flight_no} · <strong>{fmtINR(f.cost||0)}</strong>
           </div>
          ))}
         </div>
        )}
        {itin.hotels.length > 0 && (
         <div style={{ background:"#FFF3E0", border:"1px solid #FFD08A", borderRadius:11, padding:13 }}>
          <div style={{ fontWeight:700, fontSize:12, color:"#E65100", marginBottom:8, display:"flex", alignItems:"center", gap:5 }}><Icon name="hotel_star" size={13}/> Hotels</div>
          {itin.hotels.map((h,i) => (
           <div key={i} style={{ fontSize:11, color:"#334155", marginBottom:4 }}>
            {"★".repeat(Math.min(h.rating||4,5))} {h.name} · {h.nights}N · <strong>{fmtINR((h.cost_per_night||0)*(h.nights||1))}</strong>
           </div>
          ))}
         </div>
        )}
       </div>
      )}
     </div>
    )}

   </div>
  </div>
 );
}

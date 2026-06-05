// ─────────────────────────────────────────────────────────────────────────────
// SAFARNAAMA CRM — Backend API client
// All calls go to /api/... which the React dev server proxies to localhost:3001
// Import what you need in App.js:  import * as API from "./api";
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "";          // proxy handles routing; empty = same origin
const h = { "Content-Type": "application/json" };

async function req(method, path, body, isFormData = false) {
  const opts = { method, headers: isFormData ? {} : h };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// ── Health ────────────────────────────────────────────────────────────────────
export const health = () => req("GET", "/health");

// ── Leads ─────────────────────────────────────────────────────────────────────
export const getLeads     = ()         => req("GET",    "/api/leads");
export const createLead   = (lead)     => req("POST",   "/api/leads", lead);
export const updateLead   = (id, data) => req("PATCH",  `/api/leads/${id}`, data);
export const deleteLead   = (id)       => req("DELETE", `/api/leads/${id}`);

// ── Vendors ───────────────────────────────────────────────────────────────────
export const getVendors   = ()         => req("GET",  "/api/vendors");
export const createVendor = (vendor)   => req("POST", "/api/vendors", vendor);

// Upload a vendor package document (PDF/DOCX/TXT)
export const uploadVendorPackage = (vendorId, file, rawContent = "") => {
  const fd = new FormData();
  if (file) fd.append("doc", file);
  else fd.append("raw_content", rawContent);
  return req("POST", `/api/vendors/${vendorId}/packages`, fd, true);
};

// ── Itinerary ─────────────────────────────────────────────────────────────────
// { destination, pax, budget, nights? }
export const generateItinerary = (params) => req("POST", "/api/itinerary/generate", params);

// ── Quotes ────────────────────────────────────────────────────────────────────
// Request a quote → drafts vendor email via Claude + sends to all matching vendors
export const requestQuote = (leadId) => req("POST", "/api/quotes/request", { leadId });

// Upload a vendor quote document → extract pricing + apply markup
export const uploadQuoteDoc = (file) => {
  const fd = new FormData();
  fd.append("doc", file);
  return req("POST", "/api/quotes/upload-doc", fd, true);
};

// ── Invoices ──────────────────────────────────────────────────────────────────
export const getInvoices      = ()     => req("GET",  "/api/invoices");
export const generateInvoice  = (leadId) => req("POST", "/api/invoices/generate", { leadId });
export const sendInvoice      = (id)   => req("POST", `/api/invoices/${id}/send`);

// ── Vouchers ──────────────────────────────────────────────────────────────────
export const getVouchers      = ()       => req("GET",  "/api/vouchers");
export const generateVoucher  = (leadId) => req("POST", "/api/vouchers/generate", { leadId });

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSetting    = (key)        => req("GET", `/api/settings/${key}`);
export const saveSetting   = (key, value) => req("PUT", `/api/settings/${key}`, value);

// ── Notifications ─────────────────────────────────────────────────────────────
export const getNotifications = ()  => req("GET",   "/api/notifications");
export const markAllRead      = ()  => req("PATCH", "/api/notifications/read-all");

// ── AI Chat ───────────────────────────────────────────────────────────────────
// context = { leads, quotes, invoices } — pass whatever is relevant
export const aiChat = (message, context = {}) =>
  req("POST", "/api/ai/chat", { message, context });

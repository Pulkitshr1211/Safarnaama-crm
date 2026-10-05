import { useState, useEffect, useRef } from "react";

// ─── AUTH TOKEN INJECTION ─────────────────────────────────────────────────────
// Patches global fetch so every /api/* call automatically carries the Bearer
// token — fixes all bare fetch("/api/...") calls in settings/docs/email/etc.
const _origFetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
 if (typeof url === "string" && (url.startsWith("/api/") || url.includes(":3002/api/"))) {
  const token = localStorage.getItem("sfn_auth_token");
  if (token) {
   opts = { ...opts, headers: { "Authorization": `Bearer ${token}`, ...(opts.headers || {}) } };
  }
 }
 return _origFetch(url, opts);
};

// ─── BACKEND API BASE ─────────────────────────────────────────────────────────
// React dev server proxies /api/* → http://localhost:3002 via setupProxy.js
const API = async (method, path, body, isForm = false) => {
 const token = localStorage.getItem("sfn_auth_token");
 const opts = { method, headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...(token ? { "Authorization": `Bearer ${token}` } : {}) } };
 if (body) opts.body = isForm ? body : JSON.stringify(body);
 let res = await fetch(path, opts).catch(e => null);
 if (!res || res.status === 404) {
  try {
   const alt = `${window.location.protocol}//${window.location.hostname}:3002${path}`;
   res = await fetch(alt, opts);
  } catch (e) { /* fall through */ }
 }
 const data = await (res ? res.json().catch(() => ({})) : Promise.resolve({}));
 if (res?.status === 401) {
  localStorage.removeItem("sfn_auth_token");
  localStorage.removeItem("sfn_auth_user");
  window.location.reload();
 }
 if (!res || !res.ok) {
  const err = new Error(data?.error || `HTTP ${res ? res.status : 'NO_RESPONSE'}`);
  err._detail = data?._detail || data;
  throw err;
 }
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
 const set = v => {
  const next = typeof v === "function" ? v(state) : v;
  setState(next);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch(e) {
   console.warn("[useDB] localStorage full for key:", key, "—", e.message);
  }
 };
 return [state, set];
};

// ─── API-BACKED ENTITY SYNC ──────────────────────────────────────────────────
// Diffs prev vs next state to determine which API calls to make (POST/PATCH/DELETE).
// Fire-and-forget — does not block UI or revert on error.
function syncToAPI(endpoint, prev, next, onError) {
 const prevMap = new Map((prev || []).map(x => [String(x.id), x]));
 const nextMap = new Map((next || []).map(x => [String(x.id), x]));
 const token = localStorage.getItem("sfn_auth_token");
 const H = { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) };
 const check = async (p, method, body) => {
  try {
   const r = await fetch(p, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
   if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    console.error(`[syncToAPI] ${method} ${p} → ${r.status}:`, err?.error || r.statusText);
    if (onError) onError(`DB sync failed (${r.status}): ${err?.error || r.statusText}`);
   }
  } catch (e) { console.warn(`[syncToAPI] ${method} ${p} failed:`, e.message); }
 };
 for (const [id] of prevMap)
  if (!nextMap.has(id)) check(`${endpoint}/${id}`, "DELETE");
 for (const [id, item] of nextMap) {
  if (!prevMap.has(id)) check(endpoint, "POST", item);
  else if (JSON.stringify(prevMap.get(id)) !== JSON.stringify(item)) check(`${endpoint}/${id}`, "PATCH", item);
 }
}

// Hook: reads from localStorage first (instant), then fetches from API to get
// authoritative data.  On every set(), updates localStorage AND fires syncToAPI.
// Pass endpoint=null to disable API sync (portal/whitelabel mode).
const useAPIDB = (key, initial, endpoint) => {
 const ref = useRef(null);
 const [state, rawSet] = useState(() => {
  try {
   const s = localStorage.getItem(key);
   const v = s ? JSON.parse(s) : initial;
   ref.current = v;
   return v;
  } catch { ref.current = initial; return initial; }
 });
 useEffect(() => {
  if (!endpoint) return;
  const token = localStorage.getItem("sfn_auth_token");
  const headers = token ? { "Authorization": `Bearer ${token}` } : {};
  fetch(endpoint, { headers })
   .then(r => r.ok ? r.json() : null)
   .then(data => {
    if (Array.isArray(data) && data.length > 0) {
     // API has data — use it as source of truth
     ref.current = data;
     rawSet(data);
     try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
    } else if (Array.isArray(data) && data.length === 0 && ref.current?.length > 0) {
     // API is empty but local has records — push local data up to Supabase (one-time migration)
     console.log(`[useAPIDB] migrating ${ref.current.length} local records → ${endpoint}`);
     syncToAPI(endpoint, [], ref.current);
    }
   })
   .catch(() => {}); // fall back to localStorage silently
 }, []); // eslint-disable-line react-hooks/exhaustive-deps
 const set = v => {
  const prev = ref.current;
  const next = typeof v === "function" ? v(prev) : v;
  ref.current = next;
  rawSet(next);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch(e) {
   console.warn("[useAPIDB] localStorage full:", key, e.message);
  }
  if (endpoint && Array.isArray(next) && Array.isArray(prev))
   syncToAPI(endpoint, prev, next);
 };
 return [state, set];
};

// ─── BIZ SETTINGS — defaults, hook ───────────────────────────────────────────
// User-configurable settings only — all reference/dropdown data comes from /api/reference
const DEFAULT_COMPANY_PROFILE = {
 name: "Safarnaama Holidays",
 tagline: "Explore | Capture | Inspire",
 logo: "",
 primaryColor: "#1A6B8A",
 email: "enquiry@safarnaama.com",
 phone1: "+91 98976 10033",
 phone2: "+91 85100 81781",
 address: "S2S Complex, Second Floor, Garh Road, Meerut - 250002",
 website: "",
 instagram: "",
 facebook: "",
 whatsapp: "",
};

const DEFAULT_BIZ_SETTINGS = {
 tax_name: "GST", tax_rate: 5,
 currency_symbol: "₹", currency_locale: "en-IN",
 emergency_contact: "+91-9999999999",
 default_markup_pct: 22,
 lead_statuses:     ["New","Quote Requested","Quote Received","Quote Sent","Confirmed","Cancelled"],
 quote_statuses:    ["Quote Requested","Quote Received","Quote Sent","Confirmed","Cancelled"],
 task_statuses:     ["Open","In Progress","Done"],
 task_priorities:   ["Low","Medium","High"],
 itin_statuses:     ["Draft","Confirmed","Sent","Archived"],
 vendor_categories: ["Hotel","Resort","Villa","Tour Operator","DMC","Activity","Transport","Airline","Restaurant"],
 custom_destinations: [],
 custom_cities:       {},
 custom_activities:   {},
 whatsapp_templates: [
  { id:"wt1", name:"Initial Follow Up", message:"Hi {name}! 👋 Thank you for reaching out about {destination}. We'd love to plan your perfect trip for {pax} traveller(s){kids_text} on {travel_date}. Could we connect for a quick call to understand your requirements better? — {agent}" },
  { id:"wt2", name:"Quote Ready", message:"Hi {name}! 🎉 Your personalised quote for {destination} is ready for {pax} traveller(s){kids_text}. Please reply or call us to go over the details at your convenience. — {agent}" },
  { id:"wt3", name:"Booking Reminder", message:"Hi {name}! 📅 Just a friendly reminder about your {destination} trip on {travel_date}. Please ensure all travel documents are ready. Reach out for any assistance! — {agent}" },
 ],
 payment_details: {
  account_name:   "SAFARNAAMA HOLIDAYS",
  bank_name:      "HDFC BANK",
  branch:         "171/1 TARU KUNJ, GARH ROAD MEERUT -250004 - UTTAR PRADESH",
  account_number: "50200089249983",
  ifsc:           "HDFC0001911",
 },
};

// Fetches biz_settings from Supabase (via backend) on mount.
// localStorage is used as an instant cache so the UI renders immediately.
// On save, writes to both API and localStorage so all tabs/devices stay in sync.
const useBizSettings = (localKey) => {
 const [settings, setSettings] = useState(() => {
  try {
   const cached = JSON.parse(localStorage.getItem(localKey) || "null");
   return cached ? { ...DEFAULT_BIZ_SETTINGS, ...cached } : { ...DEFAULT_BIZ_SETTINGS };
  } catch { return { ...DEFAULT_BIZ_SETTINGS }; }
 });

 useEffect(() => {
  fetch("/api/settings/biz_settings")
   .then(r => r.ok ? r.json() : null)
   .then(data => {
    if (data && Object.keys(data).length > 0) {
     const merged = { ...DEFAULT_BIZ_SETTINGS, ...data };
     setSettings(merged);
     localStorage.setItem(localKey, JSON.stringify(merged));
    }
   })
   .catch(() => {}); // silently fall back to cached localStorage value
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 const save = (newVal) => {
  const next = typeof newVal === "function" ? newVal(settings) : newVal;
  const merged = { ...DEFAULT_BIZ_SETTINGS, ...next };
  setSettings(merged);
  localStorage.setItem(localKey, JSON.stringify(merged));
  fetch("/api/settings/biz_settings", {
   method: "PUT",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify(merged),
  }).catch(() => {}); // localStorage remains the fallback if API is unreachable
 };

 return [settings, save];
};

// Generic hook for a single JSON value stored in app_settings (keyed objects, not arrays).
// Reads from API on mount; writes to both API and localStorage on set.
const useSettingsKey = (apiKey, defaultVal) => {
 const lsKey = `sfn_setting_${apiKey}`;
 const [val, setVal] = useState(() => {
  try {
   const c = JSON.parse(localStorage.getItem(lsKey) || "null");
   return c ? { ...defaultVal, ...c } : { ...defaultVal };
  } catch { return { ...defaultVal }; }
 });
 useEffect(() => {
  fetch(`/api/settings/${apiKey}`)
   .then(r => r.ok ? r.json() : null)
   .then(data => {
    if (data && Object.keys(data).length > 0) {
     const merged = { ...defaultVal, ...data };
     setVal(merged);
     localStorage.setItem(lsKey, JSON.stringify(merged));
    }
   })
   .catch(() => {});
 }, []); // eslint-disable-line react-hooks/exhaustive-deps
 const save = newVal => {
  const next = typeof newVal === "function" ? newVal(val) : newVal;
  const merged = { ...defaultVal, ...next };
  setVal(merged);
  localStorage.setItem(lsKey, JSON.stringify(merged));
  fetch(`/api/settings/${apiKey}`, {
   method: "PUT",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify(merged),
  }).catch(() => {});
 };
 return [val, save];
};

// Fetches immutable reference data (destinations, cities, activities, dropdowns) from /api/reference.
// localStorage is used as an instant cache so dropdowns render even before the fetch completes.
const useRefData = (cacheKey, url) => {
 const [data, setData] = useState(() => {
  try { return JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch { return null; }
 });
 const [loading, setLoading] = useState(false);
 const doFetch = (clearFirst = false) => {
  if (clearFirst) { localStorage.removeItem(cacheKey); setData(null); }
  setLoading(true);
  fetch(url)
   .then(r => r.ok ? r.json() : Promise.reject(r.status))
   .then(d => {
    if (d) {
     setData(d);
     try { localStorage.setItem(cacheKey, JSON.stringify(d)); } catch(e) { console.warn("[useRefData] cache write failed:", e.message); }
    }
   })
   .catch(err => console.warn("[useRefData] fetch failed:", url, err))
   .finally(() => setLoading(false));
 };
 useEffect(() => { doFetch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
 return [data, loading, doFetch];
};

const genId = prefix => `${prefix}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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
 // ── INDIA: GOA ────────────────────────────────────────────────────────────
 { id:"V001", name:"Taj Exotica Resort & Spa Goa", email:"reservations.goa@tajhotels.com", phone:"+91-832-6650000", destination:"Goa", category:"Resort", rating:4.9, status:"Active" },
 { id:"V002", name:"Grand Hyatt Goa", email:"reservations.goa@hyatt.com", phone:"+91-832-2721234", destination:"Goa", category:"Hotel", rating:4.7, status:"Active" },
 { id:"V003", name:"The Leela Goa Cavelossim Beach", email:"reservations@theleela.com", phone:"+91-832-6622222", destination:"Goa", category:"Resort", rating:4.8, status:"Active" },
 { id:"V004", name:"Club Mahindra Varca Beach Goa", email:"goa@clubmahindra.com", phone:"+91-832-2745555", destination:"Goa", category:"Resort", rating:4.3, status:"Active" },
 { id:"V005", name:"Alila Diwa Goa", email:"diwa@alilahotels.com", phone:"+91-832-2746800", destination:"Goa", category:"Resort", rating:4.7, status:"Active" },
 { id:"V006", name:"Thomas Cook India - Goa DMC", email:"goa@thomascook.in", phone:"+91-832-2438000", destination:"Goa", category:"DMC", rating:4.5, status:"Active" },
 // ── INDIA: KERALA ────────────────────────────────────────────────────────
 { id:"V007", name:"Kumarakom Lake Resort Kerala", email:"reservations@kumarakomlakeresort.com", phone:"+91-481-2524900", destination:"Kerala", category:"Resort", rating:4.9, status:"Active" },
 { id:"V008", name:"Coconut Lagoon CGH Earth Kumarakom", email:"coconutlagoon@cghearth.com", phone:"+91-481-2524491", destination:"Kerala", category:"Resort", rating:4.8, status:"Active" },
 { id:"V009", name:"Spice Village CGH Earth Thekkady", email:"spicevillage@cghearth.com", phone:"+91-486-9222315", destination:"Kerala", category:"Resort", rating:4.7, status:"Active" },
 { id:"V010", name:"Somatheeram Ayurvedic Health Resort", email:"info@somatheeram.in", phone:"+91-471-2268101", destination:"Kerala", category:"Resort", rating:4.6, status:"Active" },
 { id:"V011", name:"Kerala Premium Houseboats Alleppey", email:"bookings@keralahouseboats.net", phone:"+91-477-2232444", destination:"Kerala", category:"Villa", rating:4.7, status:"Active" },
 { id:"V012", name:"KTDC Kerala Tourism DMC", email:"info@ktdc.com", phone:"+91-471-2330031", destination:"Kerala", category:"Tour Operator", rating:4.5, status:"Active" },
 // ── INDIA: KASHMIR ───────────────────────────────────────────────────────
 { id:"V013", name:"The Lalit Grand Palace Srinagar", email:"reservations.srinagar@thelalit.com", phone:"+91-194-2501001", destination:"Kashmir", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V014", name:"Houseboat New King Dal Lake Srinagar", email:"bookings@newkingdalview.com", phone:"+91-194-2422282", destination:"Kashmir", category:"Villa", rating:4.5, status:"Active" },
 { id:"V015", name:"Hotel Highland Park Gulmarg", email:"reservations@highlandparkgulmarg.com", phone:"+91-1954-254455", destination:"Kashmir", category:"Hotel", rating:4.4, status:"Active" },
 { id:"V016", name:"Pahalgam Hotel Pahalgam Valley", email:"reservations@hotelpahalgam.com", phone:"+91-1936-243013", destination:"Kashmir", category:"Hotel", rating:4.2, status:"Active" },
 { id:"V017", name:"Kashmir Himalayan Expedition Tours", email:"info@kashmirhimalayan.com", phone:"+91-194-2456789", destination:"Kashmir", category:"Tour Operator", rating:4.6, status:"Active" },
 // ── INDIA: RAJASTHAN ─────────────────────────────────────────────────────
 { id:"V018", name:"Rambagh Palace Jaipur by Taj", email:"rambagh.jaipur@tajhotels.com", phone:"+91-141-2385700", destination:"Rajasthan", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V019", name:"Umaid Bhawan Palace Jodhpur by Taj", email:"umaidbhawan.jodhpur@tajhotels.com", phone:"+91-291-2510101", destination:"Rajasthan", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V020", name:"Taj Lake Palace Udaipur", email:"lakepalace.udaipur@tajhotels.com", phone:"+91-294-2428800", destination:"Rajasthan", category:"Hotel", rating:5.0, status:"Active" },
 { id:"V021", name:"Suryagarh Jaisalmer Heritage Hotel", email:"reservations@suryagarh.com", phone:"+91-2992-269269", destination:"Rajasthan", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V022", name:"RAAS Jodhpur Boutique Hotel", email:"reservations@raasjodhpur.com", phone:"+91-291-2636455", destination:"Rajasthan", category:"Hotel", rating:4.7, status:"Active" },
 { id:"V023", name:"Heritage Hotels Rajasthan DMC", email:"bookings@heritagehotelsrajasthan.com", phone:"+91-141-2571741", destination:"Rajasthan", category:"DMC", rating:4.6, status:"Active" },
 // ── INDIA: HIMACHAL PRADESH ──────────────────────────────────────────────
 { id:"V024", name:"Wildflower Hall Shimla by Oberoi", email:"reservations@oberoihotels.com", phone:"+91-177-2648585", destination:"Himachal Pradesh", category:"Resort", rating:4.9, status:"Active" },
 { id:"V025", name:"Span Resort & Spa Manali", email:"span@spanresorts.com", phone:"+91-1902-252138", destination:"Himachal Pradesh", category:"Resort", rating:4.5, status:"Active" },
 { id:"V026", name:"The Himalayan Manali by Taj", email:"himalayan.manali@tajhotels.com", phone:"+91-1902-252555", destination:"Himachal Pradesh", category:"Hotel", rating:4.7, status:"Active" },
 { id:"V027", name:"Club Mahindra Manali Resort", email:"manali@clubmahindra.com", phone:"+91-1902-252341", destination:"Himachal Pradesh", category:"Resort", rating:4.3, status:"Active" },
 { id:"V028", name:"Solang Valley Resort Manali", email:"info@solangvalleyresorts.com", phone:"+91-1902-253333", destination:"Himachal Pradesh", category:"Resort", rating:4.4, status:"Active" },
 // ── INDIA: ANDAMAN ISLANDS ───────────────────────────────────────────────
 { id:"V029", name:"Barefoot at Havelock Andaman", email:"reservations@barefootindia.com", phone:"+91-3192-282323", destination:"Andaman Islands", category:"Resort", rating:4.8, status:"Active" },
 { id:"V030", name:"Fortune Resort Bay Island Port Blair", email:"fortbay@fortunehotels.in", phone:"+91-3192-234101", destination:"Andaman Islands", category:"Hotel", rating:4.4, status:"Active" },
 { id:"V031", name:"Munjoh Ocean Resort Havelock Island", email:"info@munjoh.com", phone:"+91-3192-282328", destination:"Andaman Islands", category:"Resort", rating:4.6, status:"Active" },
 { id:"V032", name:"Symphony Palms Beach Resort Havelock", email:"reservations@symphonypalms.com", phone:"+91-3192-282526", destination:"Andaman Islands", category:"Resort", rating:4.5, status:"Active" },
 { id:"V033", name:"Andaman & Nicobar Tourism", email:"andaman.tourism@nic.in", phone:"+91-3192-232747", destination:"Andaman Islands", category:"Tour Operator", rating:4.4, status:"Active" },
 // ── INDIA: LEH-LADAKH ────────────────────────────────────────────────────
 { id:"V034", name:"The Grand Dragon Ladakh Leh", email:"reservations@granddragonladakh.com", phone:"+91-1982-257786", destination:"Leh-Ladakh", category:"Hotel", rating:4.7, status:"Active" },
 { id:"V035", name:"Hotel Ladakh Sarai Leh", email:"info@ladakhsarai.com", phone:"+91-1982-251360", destination:"Leh-Ladakh", category:"Hotel", rating:4.3, status:"Active" },
 { id:"V036", name:"Chamba Camp Thiksey Ladakh by Shakti", email:"info@shaktihimalaya.com", phone:"+91-11-41661000", destination:"Leh-Ladakh", category:"Villa", rating:4.9, status:"Active" },
 { id:"V037", name:"Adventure Leh Ladakh Tours", email:"info@adventureladakhtours.com", phone:"+91-1982-250756", destination:"Leh-Ladakh", category:"Tour Operator", rating:4.6, status:"Active" },
 // ── INDIA: COORG / SOUTH INDIA ───────────────────────────────────────────
 { id:"V038", name:"Orange County Coorg Resort", email:"reservations@orangecounty.in", phone:"+91-8272-265100", destination:"Coorg", category:"Resort", rating:4.8, status:"Active" },
 { id:"V039", name:"Club Mahindra Madikeri Coorg", email:"madikeri@clubmahindra.com", phone:"+91-8272-228889", destination:"Coorg", category:"Resort", rating:4.3, status:"Active" },
 { id:"V040", name:"Windermere Estate Munnar", email:"info@windermereresort.com", phone:"+91-4865-230512", destination:"Munnar", category:"Resort", rating:4.7, status:"Active" },
 { id:"V041", name:"Savoy Hotel Ooty by Taj", email:"savoy.ooty@tajhotels.com", phone:"+91-423-2244142", destination:"Ooty", category:"Hotel", rating:4.5, status:"Active" },
 // ── INDIA: DELHI / AGRA / GOLDEN TRIANGLE ────────────────────────────────
 { id:"V042", name:"The Imperial New Delhi", email:"luxury@theimperialindia.com", phone:"+91-11-23341234", destination:"Delhi", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V043", name:"ITC Maurya New Delhi", email:"itcmaurya@itchotels.in", phone:"+91-11-26112233", destination:"Delhi", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V044", name:"The Oberoi Agra", email:"reservations.agra@oberoihotels.com", phone:"+91-562-4011234", destination:"Agra", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V045", name:"ITC Mughal Agra", email:"reservations.mughalagra@itchotels.com", phone:"+91-562-4021700", destination:"Agra", category:"Hotel", rating:4.7, status:"Active" },
 { id:"V046", name:"Cox & Kings India - Golden Triangle", email:"goldentriangle@coxandkings.com", phone:"+91-11-23351722", destination:"Delhi", category:"Tour Operator", rating:4.7, status:"Active" },
 // ── INDIA: VARANASI / RISHIKESH ──────────────────────────────────────────
 { id:"V047", name:"Nadesar Palace Varanasi by Taj", email:"nadesar.varanasi@tajhotels.com", phone:"+91-542-6660000", destination:"Varanasi", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V048", name:"Ananda in the Himalayas Rishikesh", email:"sales@anandaspa.com", phone:"+91-1378-227500", destination:"Rishikesh", category:"Resort", rating:4.9, status:"Active" },
 { id:"V049", name:"The Haveli Hari Ganga Haridwar", email:"info@harganharidwar.com", phone:"+91-133-2226443", destination:"Rishikesh", category:"Hotel", rating:4.4, status:"Active" },
 // ── INDIA: DARJEELING / SIKKIM ───────────────────────────────────────────
 { id:"V050", name:"Glenburn Tea Estate Darjeeling", email:"info@glenburnteaestate.com", phone:"+91-33-22883633", destination:"Darjeeling", category:"Resort", rating:4.8, status:"Active" },
 { id:"V051", name:"Elgin Hotel Darjeeling Heritage", email:"reservations@elginhotels.com", phone:"+91-354-2257226", destination:"Darjeeling", category:"Hotel", rating:4.4, status:"Active" },
 { id:"V052", name:"Sikkim Holiday Treks & Tours DMC", email:"info@sikkimholidaytreks.com", phone:"+91-3592-202681", destination:"Darjeeling", category:"Tour Operator", rating:4.5, status:"Active" },
 // ── INDIA: MUMBAI / PUNE ─────────────────────────────────────────────────
 { id:"V053", name:"The Taj Mahal Palace Mumbai", email:"tmhp.bom@tajhotels.com", phone:"+91-22-66653366", destination:"Mumbai", category:"Hotel", rating:5.0, status:"Active" },
 { id:"V054", name:"The Oberoi Mumbai", email:"reservations.obm@oberoihotels.com", phone:"+91-22-66325757", destination:"Mumbai", category:"Hotel", rating:4.9, status:"Active" },
 // ── DUBAI ─────────────────────────────────────────────────────────────────
 { id:"V055", name:"Burj Al Arab Jumeirah Dubai", email:"reservations@jumeirah.com", phone:"+971-4-3017777", destination:"Dubai", category:"Hotel", rating:5.0, status:"Active" },
 { id:"V056", name:"Atlantis The Palm Dubai", email:"reservations@atlantisthepalm.com", phone:"+971-4-4260000", destination:"Dubai", category:"Resort", rating:4.8, status:"Active" },
 { id:"V057", name:"Jumeirah Beach Hotel Dubai", email:"jbhreservations@jumeirah.com", phone:"+971-4-3480000", destination:"Dubai", category:"Hotel", rating:4.7, status:"Active" },
 { id:"V058", name:"Address Downtown Dubai", email:"addressdowntown@addresshotels.com", phone:"+971-4-4368888", destination:"Dubai", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V059", name:"One&Only Royal Mirage Dubai", email:"royalmirage@oneandonlyresorts.com", phone:"+971-4-3999999", destination:"Dubai", category:"Resort", rating:4.9, status:"Active" },
 { id:"V060", name:"Waldorf Astoria Dubai Palm Jumeirah", email:"wapj.reservations@waldorfastoria.com", phone:"+971-4-8181000", destination:"Dubai", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V061", name:"Arabian Adventures Dubai DMC", email:"arabian.adventures@emiratesgroup.com", phone:"+971-4-3034888", destination:"Dubai", category:"DMC", rating:4.7, status:"Active" },
 // ── SINGAPORE ────────────────────────────────────────────────────────────
 { id:"V062", name:"Marina Bay Sands Singapore", email:"reservations@marinabaysands.com", phone:"+65-6688-8888", destination:"Singapore", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V063", name:"Raffles Hotel Singapore", email:"singapore@raffles.com", phone:"+65-6337-1886", destination:"Singapore", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V064", name:"The Fullerton Hotel Singapore", email:"info@fullertonhotel.com", phone:"+65-6733-8388", destination:"Singapore", category:"Hotel", rating:4.7, status:"Active" },
 { id:"V065", name:"Capella Singapore Sentosa Island", email:"singapore@capellahotels.com", phone:"+65-6377-8888", destination:"Singapore", category:"Resort", rating:4.9, status:"Active" },
 { id:"V066", name:"Mandarin Oriental Singapore", email:"mosin-reservations@mohg.com", phone:"+65-6338-0066", destination:"Singapore", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V067", name:"Chan Brothers Travel Singapore DMC", email:"info@chanbrothers.com.sg", phone:"+65-6212-3000", destination:"Singapore", category:"DMC", rating:4.6, status:"Active" },
 // ── MALDIVES ─────────────────────────────────────────────────────────────
 { id:"V068", name:"Velaa Private Island Maldives", email:"reservations@velaaprivateisland.com", phone:"+960-660-3000", destination:"Maldives", category:"Villa", rating:5.0, status:"Active" },
 { id:"V069", name:"Soneva Fushi Maldives", email:"enquiries@soneva.com", phone:"+960-660-0304", destination:"Maldives", category:"Resort", rating:5.0, status:"Active" },
 { id:"V070", name:"Anantara Veli Maldives Resort", email:"veli@anantara.com", phone:"+960-664-4100", destination:"Maldives", category:"Resort", rating:4.8, status:"Active" },
 { id:"V071", name:"Niyama Private Islands Maldives", email:"discover@niyama.com", phone:"+960-676-0011", destination:"Maldives", category:"Resort", rating:4.9, status:"Active" },
 { id:"V072", name:"LUX* South Ari Atoll Maldives", email:"luxsaa@luxresorts.com", phone:"+960-668-0901", destination:"Maldives", category:"Resort", rating:4.8, status:"Active" },
 { id:"V073", name:"Milaidhoo Island Maldives", email:"info@milaidhoo.com", phone:"+960-528-2002", destination:"Maldives", category:"Resort", rating:4.9, status:"Active" },
 { id:"V074", name:"Cheval Blanc Randheli Maldives", email:"reservations.randheli@chevalblanc.com", phone:"+960-656-1515", destination:"Maldives", category:"Villa", rating:5.0, status:"Active" },
 { id:"V075", name:"Maldives Overwater Specialists DMC", email:"bookings@maldivesspecialists.com", phone:"+960-330-0999", destination:"Maldives", category:"DMC", rating:4.7, status:"Active" },
 // ── MAURITIUS ────────────────────────────────────────────────────────────
 { id:"V076", name:"LUX* Le Morne Mauritius", email:"luxmorne@luxresorts.com", phone:"+230-401-4000", destination:"Mauritius", category:"Resort", rating:4.8, status:"Active" },
 { id:"V077", name:"The Oberoi Mauritius", email:"reservations@oberoihotels.com", phone:"+230-204-3600", destination:"Mauritius", category:"Resort", rating:4.9, status:"Active" },
 { id:"V078", name:"Constance Belle Mare Plage Mauritius", email:"bellemareplage@constancehotels.com", phone:"+230-402-2600", destination:"Mauritius", category:"Resort", rating:4.8, status:"Active" },
 { id:"V079", name:"Shanti Maurice Wellness Resort", email:"res@shantimaurice.com", phone:"+230-603-7200", destination:"Mauritius", category:"Resort", rating:4.7, status:"Active" },
 { id:"V080", name:"Heritage Awali Golf & Spa Resort", email:"awali@heritageresorts.mu", phone:"+230-623-5500", destination:"Mauritius", category:"Resort", rating:4.6, status:"Active" },
 { id:"V081", name:"Air Mauritius Holidays DMC", email:"holidays@airmauritius.com", phone:"+230-207-7575", destination:"Mauritius", category:"Tour Operator", rating:4.5, status:"Active" },
 // ── SRI LANKA ────────────────────────────────────────────────────────────
 { id:"V082", name:"Shangri-La Colombo Sri Lanka", email:"slc@shangri-la.com", phone:"+94-11-788-5700", destination:"Sri Lanka", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V083", name:"Anantara Peace Haven Tangalle", email:"tangalle@anantara.com", phone:"+94-47-808-0800", destination:"Sri Lanka", category:"Resort", rating:4.8, status:"Active" },
 { id:"V084", name:"Aman Amangalla Galle Fort", email:"amangalla@aman.com", phone:"+94-91-223-3388", destination:"Sri Lanka", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V085", name:"The Fortress Resort & Spa Galle", email:"info@thefortress.lk", phone:"+94-91-438-9400", destination:"Sri Lanka", category:"Resort", rating:4.7, status:"Active" },
 { id:"V086", name:"Wild Coast Tented Lodge Yala Safari", email:"wildcoast@resplendent.lk", phone:"+94-115-300-700", destination:"Sri Lanka", category:"Villa", rating:4.9, status:"Active" },
 { id:"V087", name:"Jetwing Travels Sri Lanka DMC", email:"leisure@jetwing.net", phone:"+94-11-234-5700", destination:"Sri Lanka", category:"DMC", rating:4.6, status:"Active" },
 // ── VIETNAM ──────────────────────────────────────────────────────────────
 { id:"V088", name:"Four Seasons The Nam Hai Hoi An", email:"hoian@fourseasons.com", phone:"+84-235-394-0000", destination:"Vietnam", category:"Resort", rating:4.9, status:"Active" },
 { id:"V089", name:"Anantara Hoi An Resort", email:"hoian@anantara.com", phone:"+84-235-391-4555", destination:"Vietnam", category:"Resort", rating:4.7, status:"Active" },
 { id:"V090", name:"Park Hyatt Saigon Ho Chi Minh City", email:"saigon.park@hyatt.com", phone:"+84-28-3824-1234", destination:"Vietnam", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V091", name:"Paradise Elegance Cruise Ha Long Bay", email:"info@paradisecruises.vn", phone:"+84-24-3942-4443", destination:"Vietnam", category:"Villa", rating:4.8, status:"Active" },
 { id:"V092", name:"La Siesta Premium Hoi An Hotel", email:"reservation@lasiesta-hoian.com", phone:"+84-235-391-5915", destination:"Vietnam", category:"Hotel", rating:4.6, status:"Active" },
 { id:"V093", name:"Destination Asia Vietnam DMC", email:"vietnam@destination-asia.com", phone:"+84-28-3925-2055", destination:"Vietnam", category:"DMC", rating:4.7, status:"Active" },
 // ── MALAYSIA ─────────────────────────────────────────────────────────────
 { id:"V094", name:"The Ritz-Carlton Kuala Lumpur", email:"rckl.reservations@ritzcarlton.com", phone:"+60-3-2142-8000", destination:"Malaysia", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V095", name:"The Datai Langkawi", email:"reservations@thedatai.com", phone:"+60-4-952-4000", destination:"Malaysia", category:"Resort", rating:5.0, status:"Active" },
 { id:"V096", name:"Mandarin Oriental Kuala Lumpur", email:"mokul-reservations@mohg.com", phone:"+60-3-2380-8888", destination:"Malaysia", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V097", name:"Four Seasons Resort Langkawi", email:"reservations.langkawi@fourseasons.com", phone:"+60-4-950-8888", destination:"Malaysia", category:"Resort", rating:4.9, status:"Active" },
 { id:"V098", name:"Shangri-La Rasa Sayang Penang", email:"slrsp@shangri-la.com", phone:"+60-4-888-8888", destination:"Malaysia", category:"Resort", rating:4.7, status:"Active" },
 { id:"V099", name:"Asian Overland Services Malaysia DMC", email:"info@asianoverland.com.my", phone:"+60-3-4252-9100", destination:"Malaysia", category:"DMC", rating:4.5, status:"Active" },
 // ── BALI, INDONESIA ──────────────────────────────────────────────────────
 { id:"V100", name:"Amandari Ubud Bali", email:"amandari@aman.com", phone:"+62-361-975333", destination:"Bali", category:"Resort", rating:5.0, status:"Active" },
 { id:"V101", name:"Four Seasons Bali at Sayan Ubud", email:"sayan.bali@fourseasons.com", phone:"+62-361-977577", destination:"Bali", category:"Resort", rating:4.9, status:"Active" },
 { id:"V102", name:"The Mulia Nusa Dua Bali", email:"reservation@themulia.com", phone:"+62-361-3017777", destination:"Bali", category:"Resort", rating:4.9, status:"Active" },
 { id:"V103", name:"Alila Villas Uluwatu Bali", email:"uluwatu@alilahotels.com", phone:"+62-361-848-2166", destination:"Bali", category:"Villa", rating:4.9, status:"Active" },
 { id:"V104", name:"COMO Shambhala Estate Ubud Bali", email:"csebali@comohotels.com", phone:"+62-361-978888", destination:"Bali", category:"Resort", rating:4.9, status:"Active" },
 { id:"V105", name:"Komaneka at Bisma Ubud Bali", email:"reservation@komaneka.com", phone:"+62-361-971933", destination:"Bali", category:"Resort", rating:4.8, status:"Active" },
 { id:"V106", name:"Bali DMC - Discovery Destination Management", email:"info@ddmbali.com", phone:"+62-361-754754", destination:"Bali", category:"DMC", rating:4.7, status:"Active" },
 // ── EUROPE: FRANCE / PARIS ───────────────────────────────────────────────
 { id:"V107", name:"Hotel Le Bristol Paris", email:"resa@lebristolparis.com", phone:"+33-1-5343-4300", destination:"Paris", category:"Hotel", rating:5.0, status:"Active" },
 { id:"V108", name:"Shangri-La Paris Eiffel Tower View", email:"reservations.slpa@shangri-la.com", phone:"+33-1-5367-1998", destination:"Paris", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V109", name:"Le Meurice Paris Luxury Hotel", email:"reservations@lemeurice.com", phone:"+33-1-4458-1010", destination:"Paris", category:"Hotel", rating:4.9, status:"Active" },
 // ── EUROPE: SWITZERLAND ──────────────────────────────────────────────────
 { id:"V110", name:"Victoria-Jungfrau Grand Hotel Interlaken", email:"welcome@victoria-jungfrau.ch", phone:"+41-33-828-2828", destination:"Switzerland", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V111", name:"Badrutt's Palace Hotel St. Moritz", email:"info@badruttspalace.com", phone:"+41-81-837-1000", destination:"Switzerland", category:"Hotel", rating:5.0, status:"Active" },
 { id:"V112", name:"The Dolder Grand Zurich", email:"reservations@thedoldergrand.com", phone:"+41-44-456-6000", destination:"Switzerland", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V113", name:"Fairmont Le Montreux Palace", email:"montreux@fairmont.com", phone:"+41-21-962-1212", destination:"Switzerland", category:"Hotel", rating:4.7, status:"Active" },
 // ── EUROPE: ITALY ────────────────────────────────────────────────────────
 { id:"V114", name:"Hotel Splendido Portofino Italy", email:"reservations@hotelsplendido.com", phone:"+39-0185-267801", destination:"Italy", category:"Hotel", rating:5.0, status:"Active" },
 { id:"V115", name:"Four Seasons Hotel Firenze Florence", email:"firenze@fourseasons.com", phone:"+39-055-2626-1", destination:"Italy", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V116", name:"Belmond Cipriani Venice", email:"reservation.cipriani@belmond.com", phone:"+39-041-240-801", destination:"Italy", category:"Hotel", rating:5.0, status:"Active" },
 { id:"V117", name:"Rome Cavalieri Waldorf Astoria", email:"romecavalieri.reservations@waldorfastoria.com", phone:"+39-06-35091", destination:"Italy", category:"Hotel", rating:4.8, status:"Active" },
 // ── EUROPE: GREECE ───────────────────────────────────────────────────────
 { id:"V118", name:"Canaves Oia Suites Santorini", email:"info@canaves.com", phone:"+30-22860-71453", destination:"Greece", category:"Villa", rating:5.0, status:"Active" },
 { id:"V119", name:"Mystique Hotel Santorini", email:"info@mystique.gr", phone:"+30-22860-71114", destination:"Greece", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V120", name:"Bill & Coo Suites Mykonos", email:"info@bill-coo-hotel.com", phone:"+30-22890-26292", destination:"Greece", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V121", name:"Hotel Grande Bretagne Athens", email:"sales.hgb@marriott.com", phone:"+30-210-333-0000", destination:"Greece", category:"Hotel", rating:4.8, status:"Active" },
 // ── EUROPE: SPAIN ────────────────────────────────────────────────────────
 { id:"V122", name:"Mandarin Oriental Barcelona", email:"mobcn-reservations@mohg.com", phone:"+34-93-151-8888", destination:"Spain", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V123", name:"Hotel Arts Barcelona Ritz-Carlton", email:"reservations.barcelona@ritzcarlton.com", phone:"+34-93-221-1000", destination:"Spain", category:"Hotel", rating:4.8, status:"Active" },
 // ── EUROPE: UK / LONDON ──────────────────────────────────────────────────
 { id:"V124", name:"The Langham London", email:"tllon.reservations@langhamhotels.com", phone:"+44-20-7636-1000", destination:"London", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V125", name:"Rosewood London Holborn", email:"enquiries.london@rosewoodhotels.com", phone:"+44-20-7781-8888", destination:"London", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V126", name:"Claridge's Hotel London Mayfair", email:"info@claridges.co.uk", phone:"+44-20-7629-8860", destination:"London", category:"Hotel", rating:5.0, status:"Active" },
 // ── EUROPE: TURKEY ───────────────────────────────────────────────────────
 { id:"V127", name:"Mandarin Oriental Bosphorus Istanbul", email:"mobosph-reservations@mohg.com", phone:"+90-212-232-2000", destination:"Turkey", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V128", name:"Argos in Cappadocia Cave Hotel", email:"reservation@argosincappadocia.com", phone:"+90-384-219-3130", destination:"Turkey", category:"Hotel", rating:4.8, status:"Active" },
 { id:"V129", name:"Museum Hotel Cappadocia", email:"reservation@museumhotel.com.tr", phone:"+90-384-219-2220", destination:"Turkey", category:"Hotel", rating:4.9, status:"Active" },
 // ── EUROPE: AMSTERDAM / PRAGUE ───────────────────────────────────────────
 { id:"V130", name:"Waldorf Astoria Amsterdam", email:"waldorf.amsterdam@waldorfastoria.com", phone:"+31-20-718-4600", destination:"Amsterdam", category:"Hotel", rating:4.9, status:"Active" },
 { id:"V131", name:"Four Seasons Hotel Prague", email:"prague@fourseasons.com", phone:"+420-221-427-000", destination:"Prague", category:"Hotel", rating:4.9, status:"Active" },
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
 eye:"M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
 copy:"M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
 download:"M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
 chart:"M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z",
 palette:"M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
 globe:"M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
 email:"M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
 vendor_req:"M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z",
};
const Icon = ({ name, size=18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d={ICONS[name]||ICONS.chat}/></svg>;
// ─── UI ATOMS ─────────────────────────────────────────────────────────────────
const Badge = ({ status }) => {
 const C = { New:"#4FC3F7","Quote Requested":"#64B5F6","Quote Received":"#BA68C8","Quote Sent":"#FFB74D",Confirmed:"#81C784",Cancelled:"#EF9A9A",Active:"#81C784",Paid:"#81C784",Draft:"#90A4AE",Sent:"#4FC3F7",Replied:"#CE93D8" };
 const c = C[status]||"#90A4AE";
 return <span style={{ background:c+"22",color:c,border:`1px solid ${c}44`,padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:.5 }}>{status}</span>;
};
const Modal = ({ open, onClose, title, children, width=660 }) => !open ? null : (
 <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
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

// Dropdown with inline "+ Add new" capability.
// onAddNew(val) — caller persists the new value to whatever store it uses.
const SelectOrAdd = ({ value, options=[], onChange, onAddNew, placeholder="— Select —", style, small, loading }) => {
 const [adding, setAdding] = useState(false);
 const [newVal, setNewVal]  = useState("");
 const pad = small ? "4px 8px" : "7px 11px";
 const fsz = small ? 11 : 13;
 const commit = () => {
  const v = newVal.trim();
  if (v) { onAddNew && onAddNew(v); onChange(v); }
  setAdding(false); setNewVal("");
 };
 if (adding) return (
  <div style={{ display:"flex", gap:5, alignItems:"center" }}>
   <input autoFocus value={newVal} onChange={e=>setNewVal(e.target.value)}
    onKeyDown={e=>{ if(e.key==="Enter") commit(); if(e.key==="Escape"){ setAdding(false); setNewVal(""); } }}
    placeholder="Type & press Enter…" style={{ ...IS, flex:1, padding:pad, fontSize:fsz }}/>
   <button onClick={commit} style={{ background:"#1A6B8A",color:"#fff",border:"none",borderRadius:7,padding:pad,fontSize:fsz,cursor:"pointer",whiteSpace:"nowrap",fontWeight:600 }}>+ Add</button>
   <button onClick={()=>{ setAdding(false); setNewVal(""); }} style={{ background:"#F1F5F9",color:"#64748B",border:"none",borderRadius:7,padding:pad,fontSize:fsz,cursor:"pointer" }}>✕</button>
  </div>
 );
 if (loading) return <select disabled style={{ ...IS, padding:pad, fontSize:fsz, ...style, opacity:.6 }}><option>Loading…</option></select>;
 const allOpts = value && !options.includes(value) ? [value, ...options] : options;
 return (
  <select value={value||""} onChange={e=>{ if(e.target.value==="__add_new__") setAdding(true); else onChange(e.target.value); }}
   style={{ ...IS, padding:pad, fontSize:fsz, ...style }}>
   <option value="">{options.length === 0 ? "— No data (run seed_reference.sql) —" : placeholder}</option>
   {allOpts.map(o=><option key={o} value={o}>{o}</option>)}
   <option value="__add_new__">+ Add new…</option>
  </select>
 );
};
const AddNewInline = ({ placeholder, onAdd, color="#1A6B8A" }) => {
 const [val, setVal] = useState("");
 const commit = () => { if (val.trim()) { onAdd(val.trim()); setVal(""); } };
 return (
  <div style={{ display:"flex", gap:6, marginTop:8 }}>
   <input value={val} onChange={e=>setVal(e.target.value)}
    onKeyDown={e=>{ if(e.key==="Enter") commit(); }}
    placeholder={placeholder}
    style={{ ...IS, flex:1, padding:"5px 8px", fontSize:11 }}/>
   <button onClick={commit}
    style={{ background:color, color:"#fff", border:"none", borderRadius:7, padding:"5px 10px", fontSize:11, cursor:"pointer", fontWeight:600, whiteSpace:"nowrap" }}>
    + Add
   </button>
  </div>
 );
};
const Btn = ({ children, onClick, v="primary", icon, s, disabled, spin }) => {
 const VS = { primary:{background:"linear-gradient(135deg,#1A6B8A,#0D4D6B)",color:"#0F172A",border:"none"}, secondary:{background:"transparent",color:"#4FC3F7",border:"1px solid #D5E1EE"}, success:{background:"linear-gradient(135deg,#2E7D32,#1B5E20)",color:"#0F172A",border:"none"}, ghost:{background:"transparent",color:"#64748B",border:"none"}, danger:{background:"linear-gradient(135deg,#b71c1c,#7f0000)",color:"#0F172A",border:"none"} };
 return (
 <button onClick={onClick} disabled={disabled||spin} style={{...VS[v],padding:"8px 16px",borderRadius:8,cursor:(disabled||spin)?"not-allowed":"pointer",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:5,fontFamily:"inherit",opacity:(disabled||spin)?.55:1,transition:"all .2s",...s}}>
 {spin ? <span style={{ display:"inline-block",width:12,height:12,border:"2px solid currentColor",borderTopColor:"transparent",borderRadius:"50%",animation:"spin .7s linear infinite" }}/> : icon ? <Icon name={icon} size={14}/> : null}
 {children}
 </button>
 );
};
// ─── PREVIEW TEMPLATES ────────────────────────────────────────────────────────
function genInvoiceHTML(inv, template, biz) {
  template = template||"Classic"; biz = biz||{};
  const cur = n => `${biz.currency_symbol||"₹"}${Number(n||0).toLocaleString(biz.currency_locale||"en-IN")}`;
  const taxName = biz.tax_name||"GST";
  const co = inv.company||biz.name||"Safarnaama Holidays";
  const addr = biz.address||"";
  const paidAmt = Number(inv.paid_amount||0);
  const total = Number(inv.total||0);
  const balDue = Math.max(0, total - paidAmt);
  const payStatus = balDue===0 && total>0 ? "PAID" : paidAmt>0 ? "PARTIALLY PAID" : "UNPAID";
  const payColor = balDue===0 && total>0 ? "#16a34a" : paidAmt>0 ? "#d97706" : "#dc2626";
  const catClr = {Hotel:"#1A6B8A",Flight:"#7c3aed",Transfer:"#0891b2",Visa:"#9333ea",Activity:"#d97706",Meal:"#16a34a",Insurance:"#6b7280"};
  const badge = cat => { if(!cat) return ""; const c=catClr[cat]||"#64748b"; return `<span style="background:${c}18;color:${c};border-radius:3px;padding:1px 6px;font-size:10px;font-weight:700;margin-right:6px">${cat}</span>`; };
  const rows = (inv.items||[]).map(it => {
    const d=it.desc||it.description||""; const cat=it.category||""; const a=cur(it.amount);
    const qty=Number(it.qty||1); const qstr=qty>1?` <span style="font-size:10px;color:#94a3b8">×${qty}</span>`:"";
    if(template==="Minimal") return `<tr><td style="padding:6px 8px;font-size:10px;color:${catClr[cat]||"#64748b"}">${cat?`[${cat}] `:""}<span style="color:#111;font-size:13px">${d}</span>${qstr}</td><td style="padding:6px 8px;text-align:right">${a}</td></tr>`;
    if(template==="Modern")  return `<tr><td style="padding:10px 12px;border-bottom:1px solid #f0f4f8">${badge(cat)}<span>${d}</span>${qstr}</td><td style="padding:10px 12px;border-bottom:1px solid #f0f4f8;text-align:right;font-weight:600;color:#2563eb">${a}</td></tr>`;
    return `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${badge(cat)}<span>${d}</span>${qstr}</td><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${a}</td></tr>`;
  }).join("");
  const pmtHistRows = (inv.payments||[]).map(p=>`<tr><td style="padding:5px 8px;font-size:12px">${p.date||""}</td><td style="padding:5px 8px;font-size:12px">${p.method||""}</td><td style="padding:5px 8px;font-size:12px;color:#64748b">${p.ref||p.note||""}</td><td style="padding:5px 8px;font-size:12px;text-align:right;color:#16a34a;font-weight:600">${cur(p.amount)}</td></tr>`).join("");
  const discRow = Number(inv.discount||0)>0 ? `<div class="trow" style="color:#d97706"><span>Discount (−)</span><span>${cur(inv.discount)}</span></div>` : "";
  const pd = biz.payment_details || {};
  const bankBlock = pd.account_number ? `<div style="margin-top:20px;padding:14px 16px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#1D4ED8;margin-bottom:10px">🏦 Bank Transfer Details</div><table style="width:100%;border-collapse:collapse;font-size:12px"><tr><td style="padding:4px 0;color:#64748B;width:44%;vertical-align:top">Account Name</td><td style="padding:4px 0;font-weight:700;color:#0F172A">${pd.account_name}</td></tr><tr><td style="padding:4px 0;color:#64748B;vertical-align:top">Bank Name</td><td style="padding:4px 0;font-weight:600;color:#0F172A">${pd.bank_name}</td></tr><tr><td style="padding:4px 0;color:#64748B;vertical-align:top">Branch</td><td style="padding:4px 0;font-size:11px;color:#374151">${pd.branch}</td></tr><tr><td style="padding:4px 0;color:#64748B;vertical-align:top">Account Number</td><td style="padding:4px 0;font-weight:800;color:#1D4ED8;font-size:14px;letter-spacing:2px">${pd.account_number}</td></tr><tr><td style="padding:4px 0;color:#64748B">IFSC Code</td><td style="padding:4px 0;font-weight:700;color:#0F172A;letter-spacing:1px">${pd.ifsc}</td></tr></table></div>` : "";
  const pmtSection = `<div style="margin-top:18px;border-top:1px dashed #e5e7eb;padding-top:14px">${pmtHistRows?`<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px">Payment History</div><table style="width:100%;border-collapse:collapse;margin-bottom:10px;background:#f9fafb;border-radius:6px;overflow:hidden"><thead><tr><th style="padding:5px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b">Date</th><th style="padding:5px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b">Method</th><th style="padding:5px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b">Ref / Note</th><th style="padding:5px 8px;text-align:right;font-size:10px;text-transform:uppercase;color:#64748b">Amount</th></tr></thead><tbody>${pmtHistRows}</tbody></table>`:""}<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span>Total Paid</span><span style="color:#16a34a;font-weight:600">${cur(paidAmt)}</span></div>${balDue>0?`<div style="display:flex;justify-content:space-between;padding:8px 12px;background:#fff2f2;border-radius:6px;margin-top:6px;font-size:15px;font-weight:700"><span style="color:#dc2626">Balance Due</span><span style="color:#dc2626">${cur(balDue)}</span></div>`:""}</div>`;
  if(template==="Classic") return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${inv.invoice_no||""}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Georgia,serif;background:#fff;color:#1a1a1a}.wrap{max-width:700px;margin:30px auto;padding:40px;border:1px solid #ccc}.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px double #1a1a1a;padding-bottom:20px;margin-bottom:24px}.co-name{font-size:22px;font-weight:bold;letter-spacing:1px}.co-sub{font-size:12px;color:#666;margin-top:4px}.inv-title{font-size:28px;color:#8B4513;text-align:right}.inv-meta{font-size:12px;text-align:right;margin-top:6px;color:#555}.pay-badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:8px;background:${payColor}18;color:${payColor}}.bill-row{display:flex;gap:40px;margin-bottom:24px;flex-wrap:wrap}.bill-box h4{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:6px}.bill-box p{font-size:14px}table{width:100%;border-collapse:collapse;margin-bottom:16px}th{background:#f5f0eb;padding:8px 10px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.5px}.totals{margin-left:auto;width:260px}.trow{display:flex;justify-content:space-between;padding:5px 0;font-size:14px}.trow.grand{font-weight:bold;font-size:17px;border-top:2px solid #1a1a1a;margin-top:6px;padding-top:8px}.footer{margin-top:30px;padding-top:16px;border-top:1px solid #ccc;font-size:11px;color:#888;text-align:center}</style></head><body><div class="wrap"><div class="hdr"><div><div class="co-name">${co}</div><div class="co-sub">${addr}</div></div><div><div class="inv-title">INVOICE</div><div class="inv-meta">${inv.invoice_no||""}<br>Date: ${inv.date||""}<br>Due: ${inv.due_date||inv.date||""}</div><div class="pay-badge">${payStatus}</div></div></div><div class="bill-row"><div class="bill-box"><h4>Billed To</h4><p><strong>${inv.lead_name||""}</strong><br>${inv.client_email||""}</p></div><div class="bill-box"><h4>Destination</h4><p>${inv.destination||""}</p></div>${inv.payment_terms?`<div class="bill-box"><h4>Payment Terms</h4><p>${inv.payment_terms}</p></div>`:""}</div><table><thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div class="trow"><span>Subtotal</span><span>${cur(inv.subtotal)}</span></div>${discRow}<div class="trow"><span>${taxName} (${inv.tax_rate||biz.tax_rate||5}%)</span><span>${cur(inv.gst)}</span></div><div class="trow grand"><span>Total</span><span>${cur(inv.total)}</span></div></div>${paidAmt>0?pmtSection:""}${bankBlock}${inv.notes?`<p style="margin-top:20px;font-size:13px;color:#555"><strong>Notes:</strong> ${inv.notes}</p>`:""}<div class="footer">Thank you for travelling with us!</div></div></body></html>`;
  if(template==="Modern") return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${inv.invoice_no||""}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8;color:#1e293b}.wrap{max-width:700px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}.hdr{background:linear-gradient(135deg,#1e40af,#2563eb);color:#fff;padding:32px 36px;display:flex;justify-content:space-between;align-items:center}.co-name{font-size:22px;font-weight:700}.co-sub{font-size:12px;opacity:.8;margin-top:4px}.inv-badge{background:rgba(255,255,255,.18);border-radius:10px;padding:12px 20px;text-align:right}.inv-badge .lbl{font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:1px}.inv-badge .val{font-size:18px;font-weight:700;margin-top:2px}.inv-badge .stat{display:inline-block;margin-top:7px;padding:2px 11px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(255,255,255,.25)}.body{padding:32px 36px}.meta-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:24px}.meta-item label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#64748b;display:block;margin-bottom:3px}.meta-item span{font-size:14px;font-weight:600}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#64748b}.totals{display:flex;justify-content:flex-end;margin-top:16px}.totals-box{width:280px;background:#f8fafc;border-radius:10px;padding:16px}.trow{display:flex;justify-content:space-between;padding:5px 0;font-size:14px}.trow.grand{font-weight:700;font-size:18px;color:#2563eb;border-top:2px solid #e2e8f0;margin-top:8px;padding-top:10px}.footer{background:#f8fafc;padding:16px 36px;text-align:center;font-size:12px;color:#94a3b8}</style></head><body><div class="wrap"><div class="hdr"><div><div class="co-name">${co}</div><div class="co-sub">${addr}</div></div><div class="inv-badge"><div class="lbl">Invoice</div><div class="val">${inv.invoice_no||""}</div><div class="stat">${payStatus}</div></div></div><div class="body"><div class="meta-grid"><div class="meta-item"><label>Billed To</label><span>${inv.lead_name||""}</span></div><div class="meta-item"><label>Date</label><span>${inv.date||""}</span></div><div class="meta-item"><label>Due Date</label><span>${inv.due_date||""}</span></div><div class="meta-item"><label>Destination</label><span>${inv.destination||""}</span></div>${inv.payment_terms?`<div class="meta-item"><label>Payment Terms</label><span>${inv.payment_terms}</span></div>`:""}${paidAmt>0?`<div class="meta-item"><label>Paid</label><span style="color:#16a34a">${cur(paidAmt)}</span></div>`:""}</div><table><thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div class="totals-box"><div class="trow"><span>Subtotal</span><span>${cur(inv.subtotal)}</span></div>${discRow}<div class="trow"><span>${taxName} (${inv.tax_rate||biz.tax_rate||5}%)</span><span>${cur(inv.gst)}</span></div><div class="trow grand"><span>Total</span><span>${cur(inv.total)}</span></div>${paidAmt>0?`<div class="trow" style="color:#16a34a"><span>Paid</span><span>− ${cur(paidAmt)}</span></div>`:""} ${balDue>0?`<div class="trow" style="color:#dc2626;font-weight:700;font-size:16px;border-top:1px solid #fee2e2;padding-top:8px;margin-top:4px"><span>Balance Due</span><span>${cur(balDue)}</span></div>`:""}</div></div>${paidAmt>0?pmtSection:""}${bankBlock}${inv.notes?`<p style="margin-top:20px;font-size:13px;color:#555"><strong>Notes:</strong> ${inv.notes}</p>`:""}</div><div class="footer">Thank you for travelling with us!</div></div></body></html>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${inv.invoice_no||""}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:40px}.hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid #111}.co{font-size:18px;font-weight:700}.inv-no{font-size:12px;color:#555;margin-top:3px}.status-badge{padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-top:6px;display:inline-block;background:${payColor}18;color:${payColor}}.to{margin-bottom:20px;font-size:14px}.to strong{display:block;margin-bottom:2px}table{width:100%;border-collapse:collapse;margin-bottom:12px}th{border-bottom:2px solid #111;padding:6px 8px;text-align:left;font-size:12px;text-transform:uppercase}td{padding:6px 8px;font-size:13px}.totals{text-align:right;margin-top:8px}.trow{display:flex;justify-content:flex-end;gap:60px;padding:3px 0;font-size:13px}.grand{font-weight:700;font-size:16px;border-top:1px solid #111;padding-top:6px;margin-top:4px}.bal{font-weight:700;font-size:15px;color:#dc2626;padding:6px 0}</style></head><body><div class="hdr"><div><div class="co">${co}</div><div class="inv-no">Invoice # ${inv.invoice_no||""} | ${inv.date||""} | Due: ${inv.due_date||""}</div></div><div class="status-badge">${payStatus}</div></div><div class="to"><strong>To: ${inv.lead_name||""}</strong>${inv.destination||""}${inv.payment_terms?`<br><small>Terms: ${inv.payment_terms}</small>`:""}</div><table><thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div class="trow"><span>Subtotal</span><span>${cur(inv.subtotal)}</span></div>${discRow}<div class="trow"><span>${taxName}</span><span>${cur(inv.gst)}</span></div><div class="trow grand"><span>Total</span><span>${cur(inv.total)}</span></div>${paidAmt>0?`<div class="trow" style="color:#16a34a"><span>Paid</span><span>− ${cur(paidAmt)}</span></div>`:""}</div>${balDue>0?`<div class="totals"><div class="trow bal"><span>Balance Due</span><span>${cur(balDue)}</span></div></div>`:""}${paidAmt>0?pmtSection:""}${bankBlock}${inv.notes?`<p style="margin-top:16px;font-size:12px;color:#666">Notes: ${inv.notes}</p>`:""}</body></html>`;
}

function genPackageVoucherHTML(v, template, biz) {
  template = template||"Classic"; biz = biz||{};
  const co = v.company||biz.name||"Safarnaama Holidays";
  const ec = biz.emergency_contact||"+91-9999999999";
  const brand = "#0D2030";
  const travelDate = v.travel_date||"";
  const returnDate = v.return_date||"";
  const guestStr = [v.adults||v.pax?(v.adults||v.pax)+" Adults":"", v.kids&&+v.kids>0?v.kids+" Children":""].filter(Boolean).join(" + ");
  const makeTbl = rows => `<table style="width:100%;border-collapse:collapse">${rows.filter(([,val])=>val).map(([k,val])=>`<tr><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;color:#64748b;width:40%">${k}</td><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#111">${val}</td></tr>`).join("")}</table>`;
  const makeSection = (icon, title, content, bg) => content ? `<div style="margin-bottom:14px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden"><div style="background:${bg};padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${brand};border-bottom:1px solid #e5e7eb">${icon} ${title}</div>${content}</div>` : "";
  const inclArr = v.inclusions||[];
  const exclArr = v.exclusions||[];
  let sectionsHTML = "";
  if (v.hotel) sectionsHTML += makeSection("🏨","Accommodation", makeTbl([["Hotel",v.hotel],["Room Type",v.room_type],["Meal Plan",v.meal_plan],["Check-In",travelDate],["Check-Out",returnDate]]), "#f0f9ff");
  if (v.airline||v.flight_no) sectionsHTML += makeSection("✈️","Flight", makeTbl([["Airline",v.airline],["Flight No",v.flight_no],["PNR",v.pnr],["Route",v.from&&v.to?`${v.from} → ${v.to}`:""],["Date",travelDate],["Class",v.travel_class]]), "#f5f3ff");
  if (v.vehicle_type||v.pickup_from) sectionsHTML += makeSection("🚗","Transfers", makeTbl([["Vehicle",v.vehicle_type],["Pickup From",v.pickup_from],["Drop To",v.drop_to]]), "#ecfeff");
  if (v.activities) sectionsHTML += makeSection("🎯","Activities", `<div style="padding:10px 12px;font-size:13px;color:#374151">${v.activities}</div>`, "#fffbeb");
  let inclExcl = "";
  if (inclArr.length>0) inclExcl += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#16a34a;margin-bottom:5px">✅ Inclusions</div>${inclArr.map(i=>`<div style="font-size:13px;color:#374151;padding:2px 0">✓ ${i}</div>`).join("")}</div>`;
  if (exclArr.length>0) inclExcl += `<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#d97706;margin-bottom:5px">❌ Exclusions</div>${exclArr.map(i=>`<div style="font-size:13px;color:#374151;padding:2px 0">✗ ${i}</div>`).join("")}</div>`;
  if (inclExcl) sectionsHTML += makeSection("📋","Package Terms", `<div style="padding:12px">${inclExcl}</div>`, "#f0fdf4");
  const notesHTML = v.special_notes?`<p style="margin-top:12px;font-size:12px;color:#555;padding:10px 12px;background:#f9fafb;border-radius:6px;border-left:3px solid ${brand}"><strong>Notes:</strong> ${v.special_notes}</p>`:"";
  const summaryFields = [["Guest",v.client_name],["Destination",v.destination],["Duration",v.duration],["Travel Date",travelDate],["Return Date",returnDate],["Guests",guestStr]].filter(([,val])=>val);
  const summaryGrid = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px;border-top:1px solid rgba(255,255,255,.2);padding-top:12px">${summaryFields.map(([l,val])=>`<div><div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:.7">${l}</div><div style="font-size:12px;font-weight:600;margin-top:2px">${val}</div></div>`).join("")}</div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Package Voucher ${v.voucher_no||""}</title></head><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#fff;color:#222"><div style="max-width:680px;margin:30px auto;border:2px solid ${brand};border-radius:4px;overflow:hidden"><div style="background:${brand};color:#fff;padding:20px 28px"><div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:20px;font-weight:700">${co}</div><div style="font-size:12px;font-weight:700;background:rgba(255,255,255,.15);padding:5px 14px;border-radius:20px">📦 PACKAGE VOUCHER</div></div>${summaryGrid}<div style="font-size:10px;opacity:.6;margin-top:8px">Voucher # ${v.voucher_no||""}</div></div><div style="padding:22px 28px">${sectionsHTML}${notesHTML}</div><div style="background:#f0f9ff;padding:11px 28px;font-size:11px;color:#666;border-top:1px solid #e0e7ef;text-align:center">Issued by ${co} | Emergency: ${ec}</div></div></body></html>`;
}
function genTypedVoucherHTML(v, vtype, template, biz) {
  if (vtype==="Package") return genPackageVoucherHTML(v, template, biz);
  template = template||"Classic"; biz = biz||{};
  const co = v.company||biz.name||"Safarnaama Holidays";
  const ec = biz.emergency_contact||"+91-9999999999";
  const typeColor = {Flight:"#7c3aed",Transfer:"#0891b2",Activity:"#d97706"}[vtype]||"#64748b";
  const typeLabel = {Flight:"FLIGHT VOUCHER",Transfer:"TRANSFER VOUCHER",Activity:"ACTIVITY VOUCHER"}[vtype]||"TRAVEL VOUCHER";
  const chk = v.check_in||v.travel_date||"";
  const guests = `${v.adults||v.pax||""}${(v.adults||v.pax)?" Adults":""}${v.kids?" + "+v.kids+" Kids":""}`;
  let mainSec="", rows=[];
  if (vtype==="Flight") {
    mainSec=`<div style="background:#f3f0ff;border-left:4px solid ${typeColor};padding:14px 16px;border-radius:0 6px 6px 0;margin-bottom:16px"><div style="font-size:18px;color:${typeColor};font-weight:700">${v.airline||""} ${v.flight_no||""}</div><div style="font-size:13px;color:#555">${v.from||""} → ${v.to||""}</div></div>`;
    rows=[["Passenger(s)",v.passengers||v.client_name],["Airline",v.airline],["Flight / PNR",`${v.flight_no||""}${v.pnr?` | PNR: ${v.pnr}`:""}`],["Route",v.from&&v.to?`${v.from} → ${v.to}`:""],["Date",chk],["Class",v.travel_class||v.class],["Baggage",v.baggage]].filter(([,val])=>val);
  } else if (vtype==="Transfer") {
    mainSec=`<div style="background:#ecfeff;border-left:4px solid ${typeColor};padding:14px 16px;border-radius:0 6px 6px 0;margin-bottom:16px"><div style="font-size:18px;color:${typeColor};font-weight:700">🚗 ${v.vehicle_type||"Transfer"}</div><div style="font-size:13px;color:#555">${v.pickup_from||v.from||""} → ${v.drop_to||v.to||""}</div></div>`;
    rows=[["Guest",v.client_name],["Pickup From",v.pickup_from||v.from],["Drop To",v.drop_to||v.to],["Date",chk],["Pickup Time",v.pickup_time],["Vehicle",v.vehicle_type],["Driver",v.driver_name],["Driver Contact",v.driver_contact],["Guests",guests]].filter(([,val])=>val);
  } else {
    mainSec=`<div style="background:#fffbeb;border-left:4px solid ${typeColor};padding:14px 16px;border-radius:0 6px 6px 0;margin-bottom:16px"><div style="font-size:18px;color:${typeColor};font-weight:700">🎯 ${v.activity_name||"Activity"}</div><div style="font-size:13px;color:#555">${v.destination||""}</div></div>`;
    rows=[["Guest",v.client_name],["Activity",v.activity_name],["Destination",v.destination],["Date",chk],["Time",v.activity_time],["Meeting Point",v.meeting_point],["Operator",v.operator],["Contact",v.operator_contact],["Guests",guests]].filter(([,val])=>val);
  }
  const rowsHTML = rows.map(([k,val])=>`<tr><td>${k}</td><td>${val}</td></tr>`).join("")+((v.inclusions||[]).length>0?`<tr><td style="vertical-align:top">Inclusions</td><td>${(v.inclusions||[]).map(i=>`✓ ${i}`).join("<br>")}</td></tr>`:"");
  const notesHTML = v.special_notes?`<p style="margin-top:10px;font-size:12px;color:#555"><strong>Notes:</strong> ${v.special_notes}</p>`:"";
  if (template==="Modern") return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Voucher ${v.voucher_no||""}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8}.wrap{max-width:680px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}.hdr{background:${typeColor};color:#fff;padding:28px 32px;display:flex;justify-content:space-between;align-items:center}.co-name{font-size:20px;font-weight:700}.type-badge{background:rgba(255,255,255,.2);border-radius:20px;padding:6px 16px;font-size:12px;font-weight:600}.body{padding:28px 32px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}.field{background:#f9fafb;border-radius:8px;padding:12px 14px}.field label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;display:block;margin-bottom:4px}.field span{font-size:14px;font-weight:600;color:#111827}.footer{background:#f9fafb;padding:14px 32px;text-align:center;font-size:12px;color:#9ca3af}</style></head><body><div class="wrap"><div class="hdr"><div><div class="co-name">${co}</div><div style="font-size:12px;opacity:.8;margin-top:4px">Voucher # ${v.voucher_no||""}</div></div><div class="type-badge">${typeLabel}</div></div><div class="body">${mainSec}<div class="grid">${rows.map(([k,val])=>`<div class="field"><label>${k}</label><span>${val}</span></div>`).join("")}</div>${notesHTML}</div><div class="footer">${co} | ${ec}</div></div></body></html>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Voucher ${v.voucher_no||""}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#fff;color:#222}.wrap{max-width:680px;margin:30px auto;border:2px solid ${typeColor};border-radius:4px;overflow:hidden}.hdr{background:${typeColor};color:#fff;padding:20px 28px;display:flex;justify-content:space-between;align-items:center}.co-name{font-size:20px;font-weight:700}.vno{font-size:12px;opacity:.8;margin-top:4px}.type-label{font-size:14px;font-weight:700}.body{padding:24px 28px}.tbl{width:100%;border-collapse:collapse;margin-bottom:14px}.tbl td{padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:14px}.tbl td:first-child{font-weight:600;color:#555;width:42%}.footer{background:#f0f9ff;padding:12px 28px;font-size:11px;color:#666;border-top:1px solid #e0e7ef;text-align:center}</style></head><body><div class="wrap"><div class="hdr"><div><div class="co-name">${co}</div><div class="vno">${v.voucher_no||""}</div></div><div class="type-label">${typeLabel}</div></div><div class="body">${mainSec}<table class="tbl"><tbody>${rowsHTML}</tbody></table>${notesHTML}</div><div class="footer">Issued by ${co} | Emergency: ${ec}</div></div></body></html>`;
}
function genVoucherHTML(v, template, biz) {
  const vtype = v.voucher_type||"Hotel";
  if (vtype !== "Hotel") return genTypedVoucherHTML(v, vtype, template, biz);
  template = template||"Classic"; biz = biz||{};
  const co = v.company||biz.name||"Safarnaama Holidays";
  const ec = biz.emergency_contact||"+91-9999999999";
  const chk = v.check_in||v.travel_date||"";
  const chkout = v.check_out||v.return_date||"";
  const guests = `${v.pax||v.adults||""}${(v.pax||v.adults)?" Adults":""}${v.kids?" + "+v.kids+" Children":""}`;
  if (template==="Luxury") return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Voucher ${v.voucher_no||""}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Georgia,serif;background:#0a0a0a;color:#f0e6c8;min-height:100vh}.outer{max-width:680px;margin:30px auto;border:1px solid #8B6914;background:#1a1408;border-radius:4px;overflow:hidden}.gold-bar{height:4px;background:linear-gradient(90deg,#8B6914,#D4AF37,#8B6914)}.hdr{padding:32px 36px;text-align:center;border-bottom:1px solid #3a2e1a}.co-name{font-size:26px;letter-spacing:4px;color:#D4AF37;margin-bottom:4px}.tagline{font-size:11px;letter-spacing:2px;color:#8B6914;text-transform:uppercase}.badge{display:inline-block;border:1px solid #8B6914;padding:8px 28px;margin:16px auto;font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#D4AF37}.body{padding:28px 36px}.voucher-no{text-align:center;font-size:12px;letter-spacing:2px;color:#8B6914;margin-bottom:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}.field label{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#8B6914;display:block;margin-bottom:4px}.field span{font-size:15px;color:#f0e6c8}hr{border:none;border-top:1px solid #3a2e1a;margin:20px 0}.hotel-name{text-align:center;font-size:20px;color:#D4AF37;margin-bottom:16px}.footer{text-align:center;padding:16px 36px;font-size:10px;letter-spacing:1px;color:#5a4a2a;border-top:1px solid #3a2e1a}</style></head><body><div class="outer"><div class="gold-bar"></div><div class="hdr"><div class="co-name">${co.toUpperCase()}</div><div class="tagline">Luxury Travel Experiences</div><div class="badge">Hotel Voucher</div></div><div class="body"><div class="voucher-no">Voucher No: ${v.voucher_no||""}</div><div class="hotel-name">${v.hotel||""}</div><div class="grid"><div class="field"><label>Guest Name</label><span>${v.client_name||""}</span></div><div class="field"><label>Destination</label><span>${v.destination||""}</span></div><div class="field"><label>Check-In</label><span>${chk}</span></div><div class="field"><label>Check-Out</label><span>${chkout}</span></div><div class="field"><label>Room Type</label><span>${v.room_type||""}</span></div><div class="field"><label>Meal Plan</label><span>${v.meal_plan||""}</span></div><div class="field"><label>Guests</label><span>${guests}</span></div><div class="field"><label>Booking Ref</label><span>${v.booking_ref||v.voucher_no||""}</span></div></div><hr>${v.special_requests?`<div class="field"><label>Special Requests</label><span>${v.special_requests}</span></div>`:""}</div><div class="footer">Issued by ${co} | ${ec}</div><div class="gold-bar"></div></div></body></html>`;
  if (template==="Modern") return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Voucher ${v.voucher_no||""}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8}.wrap{max-width:680px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}.hdr{background:linear-gradient(135deg,#059669,#10b981);color:#fff;padding:28px 32px;display:flex;justify-content:space-between;align-items:center}.co-name{font-size:20px;font-weight:700}.type-badge{background:rgba(255,255,255,.2);border-radius:20px;padding:6px 16px;font-size:12px;font-weight:600}.body{padding:28px 32px}.hotel-card{background:#f0fdf4;border-left:4px solid #10b981;padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:20px}.hotel-card h3{font-size:18px;color:#065f46;margin-bottom:4px}.hotel-card p{font-size:13px;color:#374151}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}.field{background:#f9fafb;border-radius:8px;padding:12px 14px}.field label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;display:block;margin-bottom:4px}.field span{font-size:14px;font-weight:600;color:#111827}.footer{background:#f9fafb;padding:14px 32px;text-align:center;font-size:12px;color:#9ca3af}</style></head><body><div class="wrap"><div class="hdr"><div><div class="co-name">${co}</div><div style="font-size:12px;opacity:.8;margin-top:4px">Voucher # ${v.voucher_no||""}</div></div><div class="type-badge">Hotel Voucher</div></div><div class="body"><div class="hotel-card"><h3>${v.hotel||""}</h3><p>${v.destination||""}</p></div><div class="grid"><div class="field"><label>Guest</label><span>${v.client_name||""}</span></div><div class="field"><label>Guests</label><span>${guests}</span></div><div class="field"><label>Check-In</label><span>${chk}</span></div><div class="field"><label>Check-Out</label><span>${chkout}</span></div><div class="field"><label>Room Type</label><span>${v.room_type||""}</span></div><div class="field"><label>Meal Plan</label><span>${v.meal_plan||""}</span></div></div>${v.special_requests?`<p style="font-size:13px;color:#555"><strong>Special Requests:</strong> ${v.special_requests}</p>`:""}</div><div class="footer">${co} | ${ec}</div></div></body></html>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Voucher ${v.voucher_no||""}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#fff;color:#222}.wrap{max-width:680px;margin:30px auto;border:2px solid #1A6B8A;border-radius:4px;overflow:hidden}.hdr{background:#1A6B8A;color:#fff;padding:20px 28px;display:flex;justify-content:space-between;align-items:center}.co-name{font-size:20px;font-weight:700}.vno{font-size:12px;opacity:.8;margin-top:4px}.type-label{font-size:14px;font-weight:700;text-align:right}.body{padding:24px 28px}.hotel-section{background:#e8f4f8;border-radius:6px;padding:14px 16px;margin-bottom:20px;border-left:4px solid #1A6B8A}.hotel-section h3{font-size:18px;color:#1A6B8A;margin-bottom:4px}.hotel-section p{font-size:13px;color:#555}.tbl{width:100%;border-collapse:collapse;margin-bottom:14px}.tbl td{padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:14px}.tbl td:first-child{font-weight:600;color:#555;width:42%}.footer{background:#f0f9ff;padding:12px 28px;font-size:11px;color:#666;border-top:1px solid #e0e7ef;text-align:center}</style></head><body><div class="wrap"><div class="hdr"><div><div class="co-name">${co}</div><div class="vno">${v.voucher_no||""}</div></div><div class="type-label">HOTEL VOUCHER</div></div><div class="body"><div class="hotel-section"><h3>${v.hotel||""}</h3><p>${v.destination||""}</p></div><table class="tbl"><tr><td>Guest Name</td><td>${v.client_name||""}</td></tr><tr><td>Check-In</td><td>${chk}</td></tr><tr><td>Check-Out</td><td>${chkout}</td></tr><tr><td>Room Type</td><td>${v.room_type||""}</td></tr><tr><td>Meal Plan</td><td>${v.meal_plan||""}</td></tr><tr><td>Guests</td><td>${guests}</td></tr>${v.booking_ref?`<tr><td>Booking Ref</td><td>${v.booking_ref}</td></tr>`:""}${v.special_requests?`<tr><td>Special Requests</td><td>${v.special_requests}</td></tr>`:""}</table></div><div class="footer">Issued by ${co} | Emergency: ${ec}</div></div></body></html>`;
}

function genQuoteHTML(quote, template, biz) {
  template = template||"Professional"; biz = biz||{};
  const cur = n => `${biz.currency_symbol||"₹"}${Number(n||0).toLocaleString(biz.currency_locale||"en-IN")}`;
  const co = quote.company||biz.name||"Safarnaama Holidays";
  const ec = biz.emergency_contact||"";
  const svcs = (quote.services||[]).map(s => {
    const nm = (typeof s==="string"?s:s.name)||""; const pr = s.price?cur(s.price):"";
    if (template==="Brief")        return `<li style="padding:5px 0;border-bottom:1px solid #f0f0f0;font-size:14px">${nm}${pr?` <span style="float:right;font-weight:700">${pr}</span>`:""}</li>`;
    if (template==="Modern")       return `<li style="padding:10px 12px;border-bottom:1px solid #f0f4f8;display:flex;justify-content:space-between;font-size:14px"><span>${nm}</span>${pr?`<span style="font-weight:700;color:#2563eb">${pr}</span>`:""}</li>`;
    return `<li style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;display:flex;justify-content:space-between"><span>${nm}</span>${pr?`<span style="font-weight:700">${pr}</span>`:""}</li>`;
  }).join("")||"<li style='padding:8px;color:#9ca3af'>No services listed</li>";
  if (template==="Modern") return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Travel Quote</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8}.wrap{max-width:700px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}.hdr{background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:32px 36px}.co-name{font-size:22px;font-weight:700;margin-bottom:4px}.tagline{font-size:13px;opacity:.8}.body{padding:32px 36px}.quote-badge{display:inline-block;background:#f3e8ff;color:#7c3aed;border-radius:20px;padding:5px 16px;font-size:12px;font-weight:700;margin-bottom:16px}.hero{font-size:24px;font-weight:800;color:#1e293b;margin-bottom:6px}.meta{font-size:13px;color:#6b7280;margin-bottom:24px}.section-title{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;margin-bottom:10px;margin-top:20px}ul{list-style:none;border:1px solid #f0f4f8;border-radius:10px;overflow:hidden;margin-bottom:16px}.total-box{background:#f3e8ff;border-radius:10px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center}.total-box span:first-child{font-size:14px;color:#7c3aed;font-weight:600}.total-box span:last-child{font-size:22px;font-weight:800;color:#7c3aed}.incl{background:#f0fdf4;border-radius:10px;padding:16px 20px;margin-top:14px}.incl h4{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#059669;margin-bottom:8px}.incl p{font-size:13px;color:#374151;white-space:pre-wrap}.footer{background:#f9fafb;padding:16px 36px;text-align:center;font-size:12px;color:#9ca3af}</style></head><body><div class="wrap"><div class="hdr"><div class="co-name">${co}</div><div class="tagline">Your journey, our passion</div></div><div class="body"><span class="quote-badge">Travel Quote</span><div class="hero">${quote.destination||quote.lead_name||""}</div><div class="meta">For: <strong>${quote.lead_name||""}</strong> | Travel: ${quote.travel_date||""} | ${quote.pax||""}${quote.pax?" Adults":""}</div><div class="section-title">Included Services</div><ul>${svcs}</ul>${quote.total_price?`<div class="total-box"><span>Total Package Price</span><span>${cur(quote.total_price)}</span></div>`:""}${quote.inclusions?`<div class="incl"><h4>Inclusions</h4><p>${quote.inclusions}</p></div>`:""}${quote.exclusions?`<div class="incl" style="background:#fff7ed"><h4 style="color:#d97706">Exclusions</h4><p>${quote.exclusions}</p></div>`:""}${quote.notes?`<p style="margin-top:16px;font-size:13px;color:#555">${quote.notes}</p>`:""}<p style="margin-top:20px;font-size:12px;color:#6b7280">Valid until: ${quote.valid_until||"30 days from issue"}</p></div><div class="footer">${co} | ${ec}</div></div></body></html>`;
  if (template==="Brief") return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quote</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#fff;padding:36px;color:#111}h1{font-size:20px;margin-bottom:4px}h2{font-size:15px;color:#444;font-weight:400;margin-bottom:20px}.meta{font-size:13px;color:#666;margin-bottom:16px}ul{list-style:none;margin-bottom:14px;padding:0}.total{font-size:17px;font-weight:700;margin-top:10px}.footer{margin-top:24px;font-size:11px;color:#aaa}</style></head><body><h1>${co}</h1><h2>Travel Quote — ${quote.destination||""}</h2><div class="meta">For: <strong>${quote.lead_name||""}</strong> | Travel: ${quote.travel_date||""}</div><ul>${svcs}</ul>${quote.total_price?`<div class="total">Total: ${cur(quote.total_price)}</div>`:""}${quote.inclusions?`<p style="margin-top:12px;font-size:13px"><strong>Inclusions:</strong> ${quote.inclusions}</p>`:""}${quote.notes?`<p style="margin-top:10px;font-size:13px">${quote.notes}</p>`:""}<div class="footer">Valid until: ${quote.valid_until||"30 days"} | ${ec}</div></body></html>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Travel Quote</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Georgia,serif;background:#fff;color:#1a1a1a}.wrap{max-width:700px;margin:30px auto;padding:40px;border:1px solid #ddd}.hdr{border-bottom:3px solid #1A6B8A;padding-bottom:18px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end}.co-name{font-size:22px;font-weight:bold;color:#1A6B8A}.doc-title{font-size:26px;color:#8B4513}.to-section{margin-bottom:20px;font-size:14px;line-height:1.6}.to-section strong{font-size:16px;display:block;margin-bottom:2px}ul{list-style:none;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;margin-bottom:16px;padding:0}.total-row{display:flex;justify-content:flex-end;font-size:18px;font-weight:bold;color:#1A6B8A;padding:10px 0;border-top:2px solid #1A6B8A}.incl-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;padding:14px 16px;margin-bottom:14px}.incl-box h4{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#0369a1;margin-bottom:6px}.incl-box p{font-size:13px;color:#374151;white-space:pre-wrap}.footer{margin-top:30px;padding-top:16px;border-top:1px solid #ddd;font-size:11px;color:#888;text-align:center}</style></head><body><div class="wrap"><div class="hdr"><div class="co-name">${co}</div><div class="doc-title">TRAVEL QUOTE</div></div><div class="to-section"><strong>${quote.lead_name||""}</strong>Destination: ${quote.destination||""}<br>Travel Date: ${quote.travel_date||""} | Guests: ${quote.pax||""}${quote.kids?" + "+quote.kids+" children":""}</div><ul>${svcs}</ul>${quote.total_price?`<div class="total-row">Total: ${cur(quote.total_price)}</div>`:""}${quote.inclusions?`<div class="incl-box"><h4>Inclusions</h4><p>${quote.inclusions}</p></div>`:""}${quote.exclusions?`<div class="incl-box" style="background:#fff7ed;border-color:#fed7aa"><h4 style="color:#d97706">Exclusions</h4><p>${quote.exclusions}</p></div>`:""}${quote.notes?`<p style="margin-top:14px;font-size:13px;color:#555">${quote.notes}</p>`:""}<p style="margin-top:14px;font-size:12px;color:#888">Quote valid until: ${quote.valid_until||"30 days from date of issue"}</p><div class="footer">${co} | ${ec}</div></div></body></html>`;
}

// Compress an image data-URL to ≤maxWidth px wide at the given quality.
// Used before embedding large cover photos in print HTML so Chrome's print
// renderer doesn't hit its memory/canvas limits and silently drop the image.
function compressImgForPrint(dataUrl, maxWidth = 1100, quality = 0.82) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return Promise.resolve(dataUrl);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxWidth / (img.naturalWidth || maxWidth));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round((img.naturalWidth  || maxWidth) * ratio);
        canvas.height = Math.round((img.naturalHeight || 600)      * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Upload a base64 image to backend temp store → returns a hosted URL email clients can fetch
async function uploadTempImg(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return "";
  const [, contentType, b64] = match;
  try {
    const r = await fetch("/api/temp-img", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ data: b64, contentType }) });
    if (!r.ok) return "";
    const j = await r.json();
    return j.url || "";
  } catch { return ""; }
}

function genItinHTML(it, template, biz, profile) {
  template = template||"Classic"; biz = biz||{}; profile = profile||{};
  const co = {
    name:      profile.name      || "Safarnaama Holidays",
    logo:      profile.logo      || "",
    color:     profile.primaryColor || "#1A6B8A",
    tagline:   profile.tagline   || "",
    email:     profile.email     || "",
    phone:     [profile.phone1, profile.phone2].filter(Boolean).join(" | "),
    address:   profile.address   || "",
    website:   profile.website   || "",
    instagram: profile.instagram || "",
    facebook:  profile.facebook  || "",
    whatsapp:  profile.whatsapp  || "",
    emergency: biz.emergency_contact || "",
  };
  const normArr = v => Array.isArray(v) ? v : (v && typeof v==="object" ? Object.values(v).flat() : []);
  const itDays     = normArr(it.days);
  const itFlights  = normArr(it.flights);
  const itHotels   = normArr(it.hotels);
  const itO2Hotels = normArr(it.option2_hotels);
  const pc = co.color;
  const o1title = it.option1_title || "Standard Package";
  const o2title = it.option2_title || "Luxury Package";
  const realUrl = v => (v && v.length > 0) ? v : "";
  const roomDesc = h => (h.rooms && h.rooms.length > 0)
    ? h.rooms.map(r => [r.num_rooms>1?r.num_rooms+"×":"", r.room_type, r.bedding].filter(Boolean).join(" ")).join(" | ")
    : (h.room_type || "Standard");

  // Flights rows (shared by both templates)
  const flightRows = itFlights.map(f => `<tr><td>${f.airline||""} ${f.flight_no||""}</td><td>${f.from||""} → ${f.to||""}</td><td>${f.date||""}</td><td>${f.class||""}</td></tr>`).join("");

  // Bank block (shared by both templates)
  const ipd = biz.payment_details || {};
  const itinBankBlock = ipd.account_number ? `<div style="margin:18px 0;padding:14px 16px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#1D4ED8;margin-bottom:10px">🏦 Bank Transfer Details</div><table style="width:100%;border-collapse:collapse;font-size:12px"><tr><td style="padding:4px 0;color:#64748B;width:44%;vertical-align:top">Account Name</td><td style="padding:4px 0;font-weight:700;color:#0F172A">${ipd.account_name}</td></tr><tr><td style="padding:4px 0;color:#64748B;vertical-align:top">Bank Name</td><td style="padding:4px 0;font-weight:600;color:#0F172A">${ipd.bank_name}</td></tr><tr><td style="padding:4px 0;color:#64748B;vertical-align:top">Branch</td><td style="padding:4px 0;font-size:11px;color:#374151">${ipd.branch}</td></tr><tr><td style="padding:4px 0;color:#64748B;vertical-align:top">Account Number</td><td style="padding:4px 0;font-weight:800;color:#1D4ED8;font-size:14px;letter-spacing:2px">${ipd.account_number}</td></tr><tr><td style="padding:4px 0;color:#64748B">IFSC Code</td><td style="padding:4px 0;font-weight:700;color:#0F172A;letter-spacing:1px">${ipd.ifsc}</td></tr></table></div>` : "";

  // Compact template
  if (template==="Compact") {
    const hotelRowsC = h => `<tr><td><strong>${h.name||""}</strong></td><td>${h.destination||""}</td><td>${h.check_in||""} – ${h.check_out||""}</td><td>${h.nights||""} N</td><td style="font-size:10px">${roomDesc(h)}</td><td>${h.meals||""}</td></tr>`;
    const hotelRowsCompactStr = (hotels) => hotels.map(h => `<div style="padding:5px 0;border-bottom:1px solid #f0f0f0;font-size:11px"><strong>${h.name||""}</strong>${h.destination?` · ${h.destination}`:""}<div style="color:#666;font-size:10px;margin-top:1px">${[h.nights?(h.nights+"N"):"", h.meals, roomDesc(h)].filter(Boolean).join(" · ")}</div></div>`).join("");
    const o2BoxC = !it.option2_enabled ? "" : `<h3>Packages</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px"><div style="border:1.5px solid ${pc};border-radius:8px;overflow:hidden"><div style="background:${pc};color:#fff;padding:8px 10px;text-align:center;font-size:11px;font-weight:700">${o1title}</div><div style="padding:8px 10px">${itHotels.length>0?"<div style='font-size:9px;font-weight:700;color:#555;margin-bottom:4px;text-transform:uppercase'>Hotels</div>"+hotelRowsCompactStr(itHotels):""}${(it.inclusions||[]).length>0?"<div style='font-size:9px;font-weight:700;color:#16a34a;margin:6px 0 3px;text-transform:uppercase'>Included</div>"+(it.inclusions||[]).map(i=>`<div style="font-size:10px;color:#166534;padding:1px 0">✔ ${i}</div>`).join(""):""}${(it.exclusions||[]).length>0?"<div style='font-size:9px;font-weight:700;color:#dc2626;margin:4px 0 3px;text-transform:uppercase'>Not Included</div>"+(it.exclusions||[]).map(e=>`<div style="font-size:10px;color:#9a3412;padding:1px 0">✘ ${e}</div>`).join(""):""}</div></div><div style="border:1.5px solid #D97706;border-radius:8px;overflow:hidden"><div style="background:#D97706;color:#fff;padding:8px 10px;text-align:center;font-size:11px;font-weight:700">${o2title}</div><div style="padding:8px 10px">${itO2Hotels.length>0?"<div style='font-size:9px;font-weight:700;color:#555;margin-bottom:4px;text-transform:uppercase'>Hotels</div>"+hotelRowsCompactStr(itO2Hotels):""}${(it.option2_inclusions||[]).length>0?"<div style='font-size:9px;font-weight:700;color:#16a34a;margin:6px 0 3px;text-transform:uppercase'>Included</div>"+(it.option2_inclusions||[]).map(i=>`<div style="font-size:10px;color:#166534;padding:1px 0">✔ ${i}</div>`).join(""):""}${(it.option2_exclusions||[]).length>0?"<div style='font-size:9px;font-weight:700;color:#dc2626;margin:4px 0 3px;text-transform:uppercase'>Not Included</div>"+(it.option2_exclusions||[]).map(e=>`<div style="font-size:10px;color:#9a3412;padding:1px 0">✘ ${e}</div>`).join(""):""}</div></div></div>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${it.title||"Itinerary"}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:28px}h1{font-size:17px;font-weight:700;margin-bottom:3px}.sub{font-size:12px;color:#555;margin-bottom:16px}.meta{font-size:11px;color:#666;margin-bottom:14px}h3{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:#374151;margin:14px 0 5px;font-weight:700}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px}th{text-align:left;padding:5px 8px;background:#f5f5f5;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#555}td{padding:5px 8px;border-bottom:1px solid #f0f0f0}.footer{margin-top:20px;font-size:10px;color:#aaa;border-top:1px solid #f0f0f0;padding-top:10px}</style></head><body><h1>${it.title||"Itinerary"}</h1><div class="sub">${co.name}${co.tagline?" — "+co.tagline:""}</div><div class="meta">📍 ${it.destination||""} &nbsp;|&nbsp; 📅 ${it.start_date||""}${it.end_date?" – "+it.end_date:""} &nbsp;|&nbsp; 👤 ${it.pax||""}${it.pax?" Adults":""}${it.kids?" + "+it.kids+" Kids":""}</div>${flightRows?`<h3>Flights</h3><table><thead><tr><th>Flight</th><th>Route</th><th>Date</th><th>Class</th></tr></thead><tbody>${flightRows}</tbody></table>`:""}${it.option2_enabled?o2BoxC:itHotels.length>0?`<h3>Hotels</h3><table><thead><tr><th>Hotel</th><th>Destination</th><th>Dates</th><th>Nights</th><th>Room</th><th>Meals</th></tr></thead><tbody>${itHotels.map(h=>hotelRowsC(h)).join("")}</tbody></table>`:""}${itDays.length>0?`<h3>Day by Day</h3>${itDays.map((d,i)=>{const ml=d.meals||{};const mStr=[ml.breakfast?"B":"",ml.lunch?"L":"",ml.dinner?"D":""].filter(Boolean).join("/");const trow=d.transfer?`<div style="font-size:10px;color:#0891b2;margin-top:3px">🚗 ${d.transfer}</div>`:"";return`<div style="margin-bottom:12px"><div style="background:#f5f7fa;padding:6px 10px;border-radius:5px;font-weight:700;font-size:12px;display:flex;justify-content:space-between"><span>Day ${d.day||i+1}${d.location?" — "+d.location:""}</span>${mStr?`<span style="font-size:10px;font-weight:400;color:#16a34a">${mStr}</span>`:""}</div>${normArr(d.activities).map(a=>`<div style="padding:4px 8px;border-left:2px solid #e2e8f0;margin-left:8px;margin-top:3px;font-size:11px"><strong>${a.title||""}</strong>${a.time?` (${a.time})`:""} ${a.desc?`<div style="color:#475569;margin-top:1px">${a.desc}</div>`:""}</div>`).join("")||""}${trow}</div>`}).join("")}`:""}${!it.option2_enabled&&(it.inclusions||[]).length>0?`<h3>Inclusions</h3><ul style="list-style:none;padding:0">${(it.inclusions||[]).map(i=>`<li style="padding:3px 0;font-size:11px;color:#166534">✓ ${i}</li>`).join("")}</ul>`:""}${!it.option2_enabled&&(it.exclusions||[]).length>0?`<h3>Exclusions</h3><ul style="list-style:none;padding:0">${(it.exclusions||[]).map(e=>`<li style="padding:3px 0;font-size:11px;color:#9a3412">✗ ${e}</li>`).join("")}</ul>`:""}${it.notes?`<div style="margin-top:12px;font-size:11px;color:#475569;background:#f8fafc;padding:10px 12px;border-radius:6px"><strong>Notes:</strong> ${it.notes}</div>`:""}${it.special_instructions?`<div style="margin-top:8px;font-size:11px;color:#1e40af;background:#EFF6FF;border-left:3px solid #1A6B8A;padding:10px 12px;border-radius:0 6px 6px 0;white-space:pre-wrap"><strong>Special Instructions:</strong><br/>${it.special_instructions}</div>`:""}${itinBankBlock}<div class="footer">${co.name}${co.phone?" | "+co.phone:""}${co.email?" | "+co.email:""}${co.address?"<br/>"+co.address:""}</div></body></html>`;
  }

  // Classic — rich layout: cover photo (user upload > Picsum seed fallback), hotel cards, day cards, full footer
  // Cover uses 100% inline styles so it renders correctly in email clients that strip <style> blocks
  const _destSeed = (it.destination||"travel").replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,24)||"travel";
  const coverUrl = realUrl(it.cover_image_url) || `https://picsum.photos/seed/${_destSeed}/780/220`;
  const _coverLogo = co.logo
    ? `<img src="${co.logo}" alt="logo" style="height:40px;object-fit:contain;margin-bottom:5px;display:block"/>`
    : `<div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px;margin-bottom:3px">${co.name}</div>`;
  const coverBlock = `<div style="position:relative;height:220px;overflow:hidden;background:${pc};font-family:'Segoe UI',Arial,sans-serif"><img src="${coverUrl}" alt="cover" style="position:absolute;top:0;left:0;width:100%;height:220px;object-fit:cover;display:block" onerror="this.style.display='none'"/><div style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(to bottom,rgba(0,0,0,.1),rgba(0,0,0,.65));display:flex;flex-direction:column;justify-content:flex-end;padding:20px 28px"><div style="margin-bottom:6px">${_coverLogo}</div><div style="font-size:22px;font-weight:800;color:#fff;line-height:1.2">${it.title||"Itinerary"}</div>${co.tagline?`<div style="font-size:12px;color:rgba(255,255,255,.8);margin-top:3px">${co.tagline}</div>`:""}</div></div>`;

  const hotelCard = h => {
    const img = realUrl(h.image_url);
    return `<div class="hotel-card">${img?`<img src="${img}" alt="${h.name||""}" class="hotel-img" onerror="this.style.display='none'"/>`:""}<div class="hotel-body"><div class="hotel-name">${h.rating?"★".repeat(Math.min(Number(h.rating)||4,5))+" ":""}${h.name||""}</div><div class="hotel-meta">📍 ${h.destination||""} &nbsp;·&nbsp; 🛏 ${roomDesc(h)} &nbsp;·&nbsp; 🍳 ${h.meals||"Breakfast"}</div><div style="display:flex;gap:14px;margin-top:6px"><div class="hotel-badge"><span class="badge-lbl">Check-in</span><strong>${h.check_in||"—"}</strong></div><div class="hotel-badge"><span class="badge-lbl">Check-out</span><strong>${h.check_out||"—"}</strong></div><div class="hotel-badge"><span class="badge-lbl">Nights</span><strong>${h.nights||"—"}</strong></div></div></div></div>`;
  };
  const hotelsBlock = (hotels, label) => hotels.length===0 ? "" : `<div class="section-title">${label}</div>${hotels.map(h => hotelCard(h)).join("")}`;

  const inclExclList = (items, color, tick) => items.length===0 ? "" : `<ul style="list-style:none;padding:0;margin:0">${items.map(i=>`<li style="padding:6px 12px;border-bottom:1px solid ${color==="green"?"#bbf7d0":"#fecaca"};font-size:12px;display:flex;align-items:flex-start"><span style="color:${color==="green"?"#16a34a":"#dc2626"};font-weight:700;margin-right:7px;flex-shrink:0">${tick}</span><span style="color:${color==="green"?"#166534":"#9a3412"}">${i}</span></li>`).join("")}</ul>`;

  const hotelRowsCompact = (hotels) => hotels.map(h => `<div style="padding:5px 0;border-bottom:1px solid #f0f4f8;font-size:11px"><strong>${h.name||""}</strong>${h.destination?` <span style="color:#94A3B8">· ${h.destination}</span>`:""}<div style="color:#64748B;font-size:10px;margin-top:1px">${[h.nights?(h.nights+"N"):"", h.meals, roomDesc(h)].filter(Boolean).join(" · ")}</div></div>`).join("");
  const option2Box = !it.option2_enabled ? "" : `<div class="section-title">Choose Your Package</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px"><div style="border:2px solid ${pc};border-radius:12px;overflow:hidden"><div style="background:${pc};color:#fff;padding:12px 14px;text-align:center"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:.85">Option 1</div><div style="font-size:15px;font-weight:900;margin-top:3px">${o1title}</div></div><div style="padding:12px 14px">${itHotels.length>0?"<div style='font-size:10px;font-weight:700;color:#64748B;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px'>Hotels</div>"+hotelRowsCompact(itHotels):""}${(it.inclusions||[]).length>0?"<div style='font-size:10px;font-weight:700;color:#16a34a;margin:8px 0 4px;text-transform:uppercase;letter-spacing:.5px'>Included</div>"+(it.inclusions||[]).map(i=>`<div style="font-size:11px;color:#166534;padding:2px 0">✔ ${i}</div>`).join(""):""}${(it.exclusions||[]).length>0?"<div style='font-size:10px;font-weight:700;color:#dc2626;margin:6px 0 4px;text-transform:uppercase;letter-spacing:.5px'>Not Included</div>"+(it.exclusions||[]).map(e=>`<div style="font-size:11px;color:#9a3412;padding:2px 0">✘ ${e}</div>`).join(""):""}</div></div><div style="border:2px solid #D97706;border-radius:12px;overflow:hidden"><div style="background:linear-gradient(135deg,#D97706,#92400E);color:#fff;padding:12px 14px;text-align:center"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:.85">Option 2</div><div style="font-size:15px;font-weight:900;margin-top:3px">${o2title}</div></div><div style="padding:12px 14px">${itO2Hotels.length>0?"<div style='font-size:10px;font-weight:700;color:#64748B;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px'>Hotels</div>"+hotelRowsCompact(itO2Hotels):""}${(it.option2_inclusions||[]).length>0?"<div style='font-size:10px;font-weight:700;color:#16a34a;margin:8px 0 4px;text-transform:uppercase;letter-spacing:.5px'>Included</div>"+(it.option2_inclusions||[]).map(i=>`<div style="font-size:11px;color:#166534;padding:2px 0">✔ ${i}</div>`).join(""):""}${(it.option2_exclusions||[]).length>0?"<div style='font-size:10px;font-weight:700;color:#dc2626;margin:6px 0 4px;text-transform:uppercase;letter-spacing:.5px'>Not Included</div>"+(it.option2_exclusions||[]).map(e=>`<div style="font-size:11px;color:#9a3412;padding:2px 0">✘ ${e}</div>`).join(""):""}</div></div></div>`;

  const socialFooter = [co.website?"🌐 "+co.website:"", co.instagram?"📷 "+co.instagram:"", co.facebook?"📘 "+co.facebook:"", co.whatsapp?"💬 "+co.whatsapp:""].filter(Boolean).join(" &nbsp;·&nbsp; ");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${it.title||"Itinerary"}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;color:#1e293b}.wrap{max-width:780px;margin:0 auto}.cover{position:relative;height:220px;overflow:hidden;background:${pc}}.cover-img{width:100%;height:100%;object-fit:cover;display:block}.cover-over{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.1),rgba(0,0,0,.6));display:flex;flex-direction:column;justify-content:flex-end;padding:20px 28px}.cover-title{font-size:22px;font-weight:800;color:#fff;line-height:1.2}.cover-sub{font-size:12px;color:rgba(255,255,255,.8);margin-top:3px}.cover-logo{margin-bottom:6px}.meta-bar{background:#fff;border-bottom:1px solid #e2e8f0;padding:11px 28px;display:flex;gap:22px;flex-wrap:wrap;font-size:12px;color:#475569}.meta-bar strong{color:#0f172a}.body{padding:22px 28px}.section-title{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin:18px 0 9px;font-weight:700}.hotel-card{background:#fff;border:1px solid #e2e8f0;border-radius:9px;margin-bottom:10px;overflow:hidden}.hotel-img{width:100%;height:150px;object-fit:cover;display:block}.hotel-body{padding:12px 14px}.hotel-name{font-size:14px;font-weight:700;color:#0f172a;margin-bottom:4px}.hotel-meta{font-size:11px;color:#64748b;margin-bottom:6px}.hotel-badge{display:inline-flex;flex-direction:column;align-items:center;background:#f0f4f8;border-radius:6px;padding:5px 10px;min-width:70px}.badge-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin-bottom:2px}.hotel-badge strong{font-size:12px;color:#0f172a}.day-card{background:#fff;border:1px solid #e2e8f0;border-radius:9px;margin-bottom:12px;overflow:hidden}.day-img{width:100%;height:140px;object-fit:cover;display:block}.day-header{background:#f0f4f8;padding:9px 14px;font-weight:700;font-size:13px;color:#0f172a;display:flex;justify-content:space-between;align-items:center}.day-body{padding:10px 14px}.act{padding:5px 8px;border-left:2px solid ${pc};margin-bottom:5px}.act-time{display:inline-block;background:#e8f4f8;border-radius:3px;padding:1px 5px;font-size:10px;color:${pc};margin-right:5px}.act-title{font-size:13px;font-weight:600}.act-desc{font-size:11px;color:#475569;margin-top:2px}table{width:100%;border-collapse:collapse;margin-bottom:10px;background:#fff;border-radius:8px;overflow:hidden}th{background:#f0f4f8;padding:8px 11px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748b}td{padding:8px 11px;border-bottom:1px solid #f0f4f8;font-size:12px}.incl-box{padding:0;background:#f0fdf4;border-radius:8px;overflow:hidden;border:1px solid #bbf7d0;margin-bottom:10px}.excl-box{padding:0;background:#fff7ed;border-radius:8px;overflow:hidden;border:1px solid #fecaca;margin-bottom:10px}.notes-box{background:#f8fafc;border-left:3px solid #e2e8f0;padding:12px 14px;border-radius:0 8px 8px 0;font-size:12px;color:#475569;margin-bottom:10px}.si-box{background:#EFF6FF;border-left:3px solid #1A6B8A;padding:12px 14px;border-radius:0 8px 8px 0;font-size:12px;color:#1e40af;margin-bottom:10px;white-space:pre-wrap}.footer-inner{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}.footer{background:#f0f4f8;padding:14px 28px;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.cover{height:220px!important;min-height:220px!important;page-break-inside:avoid;overflow:visible!important}.cover-img{position:absolute!important;top:0!important;left:0!important;width:100%!important;height:220px!important;object-fit:cover!important;display:block!important}.cover-over{position:absolute!important;inset:0!important}.hotel-card,.day-card{page-break-inside:avoid}}</style></head><body><div class="wrap">${coverBlock}<div class="meta-bar"><span>📍 <strong>${it.destination||""}</strong></span><span>📅 <strong>${it.start_date||""}${it.end_date?" – "+it.end_date:""}</strong></span><span>👤 <strong>${it.pax||""}${it.pax?" Adults":""}${it.kids?" + "+it.kids+" Kids":""}</strong></span>${it.status?`<span>🔖 <strong>${it.status}</strong></span>`:""}</div><div class="body">${itFlights.length>0?`<div class="section-title">Flights</div><table><thead><tr><th>Flight</th><th>Route</th><th>Date</th><th>Class</th></tr></thead><tbody>${flightRows}</tbody></table>`:""}${it.option2_enabled?option2Box:(itHotels.length>0?hotelsBlock(itHotels,"Accommodation"):"")}${it.option2_enabled&&itO2Hotels.length>0?hotelsBlock(itO2Hotels,"Accommodation — "+o2title):""}${itDays.length>0?`<div class="section-title">Day by Day</div>${itDays.map((d,i)=>{const ml=d.meals||{};const dayImg=realUrl(d.image_url);const mBadges=[ml.breakfast?`<span style="display:inline-block;width:17px;height:17px;border-radius:50%;background:#dcfce7;color:#16a34a;text-align:center;line-height:17px;font-size:9px;font-weight:700;margin-left:3px">B</span>`:"",ml.lunch?`<span style="display:inline-block;width:17px;height:17px;border-radius:50%;background:#dbeafe;color:#2563eb;text-align:center;line-height:17px;font-size:9px;font-weight:700;margin-left:3px">L</span>`:"",ml.dinner?`<span style="display:inline-block;width:17px;height:17px;border-radius:50%;background:#fef3c7;color:#d97706;text-align:center;line-height:17px;font-size:9px;font-weight:700;margin-left:3px">D</span>`:""].join("");const trow=d.transfer?`<div style="font-size:11px;color:#0891b2;background:#f0f9ff;border-radius:4px;padding:4px 8px;margin-top:5px">🚗 ${d.transfer}</div>`:"";return`<div class="day-card">${dayImg?`<img src="${dayImg}" alt="day ${d.day||i+1}" class="day-img" onerror="this.style.display='none'"/>`:""}<div class="day-header"><span>Day ${d.day||i+1}${d.location?" — "+d.location:""}</span><span>${mBadges}</span></div><div class="day-body">${normArr(d.activities).map(a=>`<div class="act"><span class="act-time">${a.time||""}</span><span class="act-title">${a.title||""}</span>${a.desc?`<div class="act-desc">${a.desc}</div>`:""}</div>`).join("")||"<div style='font-size:11px;color:#94a3b8'>No activities</div>"}${trow}</div></div>`;}).join("")}`:""}${!it.option2_enabled&&(it.inclusions||[]).length>0?`<div class="section-title">Inclusions</div><div class="incl-box">${inclExclList(it.inclusions||[],"green","✓")}</div>`:""}${!it.option2_enabled&&(it.exclusions||[]).length>0?`<div class="section-title">Exclusions</div><div class="excl-box">${inclExclList(it.exclusions||[],"red","✗")}</div>`:""}${it.notes?`<div class="section-title">Notes</div><div class="notes-box">${it.notes}</div>`:""}${it.special_instructions?`<div class="section-title">Special Instructions</div><div class="si-box">${it.special_instructions}</div>`:""}${itinBankBlock}</div><div class="footer"><div class="footer-inner">${co.logo?`<img src="${co.logo}" alt="logo" style="height:32px;object-fit:contain;flex-shrink:0"/>`:""}<div><div style="font-weight:700;color:#0f172a;font-size:12px">${co.name}</div>${co.phone?`<div style="margin-top:2px">📞 ${co.phone}</div>`:""}${co.email?`<div>✉ ${co.email}</div>`:""}${co.address?`<div style="margin-top:2px;font-size:10px;color:#94a3b8">📍 ${co.address}</div>`:""}${co.emergency?`<div style="margin-top:2px;font-size:10px">Emergency: ${co.emergency}</div>`:""}${socialFooter?`<div style="margin-top:4px;font-size:10px">${socialFooter}</div>`:""}</div></div></div></div></body></html>`;
}

function PreviewFrame({ html }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const doc = ref.current.contentDocument || ref.current.contentWindow?.document;
    if (doc) { doc.open(); doc.write(html); doc.close(); }
  }, [html]);
  return <iframe ref={ref} title="preview" style={{ width:"100%", height:560, border:"1px solid #e5e7eb", borderRadius:8, background:"#fff" }} />;
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
 const [email, setEmail] = useState("");
 const [password, setPassword] = useState("");
 const [newPassword, setNewPassword] = useState("");
 const [confirmPassword, setConfirmPassword] = useState("");
 const [err, setErr] = useState("");
 const [info, setInfo] = useState("");
 const [loading, setLoading] = useState(false);
 const [mode, setMode] = useState("login"); // "login" | "forgot" | "changePassword"
 const [pendingToken, setPendingToken] = useState(null);
 const [pendingUser, setPendingUser] = useState(null);

 const apiPost = async (endpoint, body) => {
  let res = await fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  if (!res.ok && (res.status === 0 || res.status === 404)) {
   res = await fetch(`${window.location.protocol}//${window.location.hostname}:3002${endpoint}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
 };

 const doLogin = async (e) => {
  e.preventDefault();
  if (!email || !password) return setErr("Email and password are required");
  setErr(""); setLoading(true);
  try {
   const data = await apiPost("/api/auth/login", { email: email.trim(), password });
   if (data.mustChangePassword) {
    // Logged in with temp password — must set a new permanent one
    setPendingToken(data.token);
    setPendingUser(data.user);
    setMode("changePassword");
   } else {
    onLogin(data.user, data.token);
   }
  } catch(e) { setErr(e.message); }
  setLoading(false);
 };

 const doForgotPassword = async (e) => {
  e.preventDefault();
  if (!email) return setErr("Enter your email address");
  setErr(""); setLoading(true);
  try {
   await apiPost("/api/auth/forgot-password", { email: email.trim() });
   setInfo("A temporary password has been sent to your email. Use it to log in, then you will be asked to set a new password.");
   setMode("login");
  } catch(e) { setErr(e.message); }
  setLoading(false);
 };

 const doChangePassword = async (e) => {
  e.preventDefault();
  if (!newPassword || newPassword.length < 8) return setErr("Password must be at least 8 characters");
  if (newPassword !== confirmPassword) return setErr("Passwords do not match");
  setErr(""); setLoading(true);
  try {
   await fetch("/api/auth/change-password", {
    method:"POST", headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${pendingToken}` },
    body: JSON.stringify({ newPassword })
   });
   onLogin(pendingUser, pendingToken);
  } catch(e) { setErr(e.message); }
  setLoading(false);
 };

 const inp = { width:"100%", padding:"11px 13px", border:"1.5px solid #E2E8F0", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
 const lbl = { display:"block", fontSize:11, fontWeight:700, color:"#475569", marginBottom:6, textTransform:"uppercase", letterSpacing:".5px" };

 return (
  <div style={{ minHeight:"100vh", background:"linear-gradient(145deg,#0D2030 0%,#1a3a5c 60%,#0D2030 100%)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
   <div style={{ background:"#fff", borderRadius:18, padding:"44px 40px", width:"100%", maxWidth:420, boxShadow:"0 30px 80px rgba(0,0,0,.45)" }}>
    <div style={{ textAlign:"center", marginBottom:28 }}>
     <div style={{ fontSize:40, marginBottom:10 }}>✈️</div>
     <h1 style={{ fontSize:24, fontWeight:800, color:"#0D2030", margin:0, letterSpacing:"-.3px" }}>Safarnaama CRM</h1>
     <p style={{ fontSize:13, color:"#94A3B8", marginTop:5 }}>Safarnaama Holidays — Internal Portal</p>
    </div>

    {info && <div style={{ background:"#F0FDF4", border:"1px solid #BBF7D0", borderRadius:8, padding:"10px 13px", fontSize:13, color:"#166534", marginBottom:16 }}>{info}</div>}

    {/* ── Login ── */}
    {mode === "login" && (
     <form onSubmit={doLogin}>
      <div style={{ marginBottom:16 }}>
       <label style={lbl}>Email</label>
       <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@safarnaamaholidays.com" required style={inp} autoFocus />
      </div>
      <div style={{ marginBottom:8 }}>
       <label style={lbl}>Password</label>
       <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required style={inp} />
      </div>
      <div style={{ textAlign:"right", marginBottom:18 }}>
       <span style={{ fontSize:12, color:"#0EA5E9", cursor:"pointer" }} onClick={() => { setErr(""); setInfo(""); setMode("forgot"); }}>Forgot password?</span>
      </div>
      {err && <div style={{ background:"#FEE2E2", border:"1px solid #FCA5A5", borderRadius:8, padding:"10px 13px", fontSize:13, color:"#DC2626", marginBottom:16 }}>{err}</div>}
      <button type="submit" disabled={loading} style={{ width:"100%", padding:"13px", background: loading ? "#94A3B8" : "#0D2030", color:"#fff", border:"none", borderRadius:9, fontSize:15, fontWeight:700, cursor: loading ? "not-allowed" : "pointer" }}>
       {loading ? "Signing in…" : "Sign In"}
      </button>
     </form>
    )}

    {/* ── Forgot password ── */}
    {mode === "forgot" && (
     <form onSubmit={doForgotPassword}>
      <div style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:8, padding:"10px 14px", fontSize:12.5, color:"#1E40AF", marginBottom:20 }}>
       Enter your email and we'll send a temporary password. Use it to log in, then set a new password.
      </div>
      <div style={{ marginBottom:20 }}>
       <label style={lbl}>Your Email</label>
       <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@safarnaamaholidays.com" required style={inp} autoFocus />
      </div>
      {err && <div style={{ background:"#FEE2E2", border:"1px solid #FCA5A5", borderRadius:8, padding:"10px 13px", fontSize:13, color:"#DC2626", marginBottom:16 }}>{err}</div>}
      <button type="submit" disabled={loading} style={{ width:"100%", padding:"13px", background: loading ? "#94A3B8" : "#0D2030", color:"#fff", border:"none", borderRadius:9, fontSize:15, fontWeight:700, cursor: loading ? "not-allowed" : "pointer" }}>
       {loading ? "Sending…" : "Send Temporary Password"}
      </button>
      <p style={{ textAlign:"center", fontSize:12, color:"#94A3B8", marginTop:16, cursor:"pointer" }} onClick={() => { setErr(""); setMode("login"); }}>← Back to sign in</p>
     </form>
    )}

    {/* ── Set new password (after temp password login) ── */}
    {mode === "changePassword" && (
     <form onSubmit={doChangePassword}>
      <div style={{ background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:8, padding:"10px 14px", fontSize:12.5, color:"#92400E", marginBottom:20 }}>
       You logged in with a temporary password. Please set a new permanent password to continue.
      </div>
      <div style={{ marginBottom:16 }}>
       <label style={lbl}>New Password</label>
       <input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Min 8 characters" required style={inp} autoFocus />
      </div>
      <div style={{ marginBottom:22 }}>
       <label style={lbl}>Confirm Password</label>
       <input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Repeat new password" required style={inp} />
      </div>
      {err && <div style={{ background:"#FEE2E2", border:"1px solid #FCA5A5", borderRadius:8, padding:"10px 13px", fontSize:13, color:"#DC2626", marginBottom:16 }}>{err}</div>}
      <button type="submit" disabled={loading} style={{ width:"100%", padding:"13px", background: loading ? "#94A3B8" : "#16A34A", color:"#fff", border:"none", borderRadius:9, fontSize:15, fontWeight:700, cursor: loading ? "not-allowed" : "pointer" }}>
       {loading ? "Saving…" : "Set New Password & Sign In"}
      </button>
     </form>
    )}

    <p style={{ textAlign:"center", fontSize:11, color:"#CBD5E1", marginTop:24 }}>Authorised personnel only</p>
   </div>
  </div>
 );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function AppInner({ authUser, doLogout }) {
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

 // API-backed entities: load from Supabase on mount, sync writes back automatically.
 // Portal mode (activePortal truthy) disables API sync and uses localStorage only.
 const [leads, setLeads]         = useAPIDB(K("leads"),        SEED_LEADS,        activePortal ? null : "/api/leads");
 const [vendors, setVendors]     = useAPIDB(K("vendors"),      SEED_VENDORS,      activePortal ? null : "/api/vendors");
 const [quotes, setQuotes]       = useAPIDB(K("quotes"),       [],                activePortal ? null : "/api/quotes");
 const [invoices, setInvoices]   = useAPIDB(K("invoices"),     [],                activePortal ? null : "/api/invoices");
 const [vouchers, setVouchers]   = useAPIDB(K("vouchers"),     [],                activePortal ? null : "/api/vouchers");
 const [roles, setRoles]         = useAPIDB(K("roles"),        PORTAL_SEED_ROLES, activePortal ? null : "/api/roles");
 const [users, setUsers]         = useAPIDB(K("users"),        PORTAL_SEED_USERS, activePortal ? null : "/api/users");
 const [tasks, setTasks]         = useAPIDB(K("tasks"),        [],                activePortal ? null : "/api/tasks");
 const [itineraries, setItineraries] = useAPIDB(K("itineraries"), [],             activePortal ? null : "/api/itineraries");
 const [whiteLabels, setWhiteLabels] = useAPIDB("sfn_whitelabels", [], activePortal ? null : "/api/portals"); // never portal-scoped
 const [currentUserId, setCurrentUserId] = useDB(K("current_user"), activePortal ? "PU001" : "U001");
 const [notifs, setNotifs]       = useDB(K("notifs"),       [
  { id:1, msg:"Welcome to your portal — start by adding leads!", time:"Just now", read:false },
 ]);
 const [markup, setMarkup]       = useSettingsKey("markup", { star3:18, star4:22, transport:15, activities:20 });
 const [bizSettings, setBizSettings] = useBizSettings(K("biz_settings"));
 const [refData, refLoading, refreshRef] = useRefData(K("ref_data"), "/api/reference");
const [mediaData, , refreshMedia]       = useRefData(K("media_data"), "/api/media");
 const [themeMode, setThemeMode] = useDB(K("theme"), "light");
 const [companyProfile, setCompanyProfile] = useSettingsKey("company_profile", DEFAULT_COMPANY_PROFILE);
 // Merge companyProfile into brand (portal overrides take priority)
 if (!activePortal) {
  brand.companyName  = companyProfile.name         || brand.companyName;
  brand.tagline      = companyProfile.tagline       || brand.tagline;
  brand.logoUrl      = companyProfile.logo          || brand.logoUrl;
  brand.primaryColor = companyProfile.primaryColor  || brand.primaryColor;
  brand.contactEmail = companyProfile.email         || brand.contactEmail;
 }
 brand.phone1    = companyProfile.phone1    || "";
 brand.phone2    = companyProfile.phone2    || "";
 brand.address   = companyProfile.address   || "";
 brand.website   = companyProfile.website   || "";
 brand.instagram = companyProfile.instagram || "";
 brand.facebook  = companyProfile.facebook  || "";
 brand.whatsapp  = companyProfile.whatsapp  || "";
 const isDark = themeMode === "dark";
 useEffect(() => {
  document.documentElement.setAttribute("data-theme", themeMode);
 }, [themeMode]);
 const [modal, setModal] = useState(null); // { type, lead, data }
 const [emailDocModal, setEmailDocModal] = useState(null); // { to, leadName, subject, note, html }
 const [waItinModal, setWaItinModal]   = useState(null); // { itin, lead }
 const [initItinerary, setInitItinerary] = useState(null); // seed data when jumping from Leads page
 const [toast, setToast] = useState(null);
 const [showBell, setShowBell] = useState(false);
 const [busy, setBusy] = useState(false);
 const [uploadStatus, setUploadStatus] = useState(null); // { label, done, count, err }
 const fileRef = useRef();
 const toast$ = (msg, err) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); };
 const addNotif = msg => setNotifs(p => [{ id:Date.now(), msg, time:"Just now", read:false }, ...p.slice(0,19)]);
 const fmt = n => `${bizSettings.currency_symbol}${Number(n||0).toLocaleString(bizSettings.currency_locale)}`;
 const taxCalc = subtotal => Math.round(subtotal * ((bizSettings.tax_rate||5) / 100));
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
  setUploadStatus({ label: `Reading "${file.name}" with AI…`, done: false });
  try {
   const result = await API("POST", `/api/import/${type}`, form, true);
   const items = result.items || [];
   setUploadStatus({ label: `Extracted ${items.length} record${items.length!==1?"s":""}`, done: true, count: items.length });
   setTimeout(() => setUploadStatus(null), 3000);
   return items;
  } catch (err) {
   console.error(err);
   const msg = err.message?.includes("NO_RESPONSE")
    ? "Backend not reachable. Make sure the server is running on port 3002."
    : err.message || "Import failed";
   setUploadStatus({ label: msg, done: true, err: true });
   setTimeout(() => setUploadStatus(null), 5000);
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
   addNotif(`${items.length} lead${items.length>1?"s":""} imported from "${file.name}"`);
  }
 };
 const uploadVendorsFile = async file => {
  const items = await importEntityFile("vendors", file);
  if (items.length) {
   setVendors(p => [...items, ...p]);
   addNotif(`${items.length} vendor${items.length>1?"s":""} imported from "${file.name}"`);
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
 priority: (bizSettings.task_priorities||["Low","Medium","High"])[1] || "Medium",
 status: (bizSettings.task_statuses||["Open","In Progress","Done"])[0] || "Open",
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
 const confirmQuote = async lead => {
 const { qc, destVendors, selectedVendors=[], existingQuoteId, body: rawBody } = modal.data;
 const vendorsToSend = (destVendors||[]).filter(v => selectedVendors.includes(v.id));
 if (!vendorsToSend.length) return toast$("Select at least one vendor before sending.", true);
 // Extract subject the same way the modal renders it
 const lines = (rawBody||"").split("\n");
 const hasSubjectLine = lines[0] && !lines[0].startsWith(" ") && lines[1] === "";
 const finalSubject = modal.data.subject ?? (hasSubjectLine ? lines[0] : `Quote Request — ${lead.destination} [${qc}]`);
 const finalBodyText = modal.data.subject !== undefined
  ? (rawBody||"")
  : (hasSubjectLine ? lines.slice(2).join("\n") : (rawBody||""));
 // Save to quotes state
 const q = {
  id: existingQuoteId || genId("Q"),
  lead_id: lead.id, lead_name: lead.name, destination: lead.destination,
  query_code: qc, body: rawBody,
  vendor_ids: vendorsToSend.map(v => v.id),
  vendors_contacted: vendorsToSend.map(v=>v.name),
  status: "Quote Requested",
  created_at: existingQuoteId ? modal.data.created_at || today() : today(),
 };
 setQuotes(p => existingQuoteId ? p.map(item => item.id === existingQuoteId ? q : item) : [q,...p]);
 setLeads(p => p.map(l => l.id===lead.id ? {...l, status:"Quote Requested"} : l));
 closeModal();
 // Send actual emails + create vendor_requests entries
 let ok = 0; const errs = [];
 for (const vendor of vendorsToSend) {
  if (!vendor.email) { errs.push(`${vendor.name}: no email`); continue; }
  try {
   const r = await fetch("/api/vendor-requests/send", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
     lead_id: lead.id, lead_name: lead.name, lead_ref: lead.id,
     destination: lead.destination,
     vendor_id: vendor.id, vendor_name: vendor.name, vendor_email: vendor.email,
     markup_type: vendor.markup_type||"percent", markup_value: vendor.markup_value||0,
     subject: finalSubject, body: finalBodyText,
    }),
   });
   const d = await r.json();
   if (r.ok) ok++; else errs.push(`${vendor.name}: ${d.error||r.status}`);
  } catch(e) { errs.push(`${vendor.name}: ${e.message}`); }
 }
 addNotif(`Quote ${qc} — ${ok > 0 ? `sent to ${ok} vendor(s)` : "email send failed"} for ${lead.destination}`);
 if (ok > 0) toast$(`✓ Quote ${qc} sent to ${ok} vendor(s)${errs.length ? ` · ${errs.length} failed` : ""}`);
 else toast$(errs.join(" | ") || "Email send failed — check Settings → Email", true);
 };
 const doManualQuote = lead => {
 const destVendors = vendors.filter(v => v.destination === lead.destination && v.status === "Active");
 const qc = genQC();
 setModal({ type:"quote", title:"Compose Vendor Email", lead, data:{
  qc,
  subject: `Vendor Inquiry — ${lead.destination} — ${lead.travel_date} — ${qc}`,
  body: `Dear [Vendor Name],\n\nWe have a client inquiry for ${lead.destination}.\n\nClient: ${lead.name}\nTravel Date: ${lead.travel_date}\nPax: ${lead.pax} adults, ${lead.kids||0} kids\nBudget: INR ${lead.budget}\nNotes: ${lead.notes||"—"}\n\nPlease share your best quote for the above. Quote Reference: ${qc}\n\nRegards,\nSafarnaama Holidays`,
  destVendors,
  selectedVendors: destVendors.map(v=>v.id),
 }});
 };
 // ── AI INVOICE ──────────────────────────────────────────────────────────────
 const INV_CATS = ["Hotel","Flight","Transfer","Visa","Activity","Meal","Insurance","Miscellaneous"];
 const doInvoice = async lead => {
 setModal({ type:"loading", title:"Generating Invoice…" });
 setBusy(true);
 const aiInvNo = (() => { const yr=new Date().getFullYear(); const seq=String((invoices.filter(i=>(i.invoice_no||"").startsWith(`SAF-${yr}`)).length||0)+1).padStart(4,"0"); return `SAF-${yr}-${seq}`; })();
 try {
 const data = await askClaudeJSON(
 `Generate a detailed travel invoice JSON for Safarnaama Holidays (Indian travel company).
Client: ${lead.name}, Destination: ${lead.destination}
Travel Date: ${lead.travel_date}, Adults: ${lead.pax}, Kids: ${lead.kids||0}
Budget: INR ${lead.budget}, Notes: ${lead.notes||""}
Break the package into realistic line items by category. Categories allowed: Hotel, Flight, Transfer, Visa, Activity, Meal, Insurance, Miscellaneous.
Return JSON only — no markdown:
{"invoice_no":"${aiInvNo}","date":"${today()}","due_date":"${lead.travel_date||today()}","payment_terms":"50% advance, balance 7 days before departure",
"items":[{"category":"Hotel","description":"","qty":1,"rate":0,"amount":0}],
"subtotal":0,"tax_rate":5,"gst":0,"total":0,"notes":"","paid_amount":0,"payments":[]}`
 );
 if (!data.payments) data.payments = [];
 if (!data.paid_amount) data.paid_amount = 0;
 setModal({ type:"invoice", title:"Invoice — Review & Edit", lead, data });
 } catch(e) { toast$("AI error: "+e.message, true); closeModal(); }
 finally { setBusy(false); }
 };
 const doManualInvoice = lead => {
 const yr = new Date().getFullYear();
 const seq = String((invoices.filter(i=>(i.invoice_no||"").startsWith(`SAF-${yr}`)).length||0)+1).padStart(4,"0");
 const invNo = `SAF-${yr}-${seq}`;
 const sub = Number(lead.budget)||0;
 const tax = taxCalc(sub);
 setModal({ type:"invoice", title:"New Invoice", lead, data:{
  invoice_no: invNo, date: today(), due_date: lead.travel_date||"",
  payment_terms: "50% advance, balance 7 days before departure",
  items:[{ category:"Hotel", description:`${lead.destination} Travel Package`, qty:1, rate:sub, amount:sub }],
  subtotal: sub, tax_rate: bizSettings.tax_rate||5, gst: tax, total: sub + tax,
  notes:"", paid_amount:0, payments:[],
 }});
 };
 const saveInvoice = () => {
 const isEdit = invoices.some(x => x.id === modal.data.id);
 const inv = { ...modal.data, lead_id:modal.lead.id, lead_name:modal.lead.name, destination:modal.lead.destination };
 if (!inv.id) inv.id = genId("INV");
 if (!inv.payments) inv.payments = [];
 inv.paid_amount = inv.payments.reduce((s,p) => s + Number(p.amount||0), 0);
 inv.balance = Math.max(0, Number(inv.total||0) - inv.paid_amount);
 if (!inv.status || inv.status === "Draft") {
  if (inv.balance === 0 && inv.total > 0) inv.status = "Paid";
  else if (inv.paid_amount > 0) inv.status = "Partially Paid";
  else inv.status = "Draft";
 }
 setInvoices(p => isEdit ? p.map(x => x.id === inv.id ? inv : x) : [inv, ...p]);
 addNotif(`Invoice ${inv.invoice_no} ${isEdit?"updated":"generated"} for ${modal.lead.name}`);
 toast$(isEdit ? "Invoice updated!" : "Invoice saved!");
 closeModal();
 };
 const doEditInvoice = inv => {
 const lead = { id:inv.lead_id, name:inv.lead_name, destination:inv.destination };
 setModal({ type:"invoice", title:`Edit Invoice — ${inv.invoice_no}`, lead, data:{...inv, payments:inv.payments||[], paid_amount:inv.paid_amount||0} });
 };
 const doRecordPayment = inv => {
 const paid = Number(inv.paid_amount||0);
 const bal = Math.max(0, Number(inv.total||0) - paid);
 setModal({ type:"recordPayment", title:`Record Payment — ${inv.invoice_no}`, lead:null, data:{
  inv_id: inv.id, invoice_no: inv.invoice_no, total: inv.total,
  paid_amount: paid, balance: bal,
  payments: inv.payments || [],
  amount: "", date: today(), method:"Bank Transfer", ref:"", note:"",
 }});
 };
 const saveRecordedPayment = () => {
 const d = modal.data;
 const amt = Number(d.amount||0);
 if (!amt || amt <= 0) { toast$("Enter a valid payment amount", true); return; }
 const payment = { id:genId("PAY"), date:d.date||today(), amount:amt, method:d.method||"", ref:d.ref||"", note:d.note||"" };
 setInvoices(p => p.map(inv => {
  if (inv.id !== d.inv_id) return inv;
  const payments = [...(inv.payments||[]), payment];
  const paid_amount = payments.reduce((s,py) => s + Number(py.amount||0), 0);
  const balance = Math.max(0, Number(inv.total||0) - paid_amount);
  const status = balance === 0 ? "Paid" : "Partially Paid";
  return { ...inv, payments, paid_amount, balance, status };
 }));
 addNotif(`Payment of ₹${amt.toLocaleString("en-IN")} recorded for ${d.invoice_no}`);
 toast$(`Payment of ₹${amt.toLocaleString("en-IN")} recorded!`);
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
 setModal({ type:"voucher", title:"Voucher — Review & Edit", lead, data });
 } catch(e) { toast$("AI error: "+e.message, true); closeModal(); }
 finally { setBusy(false); }
 };
 const doManualVoucher = (lead, voucher_type="Hotel") => {
 const vno = `VCH-${Date.now().toString().slice(-6)}`;
 setModal({ type:"voucher", title:"New Voucher", lead, data:{
  voucher_no: vno, voucher_type, client_name: lead.name, destination: lead.destination,
  travel_date: lead.travel_date||"", return_date: lead.end_date||"",
  adults: Number(lead.pax)||1, kids: Number(lead.kids)||0,
  hotel:"", room_type:"", inclusions:[], special_notes:"", emergency_contact: bizSettings.emergency_contact||"+91-9999999999",
 }});
 };
 const doManualItinerary = lead => {
 setInitItinerary({
  lead_id: lead.id, lead_name: lead.name, destination: lead.destination,
  start_date: lead.travel_date||"", end_date: lead.end_date||"",
  pax: lead.pax||2, kids: lead.kids||0, notes: lead.notes||"",
  title: `${lead.destination} Itinerary`, status:"Draft",
 });
 setPage("itinerary");
 closeModal();
 };
 const doPickMethod = (lead, actionType) => {
 if (actionType === "itinerary") {
  const leadItins = itineraries.filter(it => it.lead_id === lead.id);
  const latest = leadItins.sort((a,b) => (b.version||0)-(a.version||0) || new Date(b.created_at)-new Date(a.created_at))[0];
  if (latest) { setModal({ type:"itinerary", title:`Itinerary — ${lead.destination}`, lead, data:latest }); return; }
 }
 const labels = { itinerary:"Itinerary", quote:"Vendor Email", invoice:"Invoice", voucher:"Voucher" };
 setModal({ type:"method_pick", title:`Create ${labels[actionType]||actionType}`, lead, data:{ actionType } });
 };
 const saveVoucher = () => {
 const isEdit = vouchers.some(x => x.id === modal.data.id);
 const v = { ...modal.data, lead_id:modal.lead.id };
 if (!v.id) v.id = genId("VCH");
 if (!v.status) v.status = "Active";
 setVouchers(p => isEdit ? p.map(x => x.id === v.id ? v : x) : [v, ...p]);
 addNotif(`Voucher ${v.voucher_no} ${isEdit?"updated":"generated"} for ${modal.lead.name}`);
 toast$(isEdit ? "Voucher updated!" : "Voucher saved!");
 closeModal();
 };
 const doEditVoucher = v => {
 const lead = { id:v.lead_id, name:v.client_name, destination:v.destination };
 setModal({ type:"voucher", title:`Edit Voucher — ${v.voucher_no}`, lead, data:{...v} });
 };
 const doPreview = (docType, data) => {
 const templates = { invoice:["Classic","Modern","Minimal"], voucher:["Classic","Modern","Luxury"], quote:["Professional","Modern","Brief"], itinerary:["Classic","Compact"] };
 const tlist = templates[docType]||["Classic"];
 const label = {invoice:"Invoice",voucher:"Voucher",quote:"Quote",itinerary:"Itinerary"}[docType]||docType;
 let doc = data;
 if (docType === "itinerary" && data.id) {
  try {
   const imgs = JSON.parse(localStorage.getItem(`sfn_itin_imgs_${data.id}`) || 'null');
   if (imgs) {
    doc = {
     ...data,
     cover_image_url: imgs.cover || data.cover_image_url,
     hotels: (data.hotels||[]).map((h, i) => ({...h, image_url: imgs.hotels?.[i] || h.image_url})),
     option2_hotels: (data.option2_hotels||[]).map((h, i) => ({...h, image_url: imgs.o2hotels?.[i] || h.image_url})),
     days: (data.days||[]).map((d, i) => ({...d, image_url: imgs.days?.[i] || d.image_url})),
    };
   }
  } catch {}
 }
 setModal({ type:"preview", title:`Preview — ${label}: ${data.invoice_no||data.voucher_no||data.title||data.lead_name||""}`, lead:null, data:{ docType, doc, template:tlist[0], templates:tlist } });
 };
 // ── SAVE VENDOR DOC QUOTE ───────────────────────────────────────────────────
 const saveVendorQuote = () => {
 const d = modal.data;
 if (!d.linked_lead_id) { toast$("Please select a lead before saving", true); return; }
 const totalCost = Number(d.total_cost) || 0;
 const markupPct = Number(d.markup_pct) || bizSettings.default_markup_pct || 22;
 const finalCost = d.final_cost_override != null
  ? Number(d.final_cost_override)
  : Math.round(totalCost * (1 + markupPct / 100));
 const selectedLead = leads.find(l => l.id === d.linked_lead_id);

 // ── Resolve itinerary: link to existing or create a new draft ──────────────
 let resolvedItinId = d.linked_itinerary_id || null;

 if (resolvedItinId) {
  // Update existing itinerary status to reflect quote received
  setItineraries(p => p.map(it =>
   it.id === resolvedItinId ? { ...it, status: "Quote Received" } : it
  ));
 } else {
  // Create a new draft itinerary seeded from the vendor quote
  const newItinId = `ITN${Date.now().toString().slice(-6)}`;
  resolvedItinId = newItinId;
  // Use fully extracted arrays if available, fall back to single hotel entry
  const itinHotels = (d.ext_hotels && d.ext_hotels.length > 0)
   ? d.ext_hotels
   : d.hotel_name ? [{
    id: `H${Date.now().toString().slice(-4)}`,
    name: d.hotel_name, destination: d.destination || "",
    check_in: "", check_out: d.valid_till || "",
    room_type: d.room_type || "", meals: "Breakfast",
    rating: 4, cost_per_night: 0, nights: 1,
   }] : [];
  const itinFlights = Array.isArray(d.ext_flights) ? d.ext_flights : [];
  const itinDays    = Array.isArray(d.ext_days)    ? d.ext_days    : [];
  const newItin = {
   id: newItinId,
   lead_id: selectedLead.id,
   lead_name: selectedLead.name,
   title: `${d.destination || selectedLead.destination} — ${itinDays.length > 0 ? `${itinDays.length}N` : "Vendor"} Quote`,
   destination: d.destination || selectedLead.destination || "",
   start_date: selectedLead.travel_date || (itinHotels[0]?.check_in) || "",
   end_date: selectedLead.end_date || (itinHotels[itinHotels.length-1]?.check_out) || "",
   pax: Number(d.pax) || Number(selectedLead.pax) || 2,
   kids: Number(selectedLead.kids) || 0,
   notes: d.notes || "",
   status: "Quote Received",
   highlights: Array.isArray(d.inclusions) ? d.inclusions.slice(0, 6) : [],
   flights: itinFlights,
   hotels: itinHotels,
   days: itinDays,
   show_total_only: true,
   final_price: finalCost,
   version: 1,
   created_at: today(),
  };
  setItineraries(p => [newItin, ...p]);
 }

 // ── Save the vendor quote record ───────────────────────────────────────────
 const q = {
  id: genId("VQ"),
  type: "vendor_quote",
  query_code: `VQ-${Date.now().toString().slice(-6)}`,
  lead_id: selectedLead.id,
  lead_name: selectedLead.name,
  itinerary_id: resolvedItinId,
  destination: d.destination,
  file_name: d.file_name,
  vendor_name: d.vendor_name,
  hotel_name: d.hotel_name,
  room_type: d.room_type,
  pax: Number(d.pax) || 1,
  per_person_cost: Number(d.per_person_cost) || Math.round(finalCost / (Number(d.pax) || 1)),
  total_cost: totalCost,
  inclusions: Array.isArray(d.inclusions) ? d.inclusions : [],
  valid_till: d.valid_till || "",
  notes: d.notes || "",
  markup_pct: markupPct,
  final_cost: finalCost,
  vendors_contacted: d.vendor_name ? [d.vendor_name] : [],
  status: "Quote Received",
  created_at: today(),
 };
 setQuotes(p => [q, ...p]);
 setLeads(p => p.map(l => l.id === selectedLead.id ? { ...l, status: "Quote Received" } : l));
 addNotif(`Vendor quote saved for ${selectedLead.name} — ${d.destination} — ₹${finalCost.toLocaleString("en-IN")}`);
 const msg = d.linked_itinerary_id
  ? `Quote linked to existing itinerary for ${selectedLead.name}!`
  : `Draft itinerary created in Itinerary Builder for ${selectedLead.name}!`;
 toast$(msg);
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
 // Coerce any field that Claude may return as an object into a safe primitive
 const safeStr = v => v == null ? "" : (typeof v === "object" ? Object.values(v).filter(Boolean).join(", ") : String(v));
 const safeNum = v => {
  if (v == null) return 0;
  if (typeof v === "object") return Number(v.total || v.adults || v.amount || Object.values(v)[0] || 0);
  return Number(v) || 0;
 };
 const safeArr = v => Array.isArray(v) ? v.map(safeStr) : (v ? [safeStr(v)] : []);
 // normalise field names (backend uses camelCase, legacy used snake_case)
 // normalise hotels array
 const safeHotels = (arr) => (Array.isArray(arr) ? arr : []).map((h, i) => ({
  id: `H${Date.now().toString().slice(-4)}${i}`,
  name: safeStr(h.name),
  destination: safeStr(h.destination || data.destination),
  check_in: safeStr(h.checkIn || h.check_in),
  check_out: safeStr(h.checkOut || h.check_out),
  room_type: safeStr(h.roomType || h.room_type),
  meals: safeStr(h.meals) || "Breakfast",
  rating: 4,
  nights: safeNum(h.nights) || 1,
  cost_per_night: safeNum(h.costPerNight || h.cost_per_night),
  image_url: safeStr(h.image_url),
 }));
 // normalise flights array
 const safeFlights = (arr) => (Array.isArray(arr) ? arr : []).map((f, i) => ({
  id: `F${Date.now().toString().slice(-4)}${i}`,
  from: safeStr(f.from),
  to: safeStr(f.to),
  date: safeStr(f.date),
  airline: safeStr(f.airline),
  flight_no: safeStr(f.flightNo || f.flight_no),
  departure: safeStr(f.departure),
  arrival: safeStr(f.arrival),
  class: safeStr(f.class) || "Economy",
  cost: safeNum(f.cost),
 }));
 // normalise days array
 const safeDays = (arr) => (Array.isArray(arr) ? arr : []).map((d, i) => ({
  day: Number(d.day) || i + 1,
  date: safeStr(d.date),
  title: safeStr(d.title) || `Day ${i + 1}`,
  location: safeStr(d.location || data.destination),
  hotel: safeStr(d.hotel),
  image_query: safeStr(d.location || data.destination),
  activities: (Array.isArray(d.activities) ? d.activities : []).map((a, ai) => ({
   id: `A${Date.now().toString().slice(-5)}${ai}`,
   time: safeStr(a.time) || "",
   type: safeStr(a.type) || "sightseeing",
   title: safeStr(a.title),
   desc: safeStr(a.desc || a.description),
   cost: safeNum(a.cost),
   image_url: safeStr(a.image_url),
  })),
 }));
 const hotels = safeHotels(data.hotels);
 const flights = safeFlights(data.flights);
 const days = safeDays(data.days);
 const firstHotel = hotels[0] || {};
 const norm = {
  vendor_name:     safeStr(data.vendorName||data.vendor_name),
  destination:     safeStr(data.destination),
  hotel_name:      safeStr(firstHotel.name || data.hotelName || data.hotel_name),
  room_type:       safeStr(firstHotel.room_type || data.roomType || data.room_type),
  per_person_cost: safeNum(data.perPersonCost||data.per_person_cost),
  total_cost:      safeNum(data.totalCost||data.total_cost),
  pax:             safeNum(data.pax) || 2,
  inclusions:      safeArr(data.inclusions),
  valid_till:      safeStr(data.validTill||data.valid_till),
  notes:           safeStr(data.notes),
  // full extracted arrays — used when creating itinerary
  ext_hotels:  hotels,
  ext_flights: flights,
  ext_days:    days,
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
 { id:"reports",    label:"Reports",           icon:"chart",      perm:"invoices" },
 { id:"users",      label:"Users",             icon:"users",      perm:"users" },
 { id:"roles",      label:"Roles",             icon:"roles",      perm:"roles" },
 { id:"whitelabel", label:"White Label",        icon:"whitelabel", perm:"whitelabel" },
 { id:"email",      label:"Email",              icon:"email",      perm:"leads" },
 { id:"vendor_req", label:"Vendor Requests",    icon:"vendor_req", adminOnly:true },
 { id:"chat",       label:"AI Chat",            icon:"chat",       perm:"chat" },
 { id:"settings",   label:"Settings",          icon:"settings",   perm:"settings" },
 ].filter(n => (!n.perm || hasPermission(n.perm)) && (!n.adminOnly || isAdmin))
  .filter(n => !activePortal || !brand.modules || n.id === "dashboard" || brand.modules.includes(n.id));

 // Root background driven by portal brand
 const rootBg = brand.bgColor;
 return (
 <div style={{ display:"flex", height:"100vh", background: isDark ? "#0D1117" : (rootBg||"#F6F8FC"), color: isDark ? "#E2E8F0" : "#334155", fontFamily:"'DM Sans',sans-serif", overflow:"hidden" }}>
 <style>{`
 @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700&family=Playfair+Display:wght@400;600;700&display=swap');
 *{box-sizing:border-box;margin:0;padding:0;}
 ::-webkit-scrollbar{width:7px;height:7px;}
 ::-webkit-scrollbar-track{background:#E8EFF7;border-radius:4px;}
 ::-webkit-scrollbar-thumb{background:#7BAAC4;border-radius:4px;}
 ::-webkit-scrollbar-thumb:hover{background:#4A8AAE;}
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
 ${isDark ? `
 [data-theme="dark"] input,[data-theme="dark"] select,[data-theme="dark"] textarea{background:#1E293B!important;color:#E2E8F0!important;border-color:#334155!important;}
 [data-theme="dark"] input::placeholder,[data-theme="dark"] textarea::placeholder{color:#64748B!important;}
 [data-theme="dark"] select option{background:#1E293B!important;color:#E2E8F0!important;}
 [data-theme="dark"] [style*="background:#FFFFFF"],[data-theme="dark"] [style*="background: #FFFFFF"]{background:#1E293B!important;}
 [data-theme="dark"] [style*="background:#F6F8FC"],[data-theme="dark"] [style*="background: #F6F8FC"]{background:#0F172A!important;}
 [data-theme="dark"] [style*="background:#EEF3F9"],[data-theme="dark"] [style*="background: #EEF3F9"]{background:#1E293B!important;}
 [data-theme="dark"] [style*="background:#F0F4F8"],[data-theme="dark"] [style*="background: #F0F4F8"]{background:#1E293B!important;}
 [data-theme="dark"] [style*="background:#F6F8FC"],[data-theme="dark"] [style*="background: #F6F8FC"]{background:#0F172A!important;}
 [data-theme="dark"] [style*="background:#F8FAFC"],[data-theme="dark"] [style*="background: #F8FAFC"]{background:#1E293B!important;}
 [data-theme="dark"] [style*="background:#FAFBFC"],[data-theme="dark"] [style*="background: #FAFBFC"]{background:#1E293B!important;}
 [data-theme="dark"] [style*="color:#0F172A"],[data-theme="dark"] [style*="color: #0F172A"]{color:#E2E8F0!important;}
 [data-theme="dark"] [style*="color:#334155"],[data-theme="dark"] [style*="color: #334155"]{color:#94A3B8!important;}
 [data-theme="dark"] [style*="color:#1e293b" i],[data-theme="dark"] [style*="color:#0f172a" i]{color:#E2E8F0!important;}
 [data-theme="dark"] [style*="border:1px solid #E6ECF5"],[data-theme="dark"] [style*="border: 1px solid #E6ECF5"]{border-color:#334155!important;}
 [data-theme="dark"] [style*="border:1px solid #D5E1EE"],[data-theme="dark"] [style*="border: 1px solid #D5E1EE"]{border-color:#334155!important;}
 [data-theme="dark"] [style*="borderBottom:1px solid #E6ECF5"],[data-theme="dark"] [style*="borderBottom: 1px solid #E6ECF5"]{border-bottom-color:#334155!important;}
 [data-theme="dark"] [style*="borderTop:1px solid #E6ECF5"],[data-theme="dark"] [style*="borderTop: 1px solid #E6ECF5"]{border-top-color:#334155!important;}
 [data-theme="dark"] table td,[data-theme="dark"] table th{border-color:#334155!important;}
 [data-theme="dark"] .nav-btn:hover{background:#1E293B!important;}
 [data-theme="dark"] .row:hover{background:#1E293B!important;}
 [data-theme="dark"] ::-webkit-scrollbar-track{background:#1E293B!important;}
 [data-theme="dark"] ::-webkit-scrollbar-thumb{background:#475569!important;}
 [data-theme="dark"] ::-webkit-scrollbar-thumb:hover{background:#64748B!important;}
 ` : ""}
 `}</style>
 {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
 <div style={{ width:215, background: isDark ? "#0F172A" : "#FFFFFF", borderRight: isDark ? "1px solid #1E293B" : "1px solid #E6ECF5", display:"flex", flexDirection:"column", flexShrink:0 }}>
 <div style={{ padding:"20px 16px 14px", borderBottom: isDark ? "1px solid #1E293B" : "1px solid #E6ECF5" }}>
 <div style={{ display:"flex", alignItems:"center", gap:10 }}>
  {brand.logoUrl
   ? <img src={brand.logoUrl} alt="logo" style={{ width:36, height:36, borderRadius:9, objectFit:"cover", border:"1px solid #E6ECF5" }}/>
   : <div style={{ width:36, height:36, background:`linear-gradient(135deg,${brand.primaryColor},${brand.accentColor})`, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon name="airplane" size={19}/></div>
  }
  <div>
   <div style={{ fontSize:13, fontWeight:700, color: isDark ? "#E2E8F0" : "#0F172A", letterSpacing:.2 }}>{brand.companyName}</div>
   <div style={{ fontSize:10, color:brand.primaryColor, letterSpacing:1.2, fontWeight:600, textTransform:"uppercase" }}>{brand.tagline}</div>
  </div>
 </div>
 </div>
 <nav style={{ flex:1, padding:"10px 8px", overflow:"auto" }}>
 {NAV.map(n => (
 <button key={n.id} className="nav-btn" onClick={() => setPage(n.id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:9, padding:"9px 11px", borderRadius:8, background: page===n.id?brand.primaryColor+"18":"transparent", border:"none", cursor:"pointer", color: page===n.id ? brand.primaryColor : (isDark ? "#94A3B8" : "#64748B"), fontSize:13, fontWeight: page===n.id?600:400, textAlign:"left", marginBottom:2, borderLeft: page===n.id?`2px solid ${brand.primaryColor}`:"2px solid transparent", transition:"all .15s" }}>
 <Icon name={n.icon} size={15}/>{n.label}
 </button>
 ))}
 </nav>
 <div style={{ padding:"11px 14px", borderTop: isDark ? "1px solid #1E293B" : "1px solid #E6ECF5", fontSize:11, color:"#94A3B8" }}>
  {brand.poweredBy
   ? <><div style={{ fontWeight:600, color:brand.primaryColor, marginBottom:2 }}>{brand.companyName}</div><div style={{ fontSize:9, marginTop:1 }}>Powered by Safarnaama CRM</div></>
   : <><div style={{ fontWeight:600, color:"#3A8A9A", marginBottom:2 }}>Admin User</div><div>{brand.contactEmail}</div></>
  }
 </div>
 </div>
 {/* ── MAIN ────────────────────────────────────────────────────────────── */}
 <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
 {/* TOPBAR */}
 <div style={{ height:52, background: isDark ? "#0F172A" : "#FFFFFF", borderBottom: isDark ? "1px solid #1E293B" : "1px solid #E6ECF5", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 22px", flexShrink:0 }}>
 <h2 style={{ fontSize:15, fontFamily:"'Playfair Display',serif", color: isDark ? "#E2E8F0" : "#0F172A", fontWeight:600 }}>{NAV.find(n=>n.id===page)?.label}</h2>
 <div style={{ display:"flex", alignItems:"center", gap:10 }}>
 {/* Logged-in user badge + logout */}
 <div style={{ display:"flex", alignItems:"center", gap:8 }}>
  <div style={{ fontSize:11, color: isDark ? "#94A3B8" : "#64748B", background: isDark ? "#1E293B" : "#F1F5F9", border: isDark ? "1px solid #334155" : "1px solid #E2E8F0", borderRadius:20, padding:"4px 12px" }}>
   {authUser?.name || currentUser?.name} <span style={{ opacity:.6 }}>({authUser?.role || currentUser?.role})</span>
  </div>
  <button onClick={doLogout} title="Sign out" style={{ background:"transparent", border:"1px solid", borderColor: isDark ? "#334155" : "#E2E8F0", color: isDark ? "#94A3B8" : "#64748B", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer" }}>Sign out</button>
 </div>
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
 <div style={{ flex:1, overflow:"auto", padding:22, background: isDark ? "#0D1117" : undefined }}>
 {page==="dashboard" && <PageDashboard leads={leads} quotes={quotes} invoices={invoices} vendors={vendors} tasks={tasks} itineraries={itineraries} setPage={setPage} bizSettings={bizSettings}/>}
 {page==="leads" && <PageLeads leads={leads} setLeads={setLeads} users={users} currentUser={currentUser} onPickMethod={doPickMethod} onDownloadLeads={downloadLeads} onUploadLeads={uploadLeadsFile} bizSettings={bizSettings} setBizSettings={setBizSettings} refData={refData} refLoading={refLoading} toast$={toast$} onPreview={doPreview} invoices={invoices} vouchers={vouchers} itineraries={itineraries} companyProfile={companyProfile}/>}
 {page==="itinerary" && <PageItinerary leads={leads} itineraries={itineraries} setItineraries={setItineraries} initData={initItinerary} setInitData={setInitItinerary} toast$={toast$} onRequestQuote={payload => doPickMethod(payload.lead||payload, "quote")} brand={brand} quotes={quotes} bizSettings={bizSettings} setBizSettings={setBizSettings} refData={refData} refLoading={refLoading} refreshRef={refreshRef} onPreview={doPreview} vendors={vendors} mediaData={mediaData||[]} refreshMedia={refreshMedia}
  onEmailItin={async (itin, tpl) => {
   const lead = leads.find(l => l.id === itin.lead_id);
   const stripData = v => (!v || v.startsWith("data:")) ? "" : v;
   let emailCover = itin.cover_image_url || "";
   if (emailCover.startsWith("data:")) {
    try {
     const small = await compressImgForPrint(emailCover, 800, 0.72);
     emailCover = await uploadTempImg(small) || "";
    } catch { emailCover = ""; }
   }
   const emailDoc = { ...itin, cover_image_url:emailCover, hotels:(itin.hotels||[]).map(h=>({...h,image_url:stripData(h.image_url)})), option2_hotels:(itin.option2_hotels||[]).map(h=>({...h,image_url:stripData(h.image_url)})), days:(itin.days||[]).map(d=>({...d,image_url:stripData(d.image_url)})) };
   setEmailDocModal({ to:lead?.email||"", leadName:lead?.name||itin.lead_name||"", subject:`Your Itinerary — ${itin.destination||itin.title||"Your Trip"} | ${companyProfile?.name||"Safarnaama"}`, html:genItinHTML(emailDoc, tpl||"Classic", bizSettings, companyProfile) });
  }}
  onWhatsAppItin={(itin) => {
   const lead = leads.find(l => l.id === itin.lead_id);
   setWaItinModal({ itin, lead });
  }}/>}
 {page==="tasks" && <PageTasks tasks={tasks} setTasks={setTasks} users={users} leads={leads} currentUser={currentUser} isAdmin={isAdmin} onCreateTask={openTaskModal} bizSettings={bizSettings}/>}
 {page==="quotes" && <PageQuotes quotes={quotes} setQuotes={setQuotes} vendors={vendors} leads={leads} bizSettings={bizSettings} toast$={toast$} onPreview={q=>{ const lead=leads.find(l=>l.id===q.lead_id); doPreview("quote",{...q, lead_name:q.lead_name, destination:q.destination, travel_date:lead?.travel_date||"", pax:lead?.pax||q.pax||"", kids:lead?.kids||0, services:q.services||(q.hotel_name?[{name:q.hotel_name,price:q.final_cost}]:[]), total_price:q.total_price||q.final_cost, inclusions:q.inclusions||"", exclusions:q.exclusions||"", notes:q.email_body||q.notes||""}); }}/>}
 {page==="vendors" && <PageVendors vendors={vendors} setVendors={setVendors} onDownloadVendors={downloadVendors} onUploadVendors={uploadVendorsFile} bizSettings={bizSettings} setBizSettings={setBizSettings} refData={refData} toast$={toast$}/>}
 {page==="invoices" && <PageInvoices invoices={invoices} setInvoices={setInvoices} leads={leads} onGenerate={l => doPickMethod(l, "invoice")} onEdit={doEditInvoice} onPreview={inv => doPreview("invoice", inv)} onRecordPayment={doRecordPayment} bizSettings={bizSettings}/>}
 {page==="vouchers" && <PageVouchers vouchers={vouchers} setVouchers={setVouchers} leads={leads} onGenerate={l => doPickMethod(l, "voucher")} onEdit={doEditVoucher} onPreview={v => doPreview("voucher", v)} bizSettings={bizSettings}/>}
 {page==="reports" && <PageReports leads={leads} invoices={invoices} quotes={quotes} bizSettings={bizSettings}/>}
 {page==="users" && <PageUsers users={users} setUsers={setUsers} roles={roles} currentUser={currentUser} isAdmin={isAdmin} toast$={toast$}/>}
 {page==="roles" && <PageRoles roles={roles} setRoles={setRoles} users={users} isAdmin={isAdmin} toast$={toast$}/>}
 {page==="whitelabel" && <PageWhiteLabel whiteLabels={whiteLabels} setWhiteLabels={setWhiteLabels} isAdmin={isAdmin} toast$={toast$}/>}
 {page==="email" && <PageEmail leads={leads} toast$={toast$}/>}
 {page==="vendor_req" && isAdmin && <PageVendorRequests leads={leads} vendors={vendors} toast$={toast$}/>}
 {page==="chat" && <PageChat leads={leads} setLeads={setLeads} quotes={quotes} setQuotes={setQuotes} invoices={invoices} addNotif={addNotif} toast$={toast$} setPage={setPage} onInvoice={doInvoice}/>}
 {page==="settings" && <PageSettings markup={markup} setMarkup={setMarkup} bizSettings={bizSettings} setBizSettings={setBizSettings} toast$={toast$} themeMode={themeMode} setThemeMode={setThemeMode} companyProfile={companyProfile} setCompanyProfile={setCompanyProfile}/>}
 </div>
 </div>
 {/* ── UPLOAD STATUS BANNER ─────────────────────────────────────────── */}
 {uploadStatus && (
 <div className="fadein" style={{ position:"fixed", bottom: toast ? 80 : 22, right:22, background: uploadStatus.err ? "#FEF2F2" : uploadStatus.done ? "#ECFDF3" : "#EFF6FF", border:`1px solid ${uploadStatus.err?"#7D2E2E":uploadStatus.done?"#1E6A42":"#2563EB"}`, borderRadius:10, padding:"11px 18px", color:"#0F172A", fontSize:13, zIndex:2001, boxShadow:"0 8px 24px rgba(0,0,0,.5)", display:"flex", alignItems:"center", gap:10, maxWidth:420 }}>
 {!uploadStatus.done
  ? <span style={{ display:"inline-block",width:14,height:14,border:"2px solid #2563EB",borderTopColor:"transparent",borderRadius:"50%",animation:"spin .7s linear infinite",flexShrink:0 }}/>
  : <Icon name={uploadStatus.err?"warning":"check"} size={15}/>
 }
 <span>{uploadStatus.label}</span>
 </div>
 )}
 {/* ── TOAST ───────────────────────────────────────────────────────────── */}
 {toast && (
 <div className="fadein" style={{ position:"fixed", bottom:22, right:22, background:toast.err?"#FEF2F2":"#ECFDF3", border:`1px solid ${toast.err?"#7D2E2E":"#1E6A42"}`, borderRadius:10, padding:"11px 18px", color:"#0F172A", fontSize:13, zIndex:2000, boxShadow:"0 8px 24px rgba(0,0,0,.5)", display:"flex", alignItems:"center", gap:8, maxWidth:360 }}>
 <Icon name={toast.err?"warning":"check"} size={15}/>{toast.msg}
 </div>
 )}
 {/* ── MODALS ──────────────────────────────────────────────────────────── */}
 {/* Method Picker */}
 <Modal open={modal?.type==="method_pick"} onClose={closeModal} title={modal?.title} width={500}>
 {modal?.type==="method_pick" && modal?.data && (() => {
  const { actionType } = modal.data;
  const lead = modal.lead;
  const ACTS = {
   itinerary: { ai: ()=>{ closeModal(); doItinerary(lead); }, manual: ()=>doManualItinerary(lead), label:"Itinerary",   aiDesc:"Claude builds a day-by-day itinerary with hotel suggestions based on destination, dates, and notes.",   manualDesc:"Opens the Itinerary Builder pre-filled with lead details — destination, dates, pax. Add days, hotels, and flights yourself." },
   quote:     { ai: ()=>{ closeModal(); doQuote(lead); },     manual: ()=>doManualQuote(lead),     label:"Vendor Email", aiDesc:"Claude drafts the vendor inquiry email — you can edit before sending.",                                    manualDesc:"Opens a pre-filled template with lead details. Write the email yourself, no AI used." },
   invoice:   { ai: ()=>{ closeModal(); doInvoice(lead); },   manual: ()=>doManualInvoice(lead),   label:"Invoice",      aiDesc:"Claude generates line items and amounts from the lead's package details.",                                  manualDesc:"Opens a blank invoice pre-filled with lead name, destination, and budget. Fill in the rest." },
   voucher:   { ai: ()=>{ closeModal(); doVoucher(lead); },   manual: ()=>doManualVoucher(lead),   label:"Voucher",      aiDesc:"Claude generates the confirmation voucher with hotel, inclusions, and notes.",                             manualDesc:"Opens a pre-filled voucher form. Enter hotel, room type, and inclusions yourself." },
  };
  const act = ACTS[actionType];
  if (!act) return null;
  const Card = ({ icon, heading, desc, onClick, accent }) => (
   <div onClick={onClick} style={{ cursor:"pointer", border:`2px solid ${accent}22`, borderRadius:14, padding:24, background:"#FFFFFF", flex:1, transition:"box-shadow .15s" }}
    onMouseEnter={e=>{ e.currentTarget.style.borderColor=accent; e.currentTarget.style.boxShadow=`0 4px 18px ${accent}22`; }}
    onMouseLeave={e=>{ e.currentTarget.style.borderColor=`${accent}22`; e.currentTarget.style.boxShadow="none"; }}>
    <div style={{ fontSize:32, marginBottom:10 }}>{icon}</div>
    <div style={{ fontWeight:700, fontSize:15, color:"#0F172A", marginBottom:7 }}>{heading}</div>
    <div style={{ fontSize:12, color:"#64748B", lineHeight:1.7 }}>{desc}</div>
    <div style={{ marginTop:14 }}>
     <span style={{ display:"inline-block", background:accent, color:"#fff", fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:20 }}>
      {heading === "Manual" ? "Fill Form" : "Generate"}
     </span>
    </div>
   </div>
  );
  return (
   <div>
    <div style={{ fontSize:13, color:"#475569", marginBottom:18 }}>
     Creating {act.label} for <strong style={{ color:"#0F172A" }}>{lead.name}</strong> — {lead.destination}
    </div>
    <div style={{ display:"flex", gap:14, marginBottom:20 }}>
     <Card icon="✎" heading="Manual" desc={act.manualDesc} onClick={act.manual} accent="#1A6B8A"/>
     <Card icon="✦" heading="AI Generate" desc={act.aiDesc} onClick={act.ai} accent="#7C3AED"/>
    </div>
    <div style={{ textAlign:"right" }}>
     <Btn v="ghost" s={{ fontSize:12 }} onClick={closeModal}>Cancel</Btn>
    </div>
   </div>
  );
 })()}
 </Modal>
 {/* Loading */}
 <Modal open={modal?.type==="loading"} onClose={closeModal} title={modal?.title||"Processing…"}>
 <div style={{ textAlign:"center", padding:"30px 0" }}>
 <div style={{ width:40, height:40, border:"3px solid #D5E1EE", borderTopColor:"#4FC3F7", borderRadius:"50%", margin:"0 auto 16px", animation:"spin .8s linear infinite" }}/>
 <div className="shimmer" style={{ color:"#475569", fontSize:13 }}>Claude AI is working on this…</div>
 </div>
 </Modal>
 {/* Itinerary */}
 <Modal open={modal?.type==="itinerary"} onClose={closeModal} title={modal?.title} width={820}>
 {modal?.type==="itinerary" && modal?.data && (
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
 <Btn v="primary" icon="send" onClick={()=>doPickMethod(modal.lead,"quote")}>Request Quote from Vendors</Btn>
 </div>
 </div>
 )}
 </Modal>
 {/* Quote Email */}
 <Modal open={modal?.type==="quote"} onClose={closeModal} title={modal?.title} width={740}>
 {modal?.type==="quote" && modal?.data && (() => {
  const lines = (modal.data.body||"").split("\n");
  const hasSubject = lines[0] && !lines[0].startsWith(" ") && lines[1] === "";
  const subject = modal.data.subject ?? (hasSubject ? lines[0] : "");
  const bodyOnly = modal.data.subject !== undefined
   ? (modal.data.body||"")
   : (hasSubject ? lines.slice(2).join("\n") : (modal.data.body||""));
  const setBody = val => setModal(p => ({...p, data:{...p.data, body: val}}));
  const setSubject = val => setModal(p => ({...p, data:{...p.data, subject: val}}));
  return (
  <div>
   <div style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:10, padding:13, marginBottom:13 }}>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
     <span style={{ fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:1 }}>Query Code</span>
     <span style={{ fontWeight:700, color:"#4FC3F7" }}>{modal.data.qc}</span>
    </div>
    <div style={{ fontSize:12, color:"#64748B", marginBottom:8 }}>Select vendors to send this request to:</div>
    {modal.data.destVendors?.length ? (
     <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
      {modal.data.destVendors.map((v, i) => (
       <label key={v.id} style={{ display:"flex", alignItems:"center", gap:8, padding:8, borderRadius:10, border:"1px solid #E6ECF5", background:"#F8FAFC", fontSize:12, color:"#334155" }}>
        <input type="checkbox" checked={modal.data.selectedVendors?.includes(v.id)} onChange={e => setModal(p => ({ ...p, data: { ...p.data, selectedVendors: e.target.checked ? [...(p.data.selectedVendors||[]), v.id] : (p.data.selectedVendors||[]).filter(id => id !== v.id) } }))} />
        <span style={{ fontWeight:600 }}>{v.category||"Option"} Option {i+1} {"★".repeat(Math.min(Number(v.rating)||4,5))}</span>
       </label>
      ))}
     </div>
    ) : (
     <div style={{ fontSize:12, color:"#64748B" }}>No vendors registered for this destination yet. Register vendors first.</div>
    )}
   </div>
   <F label="Email Subject">
    <Inp value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject line…"/>
   </F>
   <F label="Email Body — edit freely before sending">
    <TA
     value={bodyOnly}
     onChange={e => setBody(e.target.value)}
     style={{ minHeight:200, fontFamily:"monospace", fontSize:12, lineHeight:1.7 }}
    />
   </F>
   <div style={{ display:"flex", gap:10, justifyContent:"flex-end", flexWrap:"wrap" }}>
    <Btn v="secondary" onClick={()=>regenerateQuoteEmail(modal.lead)} icon="refresh">Regenerate with AI</Btn>
    <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
    <Btn v="success" icon="send" onClick={()=>confirmQuote(modal.lead)}>Confirm & Send</Btn>
   </div>
  </div>
  );
 })()}
 </Modal>
 {/* Invoice */}
 <Modal open={modal?.type==="invoice"} onClose={closeModal} title={modal?.title} width={820}>
 {modal?.type==="invoice" && modal?.data && (() => {
  const invTaxRate = Number(modal.data.tax_rate ?? bizSettings.tax_rate ?? 5);
  const taxName = bizSettings.tax_name || "GST";
  const sym = bizSettings.currency_symbol||"₹";
  const cur = s => `${sym}${Number(s||0).toLocaleString(bizSettings.currency_locale||"en-IN")}`;
  const updInv = (k, v) => setModal(p => ({...p, data:{...p.data, [k]:v}}));
  const invDiscount = Number(modal.data.discount||0);
  const recalc = (items, rate, disc) => {
   const subtotal = items.reduce((s,it) => s + Number(it.amount||0), 0);
   const discount = disc !== undefined ? disc : invDiscount;
   const taxable = Math.max(0, subtotal - discount);
   const gst = Math.round(taxable * (rate/100));
   setModal(p => ({...p, data:{...p.data, items, subtotal, discount, tax_rate:rate, gst, total: taxable + gst}}));
  };
  const updItem = (i, k, v) => {
   const items = (modal.data.items||[]).map((it,idx) => {
    if (idx !== i) return it;
    const updated = {...it, [k]: v};
    if (k === "qty" || k === "rate") updated.amount = Math.round(Number(updated.qty||1) * Number(updated.rate||0));
    return updated;
   });
   recalc(items, invTaxRate, invDiscount);
  };
  const addItem = () => setModal(p => ({...p, data:{...p.data, items:[...(p.data.items||[]),{category:"Hotel",description:"",qty:1,rate:0,amount:0}]}}));
  const removeItem = i => recalc((modal.data.items||[]).filter((_,idx)=>idx!==i), invTaxRate, invDiscount);
  const changeTaxRate = v => recalc(modal.data.items||[], Number(v)||0, invDiscount);
  const changeDiscount = v => recalc(modal.data.items||[], invTaxRate, Number(v)||0);
  const paidAmt = Number(modal.data.paid_amount||0);
  const balDue = Math.max(0, Number(modal.data.total||0) - paidAmt);
  const catColors = {Hotel:"#1A6B8A",Flight:"#7c3aed",Transfer:"#0891b2",Visa:"#9333ea",Activity:"#d97706",Meal:"#16a34a",Insurance:"#6b7280",Miscellaneous:"#64748b"};
  return (
  <div>
   {/* Header fields */}
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr 1fr", gap:9, marginBottom:12 }}>
    <F label="Invoice No"><Inp value={modal.data.invoice_no||""} onChange={e=>updInv("invoice_no",e.target.value)}/></F>
    <F label="Client"><Inp value={modal.lead?.name||""} readOnly style={{ background:"#F6F8FC" }}/></F>
    <F label="Date"><Inp type="date" value={modal.data.date||""} onChange={e=>updInv("date",e.target.value)}/></F>
    <F label="Due Date"><Inp type="date" value={modal.data.due_date||""} onChange={e=>updInv("due_date",e.target.value)}/></F>
    <F label={`${taxName} Rate (%)`}><Inp type="number" value={invTaxRate} min={0} max={100} step={0.5} onChange={e=>changeTaxRate(e.target.value)}/></F>
    <F label="Status">
     <Sel value={modal.data.status||"Draft"} onChange={e=>updInv("status",e.target.value)}>
      {["Draft","Sent","Partially Paid","Paid","Overdue","Cancelled"].map(s=><option key={s}>{s}</option>)}
     </Sel>
    </F>
   </div>
   <F label="Payment Terms" s={{ marginBottom:12 }}>
    <Inp value={modal.data.payment_terms||""} onChange={e=>updInv("payment_terms",e.target.value)} placeholder="e.g. 50% advance, balance 7 days before departure"/>
   </F>
   {/* Line Items */}
   <div style={{ background:"#F8FAFC", border:"1px solid #E6ECF5", borderRadius:10, padding:12, marginBottom:12 }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
     <span style={{ fontSize:12, fontWeight:700, color:"#0F172A" }}>Line Items</span>
     <Btn v="secondary" s={{ fontSize:11, padding:"3px 10px" }} onClick={addItem}>+ Add Row</Btn>
    </div>
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
     <thead><tr style={{ background:"#EEF3F9" }}>
      {["Category","Description","Qty",`Rate (${sym})`,`Amount (${sym})`,""].map(h=><th key={h} style={{ padding:"6px 8px", textAlign:"left", color:"#475569", fontWeight:600, whiteSpace:"nowrap" }}>{h}</th>)}
     </tr></thead>
     <tbody>
      {(modal.data.items||[]).map((it,i)=>(
       <tr key={i} style={{ borderBottom:"1px solid #E6ECF5" }}>
        <td style={{ padding:"4px 4px", width:120 }}>
         <Sel value={it.category||"Hotel"} onChange={e=>updItem(i,"category",e.target.value)} style={{ padding:"4px 6px", fontSize:11, background:(catColors[it.category||"Hotel"]||"#64748b")+"18", color:catColors[it.category||"Hotel"]||"#64748b", fontWeight:600, border:"1px solid "+(catColors[it.category||"Hotel"]||"#64748b")+"44" }}>
          {INV_CATS.map(c=><option key={c}>{c}</option>)}
         </Sel>
        </td>
        <td style={{ padding:"4px 4px" }}><Inp value={it.description||""} onChange={e=>updItem(i,"description",e.target.value)} placeholder="Description…" style={{ fontSize:12 }}/></td>
        <td style={{ padding:"4px 4px", width:55 }}><Inp type="number" value={it.qty||1} onChange={e=>updItem(i,"qty",e.target.value)} min={1} style={{ fontSize:12 }}/></td>
        <td style={{ padding:"4px 4px", width:100 }}><Inp type="number" value={it.rate||0} onChange={e=>updItem(i,"rate",e.target.value)} min={0} style={{ fontSize:12 }}/></td>
        <td style={{ padding:"6px 8px", fontWeight:600, color:"#0F172A", whiteSpace:"nowrap" }}>{cur(it.amount)}</td>
        <td style={{ padding:"4px 4px", width:26 }}><button onClick={()=>removeItem(i)} style={{ background:"none", border:"none", cursor:"pointer", color:"#EF9A9A", fontSize:16, lineHeight:1 }}>×</button></td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>
   {/* Totals + Payment Summary */}
   <div style={{ display:"flex", justifyContent:"space-between", gap:16, marginBottom:12 }}>
    {/* Left: Notes */}
    <div style={{ flex:1 }}>
     <F label="Notes / Terms"><textarea value={modal.data.notes||""} onChange={e=>updInv("notes",e.target.value)} placeholder="Additional notes, visa info, cancellation policy…" style={{ width:"100%", padding:"7px 10px", border:"1px solid #D5E1EE", borderRadius:8, fontSize:12, fontFamily:"inherit", minHeight:76, resize:"vertical", background:"#fff", color:"#0F172A" }}/></F>
    </div>
    {/* Right: Totals */}
    <div style={{ minWidth:220, background:"#F8FAFC", border:"1px solid #E6ECF5", borderRadius:10, padding:"12px 14px", fontSize:13 }}>
     <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", color:"#64748B" }}><span>Subtotal</span><span>{cur(modal.data.subtotal)}</span></div>
     <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"4px 0", color:"#d97706" }}>
      <span>Discount (−{sym})</span>
      <input type="number" min={0} value={invDiscount} onChange={e=>changeDiscount(e.target.value)} style={{ width:80, padding:"2px 6px", border:"1px solid #fed7aa", borderRadius:5, fontSize:12, textAlign:"right", background:"#fffbeb" }}/>
     </div>
     <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", color:"#64748B" }}><span>{taxName} ({invTaxRate}%)</span><span>{cur(modal.data.gst)}</span></div>
     <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", fontWeight:700, fontSize:16, color:"#81C784", borderTop:"1px solid #E6ECF5", marginTop:4 }}><span>Total</span><span>{cur(modal.data.total)}</span></div>
     {paidAmt > 0 && <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", color:"#16a34a", fontSize:13 }}><span>Paid</span><span>− {cur(paidAmt)}</span></div>}
     {balDue > 0 && <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 10px", marginTop:6, background:"#FEF2F2", borderRadius:7, fontWeight:700, color:"#DC2626", fontSize:14 }}><span>Balance Due</span><span>{cur(balDue)}</span></div>}
     {balDue === 0 && paidAmt > 0 && <div style={{ textAlign:"center", padding:"6px", marginTop:6, background:"#F0FDF4", borderRadius:7, color:"#16a34a", fontWeight:700, fontSize:13 }}>✓ Fully Paid</div>}
    </div>
   </div>
   {/* Payment History (read-only in edit modal) */}
   {(modal.data.payments||[]).length > 0 && (
    <div style={{ background:"#F0FDF4", border:"1px solid #BBF7D0", borderRadius:10, padding:12, marginBottom:12 }}>
     <div style={{ fontSize:11, fontWeight:700, color:"#16a34a", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Payment History</div>
     <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
      <thead><tr style={{ background:"#DCFCE7" }}>{["Date","Method","Reference / Note","Amount"].map(h=><th key={h} style={{ padding:"5px 8px", textAlign:"left", color:"#15803d", fontWeight:600 }}>{h}</th>)}</tr></thead>
      <tbody>
       {(modal.data.payments||[]).map((p,i)=>(
        <tr key={i} style={{ borderBottom:"1px solid #D1FAE5" }}>
         <td style={{ padding:"5px 8px" }}>{p.date}</td>
         <td style={{ padding:"5px 8px" }}>{p.method}</td>
         <td style={{ padding:"5px 8px", color:"#64748b" }}>{p.ref||p.note||"—"}</td>
         <td style={{ padding:"5px 8px", fontWeight:600, color:"#16a34a" }}>{cur(p.amount)}</td>
        </tr>
       ))}
      </tbody>
     </table>
    </div>
   )}
   <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:4 }}>
    <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
    <Btn v="success" icon="check" onClick={saveInvoice}>{invoices.some(x=>x.id===modal.data?.id) ? "Update Invoice" : "Save Invoice"}</Btn>
   </div>
  </div>
  );
 })()}
 </Modal>
 {/* Record Payment */}
 <Modal open={modal?.type==="recordPayment"} onClose={closeModal} title={modal?.title} width={480}>
 {modal?.type==="recordPayment" && modal?.data && (() => {
  const d = modal.data;
  const sym = bizSettings.currency_symbol||"₹";
  const cur = n => `${sym}${Number(n||0).toLocaleString(bizSettings.currency_locale||"en-IN")}`;
  const upd = (k,v) => setModal(p=>({...p,data:{...p.data,[k]:v}}));
  const bal = Math.max(0, Number(d.balance||0));
  return (
  <div>
   {/* Invoice summary */}
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, background:"#F8FAFC", border:"1px solid #E6ECF5", borderRadius:10, padding:12, marginBottom:14 }}>
    <div><div style={{ fontSize:10, color:"#94A3B8", textTransform:"uppercase", letterSpacing:1, marginBottom:2 }}>Invoice Total</div><div style={{ fontWeight:700, fontSize:16, color:"#0F172A" }}>{cur(d.total)}</div></div>
    <div><div style={{ fontSize:10, color:"#94A3B8", textTransform:"uppercase", letterSpacing:1, marginBottom:2 }}>Already Paid</div><div style={{ fontWeight:700, fontSize:16, color:"#16a34a" }}>{cur(d.paid_amount)}</div></div>
    <div><div style={{ fontSize:10, color:"#94A3B8", textTransform:"uppercase", letterSpacing:1, marginBottom:2 }}>Balance Due</div><div style={{ fontWeight:700, fontSize:16, color:"#DC2626" }}>{cur(bal)}</div></div>
   </div>
   {/* Quick-select amount buttons */}
   <div style={{ marginBottom:12 }}>
    <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.8, fontWeight:700, marginBottom:6 }}>Quick Select</div>
    <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
     {[["25% Advance", Math.round(Number(d.total||0)*0.25)], ["50% Advance", Math.round(Number(d.total||0)*0.5)], ["Full Payment", bal]].map(([label, amt]) => (
      <button key={label} onClick={()=>upd("amount", String(amt))}
       style={{ background: Number(d.amount||0)===amt ? "#0D2030" : "#F1F5F9", color: Number(d.amount||0)===amt ? "#fff" : "#334155", border:"1px solid #CBD5E1", borderRadius:6, padding:"5px 11px", fontSize:12, cursor:"pointer", fontWeight:600, transition:"all .15s" }}>
       {label} · {cur(amt)}
      </button>
     ))}
    </div>
   </div>
   {/* Payment form */}
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:12 }}>
    <F label={`Amount (${sym})`} req>
     <Inp type="number" value={d.amount||""} onChange={e=>upd("amount",e.target.value)} min={1} max={bal||undefined} placeholder={`Enter amount (max ${cur(bal)})`} style={{ fontWeight:600 }}/>
    </F>
    <F label="Payment Date" req>
     <Inp type="date" value={d.date||""} onChange={e=>upd("date",e.target.value)}/>
    </F>
    <F label="Payment Method">
     <Sel value={d.method||"Bank Transfer"} onChange={e=>upd("method",e.target.value)}>
      {["Bank Transfer","UPI / GPay","Cash","Cheque","Credit Card","Debit Card","Other"].map(m=><option key={m}>{m}</option>)}
     </Sel>
    </F>
    <F label="Reference / UTR No">
     <Inp value={d.ref||""} onChange={e=>upd("ref",e.target.value)} placeholder="UTR / transaction ID"/>
    </F>
   </div>
   <F label="Note (optional)" s={{ marginBottom:12 }}>
    <Inp value={d.note||""} onChange={e=>upd("note",e.target.value)} placeholder="e.g. Advance payment, final settlement…"/>
   </F>
   {/* Payment status indicator */}
   {Number(d.amount||0) > 0 && bal > 0 && (
    Number(d.amount||0) >= bal
     ? <div style={{ background:"#F0FDF4", border:"1px solid #BBF7D0", borderRadius:8, padding:"8px 12px", fontSize:12, color:"#16a34a", fontWeight:600, marginBottom:12 }}>
        This payment will mark the invoice as <strong>Fully Paid</strong> ✓
       </div>
     : <div style={{ background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:8, padding:"8px 12px", fontSize:12, color:"#92400E", fontWeight:600, marginBottom:12 }}>
        Partial payment · Balance remaining: <strong>{cur(bal - Number(d.amount||0))}</strong>
       </div>
   )}
   {/* Previous payments history */}
   {(d.payments||[]).length > 0 && (
    <div style={{ marginBottom:14 }}>
     <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.8, fontWeight:700, marginBottom:6 }}>Payment History</div>
     <div style={{ background:"#F8FAFC", border:"1px solid #E6ECF5", borderRadius:8, overflow:"hidden" }}>
      {(d.payments||[]).map((py,i) => (
       <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 12px", borderBottom: i<(d.payments||[]).length-1 ? "1px solid #E6ECF5" : "none", fontSize:12 }}>
        <span style={{ color:"#64748B" }}>{py.date} · {py.method||"—"}{py.ref ? ` · ${py.ref}` : ""}</span>
        <span style={{ fontWeight:700, color:"#16a34a" }}>{cur(py.amount)}</span>
       </div>
      ))}
     </div>
    </div>
   )}
   <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
    <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
    <Btn v="success" icon="check" onClick={saveRecordedPayment}>Record Payment</Btn>
   </div>
  </div>
  );
 })()}
 </Modal>
 {/* Voucher */}
 <Modal open={modal?.type==="voucher"} onClose={closeModal} title={modal?.title} width={720}>
 {modal?.type==="voucher" && modal?.data && (() => {
  const updV = (k, v) => setModal(p => ({...p, data:{...p.data, [k]:v}}));
  const vt = modal.data.voucher_type||"Hotel";
  const vtColor = { Hotel:"#1A6B8A", Flight:"#7c3aed", Transfer:"#0891b2", Activity:"#d97706", Package:"#0D2030" }[vt]||"#1A6B8A";
  return (
  <div>
   {/* Type selector */}
   <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16, padding:"10px 14px", background:"#f8fafc", borderRadius:10, border:"1px solid #e2e8f0" }}>
    <span style={{ fontSize:12, fontWeight:700, color:"#64748b", whiteSpace:"nowrap" }}>Voucher Type:</span>
    <Sel value={vt} onChange={e=>updV("voucher_type",e.target.value)} style={{ flex:1, fontWeight:700, color:vtColor, background:vtColor+"12", border:"1px solid "+vtColor+"44" }}>
     <option value="Hotel">🏨  Hotel Voucher</option>
     <option value="Flight">✈️  Flight Voucher</option>
     <option value="Transfer">🚗  Transfer Voucher</option>
     <option value="Activity">🎯  Activity Voucher</option>
     <option value="Package">📦  Package Voucher</option>
    </Sel>
   </div>
   {/* Common fields */}
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:11 }}>
    <F label="Voucher No"><Inp value={modal.data.voucher_no||""} onChange={e=>updV("voucher_no",e.target.value)}/></F>
    <F label="Guest / Client Name"><Inp value={modal.data.client_name||""} onChange={e=>updV("client_name",e.target.value)}/></F>
    <F label="Adults"><Inp type="number" min={1} value={modal.data.adults||1} onChange={e=>updV("adults",Number(e.target.value))}/></F>
    <F label="Kids"><Inp type="number" min={0} value={modal.data.kids||0} onChange={e=>updV("kids",Number(e.target.value))}/></F>
   </div>
   {/* Hotel fields */}
   {vt==="Hotel" && <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:11 }}>
    <F label="Hotel Name"><Inp value={modal.data.hotel||""} onChange={e=>updV("hotel",e.target.value)} placeholder="Hotel name"/></F>
    <F label="Destination"><Inp value={modal.data.destination||""} onChange={e=>updV("destination",e.target.value)}/></F>
    <F label="Check-In"><Inp type="date" value={modal.data.travel_date||""} onChange={e=>updV("travel_date",e.target.value)}/></F>
    <F label="Check-Out"><Inp type="date" value={modal.data.return_date||""} onChange={e=>updV("return_date",e.target.value)}/></F>
    <F label="Room Type"><SelectOrAdd value={modal.data.room_type||""} options={refData?.room_types||[]} onChange={v=>updV("room_type",v)} onAddNew={()=>{}} placeholder="Select room type…"/></F>
    <F label="Meal Plan"><SelectOrAdd value={modal.data.meal_plan||""} options={refData?.meal_plans||[]} onChange={v=>updV("meal_plan",v)} onAddNew={()=>{}} placeholder="Select meal plan…"/></F>
    <F label="Booking Ref"><Inp value={modal.data.booking_ref||""} onChange={e=>updV("booking_ref",e.target.value)}/></F>
    <F label="Special Requests"><Inp value={modal.data.special_requests||""} onChange={e=>updV("special_requests",e.target.value)}/></F>
   </div>}
   {/* Flight fields */}
   {vt==="Flight" && <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:11 }}>
    <F label="Airline"><SelectOrAdd value={modal.data.airline||""} options={refData?.airlines||[]} onChange={v=>updV("airline",v)} onAddNew={()=>{}} placeholder="Select airline…"/></F>
    <F label="Flight No"><Inp value={modal.data.flight_no||""} onChange={e=>updV("flight_no",e.target.value)} placeholder="6E-201"/></F>
    <F label="PNR"><Inp value={modal.data.pnr||""} onChange={e=>updV("pnr",e.target.value)}/></F>
    <F label="Date"><Inp type="date" value={modal.data.travel_date||""} onChange={e=>updV("travel_date",e.target.value)}/></F>
    <F label="From (Origin)"><Inp value={modal.data.from||""} onChange={e=>updV("from",e.target.value)} placeholder="DEL"/></F>
    <F label="To (Destination)"><Inp value={modal.data.to||""} onChange={e=>updV("to",e.target.value)} placeholder="BOM"/></F>
    <F label="Class"><SelectOrAdd value={modal.data.travel_class||""} options={refData?.flight_classes||[]} onChange={v=>updV("travel_class",v)} onAddNew={()=>{}} placeholder="Select class…"/></F>
    <F label="Baggage Allowance"><Inp value={modal.data.baggage||""} onChange={e=>updV("baggage",e.target.value)} placeholder="15kg + 7kg"/></F>
    <F label="Passenger(s)" style={{ gridColumn:"1/-1" }}><Inp value={modal.data.passengers||""} onChange={e=>updV("passengers",e.target.value)} placeholder="Comma-separated names"/></F>
   </div>}
   {/* Transfer fields */}
   {vt==="Transfer" && <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:11 }}>
    <F label="Vehicle Type"><SelectOrAdd value={modal.data.vehicle_type||""} options={refData?.vehicle_types||[]} onChange={v=>updV("vehicle_type",v)} onAddNew={()=>{}} placeholder="Select vehicle…"/></F>
    <F label="Date"><Inp type="date" value={modal.data.travel_date||""} onChange={e=>updV("travel_date",e.target.value)}/></F>
    <F label="Pickup From"><Inp value={modal.data.pickup_from||""} onChange={e=>updV("pickup_from",e.target.value)} placeholder="Airport, Hotel…"/></F>
    <F label="Drop To"><Inp value={modal.data.drop_to||""} onChange={e=>updV("drop_to",e.target.value)} placeholder="Hotel, Airport…"/></F>
    <F label="Pickup Time"><Inp value={modal.data.pickup_time||""} onChange={e=>updV("pickup_time",e.target.value)} placeholder="10:30 AM"/></F>
    <F label="Driver Name"><Inp value={modal.data.driver_name||""} onChange={e=>updV("driver_name",e.target.value)}/></F>
    <F label="Driver Contact"><Inp value={modal.data.driver_contact||""} onChange={e=>updV("driver_contact",e.target.value)}/></F>
   </div>}
   {/* Activity fields */}
   {vt==="Activity" && <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:11 }}>
    <F label="Activity Name"><Inp value={modal.data.activity_name||""} onChange={e=>updV("activity_name",e.target.value)} placeholder="Desert Safari, Scuba…"/></F>
    <F label="Destination"><Inp value={modal.data.destination||""} onChange={e=>updV("destination",e.target.value)}/></F>
    <F label="Date"><Inp type="date" value={modal.data.travel_date||""} onChange={e=>updV("travel_date",e.target.value)}/></F>
    <F label="Time"><Inp value={modal.data.activity_time||""} onChange={e=>updV("activity_time",e.target.value)} placeholder="9:00 AM"/></F>
    <F label="Meeting Point"><Inp value={modal.data.meeting_point||""} onChange={e=>updV("meeting_point",e.target.value)}/></F>
    <F label="Operator / Guide"><Inp value={modal.data.operator||""} onChange={e=>updV("operator",e.target.value)}/></F>
    <F label="Operator Contact"><Inp value={modal.data.operator_contact||""} onChange={e=>updV("operator_contact",e.target.value)}/></F>
   </div>}
   {/* Package fields */}
   {vt==="Package" && <div>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:11, marginBottom:11 }}>
     <div style={{ gridColumn:"1/-1" }}><F label="Package Title"><Inp value={modal.data.package_title||""} onChange={e=>updV("package_title",e.target.value)} placeholder="Bali 5N/6D – Honeymoon Package"/></F></div>
     <F label="Travel Date"><Inp type="date" value={modal.data.travel_date||""} onChange={e=>updV("travel_date",e.target.value)}/></F>
     <F label="Return Date"><Inp type="date" value={modal.data.return_date||""} onChange={e=>updV("return_date",e.target.value)}/></F>
     <F label="Duration"><Inp value={modal.data.duration||""} onChange={e=>updV("duration",e.target.value)} placeholder="5 Nights / 6 Days"/></F>
    </div>
    <div style={{ background:"#f0f9ff", borderRadius:8, padding:"10px 12px", marginBottom:10, border:"1px solid #bae6fd" }}>
     <div style={{ fontSize:11, fontWeight:700, color:"#0369a1", marginBottom:8 }}>🏨 Accommodation (optional)</div>
     <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:11 }}>
      <div style={{ gridColumn:"1/-1" }}><F label="Hotel Name"><Inp value={modal.data.hotel||""} onChange={e=>updV("hotel",e.target.value)}/></F></div>
      <F label="Room Type"><Inp value={modal.data.room_type||""} onChange={e=>updV("room_type",e.target.value)} placeholder="Deluxe, Suite…"/></F>
      <F label="Meal Plan"><Inp value={modal.data.meal_plan||""} onChange={e=>updV("meal_plan",e.target.value)} placeholder="CP, MAP, AP…"/></F>
     </div>
    </div>
    <div style={{ background:"#f5f3ff", borderRadius:8, padding:"10px 12px", marginBottom:10, border:"1px solid #ddd6fe" }}>
     <div style={{ fontSize:11, fontWeight:700, color:"#7c3aed", marginBottom:8 }}>✈️ Flight (optional)</div>
     <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:11 }}>
      <F label="Airline"><Inp value={modal.data.airline||""} onChange={e=>updV("airline",e.target.value)}/></F>
      <F label="Flight No"><Inp value={modal.data.flight_no||""} onChange={e=>updV("flight_no",e.target.value)} placeholder="6E-201"/></F>
      <F label="PNR"><Inp value={modal.data.pnr||""} onChange={e=>updV("pnr",e.target.value)}/></F>
     </div>
    </div>
    <div style={{ background:"#ecfeff", borderRadius:8, padding:"10px 12px", marginBottom:10, border:"1px solid #a5f3fc" }}>
     <div style={{ fontSize:11, fontWeight:700, color:"#0891b2", marginBottom:8 }}>🚗 Transfer (optional)</div>
     <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:11 }}>
      <F label="Vehicle Type"><Inp value={modal.data.vehicle_type||""} onChange={e=>updV("vehicle_type",e.target.value)} placeholder="Sedan, SUV…"/></F>
      <F label="Pickup From"><Inp value={modal.data.pickup_from||""} onChange={e=>updV("pickup_from",e.target.value)}/></F>
      <F label="Drop To"><Inp value={modal.data.drop_to||""} onChange={e=>updV("drop_to",e.target.value)}/></F>
     </div>
    </div>
    <F label="Activities (optional)"><Inp value={modal.data.activities||""} onChange={e=>updV("activities",e.target.value)} placeholder="Desert Safari, City Tour, Snorkeling…"/></F>
    <div style={{ marginTop:8 }}><F label="Exclusions (comma-separated)"><Inp value={(modal.data.exclusions||[]).join(", ")} onChange={e=>updV("exclusions", e.target.value.split(",").map(s=>s.trim()).filter(Boolean))} placeholder="Airfare, Visa fees, Personal expenses…"/></F></div>
   </div>}
   {/* Common bottom fields */}
   <F label="Inclusions (comma-separated)">
    <Inp value={(modal.data.inclusions||[]).join(", ")} onChange={e=>updV("inclusions", e.target.value.split(",").map(s=>s.trim()).filter(Boolean))} placeholder="Breakfast, Airport Transfer, City Tour…"/>
   </F>
   <F label="Special Notes" style={{ marginTop:8 }}>
    <TA value={modal.data.special_notes||""} onChange={e=>updV("special_notes",e.target.value)} style={{ minHeight:60 }} placeholder="Any special arrangements, dietary needs…"/>
   </F>
   <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:14 }}>
    <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
    <Btn v="success" icon="check" onClick={saveVoucher}>{vouchers.some(x=>x.id===modal.data?.id) ? "Update Voucher" : "Save Voucher"}</Btn>
   </div>
  </div>
  );
 })()}
 </Modal>
 {/* Upload Result — full edit + lead link form */}
 <Modal open={modal?.type==="uploadResult"} onClose={closeModal} title="Edit & Save Vendor Quote" width={820}>
 {modal?.type==="uploadResult" && modal?.data && (() => {
  const d = modal.data;
  const fld = k => e => setModal(p => ({ ...p, data: { ...p.data, [k]: e.target.value } }));
  const totalCost = Number(d.total_cost) || 0;
  const markupPct = Number(d.markup_pct) || bizSettings.default_markup_pct || 22;
  const finalCost = d.final_cost_override != null
   ? Number(d.final_cost_override)
   : Math.round(totalCost * (1 + markupPct / 100));
  const perPerson = Number(d.pax) > 0 ? Math.round(finalCost / Number(d.pax)) : 0;
  const leadItins = itineraries.filter(it => it.lead_id === d.linked_lead_id);
  return (
  <div>
   <div style={{ fontSize:11, color:"#94A3B8", marginBottom:14 }}>📄 {d.file_name}</div>

   {/* ── Editable fields ── */}
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
    <F label="Vendor / Tour Operator"><Inp value={d.vendor_name||""} onChange={fld("vendor_name")} placeholder="Hotel or tour operator name"/></F>
    <F label="Destination"><Inp value={d.destination||""} onChange={fld("destination")} placeholder="Vietnam, Bali…"/></F>
    <F label="Hotel Name"><Inp value={d.hotel_name||""} onChange={fld("hotel_name")} placeholder="Hotel name"/></F>
    <F label="Room Type"><Inp value={d.room_type||""} onChange={fld("room_type")} placeholder="Deluxe, Suite…"/></F>
    <F label="Pax (total travellers)"><Inp type="number" value={d.pax||""} onChange={fld("pax")} min={1}/></F>
    <F label="Valid Till"><Inp type="date" value={d.valid_till||""} onChange={fld("valid_till")}/></F>
   </div>
   <F label="Inclusions (comma-separated)">
    <TA
     value={(Array.isArray(d.inclusions) ? d.inclusions : []).join(", ")}
     onChange={e => setModal(p => ({ ...p, data: { ...p.data, inclusions: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } }))}
     style={{ minHeight:55 }}
    />
   </F>
   <F label="Notes"><TA value={d.notes||""} onChange={fld("notes")} style={{ minHeight:50 }}/></F>

   {/* ── Pricing ── */}
   <div style={{ background:"#F6F8FC", border:"1px solid #E6ECF5", borderRadius:10, padding:14, marginBottom:14 }}>
    <div style={{ fontWeight:700, color:"#0F172A", fontSize:13, marginBottom:12 }}>Pricing</div>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
     <F label="Vendor Cost (₹)">
      <Inp type="number" value={d.total_cost||""} placeholder="0"
       onChange={e => setModal(p => ({ ...p, data: { ...p.data, total_cost: e.target.value, final_cost_override: null } }))}/>
     </F>
     <F label="Markup %">
      <Inp type="number" value={d.markup_pct||22} min={0} max={200}
       onChange={e => setModal(p => ({ ...p, data: { ...p.data, markup_pct: e.target.value, final_cost_override: null } }))}/>
     </F>
     <F label="Final Price to Client (₹)">
      <Inp type="number" value={finalCost||""} placeholder="auto-calculated"
       onChange={e => setModal(p => ({ ...p, data: { ...p.data, final_cost_override: e.target.value } }))}/>
     </F>
    </div>
    <div style={{ display:"flex", gap:20, marginTop:6, fontSize:12, color:"#64748B" }}>
     <span>Per person: <strong style={{ color:"#0F172A" }}>₹{perPerson.toLocaleString("en-IN")}</strong></span>
     <span>Markup amount: <strong style={{ color:"#FFB74D" }}>₹{(finalCost - totalCost).toLocaleString("en-IN")}</strong></span>
    </div>
   </div>

   {/* ── Link to Lead & Itinerary ── */}
   <div style={{ background:"#FFFFFF", border:"2px solid #4FC3F733", borderRadius:10, padding:14, marginBottom:16 }}>
    <div style={{ fontWeight:700, color:"#0F172A", fontSize:13, marginBottom:4 }}>Link to Lead & Itinerary</div>
    <div style={{ fontSize:12, color:"#64748B", marginBottom:12 }}>Select the lead this quote belongs to. The lead's status will update to "Quote Received".</div>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
     <F label="Select Lead" req>
      <Sel value={d.linked_lead_id||""}
       onChange={e => setModal(p => ({ ...p, data: { ...p.data, linked_lead_id: e.target.value, linked_itinerary_id: "" } }))}>
       <option value="">— Select lead —</option>
       {leads.map(l => <option key={l.id} value={l.id}>{l.name} · {l.destination}</option>)}
      </Sel>
     </F>
     <F label="Link to Itinerary (optional)">
      <Sel value={d.linked_itinerary_id||""}
       onChange={e => setModal(p => ({ ...p, data: { ...p.data, linked_itinerary_id: e.target.value } }))}>
       <option value="">— No itinerary —</option>
       {leadItins.map(it => <option key={it.id} value={it.id}>{it.title||it.destination} (v{it.version||1})</option>)}
      </Sel>
     </F>
    </div>
   </div>

   <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
    <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
    <Btn v="success" icon="check" onClick={saveVendorQuote}>Save & Link to Lead</Btn>
   </div>
  </div>
  );
 })()}
 </Modal>

 {/* Task Create */}
 <Modal open={modal?.type==="taskCreate"} onClose={closeModal} title={modal?.title || "Add / Assign Task"} width={700}>
 {modal?.type==="taskCreate" && modal?.data && (
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
 {(bizSettings.task_priorities||["Low","Medium","High"]).map(p=><option key={p}>{p}</option>)}
 </Sel>
 </F>
 <F label="Status">
 <Sel value={modal.data.status} onChange={e=>setModal(p=>({...p,data:{...p.data,status:e.target.value}}))}>
 {(bizSettings.task_statuses||["Open","In Progress","Done"]).map(s=><option key={s}>{s}</option>)}
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

 {/* Preview Modal */}
 <Modal open={modal?.type==="preview"} onClose={closeModal} title={modal?.title||"Preview"} width={800}>
 {modal?.type==="preview" && modal?.data && (() => {
  const { docType, doc, template, templates } = modal.data;
  const setTpl = t => setModal(p=>({...p, data:{...p.data, template:t}}));
  let html = "";
  if (docType==="invoice") html = genInvoiceHTML(doc, template, bizSettings);
  else if (docType==="voucher") html = genVoucherHTML(doc, template, bizSettings);
  else if (docType==="quote") html = genQuoteHTML(doc, template, bizSettings);
  else if (docType==="itinerary") html = genItinHTML(doc, template, bizSettings, companyProfile);
  const print = async () => {
   // Inline the cover image as a data URI so Chrome's blob-URL print renderer doesn't drop it
   let printDoc = doc;
   if (docType === "itinerary") {
    const coverSrc = doc.cover_image_url;
    try {
     if (coverSrc?.startsWith("data:")) {
      // Already a data URI — just compress it
      const small = await compressImgForPrint(coverSrc);
      printDoc = { ...doc, cover_image_url: small };
     } else if (coverSrc) {
      // External URL — fetch and convert to data URI so it prints from blob context
      const resp = await fetch(coverSrc);
      const blob2 = await resp.blob();
      const dataUrl = await new Promise(res => { const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(blob2); });
      const small = await compressImgForPrint(dataUrl);
      printDoc = { ...doc, cover_image_url: small };
     }
    } catch { /* keep original if fetch fails */ }
   }
   const printHtml = docType === "itinerary"
    ? genItinHTML(printDoc, template, bizSettings, companyProfile)
    : html;
   // Add a self-contained script that waits for all images to be decoded before printing
   const printScript = `<script>(function(){var t=Date.now();function go(){var ok=[].slice.call(document.querySelectorAll('img')).every(function(i){return i.complete;});if(ok||Date.now()-t>10000){window.print();}else{setTimeout(go,120);}}if(document.readyState==='complete'){setTimeout(go,200);}else{window.addEventListener('load',function(){setTimeout(go,200);});}}());<\/script>`;
   const printFull = printHtml.replace('</body>', printScript + '\n</body>');
   const blob = new Blob([printFull], { type: "text/html; charset=utf-8" });
   const blobUrl = URL.createObjectURL(blob);
   window.open(blobUrl, "_blank");
   setTimeout(() => URL.revokeObjectURL(blobUrl), 300000);
  };
  const openEmailModal = async () => {
   const lead = leads.find(l => l.id === doc.lead_id);
   const stripData = v => (!v || v.startsWith("data:")) ? "" : v;
   let emailCover = doc.cover_image_url || "";
   if (emailCover.startsWith("data:")) {
    try {
     const small = await compressImgForPrint(emailCover, 800, 0.72);
     emailCover = await uploadTempImg(small) || "";
    } catch { emailCover = ""; }
   }
   const emailDoc = {
    ...doc,
    cover_image_url: emailCover,
    hotels: (doc.hotels||[]).map(h=>({...h, image_url:stripData(h.image_url)})),
    option2_hotels: (doc.option2_hotels||[]).map(h=>({...h, image_url:stripData(h.image_url)})),
    days: (doc.days||[]).map(d=>({...d, image_url:stripData(d.image_url)})),
   };
   setEmailDocModal({
    to: lead?.email || "",
    leadName: lead?.name || doc.lead_name || "",
    subject: `Your Itinerary — ${doc.destination||doc.title||"Your Trip"} | ${companyProfile?.name||bizSettings?.from_name||"Safarnaama"}`,
    html: genItinHTML(emailDoc, template, bizSettings, companyProfile),
   });
  };
  const openWaModal = () => {
   const lead = leads.find(l => l.id === doc.lead_id);
   setWaItinModal({ itin: doc, lead });
  };
  return (
   <div>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
     <div style={{ display:"flex", gap:8 }}>
      {templates.map(t => (
       <button key={t} onClick={()=>setTpl(t)} style={{ padding:"6px 16px", borderRadius:20, border:"none", cursor:"pointer", fontSize:13, fontWeight:600, background:t===template?"#1A6B8A":"#f0f4f8", color:t===template?"#fff":"#374151", transition:"all .15s" }}>{t}</button>
      ))}
     </div>
     <div style={{ display:"flex", gap:8 }}>
      {docType==="itinerary" && (<>
       <Btn v="secondary" icon="email" s={{ fontSize:12 }} onClick={openEmailModal}>Email to Lead</Btn>
       <Btn s={{ background:"#25D366", color:"#fff", border:"none", fontSize:12, borderRadius:8, padding:"7px 14px", cursor:"pointer", fontWeight:600 }} onClick={openWaModal}>💬 WhatsApp</Btn>
      </>)}
      <Btn v="secondary" s={{ fontSize:12 }} onClick={print}>Print / Save PDF</Btn>
     </div>
    </div>
    <PreviewFrame html={html}/>
    <div style={{ display:"flex", justifyContent:"flex-end", marginTop:12 }}>
     <Btn v="ghost" onClick={closeModal}>Close</Btn>
    </div>
   </div>
  );
 })()}
 </Modal>

 {emailDocModal && <SendItinEmailModal data={emailDocModal} onClose={()=>setEmailDocModal(null)} toast$={toast$}/>}
 {waItinModal && <SendItinWhatsAppModal data={waItinModal} onClose={()=>setWaItinModal(null)} companyProfile={companyProfile} bizSettings={bizSettings}/>}
 </div>
 );
}
// ─── PAGE: DASHBOARD ──────────────────────────────────────────────────────────
function PageDashboard({ leads, quotes, invoices, vendors, tasks, itineraries, setPage, bizSettings }) {
 const leadStatuses = bizSettings?.lead_statuses || ["New","Contacted","Proposal Sent","Negotiation","Won","Lost"];
 const sym = bizSettings?.currency_symbol||"₹";
 const cur = n => `${sym}${Number(n||0).toLocaleString(bizSettings?.currency_locale||"en-IN")}`;
 const todayStr = today();
 const nowMs = Date.now();
 const thirtyDaysMs = 30 * 86400000;
 // KPI calculations
 const weekAgo = new Date(nowMs - 7*86400000).toISOString().split("T")[0];
 const newThisWeek    = leads.filter(l => (l.created_at||"") >= weekAgo).length;
 const followupsToday = leads.filter(l => l.follow_up_date === todayStr).length;
 const followupsOverdue = leads.filter(l => l.follow_up_date && l.follow_up_date < todayStr && l.status !== "Won" && l.status !== "Lost").length;
 const upcomingDepsLeads = leads.filter(l => l.travel_date && l.travel_date >= todayStr && (new Date(l.travel_date).getTime() - nowMs) <= thirtyDaysMs).sort((a,b)=>a.travel_date>b.travel_date?1:-1);
 const currentMonth = todayStr.slice(0,7);
 const revenueThisMonth = invoices.filter(i => (i.date||"").startsWith(currentMonth)).reduce((s,i) => s + Number(i.paid_amount||0), 0);
 const totalOutstanding  = invoices.reduce((s,i) => s + Math.max(0, Number(i.total||0) - Number(i.paid_amount||0)), 0);
 const pendingItins = itineraries ? itineraries.filter(it => it.status === "Draft" || it.status === "Confirmed").length : 0;
 const kpis = [
  { label:"Total Leads",      value:leads.length,      sub:`+${newThisWeek} this week`,       color:"#4FC3F7", bg:"#E0F7FA",   icon:"leads",    page:"leads" },
  { label:"Follow-ups Today", value:followupsToday,    sub:followupsOverdue>0?`${followupsOverdue} overdue`:"All on track",  color:followupsToday>0?"#d97706":"#64748b", bg:followupsToday>0?"#FFFBEB":"#F8FAFC", icon:"task", page:"leads" },
  { label:"Upcoming Trips",   value:upcomingDepsLeads.length, sub:"within 30 days",           color:"#7c3aed", bg:"#F3E8FF",   icon:"itinerary",page:"leads" },
  { label:"Revenue This Month",value:cur(revenueThisMonth), sub:"collected",                   color:"#16a34a", bg:"#F0FDF4",   icon:"check",    page:"invoices" },
  { label:"Outstanding",      value:cur(totalOutstanding),  sub:"total balance due",           color:"#dc2626", bg:"#FEF2F2",   icon:"vendor",   page:"invoices" },
  { label:"Confirmed Bookings",value:leads.filter(l=>l.status==="Confirmed"||l.status==="Won").length, sub:"total",  color:"#81C784", bg:"#F0FDF4", icon:"check", page:"leads" },
 ];
 return (
 <div>
  {/* KPI Grid */}
  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:20 }}>
  {kpis.map(k => (
   <div key={k.label} className="card" onClick={()=>setPage(k.page)} style={{ background:k.bg, border:`1px solid ${k.color}33`, borderRadius:12, padding:"16px 18px", cursor:"pointer", transition:"transform .15s, box-shadow .15s" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
     <div>
      <div style={{ fontSize:10, color:"#64748b", textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>{k.label}</div>
      <div style={{ fontSize:26, fontWeight:800, color:k.color, fontFamily:"'Playfair Display',serif", lineHeight:1 }}>{k.value}</div>
      <div style={{ fontSize:11, color:"#94a3b8", marginTop:5 }}>{k.sub}</div>
     </div>
     <div style={{ color:k.color, opacity:.4 }}><Icon name={k.icon} size={22}/></div>
    </div>
   </div>
  ))}
  </div>

  <div style={{ display:"grid", gridTemplateColumns:"3fr 2fr", gap:14, marginBottom:14 }}>
   {/* Recent Leads */}
   <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:18 }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
     <span style={{ fontWeight:700, color:"#0F172A", fontSize:14 }}>Recent Leads</span>
     <Btn v="ghost" s={{ fontSize:11, color:"#4FC3F7" }} onClick={()=>setPage("leads")}>View All →</Btn>
    </div>
    {leads.slice(0,7).map(l => (
     <div key={l.id} className="row" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 6px", borderBottom:"1px solid #EEF3F9", borderRadius:6 }}>
      <div>
       <div style={{ fontWeight:600, color:"#0F172A", fontSize:13 }}>{l.name}</div>
       <div style={{ fontSize:11, color:"#475569" }}>{l.destination} · {l.pax}A{l.kids>0?` ${l.kids}K`:""}
        {l.source && <span style={{ marginLeft:6, background:"#E0F7FA", color:"#0284C7", borderRadius:4, padding:"1px 5px", fontSize:10 }}>{l.source}</span>}
       </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
       <span style={{ fontSize:11, color:"#64748B" }}>{l.travel_date}</span>
       <Badge status={l.status}/>
      </div>
     </div>
    ))}
    {leads.length===0 && <div style={{ padding:30, textAlign:"center", color:"#94A3B8", fontSize:13 }}>No leads yet. Use AI Chat to add one!</div>}
   </div>

   {/* Right panel: Pipeline + Follow-ups */}
   <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
    {/* Pipeline */}
    <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:18 }}>
     <div style={{ fontWeight:700, color:"#0F172A", fontSize:13, marginBottom:12 }}>Sales Pipeline</div>
     {leadStatuses.map((s,idx) => {
      const palette=["#4FC3F7","#64B5F6","#BA68C8","#FFB74D","#81C784","#EF9A9A","#90A4AE","#CE93D8"];
      const c = palette[idx % palette.length];
      const cnt = leads.filter(l=>l.status===s).length;
      return (
       <div key={s} style={{ marginBottom:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#64748B", marginBottom:3 }}><span>{s}</span><span style={{ color:c, fontWeight:700 }}>{cnt}</span></div>
        <div style={{ height:4, background:"#F6F8FC", borderRadius:3 }}><div style={{ height:"100%", width:leads.length?`${(cnt/leads.length)*100}%`:"0%", background:c, borderRadius:3, transition:"width .6s" }}/></div>
       </div>
      );
     })}
    </div>
    {/* Follow-ups due today */}
    {followupsToday > 0 && (
     <div style={{ background:"#FFFBEB", border:"1px solid #FDE68A", borderRadius:12, padding:14 }}>
      <div style={{ fontWeight:700, color:"#92400E", fontSize:12, marginBottom:8 }}>⏰ Follow-ups Due Today ({followupsToday})</div>
      {leads.filter(l=>l.follow_up_date===todayStr).slice(0,4).map(l=>(
       <div key={l.id} style={{ fontSize:12, color:"#0F172A", padding:"4px 0", borderBottom:"1px solid #FDE68A" }}>
        <strong>{l.name}</strong> — <span style={{ color:"#64748b" }}>{l.destination}</span>
       </div>
      ))}
     </div>
    )}
   </div>
  </div>

  {/* Upcoming Departures */}
  {upcomingDepsLeads.length > 0 && (
   <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:18 }}>
    <div style={{ fontWeight:700, color:"#0F172A", fontSize:14, marginBottom:12 }}>✈ Upcoming Departures — Next 30 Days</div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(240px,1fr))", gap:10 }}>
     {upcomingDepsLeads.slice(0,8).map(l => {
      const daysLeft = Math.ceil((new Date(l.travel_date) - new Date(todayStr)) / 86400000);
      return (
       <div key={l.id} style={{ background:"#F8FAFC", border:"1px solid #E2E8F0", borderRadius:10, padding:"10px 13px" }}>
        <div style={{ fontWeight:700, color:"#0F172A", fontSize:13 }}>{l.name}</div>
        <div style={{ fontSize:12, color:"#1A6B8A", marginTop:3 }}>{l.destination}</div>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:11, color:"#64748b" }}>
         <span>📅 {l.travel_date}</span>
         <span style={{ fontWeight:700, color: daysLeft<=7?"#dc2626":daysLeft<=14?"#d97706":"#16a34a" }}>{daysLeft}d away</span>
        </div>
        <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{l.pax} adults{l.kids>0?` + ${l.kids} kids`:""}{l.assigned_to?` · ${l.assigned_to}`:""}</div>
       </div>
      );
     })}
    </div>
   </div>
  )}
 </div>
 );
}
// ─── PAGE: LEADS ──────────────────────────────────────────────────────────────
// ─── SEND ITINERARY / DOC EMAIL MODAL ────────────────────────────────────────
function SendItinEmailModal({ data, onClose, toast$ }) {
 const [to,      setTo]      = useState(data.to      || "");
 const [subject, setSubject] = useState(data.subject || "");
 const [note,    setNote]    = useState("");
 const [sending, setSending] = useState(false);
 const lbl = { display:"block", color:"#64748B", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:5 };
 const inp = { width:"100%", background:"#F8FAFC", border:"1px solid #D5E1EE", borderRadius:8, padding:"9px 13px", color:"#0F172A", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
 const send = async () => {
  if (!to.trim())      return toast$("Recipient email is required", true);
  if (!subject.trim()) return toast$("Subject is required", true);
  setSending(true);
  // Prefix note above the itinerary HTML if provided
  const noteHtml = note.trim()
   ? `<div style="font-family:sans-serif;padding:18px 24px;max-width:700px;margin:0 auto 0;color:#334155;font-size:15px;line-height:1.7;">${note.trim().replace(/\n/g,"<br/>")}</div><hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 0 0;"/>`
   : "";
  const fullHtml = noteHtml + (data.html || "");
  try {
   const res = await fetch("/api/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, html: fullHtml, body: note || subject }),
   });
   const d = await res.json();
   if (res.ok) { toast$(`Itinerary emailed to ${to} ✓`); onClose(); }
   else toast$(d.error || "Send failed", true);
  } catch { toast$("Send failed", true); }
  setSending(false);
 };
 return (
  <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:10000, display:"flex", alignItems:"center", justifyContent:"center" }}>
   <div style={{ background:"#fff", borderRadius:16, padding:28, width:"min(560px,95vw)", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,.3)" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
     <div>
      <div style={{ fontWeight:700, fontSize:16, color:"#0F172A" }}>📧 Email Itinerary to Lead</div>
      <div style={{ fontSize:12, color:"#64748B", marginTop:3 }}>Sending to: <strong>{data.leadName}</strong></div>
     </div>
     <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:22, color:"#94A3B8", lineHeight:1 }}>×</button>
    </div>
    <div style={{ marginBottom:13 }}><label style={lbl}>To</label><input value={to} onChange={e=>setTo(e.target.value)} style={inp} placeholder="customer@email.com"/></div>
    <div style={{ marginBottom:13 }}><label style={lbl}>Subject</label><input value={subject} onChange={e=>setSubject(e.target.value)} style={inp}/></div>
    <div style={{ marginBottom:18 }}>
     <label style={lbl}>Personal Note <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0 }}>(optional — appears above the itinerary)</span></label>
     <textarea value={note} onChange={e=>setNote(e.target.value)} rows={4}
      placeholder={`Dear ${data.leadName||""},\n\nPlease find your customised itinerary below. Do reach out if you have any questions!`}
      style={{ ...inp, resize:"vertical", lineHeight:1.65 }}/>
    </div>
    <div style={{ fontSize:11, color:"#64748B", background:"#F8FAFC", border:"1px solid #E6ECF5", borderRadius:7, padding:"8px 12px", marginBottom:18 }}>
     The itinerary is sent as a formatted HTML email with your cover photo embedded. Hotel and day images are loaded from the web — the recipient may need to click "Show images" in their email app to see them.
    </div>
    <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
     <Btn v="ghost" onClick={onClose}>Cancel</Btn>
     <Btn icon="send" onClick={send} disabled={sending}>{sending ? "Sending…" : "Send Itinerary"}</Btn>
    </div>
   </div>
  </div>
 );
}
// ─── SEND ITINERARY VIA WHATSAPP MODAL ───────────────────────────────────────
function SendItinWhatsAppModal({ data, onClose, companyProfile, bizSettings }) {
 const { itin, lead } = data;
 const co = companyProfile || {};
 const fmtDate = d => { try { return new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); } catch { return d||""; } };

 const genMsg = () => {
  const dest = itin.destination || itin.title || "Your Trip";
  const nights = (itin.days||[]).length || "";
  const days = nights ? `${nights}N/${Number(nights)+1}D` : "";
  const dateRange = itin.start_date ? `${fmtDate(itin.start_date)}${itin.end_date && itin.end_date!==itin.start_date?" – "+fmtDate(itin.end_date):""}` : "";
  const paxParts = [itin.pax?`${itin.pax} Adult${Number(itin.pax)>1?"s":""}`:"",(itin.kids&&Number(itin.kids)>0)?`${itin.kids} Child${Number(itin.kids)>1?"ren":""}`:""];
  const paxStr = paxParts.filter(Boolean).join(" + ");
  const hotels = (itin.hotels||[]).filter(h=>h.name).map(h=>`• ${h.name}${h.destination?" ("+h.destination+")":""}${h.nights?" — "+h.nights+"N":""}`).join("\n");
  const normArr = v => Array.isArray(v) ? v : (v && typeof v==="object" ? Object.values(v).flat() : []);
  const dayLines = (itin.days||[]).map(d => {
   const acts = normArr(d.activities).filter(a=>a.title);
   const header = `*Day ${d.day||""}${d.location?" — "+d.location:""}${d.date?" ("+fmtDate(d.date)+")":""}*`;
   const actLines = acts.map(a=>`  ${a.time?a.time+" · ":""}${a.title}${a.desc?"\n    _"+a.desc+"_":""}`).join("\n");
   const hotelLine = d.hotel ? `  🏨 Hotel: ${d.hotel}` : "";
   const transferLine = d.transfer ? `  🚗 ${d.transfer}` : "";
   const extras = [hotelLine, transferLine].filter(Boolean).join("\n");
   return [header, actLines, extras].filter(Boolean).join("\n");
  }).join("\n\n");
  const flightLines = (itin.flights||[]).filter(f=>f.airline||f.flight_no||f.from).map(f=>{
   const header = `✈️ *${[f.airline,f.flight_no].filter(Boolean).join(" ")}*`;
   const route  = f.from||f.to ? `   ${f.from||"??"} → ${f.to||"??"}` : "";
   const dt     = f.date ? `   📅 ${fmtDate(f.date)}` : "";
   const time   = (f.departure||f.arrival) ? `   🕐 ${f.departure||""}${f.arrival?" – "+f.arrival:""}` : "";
   const cls    = f.class ? `   💺 ${f.class}` : "";
   const cost   = f.cost  ? `   💰 ₹${Number(f.cost).toLocaleString("en-IN")}` : "";
   return [header,route,dt,time,cls,cost].filter(Boolean).join("\n");
  }).join("\n\n");
  const incl = (itin.inclusions||[]).slice(0,8).map(i=>`✔ ${i}`).join("\n");
  const excl = (itin.exclusions||[]).slice(0,5).map(e=>`✘ ${e}`).join("\n");
  const phone = co.phone1||(co.phone2?co.phone2:"")|| bizSettings?.emergency_contact||"";
  const email = co.email||"";
  let msg = `✈️ *Your Travel Itinerary — ${dest}*${days?" | "+days:""}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (lead?.name) msg += `👋 Dear *${lead.name}*,\n\nPlease find your personalised itinerary below:\n\n`;
  if (dateRange)   msg += `📅 *Dates:* ${dateRange}\n`;
  if (paxStr)      msg += `👥 *Guests:* ${paxStr}\n`;
  if (flightLines) msg += `\n✈️ *Flights:*\n\n${flightLines}\n`;
  if (hotels)      msg += `\n🏨 *Hotels:*\n${hotels}\n`;
  if (dayLines)    msg += `\n📍 *Day-by-Day Itinerary:*\n\n${dayLines}\n`;
  if (incl)        msg += `\n✅ *Inclusions:*\n${incl}\n`;
  if (excl)        msg += `\n❌ *Exclusions:*\n${excl}\n`;
  if (itin.notes)  msg += `\n📝 *Notes:* ${itin.notes}\n`;
  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  if (phone) msg += `📞 ${phone}\n`;
  if (email) msg += `✉️ ${email}\n`;
  msg += `\n— *${co.name||"Safarnaama Holidays"}*`;
  return msg;
 };

 const fmtPhone = p => {
  let n = (p||"").replace(/\D/g,"");
  if (n.startsWith("0")) n = "91" + n.slice(1);
  if (n.length===10) n = "91" + n;
  return n;
 };
 const [phone, setPhone] = useState(() => fmtPhone(lead?.phone||""));
 const [msg, setMsg]     = useState(genMsg);
 const lbl = { display:"block", color:"#64748B", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:5 };
 const inp = { width:"100%", background:"#F8FAFC", border:"1px solid #D5E1EE", borderRadius:8, padding:"9px 13px", color:"#0F172A", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
 const openWA = () => {
  const n = fmtPhone(phone);
  if (!n) { alert("Please enter a valid WhatsApp number."); return; }
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`, "_blank");
 };
 return (
  <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:10000, display:"flex", alignItems:"center", justifyContent:"center", padding:"16px" }}>
   <div style={{ background:"#fff", borderRadius:16, width:"min(580px,100%)", maxHeight:"92vh", boxShadow:"0 24px 64px rgba(0,0,0,.3)", display:"flex", flexDirection:"column", overflow:"hidden" }}>

    {/* ── Sticky header ── */}
    <div style={{ padding:"20px 24px 16px", borderBottom:"1px solid #E6ECF5", flexShrink:0 }}>
     <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
      <div>
       <div style={{ fontWeight:700, fontSize:16, color:"#0F172A", display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:20 }}>💬</span> WhatsApp Itinerary
       </div>
       <div style={{ fontSize:12, color:"#64748B", marginTop:3 }}>Sharing with: <strong>{lead?.name||"Lead"}</strong> — {itin.destination||itin.title||""}</div>
      </div>
      <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:22, color:"#94A3B8", lineHeight:1, flexShrink:0 }}>×</button>
     </div>
     <div style={{ marginTop:14 }}>
      <label style={lbl}>WhatsApp Number</label>
      <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="919876543210" style={inp}/>
      <div style={{ fontSize:11, color:"#94A3B8", marginTop:4 }}>Include country code — e.g. 91 for India. Auto-filled from lead's phone.</div>
     </div>
    </div>

    {/* ── Scrollable message area ── */}
    <div style={{ flex:1, overflowY:"auto", padding:"16px 24px" }}>
     <label style={lbl}>Message Preview <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0 }}>(editable before sending)</span></label>
     <textarea value={msg} onChange={e=>setMsg(e.target.value)}
      style={{ ...inp, resize:"none", lineHeight:1.6, fontFamily:"'Courier New', monospace", fontSize:12,
               width:"100%", height:"100%", minHeight:320, boxSizing:"border-box" }}/>
    </div>

    {/* ── Sticky footer ── */}
    <div style={{ padding:"14px 24px 20px", borderTop:"1px solid #E6ECF5", flexShrink:0, background:"#fff" }}>
     <div style={{ fontSize:11, color:"#166534", background:"#F0FDF4", border:"1px solid #BBF7D0", borderRadius:7, padding:"8px 12px", marginBottom:14 }}>
      WhatsApp will open in a new tab with this message pre-filled. The client receives it as a formatted message on their phone.
     </div>
     <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
      <Btn v="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={openWA} s={{ background:"#25D366", color:"#fff", border:"none", padding:"9px 20px" }}>💬 Open WhatsApp</Btn>
     </div>
    </div>

   </div>
  </div>
 );
}
// ─── PAGE: VENDOR REQUESTS (Admin only) ───────────────────────────────────────
function PageVendorRequests({ leads, vendors, toast$ }) {
 const [requests, setRequests] = useState([]);
 const [loading, setLoading] = useState(true);
 const [loadError, setLoadError] = useState("");
 const [emailConfigured, setEmailConfigured] = useState(null); // null=checking, true/false
 const [selectedId, setSelectedId] = useState(null);
 const [checking, setChecking] = useState(false);
 const [filter, setFilter] = useState("all");
 const [showNew, setShowNew] = useState(false);
 const [newReq, setNewReq] = useState({ lead_id:"", vendor_ids:[], subject:"", body:"" });
 const [sending, setSending] = useState(false);
 const [fwd, setFwd] = useState(null);
 const [forwarding, setForwarding] = useState(false);
 const [lastRefresh, setLastRefresh] = useState(null);

 const selected = requests.find(r => r.id === selectedId) || null;

 const load = async (silent = false) => {
  if (!silent) setLoading(true);
  setLoadError("");
  try {
   const r = await fetch("/api/vendor-requests");
   const d = await r.json();
   if (r.ok) { setRequests(d); setLastRefresh(new Date()); }
   else setLoadError(d.error || `Server error ${r.status}`);
  } catch (e) { if (!silent) setLoadError("Cannot reach backend — is the server running?"); }
  if (!silent) setLoading(false);
 };
 // Helper — fetch JSON safely, never throws on non-JSON bodies
 const safeJson = async r => { try { return await r.json(); } catch { return { error: `HTTP ${r.status}` }; } };

 const runSync = async (silent = false) => {
  if (!silent) setChecking(true);
  try {
   const r = await fetch("/api/vendor-requests/check-replies", { method:"POST" });
   const d = await safeJson(r);
   if (r.ok) {
    if (d.status === "running") {
     // Background scan started — show toast and reload data after 20s
     if (!silent) toast$("Checking replies in background — list will refresh in ~20 seconds");
     setTimeout(() => { load(true); setLastRefresh(new Date()); }, 20000);
    } else {
     load(true);
     if (!silent) {
      const msg = (d.updated||0)>0||(d.autoForwarded||0)>0
       ? `${d.updated||0} new repl${(d.updated||0)===1?"y":"ies"} · ${d.autoForwarded||0} auto-forwarded ✓`
       : `All up to date — ${d.detail||`scanned ${d.scanned||0} emails`}`;
      toast$(msg);
     }
    }
   } else if (!silent) toast$(d.error||"Sync failed", true);
  } catch(e) { if (!silent) toast$(`Sync failed: ${e.message}`, true); }
  if (!silent) setChecking(false);
 };

 useEffect(() => {
  load();
  fetch("/api/email/config").then(r=>r.json()).then(d=>setEmailConfigured(!!d.configured && !!d.passwordSet)).catch(()=>setEmailConfigured(false));
  // Auto-run full IMAP check + forward every 60 seconds (no button click needed)
  const syncTimer = setInterval(() => runSync(true), 60 * 1000);
  return () => clearInterval(syncTimer);
 }, []);

 const checkReplies = () => runSync(false);

 const handleLeadChange = (lead_id) => {
  const lead=leads.find(l=>l.id===lead_id);
  if(!lead){ setNewReq(p=>({...p,lead_id})); return; }
  const kids=Number(lead.kids||0);
  const paxStr=`${lead.pax||2} Adult${(lead.pax||2)>1?"s":""}${kids>0?` + ${kids} Kid${kids>1?"s":""}` :""}`;
  const subject=`Quote Request — ${lead.destination||"Destination"} | ${lead.travel_date||"TBD"} | ${paxStr} [Ref: ${lead.id}]`;
  const body=`Dear Travel Partner,\n\nWe have a client requirement for ${lead.destination||""}. Please provide your best rates:\n\n📍 Destination: ${lead.destination||""}\n📅 Travel Date: ${lead.travel_date||"TBD"}\n👥 Pax: ${paxStr}\n${lead.nights?`🌙 Nights: ${lead.nights}\n`:""}${lead.budget?`💰 Budget: ₹${lead.budget}/person (approx)\n`:""}\nPlease include hotel accommodation, transfers, meals, and any special inclusions.\n\nKindly reply at the earliest.\n\nLead Ref: ${lead.id}\n\nBest regards`;
  setNewReq(p=>({...p,lead_id,subject,body,vendor_ids:[]}));
 };

 const sendRequest = async () => {
  const lead=leads.find(l=>l.id===newReq.lead_id);
  if(!lead) return toast$("Select a lead",true);
  if(!newReq.vendor_ids?.length) return toast$("Select at least one vendor",true);
  if(!newReq.subject.trim()||!newReq.body.trim()) return toast$("Subject and body required",true);
  if(emailConfigured===false) return toast$("Email not configured — go to Settings → Email to set up SMTP first",true);
  setSending(true);
  let ok=0; const errors=[];
  for(const vid of newReq.vendor_ids){
   const vendor=vendors.find(v=>v.id===vid);
   if(!vendor?.email){ errors.push(`${vendor?.name||vid}: no email address`); continue; }
   try{
    const r=await fetch("/api/vendor-requests/send",{method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({lead_id:lead.id,lead_name:lead.name,lead_ref:lead.id,destination:lead.destination||"",vendor_id:vendor.id,vendor_name:vendor.name,vendor_email:vendor.email,markup_type:vendor.markup_type||"percent",markup_value:vendor.markup_value||0,subject:newReq.subject,body:newReq.body})});
    const d=await r.json();
    if(r.ok) ok++;
    else errors.push(`${vendor.name}: ${d.error||r.status}`);
   } catch(e) { errors.push(`${vendor.name}: network error`); }
  }
  setSending(false);
  if(ok>0){
   toast$(`Request sent to ${ok} vendor(s)${errors.length>0?` · ${errors.length} failed`:""} ✓`);
   setShowNew(false); setNewReq({lead_id:"",vendor_ids:[],subject:"",body:""}); load();
  } else {
   const msg = errors.length ? errors.join(" | ") : "All sends failed";
   toast$(msg, true);
  }
 };

 const openFwd = (req) => {
  const orig=req.original_price||0, mt=req.markup_type||"percent", mv=req.markup_value||0;
  const fp=mt==="percent"?Math.round(orig*(1+mv/100)):Math.round(orig+mv);
  setFwd({id:req.id,original_price:orig,markup_type:mt,markup_value:mv,final_price:fp,forward_to:"",note:""});
 };

 const handleFwdChange = (field,value) => {
  setFwd(p=>{
   const u={...p,[field]:value};
   const orig=field==="original_price"?Number(value):p.original_price;
   const mt=field==="markup_type"?value:p.markup_type;
   const mv=field==="markup_value"?Number(value):p.markup_value;
   return {...u,final_price:mt==="percent"?Math.round(orig*(1+mv/100)):Math.round(orig+mv)};
  });
 };

 const forwardQuote = async () => {
  if(!fwd.final_price) return toast$("Enter final price",true);
  setForwarding(true);
  try {
   const r=await fetch(`/api/vendor-requests/${fwd.id}/forward`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(fwd)});
   const d=await r.json();
   if(r.ok){ toast$("Quote forwarded to employee ✓"); setFwd(null); load(); }
   else toast$(d.error||"Forward failed",true);
  } catch { toast$("Forward failed",true); }
  setForwarding(false);
 };

 const SC={sent:"#F59E0B",received:"#3B82F6",forwarded:"#10B981"};
 const SL={sent:"Pending Reply",received:"Reply Received",forwarded:"Forwarded"};
 const counts={all:requests.length,sent:requests.filter(r=>r.status==="sent").length,received:requests.filter(r=>r.status==="received").length,forwarded:requests.filter(r=>r.status==="forwarded").length};
 const filtered=requests.filter(r=>filter==="all"||r.status===filter);
 const selectedLead=selected?leads.find(l=>l.id===selected.lead_id):null;
 const lead4New=newReq.lead_id?leads.find(l=>l.id===newReq.lead_id):null;
 const vendorsByDest=lead4New
  ?vendors.filter(v=>!lead4New.destination||!v.destination||v.destination?.toLowerCase().includes(lead4New.destination?.toLowerCase())||lead4New.destination?.toLowerCase().includes(v.destination?.toLowerCase()))
  :vendors;
 const inpS={width:"100%",background:"#F8FAFC",border:"1px solid #D5E1EE",borderRadius:8,padding:"9px 13px",fontSize:13,color:"#0F172A",boxSizing:"border-box",fontFamily:"inherit"};

 return (
  <div>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
    <div>
     <div style={{fontSize:20,fontWeight:800,color:"#0F172A"}}>Vendor Requests</div>
     <div style={{fontSize:12,color:"#94A3B8",marginTop:2}}>Admin only · Vendor quotes, markup & forwarding</div>
    </div>
    <div style={{display:"flex",gap:8,alignItems:"center"}}>
     {lastRefresh && (
      <span style={{fontSize:10,color:"#94A3B8",display:"flex",alignItems:"center",gap:4}}>
       <span style={{width:6,height:6,borderRadius:"50%",background:"#10B981",display:"inline-block"}}/>
       Auto-sync · {lastRefresh.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
      </span>
     )}
     <Btn v="ghost" icon="refresh" onClick={checkReplies} disabled={checking} s={{fontSize:12}}>{checking?"Starting…":"Sync Now"}</Btn>
     <Btn icon="plus" onClick={()=>setShowNew(true)}>New Request</Btn>
    </div>
   </div>

   {emailConfigured===false && (
    <div style={{background:"#FEF3C7",border:"1px solid #F59E0B",borderRadius:10,padding:"10px 16px",marginBottom:14,fontSize:13,color:"#92400E",display:"flex",gap:10,alignItems:"center"}}>
     <span style={{fontSize:18}}>⚠️</span>
     <span><strong>Email not configured.</strong> Go to <strong>Settings → Email</strong> and enter your SMTP credentials before sending vendor requests.</span>
    </div>
   )}
   {loadError && (
    <div style={{background:"#FEE2E2",border:"1px solid #FCA5A5",borderRadius:10,padding:"10px 16px",marginBottom:14,fontSize:13,color:"#991B1B",display:"flex",gap:10,alignItems:"center"}}>
     <span style={{fontSize:18}}>❌</span>
     <span><strong>Cannot load requests:</strong> {loadError} — Make sure the backend is running and the <strong>vendor_requests</strong> table exists in Supabase (run backend/seed_vendor_requests.sql).</span>
    </div>
   )}

   <div style={{display:"flex",gap:0,border:"1px solid #E6ECF5",borderRadius:14,overflow:"hidden",background:"#F8FAFC",height:"calc(100vh - 190px)"}}>
    {/* Left list */}
    <div style={{width:300,borderRight:"1px solid #E6ECF5",display:"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
     <div style={{display:"flex",borderBottom:"1px solid #F1F5F9",padding:"8px 8px",gap:3}}>
      {["all","sent","received","forwarded"].map(s=>(
       <button key={s} onClick={()=>setFilter(s)} style={{flex:1,padding:"5px 4px",borderRadius:6,border:"none",cursor:"pointer",fontSize:10,fontWeight:filter===s?700:500,background:filter===s?"#1A6B8A":"transparent",color:filter===s?"#fff":s==="all"?"#64748B":(SC[s]||"#64748B"),transition:"all .15s"}}>
        {s==="all"?"All":SL[s]?.split(" ")[0]}
        <span style={{marginLeft:3,background:filter===s?"rgba(255,255,255,.25)":"#F1F5F9",borderRadius:10,padding:"1px 5px",fontSize:9}}>{counts[s]||0}</span>
       </button>
      ))}
     </div>
     <div style={{flex:1,overflowY:"auto"}}>
      {loading?<div style={{padding:30,textAlign:"center",color:"#94A3B8",fontSize:13}}>Loading…</div>
      :filtered.length===0?<div style={{padding:30,textAlign:"center",color:"#94A3B8"}}><div style={{fontSize:28,marginBottom:6}}>📬</div><div style={{fontSize:13}}>{requests.length===0?"No requests yet":"No results"}</div></div>
      :filtered.map(req=>(
       <div key={req.id} onClick={()=>setSelectedId(req.id)}
        style={{padding:"11px 14px",cursor:"pointer",borderBottom:"1px solid #F1F5F9",background:selectedId===req.id?"#EFF6FF":"transparent",borderLeft:selectedId===req.id?"3px solid #1A6B8A":"3px solid transparent",transition:"background .1s"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:3}}>
         <div style={{fontWeight:700,fontSize:13,color:"#0F172A",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,marginRight:6}}>{req.lead_name||"Lead"}</div>
         <span style={{flexShrink:0,fontSize:9,fontWeight:700,background:SC[req.status]+"20",color:SC[req.status],padding:"2px 7px",borderRadius:10,border:`1px solid ${SC[req.status]}40`,textTransform:"uppercase",letterSpacing:.4}}>
          {req.status==="sent"?"Pending":req.status==="received"?"Replied":"Fwd'd"}
         </span>
        </div>
        <div style={{fontSize:11,color:"#64748B"}}>{req.vendor_name}</div>
        <div style={{fontSize:10,color:"#94A3B8",marginTop:2}}>{req.destination} · {req.sent_at?new Date(req.sent_at).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):""}</div>
       </div>
      ))}
     </div>
    </div>

    {/* Right detail */}
    <div style={{flex:1,overflowY:"auto"}}>
     {!selected?(
      <div style={{flex:1,height:"100%",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8,color:"#94A3B8"}}>
       <div style={{fontSize:44}}>📋</div>
       <div style={{fontSize:13}}>Select a request to view details</div>
      </div>
     ):(
      <div style={{padding:22}}>
       {/* Detail header */}
       <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,paddingBottom:14,borderBottom:"1px solid #E6ECF5"}}>
        <div>
         <div style={{fontSize:16,fontWeight:800,color:"#0F172A",marginBottom:3}}>{selected.lead_name}</div>
         <div style={{fontSize:12,color:"#64748B"}}>
          📍 {selected.destination}
          {selectedLead?.travel_date&&<span> · 📅 {selectedLead.travel_date}</span>}
          {selectedLead?.pax&&<span> · 👥 {selectedLead.pax} Pax{selectedLead.kids>0?` + ${selectedLead.kids} Kids`:""}</span>}
         </div>
         <div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>Ref: {selected.lead_ref||selected.lead_id}</div>
        </div>
        <span style={{padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700,background:SC[selected.status]+"15",color:SC[selected.status],border:`1px solid ${SC[selected.status]}30`}}>
         {SL[selected.status]}
        </span>
       </div>

       {/* Request sent */}
       <div style={{background:"#F8FAFC",border:"1px solid #E6ECF5",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
        <div style={{fontWeight:700,fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.8,marginBottom:8}}>Request Sent to Vendor</div>
        <div style={{fontSize:12,color:"#334155",marginBottom:4}}><strong>To:</strong> {selected.vendor_name} &lt;{selected.vendor_email}&gt;</div>
        <div style={{fontSize:12,color:"#334155",marginBottom:8}}><strong>Subject:</strong> {selected.subject}</div>
        <div style={{fontSize:11,color:"#475569",background:"#fff",border:"1px solid #E6ECF5",borderRadius:7,padding:"10px 12px",whiteSpace:"pre-wrap",maxHeight:130,overflowY:"auto",lineHeight:1.6}}>{selected.body_sent}</div>
        <div style={{fontSize:10,color:"#94A3B8",marginTop:6}}>Sent: {selected.sent_at?new Date(selected.sent_at).toLocaleString("en-IN"):""}</div>
       </div>

       {/* Vendor response */}
       {selected.status!=="sent"&&(
        <div style={{background:"#F0F9FF",border:"1px solid #BAE6FD",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
         <div style={{fontWeight:700,fontSize:10,color:"#0369A1",textTransform:"uppercase",letterSpacing:.8,marginBottom:8}}>Vendor Response</div>
         <div style={{fontSize:12,color:"#334155",marginBottom:4}}>
          <strong>From:</strong> {selected.response_from}
          {selected.received_at&&<span style={{color:"#94A3B8",marginLeft:8}}>{new Date(selected.received_at).toLocaleString("en-IN")}</span>}
         </div>
         {selected.response_subject&&<div style={{fontSize:12,color:"#334155",marginBottom:8}}><strong>Subject:</strong> {selected.response_subject}</div>}
         <div style={{fontSize:11,color:"#334155",background:"#fff",border:"1px solid #E0F2FE",borderRadius:7,padding:"10px 12px",whiteSpace:"pre-wrap",maxHeight:200,overflowY:"auto",lineHeight:1.65}}>{selected.response_body||"(No text content)"}</div>
         {(selected.extracted_prices||[]).length>0&&(
          <div style={{marginTop:10}}>
           <div style={{fontSize:10,color:"#0369A1",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:5}}>Detected Prices — click to select</div>
           <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {(selected.extracted_prices||[]).map((p,i)=>(
             <button key={i} onClick={()=>{const f={...selected,original_price:p};openFwd(f);}}
              style={{background:"#fff",border:"1px solid #BAE6FD",borderRadius:6,padding:"4px 12px",fontSize:13,fontWeight:700,color:"#0F172A",cursor:"pointer"}}>
              ₹{Number(p).toLocaleString("en-IN")}
             </button>
            ))}
           </div>
          </div>
         )}
        </div>
       )}

       {/* Process & Forward */}
       {selected.status==="received"&&(
        <div style={{background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:10,padding:"14px 16px",marginBottom:14}}>
         <div style={{fontWeight:700,fontSize:10,color:"#15803D",textTransform:"uppercase",letterSpacing:.8,marginBottom:8}}>Apply Markup & Forward to Employee</div>
         {!(selected.extracted_prices||[]).length && (
          <div style={{background:"#FEF9C3",border:"1px solid #FDE047",borderRadius:7,padding:"8px 12px",marginBottom:10,fontSize:11,color:"#713F12"}}>
           ⚠️ <strong>No price detected</strong> in vendor's reply — auto-forward skipped. Enter the vendor's price manually below, or ask vendor to include a clear INR amount in their reply.
          </div>
         )}
         {(!fwd||fwd.id!==selected.id)?(
          <Btn v="success" onClick={()=>openFwd(selected)}>Set Price & Forward →</Btn>
         ):(
          <div>
           <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div>
             <label style={{display:"block",fontSize:10,color:"#64748B",fontWeight:700,textTransform:"uppercase",letterSpacing:.7,marginBottom:4}}>Vendor Price (₹)</label>
             <input type="number" value={fwd.original_price} onChange={e=>handleFwdChange("original_price",e.target.value)} style={{...inpS,padding:"8px 10px"}}/>
            </div>
            <div>
             <label style={{display:"block",fontSize:10,color:"#64748B",fontWeight:700,textTransform:"uppercase",letterSpacing:.7,marginBottom:4}}>Markup</label>
             <div style={{display:"flex",gap:5}}>
              <select value={fwd.markup_type} onChange={e=>handleFwdChange("markup_type",e.target.value)}
               style={{background:"#F8FAFC",border:"1px solid #D5E1EE",borderRadius:8,padding:"8px 10px",fontSize:13,color:"#0F172A"}}>
               <option value="percent">%</option>
               <option value="flat">₹ Flat</option>
              </select>
              <input type="number" value={fwd.markup_value} onChange={e=>handleFwdChange("markup_value",e.target.value)} style={{...inpS,padding:"8px 10px"}} placeholder="0"/>
             </div>
            </div>
           </div>
           <div style={{background:"#fff",border:"2px solid #10B981",borderRadius:9,padding:"10px 16px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:"#64748B",fontWeight:600}}>Final Quote Price (₹)</span>
            <input type="number" value={fwd.final_price} onChange={e=>setFwd(p=>({...p,final_price:Number(e.target.value)}))}
             style={{width:130,background:"transparent",border:"none",fontSize:20,fontWeight:900,color:"#0F172A",textAlign:"right",outline:"none"}}/>
           </div>
           <div style={{marginBottom:10}}>
            <label style={{display:"block",fontSize:10,color:"#64748B",fontWeight:700,textTransform:"uppercase",letterSpacing:.7,marginBottom:4}}>Forward To (leave blank for default from Settings)</label>
            <input value={fwd.forward_to} onChange={e=>setFwd(p=>({...p,forward_to:e.target.value}))} placeholder="employee@company.com" style={inpS}/>
           </div>
           <div style={{marginBottom:12}}>
            <label style={{display:"block",fontSize:10,color:"#64748B",fontWeight:700,textTransform:"uppercase",letterSpacing:.7,marginBottom:4}}>Note for Employee (optional)</label>
            <textarea value={fwd.note} onChange={e=>setFwd(p=>({...p,note:e.target.value}))} rows={2} placeholder="e.g. Valid for 3 days, special rate applied…"
             style={{...inpS,resize:"vertical",lineHeight:1.6}}/>
           </div>
           <div style={{display:"flex",gap:8}}>
            <Btn v="ghost" onClick={()=>setFwd(null)}>Cancel</Btn>
            <Btn v="success" icon="send" onClick={forwardQuote} disabled={forwarding}>{forwarding?"Forwarding…":"Forward to Employee"}</Btn>
           </div>
          </div>
         )}
        </div>
       )}

       {/* Already forwarded */}
       {selected.status==="forwarded"&&(
        <div style={{background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:10,padding:"12px 14px"}}>
         <div style={{fontWeight:700,fontSize:10,color:"#15803D",textTransform:"uppercase",letterSpacing:.8,marginBottom:8}}>Forwarded ✓</div>
         <div style={{fontSize:12,color:"#334155"}}>Sent to: <strong>{selected.forwarded_to}</strong>
          {selected.forwarded_at&&<span style={{color:"#94A3B8",marginLeft:8}}>{new Date(selected.forwarded_at).toLocaleString("en-IN")}</span>}
         </div>
         {selected.final_price&&<div style={{marginTop:6,fontSize:15,fontWeight:800,color:"#15803D"}}>Quoted: ₹{Number(selected.final_price).toLocaleString("en-IN")}/person</div>}
        </div>
       )}
      </div>
     )}
    </div>
   </div>

   {/* New Request Modal */}
   {showNew&&(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}>
     <div style={{background:"#fff",borderRadius:16,padding:28,width:"min(700px,95vw)",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
       <div style={{fontWeight:800,fontSize:17,color:"#0F172A"}}>New Vendor Quote Request</div>
       <button onClick={()=>setShowNew(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:22,color:"#94A3B8",lineHeight:1}}>×</button>
      </div>
      <div style={{marginBottom:12}}>
       <label style={{display:"block",fontSize:11,color:"#64748B",fontWeight:700,textTransform:"uppercase",letterSpacing:.8,marginBottom:5}}>Select Lead</label>
       <select value={newReq.lead_id} onChange={e=>handleLeadChange(e.target.value)} style={{...inpS}}>
        <option value="">— Choose a lead —</option>
        {leads.filter(l=>l.destination).map(l=>(
         <option key={l.id} value={l.id}>{l.name} — {l.destination}{l.travel_date?" ("+l.travel_date+")":""}</option>
        ))}
       </select>
      </div>
      {newReq.lead_id&&(
       <div style={{marginBottom:12}}>
        <label style={{display:"block",fontSize:11,color:"#64748B",fontWeight:700,textTransform:"uppercase",letterSpacing:.8,marginBottom:5}}>
         Select Vendors <span style={{color:"#94A3B8",fontWeight:400,textTransform:"none"}}>({vendorsByDest.length} matching this destination)</span>
        </label>
        <div style={{maxHeight:180,overflowY:"auto",border:"1px solid #D5E1EE",borderRadius:8,background:"#F8FAFC"}}>
         {vendorsByDest.length===0&&<div style={{padding:"10px 14px",fontSize:12,color:"#94A3B8"}}>No vendors for this destination</div>}
         {vendorsByDest.map(v=>(
          <label key={v.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 14px",cursor:"pointer",borderBottom:"1px solid #F1F5F9",background:newReq.vendor_ids?.includes(v.id)?"#EFF6FF":"transparent"}}>
           <input type="checkbox" checked={newReq.vendor_ids?.includes(v.id)||false} style={{accentColor:"#1A6B8A",width:14,height:14,flexShrink:0}}
            onChange={e=>setNewReq(p=>({...p,vendor_ids:e.target.checked?[...(p.vendor_ids||[]),v.id]:(p.vendor_ids||[]).filter(id=>id!==v.id)}))}/>
           <div>
            <div style={{fontSize:13,fontWeight:600,color:"#0F172A"}}>{v.name}</div>
            <div style={{fontSize:10,color:"#64748B"}}>{v.email} · {v.destination} · {v.category}{v.markup_value?` · Markup: ${v.markup_value}${v.markup_type==="percent"?"%":"₹ flat"}`:""}</div>
           </div>
          </label>
         ))}
        </div>
        {newReq.vendor_ids?.length>0&&<div style={{fontSize:11,color:"#1A6B8A",marginTop:4,fontWeight:600}}>{newReq.vendor_ids.length} vendor(s) selected</div>}
       </div>
      )}
      <div style={{marginBottom:10}}>
       <label style={{display:"block",fontSize:11,color:"#64748B",fontWeight:700,textTransform:"uppercase",letterSpacing:.8,marginBottom:5}}>Subject</label>
       <input value={newReq.subject} onChange={e=>setNewReq(p=>({...p,subject:e.target.value}))} style={inpS}/>
      </div>
      <div style={{marginBottom:18}}>
       <label style={{display:"block",fontSize:11,color:"#64748B",fontWeight:700,textTransform:"uppercase",letterSpacing:.8,marginBottom:5}}>Email Body</label>
       <textarea value={newReq.body} onChange={e=>setNewReq(p=>({...p,body:e.target.value}))} rows={10}
        style={{...inpS,resize:"vertical",lineHeight:1.65}}/>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
       <Btn v="ghost" onClick={()=>setShowNew(false)}>Cancel</Btn>
       <Btn icon="send" onClick={sendRequest} disabled={sending}>{sending?"Sending…":"Send to Vendors"}</Btn>
      </div>
     </div>
    </div>
   )}
  </div>
 );
}

// ─── PAGE: EMAIL ──────────────────────────────────────────────────────────────
function PageEmail({ leads, toast$ }) {
 const [configured, setConfigured] = useState(null);
 const [selectedLead, setSelectedLead]   = useState(null);
 const [search, setSearch]               = useState("");
 const [emails, setEmails]               = useState([]);
 const [loadingEmails, setLoadingEmails] = useState(false);
 const [selectedEmail, setSelectedEmail] = useState(null);
 const [emailBody, setEmailBody]         = useState(null);
 const [loadingBody, setLoadingBody]     = useState(false);
 const [showCompose, setShowCompose]     = useState(false);
 const [compose, setCompose]             = useState({ to:"", subject:"", body:"", inReplyTo:"", references:"" });
 const [attachFiles, setAttachFiles]     = useState([]);
 const [sending, setSending]             = useState(false);

 useEffect(() => {
  fetch("/api/email/config").then(r=>r.json()).then(d=>setConfigured(d.configured)).catch(()=>setConfigured(false));
 }, []);

 const emailLeads = (leads||[]).filter(l=>l.email?.trim());
 const filteredLeads = emailLeads.filter(l=>
  (l.name||"").toLowerCase().includes(search.toLowerCase()) ||
  (l.email||"").toLowerCase().includes(search.toLowerCase())
 );

 const fetchEmails = async (lead) => {
  setSelectedLead(lead);
  setEmails([]); setSelectedEmail(null); setEmailBody(null);
  setLoadingEmails(true);
  try {
   const res = await fetch("/api/email/fetch", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ emailAddress:lead.email }) });
   const d = await res.json();
   if (res.ok) setEmails(d);
   else toast$(d.error||"Failed to fetch emails", true);
  } catch { toast$("Failed to fetch emails", true); }
  setLoadingEmails(false);
 };

 const fetchBody = async (em) => {
  setSelectedEmail(em); setEmailBody(null);
  setLoadingBody(true);
  try {
   const res = await fetch("/api/email/body", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ uid:em.uid, folder:em.folder }) });
   const d = await res.json();
   if (res.ok) { setEmailBody(d); setEmails(prev=>prev.map(e=>e.uid===em.uid&&e.folder===em.folder?{...e,seen:true}:e)); }
   else toast$(d.error||"Failed to load email", true);
  } catch { toast$("Failed to load email", true); }
  setLoadingBody(false);
 };

 const sendEmail = async () => {
  if (!compose.to.trim()||!compose.subject.trim()) return toast$("To and Subject are required", true);
  setSending(true);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
   const readAsBase64 = f => new Promise((res,rej)=>{ const r=new FileReader(); r.onload=e=>res(e.target.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(f); });
   const attachments = await Promise.all(attachFiles.map(async f => ({ filename:f.name, content:await readAsBase64(f), contentType:f.type||"application/octet-stream" })));
   const res = await fetch("/api/email/send", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ ...compose, attachments }), signal: ctrl.signal });
   clearTimeout(timer);
   const d = await res.json();
   if (res.ok) { toast$("Email sent!"); setShowCompose(false); setCompose({to:"",subject:"",body:"",inReplyTo:"",references:""}); setAttachFiles([]); if(selectedLead) fetchEmails(selectedLead); }
   else toast$(d.error||"Send failed", true);
  } catch(e) { clearTimeout(timer); toast$(e.name === "AbortError" ? "Email timed out — check SMTP settings" : "Send failed: " + e.message, true); }
  setSending(false);
 };

 const openCompose = (prefill={}) => {
  setCompose({ to:selectedLead?.email||"", subject:"", body:"", inReplyTo:"", references:"", ...prefill });
  setAttachFiles([]);
  setShowCompose(true);
 };

 const S = {
  lbl:{ display:"block", color:"#64748B", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:5 },
  inp:{ width:"100%", background:"#F8FAFC", border:"1px solid #D5E1EE", borderRadius:8, padding:"9px 13px", color:"#0F172A", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" },
 };

 if (configured === null) return <div style={{ padding:40, color:"#64748B", textAlign:"center" }}>Loading…</div>;

 if (!configured) return (
  <div style={{ maxWidth:460, margin:"60px auto", textAlign:"center" }}>
   <div style={{ fontSize:52, marginBottom:14 }}>📧</div>
   <div style={{ fontWeight:700, fontSize:20, color:"#0F172A", marginBottom:8 }}>Email Not Configured</div>
   <div style={{ color:"#64748B", lineHeight:1.6 }}>Go to <strong>Settings → Email (IMAP / SMTP)</strong> to connect your email account. You'll need your IMAP/SMTP server details and an app password from your email provider.</div>
  </div>
 );

 return (
  <div style={{ display:"flex", height:"calc(100vh - 106px)", borderRadius:14, overflow:"hidden", border:"1px solid #E6ECF5", background:"#F8FAFC" }}>
   {/* ── Left: Contact list ── */}
   <div style={{ width:260, borderRight:"1px solid #E6ECF5", display:"flex", flexDirection:"column", background:"#fff", flexShrink:0 }}>
    <div style={{ padding:"14px 14px 10px", borderBottom:"1px solid #F1F5F9" }}>
     <div style={{ fontWeight:700, fontSize:13, color:"#0F172A", marginBottom:8 }}>Contacts</div>
     <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search leads…"
      style={{ width:"100%", background:"#F8FAFC", border:"1px solid #E6ECF5", borderRadius:8, padding:"7px 11px", fontSize:12, color:"#0F172A", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
    </div>
    <div style={{ flex:1, overflowY:"auto" }}>
     {filteredLeads.length===0 && <div style={{ padding:20, textAlign:"center", color:"#94A3B8", fontSize:12 }}>No leads with email addresses</div>}
     {filteredLeads.map(lead=>(
      <div key={lead.id} onClick={()=>fetchEmails(lead)}
       style={{ padding:"10px 14px", cursor:"pointer", borderBottom:"1px solid #F8FAFC",
        background:selectedLead?.id===lead.id?"#EFF6FF":"transparent",
        borderLeft:selectedLead?.id===lead.id?"3px solid #1A6B8A":"3px solid transparent" }}>
       <div style={{ fontWeight:600, fontSize:13, color:"#0F172A" }}>{lead.name}</div>
       <div style={{ fontSize:11, color:"#64748B", marginTop:1 }}>{lead.email}</div>
       <div style={{ fontSize:10, color:"#94A3B8", marginTop:1 }}>{lead.destination}</div>
      </div>
     ))}
    </div>
   </div>

   {/* ── Right: Thread ── */}
   <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
    {/* Header bar */}
    <div style={{ padding:"10px 18px", borderBottom:"1px solid #E6ECF5", background:"#fff", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
     {selectedLead
      ? <div><span style={{ fontWeight:700, fontSize:14, color:"#0F172A" }}>{selectedLead.name}</span><span style={{ fontSize:12, color:"#64748B", marginLeft:8 }}>{selectedLead.email}</span></div>
      : <span style={{ color:"#94A3B8", fontSize:13 }}>Select a contact to view emails</span>}
     <div style={{ display:"flex", gap:8 }}>
      {selectedLead && <Btn v="ghost" s={{ fontSize:12, padding:"4px 11px" }} onClick={()=>fetchEmails(selectedLead)}>Refresh</Btn>}
      <Btn icon="plus" s={{ fontSize:12, padding:"4px 12px" }} onClick={()=>openCompose()}>Compose</Btn>
     </div>
    </div>

    {/* Body */}
    {!selectedLead ? (
     <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:8, color:"#94A3B8" }}>
      <div style={{ fontSize:36 }}>📨</div>
      <div style={{ fontSize:13 }}>Select a contact from the left panel</div>
     </div>
    ) : loadingEmails ? (
     <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#64748B" }}>Fetching emails…</div>
    ) : emails.length===0 ? (
     <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:10, color:"#94A3B8" }}>
      <div style={{ fontSize:32 }}>📭</div>
      <div style={{ fontSize:13 }}>No emails found for {selectedLead.email}</div>
      <Btn s={{ fontSize:12 }} onClick={()=>openCompose({ to:selectedLead.email })}>Write first email</Btn>
     </div>
    ) : (
     <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
      {/* Email list */}
      <div style={{ width:300, borderRight:"1px solid #E6ECF5", overflowY:"auto", background:"#FAFAFA", flexShrink:0 }}>
       {emails.map(em=>{
        const isSelected = selectedEmail?.uid===em.uid && selectedEmail?.folder===em.folder;
        return (
         <div key={`${em.folder}-${em.uid}`} onClick={()=>fetchBody(em)}
          style={{ padding:"10px 14px", cursor:"pointer", borderBottom:"1px solid #F1F5F9",
           background:isSelected?"#EFF6FF":(!em.seen?"#F0F9FF":"transparent"),
           borderLeft:isSelected?"3px solid #1A6B8A":"3px solid transparent" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:3 }}>
           <div style={{ fontWeight:em.seen?400:700, fontSize:12, color:em.direction==="sent"?"#7C3AED":"#0F172A" }}>
            {em.direction==="sent"?"↑ You":`↓ ${em.from?.name||em.from?.address||"?"}`}
           </div>
           <div style={{ fontSize:10, color:"#94A3B8", whiteSpace:"nowrap", flexShrink:0, marginLeft:6 }}>
            {em.date ? new Date(em.date).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}) : ""}
           </div>
          </div>
          <div style={{ fontSize:11, color:"#334155", fontWeight:em.seen?400:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{em.subject}</div>
         </div>
        );
       })}
      </div>

      {/* Email body pane */}
      <div style={{ flex:1, overflowY:"auto", padding:"18px 22px" }}>
       {!selectedEmail ? (
        <div style={{ color:"#94A3B8", textAlign:"center", marginTop:40, fontSize:13 }}>Select an email to read</div>
       ) : loadingBody ? (
        <div style={{ color:"#64748B", textAlign:"center", marginTop:40 }}>Loading email…</div>
       ) : emailBody ? (
        <div>
         <div style={{ marginBottom:14, paddingBottom:12, borderBottom:"1px solid #E6ECF5" }}>
          <div style={{ fontWeight:700, fontSize:15, color:"#0F172A", marginBottom:5 }}>{selectedEmail.subject}</div>
          <div style={{ fontSize:12, color:"#64748B" }}>
           From: {selectedEmail.from?.name?`${selectedEmail.from.name} <${selectedEmail.from.address}>`:selectedEmail.from?.address}
           {" · "}{selectedEmail.date ? new Date(selectedEmail.date).toLocaleString("en-IN") : ""}
          </div>
         </div>
         {emailBody.html ? (
          <iframe title="email-body" srcDoc={emailBody.html}
           style={{ width:"100%", border:"none", minHeight:320, borderRadius:8 }}
           sandbox="allow-popups allow-popups-to-escape-sandbox"
           onLoad={e=>{try{e.target.style.height=e.target.contentDocument.body.scrollHeight+40+"px";}catch{}}}/>
         ) : (
          <div style={{ fontSize:13, color:"#334155", lineHeight:1.75, whiteSpace:"pre-wrap" }}>{emailBody.text||"(No content)"}</div>
         )}
         {emailBody.attachments?.length>0 && (
          <div style={{ marginTop:14, padding:"10px 14px", background:"#F8FAFC", borderRadius:8, border:"1px solid #E6ECF5" }}>
           <div style={{ fontWeight:700, fontSize:12, color:"#64748B", marginBottom:6 }}>Attachments</div>
           {emailBody.attachments.map((a,i)=>(
            <div key={i} style={{ fontSize:12, color:"#334155" }}>📎 {a.filename} ({a.size ? Math.round(a.size/1024)+"KB" : "?"})</div>
           ))}
          </div>
         )}
         <div style={{ marginTop:16, display:"flex", gap:8 }}>
          <Btn v="secondary" icon="send" s={{ fontSize:12, padding:"5px 13px" }} onClick={()=>openCompose({
           to: selectedEmail.direction==="sent"?(selectedEmail.to?.[0]?.address||""):(selectedEmail.from?.address||""),
           subject: selectedEmail.subject?.startsWith("Re:")?selectedEmail.subject:`Re: ${selectedEmail.subject}`,
           inReplyTo: selectedEmail.messageId||"",
           references: selectedEmail.messageId||"",
          })}>Reply</Btn>
         </div>
        </div>
       ) : null}
      </div>
     </div>
    )}
   </div>

   {/* ── Compose Modal ── */}
   {showCompose && (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.42)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center" }}>
     <div style={{ background:"#fff", borderRadius:16, padding:28, width:"min(620px,95vw)", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.25)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
       <div style={{ fontWeight:700, fontSize:16, color:"#0F172A" }}>{compose.inReplyTo?"Reply":"New Email"}</div>
       <button onClick={()=>setShowCompose(false)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:22, color:"#94A3B8", lineHeight:1 }}>×</button>
      </div>
      <div style={{ marginBottom:12 }}><label style={S.lbl}>To</label><input value={compose.to} onChange={e=>setCompose(p=>({...p,to:e.target.value}))} style={S.inp}/></div>
      <div style={{ marginBottom:12 }}><label style={S.lbl}>Subject</label><input value={compose.subject} onChange={e=>setCompose(p=>({...p,subject:e.target.value}))} style={S.inp}/></div>
      <div style={{ marginBottom:18 }}><label style={S.lbl}>Message</label>
       <textarea value={compose.body} onChange={e=>setCompose(p=>({...p,body:e.target.value}))} rows={10}
        style={{ ...S.inp, resize:"vertical", lineHeight:1.65, minHeight:180 }}/>
      </div>
      <div style={{ marginBottom:16 }}>
       <label style={S.lbl}>Attachments</label>
       <label style={{ display:"inline-flex", alignItems:"center", gap:7, cursor:"pointer", padding:"7px 14px", background:"#F0F4F8", border:"1px dashed #CBD5E1", borderRadius:8, fontSize:12, color:"#334155", fontWeight:600 }}>
        📎 Add Files
        <input type="file" multiple style={{ display:"none" }} onChange={e=>setAttachFiles(prev=>[...prev, ...Array.from(e.target.files)])}/>
       </label>
       {attachFiles.length>0 && (
        <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:6 }}>
         {attachFiles.map((f,i)=>(
          <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:5, background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:6, padding:"3px 9px", fontSize:11, color:"#1E40AF" }}>
           📎 {f.name}
           <button onClick={()=>setAttachFiles(prev=>prev.filter((_,j)=>j!==i))} style={{ background:"none", border:"none", cursor:"pointer", color:"#94A3B8", fontSize:14, lineHeight:1, padding:0, marginLeft:2 }}>×</button>
          </span>
         ))}
        </div>
       )}
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
       <Btn v="ghost" onClick={()=>setShowCompose(false)}>Cancel</Btn>
       <Btn icon="send" onClick={sendEmail} disabled={sending}>{sending?"Sending…":"Send Email"}</Btn>
      </div>
     </div>
    </div>
   )}
  </div>
 );
}
function WhatsAppModal({ lead, bizSettings, companyProfile, onClose }) {
 const templates = Array.isArray(bizSettings?.whatsapp_templates) && bizSettings.whatsapp_templates.length
  ? bizSettings.whatsapp_templates
  : DEFAULT_BIZ_SETTINGS.whatsapp_templates;
 const bizName = companyProfile?.name || "Safarnaama Holidays";
 const fillMsg = (tpl) => {
  if (!tpl) return "";
  const kidsText = (lead.kids || 0) > 0 ? ` + ${lead.kids} child${Number(lead.kids) > 1 ? "ren" : ""}` : "";
  const dateStr = lead.travel_date
   ? new Date(lead.travel_date).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })
   : "TBD";
  return (tpl.message || "")
   .replace(/{name}/gi,        lead.name        || "there")
   .replace(/{destination}/gi, lead.destination  || "your destination")
   .replace(/{travel_date}/gi, dateStr)
   .replace(/{pax}/gi,         String(lead.pax   || 2))
   .replace(/{kids}/gi,        String(lead.kids  || 0))
   .replace(/{kids_text}/gi,   kidsText)
   .replace(/{budget}/gi,      lead.budget       || "")
   .replace(/{agent}/gi,       bizName)
   .replace(/{notes}/gi,       lead.notes        || "");
 };
 const [tplIdx, setTplIdx] = useState(0);
 const [phone, setPhone]   = useState(lead.phone || "");
 const [msg, setMsg]       = useState(() => fillMsg(templates[0]));
 const fmtPhone = (p) => {
  let n = (p || "").replace(/\D/g, "");
  if (n.startsWith("0")) n = "91" + n.slice(1);
  if (n.length === 10) n = "91" + n;
  return n;
 };
 const openWA = () => {
  const n = fmtPhone(phone);
  if (!n) { alert("Please enter a valid phone number before opening WhatsApp."); return; }
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`, "_blank");
 };
 const lbl = { display:"block", color:"#64748B", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:5 };
 const inp = { width:"100%", background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:8, padding:"9px 13px", color:"#0F172A", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
 const VARS = ["{name}","{destination}","{travel_date}","{pax}","{kids}","{kids_text}","{budget}","{agent}"];
 return (
  <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center" }}>
   <div style={{ background:"#fff", borderRadius:16, padding:28, width:"min(560px,95vw)", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.25)" }}>
    {/* Header */}
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
     <div>
      <div style={{ fontWeight:700, fontSize:16, color:"#0F172A", display:"flex", alignItems:"center", gap:8 }}>
       <span style={{ fontSize:22 }}>💬</span> WhatsApp Follow-up
      </div>
      <div style={{ fontSize:13, color:"#64748B", marginTop:3 }}>{lead.name} — {lead.destination}</div>
     </div>
     <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:22, color:"#94A3B8", lineHeight:1 }}>×</button>
    </div>
    {/* Template selector */}
    {templates.length > 0 ? (
     <div style={{ marginBottom:14 }}>
      <label style={lbl}>Select Template</label>
      <select value={tplIdx} onChange={e=>{ const i=Number(e.target.value); setTplIdx(i); setMsg(fillMsg(templates[i])); }}
       style={{ width:"100%", background:"#F8FAFC", border:"1px solid #D5E1EE", borderRadius:8, padding:"9px 13px", color:"#0F172A", fontSize:13, outline:"none", fontFamily:"inherit" }}>
       {templates.map((t,i)=><option key={t.id||i} value={i}>{t.name}</option>)}
      </select>
     </div>
    ) : (
     <div style={{ background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:8, padding:12, marginBottom:14, fontSize:12, color:"#92400E" }}>
      No templates configured. Add them in <strong>Settings → WhatsApp Templates</strong>.
     </div>
    )}
    {/* Phone */}
    <div style={{ marginBottom:14 }}>
     <label style={lbl}>Phone Number</label>
     <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+91 98765 43210" style={inp}/>
    </div>
    {/* Message */}
    <div style={{ marginBottom:6 }}>
     <label style={lbl}>Message Preview</label>
     <textarea value={msg} onChange={e=>setMsg(e.target.value)} rows={6}
      style={{ ...inp, resize:"vertical", minHeight:110, lineHeight:1.6 }}/>
    </div>
    <div style={{ fontSize:11, color:"#94A3B8", marginBottom:18 }}>You can edit the message above before opening WhatsApp.</div>
    {/* Variables hint */}
    <div style={{ fontSize:11, color:"#64748B", background:"#F8FAFC", border:"1px solid #E6ECF5", borderRadius:7, padding:"7px 12px", marginBottom:18 }}>
     <strong>Variables:</strong>{" "}{VARS.map(v=><code key={v} style={{ background:"#e2e8f0", borderRadius:3, padding:"1px 5px", marginRight:4 }}>{v}</code>)}
    </div>
    {/* Actions */}
    <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
     <Btn v="ghost" onClick={onClose}>Cancel</Btn>
     <button onClick={openWA}
      style={{ display:"flex", alignItems:"center", gap:8, background:"#25D366", color:"#fff", border:"none", borderRadius:9, padding:"10px 22px", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
      <svg viewBox="0 0 24 24" width={18} height={18} fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.12.555 4.11 1.52 5.838L0 24l6.335-1.495A11.95 11.95 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.83 9.83 0 0 1-5.012-1.374l-.36-.214-3.727.879.925-3.63-.235-.374A9.804 9.804 0 0 1 2.18 12c0-5.418 4.402-9.818 9.82-9.818 5.418 0 9.818 4.4 9.818 9.818 0 5.418-4.4 9.818-9.818 9.818z"/></svg>
      Open WhatsApp
     </button>
    </div>
   </div>
  </div>
 );
}
// ─── LEAD DOCUMENTS MODAL ─────────────────────────────────────────────────────
const DOC_TYPES = [
 { value:"passport",      label:"Passport",        icon:"🛂" },
 { value:"aadhar",        label:"Aadhaar Card",     icon:"🪪" },
 { value:"visa",          label:"Visa",             icon:"🌐" },
 { value:"pan",           label:"PAN Card",         icon:"💳" },
 { value:"ticket",        label:"Flight Ticket",    icon:"✈️" },
 { value:"hotel_voucher", label:"Hotel Voucher",    icon:"🏨" },
 { value:"insurance",     label:"Travel Insurance", icon:"🛡️" },
 { value:"photo",         label:"Photograph",       icon:"🖼️" },
 { value:"other",         label:"Other",            icon:"📄" },
];
const docIcon  = t => DOC_TYPES.find(d=>d.value===t)?.icon  || "📄";
const docLabel = t => DOC_TYPES.find(d=>d.value===t)?.label || "Document";
const fmtBytes = n => n >= 1048576 ? (n/1048576).toFixed(1)+" MB" : n >= 1024 ? (n/1024).toFixed(0)+" KB" : (n||0)+" B";
const fmtDocDate = d => { try { return new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); } catch { return d||""; } };

function LeadDocsModal({ lead, onClose, toast$ }) {
 const [docs, setDocs]         = useState([]);
 const [loading, setLoading]   = useState(true);
 const [uploading, setUploading] = useState(false);
 const [docType, setDocType]   = useState("passport");
 const [notes, setNotes]       = useState("");
 const [deleting, setDeleting] = useState(null);
 const fileRef = useRef();

 const load = async () => {
  setLoading(true);
  try {
   const r = await fetch(`/api/leads/${lead.id}/documents`);
   if (r.ok) setDocs(await r.json());
  } catch {}
  setLoading(false);
 };
 useEffect(() => { load(); }, []); // eslint-disable-line

 const upload = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = null;
  if (file.size > 20 * 1024 * 1024) { toast$("File too large — max 20 MB", true); return; }
  setUploading(true);
  const fd = new FormData();
  fd.append("file", file);
  fd.append("doc_type", docType);
  fd.append("notes", notes);
  // Send lead info so backend can upsert the lead if it doesn't exist in Supabase yet
  fd.append("lead_data", JSON.stringify({ id: lead.id, name: lead.name || "Unknown", email: lead.email || "", phone: lead.phone || "", destination: lead.destination || "", status: lead.status || "New" }));
  try {
   const r = await fetch(`/api/leads/${lead.id}/documents`, { method:"POST", body: fd });
   const d = await r.json();
   if (r.ok) { setDocs(p => [d, ...p]); setNotes(""); toast$(`${file.name} uploaded ✓`); }
   else toast$(d.error || "Upload failed", true);
  } catch { toast$("Upload failed", true); }
  setUploading(false);
 };

 const download = async (doc) => {
  try {
   const r = await fetch(`/api/leads/documents/${doc.id}/url`);
   const d = await r.json();
   if (!r.ok) { toast$(d.error || "Download failed", true); return; }
   window.open(d.url, "_blank");
  } catch { toast$("Download failed", true); }
 };

 const del = async (doc) => {
  if (!window.confirm(`Delete "${doc.original_name || doc.file_name}"?`)) return;
  setDeleting(doc.id);
  try {
   const r = await fetch(`/api/leads/documents/${doc.id}`, { method:"DELETE" });
   if (r.ok) { setDocs(p => p.filter(x => x.id !== doc.id)); toast$("Document deleted"); }
   else { const d = await r.json(); toast$(d.error || "Delete failed", true); }
  } catch { toast$("Delete failed", true); }
  setDeleting(null);
 };

 const inp = { width:"100%", background:"#F8FAFC", border:"1px solid #D5E1EE", borderRadius:8, padding:"9px 13px", color:"#0F172A", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
 const lbl = { display:"block", color:"#64748B", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:5 };

 return (
  <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:10000, display:"flex", alignItems:"center", justifyContent:"center" }}>
   <div style={{ background:"#fff", borderRadius:16, padding:28, width:"min(620px,95vw)", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,.3)", display:"flex", flexDirection:"column", gap:0 }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
     <div>
      <div style={{ fontWeight:700, fontSize:16, color:"#0F172A" }}>📎 Lead Documents</div>
      <div style={{ fontSize:12, color:"#64748B", marginTop:3 }}>{lead.name} — {lead.destination}</div>
     </div>
     <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:22, color:"#94A3B8", lineHeight:1 }}>×</button>
    </div>

    {/* Upload strip */}
    <div style={{ background:"#F8FAFC", border:"1px dashed #CBD5E1", borderRadius:12, padding:16, marginBottom:20 }}>
     <div style={{ fontWeight:600, fontSize:13, color:"#0F172A", marginBottom:12 }}>Upload New Document</div>
     <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
      <div>
       <label style={lbl}>Document Type</label>
       <select value={docType} onChange={e=>setDocType(e.target.value)} style={{ ...inp, cursor:"pointer" }}>
        {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.icon} {d.label}</option>)}
       </select>
      </div>
      <div>
       <label style={lbl}>Notes (optional)</label>
       <input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="e.g. Expires 2027, Front side" style={inp}/>
      </div>
     </div>
     <input ref={fileRef} type="file" style={{ display:"none" }}
      accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
      onChange={upload}/>
     <Btn icon="upload" onClick={()=>fileRef.current?.click()} disabled={uploading}>
      {uploading ? "Uploading…" : "Choose File & Upload"}
     </Btn>
     <div style={{ fontSize:11, color:"#94A3B8", marginTop:8 }}>Accepted: PDF, JPG, PNG, DOC, DOCX, XLS · Max 20 MB · Stored securely in Supabase Storage</div>
    </div>

    {/* Document list */}
    {loading ? (
     <div style={{ textAlign:"center", padding:30, color:"#94A3B8" }}>Loading documents…</div>
    ) : docs.length === 0 ? (
     <div style={{ textAlign:"center", padding:30, color:"#94A3B8", border:"1px solid #E6ECF5", borderRadius:10 }}>
      <div style={{ fontSize:32, marginBottom:8 }}>📂</div>
      <div style={{ fontWeight:600, color:"#64748B" }}>No documents yet</div>
      <div style={{ fontSize:12, marginTop:4 }}>Upload passport, visa, Aadhaar and other documents above so you never have to ask the client again.</div>
     </div>
    ) : (
     <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ fontSize:12, color:"#64748B", fontWeight:600, marginBottom:4 }}>{docs.length} document{docs.length!==1?"s":""} stored</div>
      {docs.map(doc => (
       <div key={doc.id} style={{ display:"flex", alignItems:"center", gap:12, background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:10, padding:"10px 14px" }}>
        <div style={{ fontSize:28, flexShrink:0 }}>{docIcon(doc.doc_type)}</div>
        <div style={{ flex:1, minWidth:0 }}>
         <div style={{ fontWeight:600, fontSize:13, color:"#0F172A", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{doc.original_name||doc.file_name}</div>
         <div style={{ fontSize:11, color:"#94A3B8", marginTop:2, display:"flex", gap:8, flexWrap:"wrap" }}>
          <span style={{ background:"#EFF6FF", color:"#1D4ED8", borderRadius:4, padding:"1px 6px", fontWeight:600 }}>{docLabel(doc.doc_type)}</span>
          <span>{fmtBytes(doc.file_size)}</span>
          <span>Uploaded {fmtDocDate(doc.created_at)}</span>
          {doc.notes && <span style={{ color:"#64748B" }}>· {doc.notes}</span>}
         </div>
        </div>
        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
         <Btn v="secondary" s={{ fontSize:11, padding:"4px 10px" }} onClick={()=>download(doc)}>⬇ View</Btn>
         <Btn v="ghost" s={{ fontSize:11, padding:"4px 8px", color:"#EF4444" }} onClick={()=>del(doc)} disabled={deleting===doc.id}>{deleting===doc.id?"…":"✕"}</Btn>
        </div>
       </div>
      ))}
     </div>
    )}
   </div>
  </div>
 );
}

 function PageLeads({ leads, setLeads, users, currentUser, onPickMethod, onDownloadLeads, onUploadLeads, bizSettings, setBizSettings, refData, refLoading, toast$, onPreview, invoices, vouchers, itineraries: allItineraries, companyProfile }) {
 const allDestinations = [...(refData?.destinations||[]), ...(bizSettings.custom_destinations||[])];
 const addCustomDest  = val => setBizSettings(p=>({...p, custom_destinations:[...new Set([...(p.custom_destinations||[]),val])]}));
 const leadStatuses = bizSettings?.lead_statuses || ["New","Quote Requested","Quote Received","Quote Sent","Confirmed","Cancelled"];
 const [showAdd, setShowAdd] = useState(false);
 const [search, setSearch] = useState("");
 const LEAD_SOURCES = ["Walk-in","Phone","Website","Facebook","Instagram","WhatsApp","Google Ads","Referral","Other"];
 const BUDGET_RANGES = ["<50K","50K–1L","1L–2L","2L–5L","5L+"];
 const [form, setForm] = useState({ name:"", email:"", phone:"", destination:"", pax:2, kids:0, budget:"", budget_range:"", travel_date:"", end_date:"", notes:"", assigned_to:"", source:"", follow_up_date:"" });
 const [editingId, setEditingId] = useState(null);
 const [waModal, setWaModal]     = useState(null);
 const [docsModal, setDocsModal] = useState(null);
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
 setForm({ name:"",email:"",phone:"",destination:"",pax:2,kids:0,budget:"",budget_range:"",travel_date:"",end_date:"",notes:"",assigned_to:"",source:"",follow_up_date:"" });
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
 <F label="Destination" req>
  <SelectOrAdd value={form.destination} options={allDestinations} onChange={v=>setForm(p=>({...p,destination:v}))} onAddNew={addCustomDest} placeholder="— Select destination —" loading={refLoading && !allDestinations.length}/>
 </F>
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
 <F label="Lead Source">
 <Sel value={form.source||""} onChange={fld("source")}>
  <option value="">— Select source —</option>
  {LEAD_SOURCES.map(s=><option key={s} value={s}>{s}</option>)}
 </Sel>
 </F>
 <F label="Budget Range">
 <Sel value={form.budget_range||""} onChange={fld("budget_range")}>
  <option value="">— Select range —</option>
  {BUDGET_RANGES.map(b=><option key={b} value={b}>{b}</option>)}
 </Sel>
 </F>
 <F label="Follow-up Date"><Inp type="date" value={form.follow_up_date||""} onChange={fld("follow_up_date")}/></F>
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
 {["ID","Client","Destination","Source","Pax","Date","Budget","Follow-up","Status","Actions"].map(h=><th key={h} style={{ padding:"9px 13px", textAlign:"left", fontSize:10, color:"#475569", fontWeight:700, textTransform:"uppercase", letterSpacing:.5, whiteSpace:"nowrap" }}>{h}</th>)}
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
 <td style={{ padding:"10px 13px" }}>
  {lead.source && <span style={{ background:"#E0F7FA", color:"#0284C7", borderRadius:5, padding:"2px 7px", fontSize:10, fontWeight:600 }}>{lead.source}</span>}
  {!lead.source && <span style={{ color:"#CBD5E1", fontSize:11 }}>—</span>}
  {lead.assigned_to && <div style={{ fontSize:10, color:"#94a3b8", marginTop:2 }}>{lead.assigned_to}</div>}
 </td>
 <td style={{ padding:"10px 13px", color:"#334155", fontSize:12 }}>{lead.pax}A {lead.kids>0?`${lead.kids}K`:""}</td>
 <td style={{ padding:"10px 13px", color:"#334155", fontSize:12 }}>
  {lead.travel_date}{lead.end_date ? ` → ${lead.end_date}` : ""}
  {lead.end_date && (() => {
    const leadDuration = calcDuration(lead.travel_date, lead.end_date);
    return leadDuration.days > 0 ? <div style={{ fontSize:11, color:"#64748B", marginTop:4 }}>{leadDuration.days} day{leadDuration.days!==1?"s":""} · {leadDuration.nights} night{leadDuration.nights!==1?"s":""}</div> : null;
  })()}
 </td>
 <td style={{ padding:"10px 13px", fontSize:12 }}>
  {lead.budget_range && <div style={{ color:"#FFB74D", fontWeight:600 }}>{lead.budget_range}</div>}
  {lead.budget && <div style={{ color:"#94a3b8", fontSize:11 }}>₹{lead.budget}</div>}
 </td>
 <td style={{ padding:"10px 13px", fontSize:11 }}>
  {lead.follow_up_date ? (
   <span style={{ color: lead.follow_up_date < today() ? "#dc2626" : lead.follow_up_date === today() ? "#d97706" : "#16a34a", fontWeight: lead.follow_up_date <= today() ? 700 : 400 }}>
    {lead.follow_up_date === today() ? "Today" : lead.follow_up_date}
    {lead.follow_up_date < today() && " ⚠"}
   </span>
  ) : <span style={{ color:"#CBD5E1" }}>—</span>}
 </td>
 <td style={{ padding:"10px 13px" }}>
 <Sel value={lead.status} onChange={e=>updateStatus(lead.id,e.target.value)} style={{ padding:"3px 7px", fontSize:11, width:"auto" }}>
 {leadStatuses.map(s=><option key={s}>{s}</option>)}
 </Sel>
 </td>
 <td style={{ padding:"8px 13px" }}>
 {(() => {
  const safeInvs = Array.isArray(invoices) ? invoices : [];
  const safeVchs = Array.isArray(vouchers) ? vouchers : [];
  const safeItins = Array.isArray(allItineraries) ? allItineraries : [];
  const leadItin = safeItins.filter(x=>x.lead_id===lead.id).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0];
  const leadInv  = safeInvs.filter(x=>x.lead_id===lead.id).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))[0];
  const leadVch  = safeVchs.find(x=>x.lead_id===lead.id);
  const EyeIcon = () => <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>;
  const previewBtn = (dtype, doc) => (
   <button onClick={()=>onPreview(dtype,doc)} title={`Preview ${dtype}`} style={{ display:"flex", alignItems:"center", gap:3, background:"none", border:"1px solid #e2e8f0", borderRadius:5, padding:"2px 6px", cursor:"pointer", fontSize:10, color:"#1A6B8A", fontWeight:600 }}>
    <EyeIcon/>{dtype==="itinerary"?"Itin":dtype==="invoice"?"Inv":"Vchr"}
   </button>
  );
  const createBtn = (actionType, label) => (
   <Btn v="secondary" s={{ padding:"2px 7px", fontSize:10 }} onClick={()=>onPickMethod(lead, actionType)}>{label}</Btn>
  );
  return (
   <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
    {/* Row 1: Stage pipeline */}
    <div style={{ display:"flex", gap:4, flexWrap:"wrap", alignItems:"center" }}>
     {leadItin ? previewBtn("itinerary", leadItin) : createBtn("itinerary","+ Itin")}
     {leadItin && !leadInv && createBtn("invoice","+ Invoice")}
     {leadInv  ? previewBtn("invoice", leadInv) : null}
     {leadInv && !leadVch && createBtn("voucher","+ Voucher")}
     {leadVch  ? previewBtn("voucher", leadVch) : null}
    </div>
    {/* Row 2: Utility actions */}
    <div style={{ display:"flex", gap:4, alignItems:"center" }}>
     <button title="WhatsApp Follow-up" onClick={()=>setWaModal(lead)}
      style={{ display:"flex", alignItems:"center", gap:3, background:"#25D366", border:"none", borderRadius:5, padding:"2px 7px", cursor:"pointer", fontSize:10, color:"#fff", fontWeight:700, fontFamily:"inherit" }}>
      <svg viewBox="0 0 24 24" width={11} height={11} fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.12.555 4.11 1.52 5.838L0 24l6.335-1.495A11.95 11.95 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.83 9.83 0 0 1-5.012-1.374l-.36-.214-3.727.879.925-3.63-.235-.374A9.804 9.804 0 0 1 2.18 12c0-5.418 4.402-9.818 9.82-9.818 5.418 0 9.818 4.4 9.818 9.818 0 5.418-4.4 9.818-9.818 9.818z"/></svg>
      WA
     </button>
     <Btn v="ghost" s={{ padding:"2px 6px", fontSize:10, color:"#64748b" }} onClick={()=>setDocsModal(lead)} title="Lead documents">📎 Docs</Btn>
     <Btn v="ghost" s={{ padding:"2px 6px", fontSize:10, color:"#64748b" }} onClick={()=>onPickMethod(lead,"quote")} title="Send vendor email">Quote</Btn>
     <Btn v="ghost" s={{ padding:"2px 6px", fontSize:10 }} onClick={()=>{ setShowAdd(true); setEditingId(lead.id); setForm({ name:lead.name||"", email:lead.email||"", phone:lead.phone||"", destination:lead.destination||"", pax:lead.pax||2, kids:lead.kids||0, budget:lead.budget||"", budget_range:lead.budget_range||"", travel_date:lead.travel_date||"", end_date:lead.end_date||"", notes:lead.notes||"", assigned_to:lead.assigned_to||"", source:lead.source||"", follow_up_date:lead.follow_up_date||"" }); window.scrollTo({ top:0, behavior:"smooth" }); }}>Edit</Btn>
     <Btn v="ghost" s={{ padding:"2px 6px", fontSize:10, color:"#EF9A9A" }} onClick={()=>del(lead.id)}>✕</Btn>
    </div>
   </div>
  );
 })()}
 </td>
 </tr>
 ))}
 {filtered.length===0 && <tr><td colSpan={9} style={{ padding:30, textAlign:"center", color:"#94A3B8" }}>No leads found</td></tr>}
 </tbody>
 </table>
 </div>
 {waModal && <WhatsAppModal lead={waModal} bizSettings={bizSettings} companyProfile={companyProfile} onClose={()=>setWaModal(null)}/>}
 {docsModal && <LeadDocsModal lead={docsModal} onClose={()=>setDocsModal(null)} toast$={toast$}/>}
 </div>
 );
}
// ─── PAGE: QUOTES ─────────────────────────────────────────────────────────────
function PageQuotes({ quotes, setQuotes, vendors, leads, bizSettings, toast$, onPreview }) {
 const base = bizSettings?.quote_statuses || ["Quote Requested","Quote Received","Quote Sent"];
 const quoteStatuses = base.includes("Confirmed") ? base : [...base, "Confirmed"];
 const cur = n => `${bizSettings?.currency_symbol||"₹"}${Number(n||0).toLocaleString(bizSettings?.currency_locale||"en-IN")}`;
 const updateQuoteStatus = (id, newStatus) => {
  setQuotes(prev => prev.map(q => q.id === id ? { ...q, status: newStatus } : q));
  toast$(`Quote status updated to ${newStatus}`);
 };
 return (
 <div>
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, overflow:"hidden" }}>
 <div style={{ padding:"13px 18px", borderBottom:"1px solid #E6ECF5", fontWeight:700, color:"#0F172A", fontSize:14 }}>Quote Log ({quotes.length})</div>
 {quotes.length===0 ? <div style={{ padding:40, textAlign:"center", color:"#94A3B8" }}>No quotes yet. Go to Leads → click Quote button, or upload a vendor quote.</div> : (
 <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
 <thead><tr style={{ background:"#F6F8FC" }}>{["Query Code","Lead","Destination","Details","Date","Status","Actions"].map(h=><th key={h} style={{ padding:"9px 13px", textAlign:"left", fontSize:10, color:"#475569", fontWeight:700, textTransform:"uppercase" }}>{h}</th>)}</tr></thead>
 <tbody>
 {quotes.map(q=>(
 <tr key={q.id} className="row" style={{ borderBottom:"1px solid #EEF3F9" }}>
 <td style={{ padding:"10px 13px", fontWeight:700, color:"#4FC3F7" }}>
  {q.query_code}
  {q.type==="vendor_quote" && <span style={{ marginLeft:6, background:"#E0F2FE", color:"#0284C7", borderRadius:4, padding:"1px 5px", fontSize:10 }}>VENDOR FILE</span>}
 </td>
 <td style={{ padding:"10px 13px", color:"#0F172A" }}>{q.lead_name||"—"}</td>
 <td style={{ padding:"10px 13px" }}>{q.destination}</td>
 <td style={{ padding:"10px 13px", fontSize:11, color:"#64748B" }}>
  {q.type==="vendor_quote"
   ? <span>{q.hotel_name || q.vendor_name || "—"} · <strong style={{ color:"#16A34A" }}>{cur(q.final_cost)}</strong> · {q.pax||1} pax</span>
   : <span>{(q.vendors_contacted||[]).length} vendor{(q.vendors_contacted||[]).length!==1?"s":""} contacted</span>
  }
 </td>
 <td style={{ padding:"10px 13px", fontSize:11, color:"#64748B" }}>{q.created_at}</td>
 <td style={{ padding:"10px 13px" }}>
  <Sel value={q.status} onChange={e => updateQuoteStatus(q.id, e.target.value)} style={{ padding:"3px 7px", fontSize:11, width:"auto" }}>
   {quoteStatuses.map(s=><option key={s}>{s}</option>)}
  </Sel>
 </td>
 <td style={{ padding:"10px 13px" }}>
  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
   <button title="Preview customer quote" onClick={()=>onPreview(q)} style={{ background:"none", border:"none", cursor:"pointer", padding:"3px 4px", color:"#94a3b8", display:"flex", alignItems:"center" }}><svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></button>
   <Btn v="ghost" s={{ fontSize:11, color:"#EF9A9A", padding:"3px 0" }} onClick={()=>{ setQuotes(p=>p.filter(x=>x.id!==q.id)); toast$("Quote removed"); }}>Remove</Btn>
  </div>
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
function PageVendors({ vendors, setVendors, onDownloadVendors, onUploadVendors, bizSettings, setBizSettings, refData, toast$ }) {
 const vendorCategories = bizSettings?.vendor_categories || ["Hotel","Resort","Villa","Tour Operator","DMC","Activity"];
 const allDestinations = [...(refData?.destinations||[]), ...(bizSettings?.custom_destinations||[])];
 const [showAdd, setShowAdd] = useState(false);
 const [editingVendorId, setEditingVendorId] = useState(null);
 const [search, setSearch] = useState("");
 const [filterDest, setFilterDest] = useState("");
 const [filterCat, setFilterCat] = useState("");
 const [saving, setSaving] = useState(false);
 const [form, setForm] = useState({ name:"", email:"", email2:"", phone:"", destination:"", category:"", rating:"", markup_type:"percent", markup_value:"", status:"Active" });
 const fileRef = useRef();
 const fld = k => e => setForm(p=>({...p,[k]:e.target.value}));
 const resetForm = () => setForm({ name:"", email:"", email2:"", phone:"", destination:"", category:"", rating:"", markup_type:"percent", markup_value:"", status:"Active" });
 const startEditing = vendor => { setForm({ ...vendor }); setEditingVendorId(vendor.id); setShowAdd(true); };
 const save = async () => {
  if (!form.name||!form.email||!form.destination) return toast$("Name, email and destination required", true);
  setSaving(true);
  try {
   if (editingVendorId) {
    const r = await fetch(`/api/vendors/${editingVendorId}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(form) });
    const updated = r.ok ? await r.json() : null;
    setVendors(p => p.map(v => v.id===editingVendorId ? (updated || { ...v, ...form }) : v));
    toast$(`Vendor "${form.name}" updated!`);
   } else {
    const r = await fetch("/api/vendors", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(form) });
    const created = r.ok ? await r.json() : null;
    setVendors(p => [...p, created || { ...form, id:genId("V"), status:"Active" }]);
    toast$(`Vendor "${form.name}" registered!`);
   }
  } catch { toast$("Saved locally — backend unreachable", false); }
  setSaving(false);
  setShowAdd(false); setEditingVendorId(null); resetForm();
 };
 const toggleStatus = async v => {
  const newStatus = v.status==="Active" ? "Inactive" : "Active";
  setVendors(p => p.map(x => x.id===v.id ? { ...x, status:newStatus } : x));
  fetch(`/api/vendors/${v.id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ status:newStatus }) }).catch(()=>{});
  toast$(`Vendor "${v.name}" ${newStatus==="Active"?"activated":"deactivated"}`);
 };
 const removeVendor = async v => {
  setVendors(p => p.filter(x => x.id!==v.id));
  fetch(`/api/vendors/${v.id}`, { method:"DELETE" }).catch(()=>{});
  toast$("Vendor removed");
 };
 const isEditing = Boolean(editingVendorId);
 const destOptions = [...new Set(vendors.map(v=>v.destination).filter(Boolean))].sort();
 const catOptions  = [...new Set(vendors.map(v=>v.category).filter(Boolean))].sort();
 const q = search.toLowerCase();
 const filtered = vendors.filter(v =>
  (!q || v.name?.toLowerCase().includes(q) || v.destination?.toLowerCase().includes(q) || v.email?.toLowerCase().includes(q)) &&
  (!filterDest || v.destination===filterDest) &&
  (!filterCat  || v.category===filterCat)
 );
 return (
 <div>
 <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12, gap:10, flexWrap:"wrap", alignItems:"center" }}>
  <div style={{ display:"flex", gap:8, flex:1, flexWrap:"wrap", alignItems:"center" }}>
   <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search vendors…"
    style={{ ...IS, flex:"1 1 180px", maxWidth:260, padding:"7px 11px", fontSize:13 }}/>
   <select value={filterDest} onChange={e=>setFilterDest(e.target.value)} style={{ ...IS, flex:"0 0 auto", padding:"7px 10px", fontSize:12, width:"auto" }}>
    <option value="">All Destinations</option>
    {destOptions.map(d=><option key={d} value={d}>{d}</option>)}
   </select>
   <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{ ...IS, flex:"0 0 auto", padding:"7px 10px", fontSize:12, width:"auto" }}>
    <option value="">All Categories</option>
    {catOptions.map(c=><option key={c} value={c}>{c}</option>)}
   </select>
   <span style={{ fontSize:12, color:"#64748B", whiteSpace:"nowrap" }}>{filtered.length} / {vendors.length} vendors</span>
  </div>
  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
   <Btn v="secondary" icon="upload" onClick={()=>fileRef.current?.click()}>Upload</Btn>
   <Btn v="secondary" icon="download" onClick={onDownloadVendors}>Download</Btn>
   <Btn v="secondary" onClick={()=>{ const existing=vendors.filter(v=>!SEED_VENDORS.some(s=>s.id===v.id)); setVendors([...SEED_VENDORS,...existing]); toast$(`Loaded ${SEED_VENDORS.length} preset vendors!`); }}>🏨 Presets</Btn>
   <Btn icon="plus" onClick={()=>{ if(showAdd){setShowAdd(false);setEditingVendorId(null);resetForm();}else{setShowAdd(true);setEditingVendorId(null);resetForm();} }}>{showAdd?"Cancel":"+ Vendor"}</Btn>
  </div>
 </div>
 <input ref={fileRef} type="file" accept=".json,.csv,.txt,.xls,.xlsx,.pdf,.doc,.docx,.png,.jpg,.jpeg" style={{ display:"none" }} onChange={e=>{ const file=e.target.files?.[0]; if(file){onUploadVendors(file);e.target.value=null;} }}/>
 {showAdd && (
 <div className="fadein" style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:12, padding:18, marginBottom:18 }}>
 <div style={{ fontWeight:700, color:"#0F172A", marginBottom:14 }}>{isEditing?"Edit Vendor":"New Vendor"}</div>
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:11 }}>
 <F label="Vendor Name" req><Inp value={form.name} onChange={fld("name")} placeholder="Company name"/></F>
 <F label="Email" req><Inp type="email" value={form.email} onChange={fld("email")} placeholder="vendor@email.com"/></F>
 <F label="Email 2"><Inp type="email" value={form.email2} onChange={fld("email2")} placeholder="alternate@email.com"/></F>
 <F label="Phone"><Inp value={form.phone} onChange={fld("phone")} placeholder="+91 XXXXXXXXXX"/></F>
 <F label="Destination" req>
  <SelectOrAdd value={form.destination} options={allDestinations}
   onChange={v=>setForm(p=>({...p,destination:v}))}
   onAddNew={v=>setBizSettings && setBizSettings(p=>({...p,custom_destinations:[...new Set([...(p.custom_destinations||[]),v])]}))}
   placeholder="e.g. Vietnam"/>
 </F>
 <F label="Category">
  <SelectOrAdd value={form.category} options={vendorCategories}
   onChange={v=>setForm(p=>({...p,category:v}))}
   onAddNew={v=>setBizSettings && setBizSettings(p=>({...p,vendor_categories:[...new Set([...(p.vendor_categories||[]),v])]})) }
   placeholder="Select"/>
 </F>
 <F label="Rating"><Inp type="number" min="1" max="5" step="0.1" value={form.rating} onChange={fld("rating")} placeholder="4.5"/></F>
 <F label="Markup Type">
  <select value={form.markup_type||"percent"} onChange={fld("markup_type")} style={{ ...IS, padding:"9px 12px" }}>
   <option value="percent">% Percentage</option>
   <option value="flat">₹ Flat Amount</option>
  </select>
 </F>
 <F label="Markup Value" req={false}><Inp type="number" min="0" value={form.markup_value||""} onChange={fld("markup_value")} placeholder={form.markup_type==="percent"?"e.g. 20 (= 20%)":"e.g. 5000 (₹ flat)"}/></F>
 </div>
 <div style={{ fontSize:11, color:"#64748B", marginBottom:10, background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:7, padding:"7px 12px" }}>
  💡 <strong>Markup</strong> is auto-applied when forwarding vendor quotes to employees. Set it once per vendor — no manual entry needed on each reply.
 </div>
 <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
 <Btn v="secondary" onClick={()=>{ setShowAdd(false); setEditingVendorId(null); resetForm(); }}>Cancel</Btn>
 <Btn v="success" icon="check" onClick={save} disabled={saving}>{saving?"Saving…":isEditing?"Save":"Register"}</Btn>
 </div>
 </div>
 )}
 {filtered.length===0 && (
  <div style={{ background:"#F8FAFC", border:"1px dashed #D5E1EE", borderRadius:12, padding:40, textAlign:"center", color:"#94A3B8", fontSize:13 }}>
   {vendors.length===0 ? "No vendors registered yet." : "No vendors match your search."}
  </div>
 )}
 <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:14 }}>
 {filtered.map(v=>(
 <div key={v.id} className="card" style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:18, transition:"border-color .2s" }}>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
 <div><div style={{ fontWeight:700, color:"#0F172A", fontSize:14 }}>{v.name}</div><div style={{ fontSize:12, color:"#475569", marginTop:2 }}>{v.category} · {v.destination}</div></div>
 <Badge status={v.status}/>
 </div>
 <div style={{ fontSize:12, color:"#64748B", marginBottom:6 }}>{v.email}{v.email2 ? ` · ${v.email2}` : ""}</div>
 <div style={{ fontSize:12, color:"#64748B", marginBottom:6 }}>{v.phone || ""}</div>
 <div style={{ fontSize:12, color:"#475569" }}>★ {v.rating||"N/A"}{v.markup_value ? <span style={{ marginLeft:10, color:"#0369A1" }}>Markup: {v.markup_value}{v.markup_type==="percent"?"%":" ₹ flat"}</span> : ""}</div>
 <div style={{ marginTop:10, display:"flex", gap:8, flexWrap:"wrap" }}>
 <Btn v="ghost" s={{ fontSize:11, color:"#0284C7", padding:"3px 0" }} onClick={()=>startEditing(v)}>Edit</Btn>
 <Btn v="ghost" s={{ fontSize:11, color:v.status==="Active"?"#EF9A9A":"#16A34A", padding:"3px 0" }} onClick={()=>toggleStatus(v)}>{v.status==="Active"?"Deactivate":"Activate"}</Btn>
 <Btn v="ghost" s={{ fontSize:11, color:"#EF9A9A", padding:"3px 0" }} onClick={()=>removeVendor(v)}>Remove</Btn>
 </div>
 </div>
 ))}
 </div>
 </div>
 );
}
// ─── PAGE: INVOICES ───────────────────────────────────────────────────────────
function PageInvoices({ invoices, setInvoices, leads, onGenerate, onEdit, onPreview, onRecordPayment, bizSettings }) {
 const [filterStatus, setFilterStatus] = useState("All");
 const cur = n => `${bizSettings?.currency_symbol||"₹"}${Number(n||0).toLocaleString(bizSettings?.currency_locale||"en-IN")}`;
 const now = new Date();
 // Derived stats
 const totalOutstanding = invoices.reduce((s,i) => s + Math.max(0, Number(i.total||0) - Number(i.paid_amount||0)), 0);
 const totalCollected   = invoices.reduce((s,i) => s + Number(i.paid_amount||0), 0);
 const overdueCount     = invoices.filter(i => {
  const bal = Math.max(0, Number(i.total||0) - Number(i.paid_amount||0));
  return bal > 0 && i.due_date && new Date(i.due_date) < now;
 }).length;
 const payStatusOf = inv => {
  const bal = Math.max(0, Number(inv.total||0) - Number(inv.paid_amount||0));
  if (inv.status === "Cancelled") return "Cancelled";
  if (bal === 0 && Number(inv.total||0) > 0) return "Paid";
  if (Number(inv.paid_amount||0) > 0) return "Partially Paid";
  if (inv.due_date && new Date(inv.due_date) < now && bal > 0) return "Overdue";
  if (inv.status === "Sent") return "Sent";
  return "Draft";
 };
 const statusColor = { Paid:"#16a34a", "Partially Paid":"#d97706", Overdue:"#dc2626", Sent:"#2563eb", Draft:"#64748b", Cancelled:"#94a3b8" };
 const statusBg    = { Paid:"#F0FDF4", "Partially Paid":"#FFFBEB", Overdue:"#FEF2F2", Sent:"#EFF6FF", Draft:"#F8FAFC", Cancelled:"#F1F5F9" };
 const allStatuses = ["All","Draft","Sent","Partially Paid","Paid","Overdue","Cancelled"];
 const filtered = filterStatus === "All" ? invoices : invoices.filter(i => payStatusOf(i) === filterStatus);
 const eyeBtn = inv => (
  <button title="Preview" onClick={()=>onPreview(inv)} style={{ background:"none", border:"none", cursor:"pointer", padding:"3px 4px", color:"#94a3b8", display:"flex", alignItems:"center" }}>
   <svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
  </button>
 );
 return (
 <div>
  {/* Summary cards */}
  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12, marginBottom:18 }}>
   {[
    { label:"Total Invoices", value:invoices.length, sub:"all time", color:"#4FC3F7", bg:"#E0F7FA" },
    { label:"Outstanding", value:cur(totalOutstanding), sub:"unpaid + partial", color:"#d97706", bg:"#FFFBEB" },
    { label:"Collected", value:cur(totalCollected), sub:"payments received", color:"#16a34a", bg:"#F0FDF4" },
    { label:"Overdue", value:overdueCount, sub:`invoice${overdueCount!==1?"s":""} past due`, color:"#dc2626", bg:"#FEF2F2" },
   ].map(c=>(
    <div key={c.label} style={{ background:c.bg, border:`1px solid ${c.color}33`, borderRadius:12, padding:"14px 16px" }}>
     <div style={{ fontSize:10, color:"#64748b", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>{c.label}</div>
     <div style={{ fontSize:20, fontWeight:800, color:c.color }}>{c.value}</div>
     <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{c.sub}</div>
    </div>
   ))}
  </div>
  {/* Toolbar */}
  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:12, flexWrap:"wrap" }}>
   <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
    {allStatuses.map(s=>(
     <button key={s} onClick={()=>setFilterStatus(s)} style={{ padding:"4px 12px", borderRadius:20, border:`1px solid ${filterStatus===s?(statusColor[s]||"#4FC3F7"):"#D5E1EE"}`, background:filterStatus===s?(statusBg[s]||"#E0F7FA"):"#fff", color:filterStatus===s?(statusColor[s]||"#4FC3F7"):"#64748b", fontSize:11, fontWeight:filterStatus===s?700:400, cursor:"pointer" }}>
      {s}{s!=="All" && ` (${invoices.filter(i=>payStatusOf(i)===s).length})`}
     </button>
    ))}
   </div>
   <Sel style={{ width:230, padding:"7px 11px", fontSize:12 }} onChange={e=>{ const l=leads.find(x=>x.id===e.target.value); if(l) onGenerate(l); e.target.value=""; }}>
    <option value=""> + Create Invoice for Lead…</option>
    {leads.map(l=><option key={l.id} value={l.id}>{l.name} – {l.destination}</option>)}
   </Sel>
  </div>
  {/* Table */}
  {filtered.length===0 ? (
   <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:60, textAlign:"center", color:"#94A3B8" }}>
    {invoices.length===0 ? "No invoices yet. Select a lead above or click \"Inv\" on any lead row." : `No invoices with status "${filterStatus}".`}
   </div>
  ) : (
  <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, overflow:"hidden" }}>
   <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
    <thead><tr style={{ background:"#F6F8FC" }}>
     {["Invoice No","Client","Destination","Total","Paid","Balance Due","Due Date","Status","Actions"].map(h=>(
      <th key={h} style={{ padding:"9px 12px", textAlign:"left", fontSize:10, color:"#475569", fontWeight:700, textTransform:"uppercase", whiteSpace:"nowrap" }}>{h}</th>
     ))}
    </tr></thead>
    <tbody>
    {filtered.map((inv,i)=>{
     const paid = Number(inv.paid_amount||0);
     const bal  = Math.max(0, Number(inv.total||0) - paid);
     const pStat = payStatusOf(inv);
     const isOverdue = pStat === "Overdue";
     return (
     <tr key={inv.id||i} className="row" style={{ borderBottom:"1px solid #EEF3F9", background:isOverdue?"#FFF9F9":"" }}>
      <td style={{ padding:"10px 12px", fontWeight:700, color:"#4FC3F7", whiteSpace:"nowrap" }}>{inv.invoice_no}</td>
      <td style={{ padding:"10px 12px", color:"#0F172A", whiteSpace:"nowrap" }}>{inv.lead_name}</td>
      <td style={{ padding:"10px 12px", color:"#475569", fontSize:12 }}>{inv.destination}</td>
      <td style={{ padding:"10px 12px", fontWeight:700, color:"#0F172A", whiteSpace:"nowrap" }}>{cur(inv.total)}</td>
      <td style={{ padding:"10px 12px", color:"#16a34a", fontWeight:paid>0?600:400, whiteSpace:"nowrap" }}>{paid>0 ? cur(paid) : <span style={{ color:"#CBD5E1" }}>—</span>}</td>
      <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
       {bal > 0
        ? <span style={{ fontWeight:700, color: isOverdue?"#dc2626":"#d97706" }}>{cur(bal)}</span>
        : <span style={{ color:"#16a34a", fontWeight:600 }}>✓ Nil</span>}
      </td>
      <td style={{ padding:"10px 12px", fontSize:11, color: isOverdue?"#dc2626":"#64748b", fontWeight:isOverdue?600:400, whiteSpace:"nowrap" }}>
       {inv.due_date||"—"}{isOverdue?" ⚠":""}
      </td>
      <td style={{ padding:"10px 12px" }}>
       <span style={{ background:statusBg[pStat]||"#F8FAFC", color:statusColor[pStat]||"#64748b", borderRadius:20, padding:"3px 10px", fontSize:11, fontWeight:600, whiteSpace:"nowrap", border:`1px solid ${statusColor[pStat]||"#64748b"}33` }}>{pStat}</span>
      </td>
      <td style={{ padding:"10px 12px" }}>
       <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"nowrap" }}>
        {eyeBtn(inv)}
        {bal > 0 && pStat !== "Cancelled" && (
         <Btn v="secondary" s={{ fontSize:11, padding:"3px 9px", background:"#F0FDF4", border:"1px solid #BBF7D0", color:"#16a34a", whiteSpace:"nowrap" }} onClick={()=>onRecordPayment(inv)}>+ Pay</Btn>
        )}
        <Btn v="ghost" s={{ fontSize:11, color:"#4FC3F7", padding:"3px 0" }} onClick={()=>onEdit(inv)}>Edit</Btn>
        <Btn v="ghost" s={{ fontSize:11, color:"#EF9A9A", padding:"3px 0" }} onClick={()=>{ if(window.confirm("Delete this invoice?")) setInvoices(p=>p.filter(x=>x.id!==inv.id)); }}>Del</Btn>
       </div>
      </td>
     </tr>
    );
    })}
    </tbody>
   </table>
  </div>
  )}
 </div>
 );
}
// ─── PAGE: VOUCHERS ───────────────────────────────────────────────────────────
function PageVouchers({ vouchers, setVouchers, leads, onGenerate, onEdit, onPreview, bizSettings }) {
 const vchStatuses = ["Active","Used","Cancelled"];
 return (
 <div>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
 <span style={{ fontSize:13, color:"#475569" }}>{vouchers.length} voucher{vouchers.length!==1?"s":""}</span>
 <Sel style={{ width:240, padding:"7px 11px", fontSize:12 }} onChange={e=>{ const l=leads.find(x=>x.id===e.target.value); if(l) onGenerate(l); e.target.value=""; }}>
 <option value=""> Create Voucher for Lead…</option>
 {leads.map(l=><option key={l.id} value={l.id}>{l.name} – {l.destination}</option>)}
 </Sel>
 </div>
 {vouchers.length===0 ? (
 <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:60, textAlign:"center", color:"#94A3B8" }}>No vouchers yet. Select a lead above.</div>
 ) : (
 <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:14 }}>
 {vouchers.map((v,i)=>(
 <div key={v.id||i} className="card" style={{ background:"linear-gradient(135deg,#F2F6FB,#EEF3F9)", border:"1px solid #D5E1EE", borderRadius:12, padding:18, transition:"border-color .2s" }}>
  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:11 }}>
   <div style={{ fontFamily:"'Playfair Display',serif", fontSize:15, color:"#0F172A" }}>
    {v.voucher_type==="Flight"?"✈️":v.voucher_type==="Transfer"?"🚗":v.voucher_type==="Activity"?"🎯":v.voucher_type==="Package"?"📦":"🏨"} {v.voucher_type||"Hotel"} Voucher
   </div>
   <div style={{ display:"flex", alignItems:"center", gap:8 }}>
    <span style={{ fontWeight:700, color:"#4FC3F7", fontSize:12 }}>{v.voucher_no}</span>
    <Badge status={v.status||"Active"}/>
   </div>
  </div>
  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7, fontSize:12, marginBottom:10 }}>
   {(v.voucher_type==="Flight"
     ? [["Guest",v.client_name],["Airline",v.airline],["Flight",v.flight_no],["PNR",v.pnr],["Route",v.from&&v.to?`${v.from}→${v.to}`:""],["Date",v.travel_date]]
     : v.voucher_type==="Transfer"
     ? [["Guest",v.client_name],["Vehicle",v.vehicle_type],["From",v.pickup_from||v.from],["To",v.drop_to||v.to],["Date",v.travel_date],["Driver",v.driver_name]]
     : v.voucher_type==="Activity"
     ? [["Guest",v.client_name],["Activity",v.activity_name],["Destination",v.destination],["Date",v.travel_date],["Time",v.activity_time],["Operator",v.operator]]
     : v.voucher_type==="Package"
     ? [["Guest",v.client_name],["Destination",v.destination],["Travel Date",v.travel_date],["Return Date",v.return_date],["Duration",v.duration],["Hotel",v.hotel]]
     : [["Guest",v.client_name],["Destination",v.destination],["Check-In",v.travel_date],["Check-Out",v.return_date],["Hotel",v.hotel],["Room",v.room_type]]
   ).map(([k,val])=>(
    <div key={k}><span style={{ color:"#475569" }}>{k}: </span><span style={{ color:"#0F172A" }}>{val||"—"}</span></div>
   ))}
  </div>
  {(v.inclusions||[]).length > 0 && (
   <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:10 }}>
    {(v.inclusions||[]).map((inc,j)=><span key={j} style={{ background:"#E6ECF5", border:"1px solid #D5E1EE", borderRadius:6, padding:"2px 7px", fontSize:10, color:"#4FC3F7" }}>{inc}</span>)}
   </div>
  )}
  <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:10, paddingTop:10, borderTop:"1px solid #D5E1EE" }}>
   <Sel value={v.status||"Active"} onChange={e=>setVouchers(p=>p.map(x=>x.id===v.id?{...x,status:e.target.value}:x))} style={{ padding:"3px 7px", fontSize:11, flex:1 }}>
    {vchStatuses.map(s=><option key={s}>{s}</option>)}
   </Sel>
   <button title="Preview" onClick={()=>onPreview(v)} style={{ background:"none", border:"none", cursor:"pointer", padding:"3px 4px", color:"#94a3b8", display:"flex", alignItems:"center" }}><svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></button>
   <Btn v="ghost" s={{ fontSize:11, color:"#4FC3F7", padding:"3px 6px" }} onClick={()=>onEdit(v)}>Edit</Btn>
   <Btn v="ghost" s={{ fontSize:11, color:"#EF9A9A", padding:"3px 6px" }} onClick={()=>{ if(window.confirm("Delete this voucher?")) setVouchers(p=>p.filter(x=>x.id!==v.id)); }}>Delete</Btn>
  </div>
 </div>
 ))}
 </div>
 )}
 </div>
 );
}
// ─── PAGE: REPORTS & FINANCE ─────────────────────────────────────────────────
function PageReports({ leads, invoices, quotes, bizSettings }) {
 const [tab, setTab] = useState("overview");
 const cur = n => `${bizSettings.currency_symbol||"₹"}${Number(n||0).toLocaleString("en-IN")}`;
 const today = new Date(); const todayStr = today.toISOString().slice(0,10);
 const currentMonth = todayStr.slice(0,7);
 const tabs = [["overview","Overview"],["conversion","Lead Conversion"],["revenue","Revenue"],["agents","Agent Performance"],["destinations","Destinations"],["finance","Finance & Aging"]];

 // — Overview KPIs —
 const totalLeads = leads.length;
 const wonLeads = leads.filter(l=>l.status==="Won").length;
 const convRate = totalLeads>0 ? ((wonLeads/totalLeads)*100).toFixed(1) : "0.0";
 const totalRevenue = invoices.reduce((s,i)=>s+Number(i.paid_amount||0),0);
 const totalOutstanding = invoices.reduce((s,i)=>s+Math.max(0,Number(i.total||0)-Number(i.paid_amount||0)),0);
 const monthRevenue = invoices.filter(i=>(i.date||"").startsWith(currentMonth)).reduce((s,i)=>s+Number(i.paid_amount||0),0);

 // — Lead Conversion Funnel —
 const statusCounts = {New:0,"Quote Requested":0,"Quote Sent":0,Confirmed:0,Won:0,Lost:0};
 leads.forEach(l=>{ if(statusCounts[l.status]!==undefined) statusCounts[l.status]++; else statusCounts["New"]++; });
 const funnelStages = [["New","#4FC3F7"],["Quote Requested","#64B5F6"],["Quote Sent","#FFB74D"],["Confirmed","#81C784"],["Won","#16a34a"]];
 const maxFunnel = Math.max(...funnelStages.map(([s])=>statusCounts[s]||0),1);

 // — Revenue by Month —
 const revByMonth = {};
 invoices.forEach(i=>{
  const m=(i.date||"").slice(0,7); if(!m) return;
  if(!revByMonth[m]) revByMonth[m]={collected:0,total:0};
  revByMonth[m].collected += Number(i.paid_amount||0);
  revByMonth[m].total += Number(i.total||0);
 });
 const revenueMonths = Object.keys(revByMonth).sort().slice(-6);
 const maxRev = Math.max(...revenueMonths.map(m=>revByMonth[m].total),1);

 // — Agent Performance —
 const agentStats = {};
 leads.forEach(l=>{
  const ag = l.assigned_to||"Unassigned";
  if(!agentStats[ag]) agentStats[ag]={leads:0,won:0,value:0};
  agentStats[ag].leads++;
  if(l.status==="Won"){ agentStats[ag].won++; agentStats[ag].value += Number(l.budget||0); }
 });
 const agents = Object.entries(agentStats).sort((a,b)=>b[1].leads-a[1].leads);

 // — Destination Popularity —
 const destCounts = {};
 leads.forEach(l=>{ const d=l.destination||"Unknown"; destCounts[d]=(destCounts[d]||0)+1; });
 const topDests = Object.entries(destCounts).sort((a,b)=>b[1]-a[1]).slice(0,10);
 const maxDest = Math.max(...topDests.map(([,c])=>c),1);

 // — Finance & Aging —
 const now = Date.now();
 const aging = {a0_30:0,a31_60:0,a61plus:0};
 const agingInvs = {a0_30:[],a31_60:[],a61plus:[]};
 invoices.forEach(i=>{
  const bal = Math.max(0,Number(i.total||0)-Number(i.paid_amount||0));
  if(bal<=0||i.status==="Cancelled") return;
  const due = i.due_date ? new Date(i.due_date).getTime() : null;
  if(!due||due>now) return; // not overdue
  const days = Math.floor((now-due)/(1000*60*60*24));
  if(days<=30){ aging.a0_30+=bal; agingInvs.a0_30.push({...i,bal,days}); }
  else if(days<=60){ aging.a31_60+=bal; agingInvs.a31_60.push({...i,bal,days}); }
  else { aging.a61plus+=bal; agingInvs.a61plus.push({...i,bal,days}); }
 });

 const KCard = ({label,value,sub,color="#1A6B8A"}) => (
  <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:"18px 20px",flex:1,minWidth:160}}>
   <div style={{fontSize:12,color:"#64748b",marginBottom:6}}>{label}</div>
   <div style={{fontSize:22,fontWeight:800,color}}>{value}</div>
   {sub && <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>{sub}</div>}
  </div>
 );
 const Bar = ({pct,color,height=20}) => (
  <div style={{background:"#f1f5f9",borderRadius:4,overflow:"hidden",height,flex:1}}>
   <div style={{height:"100%",width:`${Math.max(pct,2)}%`,background:color,borderRadius:4,transition:"width .3s"}}/>
  </div>
 );

 return (
 <div style={{padding:"0 0 40px"}}>
  {/* Tab bar */}
  <div style={{display:"flex",gap:4,borderBottom:"1px solid #e2e8f0",marginBottom:24,overflowX:"auto"}}>
   {tabs.map(([id,label])=>(
    <button key={id} onClick={()=>setTab(id)} style={{padding:"9px 16px",border:"none",background:"none",borderBottom:tab===id?"2px solid #1A6B8A":"2px solid transparent",color:tab===id?"#1A6B8A":"#64748b",fontWeight:tab===id?700:400,fontSize:13,cursor:"pointer",whiteSpace:"nowrap",marginBottom:-1}}>
     {label}
    </button>
   ))}
  </div>

  {/* Overview */}
  {tab==="overview" && (
  <div>
   <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:24}}>
    <KCard label="Total Leads" value={totalLeads} sub={`${wonLeads} won`}/>
    <KCard label="Conversion Rate" value={`${convRate}%`} color="#16a34a"/>
    <KCard label="Revenue This Month" value={cur(monthRevenue)} color="#059669"/>
    <KCard label="Total Collected" value={cur(totalRevenue)}/>
    <KCard label="Total Outstanding" value={cur(totalOutstanding)} color="#dc2626" sub="unpaid invoices"/>
   </div>
   {/* Lead status breakdown */}
   <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:20,marginBottom:20}}>
    <div style={{fontWeight:700,fontSize:14,color:"#0f172a",marginBottom:16}}>Lead Status Breakdown</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
     {Object.entries(statusCounts).map(([s,c])=>(
      <div key={s} style={{background:"#f8fafc",borderRadius:8,padding:"10px 14px"}}>
       <div style={{fontSize:20,fontWeight:800,color:"#1A6B8A"}}>{c}</div>
       <div style={{fontSize:12,color:"#64748b"}}>{s}</div>
      </div>
     ))}
    </div>
   </div>
   {/* Invoice status summary */}
   <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:20}}>
    <div style={{fontWeight:700,fontSize:14,color:"#0f172a",marginBottom:14}}>Invoice Summary</div>
    <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
     {[["Total Invoices",invoices.length,"#475569"],["Paid",invoices.filter(i=>i.status==="Paid").length,"#16a34a"],["Partially Paid",invoices.filter(i=>i.status==="Partially Paid").length,"#d97706"],["Draft/Unpaid",invoices.filter(i=>!i.status||i.status==="Draft"||i.status==="Sent").length,"#94a3b8"],["Cancelled",invoices.filter(i=>i.status==="Cancelled").length,"#dc2626"]].map(([l,v,c])=>(
      <div key={l} style={{flex:1,minWidth:100,background:"#f8fafc",borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
       <div style={{fontSize:22,fontWeight:800,color:c}}>{v}</div>
       <div style={{fontSize:11,color:"#64748b"}}>{l}</div>
      </div>
     ))}
    </div>
   </div>
  </div>
  )}

  {/* Lead Conversion */}
  {tab==="conversion" && (
  <div>
   <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:24,marginBottom:20}}>
    <div style={{fontWeight:700,fontSize:15,color:"#0f172a",marginBottom:20}}>Lead Conversion Funnel</div>
    {funnelStages.map(([stage,color])=>{
     const cnt = statusCounts[stage]||0;
     const pct = totalLeads>0?((cnt/totalLeads)*100).toFixed(1):0;
     return (
      <div key={stage} style={{marginBottom:14}}>
       <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
        <span style={{fontSize:13,fontWeight:600,color:"#334155"}}>{stage}</span>
        <span style={{fontSize:13,color:"#64748b"}}>{cnt} leads ({pct}%)</span>
       </div>
       <div style={{background:"#f1f5f9",borderRadius:6,overflow:"hidden",height:28}}>
        <div style={{height:"100%",width:`${Math.max(totalLeads>0?(cnt/totalLeads)*100:0,1.5)}%`,background:color,borderRadius:6,display:"flex",alignItems:"center",paddingLeft:8,fontSize:11,color:"#fff",fontWeight:700,transition:"width .4s"}}>{cnt>0?cnt:""}</div>
       </div>
      </div>
     );
    })}
    <div style={{marginTop:16,padding:12,background:"#f0fdf4",borderRadius:8}}>
     <span style={{fontSize:13,color:"#16a34a",fontWeight:700}}>Overall Conversion Rate: {convRate}%</span>
     <span style={{fontSize:12,color:"#64748b",marginLeft:12}}>{wonLeads} won of {totalLeads} total leads</span>
    </div>
   </div>
   {/* Lost analysis */}
   <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:24}}>
    <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Loss Analysis</div>
    <div style={{fontSize:13,color:"#64748b"}}>
     Lost leads: <strong style={{color:"#dc2626"}}>{statusCounts.Lost||0}</strong> &nbsp;|&nbsp;
     Active pipeline: <strong style={{color:"#1A6B8A"}}>{leads.filter(l=>l.status!=="Won"&&l.status!=="Lost"&&l.status!=="Cancelled").length}</strong> &nbsp;|&nbsp;
     Source breakdown below:
    </div>
    <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:12}}>
     {Object.entries(leads.filter(l=>l.status==="Won").reduce((acc,l)=>{acc[l.source||"Unknown"]=(acc[l.source||"Unknown"]||0)+1;return acc},{})).sort((a,b)=>b[1]-a[1]).map(([src,cnt])=>(
      <div key={src} style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:20,padding:"4px 12px",fontSize:12,color:"#16a34a",fontWeight:600}}>{src}: {cnt}</div>
     ))}
    </div>
   </div>
  </div>
  )}

  {/* Revenue */}
  {tab==="revenue" && (
  <div>
   <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:24,marginBottom:20}}>
    <div style={{fontWeight:700,fontSize:15,color:"#0f172a",marginBottom:20}}>Monthly Revenue (Last 6 Months)</div>
    {revenueMonths.length===0 ? <div style={{color:"#94a3b8",fontSize:13}}>No invoice data yet.</div> :
     revenueMonths.map(m=>{
      const d = revByMonth[m];
      const collPct = d.total>0?(d.collected/d.total)*100:0;
      return (
       <div key={m} style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:13}}>
         <span style={{fontWeight:600}}>{m}</span>
         <span style={{color:"#64748b"}}>{cur(d.collected)} collected / {cur(d.total)} total</span>
        </div>
        <div style={{display:"flex",gap:4,height:24}}>
         <div style={{background:"#f1f5f9",borderRadius:4,overflow:"hidden",flex:1,display:"flex",alignItems:"stretch"}}>
          <div style={{width:`${(d.total/maxRev)*100}%`,background:"#bfdbfe",borderRadius:4}}/>
         </div>
        </div>
        <div style={{background:"#f1f5f9",borderRadius:4,overflow:"hidden",height:10,marginTop:3}}>
         <div style={{height:"100%",width:`${collPct}%`,background:"#16a34a",borderRadius:4,transition:"width .4s"}}/>
        </div>
        <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>{collPct.toFixed(0)}% collected</div>
       </div>
      );
     })
    }
   </div>
   {/* Revenue table */}
   <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden"}}>
    <table style={{width:"100%",borderCollapse:"collapse"}}>
     <thead><tr style={{background:"#f8fafc"}}>
      {["Month","Invoices","Total Billed","Collected","Outstanding","Collection %"].map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.5}}>{h}</th>)}
     </tr></thead>
     <tbody>
      {revenueMonths.map(m=>{
       const d=revByMonth[m];
       const count=invoices.filter(i=>(i.date||"").startsWith(m)).length;
       const pct=d.total>0?((d.collected/d.total)*100).toFixed(0):0;
       return <tr key={m} style={{borderTop:"1px solid #f0f4f8"}}>
        <td style={{padding:"9px 14px",fontSize:13,fontWeight:600}}>{m}</td>
        <td style={{padding:"9px 14px",fontSize:13}}>{count}</td>
        <td style={{padding:"9px 14px",fontSize:13}}>{cur(d.total)}</td>
        <td style={{padding:"9px 14px",fontSize:13,color:"#16a34a",fontWeight:600}}>{cur(d.collected)}</td>
        <td style={{padding:"9px 14px",fontSize:13,color:"#dc2626"}}>{cur(d.total-d.collected)}</td>
        <td style={{padding:"9px 14px",fontSize:13}}><span style={{background:pct>=80?"#dcfce7":"#fff7ed",color:pct>=80?"#16a34a":"#d97706",borderRadius:10,padding:"2px 8px",fontWeight:600}}>{pct}%</span></td>
       </tr>;
      })}
     </tbody>
    </table>
   </div>
  </div>
  )}

  {/* Agent Performance */}
  {tab==="agents" && (
  <div>
   <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden"}}>
    <div style={{padding:"16px 20px",borderBottom:"1px solid #f0f4f8",fontWeight:700,fontSize:14}}>Agent Performance</div>
    <table style={{width:"100%",borderCollapse:"collapse"}}>
     <thead><tr style={{background:"#f8fafc"}}>
      {["Agent","Total Leads","Won","Conversion","Win Value"].map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.5}}>{h}</th>)}
     </tr></thead>
     <tbody>
      {agents.length===0 ? <tr><td colSpan={5} style={{padding:24,textAlign:"center",color:"#94a3b8",fontSize:13}}>No leads with assigned agents yet.</td></tr> :
       agents.map(([ag,s],i)=>{
        const conv=s.leads>0?((s.won/s.leads)*100).toFixed(0):0;
        return <tr key={ag} style={{borderTop:"1px solid #f0f4f8",background:i%2===0?"#fff":"#fafafa"}}>
         <td style={{padding:"10px 14px",fontSize:13,fontWeight:600}}>{ag}</td>
         <td style={{padding:"10px 14px",fontSize:13}}>{s.leads}</td>
         <td style={{padding:"10px 14px",fontSize:13,color:"#16a34a",fontWeight:600}}>{s.won}</td>
         <td style={{padding:"10px 14px",fontSize:13}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
           <div style={{flex:1,background:"#f1f5f9",borderRadius:4,height:8,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${conv}%`,background:"#1A6B8A",borderRadius:4}}/>
           </div>
           <span style={{fontSize:12,color:"#64748b",minWidth:32}}>{conv}%</span>
          </div>
         </td>
         <td style={{padding:"10px 14px",fontSize:13,color:"#1A6B8A",fontWeight:600}}>{s.value>0?cur(s.value):"—"}</td>
        </tr>;
       })
      }
     </tbody>
    </table>
   </div>
  </div>
  )}

  {/* Destinations */}
  {tab==="destinations" && (
  <div>
   <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:24}}>
    <div style={{fontWeight:700,fontSize:15,color:"#0f172a",marginBottom:20}}>Top Destinations by Leads</div>
    {topDests.length===0 ? <div style={{color:"#94a3b8",fontSize:13}}>No destination data yet.</div> :
     topDests.map(([dest,cnt],i)=>(
      <div key={dest} style={{marginBottom:14}}>
       <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
        <span style={{fontSize:13,fontWeight:600,color:"#334155"}}>#{i+1} {dest}</span>
        <span style={{fontSize:13,color:"#64748b"}}>{cnt} lead{cnt!==1?"s":""}</span>
       </div>
       <div style={{background:"#f1f5f9",borderRadius:6,overflow:"hidden",height:22}}>
        <div style={{height:"100%",width:`${(cnt/maxDest)*100}%`,background:`hsl(${200-(i*15)},60%,50%)`,borderRadius:6,transition:"width .4s"}}/>
       </div>
      </div>
     ))
    }
   </div>
  </div>
  )}

  {/* Finance & Aging */}
  {tab==="finance" && (
  <div>
   {/* Aging summary cards */}
   <div style={{display:"flex",gap:14,marginBottom:24}}>
    <div style={{flex:1,background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:12,padding:"18px 20px"}}>
     <div style={{fontSize:12,color:"#9a3412",marginBottom:4}}>0–30 Days Overdue</div>
     <div style={{fontSize:22,fontWeight:800,color:"#d97706"}}>{cur(aging.a0_30)}</div>
     <div style={{fontSize:11,color:"#9a3412",marginTop:4}}>{agingInvs.a0_30.length} invoice{agingInvs.a0_30.length!==1?"s":""}</div>
    </div>
    <div style={{flex:1,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:12,padding:"18px 20px"}}>
     <div style={{fontSize:12,color:"#991b1b",marginBottom:4}}>31–60 Days Overdue</div>
     <div style={{fontSize:22,fontWeight:800,color:"#ef4444"}}>{cur(aging.a31_60)}</div>
     <div style={{fontSize:11,color:"#991b1b",marginTop:4}}>{agingInvs.a31_60.length} invoice{agingInvs.a31_60.length!==1?"s":""}</div>
    </div>
    <div style={{flex:1,background:"#fff1f2",border:"1px solid #fda4af",borderRadius:12,padding:"18px 20px"}}>
     <div style={{fontSize:12,color:"#9f1239",marginBottom:4}}>60+ Days Overdue</div>
     <div style={{fontSize:22,fontWeight:800,color:"#be123c"}}>{cur(aging.a61plus)}</div>
     <div style={{fontSize:11,color:"#9f1239",marginTop:4}}>{agingInvs.a61plus.length} invoice{agingInvs.a61plus.length!==1?"s":""}</div>
    </div>
    <div style={{flex:1,background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:"18px 20px"}}>
     <div style={{fontSize:12,color:"#64748b",marginBottom:4}}>Total Overdue</div>
     <div style={{fontSize:22,fontWeight:800,color:"#dc2626"}}>{cur(aging.a0_30+aging.a31_60+aging.a61plus)}</div>
     <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>all overdue</div>
    </div>
   </div>
   {/* Aging table */}
   {["0–30 Days","31–60 Days","60+ Days"].map((label,idx)=>{
    const invList = [agingInvs.a0_30,agingInvs.a31_60,agingInvs.a61plus][idx];
    if(invList.length===0) return null;
    const headerColor = ["#d97706","#ef4444","#be123c"][idx];
    return (
     <div key={label} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden",marginBottom:16}}>
      <div style={{padding:"12px 18px",borderBottom:"1px solid #f0f4f8",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
       <span style={{fontWeight:700,fontSize:13,color:headerColor}}>{label} Overdue</span>
       <span style={{fontSize:12,color:"#64748b"}}>{invList.length} invoices</span>
      </div>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
       <thead><tr style={{background:"#f8fafc"}}>
        {["Invoice #","Client","Due Date","Days Overdue","Balance Due"].map(h=><th key={h} style={{padding:"8px 14px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.5}}>{h}</th>)}
       </tr></thead>
       <tbody>
        {invList.map(inv=>(
         <tr key={inv.id} style={{borderTop:"1px solid #f0f4f8"}}>
          <td style={{padding:"9px 14px",fontSize:13,fontWeight:600,color:"#1A6B8A"}}>{inv.invoice_no}</td>
          <td style={{padding:"9px 14px",fontSize:13}}>{inv.client_name||inv.lead_name||"—"}</td>
          <td style={{padding:"9px 14px",fontSize:13}}>{inv.due_date||"—"}</td>
          <td style={{padding:"9px 14px",fontSize:13,color:headerColor,fontWeight:600}}>{inv.days} days</td>
          <td style={{padding:"9px 14px",fontSize:13,color:"#dc2626",fontWeight:700}}>{cur(inv.bal)}</td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>
    );
   })}
   {aging.a0_30+aging.a31_60+aging.a61plus===0 && (
    <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:32,textAlign:"center",color:"#16a34a",fontSize:14,fontWeight:600}}>
     ✓ No overdue invoices! All payments are up to date.
    </div>
   )}
  </div>
  )}
 </div>
 );
}
// ─── PAGE: AI CHAT ────────────────────────────────────────────────────────────
function PageChat({ leads, setLeads, quotes, setQuotes, invoices, addNotif, toast$, setPage, onInvoice }) {
 const [log, setLog] = useState([
 { role:"ai", text:" Hello! I'm your Safarnaama AI assistant. I can:\n\n• Create leads from natural text\n• Confirm a lead and generate an invoice\n• Answer questions about your leads & quotes\n• Navigate anywhere in the CRM\n\nTry: *\"Generate invoice for Pulkit Bhardwaj\"* or *\"Confirm lead Neha Gupta and create invoice\"*" }
 ]);
 const [input, setInput] = useState("");
 const [thinking, setThinking] = useState(false);
 const endRef = useRef();
 useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [log]);

 const findLead = name => {
  if (!name) return null;
  const nl = name.toLowerCase();
  return leads.find(l => l.name.toLowerCase().includes(nl)) || null;
 };

 // Extract the most likely lead name from a message.
 // Looks for "for [lead] <Name>" or "for <Name>" patterns.
 const extractName = msg => {
  const m = msg.match(/\bfor\s+(?:lead\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i) ||
            msg.match(/\b(?:lead|client|customer)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
  return m ? m[1].trim() : "";
 };

 const send = async () => {
 const msg = input.trim();
 if (!msg || thinking) return;
 setInput("");
 setLog(p=>[...p,{ role:"user", text:msg }]);
 setThinking(true);
 try {
  const ml = msg.toLowerCase();

  // ── Local intent matching — no API call for simple known commands ──────────

  // NAVIGATE
  const navMatch = ml.match(/\b(?:go to|show|open|navigate to)\s+(leads?|quotes?|vendors?|invoices?|vouchers?|settings?|reports?|tasks?|chat)\b/i);
  if (navMatch) {
   const page = navMatch[1].replace(/s$/, "").toLowerCase();
   const pageMap = { lead:"leads", quote:"quotes", vendor:"vendors", invoice:"invoices", voucher:"vouchers", setting:"settings", report:"reports", task:"tasks" };
   const dest = pageMap[page] || page;
   setPage(dest); setLog(p=>[...p,{ role:"ai", text:`Opening ${dest} page…` }]); return;
  }

  // GENERATE INVOICE
  if (/\b(generate|create|make|build)\b.*\binvoice\b/i.test(ml) || /\binvoice\b.*\b(generate|create|make|for)\b/i.test(ml)) {
   const name = extractName(msg);
   const lead = findLead(name);
   if (!lead) {
    const list = leads.slice(0,8).map(l=>`• ${l.name} (${l.destination})`).join("\n");
    setLog(p=>[...p,{ role:"ai", text:`Which lead do you want an invoice for? Your leads:\n${list||"No leads yet."}` }]);
   } else {
    setLog(p=>[...p,{ role:"ai", text:` Opening invoice for **${lead.name}** — ${lead.destination}…` }]);
    onInvoice && onInvoice(lead);
   }
   return;
  }

  // CONFIRM QUOTE + INVOICE
  if (/\bconfirm\b/i.test(ml) && /\binvoice\b/i.test(ml)) {
   const name = extractName(msg);
   const lead = findLead(name);
   if (!lead) {
    setLog(p=>[...p,{ role:"ai", text:`Which lead should I confirm and invoice? Try: "Confirm and invoice Amit Verma"` }]);
   } else {
    setQuotes(p => p.map(q => q.lead_id === lead.id ? { ...q, status:"Confirmed" } : q));
    addNotif(`Quote for ${lead.name} confirmed`);
    setLog(p=>[...p,{ role:"ai", text:` Quote for **${lead.name}** marked as **Confirmed**. Generating invoice…` }]);
    onInvoice && onInvoice(lead);
   }
   return;
  }

  // CONFIRM QUOTE ONLY
  if (/\bconfirm\b/i.test(ml) && /\b(lead|quote|booking)\b/i.test(ml)) {
   const name = extractName(msg);
   const lead = findLead(name);
   if (!lead) {
    setLog(p=>[...p,{ role:"ai", text:`Which lead's quote should I confirm? Try: "Confirm quote for Amit Verma"` }]);
   } else {
    setQuotes(p => p.map(q => q.lead_id === lead.id ? { ...q, status:"Confirmed" } : q));
    addNotif(`Quote for ${lead.name} confirmed`);
    setLog(p=>[...p,{ role:"ai", text:` Quote for **${lead.name}** (${lead.destination}) marked as **Confirmed** in the Quotes module.` }]);
   }
   return;
  }

  // ── Claude for complex tasks (lead creation, general questions) ────────────
  const leadList = leads.slice(0,10).map(l=>`${l.name} (${l.destination}, ${l.status})`).join(", ")||"none";
  const system = `You are a smart CRM assistant for Safarnaama Holidays.
Leads: ${leadList}. Total leads: ${leads.length}. Invoices: ${invoices.length}.
Return ONE of these JSON actions — no markdown, no extra text:
1. Create lead: {"action":"create_lead","lead":{"name":"","email":"","phone":"","destination":"","pax":0,"kids":0,"budget":"","travel_date":"YYYY-MM-DD","notes":"","assigned_to":""}}
2. General answer: {"action":"reply","text":"your response here"}`;
  const raw = await askClaude(msg, system);
  let parsed;
  try { parsed = JSON.parse(raw.replace(/```json|```/g,"").trim()); }
  catch { parsed = { action:"reply", text: raw }; }

  if (parsed.action === "create_lead" && parsed.lead?.name) {
   const lead = { ...parsed.lead, id:genId("L"), status:"New", created_at:today() };
   if (!lead.pax || lead.pax < 1) lead.pax = 1;
   if (!lead.kids) lead.kids = 0;
   setLeads(p=>[lead,...p]);
   addNotif(`Lead created: ${lead.name} → ${lead.destination}`);
   setLog(p=>[...p,{ role:"ai", text:` Lead created!\n\n**Name:** ${lead.name}\n**Destination:** ${lead.destination}\n**Travel Date:** ${lead.travel_date||"Not specified"}\n**Adults:** ${lead.pax} | **Kids:** ${lead.kids}\n\nGo to Leads to generate a quote, invoice, or voucher.`, leadCreated:lead }]);
  } else {
   setLog(p=>[...p,{ role:"ai", text: parsed.text || raw }]);
  }

 } catch(e) {
 setLog(p=>[...p,{ role:"ai", text:`Sorry, something went wrong. Please try again.\nError: ${e.message}` }]);
 } finally {
 setThinking(false);
 }
 };
 const suggestions = [
 "Generate invoice for Pulkit Bhardwaj",
 "Confirm lead Neha Gupta and generate invoice",
 "Create a lead for Rahul Sharma travelling Bali 5N6D from 20 July, 2 adults",
 "How many leads do I have?",
 "Show me the invoices page",
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
function PageTasks({ tasks, setTasks, users, leads, currentUser, isAdmin, onCreateTask, bizSettings }) {
 const taskStatuses = bizSettings?.task_statuses || ["Open","In Progress","Done"];
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
 <Sel value={t.status || taskStatuses[0] || "Open"} onChange={e=>updateTaskStatus(t.id, e.target.value)} style={{ padding:"3px 7px", fontSize:11, width:"auto" }}>
 {taskStatuses.map(s=><option key={s}>{s}</option>)}
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
   <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
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
function CompanyProfileSection({ companyProfile, setCompanyProfile, toast$ }) {
 const cp = { ...DEFAULT_COMPANY_PROFILE, ...companyProfile };
 const [name, setName]               = useState(cp.name || "");
 const [tagline, setTagline]         = useState(cp.tagline || "");
 const [phone1, setPhone1]           = useState(cp.phone1 || "");
 const [phone2, setPhone2]           = useState(cp.phone2 || "");
 const [email, setEmail]             = useState(cp.email || "");
 const [address, setAddress]         = useState(cp.address || "");
 const [logo, setLogo]               = useState(cp.logo || "");
 const [primaryColor, setPrimaryColor] = useState(cp.primaryColor || "#1A6B8A");
 const save = () => {
  if (setCompanyProfile) setCompanyProfile(prev => ({ ...prev, name, tagline, phone1, phone2, email, address, logo, primaryColor }));
  toast$("Company profile saved! ✓");
 };
 const lbl = { display:"block",color:"#64748B",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:5 };
 return (
  <SettingsSection title="Company Profile">
   <div style={{ display:"flex", gap:20, marginBottom:14, alignItems:"flex-start", flexWrap:"wrap" }}>
    {/* Logo */}
    <div style={{ flexShrink:0, textAlign:"center" }}>
     <div style={{ width:130, height:80, border:"1.5px dashed #CBD5E1", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:8, overflow:"hidden", background:"#F8FAFC" }}>
      {logo ? <img src={logo} alt="logo" style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", padding:4 }}/> : <span style={{ fontSize:11, color:"#94A3B8", textAlign:"center", lineHeight:1.4 }}>No logo<br/>uploaded</span>}
     </div>
     <label style={{ cursor:"pointer", display:"inline-block" }}>
      <input type="file" accept="image/*" style={{ display:"none" }} onChange={async e => {
       const f = e.target.files[0]; if (!f) return;
       const dataUrl = await compressImage(f, 500, 0.92);
       if (dataUrl) setLogo(dataUrl);
       e.target.value = "";
      }}/>
      <span style={{ fontSize:11, padding:"5px 12px", background:"#F1F5F9", border:"1px solid #E2E8F0", borderRadius:6, color:"#475569", fontWeight:600 }}>📁 Upload</span>
     </label>
     {logo && <button onClick={() => setLogo("")} style={{ display:"block", margin:"5px auto 0", fontSize:11, color:"#EF4444", background:"none", border:"none", cursor:"pointer" }}>Remove</button>}
    </div>
    {/* Name / Tagline / Color */}
    <div style={{ flex:1, minWidth:220 }}>
     <div style={{ marginBottom:14 }}><label style={lbl}>Company Name</label><Inp value={name} onChange={e=>setName(e.target.value)} placeholder="Safarnaama Holidays"/></div>
     <div style={{ display:"flex", gap:12, alignItems:"flex-end" }}>
      <div style={{ flex:1, marginBottom:14 }}><label style={lbl}>Tagline</label><Inp value={tagline} onChange={e=>setTagline(e.target.value)} placeholder="Explore | Capture | Inspire"/></div>
      <div style={{ width:80, marginBottom:14 }}>
       <label style={lbl}>Color</label>
       <input type="color" value={primaryColor} onChange={e=>setPrimaryColor(e.target.value)} style={{ width:"100%", height:38, padding:3, border:"1.5px solid #D5E1EE", borderRadius:8, cursor:"pointer", display:"block" }}/>
      </div>
     </div>
    </div>
   </div>
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:12 }}>
    <div><label style={lbl}>Phone 1</label><Inp value={phone1} onChange={e=>setPhone1(e.target.value)} placeholder="+91 98976 10033"/></div>
    <div><label style={lbl}>Phone 2</label><Inp value={phone2} onChange={e=>setPhone2(e.target.value)} placeholder="+91 85100 81781"/></div>
    <div><label style={lbl}>Email</label><Inp value={email} onChange={e=>setEmail(e.target.value)} placeholder="enquiry@safarnaama.com"/></div>
   </div>
   <div style={{ marginBottom:14 }}>
    <label style={lbl}>Address</label>
    <textarea value={address} onChange={e=>setAddress(e.target.value)} placeholder="S2S Complex, Second Floor, Garh Road, Meerut - 250002" rows={2} style={{ width:"100%", padding:"8px 10px", border:"1.5px solid #D5E1EE", borderRadius:8, fontSize:13, fontFamily:"inherit", resize:"vertical", outline:"none" }}/>
   </div>
   <Btn v="success" icon="check" onClick={save}>Save Company Profile</Btn>
  </SettingsSection>
 );
}
function OnlinePresenceSection({ companyProfile, setCompanyProfile, toast$ }) {
 const [website,   setWebsite]   = useState(companyProfile.website   || "");
 const [whatsapp,  setWhatsapp]  = useState(companyProfile.whatsapp  || "");
 const [instagram, setInstagram] = useState(companyProfile.instagram || "");
 const [facebook,  setFacebook]  = useState(companyProfile.facebook  || "");
 const save = () => {
  setCompanyProfile(prev => ({ ...prev, website, whatsapp, instagram, facebook }));
  toast$("Online presence saved! ✓");
 };
 const lbl = { display:"block",color:"#64748B",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:5 };
 return (
  <SettingsSection title="Online Presence">
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
    <div><label style={lbl}>Website</label><Inp value={website} onChange={e=>setWebsite(e.target.value)} placeholder="www.safarnaama.com"/></div>
    <div><label style={lbl}>WhatsApp</label><Inp value={whatsapp} onChange={e=>setWhatsapp(e.target.value)} placeholder="+91 98976 10033"/></div>
    <div><label style={lbl}>Instagram</label><Inp value={instagram} onChange={e=>setInstagram(e.target.value)} placeholder="@safarnaama"/></div>
    <div><label style={lbl}>Facebook</label><Inp value={facebook} onChange={e=>setFacebook(e.target.value)} placeholder="facebook.com/safarnaama"/></div>
   </div>
   <Btn v="success" icon="check" onClick={save}>Save Online Presence</Btn>
  </SettingsSection>
 );
}
function SettingsSection({ title, children }) {
 return (
  <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:22, marginBottom:18 }}>
   <div style={{ fontWeight:700, color:"#0F172A", marginBottom:18, fontSize:15 }}>{title}</div>
   {children}
  </div>
 );
}
function StatusAdder({ onAdd, placeholder }) {
 const [val, setVal] = useState("");
 return (
  <div style={{ display:"flex", gap:8 }}>
   <Inp value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&val.trim()){onAdd(val.trim());setVal("");} }} placeholder={placeholder||"Type and press Enter…"}/>
   <Btn v="secondary" s={{ fontSize:11, padding:"5px 10px" }} onClick={()=>{ if(val.trim()){onAdd(val.trim());setVal("");} }}>Add</Btn>
  </div>
 );
}

function TaxCurrencySection({ bizSettings, setBizSettings, toast$ }) {
 const b = { ...DEFAULT_BIZ_SETTINGS, ...bizSettings };
 const [taxName,     setTaxName]     = useState(b.tax_name     || "GST");
 const [taxRate,     setTaxRate]     = useState(b.tax_rate     ?? 5);
 const [currSymbol,  setCurrSymbol]  = useState(b.currency_symbol  || "₹");
 const [currLocale,  setCurrLocale]  = useState(b.currency_locale  || "en-IN");
 const lbl = { display:"block",color:"#64748B",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:5 };
 const inp = { width:"100%",background:"#FFFFFF",border:"1px solid #D5E1EE",borderRadius:8,padding:"9px 13px",color:"#0F172A",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit" };
 const save = () => {
  setBizSettings(prev => ({ ...prev, tax_name: taxName, tax_rate: taxRate, currency_symbol: currSymbol, currency_locale: currLocale }));
  toast$("Tax & Currency saved! ✓");
 };
 return (
  <SettingsSection title="Tax & Invoice Settings">
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:14, marginBottom:14 }}>
    <div><label style={lbl}>Tax Name (e.g. GST, VAT)</label><input style={inp} value={taxName} onChange={e=>setTaxName(e.target.value)}/></div>
    <div><label style={lbl}>Tax Rate (%)</label><input type="number" style={inp} value={taxRate} min={0} max={100} step={0.5} onChange={e=>setTaxRate(Number(e.target.value))}/></div>
    <div><label style={lbl}>Currency Symbol</label><input style={inp} value={currSymbol} maxLength={4} onChange={e=>setCurrSymbol(e.target.value)}/></div>
    <div><label style={lbl}>Currency Locale (e.g. en-IN)</label><input style={inp} value={currLocale} onChange={e=>setCurrLocale(e.target.value)}/></div>
   </div>
   <div style={{ fontSize:12, color:"#64748B", marginBottom:14 }}>Tax rate applies to all new invoices by default. Each invoice can override it individually.</div>
   <Btn v="success" icon="check" onClick={save}>Save Tax &amp; Currency</Btn>
  </SettingsSection>
 );
}
function EmergencyContactSection({ bizSettings, setBizSettings, toast$ }) {
 const [contact, setContact] = useState((bizSettings || {}).emergency_contact || "+91-9999999999");
 const lbl = { display:"block",color:"#64748B",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:5 };
 const inp = { width:"100%",background:"#FFFFFF",border:"1px solid #D5E1EE",borderRadius:8,padding:"9px 13px",color:"#0F172A",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit" };
 const save = () => {
  setBizSettings(prev => ({ ...prev, emergency_contact: contact }));
  toast$("Default contact saved! ✓");
 };
 return (
  <SettingsSection title="Default Values">
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
    <div><label style={lbl}>Default Emergency Contact (Vouchers)</label><input style={inp} value={contact} onChange={e=>setContact(e.target.value)} placeholder="+91-9999999999"/></div>
   </div>
   <Btn v="success" icon="check" onClick={save}>Save Defaults</Btn>
  </SettingsSection>
 );
}
function PaymentDetailsSection({ bizSettings, setBizSettings, toast$ }) {
 const def = bizSettings?.payment_details || {};
 const [pd, setPd] = useState({
  account_name:   def.account_name   || "SAFARNAAMA HOLIDAYS",
  bank_name:      def.bank_name      || "HDFC BANK",
  branch:         def.branch         || "",
  account_number: def.account_number || "",
  ifsc:           def.ifsc           || "",
 });
 const lbl = { display:"block",color:"#64748B",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:5 };
 const inp = { width:"100%",background:"#FFFFFF",border:"1px solid #D5E1EE",borderRadius:8,padding:"9px 13px",color:"#0F172A",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit" };
 const save = () => {
  setBizSettings(prev => ({ ...prev, payment_details: pd }));
  toast$("Payment details saved ✓");
 };
 return (
  <SettingsSection title="Payment / Bank Details">
   <div style={{ fontSize:12, color:"#64748B", marginBottom:14 }}>These details appear on every Invoice and Itinerary PDF so clients know where to transfer payment.</div>
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
    <div><label style={lbl}>Account Name</label><input style={inp} value={pd.account_name} onChange={e=>setPd(p=>({...p,account_name:e.target.value}))} placeholder="SAFARNAAMA HOLIDAYS"/></div>
    <div><label style={lbl}>Bank Name</label><input style={inp} value={pd.bank_name} onChange={e=>setPd(p=>({...p,bank_name:e.target.value}))} placeholder="HDFC BANK"/></div>
    <div><label style={lbl}>Account Number</label><input style={{ ...inp, fontWeight:700, letterSpacing:2 }} value={pd.account_number} onChange={e=>setPd(p=>({...p,account_number:e.target.value}))} placeholder="50200089249983"/></div>
    <div><label style={lbl}>IFSC Code</label><input style={{ ...inp, fontWeight:700, letterSpacing:1 }} value={pd.ifsc} onChange={e=>setPd(p=>({...p,ifsc:e.target.value}))} placeholder="HDFC0001911"/></div>
   </div>
   <div style={{ marginBottom:14 }}><label style={lbl}>Branch Address</label><input style={inp} value={pd.branch} onChange={e=>setPd(p=>({...p,branch:e.target.value}))} placeholder="Branch name and address"/></div>
   <Btn v="success" icon="check" onClick={save}>Save Payment Details</Btn>
  </SettingsSection>
 );
}
function EmailConfigSection({ toast$ }) {
 const DEFAULTS = { imap_host:"", imap_port:993, imap_ssl:true, smtp_host:"", smtp_port:465, smtp_ssl:true, username:"", password:"", from_name:"", sent_folder:"Sent", forward_email:"" };
 const [cfg, setCfg] = useState(DEFAULTS);
 const [loaded, setLoaded] = useState(false);
 const [saving, setSaving] = useState(false);
 const [testing, setTesting] = useState(false);
 const [folders, setFolders] = useState([]);
 useEffect(() => {
  fetch("/api/email/config").then(r=>r.json()).then(d => {
   if (d.configured) setCfg(prev => ({ ...DEFAULTS, ...d, password:"" }));
   setLoaded(true);
  }).catch(() => setLoaded(true));
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);
 const lbl = { display:"block", color:"#64748B", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:5 };
 const inp = { width:"100%", background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:8, padding:"9px 13px", color:"#0F172A", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
 const sel = { ...inp, cursor:"pointer" };
 const save = async () => {
  setSaving(true);
  try {
   const res = await fetch("/api/email/config", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(cfg) });
   let d;
   try { d = await res.json(); } catch { d = { error: `Server returned non-JSON (status ${res.status}) — check backend console for errors` }; }
   if (res.status === 200) {
    toast$("Email configuration saved to database ✓");
   } else if (res.status === 207) {
    // Saved to file only — DB failed, show prominent warning
    toast$("⚠ Saved locally only — database save failed. Config will be lost on backend restart. Check backend console for DB error.", true);
   } else {
    toast$(d?.error || `Save failed (HTTP ${res.status})`, true);
   }
  } catch (e) { toast$(`Cannot reach backend: ${e.message}`, true); }
  setSaving(false);
 };
 const test = async () => {
  setTesting(true);
  try {
   const res = await fetch("/api/email/test", { method:"POST" });
   let d; try { d = await res.json(); } catch { d = { error: `Non-JSON response (${res.status}) — check backend console` }; }
   if (res.ok) toast$(`IMAP connected! ${d.messages||0} messages, ${d.unseen||0} unread ✓`);
   else toast$(d.error || "Connection failed", true);
  } catch (e) { toast$(`Cannot reach backend: ${e.message}`, true); }
  setTesting(false);
 };
 const listFolders = async () => {
  try {
   const res = await fetch("/api/email/folders");
   const d = await res.json();
   if (res.ok) setFolders(d.map(f=>f.path));
   else toast$(d.error || "Could not list folders", true);
  } catch { toast$("Could not list folders", true); }
 };
 if (!loaded) return <SettingsSection title="Email (IMAP / SMTP)"><div style={{ color:"#64748B", fontSize:13 }}>Loading…</div></SettingsSection>;
 return (
  <SettingsSection title="Email (IMAP / SMTP)">
   <div style={{ fontSize:12, color:"#1E40AF", background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:8, padding:"10px 14px", marginBottom:10 }}>
    <strong>GoDaddy / cPanel hosting?</strong>&nbsp; Use these settings:<br/>
    IMAP: <code style={{ background:"#DBEAFE", padding:"1px 5px", borderRadius:4 }}>imap.secureserver.net</code> · Port <strong>993</strong> · SSL/TLS&nbsp;&nbsp;|&nbsp;&nbsp;
    SMTP: <code style={{ background:"#DBEAFE", padding:"1px 5px", borderRadius:4 }}>smtpout.secureserver.net</code> · Port <strong>465</strong> · SSL/TLS<br/>
    Username = your full email address &nbsp;·&nbsp; Password = cPanel email password (not Google/Microsoft password)
   </div>
   <div style={{ fontSize:12, color:"#92400E", background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:8, padding:"10px 14px", marginBottom:16 }}>
    Settings are saved securely to the database — they persist across restarts. Password is write-only and never shown after saving.
   </div>
   <div style={{ fontWeight:700, fontSize:13, color:"#0F172A", marginBottom:10 }}>Account</div>
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:16 }}>
    <div><label style={lbl}>Display Name (From)</label><input style={inp} value={cfg.from_name} onChange={e=>setCfg(p=>({...p,from_name:e.target.value}))} placeholder="Safarnaama Holidays"/></div>
    <div><label style={lbl}>Email Address</label><input style={inp} value={cfg.username} onChange={e=>setCfg(p=>({...p,username:e.target.value}))} placeholder="info@yourdomain.com"/></div>
    <div><label style={lbl}>App Password</label><input type="password" style={inp} value={cfg.password} onChange={e=>setCfg(p=>({...p,password:e.target.value}))} placeholder="Leave blank to keep existing"/></div>
   </div>
   <div style={{ fontWeight:700, fontSize:13, color:"#0F172A", marginBottom:10 }}>Incoming Mail (IMAP)</div>
   <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:14, marginBottom:16 }}>
    <div><label style={lbl}>IMAP Host</label><input style={inp} value={cfg.imap_host} onChange={e=>setCfg(p=>({...p,imap_host:e.target.value}))} placeholder="imap.secureserver.net"/></div>
    <div><label style={lbl}>Port</label><input type="number" style={inp} value={cfg.imap_port} onChange={e=>setCfg(p=>({...p,imap_port:Number(e.target.value)}))}/></div>
    <div><label style={lbl}>Encryption</label>
     <select style={sel} value={String(cfg.imap_ssl)} onChange={e=>setCfg(p=>({...p,imap_ssl:e.target.value==="true"}))}>
      <option value="true">SSL/TLS (993)</option>
      <option value="false">STARTTLS (143)</option>
     </select>
    </div>
   </div>
   <div style={{ fontWeight:700, fontSize:13, color:"#0F172A", marginBottom:10 }}>Outgoing Mail (SMTP)</div>
   <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr", gap:14, marginBottom:16 }}>
    <div><label style={lbl}>SMTP Host</label><input style={inp} value={cfg.smtp_host} onChange={e=>setCfg(p=>({...p,smtp_host:e.target.value}))} placeholder="smtpout.secureserver.net"/></div>
    <div><label style={lbl}>Port</label><input type="number" style={inp} value={cfg.smtp_port} onChange={e=>setCfg(p=>({...p,smtp_port:Number(e.target.value)}))}/></div>
    <div><label style={lbl}>Encryption</label>
     <select style={sel} value={String(cfg.smtp_ssl)} onChange={e=>setCfg(p=>({...p,smtp_ssl:e.target.value==="true"}))}>
      <option value="true">SSL/TLS (465)</option>
      <option value="false">STARTTLS (587)</option>
     </select>
    </div>
    <div>
     <label style={lbl}>Sent Folder Name
      <button onClick={listFolders} style={{ marginLeft:6, background:"none", border:"none", cursor:"pointer", color:"#1A6B8A", fontSize:10, fontWeight:700, padding:0 }}>List</button>
     </label>
     {folders.length > 0 ? (
      <select style={sel} value={cfg.sent_folder||"Sent"} onChange={e=>setCfg(p=>({...p,sent_folder:e.target.value}))}>
       {folders.map(f=><option key={f} value={f}>{f}</option>)}
      </select>
     ) : (
      <input style={inp} value={cfg.sent_folder||"Sent"} onChange={e=>setCfg(p=>({...p,sent_folder:e.target.value}))} placeholder="Sent"/>
     )}
    </div>
   </div>
   <div style={{ marginBottom:12 }}>
    <label style={lbl}>Forward Processed Quotes To (Employee Email)</label>
    <input style={inp} value={cfg.forward_email||""} onChange={e=>setCfg(p=>({...p,forward_email:e.target.value}))} placeholder="employee@yourcompany.com — receives vendor quotes after markup"/>
   </div>
   <div style={{ display:"flex", gap:10 }}>
    <Btn v="success" icon="check" onClick={save} disabled={saving}>{saving?"Saving…":"Save Configuration"}</Btn>
    <Btn v="ghost" onClick={test} disabled={testing}>{testing?"Testing…":"Test IMAP Connection"}</Btn>
   </div>
  </SettingsSection>
 );
}
function WhatsAppTemplatesSection({ bizSettings, setBizSettings, toast$ }) {
 const defaultTpls = DEFAULT_BIZ_SETTINGS.whatsapp_templates;
 const [templates, setTemplates] = useState(
  Array.isArray(bizSettings?.whatsapp_templates) && bizSettings.whatsapp_templates.length
   ? bizSettings.whatsapp_templates
   : defaultTpls
 );
 const [editing, setEditing] = useState(null);
 const [showNew, setShowNew] = useState(false);
 const [newTpl, setNewTpl] = useState({ name:"", message:"" });
 const lbl = { display:"block", color:"#64748B", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:5 };
 const inp = { width:"100%", background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:8, padding:"9px 13px", color:"#0F172A", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
 const tarea = { ...inp, resize:"vertical", minHeight:90 };
 const persist = (tpls) => {
  setTemplates(tpls);
  setBizSettings(prev => ({ ...prev, whatsapp_templates: tpls }));
  toast$("WhatsApp templates saved! ✓");
 };
 const VARS = ["{name}","{destination}","{travel_date}","{pax}","{kids}","{kids_text}","{budget}","{agent}"];
 return (
  <SettingsSection title="WhatsApp Follow-up Templates">
   <div style={{ fontSize:12, color:"#155724", background:"#d4edda", border:"1px solid #c3e6cb", borderRadius:8, padding:"10px 14px", marginBottom:16 }}>
    <strong>Available variables:</strong>{" "}
    {VARS.map(v=><code key={v} style={{ background:"#b8dfc0", borderRadius:4, padding:"1px 6px", marginRight:4, fontSize:11, fontFamily:"monospace" }}>{v}</code>)}
    <div style={{ marginTop:6, color:"#155724", opacity:.75 }}>These are auto-filled with lead data when you click WhatsApp from the Leads page.</div>
   </div>
   {templates.map((t,i) => (
    <div key={t.id||i} style={{ border:"1px solid #E6ECF5", borderRadius:10, padding:14, marginBottom:10, background:"#F8FAFC" }}>
     {editing?.idx === i ? (
      <div>
       <div style={{ marginBottom:8 }}><label style={lbl}>Template Name</label><input style={inp} value={editing.name} onChange={e=>setEditing(p=>({...p,name:e.target.value}))}/></div>
       <div style={{ marginBottom:10 }}><label style={lbl}>Message</label><textarea style={tarea} value={editing.message} onChange={e=>setEditing(p=>({...p,message:e.target.value}))}/></div>
       <div style={{ display:"flex", gap:8 }}>
        <Btn v="success" s={{ fontSize:11, padding:"5px 12px" }} onClick={()=>{
         const tpls = templates.map((x,j)=>j===i?{ ...x, name:editing.name, message:editing.message }:x);
         persist(tpls); setEditing(null);
        }}>Save</Btn>
        <Btn v="ghost" s={{ fontSize:11, padding:"5px 12px" }} onClick={()=>setEditing(null)}>Cancel</Btn>
       </div>
      </div>
     ) : (
      <div>
       <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
        <div style={{ fontWeight:700, fontSize:13, color:"#1A6B8A" }}>{t.name}</div>
        <div style={{ display:"flex", gap:6 }}>
         <Btn v="ghost" s={{ fontSize:11, padding:"3px 8px" }} onClick={()=>setEditing({ idx:i, ...t })}>Edit</Btn>
         <Btn v="ghost" s={{ fontSize:11, padding:"3px 8px", color:"#EF9A9A" }} onClick={()=>persist(templates.filter((_,j)=>j!==i))}>✕</Btn>
        </div>
       </div>
       <div style={{ fontSize:12, color:"#475569", lineHeight:1.65, whiteSpace:"pre-wrap" }}>{t.message}</div>
      </div>
     )}
    </div>
   ))}
   {showNew ? (
    <div style={{ border:"1px dashed #1A6B8A", borderRadius:10, padding:14, marginBottom:10, background:"#F0F9FF" }}>
     <div style={{ marginBottom:8 }}><label style={lbl}>Template Name</label><input style={inp} value={newTpl.name} onChange={e=>setNewTpl(p=>({...p,name:e.target.value}))} placeholder="e.g. Follow Up After Quote"/></div>
     <div style={{ marginBottom:10 }}><label style={lbl}>Message</label><textarea style={tarea} value={newTpl.message} onChange={e=>setNewTpl(p=>({...p,message:e.target.value}))} placeholder="Hi {name}! ..."/></div>
     <div style={{ display:"flex", gap:8 }}>
      <Btn v="success" s={{ fontSize:11, padding:"5px 12px" }} onClick={()=>{
       if (!newTpl.name.trim()||!newTpl.message.trim()) return toast$("Name and message are required", true);
       persist([...templates,{ id:"wt"+Date.now(), ...newTpl }]);
       setNewTpl({ name:"", message:"" }); setShowNew(false);
      }}>Add Template</Btn>
      <Btn v="ghost" s={{ fontSize:11, padding:"5px 12px" }} onClick={()=>{ setShowNew(false); setNewTpl({ name:"", message:"" }); }}>Cancel</Btn>
     </div>
    </div>
   ) : (
    <Btn v="secondary" s={{ fontSize:12, padding:"6px 14px" }} onClick={()=>setShowNew(true)}>+ Add Template</Btn>
   )}
  </SettingsSection>
 );
}
function NotificationSettingsSection({ toast$ }) {
 const DEFAULTS = { enabled:false, phone:"", channel:"whatsapp", timeout_hours:3 };
 const [cfg, setCfg] = useState(DEFAULTS);
 const [providerStatus, setProviderStatus] = useState(null); // { provider, channel, configured }
 const [testing, setTesting] = useState(false);
 const lbl = { display:"block", color:"#64748B", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:5 };
 const inp = { width:"100%", background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:8, padding:"9px 13px", color:"#0F172A", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
 useEffect(() => {
  fetch("/api/settings/notif_config").then(r=>r.json()).then(d=>{ if(d && typeof d==="object" && !d.error) setCfg(c=>({...DEFAULTS,...d})); }).catch(()=>{});
  fetch("/api/notifications/status").then(r=>r.json()).then(setProviderStatus).catch(()=>{});
 }, []);
 const save = async () => {
  try {
   const r = await fetch("/api/settings/notif_config",{ method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(cfg) });
   if (!r.ok) throw new Error((await r.json()).error || "Save failed");
   toast$("Notification settings saved ✓");
  } catch(e) { toast$(e.message, true); }
 };
 const test = async () => {
  setTesting(true);
  try {
   const r = await fetch("/api/notifications/test",{ method:"POST" });
   const d = await r.json();
   if (!r.ok || d.error) throw new Error(d.error || "Test failed");
   toast$("Test notification sent — check your phone ✓");
  } catch(e) { toast$(e.message, true); } finally { setTesting(false); }
 };
 const f = (k,v) => setCfg(p=>({...p,[k]:v}));
 const providerLabel = { msg91:"MSG91 (India)", fast2sms:"Fast2SMS (India)", none:"None — not configured" };
 return (
  <SettingsSection title="Notifications (WhatsApp / SMS)">
   {/* Provider status banner — read-only, set in server .env */}
   <div style={{ display:"flex", alignItems:"center", gap:10, background: providerStatus?.configured ? "#F0FDF4" : "#FFF7ED", border:`1px solid ${providerStatus?.configured?"#BBF7D0":"#FED7AA"}`, borderRadius:8, padding:"10px 14px", marginBottom:16 }}>
    <span style={{ fontSize:18 }}>{providerStatus?.configured ? "✅" : "⚠️"}</span>
    <div>
     <div style={{ fontWeight:700, fontSize:13, color: providerStatus?.configured ? "#166534" : "#92400E" }}>
      Provider: {providerLabel[providerStatus?.provider] || "Loading…"}
      {providerStatus?.configured && providerStatus?.waReady && " · WhatsApp ready"}
     </div>
     <div style={{ fontSize:11, color:"#64748B", marginTop:2 }}>
      {providerStatus?.configured
       ? "Credentials configured in server environment — ready to send."
       : "Not configured. Ask your developer to set NOTIF_PROVIDER and credentials in the server .env file."}
     </div>
    </div>
   </div>

   <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
    <input type="checkbox" id="notif_enabled" checked={!!cfg.enabled} onChange={e=>f("enabled",e.target.checked)} style={{ width:16, height:16, cursor:"pointer" }}/>
    <label htmlFor="notif_enabled" style={{ fontWeight:600, color:"#0F172A", fontSize:13, cursor:"pointer" }}>Enable notifications</label>
   </div>

   {cfg.enabled && (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
     <div>
      <label style={lbl}>Phone Number (with country code)</label>
      <input style={inp} value={cfg.phone} onChange={e=>f("phone",e.target.value)} placeholder="+919876543210"/>
      <div style={{ fontSize:11, color:"#94A3B8", marginTop:4 }}>Alerts will be sent to this number.</div>
     </div>
     <div>
      <label style={lbl}>Vendor reply timeout</label>
      <select style={inp} value={cfg.timeout_hours} onChange={e=>f("timeout_hours",Number(e.target.value))}>
       {[1,2,3,4,6,8,12,24].map(h=><option key={h} value={h}>{h} hour{h>1?"s":""}</option>)}
      </select>
      <div style={{ fontSize:11, color:"#94A3B8", marginTop:4 }}>Alert if vendor doesn't reply within this time.</div>
     </div>
    </div>
   )}

   <div style={{ display:"flex", gap:10, marginTop:4 }}>
    <Btn v="success" icon="check" onClick={save}>Save Notification Settings</Btn>
    {cfg.enabled && providerStatus?.configured && (
     <Btn v="secondary" onClick={test} disabled={testing}>{testing?"Sending…":"Send Test Notification"}</Btn>
    )}
   </div>

   {/* Developer setup note */}
   <div style={{ marginTop:16, padding:"12px 14px", background:"#F8FAFC", border:"1px solid #E2E8F0", borderRadius:8, fontSize:11, color:"#475569" }}>
    <strong style={{ fontSize:12 }}>Developer Setup — set in <code style={{ background:"#E2E8F0", padding:"1px 5px", borderRadius:3 }}>backend/.env</code></strong>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginTop:10 }}>
     <div style={{ background:"#FFFFFF", border:"1px solid #BBF7D0", borderRadius:8, padding:10 }}>
      <div style={{ fontWeight:700, color:"#166534", marginBottom:6 }}>Option A — MSG91 (Recommended)</div>
      <div style={{ color:"#64748B", marginBottom:6 }}>Indian provider · INR billing · SMS + WhatsApp · msg91.com</div>
      <div style={{ fontFamily:"monospace", lineHeight:1.9, color:"#334155", background:"#F0FDF4", padding:8, borderRadius:6 }}>
       NOTIF_PROVIDER=msg91<br/>
       MSG91_AUTHKEY=your_key<br/>
       MSG91_SENDER_ID=SAFARN<br/>
       <span style={{ color:"#94A3B8" }}># WhatsApp (optional):</span><br/>
       MSG91_WA_INTEGRATED_NUMBER=<br/>
       MSG91_WA_TEMPLATE_ID=
      </div>
      <div style={{ marginTop:6, color:"#15803D" }}>~₹0.20/SMS · WhatsApp ₹0.35/msg</div>
     </div>
     <div style={{ background:"#FFFFFF", border:"1px solid #BAE6FD", borderRadius:8, padding:10 }}>
      <div style={{ fontWeight:700, color:"#0369A1", marginBottom:6 }}>Option B — Fast2SMS</div>
      <div style={{ color:"#64748B", marginBottom:6 }}>Indian provider · INR billing · SMS only · fast2sms.com</div>
      <div style={{ fontFamily:"monospace", lineHeight:1.9, color:"#334155", background:"#F0F9FF", padding:8, borderRadius:6 }}>
       NOTIF_PROVIDER=fast2sms<br/>
       FAST2SMS_API_KEY=your_key
      </div>
      <div style={{ marginTop:6, color:"#0369A1" }}>~₹0.15/SMS · Simplest setup · No DLT needed</div>
     </div>
    </div>
   </div>
  </SettingsSection>
 );
}

function AutoCheckScheduleSection({ toast$ }) {
 const DEFAULTS = { window_enabled:false, start_hour:9, end_hour:19 };
 const [cfg, setCfg] = useState(DEFAULTS);
 const lbl = { display:"block", color:"#64748B", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:5 };
 const inp = { width:"100%", background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:8, padding:"9px 13px", color:"#0F172A", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
 useEffect(() => {
  fetch("/api/settings/schedule_config").then(r=>r.json()).then(d=>{ if(d && typeof d==="object" && !d.error) setCfg(c=>({...DEFAULTS,...d})); }).catch(()=>{});
 }, []);
 const save = async () => {
  try {
   const r = await fetch("/api/settings/schedule_config",{ method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(cfg) });
   if (!r.ok) throw new Error((await r.json()).error || "Save failed");
   toast$("Schedule settings saved ✓");
  } catch(e) { toast$(e.message, true); }
 };
 const f = (k,v) => setCfg(p=>({...p,[k]:v}));
 const fmtH = h => { const ampm = h<12?"AM":"PM"; const hr = h===0?12:h>12?h-12:h; return `${hr}:00 ${ampm}`; };
 const hours = Array.from({length:24},(_,i)=>i);
 return (
  <SettingsSection title="Auto-Check Schedule (IST)">
   <div style={{ fontSize:12, color:"#1A6B8A", background:"#E0F2FE", border:"1px solid #BAE6FD", borderRadius:8, padding:"10px 14px", marginBottom:16 }}>
    Limit IMAP email scanning to business hours to reduce server load. All times are in IST (Indian Standard Time).
   </div>
   <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
    <input type="checkbox" id="sched_enabled" checked={!!cfg.window_enabled} onChange={e=>f("window_enabled",e.target.checked)} style={{ width:16, height:16, cursor:"pointer" }}/>
    <label htmlFor="sched_enabled" style={{ fontWeight:600, color:"#0F172A", fontSize:13, cursor:"pointer" }}>Enable time window (scan only during set hours)</label>
   </div>
   {cfg.window_enabled && (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
     <div>
      <label style={lbl}>Start Time (IST)</label>
      <select style={inp} value={cfg.start_hour} onChange={e=>f("start_hour",Number(e.target.value))}>
       {hours.map(h=><option key={h} value={h}>{fmtH(h)}</option>)}
      </select>
     </div>
     <div>
      <label style={lbl}>End Time (IST)</label>
      <select style={inp} value={cfg.end_hour} onChange={e=>f("end_hour",Number(e.target.value))}>
       {hours.map(h=><option key={h} value={h}>{fmtH(h)}</option>)}
      </select>
     </div>
    </div>
   )}
   {cfg.window_enabled && (
    <div style={{ fontSize:12, color:"#475569", marginBottom:12 }}>
     Auto-scan runs from <strong>{fmtH(cfg.start_hour)}</strong> to <strong>{fmtH(cfg.end_hour)}</strong> IST every day.
    </div>
   )}
   <Btn v="success" icon="check" onClick={save}>Save Schedule</Btn>
  </SettingsSection>
 );
}

function PageSettings({ markup, setMarkup, bizSettings, setBizSettings, toast$, themeMode="light", setThemeMode, companyProfile = {}, setCompanyProfile }) {
 const [localMarkup, setLocalMarkup] = useState({...markup});
 const [biz, setBiz] = useState({ ...DEFAULT_BIZ_SETTINGS, ...bizSettings });
 const saveMarkup = () => { setMarkup(localMarkup); toast$("Markup saved!"); };
 const saveBiz = () => { setBizSettings(biz); toast$("Settings saved to database!"); };
 return (
 <div style={{ maxWidth:740 }}>
  {/* ── COMPANY PROFILE ── */}
  <CompanyProfileSection companyProfile={companyProfile} setCompanyProfile={setCompanyProfile} toast$={toast$}/>

  {/* ── ONLINE PRESENCE ── */}
  <OnlinePresenceSection companyProfile={companyProfile} setCompanyProfile={setCompanyProfile} toast$={toast$}/>

  {/* ── THEME ── */}
  <SettingsSection title="Appearance">
   <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
    {[
     { id:"light", label:"Light", icon:"☀️", desc:"Clean white interface", bg:"#F6F8FC", card:"#FFFFFF", text:"#0F172A", border:"#E6ECF5" },
     { id:"dark",  label:"Dark",  icon:"🌙", desc:"Easy on the eyes", bg:"#0D1117", card:"#1E293B", text:"#E2E8F0", border:"#334155" },
    ].map(t => {
     const active = themeMode === t.id;
     return (
      <button key={t.id} onClick={()=>setThemeMode && setThemeMode(t.id)}
       style={{ flex:1, minWidth:160, border:`2px solid ${active?"#1A6B8A":"#E6ECF5"}`, borderRadius:14, padding:0, cursor:"pointer", background:"transparent", textAlign:"left", transition:"all .2s", outline:"none" }}>
       {/* Mini CRM preview */}
       <div style={{ background:t.bg, borderRadius:"12px 12px 0 0", padding:12, display:"flex", gap:8, alignItems:"flex-start" }}>
        <div style={{ width:32, background:t.card, borderRadius:6, height:60, flexShrink:0, border:`1px solid ${t.border}` }}/>
        <div style={{ flex:1 }}>
         <div style={{ background:t.card, borderRadius:6, padding:6, marginBottom:6, border:`1px solid ${t.border}` }}>
          <div style={{ width:"60%", height:6, background:t.border, borderRadius:3 }}/>
         </div>
         <div style={{ background:t.card, borderRadius:6, padding:6, border:`1px solid ${t.border}` }}>
          <div style={{ width:"40%", height:6, background:t.border, borderRadius:3, marginBottom:4 }}/>
          <div style={{ width:"80%", height:5, background:t.border, borderRadius:3, opacity:.5 }}/>
         </div>
        </div>
       </div>
       {/* Label */}
       <div style={{ padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
         <div style={{ fontWeight:700, fontSize:13, color:"#0F172A", display:"flex", alignItems:"center", gap:6 }}>{t.icon} {t.label}</div>
         <div style={{ fontSize:11, color:"#64748B", marginTop:2 }}>{t.desc}</div>
        </div>
        {active && <div style={{ width:18, height:18, borderRadius:"50%", background:"#1A6B8A", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#fff", fontWeight:700 }}>✓</div>}
       </div>
      </button>
     );
    })}
   </div>
  </SettingsSection>

  {/* ── TAX & INVOICE ── */}
  <TaxCurrencySection bizSettings={bizSettings} setBizSettings={setBizSettings} toast$={toast$}/>

  {/* ── MARKUP ── */}
  <SettingsSection title="Markup Configuration">
   <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14 }}>
    {[["star3","3★ Hotel Markup (%)"],["star4","4★ Hotel Markup (%)"],["transport","Transport Markup (%)"],["activities","Activities Markup (%)"],["default_markup_pct","Default Markup — Vendor Quotes (%)"]].map(([k,lbl])=>(
     <F key={k} label={lbl}>
      <Inp type="number" value={k==="default_markup_pct" ? (biz[k]??22) : (localMarkup[k]??0)} min={0} max={200}
       onChange={e=>{
        if (k==="default_markup_pct") setBiz(p=>({...p,[k]:Number(e.target.value)}));
        else setLocalMarkup(p=>({...p,[k]:Number(e.target.value)}));
       }}/>
     </F>
    ))}
   </div>
   <div style={{ display:"flex", gap:10 }}>
    <Btn v="success" icon="check" onClick={()=>{ saveMarkup(); saveBiz(); }}>Save Markup</Btn>
   </div>
  </SettingsSection>

  {/* ── STATUS LISTS ── */}
  {[
   { key:"lead_statuses",    title:"Lead Pipeline Statuses",     color:"#0369A1", bg:"#F0F9FF", border:"#BAE6FD" },
   { key:"quote_statuses",   title:"Quote Statuses",             color:"#7C3AED", bg:"#F5F3FF", border:"#DDD6FE" },
   { key:"task_statuses",    title:"Task Statuses",              color:"#0F766E", bg:"#F0FDFA", border:"#99F6E4" },
   { key:"task_priorities",  title:"Task Priorities",            color:"#B45309", bg:"#FFFBEB", border:"#FDE68A" },
   { key:"itin_statuses",    title:"Itinerary Statuses",         color:"#1A6B8A", bg:"#E0F2FE", border:"#BAE6FD" },
   { key:"flight_classes",   title:"Flight Classes",             color:"#334155", bg:"#F8FAFC", border:"#E2E8F0" },
   { key:"meal_plans",       title:"Hotel Meal Plans",           color:"#166534", bg:"#F0FDF4", border:"#BBF7D0" },
   { key:"room_types",       title:"Room Types",                 color:"#1A6B8A", bg:"#E0F2FE", border:"#7DD3FC" },
   { key:"vehicle_types",    title:"Vehicle Types",              color:"#0F766E", bg:"#F0FDFA", border:"#99F6E4" },
   { key:"airlines",         title:"Airlines",                   color:"#6D28D9", bg:"#F5F3FF", border:"#C4B5FD" },
   { key:"vendor_categories",title:"Vendor Categories",          color:"#9A3412", bg:"#FFF7ED", border:"#FED7AA" },
  ].map(({ key, title, color, bg, border }) => {
   const items = biz[key] || [];
   return (
    <SettingsSection key={key} title={title}>
     <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
      {items.map((s,i) => (
       <span key={s+i} style={{ display:"inline-flex", alignItems:"center", gap:5, background:bg, border:`1px solid ${border}`, borderRadius:20, padding:"4px 12px", fontSize:12, color, fontWeight:600 }}>
        {s}
        <button onClick={()=>setBiz(p=>({...p,[key]:items.filter((_,idx)=>idx!==i)}))} style={{ background:"none", border:"none", cursor:"pointer", color:"#94A3B8", fontSize:14, lineHeight:1, padding:0 }}>×</button>
       </span>
      ))}
     </div>
     <StatusAdder onAdd={val=>setBiz(p=>({...p,[key]:[...(p[key]||[]),val]}))} placeholder={`Add to ${title.toLowerCase()}…`}/>
     <div style={{ marginTop:10 }}><Btn v="success" s={{ fontSize:11, padding:"5px 12px" }} onClick={saveBiz}>Save</Btn></div>
    </SettingsSection>
   );
  })}

  {/* ── DEFAULTS ── */}
  <EmergencyContactSection bizSettings={bizSettings} setBizSettings={setBizSettings} toast$={toast$}/>
  <PaymentDetailsSection bizSettings={bizSettings} setBizSettings={setBizSettings} toast$={toast$}/>

  {/* ── EMAIL ── */}
  <EmailConfigSection toast$={toast$}/>

  {/* ── NOTIFICATIONS ── */}
  <NotificationSettingsSection toast$={toast$}/>

  {/* ── AUTO-CHECK SCHEDULE ── */}
  <AutoCheckScheduleSection toast$={toast$}/>

  {/* ── WHATSAPP TEMPLATES ── */}
  <WhatsAppTemplatesSection bizSettings={bizSettings} setBizSettings={setBizSettings} toast$={toast$}/>

  {/* ── STATUS ── */}
  <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:22 }}>
  <div style={{ fontWeight:700, color:"#0F172A", marginBottom:14, fontSize:15 }}>Feature Status</div>
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
const TOUR_TYPES = ["Honeymoon","Family","Group","Solo","Adventure","Corporate","Pilgrimage","Wildlife","General"];

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

// ── FAST CDN IMAGES — Picsum Photos (instant, CORS-OK, beautiful, no API key) ─
// Destination seeds are fixed so the same destination always shows the same image.
// Users override these with their own URLs via the media library.
const DEST_SEEDS = {
 "Goa":                        "goa-ind-beach-101",
 "Kerala":                     "kerala-backwater-202",
 "Kashmir":                    "kashmir-mountain-303",
 "Rajasthan":                  "rajasthan-desert-404",
 "Himachal Pradesh":           "himachal-snow-505",
 "Andaman Islands":            "andaman-ocean-606",
 "Leh-Ladakh":                 "ladakh-valley-707",
 "Golden Triangle":            "golden-triangle-808",
 "Varanasi & Rishikesh":       "varanasi-ganga-909",
 "Darjeeling & Sikkim":        "darjeeling-tea-010",
 "Dubai":                      "dubai-skyline-111",
 "Singapore":                  "singapore-city-222",
 "Maldives":                   "maldives-lagoon-333",
 "Mauritius":                  "mauritius-island-444",
 "Sri Lanka":                  "srilanka-nature-555",
 "Bali":                       "bali-terrace-666",
 "Vietnam":                    "vietnam-halong-777",
 "Malaysia":                   "malaysia-city-888",
 "Thailand":                   "thailand-temple-999",
 "Turkey":                     "turkey-capadoc-100",
 "Europe - Paris & Switzerland":"paris-eiffel-101",
 "Europe - Greece":            "greece-santorini-202",
 "Europe - Italy":             "italy-rome-colosseum-303",
};

// Returns a fast, stable Picsum CDN image URL for any seed string
const picsumUrl = (seed, w, h) =>
 `https://picsum.photos/seed/${encodeURIComponent((seed||"travel").replace(/\s+/g,"-").toLowerCase())}/${w}/${h}`;

// Destination-aware image — uses curated seed, falls back to dest name as seed
const destImgUrl = (dest, w=800, h=500) =>
 picsumUrl(DEST_SEEDS[dest] || (dest||"travel").replace(/[^a-zA-Z0-9]/g,"-").replace(/-+/g,"-").toLowerCase(), w, h);

// Hotel image — seeded from hotel name + index so each hotel gets a unique photo
const hotelImgUrl = (name, dest, w=800, h=400, idx=0) =>
 picsumUrl(((name||(dest||"hotel")+idx||"hotel").replace(/[^a-zA-Z0-9]/g,"").toLowerCase().slice(0,24)||"hotel"+idx)+"stay", w, h);

// Day image — appends day number to destination seed so each day gets a distinct photo
const dayImgUrl = (dest, dayNum, w=800, h=280) => {
 const base = DEST_SEEDS[dest] || (dest||"travel").replace(/[^a-zA-Z0-9]/g,"-").replace(/-+/g,"-").toLowerCase();
 return picsumUrl(base + "-d" + (dayNum||1), w, h);
};

// Compress a File to a JPEG data URL (max width maxW, quality q)
const compressImage = (file, maxW=960, q=0.82) => new Promise(resolve => {
 const objUrl = URL.createObjectURL(file);
 const img = new Image();
 img.onload = () => {
  URL.revokeObjectURL(objUrl);
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  resolve(c.toDataURL('image/jpeg', q));
 };
 img.onerror = () => resolve(null);
 img.src = objUrl;
});

// Save an uploaded image data URL to the media_library via backend, then return the media record.
// Pass `baseTitle` in meta to enable sequential naming (e.g. "Bali Cover 1", "Bali Cover 2").
const saveUploadedMedia = async (dataUrl, meta) => {
 try {
  let title = meta.title || meta.baseTitle || 'Photo';
  if (meta.baseTitle && meta.destination && meta.category) {
   // Count existing records for this destination+category to auto-number
   const existing = await fetch(
    `/api/media?destination=${encodeURIComponent(meta.destination)}&category=${encodeURIComponent(meta.category)}`
   ).then(r => r.ok ? r.json() : []).catch(() => []);
   const seq = (Array.isArray(existing) ? existing.length : 0) + 1;
   title = `${meta.baseTitle}${seq}`;
  }
  const { baseTitle: _bt, ...rest } = meta;
  const r = await fetch('/api/media', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ url: dataUrl, thumbnail_url: dataUrl, is_featured: false, ...rest, title }),
  });
  return r.ok ? await r.json() : null;
 } catch { return null; }
};

// Legacy alias — replaces Pollinations with instant Picsum CDN
const unsplashUrl = (query, w=800, h=360) => {
 const seed = (query||"travel").replace(/[^a-zA-Z0-9]/g,"").toLowerCase().slice(0,24)||"travel";
 return picsumUrl(seed, w, h);
};

// ─── FLIGHT SEARCH & BOOK MODAL (Amadeus) ────────────────────────────────────
function FlightSearchModal({ open, onClose, onImport, initDate="", adults=1, toast$ }) {
 const [step, setStep] = useState("search");
 const [tripType, setTripType] = useState("oneway");
 const [resultTab, setResultTab] = useState("outbound");
 const _today = new Date().toISOString().split("T")[0];
 const [form, setForm] = useState({ date: initDate && initDate >= _today ? initDate : _today, returnDate:"", adults:adults||1, children:0, infants:0, travelClass:"ECONOMY", nonStop:false });
 const [originQ, setOriginQ] = useState("");
 const [destQ,   setDestQ]   = useState("");
 const [originOpts, setOriginOpts] = useState([]);
 const [destOpts,   setDestOpts]   = useState([]);
 const [originSel, setOriginSel] = useState(null);
 const [destSel,   setDestSel]   = useState(null);
 const [searching, setSearching] = useState(false);
 const [results,   setResults]   = useState([]);
 const [returnResults, setReturnResults] = useState([]);
 const [legResults,    setLegResults]    = useState({});
 const [legs, setLegs] = useState([
  {id:1,originSel:null,destSel:null,date:"",originQ:"",destQ:"",originOpts:[],destOpts:[]},
  {id:2,originSel:null,destSel:null,date:"",originQ:"",destQ:"",originOpts:[],destOpts:[]},
 ]);
 const [searchMeta, setSearchMeta] = useState({});
 const [searchErr, setSearchErr] = useState("");
 const [pricing,   setPricing]   = useState(false);
 const [priceErr,  setPriceErr]  = useState("");
 const [pricedOffer, setPricedOffer] = useState(null);
 const [passengers,  setPassengers]  = useState([]);
 const [booking,          setBooking]          = useState(null);
 const [bookingErr,       setBookingErr]       = useState("");
 const [bookingLoading,   setBookingLoading]   = useState(false);
 const [reviewConditions, setReviewConditions] = useState({});
 const [fareAlerts,       setFareAlerts]       = useState([]);
 const [uatMode, setUatMode] = useState(false);
 const originTimer   = useRef(null);
 const destTimer     = useRef(null);
 const legTimers     = useRef({});
 const originRef     = useRef(null);   // for fixed-position dropdown
 const destRef       = useRef(null);
 const legOriginRefs = useRef({});
 const legDestRefs   = useRef({});

 const toggleUat = async () => {
  const endpoint = uatMode ? "/api/uat/disable" : "/api/uat/enable";
  try {
   await API("POST", endpoint, {});
   setUatMode(!uatMode);
   toast$ && toast$(uatMode ? "UAT logging disabled" : "UAT logging enabled — search/review/book will be captured");
  } catch(e) {
   toast$ && toast$("UAT toggle failed: " + e.message, true);
  }
 };

 // Reset all search state each time the modal opens fresh
 useEffect(() => {
  if (!open) return;
  const today = new Date().toISOString().split("T")[0];
  setStep("search"); setTripType("oneway"); setResultTab("outbound");
  setForm({ date: initDate && initDate >= today ? initDate : today, returnDate:"", adults:adults||1, children:0, infants:0, travelClass:"ECONOMY", nonStop:false });
  setOriginSel(null); setDestSel(null); setOriginQ(""); setDestQ(""); setOriginOpts([]); setDestOpts([]);
  setLegs([
   {id:1,originSel:null,destSel:null,date:"",originQ:"",destQ:"",originOpts:[],destOpts:[]},
   {id:2,originSel:null,destSel:null,date:"",originQ:"",destQ:"",originOpts:[],destOpts:[]},
  ]);
  setSearching(false); setResults([]); setReturnResults([]); setLegResults({});
  setSearchMeta({}); setSearchErr(""); setPricing(false); setPriceErr("");
  setPricedOffer(null); setPassengers([]); setBooking(null); setBookingErr("");
  setReviewConditions({}); setFareAlerts([]);
 }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

 // Compute fixed-position style for a dropdown, keyed to a ref
 const fixedDropStyle = (ref) => {
  const r = ref?.current?.getBoundingClientRect();
  if (!r) return { display:"none" };
  return { position:"fixed", top:r.bottom+2, left:r.left, width:r.width, zIndex:9999,
   background:"#fff", border:"1px solid #D5E1EE", borderRadius:8,
   boxShadow:"0 8px 24px rgba(0,0,0,.15)", maxHeight:230, overflowY:"auto" };
 };
 const AptItem = ({ o, onClick }) => (
  <div onClick={onClick}
   style={{padding:"9px 13px",fontSize:13,cursor:"pointer",borderBottom:"1px solid #F1F5F9",display:"flex",gap:10,alignItems:"center"}}
   onMouseEnter={e=>e.currentTarget.style.background="#EEF3F9"} onMouseLeave={e=>e.currentTarget.style.background=""}>
   <span style={{fontWeight:800,color:"#1A6B8A",minWidth:38,fontFamily:"monospace"}}>{o.iataCode}</span>
   <span style={{flex:1}}>{o.name}{o.cityName&&o.cityName!==o.name?<span style={{color:"#94A3B8",fontSize:11}}> · {o.cityName}</span>:null}</span>
  </div>
 );

 const searchAirports = (q, setter) => {
  if (q.length < 2) { setter([]); return; }
  API("GET", `/api/flights/airports?q=${encodeURIComponent(q)}`).then(d => setter(d.data||[])).catch(()=>{});
 };
 const handleOriginQ = q => { setOriginQ(q); clearTimeout(originTimer.current); originTimer.current = setTimeout(()=>searchAirports(q,setOriginOpts),350); };
 const handleDestQ   = q => { setDestQ(q);   clearTimeout(destTimer.current);   destTimer.current   = setTimeout(()=>searchAirports(q,setDestOpts),350); };

 const swapLocations = () => {
  const s = originSel; const q = originQ;
  setOriginSel(destSel); setOriginQ(destQ); setOriginOpts([]);
  setDestSel(s);  setDestQ(q);   setDestOpts([]);
 };

 const updLeg = (id, field, val) => setLegs(prev => prev.map(l => l.id === id ? {...l, [field]: val} : l));
 const addLeg = () => { if (legs.length < 4) setLegs(prev => [...prev, {id:Date.now(),originSel:null,destSel:null,date:"",originQ:"",destQ:"",originOpts:[],destOpts:[]}]); };
 const removeLeg = id => { if (legs.length > 2) setLegs(prev => prev.filter(l => l.id !== id)); };
 const handleLegQ = (id, field, q) => {
  updLeg(id, field, q);
  const key = `${id}_${field}`;
  clearTimeout(legTimers.current[key]);
  legTimers.current[key] = setTimeout(() => {
   if (q.length < 2) { updLeg(id, field === "originQ" ? "originOpts" : "destOpts", []); return; }
   API("GET", `/api/flights/airports?q=${encodeURIComponent(q)}`).then(d => updLeg(id, field === "originQ" ? "originOpts" : "destOpts", d.data||[])).catch(()=>{});
  }, 350);
 };

 const doSearch = async () => {
  setSearchErr("");
  if (tripType === "multicity") {
   const valid = legs.filter(l => l.originSel && l.destSel && l.date);
   if (valid.length < 2) { setSearchErr("Add at least 2 complete legs (origin, destination and date)"); return; }
   setSearching(true); setLegResults({});
   try {
    const searches = await Promise.all(valid.map(leg =>
     API("POST", "/api/flights/search", {
      origin: leg.originSel.iataCode, destination: leg.destSel.iataCode,
      date: leg.date, adults: form.adults, children: form.children||0, infants: form.infants||0, travelClass: form.travelClass,
      nonStop: form.nonStop, max: 20,
     }).then(d => ({ legId: leg.id, results: d.data||[], meta: d.meta||{} }))
       .catch(e => ({ legId: leg.id, results: [], meta: {}, err: e.message }))
    ));
    const map = {};
    searches.forEach(({ legId, results }) => { map[legId] = results; });
    setLegResults(map);
    setSearchMeta(searches[0]?.meta || {});
    setStep("results");
    if (searches.every(s => !s.results.length)) setSearchErr("No flights found for one or more legs.");
   } catch(e) { setSearchErr(e.message); }
   finally { setSearching(false); }
  } else {
   if (!originSel || !destSel || !form.date) { setSearchErr("Select origin, destination and date"); return; }
   const today = new Date().toISOString().split("T")[0];
   if (form.date < today) { setSearchErr("Departure date cannot be in the past"); return; }
   if (tripType === "roundtrip" && !form.returnDate) { setSearchErr("Select a return date for round trip"); return; }
   if (tripType === "roundtrip" && form.returnDate <= form.date) { setSearchErr("Return date must be after departure date"); return; }
   setSearching(true); setResults([]); setReturnResults([]);
   try {
    const data = await API("POST", "/api/flights/search", {
     origin: originSel.iataCode, destination: destSel.iataCode,
     date: form.date, returnDate: tripType === "roundtrip" ? form.returnDate : undefined,
     adults: form.adults, children: form.children||0, infants: form.infants||0, travelClass: form.travelClass, nonStop: form.nonStop, max: 20,
    });
    const all = data.data || [];
    setResults(all.filter(r => r._leg !== "return"));
    setReturnResults(all.filter(r => r._leg === "return"));
    setSearchMeta(data.meta || {});
    setResultTab("outbound");
    setStep("results");
    if (!all.length) {
     // Only show errors from APIs that were actually configured/active
     const activeErrors = Object.entries(data.errors||{})
      .filter(([src, msg]) => msg && data.meta?.sources?.[src])
      .map(([, msg]) => msg);
     setSearchErr(activeErrors.join(" · ") || "No flights found for this route and date.");
    }
   } catch(e) { setSearchErr(e.message); }
   finally { setSearching(false); }
  }
 };

 const doImport = (offer, { legObj=null, isReturn=false, keepOpen=false }={}) => {
  const segs = offer.itineraries?.[0]?.segments||[];
  const seg0 = segs[0]; const segL = segs[segs.length-1];
  if (!seg0) return;
  const airlineName = offer.dictionaries?.carriers?.[seg0.carrierCode]||seg0.carrierCode||"";
  const from = legObj ? (legObj.originSel?.cityName||legObj.originSel?.name||legObj.originSel?.iataCode||"")
              : isReturn ? (destSel?.cityName||destSel?.name||destSel?.iataCode||"")
              : (originSel?.cityName||originSel?.name||originSel?.iataCode||"");
  const to   = legObj ? (legObj.destSel?.cityName||legObj.destSel?.name||legObj.destSel?.iataCode||"")
              : isReturn ? (originSel?.cityName||originSel?.name||originSel?.iataCode||"")
              : (destSel?.cityName||destSel?.name||destSel?.iataCode||"");
  onImport({
   from, to,
   date:     seg0.departure?.at?.substring(0,10)||form.date,
   airline:  airlineName,
   flight_no:`${seg0.carrierCode}${seg0.number}`,
   departure:seg0.departure?.at?.substring(11,16)||"",
   arrival:  segL?.arrival?.at?.substring(11,16)||"",
   class:    ({ECONOMY:"Economy",PREMIUM_ECONOMY:"Prem. Economy",BUSINESS:"Business",FIRST:"First"})[form.travelClass]||"Economy",
   cost:     Math.round(Number(offer.price?.grandTotal||0)),
  });
  toast$ && toast$("Flight imported to itinerary");
  if (!keepOpen) onClose();
 };

 const doBook = async (offer) => {
  setPricedOffer(null); setPriceErr(""); setBookingErr(""); setBooking(null); setPricing(true);
  setReviewConditions({}); setFareAlerts([]);
  try {
   const data = await API("POST", "/api/flights/price", { flightOffer:offer });
   const priced = data.data?.flightOffers?.[0]||offer;
   const conditions = data.data?._conditions || priced._conditions || {};
   const alerts = data.data?._alerts || [];
   setPricedOffer(priced);
   setReviewConditions(conditions);
   setFareAlerts(alerts);
   const mkPax = (paxType, count, offset=0) => Array.from({length:Number(count)||0},(_,i)=>({
    id: String(offset+i+1), paxType, firstName:"", lastName:"", dob:"", gender:"MALE",
    passportNo:"", passportExpiry:"", nationality:"IN", phone:"", email:"",
   }));
   setPassengers([
    ...mkPax("ADULT",   form.adults,   0),
    ...mkPax("CHILD",   form.children||0, Number(form.adults)),
    ...mkPax("INFANT",  form.infants||0,  Number(form.adults)+(Number(form.children)||0)),
   ]);
   setStep("book");
  } catch(e) { setPriceErr(e.message); }
  finally { setPricing(false); }
 };

 const updPax = (idx,f,v) => setPassengers(prev=>prev.map((p,i)=>i===idx?{...p,[f]:v}:p));

 const submitBooking = async () => {
  const passportMandatory = reviewConditions?.pm || pricedOffer?._conditions?.pm;
  const missing = passengers.find(p => {
   if (!p.firstName) return true;
   if (!p.dob) return true;                           // TripJack requires DOB for all pax
   if (passportMandatory && (!p.passportNo || !p.passportExpiry)) return true;
   return false;
  });
  if (missing) {
   const passportNote = passportMandatory ? ", passport number and expiry" : "";
   setBookingErr(`All passengers need: first name, date of birth${passportNote}`);
   return;
  }
  setBookingLoading(true); setBookingErr("");
  try {
   const travelers = passengers.map(p=>{
    const fN = p.firstName.trim().toUpperCase();
    const lN = (p.lastName||"").trim().toUpperCase() || fN;  // TripJack requires non-empty lN
    return {
     id: p.id,
     pt: p.paxType || "ADULT",
     dateOfBirth: p.dob,
     name: { firstName: fN, lastName: lN },
     gender: p.gender,
     contact: { emailAddress: p.email||"noreply@safarnaama.com", phones: p.phone ? [{ deviceType:"MOBILE", countryCallingCode:"91", number: p.phone.replace(/^\+?91/,"").replace(/\D/g,"") }] : [] },
     documents: p.passportNo ? [{ documentType:"PASSPORT", number:p.passportNo, expiryDate:p.passportExpiry, issuanceCountry:p.nationality||"IN", validityCountry:p.nationality||"IN", nationality:p.nationality||"IN", holder:true }] : [],
    };
   });
   const data = await API("POST", "/api/flights/book", { flightOffer:pricedOffer, travelers });
   setBooking(data.data);
   setStep("confirmed");
  } catch(e) {
   // Show the actual TripJack error if present
   const detail = e._detail?.status?.message || e._detail?.message || e.message;
   setBookingErr(detail);
  }
  finally { setBookingLoading(false); }
 };

 const reset = () => { setStep("search"); setResults([]); setReturnResults([]); setLegResults({}); setResultTab("outbound"); setSearchErr(""); setSearchMeta({}); setPriceErr(""); setPricedOffer(null); setBooking(null); setReviewConditions({}); setFareAlerts([]); };
 const fmtDur = iso => { if(!iso) return ""; const h=iso.match(/(\d+)H/)?.[1]||"0", m=iso.match(/(\d+)M/)?.[1]||"0"; return `${h}h ${m}m`; };
 const todayStr = new Date().toISOString().split("T")[0];

 if (!open) return null;
 return (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
   <div style={{background:"#FFFFFF",borderRadius:16,width:"100%",maxWidth:920,maxHeight:"93vh",overflow:"auto",boxShadow:"0 30px 70px rgba(0,0,0,.6)"}}>

    <div style={{padding:"16px 22px",borderBottom:"1px solid #D5E1EE",display:"flex",justifyContent:"space-between",alignItems:"center",background:"linear-gradient(135deg,#1A6B8A,#0D4D6B)",borderRadius:"16px 16px 0 0",position:"sticky",top:0,zIndex:10}}>
     <div style={{display:"flex",alignItems:"center",gap:10}}>
      <Icon name="flight" size={20}/>
      <h3 style={{margin:0,color:"#fff",fontSize:15,fontFamily:"'Playfair Display',serif"}}>Flight Search & Book</h3>
      {step!=="search" && <span onClick={reset} style={{background:"rgba(255,255,255,.2)",color:"#fff",fontSize:11,padding:"2px 10px",borderRadius:10,cursor:"pointer",marginLeft:8}}>← New Search</span>}
     </div>
     <div style={{display:"flex",gap:8,alignItems:"center"}}>
      <button onClick={toggleUat} title="Toggle UAT log capture" style={{background: uatMode ? "rgba(34,197,94,.35)" : "rgba(255,255,255,.15)", border: uatMode ? "1px solid rgba(34,197,94,.6)" : "1px solid rgba(255,255,255,.25)", color:"#fff", cursor:"pointer", padding:"4px 10px", borderRadius:6, fontSize:11, display:"flex", alignItems:"center", gap:5}}>
       <span style={{width:7,height:7,borderRadius:"50%",background: uatMode ? "#4ade80" : "rgba(255,255,255,.5)",display:"inline-block"}}/>
       {uatMode ? "UAT ON" : "UAT OFF"}
      </button>
      <button onClick={onClose} style={{background:"rgba(255,255,255,.2)",border:"none",color:"#fff",cursor:"pointer",padding:"5px 10px",borderRadius:6,fontSize:12}}>✕ Close</button>
     </div>
    </div>

    <div style={{padding:22}}>
    {/* ─── SEARCH ─── */}
    {step==="search" && (
     <div>
      {/* Trip type tabs */}
      <div style={{display:"flex",gap:4,marginBottom:18,background:"#F1F5F9",borderRadius:10,padding:4}}>
       {[["oneway","One Way"],["roundtrip","Round Trip"],["multicity","Multi City"]].map(([val,lbl])=>(
        <button key={val} onClick={()=>setTripType(val)}
         style={{flex:1,padding:"8px 0",border:"none",borderRadius:7,fontSize:12,fontWeight:600,cursor:"pointer",
          background:tripType===val?"#1A6B8A":"transparent",color:tripType===val?"#fff":"#475569",transition:"all .15s"}}>
         {lbl}
        </button>
       ))}
      </div>

      {/* One Way / Round Trip */}
      {tripType!=="multicity" && (<>
       <div style={{display:"grid",gridTemplateColumns:"1fr 36px 1fr",gap:8,marginBottom:12,alignItems:"end"}}>
        <div style={{position:"relative"}} ref={originRef}>
         <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>From (Origin) *</div>
         {originSel
          ? <div style={{border:"1px solid #D5E1EE",borderRadius:8,padding:"9px 13px",background:"#F8FAFC",fontSize:13,display:"flex",alignItems:"center",gap:8}}>
             <span style={{fontWeight:800,color:"#1A6B8A",minWidth:36}}>{originSel.iataCode}</span>
             <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{originSel.cityName||originSel.name}</span>
             <span onClick={()=>setOriginSel(null)} style={{color:"#94A3B8",fontSize:16,cursor:"pointer",flexShrink:0}}>✕</span>
            </div>
          : <Inp placeholder="City or airport (e.g. DEL, Mumbai)" value={originQ} onChange={e=>handleOriginQ(e.target.value)} autoComplete="off"/>
         }
         {originOpts.length>0 && !originSel && (
          <div style={fixedDropStyle(originRef)}>
           {originOpts.map(o=><AptItem key={o.id||o.iataCode} o={o} onClick={()=>{setOriginSel(o);setOriginQ("");setOriginOpts([]);}}/>)}
          </div>
         )}
        </div>
        <button onClick={swapLocations} title="Swap"
         style={{height:38,background:"#EEF3F9",border:"1px solid #D5E1EE",borderRadius:8,cursor:"pointer",
          fontSize:18,color:"#1A6B8A",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",alignSelf:"flex-end"}}>
         ⇄
        </button>
        <div style={{position:"relative"}} ref={destRef}>
         <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>To (Destination) *</div>
         {destSel
          ? <div style={{border:"1px solid #D5E1EE",borderRadius:8,padding:"9px 13px",background:"#F8FAFC",fontSize:13,display:"flex",alignItems:"center",gap:8}}>
             <span style={{fontWeight:800,color:"#1A6B8A",minWidth:36}}>{destSel.iataCode}</span>
             <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{destSel.cityName||destSel.name}</span>
             <span onClick={()=>setDestSel(null)} style={{color:"#94A3B8",fontSize:16,cursor:"pointer",flexShrink:0}}>✕</span>
            </div>
          : <Inp placeholder="City or airport (e.g. BOM, Delhi)" value={destQ} onChange={e=>handleDestQ(e.target.value)} autoComplete="off"/>
         }
         {destOpts.length>0 && !destSel && (
          <div style={fixedDropStyle(destRef)}>
           {destOpts.map(o=><AptItem key={o.id||o.iataCode} o={o} onClick={()=>{setDestSel(o);setDestQ("");setDestOpts([]);}}/>)}
          </div>
         )}
        </div>
       </div>
       <div style={{display:"grid",gridTemplateColumns:tripType==="roundtrip"?"repeat(3,1fr) repeat(3,1fr)":"repeat(2,1fr) repeat(3,1fr)",gap:12,marginBottom:14}}>
        <div style={{gridColumn:tripType==="roundtrip"?"span 2":"span 1"}}>
         <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Departure *</div>
         <Inp type="date" value={form.date} min={todayStr}
          onChange={e=>setForm(p=>({...p,date:e.target.value,returnDate:p.returnDate&&p.returnDate<=e.target.value?"":p.returnDate}))}/>
        </div>
        {tripType==="roundtrip" && <div style={{gridColumn:"span 2"}}>
         <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Return Date *</div>
         <Inp type="date" value={form.returnDate} min={form.date||todayStr}
          onChange={e=>setForm(p=>({...p,returnDate:e.target.value}))}/>
        </div>}
        <div>
         <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Adults</div>
         <Inp type="number" min={1} max={9} value={form.adults} onChange={e=>setForm(p=>({...p,adults:Number(e.target.value)}))}/>
        </div>
        <div>
         <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Children (2–12)</div>
         <Inp type="number" min={0} max={8} value={form.children||0} onChange={e=>setForm(p=>({...p,children:Number(e.target.value)}))}/>
        </div>
        <div>
         <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Infants (0–2)</div>
         <Inp type="number" min={0} max={form.adults||1} value={form.infants||0} onChange={e=>setForm(p=>({...p,infants:Number(e.target.value)}))}/>
        </div>
       </div>
       <div style={{marginBottom:14}}>
        <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Travel Class</div>
        <Sel value={form.travelClass} onChange={e=>setForm(p=>({...p,travelClass:e.target.value}))}>
         <option value="ECONOMY">Economy</option>
         <option value="PREMIUM_ECONOMY">Premium Economy</option>
         <option value="BUSINESS">Business</option>
         <option value="FIRST">First Class</option>
        </Sel>
       </div>
      </>)}

      {/* Multi City */}
      {tripType==="multicity" && (
       <div style={{marginBottom:12}}>
        {legs.map((leg,idx)=>(
         <div key={leg.id} style={{border:"1px solid #E6ECF5",borderRadius:10,padding:12,marginBottom:8,background:"#FAFCFF"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
           <div style={{fontSize:11,fontWeight:700,color:"#1A6B8A",textTransform:"uppercase",letterSpacing:.5}}>Leg {idx+1}</div>
           {legs.length>2 && <button onClick={()=>removeLeg(leg.id)} style={{border:"none",background:"none",color:"#DC2626",fontSize:12,cursor:"pointer",fontWeight:600}}>✕ Remove</button>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
           <div style={{position:"relative"}} ref={el=>{if(el)legOriginRefs.current[leg.id]=el;else delete legOriginRefs.current[leg.id];}}>
            <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>From *</div>
            {leg.originSel
             ? <div style={{border:"1px solid #D5E1EE",borderRadius:8,padding:"7px 10px",background:"#F8FAFC",fontSize:12,display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontWeight:800,color:"#1A6B8A"}}>{leg.originSel.iataCode}</span>
                <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{leg.originSel.cityName||leg.originSel.name}</span>
                <span onClick={()=>updLeg(leg.id,"originSel",null)} style={{color:"#94A3B8",fontSize:13,cursor:"pointer"}}>✕</span>
               </div>
             : <Inp placeholder="Origin…" value={leg.originQ} onChange={e=>{updLeg(leg.id,"originQ",e.target.value);clearTimeout(legTimers.current[leg.id+"o"]);legTimers.current[leg.id+"o"]=setTimeout(()=>API("GET",`/api/flights/airports?q=${encodeURIComponent(e.target.value)}`).then(d=>updLeg(leg.id,"originOpts",d.data||[])).catch(()=>{}),350);}} autoComplete="off"/>
            }
            {(leg.originOpts||[]).length>0 && !leg.originSel && (
             <div style={fixedDropStyle({current:legOriginRefs.current[leg.id]})}>
              {(leg.originOpts||[]).map(o=><AptItem key={o.id||o.iataCode} o={o} onClick={()=>{updLeg(leg.id,"originSel",o);updLeg(leg.id,"originQ","");updLeg(leg.id,"originOpts",[]);}}/>)}
             </div>
            )}
           </div>
           <div style={{position:"relative"}} ref={el=>{if(el)legDestRefs.current[leg.id]=el;else delete legDestRefs.current[leg.id];}}>
            <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>To *</div>
            {leg.destSel
             ? <div style={{border:"1px solid #D5E1EE",borderRadius:8,padding:"7px 10px",background:"#F8FAFC",fontSize:12,display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontWeight:800,color:"#1A6B8A"}}>{leg.destSel.iataCode}</span>
                <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{leg.destSel.cityName||leg.destSel.name}</span>
                <span onClick={()=>updLeg(leg.id,"destSel",null)} style={{color:"#94A3B8",fontSize:13,cursor:"pointer"}}>✕</span>
               </div>
             : <Inp placeholder="Destination…" value={leg.destQ} onChange={e=>{updLeg(leg.id,"destQ",e.target.value);clearTimeout(legTimers.current[leg.id+"d"]);legTimers.current[leg.id+"d"]=setTimeout(()=>API("GET",`/api/flights/airports?q=${encodeURIComponent(e.target.value)}`).then(d=>updLeg(leg.id,"destOpts",d.data||[])).catch(()=>{}),350);}} autoComplete="off"/>
            }
            {(leg.destOpts||[]).length>0 && !leg.destSel && (
             <div style={fixedDropStyle({current:legDestRefs.current[leg.id]})}>
              {(leg.destOpts||[]).map(o=><AptItem key={o.id||o.iataCode} o={o} onClick={()=>{updLeg(leg.id,"destSel",o);updLeg(leg.id,"destQ","");updLeg(leg.id,"destOpts",[]);}}/>)}
             </div>
            )}
           </div>
           <div>
            <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Date *</div>
            <Inp type="date" value={leg.date} min={new Date().toISOString().split("T")[0]} onChange={e=>updLeg(leg.id,"date",e.target.value)}/>
           </div>
          </div>
         </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:12}}>
         {legs.length<4 && <button onClick={addLeg} style={{border:"1px dashed #1A6B8A",background:"none",color:"#1A6B8A",padding:"6px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>+ Add Leg</button>}
         <div style={{display:"flex",gap:10,marginLeft:"auto",flexWrap:"wrap"}}>
          <div>
           <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Adults</div>
           <Inp type="number" min={1} max={9} value={form.adults} onChange={e=>setForm(p=>({...p,adults:Number(e.target.value)}))} style={{width:68}}/>
          </div>
          <div>
           <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Children</div>
           <Inp type="number" min={0} max={8} value={form.children||0} onChange={e=>setForm(p=>({...p,children:Number(e.target.value)}))} style={{width:68}}/>
          </div>
          <div>
           <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Infants</div>
           <Inp type="number" min={0} max={form.adults||1} value={form.infants||0} onChange={e=>setForm(p=>({...p,infants:Number(e.target.value)}))} style={{width:68}}/>
          </div>
          <div>
           <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Class</div>
           <Sel value={form.travelClass} onChange={e=>setForm(p=>({...p,travelClass:e.target.value}))}>
            <option value="ECONOMY">Economy</option>
            <option value="PREMIUM_ECONOMY">Premium</option>
            <option value="BUSINESS">Business</option>
            <option value="FIRST">First</option>
           </Sel>
          </div>
         </div>
        </div>
       </div>
      )}

      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
       <input type="checkbox" id="fsNonStop" checked={form.nonStop} onChange={e=>setForm(p=>({...p,nonStop:e.target.checked}))}/>
       <label htmlFor="fsNonStop" style={{fontSize:13,color:"#475569",cursor:"pointer"}}>Non-stop flights only</label>
      </div>
      {searchErr && <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#B91C1C",marginBottom:12}}>{searchErr}</div>}
      <Btn v="primary" icon="flight" onClick={doSearch} spin={searching} s={{width:"100%",justifyContent:"center",padding:"11px 0",fontSize:14}}>
       {searching?"Searching…":"Search Flights"}
      </Btn>
     </div>
    )}

    {/* ─── RESULTS ─── */}
    {step==="results" && (
     <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
       <div style={{fontSize:13,color:"#475569"}}>
        {tripType==="multicity"
         ? `Multi-city · ${legs.filter(l=>l.originSel&&l.destSel).map(l=>`${l.originSel.iataCode}→${l.destSel.iataCode}`).join(" · ")}`
         : `${results.length+returnResults.length} flight${(results.length+returnResults.length)!==1?"s":""} found · ${originSel?.iataCode} → ${destSel?.iataCode}${tripType==="roundtrip"?` · Return: ${form.returnDate}`:""}`}
        {searchMeta?.sources && <span style={{marginLeft:10,fontSize:11,color:"#94A3B8"}}>
         ({[searchMeta.sources.amadeus&&"Amadeus",searchMeta.sources.tripjack&&"TripJack"].filter(Boolean).join(" + ")})
        </span>}
       </div>
       {priceErr && <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#B91C1C"}}>{priceErr}</div>}
      </div>
      {searchErr && <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#B91C1C",marginBottom:12}}>{searchErr}</div>}

      {/* helper to render a single flight card */}
      {(() => {
       const FlightCard = ({ offer, onImportClick, label }) => {
        const it0 = offer.itineraries?.[0];
        const segs = it0?.segments||[];
        const seg0 = segs[0]; const segL = segs[segs.length-1];
        const airlineName = offer.dictionaries?.carriers?.[seg0?.carrierCode]||seg0?.carrierCode||"—";
        const stops = segs.length-1;
        const price = Number(offer.price?.grandTotal||0);
        const dur = fmtDur(it0?.duration);
        const isTJ = offer._source==="tripjack";
        return (
         <div style={{border:"1px solid #E6ECF5",borderRadius:12,padding:"14px 16px",marginBottom:10,background:"#FAFCFF"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
           <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
             <div style={{fontWeight:700,fontSize:14,color:"#1A6B8A"}}>{airlineName}</div>
             <span style={{fontSize:11,color:"#94A3B8"}}>{seg0?.carrierCode}{seg0?.number}</span>
             {stops===0 && <span style={{background:"#D1FAE5",color:"#065F46",fontSize:10,padding:"2px 8px",borderRadius:8,fontWeight:700}}>Non-stop</span>}
             {stops>0  && <span style={{background:"#FEF3C7",color:"#92400E",fontSize:10,padding:"2px 8px",borderRadius:8,fontWeight:700}}>{stops} stop{stops>1?"s":""}</span>}
             <span style={{background:isTJ?"#FFF3E0":"#E3F2FD",color:isTJ?"#E65100":"#0D47A1",fontSize:10,padding:"2px 7px",borderRadius:6,fontWeight:700}}>{isTJ?"TripJack":"Amadeus"}</span>
             {label && <span style={{background:"#EDE9FE",color:"#5B21B6",fontSize:10,padding:"2px 7px",borderRadius:6,fontWeight:700}}>{label}</span>}
             <span style={{fontSize:11,color:"#64748B",marginLeft:"auto"}}>{dur}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:12,fontSize:13}}>
             <div style={{textAlign:"center"}}>
              <div style={{fontWeight:800,fontSize:17}}>{seg0?.departure?.at?.substring(11,16)||"—"}</div>
              <div style={{color:"#64748B",fontSize:11}}>{seg0?.departure?.iataCode}</div>
             </div>
             <div style={{flex:1,textAlign:"center",color:"#94A3B8",fontSize:12}}>─────────→</div>
             <div style={{textAlign:"center"}}>
              <div style={{fontWeight:800,fontSize:17}}>{segL?.arrival?.at?.substring(11,16)||"—"}</div>
              <div style={{color:"#64748B",fontSize:11}}>{segL?.arrival?.iataCode}</div>
             </div>
            </div>
           </div>
           <div style={{textAlign:"right",minWidth:130,paddingLeft:16,borderLeft:"1px solid #E6ECF5"}}>
            <div style={{fontWeight:800,fontSize:18,color:"#0F172A"}}>₹{price.toLocaleString("en-IN")}</div>
            <div style={{fontSize:10,color:"#94A3B8",marginBottom:10}}>per person · INR</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
             <Btn v="primary" s={{fontSize:11,padding:"5px 12px",width:"100%",justifyContent:"center"}} onClick={onImportClick} icon="flight">Import</Btn>
             <Btn v="secondary" s={{fontSize:11,padding:"5px 12px",width:"100%",justifyContent:"center",color:"#1A6B8A"}} spin={pricing} onClick={()=>doBook(offer)}>Book Now</Btn>
            </div>
           </div>
          </div>
         </div>
        );
       };

       /* Multi-city: one section per leg */
       if (tripType==="multicity") {
        const validLegs = legs.filter(l=>l.originSel&&l.destSel&&l.date);
        return validLegs.map((leg,idx)=>{
         const legOffers = legResults[leg.id]||[];
         return (
          <div key={leg.id} style={{marginBottom:20}}>
           <div style={{fontWeight:700,fontSize:13,color:"#1A6B8A",marginBottom:10,padding:"6px 10px",background:"#EEF3F9",borderRadius:8}}>
            Leg {idx+1}: {leg.originSel.iataCode} → {leg.destSel.iataCode} · {leg.date}
            <span style={{fontWeight:400,fontSize:11,color:"#64748B",marginLeft:8}}>({legOffers.length} option{legOffers.length!==1?"s":""})</span>
           </div>
           {legOffers.length===0 && <div style={{color:"#94A3B8",fontSize:13,padding:"10px 0"}}>No flights found for this leg.</div>}
           {legOffers.map((offer,oi)=>(
            <FlightCard key={oi} offer={offer} label={`Leg ${idx+1}`}
             onImportClick={()=>doImport(offer,{legObj:leg,keepOpen:true})}/>
           ))}
          </div>
         );
        });
       }

       /* Round trip: tabbed outbound / return */
       if (tripType==="roundtrip") {
        const tabs = [
         { key:"outbound", label:`✈ Outbound  ${originSel?.iataCode} → ${destSel?.iataCode}`, count:results.length, color:"#1A6B8A", bg:"#EEF3F9" },
         { key:"return",   label:`✈ Return  ${destSel?.iataCode} → ${originSel?.iataCode}`,   count:returnResults.length, color:"#059669", bg:"#ECFDF5" },
        ];
        return (<>
         <div style={{display:"flex",gap:0,marginBottom:16,borderRadius:10,overflow:"hidden",border:"1px solid #D5E1EE"}}>
          {tabs.map(t=>(
           <button key={t.key} onClick={()=>setResultTab(t.key)}
            style={{flex:1,padding:"10px 12px",border:"none",cursor:"pointer",fontWeight:700,fontSize:12,transition:"all .15s",
             background:resultTab===t.key?t.color:"#F8FAFC",color:resultTab===t.key?"#fff":t.color,
             borderRight:t.key==="outbound"?"1px solid #D5E1EE":"none"}}>
            {t.label}
            <span style={{marginLeft:8,fontWeight:400,fontSize:11,opacity:.85}}>({t.count} option{t.count!==1?"s":""})</span>
           </button>
          ))}
         </div>
         {resultTab==="outbound" && (
          results.length===0
           ? <div style={{color:"#94A3B8",fontSize:13,textAlign:"center",padding:"20px 0"}}>No outbound flights found.</div>
           : results.map((offer,oi)=>(
              <FlightCard key={oi} offer={offer} label="Outbound"
               onImportClick={()=>doImport(offer,{keepOpen:returnResults.length>0})}/>
             ))
         )}
         {resultTab==="return" && (
          returnResults.length===0
           ? <div style={{background:"#FFFBEB",border:"1px solid #FCD34D",borderRadius:8,padding:"12px 16px",fontSize:12,color:"#92400E"}}>
              No return flights found from TripJack. Use the swap ⇄ button on the search page and run a new search.
             </div>
           : returnResults.map((offer,oi)=>(
              <FlightCard key={oi} offer={offer} label="Return"
               onImportClick={()=>doImport(offer,{isReturn:true,keepOpen:false})}/>
             ))
         )}
        </>);
       }

       /* One way */
       return results.map((offer,oi)=>(
        <FlightCard key={oi} offer={offer}
         onImportClick={()=>doImport(offer)}/>
       ));
      })()}
     </div>
    )}

    {/* ─── BOOKING FORM ─── */}
    {step==="book" && pricedOffer && (
     <div>
      <div style={{background:"#F0FDF4",border:"1px solid #10B981",borderRadius:10,padding:"12px 16px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
       <div>
        <div style={{fontWeight:700,fontSize:13,color:"#065F46"}}>Price Confirmed{pricedOffer._source==="tripjack"?" — TripJack":""}</div>
        <div style={{fontSize:12,color:"#047857"}}>{pricedOffer.itineraries?.[0]?.segments?.[0]?.departure?.iataCode} → {pricedOffer.itineraries?.[0]?.segments?.[(pricedOffer.itineraries?.[0]?.segments?.length||1)-1]?.arrival?.iataCode}</div>
       </div>
       <div style={{fontWeight:800,fontSize:22,color:"#0F172A"}}>₹{Number(pricedOffer.price?.grandTotal||0).toLocaleString("en-IN")}</div>
      </div>
      {fareAlerts.length>0 && (
       <div style={{background:"#FFF8E1",border:"1px solid #F59E0B",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:13,color:"#92400E"}}>
        <strong>Fare Alert:</strong> The fare has changed from the original search price. Please confirm the new price above before booking.
       </div>
      )}
      {(() => {
       const passportReqd = reviewConditions?.pm || pricedOffer?._conditions?.pm;
       return passengers.map((p,i)=>{
        const paxLabel = {ADULT:"Adult",CHILD:"Child (2–12 yrs)",INFANT:"Infant (0–2 yrs)"}[p.paxType]||"Passenger";
        const paxCount = passengers.filter(x=>x.paxType===p.paxType).indexOf(p)+1;
        const dobReqd  = p.paxType==="INFANT" || reviewConditions?.[p.paxType==="ADULT"?"adobr":p.paxType==="CHILD"?"cdobr":"idobr"];
        return (
       <div key={i} style={{border:"1px solid #E6ECF5",borderRadius:12,padding:16,marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:"#1A6B8A",marginBottom:12,display:"flex",gap:8,alignItems:"center"}}>
         <span style={{background:p.paxType==="ADULT"?"#EEF3F9":p.paxType==="CHILD"?"#ECFDF5":"#FFF8E1",color:p.paxType==="ADULT"?"#1A6B8A":p.paxType==="CHILD"?"#065F46":"#92400E",fontSize:10,padding:"2px 8px",borderRadius:6,fontWeight:700}}>{paxLabel}</span>
         Passenger {i+1} of {passengers.length}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:8}}>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>First Name *</div>
          <Inp value={p.firstName} onChange={e=>updPax(i,"firstName",e.target.value)} placeholder="First Name"/>
         </div>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Last Name *</div>
          <Inp value={p.lastName} onChange={e=>updPax(i,"lastName",e.target.value)} placeholder="Last Name"/>
         </div>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Date of Birth {dobReqd?"*":"(optional)"}</div>
          <Inp type="date" value={p.dob} onChange={e=>updPax(i,"dob",e.target.value)}/>
         </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:8}}>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Gender *</div>
          <Sel value={p.gender} onChange={e=>updPax(i,"gender",e.target.value)}>
           <option value="MALE">Male</option><option value="FEMALE">Female</option>
          </Sel>
         </div>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Passport No {passportReqd?"*":"(if intl)"}</div>
          <Inp value={p.passportNo} onChange={e=>updPax(i,"passportNo",e.target.value.toUpperCase())} placeholder="A1234567"/>
         </div>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Passport Expiry {passportReqd?"*":"(if intl)"}</div>
          <Inp type="date" value={p.passportExpiry} onChange={e=>updPax(i,"passportExpiry",e.target.value)}/>
         </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Nationality (ISO 2)</div>
          <Inp value={p.nationality} onChange={e=>updPax(i,"nationality",e.target.value.toUpperCase())} placeholder="IN" style={{textTransform:"uppercase"}}/>
         </div>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Mobile {i===0?"*":""}</div>
          <Inp value={p.phone} onChange={e=>updPax(i,"phone",e.target.value)} placeholder="+91 98765 43210"/>
         </div>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Email {i===0?"*":""}</div>
          <Inp type="email" value={p.email} onChange={e=>updPax(i,"email",e.target.value)} placeholder="traveler@email.com"/>
         </div>
        </div>
       </div>
      );
     });
    })()}
      {bookingErr && <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#B91C1C",marginBottom:12}}>{bookingErr}</div>}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
       <Btn v="ghost" onClick={()=>setStep("results")}>← Back to Results</Btn>
       <Btn v="success" spin={bookingLoading} onClick={submitBooking} icon="flight">Confirm & Book</Btn>
      </div>
     </div>
    )}

    {/* ─── CONFIRMED ─── */}
    {step==="confirmed" && booking && (
     <div style={{textAlign:"center",padding:"24px 0"}}>
      <div style={{fontSize:52,marginBottom:12}}>✈️</div>
      <div style={{fontWeight:800,fontSize:22,color:"#065F46",marginBottom:8}}>
       {booking._source==="tripjack" ? "Booking Submitted!" : "Booking Confirmed!"}
      </div>
      <div style={{background:"#F0FDF4",border:"2px solid #10B981",borderRadius:12,padding:"16px 28px",marginBottom:16,display:"inline-block",minWidth:280}}>
       <div style={{fontSize:11,color:"#064E3B",textTransform:"uppercase",letterSpacing:.8,marginBottom:4}}>
        {booking._source==="tripjack" ? "TripJack Booking ID" : "Booking Reference"}
       </div>
       <div style={{fontSize:20,fontWeight:900,color:"#0F172A",letterSpacing:1,fontFamily:"monospace",wordBreak:"break-all"}}>{booking?.id||"—"}</div>
       {booking?.raw?.order?.status && (
        <div style={{fontSize:12,color:"#047857",marginTop:6}}>Status: <strong>{booking.raw.order.status}</strong></div>
       )}
       {booking?.associatedRecords?.[0]?.reference && (
        <div style={{fontSize:13,color:"#047857",marginTop:4}}>PNR: {booking.associatedRecords[0].reference}</div>
       )}
      </div>
      {booking._source==="tripjack" && (
       <div style={{background:"#FFF8E1",border:"1px solid #F59E0B",borderRadius:8,padding:"10px 16px",marginBottom:16,fontSize:12,color:"#78350F",maxWidth:420,margin:"0 auto 16px",textAlign:"left"}}>
        PNR and e-ticket will be sent to the passenger email within a few minutes. Use the Booking ID above to check status in your TripJack B2B dashboard.
       </div>
      )}
      {!booking._source && (
       <div style={{fontSize:13,color:"#475569",marginBottom:16}}>Booking confirmed with the airline. Check email for e-ticket.</div>
      )}
      <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:16}}>
       <Btn v="primary" icon="flight" onClick={()=>doImport(pricedOffer)}>Import to Itinerary</Btn>
       <Btn v="ghost" onClick={onClose}>Close</Btn>
      </div>
     </div>
    )}
    </div>
   </div>
  </div>
 );
}

// ─── HOTEL SEARCH & BOOK MODAL (TripJack) ────────────────────────────────────
function HotelSearchModal({ open, onClose, onImport, initCheckin="", initCheckout="", adults=2, toast$ }) {
 const [step, setStep] = useState("search");
 const [cityQ,    setCityQ]    = useState("");
 const [cityOpts, setCityOpts] = useState([]);
 const [citySel,  setCitySel]  = useState(null);
 const [form, setForm] = useState({ checkinDate:initCheckin, checkoutDate:initCheckout, adults:adults||2, children:0, rooms:1 });
 const [searching,   setSearching]   = useState(false);
 const [searchId,    setSearchId]    = useState("");
 const [hotels,      setHotels]      = useState([]);
 const [searchErr,   setSearchErr]   = useState("");
 const [selHotel,    setSelHotel]    = useState(null);
 const [roomsLoading,setRoomsLoading]= useState(false);
 const [roomOptions, setRoomOptions] = useState([]);
 const [roomsErr,    setRoomsErr]    = useState("");
 const [selRoom,     setSelRoom]     = useState(null);
 const [prebooking,  setPrebooking]  = useState(false);
 const [preBook,     setPreBook]     = useState(null);
 const [preBookErr,  setPreBookErr]  = useState("");
 const [guests, setGuests] = useState([{ firstName:"", lastName:"", age:30, type:"ADULT", email:"", phone:"" }]);
 const [booking,     setBooking]     = useState(null);
 const [bookingLoading,setBookingLoading]=useState(false);
 const [bookingErr,  setBookingErr]  = useState("");
 const cityTimer = useRef(null);

 const searchCities = q => {
  if (q.length < 2) { setCityOpts([]); return; }
  API("GET", `/api/hotels/cities?q=${encodeURIComponent(q)}`).then(d => setCityOpts(d.data||d.airports||[])).catch(()=>{});
 };
 const handleCityQ = q => { setCityQ(q); clearTimeout(cityTimer.current); cityTimer.current = setTimeout(()=>searchCities(q), 350); };

 const doSearch = async () => {
  if (!citySel || !form.checkinDate || !form.checkoutDate) { setSearchErr("Select city and dates"); return; }
  if (form.checkoutDate <= form.checkinDate) { setSearchErr("Check-out date must be after check-in date"); return; }
  setSearching(true); setSearchErr(""); setHotels([]);
  try {
   const data = await API("POST", "/api/hotels/search", {
    cityId:   citySel.cityId || form.manualCityId || null,
    cityName: citySel.cityName || citySel.name || null,
    checkinDate: form.checkinDate, checkoutDate: form.checkoutDate,
    adults: form.adults, children: form.children, rooms: form.rooms,
   });
   if (data?.errCode === "HMS_NOT_ACTIVATED") { setSearchErr("HMS_NOT_ACTIVATED"); return; }
   const result = data?.searchResult || data;
   setSearchId(result?.searchId || "");
   setHotels(result?.his || result?.hotels || []);
   setStep("hotels");
   if (!(result?.his || result?.hotels)?.length) setSearchErr("No hotels found. Try different dates or city.");
  } catch(e) {
   if (e.message?.includes("HMS_NOT_ACTIVATED") || e.message?.includes("not activated")) {
    setSearchErr("HMS_NOT_ACTIVATED");
   } else { setSearchErr(e.message); }
  }
  finally { setSearching(false); }
 };

 const loadRooms = async (hotel) => {
  setSelHotel(hotel); setRoomOptions([]); setSelRoom(null); setRoomsErr(""); setPreBook(null); setPreBookErr("");
  setRoomsLoading(true); setStep("rooms");
  try {
   const data = await API("POST", "/api/hotels/rooms", { hotelId: String(hotel.id), searchId });
   const rooms = data?.hotelRooms?.rooms || data?.rooms || [];
   setRoomOptions(rooms);
   if (!rooms.length) setRoomsErr("No rooms available for selected dates.");
  } catch(e) { setRoomsErr(e.message); }
  finally { setRoomsLoading(false); }
 };

 const doImport = (hotel, room) => {
  const nights = Math.max(1, Math.round((new Date(form.checkoutDate)-new Date(form.checkinDate))/(864e5)));
  const price = Number(room?.ops?.[0]?.totalPriceInfo?.totalFareDetail?.fC?.TF || room?.price || hotel?.minCost?.val || 0);
  onImport({
   name: hotel.name || "Hotel",
   destination: citySel?.cityName || citySel?.name || "",
   check_in: form.checkinDate, check_out: form.checkoutDate,
   nights, rating: hotel.rt || hotel.rating || 4,
   meals: room?.ops?.[0]?.mealPlan?.name || "Room Only",
   rooms: [{ room_type: room.name || "Standard", bedding:"", num_rooms: Number(form.rooms)||1, cost_per_room_night: Math.round(price/Math.max(1,nights)) }],
  });
  toast$ && toast$("Hotel imported to itinerary");
  onClose();
 };

 const doPreBook = async (hotel, room) => {
  setSelRoom(room); setPreBook(null); setPreBookErr(""); setPrebooking(true);
  const rateKey = room?.ops?.[0]?.rateKey || room?.rateKey || "";
  try {
   const data = await API("POST", "/api/hotels/prebook", {
    searchId, hotelId: String(hotel.id),
    rooms: [{ rateKey, occupancy:{ numberOfAdults:Number(form.adults)||2, numberOfChild:Number(form.children)||0 } }],
   });
   const pb = data?.preBookResult || data;
   setPreBook(pb);
   const paxCount = Number(form.adults)||2;
   setGuests(Array.from({length:paxCount},(_,i)=>({ firstName:"", lastName:"", age:30, type:"ADULT", email: i===0?"":"", phone: i===0?"":"" })));
   setStep("book");
  } catch(e) { setPreBookErr(e.message); }
  finally { setPrebooking(false); }
 };

 const updGuest = (i,f,v) => setGuests(prev=>prev.map((g,gi)=>gi===i?{...g,[f]:v}:g));

 const submitBooking = async () => {
  if (guests.some(g=>!g.firstName||!g.lastName)) { setBookingErr("Enter first and last name for all guests"); return; }
  setBookingLoading(true); setBookingErr("");
  try {
   const data = await API("POST", "/api/hotels/book", {
    bookingId: preBook?.bookingId || preBook?.id,
    guestDetails: {
     guest: guests.map(g=>({ firstName:g.firstName.toUpperCase(), lastName:g.lastName.toUpperCase(), age:Number(g.age)||30, type:g.type||"ADULT" })),
     specialRequests: "",
    },
    paymentInfo: { amount: Number(preBook?.totalAmount?.val||0), currency:"INR", mode:"ONLINE" },
   });
   setBooking(data?.bookingResult || data);
   setStep("confirmed");
  } catch(e) { setBookingErr(e.message); }
  finally { setBookingLoading(false); }
 };

 const reset = () => { setStep("search"); setHotels([]); setSearchErr(""); setRoomOptions([]); setSelHotel(null); setSelRoom(null); setPreBook(null); setBooking(null); };

 const nightCount = form.checkinDate && form.checkoutDate ? Math.max(1, Math.round((new Date(form.checkoutDate)-new Date(form.checkinDate))/(864e5))) : 1;
 const stars = n => "★".repeat(Math.round(n||0)) + "☆".repeat(Math.max(0,5-Math.round(n||0)));

 if (!open) return null;
 return (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
   <div style={{background:"#FFFFFF",borderRadius:16,width:"100%",maxWidth:920,maxHeight:"93vh",overflow:"auto",boxShadow:"0 30px 70px rgba(0,0,0,.6)"}}>
    <div style={{padding:"16px 22px",borderBottom:"1px solid #D5E1EE",display:"flex",justifyContent:"space-between",alignItems:"center",background:"linear-gradient(135deg,#0D5C6B,#083C47)",borderRadius:"16px 16px 0 0",position:"sticky",top:0,zIndex:10}}>
     <div style={{display:"flex",alignItems:"center",gap:10}}>
      <Icon name="hotel_star" size={20}/>
      <h3 style={{margin:0,color:"#fff",fontSize:15,fontFamily:"'Playfair Display',serif"}}>Hotel Search & Book — TripJack</h3>
      {step!=="search" && <span onClick={reset} style={{background:"rgba(255,255,255,.2)",color:"#fff",fontSize:11,padding:"2px 10px",borderRadius:10,cursor:"pointer",marginLeft:8}}>← New Search</span>}
      {step==="rooms" && selHotel && <span onClick={()=>setStep("hotels")} style={{background:"rgba(255,255,255,.15)",color:"#fff",fontSize:11,padding:"2px 10px",borderRadius:10,cursor:"pointer"}}>← Hotels</span>}
      {step==="book"  && <span onClick={()=>setStep("rooms")}  style={{background:"rgba(255,255,255,.15)",color:"#fff",fontSize:11,padding:"2px 10px",borderRadius:10,cursor:"pointer"}}>← Rooms</span>}
     </div>
     <button onClick={onClose} style={{background:"rgba(255,255,255,.2)",border:"none",color:"#fff",cursor:"pointer",padding:"5px 10px",borderRadius:6,fontSize:12}}>✕ Close</button>
    </div>

    <div style={{padding:22}}>

    {/* ─── SEARCH ─── */}
    {step==="search" && (
     <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 160px",gap:10,marginBottom:12}}>
       <div style={{position:"relative"}}>
        <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Destination City *</div>
        <Inp value={citySel ? (citySel.cityName||citySel.name||"") : cityQ}
         onChange={e=>{setCitySel(null);handleCityQ(e.target.value);}} placeholder="Search city (e.g. Delhi, Mumbai, Goa)…"/>
        {!citySel && cityOpts.length>0 && (
         <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:"1px solid #D5E1EE",borderRadius:8,zIndex:50,boxShadow:"0 8px 20px rgba(0,0,0,.12)",maxHeight:200,overflow:"auto"}}>
          {cityOpts.map((c,ci)=>(
           <div key={ci} onClick={()=>{setCitySel(c);setCityOpts([]);setCityQ("");}}
            style={{padding:"9px 13px",fontSize:13,cursor:"pointer",borderBottom:"1px solid #F1F5F9"}}
            onMouseEnter={e=>e.currentTarget.style.background="#EEF3F9"} onMouseLeave={e=>e.currentTarget.style.background=""}>
            <strong>{c.cityName||c.name}</strong>
            {c.cityId && <span style={{fontSize:10,background:"#D1FAE5",color:"#065F46",borderRadius:4,padding:"1px 5px",marginLeft:6}}>ID: {c.cityId}</span>}
            {c.countryName && <span style={{color:"#94A3B8",fontSize:11}}> · {c.countryName}</span>}
           </div>
          ))}
         </div>
        )}
       </div>
       <div>
        <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>TripJack City ID</div>
        <Inp value={citySel?.cityId||form.manualCityId||""} placeholder="e.g. 130443"
         onChange={e=>{
          setForm(p=>({...p,manualCityId:e.target.value}));
          if(citySel) setCitySel({...citySel,cityId:e.target.value});
         }}/>
       </div>
      </div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:16}}>
       <div>
        <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Check-in *</div>
        <Inp type="date" value={form.checkinDate} onChange={e=>setForm(p=>({...p,checkinDate:e.target.value,checkoutDate:p.checkoutDate&&p.checkoutDate<=e.target.value?"":p.checkoutDate}))}/>
       </div>
       <div>
        <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Check-out *</div>
        <Inp type="date" value={form.checkoutDate} min={form.checkinDate||undefined} onChange={e=>setForm(p=>({...p,checkoutDate:e.target.value}))}/>
       </div>
       <div>
        <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Adults / Room</div>
        <Inp type="number" min={1} max={4} value={form.adults} onChange={e=>setForm(p=>({...p,adults:Number(e.target.value)}))}/>
       </div>
       <div>
        <div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Rooms</div>
        <Inp type="number" min={1} max={5} value={form.rooms} onChange={e=>setForm(p=>({...p,rooms:Number(e.target.value)}))}/>
       </div>
      </div>
      {searchErr === "HMS_NOT_ACTIVATED" ? (
       <div style={{background:"#FFF7ED",border:"1px solid #FB923C",borderRadius:10,padding:"14px 16px",marginBottom:12}}>
        <div style={{fontWeight:700,color:"#C2410C",fontSize:13,marginBottom:8}}>⚠ TripJack Hotel Module Not Activated</div>
        <div style={{fontSize:12,color:"#7C2D12",lineHeight:1.7}}>
         The Hotel (HMS) module is not enabled for your TripJack API key. To activate it:
         <ol style={{margin:"8px 0 0 16px",padding:0}}>
          <li>Log into <strong>apitest.tripjack.com</strong> with your credentials<br/><span style={{color:"#92400E"}}>Login: operations@safarnaamaholidays.com</span></li>
          <li>Go to <strong>Settings → API Configuration</strong></li>
          <li>Enable the <strong>Hotel / HMS</strong> module</li>
          <li>Or email <strong>apitechsupport@tripjack.com</strong> with subject:<br/><em>"Enable Hotel API for account 312747 – SAFARNAAMA HOLIDAYS"</em></li>
         </ol>
        </div>
       </div>
      ) : searchErr ? (
       <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#B91C1C",marginBottom:12}}>{searchErr}</div>
      ) : null}
      <Btn v="primary" icon="hotel_star" onClick={doSearch} spin={searching} s={{width:"100%",justifyContent:"center",padding:"11px 0",fontSize:14}}>
       {searching?"Searching Hotels…":"Search Hotels"}
      </Btn>
     </div>
    )}

    {/* ─── HOTEL LIST ─── */}
    {step==="hotels" && (
     <div>
      <div style={{fontSize:13,color:"#475569",marginBottom:14}}>
       {hotels.length} hotel{hotels.length!==1?"s":""} found · {citySel?.cityName} · {form.checkinDate} → {form.checkoutDate} ({nightCount} night{nightCount!==1?"s":""})
      </div>
      {searchErr && <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#B91C1C",marginBottom:12}}>{searchErr}</div>}
      {hotels.map((h,hi)=>{
       const price = h.minCost?.val || h.minRate || 0;
       const img   = (h.img||h.images||[])[0];
       return (
        <div key={hi} style={{border:"1px solid #E6ECF5",borderRadius:12,marginBottom:10,overflow:"hidden",background:"#FAFCFF",display:"flex"}}>
         {img && <img src={img} alt={h.name} style={{width:120,height:100,objectFit:"cover",flexShrink:0}} onError={e=>e.target.style.display="none"}/>}
         <div style={{flex:1,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
           <div style={{fontWeight:700,fontSize:14,color:"#0F172A",marginBottom:4}}>{h.name||"Hotel"}</div>
           <div style={{fontSize:11,color:"#94A3B8",marginBottom:4}}>{stars(h.rt||h.rating||0)} {h.rt||h.rating||""}★</div>
           <div style={{fontSize:11,color:"#64748B"}}>{h.ad?.adr||h.address||""}{h.ad?.city?.name?` · ${h.ad.city.name}`:""}</div>
          </div>
          <div style={{textAlign:"right",paddingLeft:16}}>
           {price>0 && <div style={{fontWeight:800,fontSize:17,color:"#0F172A"}}>₹{Number(price).toLocaleString("en-IN")}</div>}
           {price>0 && <div style={{fontSize:10,color:"#94A3B8",marginBottom:10}}>per night from</div>}
           <Btn v="primary" s={{fontSize:11,padding:"6px 14px"}} onClick={()=>loadRooms(h)}>View Rooms</Btn>
          </div>
         </div>
        </div>
       );
      })}
     </div>
    )}

    {/* ─── ROOM LIST ─── */}
    {step==="rooms" && (
     <div>
      {selHotel && (
       <div style={{background:"#EEF3F9",borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
         <div style={{fontWeight:700,fontSize:14,color:"#0F172A"}}>{selHotel.name}</div>
         <div style={{fontSize:12,color:"#64748B"}}>{form.checkinDate} → {form.checkoutDate} · {nightCount} night{nightCount!==1?"s":""}</div>
        </div>
        <div style={{fontSize:12,color:"#64748B"}}>{stars(selHotel.rt||selHotel.rating||0)}</div>
       </div>
      )}
      {roomsLoading && <div style={{textAlign:"center",padding:32,color:"#64748B",fontSize:13}}>Loading rooms…</div>}
      {roomsErr && <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#B91C1C",marginBottom:12}}>{roomsErr}</div>}
      {preBookErr && <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#B91C1C",marginBottom:12}}>{preBookErr}</div>}
      {roomOptions.map((room,ri)=>{
       const op = room.ops?.[0] || {};
       const price = op?.totalPriceInfo?.totalFareDetail?.fC?.TF || room.price || 0;
       const meal  = op?.mealPlan?.name || room.mealPlan || "Room Only";
       const refundable = op?.refundable ?? room.refundable ?? true;
       return (
        <div key={ri} style={{border:"1px solid #E6ECF5",borderRadius:12,padding:"14px 16px",marginBottom:10,background:"#FAFCFF"}}>
         <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
           <div style={{fontWeight:700,fontSize:13,color:"#0F172A",marginBottom:4}}>{room.name||"Standard Room"}</div>
           <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <span style={{background:"#EFF6FF",color:"#1D4ED8",fontSize:10,padding:"2px 8px",borderRadius:6}}>{meal}</span>
            <span style={{background:refundable?"#F0FDF4":"#FEF2F2",color:refundable?"#065F46":"#B91C1C",fontSize:10,padding:"2px 8px",borderRadius:6}}>{refundable?"Refundable":"Non-refundable"}</span>
           </div>
          </div>
          <div style={{textAlign:"right",paddingLeft:16}}>
           {price>0 && <div style={{fontWeight:800,fontSize:17,color:"#0F172A"}}>₹{Number(price).toLocaleString("en-IN")}</div>}
           {price>0 && <div style={{fontSize:10,color:"#94A3B8",marginBottom:10}}>total · {nightCount}N</div>}
           <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <Btn v="primary" s={{fontSize:11,padding:"5px 12px",width:"100%",justifyContent:"center"}} onClick={()=>doImport(selHotel,room)} icon="hotel_star">Import</Btn>
            <Btn v="secondary" s={{fontSize:11,padding:"5px 12px",width:"100%",justifyContent:"center",color:"#1A6B8A"}} spin={prebooking} onClick={()=>doPreBook(selHotel,room)}>Book Now</Btn>
           </div>
          </div>
         </div>
        </div>
       );
      })}
     </div>
    )}

    {/* ─── GUEST FORM ─── */}
    {step==="book" && preBook && (
     <div>
      <div style={{background:"#F0FDF4",border:"1px solid #10B981",borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
       <div>
        <div style={{fontWeight:700,fontSize:13,color:"#065F46"}}>Price Confirmed</div>
        <div style={{fontSize:12,color:"#047857"}}>{selHotel?.name} · {nightCount} night{nightCount!==1?"s":""}</div>
       </div>
       <div style={{fontWeight:800,fontSize:22,color:"#0F172A"}}>₹{Number(preBook?.totalAmount?.val||preBook?.totalFare||0).toLocaleString("en-IN")}</div>
      </div>
      {guests.map((g,i)=>(
       <div key={i} style={{border:"1px solid #E6ECF5",borderRadius:12,padding:16,marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:"#1A6B8A",marginBottom:12}}>Guest {i+1}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:8}}>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>First Name *</div>
          <Inp value={g.firstName} onChange={e=>updGuest(i,"firstName",e.target.value)} placeholder="First Name"/>
         </div>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Last Name *</div>
          <Inp value={g.lastName} onChange={e=>updGuest(i,"lastName",e.target.value)} placeholder="Last Name"/>
         </div>
         <div>
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Age</div>
          <Inp type="number" min={1} max={99} value={g.age} onChange={e=>updGuest(i,"age",Number(e.target.value))}/>
         </div>
        </div>
        {i===0 && (
         <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
           <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Contact Email</div>
           <Inp type="email" value={g.email} onChange={e=>updGuest(i,"email",e.target.value)} placeholder="guest@email.com"/>
          </div>
          <div>
           <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Mobile</div>
           <Inp value={g.phone} onChange={e=>updGuest(i,"phone",e.target.value)} placeholder="+91 98765 43210"/>
          </div>
         </div>
        )}
       </div>
      ))}
      {bookingErr && <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#B91C1C",marginBottom:12}}>{bookingErr}</div>}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
       <Btn v="ghost" onClick={()=>setStep("rooms")}>← Back</Btn>
       <Btn v="success" spin={bookingLoading} onClick={submitBooking} icon="hotel_star">Confirm Booking</Btn>
      </div>
     </div>
    )}

    {/* ─── CONFIRMED ─── */}
    {step==="confirmed" && booking && (
     <div style={{textAlign:"center",padding:"24px 0"}}>
      <div style={{fontSize:52,marginBottom:12}}>🏨</div>
      <div style={{fontWeight:800,fontSize:22,color:"#065F46",marginBottom:8}}>Hotel Booked!</div>
      <div style={{background:"#F0FDF4",border:"2px solid #10B981",borderRadius:12,padding:"16px 28px",marginBottom:16,display:"inline-block",minWidth:280}}>
       <div style={{fontSize:11,color:"#064E3B",textTransform:"uppercase",letterSpacing:.8,marginBottom:4}}>Booking Confirmation</div>
       <div style={{fontSize:22,fontWeight:900,color:"#0F172A",letterSpacing:2,fontFamily:"monospace"}}>{booking?.bookingId||booking?.id||"—"}</div>
       {booking?.confirmationNumber && <div style={{fontSize:13,color:"#047857",marginTop:4}}>Conf#: {booking.confirmationNumber}</div>}
       {booking?.status && <div style={{fontSize:12,color:"#065F46",marginTop:4,textTransform:"uppercase",fontWeight:700}}>{booking.status}</div>}
      </div>
      <div style={{fontSize:13,color:"#475569",marginBottom:20}}>Booking confirmed with TripJack. Voucher will be sent to guest email.</div>
      <div style={{display:"flex",gap:10,justifyContent:"center"}}>
       <Btn v="primary" icon="hotel_star" onClick={()=>{ doImport(selHotel, selRoom); }}>Import to Itinerary</Btn>
       <Btn v="ghost" onClick={onClose}>Close</Btn>
      </div>
     </div>
    )}

    </div>
   </div>
  </div>
 );
}

const EMPTY_ITIN = {
 id:"", lead_id:"", lead_name:"", title:"", destination:"", city:"", start_date:"", end_date:"",
 pax:2, kids:0, tour_type:"", notes:"", special_instructions:"", status:"Draft", highlights:[],
 flights:[], hotels:[], days:[],
 inclusions:[], exclusions:[], markup_pct:22, selling_price:0,
 option2_enabled:false, option2_title:"Luxury Package", option1_title:"Standard Package",
 option2_hotels:[], option2_price:0, option2_inclusions:[], option2_exclusions:[],
};

const hotelsFrom = h => Array.isArray(h) ? h : (h && typeof h === "object" ? Object.values(h).flat() : []);

// ── Destination → cities mapping for day-level dropdowns ─────────────────────
// Maps multi-city itinerary destinations to their individual vendor destination keys
const DEST_VENDOR_KEYS = {
 "Europe - Paris & Switzerland": ["Paris","Switzerland"],
 "Europe - Greece":              ["Greece"],
 "Europe - Italy":               ["Italy"],
 "Varanasi & Rishikesh":         ["Varanasi","Rishikesh"],
 "Darjeeling & Sikkim":          ["Darjeeling"],
 "Golden Triangle":              ["Delhi","Agra","Rajasthan"],
 "Andaman Islands":              ["Andaman Islands","Andaman"],
};

function PageItinerary({ leads, itineraries, setItineraries, initData, setInitData, toast$, onRequestQuote, brand = {}, quotes = [], bizSettings = {}, setBizSettings, refData, refLoading, refreshRef, onPreview, vendors = [], mediaData = [], refreshMedia, onEmailItin, onWhatsAppItin }) {
 // Fetch special instructions directly (bypasses refData localStorage cache)
 const [siCatalog, setSiCatalog] = useState([]);
 useEffect(() => {
  fetch("/api/special-instructions")
   .then(r => r.ok ? r.json() : [])
   .then(d => { if (Array.isArray(d)) setSiCatalog(d); })
   .catch(() => {});
 }, []); // eslint-disable-line react-hooks/exhaustive-deps
 // Fetch bedding types directly from DB
 const [beddingTypes, setBeddingTypes] = useState([]);
 useEffect(() => {
  fetch("/api/bedding-types")
   .then(r => r.ok ? r.json() : [])
   .then(d => { if (Array.isArray(d)) setBeddingTypes(d.map(x => x.name||x)); })
   .catch(() => {});
 }, []); // eslint-disable-line react-hooks/exhaustive-deps
 const addBeddingType = async (name) => {
  const t = name.trim(); if (!t) return;
  const r = await fetch("/api/bedding-types",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ name:t }) }).catch(()=>null);
  if (r?.ok) setBeddingTypes(prev => [...prev, t]);
 };
 const allDestinations  = [...(refData?.destinations||[]), ...(bizSettings.custom_destinations||[])];
 // Look up best image URL from media library for a property/hotel
 const findHotelImg = (name, dest) =>
  (name && mediaData.find(m => m.type==="property_photo" && m.vendor_name===name))?.url ||
  (dest  && mediaData.find(m => m.type==="property_photo" && m.destination===dest && m.is_featured))?.url ||
  (dest  && mediaData.find(m => m.type==="property_photo" && m.destination===dest))?.url || null;
 // Look up best destination photo from media library
 const findDestImg = dest =>
  (dest && mediaData.find(m => m.type==="destination_photo" && m.destination===dest && m.is_featured))?.url ||
  (dest && mediaData.find(m => m.type==="destination_photo" && m.destination===dest))?.url || null;
 // State for the per-hotel "add to media library" inline form
 // Key = hotel index; value = { open, title, url, category }
 const [addMediaState, setAddMediaState] = useState({});
 const updAddMedia = (idx, field, val) => setAddMediaState(p => ({ ...p, [idx]: { ...(p[idx]||{}), [field]: val } }));
 const [flightSearch, setFlightSearch] = useState({ open:false });
 const handleImportFlight = (flightData) => setItin(p => ({
  ...p,
  flights: [...(p.flights||[]), { id:`F${Date.now().toString().slice(-4)}`, ...flightData }],
 }));
 const [hotelSearch, setHotelSearch] = useState({ open:false });
 const handleImportHotel = (hotelData) => setItin(p => ({
  ...p,
  hotels: [...(p.hotels||[]), { id:`H${Date.now().toString().slice(-4)}`, ...hotelData }],
 }));
 const saveMediaEntry = async (idx, dest, vendorName) => {
  const m = addMediaState[idx] || {};
  if (!m.title || !m.url) { toast$ && toast$("Title and URL are required", "error"); return; }
  try {
   const res = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     title: m.title,
     type: "property_photo",
     category: m.category || "hotel_exterior",
     destination: dest || null,
     vendor_name: vendorName || null,
     url: m.url,
     thumbnail_url: m.url,
     source: "uploaded",
    }),
   });
   const json = await res.json().catch(() => ({}));
   if (!res.ok) {
    const msg = json.error || json.message || `HTTP ${res.status}`;
    console.error("[saveMediaEntry] API error:", msg);
    toast$ && toast$(`Save failed: ${msg}`, "error");
    return;
   }
   refreshMedia && refreshMedia(true);
   updHotel(idx, "image_url", m.url);
   setAddMediaState(p => ({ ...p, [idx]: { open: false, title:"", url:"", category:"hotel_exterior" } }));
   toast$ && toast$("Image saved to media library", "success");
  } catch(e) {
   console.error("[saveMediaEntry] fetch error:", e);
   toast$ && toast$(`Save failed: ${e.message}`, "error");
  }
 };
 const citiesFor        = dest => [...(refData?.destinations_cities?.[dest]||[]), ...(bizSettings.custom_cities?.[dest]||[])];
 const activitiesFor    = dest => [...(refData?.activities_by_destination?.[dest]||[]), ...(bizSettings.custom_activities?.[dest]||[])];
 const addCustomDest    = val  => setBizSettings && setBizSettings(p=>({...p, custom_destinations:[...new Set([...(p.custom_destinations||[]),val])]}));
 const addCustomCity    = (dest,city) => setBizSettings && setBizSettings(p=>({...p, custom_cities:{...(p.custom_cities||{}), [dest]:[...new Set([...(p.custom_cities?.[dest]||[]),city])]}}));
 const addCustomActivity= (dest,act)  => setBizSettings && setBizSettings(p=>({...p, custom_activities:{...(p.custom_activities||{}), [dest]:[...new Set([...(p.custom_activities?.[dest]||[]),act])]}}));
 const addToBizList     = (key,val)   => setBizSettings && setBizSettings(p=>({...p, [key]:[...new Set([...(p[key]||[]),val])]}));
 // Fuzzy-match a freetext lead destination to the nearest DB destination name.
 // Tries exact → case-insensitive contains in either direction → first word match → raw fallback.
 const matchDestination = raw => {
  if (!raw || !allDestinations.length) return raw || "";
  if (allDestinations.includes(raw)) return raw;
  const lo = raw.toLowerCase();
  return (
   allDestinations.find(d => d.toLowerCase() === lo) ||
   allDestinations.find(d => lo.includes(d.toLowerCase()) || d.toLowerCase().includes(lo)) ||
   allDestinations.find(d => d.toLowerCase().split(/[\s,&-]+/).some(w => w.length > 3 && lo.includes(w))) ||
   raw
  );
 };
 const itinStatuses   = bizSettings.itin_statuses || ["Draft","Confirmed","Sent","Archived"];
 const flightClasses  = refData?.flight_classes   || [];
 const mealPlans      = refData?.meal_plans        || [];
 const roomTypes      = refData?.room_types        || [];
 const effectiveBeddingTypes = [...new Set([...(refData?.bedding_types||[]), ...beddingTypes])];
 const airlinesList   = refData?.airlines          || [];
 const co = {
  name:    brand.companyName  || "Safarnaama Holidays",
  tagline: brand.tagline      || "Explore | Capture | Inspire",
  logo:    brand.logoUrl      || "",
  color:   brand.primaryColor || "#1A6B8A",
  email:   brand.contactEmail || "enquiry@safarnaama.com",
  phone:   brand.phone1 ? (brand.phone2 ? brand.phone1 + " | " + brand.phone2 : brand.phone1) : "",
  address: brand.address  || "",
  website: brand.website  || "",
  instagram: brand.instagram || "",
  facebook:  brand.facebook  || "",
  whatsapp:  brand.whatsapp  || "",
 };
 const [view, setView] = useState("list"); // "list" | "edit"
 const [itinSearch, setItinSearch] = useState("");
 const [itin, setItin] = useState(EMPTY_ITIN);
 const [tab, setTab] = useState("days");
 const [aiLoading, setAiLoading] = useState(false);
 const [imgErrors, setImgErrors] = useState({});
 const [vrModal, setVrModal] = useState(null); // vendor quote request modal
 const [vrStatus, setVrStatus] = useState([]); // employee-visible quote statuses for current lead
 const [vrSending, setVrSending] = useState(false);
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
    let imgs = null;
    try { imgs = JSON.parse(localStorage.getItem(`sfn_itin_imgs_${initData.id}`) || 'null'); } catch {}
    setItin({
     ...EMPTY_ITIN,
     ...initData,
     cover_image_url: imgs?.cover || initData.cover_image_url || "",
     flights: Array.isArray(initData.flights) ? initData.flights : [],
     hotels: hotelsFrom(initData.hotels).map((h, i) => ({ ...h, image_url: imgs?.hotels?.[i] || h.image_url || "" })),
     option2_hotels: hotelsFrom(initData.option2_hotels).map((h, i) => ({ ...h, image_url: imgs?.o2hotels?.[i] || h.image_url || "" })),
     days: Array.isArray(initData.days) ? initData.days.map((d, i) => ({ ...d, image_url: imgs?.days?.[i] || d.image_url || "" })) : [],
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
    title: `Day ${dayNum}`, destination: p.destination, location: p.city || p.destination,
    hotel: "", image_query: p.destination, show_banner: true,
    activities: [],
    meals: { breakfast: true, lunch: false, dinner: false },
    transfer: "",
    agent_notes: "",
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
  const act = { id:`A${Date.now().toString().slice(-5)}`, time:"09:00", type:"sightseeing", title:"", desc:"", cost:0, image_url:"" };
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
 const updActivityFields = (dayIdx, actIdx, updates) => setItin(p => ({
  ...p,
  days: p.days.map((d,i) => i!==dayIdx ? d : {
   ...d,
   activities: d.activities.map((a,ai) => ai!==actIdx ? a : { ...a, ...updates }),
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
 const EMPTY_ROOM = () => ({ room_type:"", bedding:"", num_rooms:1, cost_per_room_night:0 });
 const hotelCostPerNight = h => (h.rooms && h.rooms.length > 0)
  ? h.rooms.reduce((s,r) => s + (Number(r.num_rooms)||1)*(Number(r.cost_per_room_night)||0), 0)
  : (Number(h.cost_per_night)||0);
 const addHotel = () => setItin(p => ({
  ...p,
  hotels: [...(p.hotels||[]), { id:`H${Date.now().toString().slice(-4)}`, name:"", destination:p.destination||"", check_in:p.start_date||"", check_out:p.end_date||"", meals:"Breakfast", rating:4, nights:numDays, rooms:[EMPTY_ROOM()] }],
 }));
 const updHotel = (idx, field, val) => setItin(p => ({
  ...p, hotels: p.hotels.map((h,i) => i===idx ? { ...h, [field]: val } : h),
 }));
 const removeHotel = idx => setItin(p => ({ ...p, hotels: p.hotels.filter((_,i) => i!==idx) }));
 // Room-level CRUD within a hotel
 const getHotelRooms = h => (h.rooms && h.rooms.length > 0)
  ? h.rooms
  : [{ room_type: h.room_type||"", bedding:"", num_rooms:1, cost_per_room_night: Number(h.cost_per_night)||0 }];
 const addHotelRoom = hotelIdx => setItin(p => ({
  ...p, hotels: p.hotels.map((h,hi) => hi!==hotelIdx ? h : { ...h, rooms:[...getHotelRooms(h), EMPTY_ROOM()] })
 }));
 const updHotelRoom = (hotelIdx, roomIdx, field, val) => setItin(p => ({
  ...p, hotels: p.hotels.map((h,hi) => hi!==hotelIdx ? h : { ...h, rooms: getHotelRooms(h).map((r,ri) => ri!==roomIdx ? r : {...r,[field]:val}) })
 }));
 const removeHotelRoom = (hotelIdx, roomIdx) => setItin(p => ({
  ...p, hotels: p.hotels.map((h,hi) => {
   if (hi!==hotelIdx) return h;
   const rooms = getHotelRooms(h).filter((_,ri) => ri!==roomIdx);
   return { ...h, rooms: rooms.length > 0 ? rooms : [EMPTY_ROOM()] };
  })
 }));

 // ── OPTION 2 HOTELS ────────────────────────────────────────────────────────
 const addOption2Hotel = () => setItin(p => ({
  ...p, option2_hotels: [...(p.option2_hotels||[]), { id:`O2H${Date.now().toString().slice(-4)}`, name:"", destination:p.destination||"", check_in:"", check_out:"", meals:"Breakfast", rating:4, nights:1, rooms:[EMPTY_ROOM()] }],
 }));
 const updOption2Hotel = (idx, field, val) => setItin(p => ({
  ...p, option2_hotels: (p.option2_hotels||[]).map((h,i) => i===idx ? { ...h, [field]: val } : h),
 }));
 const removeOption2Hotel = idx => setItin(p => ({ ...p, option2_hotels: (p.option2_hotels||[]).filter((_,i) => i!==idx) }));
 const getO2HotelRooms = h => (h.rooms && h.rooms.length > 0)
  ? h.rooms
  : [{ room_type: h.room_type||"", bedding:"", num_rooms:1, cost_per_room_night: Number(h.cost_per_night)||0 }];
 const addO2HotelRoom = hotelIdx => setItin(p => ({
  ...p, option2_hotels: (p.option2_hotels||[]).map((h,hi) => hi!==hotelIdx ? h : { ...h, rooms:[...getO2HotelRooms(h), EMPTY_ROOM()] })
 }));
 const updO2HotelRoom = (hotelIdx, roomIdx, field, val) => setItin(p => ({
  ...p, option2_hotels: (p.option2_hotels||[]).map((h,hi) => hi!==hotelIdx ? h : { ...h, rooms: getO2HotelRooms(h).map((r,ri) => ri!==roomIdx ? r : {...r,[field]:val}) })
 }));
 const removeO2HotelRoom = (hotelIdx, roomIdx) => setItin(p => ({
  ...p, option2_hotels: (p.option2_hotels||[]).map((h,hi) => {
   if (hi!==hotelIdx) return h;
   const rooms = getO2HotelRooms(h).filter((_,ri) => ri!==roomIdx);
   return { ...h, rooms: rooms.length > 0 ? rooms : [EMPTY_ROOM()] };
  })
 }));
 const option2HotelTotal = (itin.option2_hotels||[]).reduce((s,h) => s + hotelCostPerNight(h)*(Number(h.nights)||1), 0);

 // ── SAVE ───────────────────────────────────────────────────────────────────
 // Strip base64 data: URLs before persisting to localStorage (they're huge; use media library URLs instead)
 const stripBase64 = it => ({
  ...it,
  cover_image_url: it.cover_image_url?.startsWith('data:') ? '' : (it.cover_image_url || ''),
  hotels: (it.hotels||[]).map(h => ({...h, image_url: h.image_url?.startsWith('data:') ? '' : (h.image_url||'')})),
  option2_hotels: (it.option2_hotels||[]).map(h => ({...h, image_url: h.image_url?.startsWith('data:') ? '' : (h.image_url||'')})),
  days: (it.days||[]).map(d => ({...d, image_url: d.image_url?.startsWith('data:') ? '' : (d.image_url||'')})),
 });
 const saveItin = async (mode) => {
  const effectiveMode = mode !== undefined ? mode : saveMode;
  if (!itin.destination.trim()) return toast$("Destination is required", true);
  if (!itin.days.length) return toast$("Add at least one day", true);
  const cleanItin = (({ displayVersion, numericVersion, createdAtMs, ...rest }) => rest)(itin);
  if (!cleanItin.title?.trim()) cleanItin.title = `${cleanItin.destination || "Custom"} Itinerary`;
  const normalizedItin = {
   ...cleanItin,
   hotels: hotelsFrom(cleanItin.hotels),
   flights: Array.isArray(cleanItin.flights) ? cleanItin.flights : [],
   days: Array.isArray(cleanItin.days) ? cleanItin.days : [],
  };
  const isNew = !itineraries.find(x => x.id === normalizedItin.id);
  const saveAsNewVersion = effectiveMode === "newVersion" && !isNew && normalizedItin.lead_id;
  const latestVersion = saveAsNewVersion
   ? Math.max(0, ...itineraries.filter(x => x.lead_id === normalizedItin.lead_id).map(x => Number(x.version||0)))
   : Number(normalizedItin.version||0);
  const versionedItin = saveAsNewVersion
   ? { ...normalizedItin, id: `ITN${Date.now().toString().slice(-6)}`, version: latestVersion + 1, created_at: today() }
   : { ...normalizedItin, version: (normalizedItin.version || 1), created_at: normalizedItin.created_at || today() };
  const savedItin = stripBase64(versionedItin);
  // Sidecar: compress uploaded base64 images before storing so they fit in localStorage.
  // Raw base64 at upload quality (1200px/85%) can be 300-600KB each; 5 days + cover can hit
  // the 5MB localStorage limit and fail silently. Compress to 800px/78% (~100-200KB each).
  const toSidecar = async url => {
   if (!url?.startsWith('data:')) return url || null;
   try { return await compressImgForPrint(url, 800, 0.78); } catch { return url; }
  };
  const [sidecarCover, sidecarHotels, sidecarO2, sidecarDays] = await Promise.all([
   toSidecar(versionedItin.cover_image_url),
   Promise.all((versionedItin.hotels||[]).map(h => toSidecar(h.image_url))),
   Promise.all((versionedItin.option2_hotels||[]).map(h => toSidecar(h.image_url))),
   Promise.all((versionedItin.days||[]).map(d => toSidecar(d.image_url))),
  ]);
  const itinImgData = { cover: sidecarCover, hotels: sidecarHotels, o2hotels: sidecarO2, days: sidecarDays };
  try {
   localStorage.setItem(`sfn_itin_imgs_${savedItin.id}`, JSON.stringify(itinImgData));
  } catch {
   toast$("Images saved for this session only — they may reset on page refresh. For permanent storage, use image URLs from the media library.", true);
  }
  setItineraries(p => saveAsNewVersion
   ? [savedItin, ...p]
   : isNew
     ? [savedItin, ...p]
     : p.map(x => x.id===cleanItin.id ? savedItin : x)
  );
  toast$(saveAsNewVersion ? "Itinerary saved as new version!" : isNew ? "Itinerary created!" : "Itinerary updated!");
  setView("list");
 };

 // ── VENDOR QUOTE REQUEST (from itinerary builder, employee-facing) ──────────
 const loadVrStatus = async (lead_id) => {
  if (!lead_id) { setVrStatus([]); return; }
  try {
   const r = await fetch(`/api/vendor-requests/lead-status/${lead_id}`);
   if (r.ok) setVrStatus(await r.json());
  } catch {}
 };

 const openVrModal = () => {
  if (!itin.lead_id) return toast$("Link a lead first (Overview tab)", true);
  if (!itin.destination) return toast$("Set destination first", true);
  const lead = leads.find(l => l.id === itin.lead_id);
  const kids = Number(lead?.kids || 0);
  const paxStr = `${lead?.pax||2} Adult${(lead?.pax||2)>1?"s":""}${kids>0?` + ${kids} Kid${kids>1?"s":""}`:""}`;
  const subject = `Quote Request — ${itin.destination} | ${lead?.travel_date||"TBD"} | ${paxStr} [Ref: ${itin.lead_id}]`;
  const body = `Dear Travel Partner,\n\nWe have a client requirement for ${itin.destination}. Please provide your best rates:\n\n📍 Destination: ${itin.destination}\n📅 Travel Date: ${lead?.travel_date||"TBD"}\n👥 Pax: ${paxStr}\n${itin.days?.length?`🌙 Nights: ${itin.days.length}\n`:""}\nInclusions needed: Hotels, Transfers, Sightseeing, Meals as per itinerary.\n\nLead Ref: ${itin.lead_id}\n\nBest regards`;
  // Get vendors for this destination — anonymize names for the employee
  const destVendors = vendors.filter(v =>
   v.status !== "Inactive" &&
   (v.destination === itin.destination || (v.destination||"").toLowerCase().includes((itin.destination||"").toLowerCase().split(/[\s,]/)[0]))
  );
  const anon = destVendors.map((v, i) => ({
   _real_id: v.id, _real_email: v.email,
   _real_name: v.name, _real_markup_type: v.markup_type, _real_markup_value: v.markup_value,
   label: `${v.category||"Hotel"} Option ${i+1} ${"★".repeat(Math.min(Number(v.rating)||4,5))}`,
   category: v.category, rating: v.rating, destination: v.destination,
  }));
  setVrModal({ subject, body, vendors: anon, selected: [], lead });
 };

 const sendVrRequests = async () => {
  if (!vrModal?.selected?.length) return toast$("Select at least one vendor option", true);
  setVrSending(true);
  let ok = 0; const errs = [];
  for (const idx of vrModal.selected) {
   const v = vrModal.vendors[idx];
   if (!v?._real_email) { errs.push(`Option ${idx+1}: no email`); continue; }
   try {
    const r = await fetch("/api/vendor-requests/send", {
     method:"POST", headers:{"Content-Type":"application/json"},
     body: JSON.stringify({
      lead_id: itin.lead_id, lead_name: itin.lead_name || leads.find(l=>l.id===itin.lead_id)?.name || "",
      lead_ref: itin.lead_id, destination: itin.destination,
      vendor_id: v._real_id, vendor_name: v._real_name, vendor_email: v._real_email,
      markup_type: v._real_markup_type||"percent", markup_value: v._real_markup_value||0,
      subject: vrModal.subject, body: vrModal.body,
     }),
    });
    const d = await r.json();
    if (r.ok) ok++; else errs.push(`Option ${idx+1}: ${d.error||r.status}`);
   } catch(e) { errs.push(`Option ${idx+1}: ${e.message}`); }
  }
  setVrSending(false);
  if (ok > 0) {
   toast$(`Quote requests sent to ${ok} vendor(s) ✓`);
   setVrModal(null);
   loadVrStatus(itin.lead_id);
  } else {
   toast$(errs.join(" | ") || "All sends failed — check email config in Settings", true);
  }
 };

 // Reload VR status when lead changes
 useEffect(() => { if (itin.lead_id) loadVrStatus(itin.lead_id); }, [itin.lead_id]); // eslint-disable-line react-hooks/exhaustive-deps

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
 const hotelTotal  = (itin.hotels||[]).reduce((s,h) => s + hotelCostPerNight(h)*(Number(h.nights)||1), 0);
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

  const itinQ = itinSearch.toLowerCase();
  const visibleGroups = itinQ
   ? groups.filter(g =>
      g.label.toLowerCase().includes(itinQ) ||
      g.items.some(it => (it.destination||"").toLowerCase().includes(itinQ) || (it.title||"").toLowerCase().includes(itinQ))
     )
   : groups;

  return (
   <div>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:12, flexWrap:"wrap" }}>
     <div>
      <div style={{ fontSize:20, fontWeight:700, color:"#0F172A", fontFamily:"'Playfair Display',serif" }}>Itinerary Builder</div>
      <div style={{ fontSize:12, color:"#64748B", marginTop:2 }}>Create detailed day-by-day travel plans with hotels, flights, images & maps</div>
     </div>
     <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
      {itineraries.length > 0 && (
       <input value={itinSearch} onChange={e=>setItinSearch(e.target.value)} placeholder="Search itineraries…"
        style={{ ...IS, padding:"7px 12px", fontSize:13, width:220 }}/>
      )}
      <Btn v="primary" icon="itinerary" onClick={() => { setItin({ ...EMPTY_ITIN, id:`ITN${Date.now().toString().slice(-6)}` }); setView("edit"); setTab("overview"); }}>
       + New Itinerary
      </Btn>
     </div>
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

    {itineraries.length > 0 && itinQ && visibleGroups.length === 0 && (
     <div style={{ background:"#F8FAFC", border:"1px dashed #D5E1EE", borderRadius:12, padding:40, textAlign:"center", color:"#94A3B8", fontSize:13 }}>
      No itineraries match "{itinSearch}"
     </div>
    )}
    {itineraries.length > 0 && (
     <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {visibleGroups.map(group => {
       const expanded = expandedGroups[group.key] !== false;
       // quotes linked to this lead but NOT to a specific itinerary (show at lead level)
       const groupVendorQuotes = quotes.filter(q => q.type === "vendor_quote" && q.lead_id === group.lead_id && !q.itinerary_id);
       // all vendor quotes for this lead (for badge count)
       const allLeadVendorQuotes = quotes.filter(q => q.type === "vendor_quote" && q.lead_id === group.lead_id);
       return (
        <div key={group.key} style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:14, overflow:"hidden" }}>
         {/* ── Group header ── */}
         <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:16, cursor:"pointer", background:"#F8FAFC" }} onClick={() => setExpandedGroups(p => ({ ...p, [group.key]: !expanded }))}>
          <div>
           <div style={{ fontSize:15, fontWeight:700, color:"#0F172A" }}>
            {group.label}
            {group.lead_id ? ` (${group.items.length} version${group.items.length>1?"s":""})` : ""}
            {allLeadVendorQuotes.length > 0 && <span style={{ marginLeft:8, background:"#E0F2FE", color:"#0284C7", borderRadius:4, padding:"2px 7px", fontSize:11 }}>{allLeadVendorQuotes.length} vendor quote{allLeadVendorQuotes.length>1?"s":""}</span>}
           </div>
           <div style={{ fontSize:12, color:"#64748B", marginTop:4 }}>{group.lead_id ? `${group.items[0].destination || ""}` : "No lead linked"}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
           <div style={{ fontSize:12, color:"#475569" }}>{expanded ? "Collapse" : "Expand"}</div>
           <Icon name={expanded ? "chevron_up" : "chevron_down"} size={16}/>
          </div>
         </div>
         {/* ── Vendor quotes section ── */}
         {expanded && groupVendorQuotes.length > 0 && (
          <div style={{ padding:"10px 16px 4px", borderBottom:"1px solid #E6ECF5" }}>
           <div style={{ fontSize:10, fontWeight:700, color:"#0284C7", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Vendor Quotes Received</div>
           <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
            {groupVendorQuotes.map(vq => (
             <div key={vq.id} style={{ background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:10, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <div>
               <div style={{ fontSize:13, fontWeight:700, color:"#0F172A" }}>{vq.vendor_name || vq.hotel_name || "Vendor Quote"}</div>
               <div style={{ fontSize:11, color:"#475569", marginTop:2 }}>{vq.hotel_name} · {vq.room_type} · {vq.pax} pax</div>
               {vq.inclusions?.length > 0 && <div style={{ fontSize:10, color:"#64748B", marginTop:2 }}>Incl: {vq.inclusions.slice(0,3).join(", ")}{vq.inclusions.length>3?` +${vq.inclusions.length-3} more`:""}</div>}
              </div>
              <div style={{ textAlign:"right" }}>
               <div style={{ fontSize:16, fontWeight:700, color:"#0284C7" }}>₹{Number(vq.final_cost||0).toLocaleString("en-IN")}</div>
               <div style={{ fontSize:10, color:"#64748B" }}>₹{Number(vq.per_person_cost||0).toLocaleString("en-IN")}/person · {vq.markup_pct}% markup</div>
               {vq.valid_till && <div style={{ fontSize:10, color:"#94A3B8", marginTop:2 }}>Valid till {vq.valid_till}</div>}
              </div>
             </div>
            ))}
           </div>
          </div>
         )}
         {/* ── Itinerary cards ── */}
         {expanded && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))", gap:16, padding:16 }}>
           {group.items.map(it => {
            const itinVendorQuotes = quotes.filter(q => q.type === "vendor_quote" && q.itinerary_id === it.id);
            return (
            <div key={it.id} style={{ background:"#FDFDFD", border: itinVendorQuotes.length > 0 ? "1px solid #BAE6FD" : "1px solid #E6ECF5", borderRadius:14, padding:14, display:"flex", flexDirection:"column", gap:10 }}>
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
             {itinVendorQuotes.length > 0 && (
              <div style={{ background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:8, padding:"8px 10px" }}>
               <div style={{ fontSize:9, fontWeight:700, color:"#0284C7", textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>Vendor Quotes ({itinVendorQuotes.length})</div>
               {itinVendorQuotes.map(vq => (
                <div key={vq.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4, fontSize:11 }}>
                 <div>
                  <span style={{ fontWeight:600, color:"#0F172A" }}>{vq.vendor_name || vq.hotel_name}</span>
                  {vq.room_type && <span style={{ color:"#64748B" }}> · {vq.room_type}</span>}
                  <span style={{ color:"#64748B" }}> · {vq.pax} pax</span>
                 </div>
                 <div style={{ fontWeight:700, color:"#0284C7", whiteSpace:"nowrap", marginLeft:8 }}>
                  ₹{Number(vq.final_cost||0).toLocaleString("en-IN")}
                 </div>
                </div>
               ))}
              </div>
             )}
             <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              {onPreview && <button title="Preview itinerary" onClick={()=>onPreview("itinerary",it)} style={{ background:"none", border:"1px solid #e2e8f0", cursor:"pointer", padding:"5px 8px", borderRadius:6, color:"#64748b", display:"flex", alignItems:"center", gap:4, fontSize:11 }}><svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>Preview</button>}
              <Btn v="primary" s={{ flex:1 }} icon="edit" onClick={() => {
               const { displayVersion, numericVersion, createdAtMs, ...cleanIt } = it;
               let imgs = null;
               try { imgs = JSON.parse(localStorage.getItem(`sfn_itin_imgs_${cleanIt.id}`) || 'null'); } catch {}
               setItin({
                ...cleanIt,
                cover_image_url: imgs?.cover || cleanIt.cover_image_url || "",
                hotels: hotelsFrom(cleanIt.hotels).map((h, i) => ({ ...h, image_url: imgs?.hotels?.[i] || h.image_url || "" })),
                option2_hotels: hotelsFrom(cleanIt.option2_hotels).map((h, i) => ({ ...h, image_url: imgs?.o2hotels?.[i] || h.image_url || "" })),
                flights: Array.isArray(cleanIt.flights) ? cleanIt.flights : [],
                days: Array.isArray(cleanIt.days) ? cleanIt.days.map((d, i) => ({ ...d, image_url: imgs?.days?.[i] || d.image_url || "" })) : [],
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
           );
           })}
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
 const TABS = ["overview","flights","hotels","days","inclusions","costsheet","option2","map"];
 const TAB_LABELS = { overview:"Overview", flights:"Flights", hotels:"Hotels", days:"Days", inclusions:"Inclusions/Excl.", costsheet:"Cost Sheet", option2:"Option 2", map:"Map & Preview" };

 return (
  <>
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
     {itinStatuses.map(s => <option key={s}>{s}</option>)}
    </select>
    <Btn v="secondary" icon="itinerary" onClick={aiGenerate} spin={aiLoading} disabled={aiLoading}>
     {aiLoading ? "AI Generating…" : "AI Generate"}
    </Btn>
    {linkedLead && onRequestQuote && (
     <Btn v="primary" icon="send" onClick={() => onRequestQuote({ lead: linkedLead, itinerary: itin })}>
      Request Quote
     </Btn>
    )}
    {itin.lead_id && itin.destination && (
     <Btn v="secondary" icon="vendor_req" onClick={openVrModal}>
      Request Vendor Quotes
      {vrStatus.length > 0 && <span style={{ marginLeft:5, background:"#1A6B8A", color:"#fff", borderRadius:10, padding:"1px 6px", fontSize:10 }}>{vrStatus.length}</span>}
     </Btn>
    )}
    {itin.lead_id && itineraries.some(x => x.id === itin.id) && (
     <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
      <Btn v="success" icon="check" s={{ fontSize:12 }} onClick={() => saveItin("update")}>
       💾 Save
      </Btn>
      <Btn v="secondary" s={{ fontSize:11, padding:"5px 10px" }} onClick={() => saveItin("newVersion")}>
       + New Version
      </Btn>
     </div>
    )}
    <Btn v="ghost" icon="mapview" onClick={() => {
     // Build clean PDF HTML — CORS-safe images + reliable download fallback for Edge
     // Picsum CDN — instant, CORS-OK, beautiful; seed keeps image stable
     const imgUrl = (query, w, h) => {
      const seed = (query||"travel").replace(/[^a-zA-Z0-9]/g,"").toLowerCase().slice(0,28)||"travel";
      return `https://picsum.photos/seed/${seed}/${w}/${h}`;
     };
     const fallbackImg = (query, w, h) => {
      const seed = ((query||"travel").replace(/[^a-zA-Z0-9]/g,"").toLowerCase().slice(0,25)||"travel")+"alt";
      return `https://picsum.photos/seed/${seed}/${w}/${h}`;
     };
    const imgTag = (primary, fallback, cls, alt) => {
     const safeAlt = String(alt || "Travel Image").replace(/["'<>]/g, "");
     // Simpler onerror: try fallback once, then hide the image. Avoid injecting HTML via string interpolation.
     return `<img src="${primary}" alt="${safeAlt}" class="${cls}" onerror="if(this.dataset.fallback!=='1'){this.dataset.fallback='1';this.src='${fallback}';}else{this.style.display='none';}"/>`;
    };
     const pc = co.color;
     const showTotalOnly = !!itin.show_total_only;
     const displayTotal = showTotalOnly
      ? (Number(itin.final_price) || grandTotal)
      : grandTotal;
     const flightsHtml = itin.flights.length === 0 ? "" : `
      <h2>✈️ Flights</h2>
      <table><thead><tr><th>Flight</th><th>Route</th><th>Date</th><th>Time</th><th>Class</th>${showTotalOnly?"":"<th>Cost</th>"}</tr></thead><tbody>
      ${itin.flights.map(f=>`<tr><td>${f.airline} ${f.flight_no}</td><td>${f.from} → ${f.to}</td><td>${f.date}</td><td>${f.departure}–${f.arrival}</td><td>${f.class}</td>${showTotalOnly?"":"<td><strong>"+fmtINR(f.cost||0)+"</strong></td>"}</tr>`).join("")}
      </tbody></table>`;
      const o1title = itin.option1_title || "Standard Package";
      const o2title = itin.option2_title || "Luxury Package";
      const renderHotelCards = (hotels, label, showCost) => hotels.length === 0 ? "" : `
      <h2>${label}</h2>
      ${hotels.map((h,hi)=>`
       <div class="hotel-card">
        ${imgTag(
        h.image_url || hotelImgUrl(h.name, h.destination, 860, 200, hi),
        h.image_url || hotelImgUrl((h.name||"hotel")+"alt", h.destination, 860, 200, hi),
        "hotel-img",
        h.name
        )}
        <div class="hotel-body">
         <div class="hotel-info">
          <div class="hotel-name">${"★".repeat(Math.min(h.rating||4,5))} ${h.name}</div>
          <div class="hotel-meta">📍 ${h.destination}</div>
          <div class="hotel-meta">🛏 ${(h.rooms&&h.rooms.length>0?h.rooms.map(r=>[r.num_rooms>1?r.num_rooms+'×':'',r.room_type,r.bedding].filter(Boolean).join(' ')).join(' | '):(h.room_type||'Standard'))} &nbsp;·&nbsp; 🍳 ${h.meals||"Breakfast"}</div>
          ${(!showTotalOnly&&showCost) ? `<div class="hotel-cost">${h.nights} Night${h.nights!==1?"s":""} &nbsp;·&nbsp; ${fmtINR(hotelCostPerNight(h)*(h.nights||1))}</div>` : `<div class="hotel-cost">${h.nights} Night${h.nights!==1?"s":""}</div>`}
         </div>
         <div class="hotel-badge-wrap">
          <div class="hotel-checkin"><span>Check-in</span><strong>${h.check_in||"—"}</strong></div>
          <div class="hotel-checkout"><span>Check-out</span><strong>${h.check_out||"—"}</strong></div>
         </div>
        </div>
       </div>`).join("")}`;
      const hotelsHtml = itin.option2_enabled
       ? renderHotelCards(itin.hotels, `🏨 Accommodation — ${o1title}`, true) + renderHotelCards(itin.option2_hotels||[], `🏨 Accommodation — ${o2title}`, false)
       : renderHotelCards(itin.hotels, "🏨 Accommodation", true);
     const daysHtml = itin.days.map((day,di) => {
      const showBanner = day.show_banner !== false;
      const dayImg = showBanner ? (day.image_url || dayImgUrl(day.destination||itin.destination, day.day||di+1, 860, 200)) : null;
      const actsHtml = (day.activities||[]).map((a,ai) => {
       const actImg = a.image_url || picsumUrl((a.type||"activity").replace(/[^a-zA-Z0-9]/g,"").toLowerCase().slice(0,20)+(di*10+ai), 100, 75);
       return `<div class="act">
        ${imgTag(
         actImg,
         a.image_url || picsumUrl((a.type||"activity").replace(/[^a-zA-Z0-9]/g,"").toLowerCase().slice(0,20)+(di*10+ai)+"alt", 100, 75),
         "act-img",
         a.title
        )}
        <div class="act-body">
         <div class="act-top"><span class="act-time">${a.time}</span><span class="act-badge">${a.type}</span><span class="act-title">${a.title}</span>${(!showTotalOnly && a.cost)?`<span class="act-cost">${fmtINR(a.cost)}</span>`:""}</div>
         ${a.desc?`<div class="act-desc">${a.desc}</div>`:""}
        </div>
       </div>`;
      }).join("");
      const dayHeaderHtml = showBanner
       ? `<div class="day-img-wrap">${imgTag(
           dayImg,
           day.image_url || dayImgUrl(day.destination||itin.destination, (day.day||di+1)+99, 860, 210),
           "day-img",
           day.location || "day image"
          )}<div class="day-overlay"><div class="day-num-badge"><span class="day-num">Day<\/span><span class="day-num-n">${day.day}<\/span><\/div><div class="day-text"><div class="day-title-ov">${day.title}<\/div><div class="day-loc-ov">📍 ${day.location}${day.date?" &nbsp;·&nbsp; "+day.date:""}<\/div><\/div><\/div><\/div>`
       : `<div class="day-no-banner"><div class="day-num-badge"><span class="day-num">Day<\/span><span class="day-num-n">${day.day}<\/span><\/div><div class="day-text-nb"><div class="day-title-nb">${day.title}<\/div><div class="day-loc-nb">📍 ${day.location}${day.date?" &nbsp;·&nbsp; "+day.date:""}<\/div><\/div><\/div>`;
      return `<div class="day-card">
       ${dayHeaderHtml}
       ${day.hotel?`<div class="day-hotel">🏨 ${day.hotel}<\/div>`:""}
       <div class="acts-wrap">${actsHtml}</div>
      </div>`;
     }).join("");
     const logoHtml = co.logo ? `<img src="${co.logo}" alt="logo" style="height:52px;object-fit:contain;margin-bottom:6px"/>` : `<div style="font-size:28px;font-weight:900;letter-spacing:-1px">${co.name}</div>`;
     // Re-merge sidecar cover image in case it was stripped from saved state
     let coverImg = itin.cover_image_url || '';
     if (!coverImg && itin.id) {
      try {
       const sc = JSON.parse(localStorage.getItem(`sfn_itin_imgs_${itin.id}`) || 'null');
       if (sc?.cover) coverImg = sc.cover;
      } catch {}
     }
     if (!coverImg) coverImg = destImgUrl(itin.destination, 900, 300);
     const o1price = Number(itin.selling_price || grandTotal || 0);
     const o2price = Number(itin.option2_price || 0);
     const hotelRowsHtml = (hotels) => (hotels||[]).map(h => {
      const roomDesc = (h.rooms&&h.rooms.length>0)
       ? h.rooms.map(r=>[r.num_rooms>1?r.num_rooms+'×':'',r.room_type,r.bedding].filter(Boolean).join(' ')).join(', ')
       : (h.room_type||'');
      return '<div style="padding:6px 0;border-bottom:1px solid #f1f5f9">' +
      '<strong style="font-size:12px;color:#0F172A">' + (h.name||"Hotel") + '</strong>' +
      (h.destination ? ' <span style="font-size:11px;color:#94A3B8">· ' + h.destination + '</span>' : '') +
      (h.rating ? ' <span style="color:#F59E0B;font-size:11px">' + '★'.repeat(Math.min(Number(h.rating)||4,5)) + '</span>' : '') +
      '<div style="font-size:10px;color:#64748B;margin-top:2px">' +
      [h.nights?(h.nights+'N'):'', h.meals, roomDesc].filter(Boolean).join(' · ') +
      '</div></div>';
     }).join('');
     const option2Html = !itin.option2_enabled ? '' :
      '<h2>🏷️ Choose Your Package</h2>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
      '<div style="border:2px solid ' + pc + ';border-radius:14px;overflow:hidden">' +
      '<div style="background:' + pc + ';color:#fff;padding:14px 16px;text-align:center">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;opacity:.85">Option 1</div>' +
      '<div style="font-size:17px;font-weight:900;margin-top:3px">' + o1title + '</div>' +
      (o1price>0?'<div style="font-size:22px;font-weight:900;margin-top:8px">₹'+o1price.toLocaleString('en-IN')+'</div><div style="font-size:10px;opacity:.8;margin-top:2px">Per person: ₹'+Math.round(o1price/(itin.pax||1)).toLocaleString('en-IN')+'</div>':'') +
      '</div>' +
      '<div style="padding:14px 16px">' +
      ((itin.hotels||[]).length>0?'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#64748B;margin-bottom:8px">Hotels</div>'+hotelRowsHtml(itin.hotels):'') +
      ((itin.inclusions||[]).length>0?'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#16a34a;margin-top:10px;margin-bottom:6px">Included</div>'+(itin.inclusions||[]).map(i=>'<div style="font-size:11px;color:#374151;padding:2px 0">✔ '+i+'</div>').join(''):'') +
      ((itin.exclusions||[]).length>0?'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#dc2626;margin-top:8px;margin-bottom:6px">Not Included</div>'+(itin.exclusions||[]).map(e=>'<div style="font-size:11px;color:#374151;padding:2px 0">✘ '+e+'</div>').join(''):'') +
      '</div></div>' +
      '<div style="border:2px solid #D97706;border-radius:14px;overflow:hidden">' +
      '<div style="background:linear-gradient(135deg,#D97706,#92400E);color:#fff;padding:14px 16px;text-align:center">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;opacity:.85">Option 2</div>' +
      '<div style="font-size:17px;font-weight:900;margin-top:3px">' + o2title + '</div>' +
      (o2price>0?'<div style="font-size:22px;font-weight:900;margin-top:8px">₹'+o2price.toLocaleString('en-IN')+'</div><div style="font-size:10px;opacity:.8;margin-top:2px">Per person: ₹'+Math.round(o2price/(itin.pax||1)).toLocaleString('en-IN')+'</div>':'') +
      '</div>' +
      '<div style="padding:14px 16px">' +
      ((itin.option2_hotels||[]).length>0?'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#64748B;margin-bottom:8px">Hotels</div>'+hotelRowsHtml(itin.option2_hotels):'') +
      ((itin.option2_inclusions||[]).length>0?'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#16a34a;margin-top:10px;margin-bottom:6px">Included</div>'+(itin.option2_inclusions||[]).map(i=>'<div style="font-size:11px;color:#374151;padding:2px 0">✔ '+i+'</div>').join(''):'') +
      ((itin.option2_exclusions||[]).length>0?'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#dc2626;margin-top:8px;margin-bottom:6px">Not Included</div>'+(itin.option2_exclusions||[]).map(e=>'<div style="font-size:11px;color:#374151;padding:2px 0">✘ '+e+'</div>').join(''):'') +
      '</div></div>' +
      '</div>';
     const socialHtml = [
      co.instagram ? '📷 ' + co.instagram : '',
      co.facebook  ? '📘 ' + co.facebook  : '',
      co.whatsapp  ? '💬 ' + co.whatsapp  : '',
     ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${itin.title||"Itinerary"}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',Helvetica,Arial,sans-serif}
body{color:#1a1a2e;background:#eef2f7;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:860px;margin:0 auto;background:#fff;box-shadow:0 4px 40px rgba(0,0,0,.13)}
.cover-hero-wrap{position:relative;height:360px;overflow:hidden;background:#1A6B8A}
.cover-hero{width:100%;height:100%;object-fit:cover;display:block}
.cover-hero-ov{position:absolute;inset:0;background:linear-gradient(160deg,rgba(0,0,0,.15) 0%,rgba(0,0,0,.72) 100%)}
.cover{position:absolute;bottom:0;left:0;right:0;padding:28px 42px 34px;color:#fff}
.cover-brand{font-size:12px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;opacity:.88;margin-bottom:10px}
.cover-logo{height:44px;object-fit:contain;display:block;margin-bottom:10px}
.cover-tagline{font-size:11px;opacity:.65;margin-top:3px;letter-spacing:.5px}
.cover h1{font-size:32px;font-weight:900;margin:0 0 9px;line-height:1.15;letter-spacing:-.5px;text-shadow:0 2px 10px rgba(0,0,0,.35)}
.cover .sub{font-size:12px;opacity:.88;line-height:1.7}
.cover .hls{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}
.cover .hl{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.38);padding:4px 13px;border-radius:20px;font-size:11px;font-weight:600}
.content{padding:26px 38px 36px}
.trip-meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #E6ECF5;border-radius:12px;overflow:hidden;margin:0 0 20px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
.tm-cell{padding:14px 12px;text-align:center;border-right:1px solid #E6ECF5;background:#F8FAFC}
.tm-cell:first-child{background:${pc}0c;border-left:4px solid ${pc}}
.tm-cell:last-child{border-right:none}
.tm-lbl{font-size:9px;color:#64748B;text-transform:uppercase;letter-spacing:.9px;margin-bottom:4px}
.tm-val{font-size:13px;font-weight:800;color:#0F172A;line-height:1.35}
.cost-bar{display:flex;background:#F8FAFC;border:1px solid #E6ECF5;border-radius:12px;overflow:hidden;margin:0 0 20px;box-shadow:0 2px 8px rgba(0,0,0,.04)}
.cost-cell{flex:1;padding:13px 14px;text-align:center;border-right:1px solid #E6ECF5}
.cost-cell:last-child{border-right:none}
.cost-cell .lbl{font-size:9px;color:#64748B;text-transform:uppercase;letter-spacing:.5px}
.cost-cell .val{font-size:14px;font-weight:800;color:#0F172A;margin-top:4px}
.cost-cell.total{background:${pc}12}
.cost-cell.total .val{color:${pc};font-size:17px}
h2{font-size:11px;font-weight:800;color:${pc};padding:7px 14px;margin:24px 0 14px;text-transform:uppercase;letter-spacing:.9px;background:${pc}0d;border-left:4px solid ${pc};border-radius:0 6px 6px 0}
table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:6px;border-radius:10px;overflow:hidden;border:1px solid #E6ECF5}
th{background:${pc};text-align:left;padding:9px 12px;font-weight:700;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
td{padding:8px 12px;border-bottom:1px solid #F1F5F9;vertical-align:middle;color:#334155}
tr:nth-child(even) td{background:#F8FAFC}
tr:last-child td{border-bottom:none}
.hotel-card{border:1px solid #E6ECF5;border-radius:14px;margin-bottom:18px;overflow:hidden;page-break-inside:avoid;box-shadow:0 3px 14px rgba(0,0,0,.07)}
.hotel-img{width:100%;height:200px;object-fit:cover;display:block}
.hotel-body{padding:14px 18px 16px;display:flex;gap:16px;align-items:flex-start}
.hotel-info{flex:1}
.hotel-name{font-size:16px;font-weight:900;color:#0F172A;margin-bottom:4px}
.hotel-meta{font-size:11px;color:#64748B;margin:3px 0;line-height:1.65}
.hotel-cost{font-size:11px;font-weight:700;color:#fff;background:${pc};display:inline-block;padding:4px 12px;border-radius:20px;margin-top:8px}
.hotel-badge-wrap{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0}
.hotel-checkin,.hotel-checkout{background:#F8FAFC;border:1px solid #E6ECF5;padding:6px 11px;border-radius:8px;text-align:right}
.hotel-checkin span,.hotel-checkout span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.7px;color:#94A3B8;margin-bottom:2px}
.hotel-checkin strong,.hotel-checkout strong{font-size:12px;font-weight:800;color:#0F172A}
.day-card{margin-bottom:24px;page-break-inside:avoid;border-radius:14px;overflow:hidden;border:1px solid #E6ECF5;box-shadow:0 3px 14px rgba(0,0,0,.07)}
.day-img-wrap{position:relative;height:210px;overflow:hidden;background:#e6ecf5}
.day-img{width:100%;height:210px;object-fit:cover;display:block}
.day-overlay{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(to top,rgba(0,0,0,.9) 0%,transparent 100%);padding:16px 20px;color:#fff;display:flex;align-items:flex-end;gap:14px}
.day-num-badge{background:${pc};color:#fff;font-weight:900;width:48px;height:48px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 10px rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.5)}
.day-num{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;opacity:.85;line-height:1}
.day-num-n{font-size:18px;font-weight:900;line-height:1}
.day-text{flex:1}
.day-title-ov{font-weight:900;font-size:17px;line-height:1.2;margin-bottom:4px}
.day-loc-ov{font-size:11px;opacity:.85}
.day-hotel{background:#FFFBEB;padding:8px 18px;font-size:11px;color:#92400E;font-weight:700;border-bottom:1px solid #FDE68A;display:flex;align-items:center;gap:6px}
.day-no-banner{background:linear-gradient(135deg,${pc}18,${pc}08);border-bottom:3px solid ${pc};padding:14px 18px;display:flex;align-items:center;gap:14px}
.day-text-nb{flex:1}
.day-title-nb{font-weight:800;font-size:15px;color:#0F172A;margin-bottom:3px}
.day-loc-nb{font-size:11px;color:#64748B}
.acts-wrap{padding:6px 18px 12px}
.act{display:flex;gap:14px;padding:12px 0;border-bottom:1px solid #F1F5F9;align-items:flex-start}
.act:last-child{border-bottom:none}
.act-img{width:110px;height:80px;object-fit:cover;border-radius:10px;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,.1)}
.act-body{flex:1}
.act-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px}
.act-time{font-weight:800;color:${pc};font-size:12px;flex-shrink:0}
.act-badge{background:${pc}18;color:${pc};padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;flex-shrink:0;text-transform:capitalize}
.act-title{font-weight:700;font-size:13px;color:#0F172A;flex:1}
.act-cost{font-weight:800;font-size:11px;color:#fff;background:${pc};padding:2px 9px;border-radius:6px;white-space:nowrap}
.act-desc{font-size:11.5px;color:#475569;line-height:1.72;margin-top:3px}
.inc-exc-wrap{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:6px}
.inc-box{background:#F0FDF4;border:1px solid #86EFAC;border-radius:12px;padding:16px 18px}
.exc-box{background:#FFF5F5;border:1px solid #FCA5A5;border-radius:12px;padding:16px 18px}
.ie-head{font-size:12px;font-weight:900;margin-bottom:10px;color:#0F172A}
.inc-item,.exc-item{font-size:11.5px;padding:4px 0;display:flex;gap:9px;align-items:baseline;color:#374151;line-height:1.55}
.inc-item::before{content:'✔';font-size:11px;flex-shrink:0;color:#16a34a;font-weight:900}
.exc-item::before{content:'✖';font-size:11px;flex-shrink:0;color:#dc2626;font-weight:900}
.notes-box{background:#FFFBEB;border:1px solid #FDE68A;border-left:4px solid #F59E0B;border-radius:0 10px 10px 0;padding:16px 18px;font-size:12px;color:#78350F;line-height:1.8}
.notes-lbl{font-weight:900;font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:#92400E;margin-bottom:6px}
.footer{padding:18px 0 0;border-top:2px solid #E6ECF5;display:flex;justify-content:space-between;align-items:flex-start;font-size:10.5px;color:#64748B;margin-top:26px;flex-wrap:wrap;gap:8px}
.footer strong{color:#334155;font-size:12px}
body{padding-bottom:80px}
@media print{
 button,#action-bar{display:none!important}
 body{padding-bottom:0!important}
 *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
 body,html{background:#fff!important}
 .day-card,.hotel-card{page-break-inside:avoid}
}
</style></head><body>
<div class="page">
 <div class="cover-hero-wrap">
  ${imgTag(coverImg, destImgUrl(itin.destination, 900, 360), "cover-hero", itin.destination||"destination")}
  <div class="cover-hero-ov"></div>
  <div class="cover">
   <div>
    ${co.logo?'<img src="'+co.logo+'" alt="'+co.name+'" class="cover-logo"/>':'<div class="cover-brand">'+co.name+'</div>'}
    ${co.tagline?'<div class="cover-tagline">'+co.tagline+'</div>':""}
   </div>
   <h1>${itin.title||"Travel Itinerary"}</h1>
   <div class="sub">📍 ${itin.destination}${itin.start_date?" &nbsp;·&nbsp; 📅 "+itin.start_date+(itin.end_date?" – "+itin.end_date:""):""} &nbsp;·&nbsp; 👥 ${itin.pax} Adult${itin.pax!==1?"s":""}${itin.kids?" + "+itin.kids+" Child"+(itin.kids!==1?"ren":""):""}${itin.days.length?" &nbsp;·&nbsp; 🗓 "+itin.days.length+" Days":""}</div>
   ${itin.highlights.length>0?'<div class="hls">'+itin.highlights.map(h=>'<span class="hl">✔ '+h+'</span>').join("")+'</div>':""}
  </div>
 </div>
 <div class="content">
  <div class="trip-meta">
   <div class="tm-cell"><div class="tm-lbl">Destination</div><div class="tm-val">${itin.destination||"—"}</div></div>
   <div class="tm-cell"><div class="tm-lbl">Travel Dates</div><div class="tm-val">${itin.start_date||"—"}${itin.end_date?" → "+itin.end_date:""}</div></div>
   <div class="tm-cell"><div class="tm-lbl">Passengers</div><div class="tm-val">${itin.pax} Adult${itin.pax!==1?"s":""}${itin.kids?"<br>"+itin.kids+" Child"+(itin.kids!==1?"ren":""):""}</div></div>
   <div class="tm-cell"><div class="tm-lbl">Duration</div><div class="tm-val">${itin.days.length>0?itin.days.length+" Days<br>"+(itin.days.length-1)+" Nights":"—"}</div></div>
  </div>
  ${displayTotal>0?(showTotalOnly?'<div class="cost-bar" style="max-width:340px"><div class="cost-cell total" style="flex:1"><div class="lbl">💰 Package Price</div><div class="val" style="font-size:20px">'+fmtINR(displayTotal)+'</div><div style="font-size:10px;color:#64748B;margin-top:2px">Per person: '+fmtINR(Math.round(displayTotal/(itin.pax||1)))+'</div></div></div>':'<div class="cost-bar"><div class="cost-cell"><div class="lbl">✈ Flights</div><div class="val">'+fmtINR(flightTotal)+'</div></div><div class="cost-cell"><div class="lbl">🏨 Hotels</div><div class="val">'+fmtINR(hotelTotal)+'</div></div><div class="cost-cell"><div class="lbl">🗺 Activities</div><div class="val">'+fmtINR(actTotal)+'</div></div><div class="cost-cell total"><div class="lbl">Total Estimate</div><div class="val">'+fmtINR(grandTotal)+'</div></div></div>'):""}
  ${option2Html}
  ${!itin.option2_enabled && ((itin.inclusions||[]).length>0||(itin.exclusions||[]).length>0)
   ? '<h2>✅ Inclusions &amp; Exclusions</h2><div class="inc-exc-wrap">'
     + ((itin.inclusions||[]).length>0 ? '<div class="inc-box"><div class="ie-head" style="color:#16a34a">What&apos;s Included</div>' + (itin.inclusions||[]).map(i=>'<div class="inc-item">'+i+'</div>').join("") + '</div>' : '')
     + ((itin.exclusions||[]).length>0 ? '<div class="exc-box"><div class="ie-head" style="color:#dc2626">Not Included</div>' + (itin.exclusions||[]).map(e=>'<div class="exc-item">'+e+'</div>').join("") + '</div>' : '')
     + '</div>'
   : ""}
  ${flightsHtml}${hotelsHtml}
  ${itin.days.length>0?'<h2>🗺 Day-by-Day Itinerary</h2>'+daysHtml:""}
  ${itin.notes?'<h2>📝 Notes &amp; Special Requests</h2><div class="notes-box"><div class="notes-lbl">Travel Notes</div>'+itin.notes+'</div>':""}
  ${itin.special_instructions?'<h2>📋 Special Instructions</h2><div class="notes-box" style="background:#EFF6FF;border-left-color:#1A6B8A"><div class="notes-lbl" style="color:#1e40af">Important Notes</div><div style="white-space:pre-wrap">'+itin.special_instructions+'</div></div>':""}
  <div class="footer">
   <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    ${co.logo?'<img src="'+co.logo+'" alt="'+co.name+'" style="height:28px;object-fit:contain;flex-shrink:0"/>':''}
    <div>
     <div><strong>${co.name}</strong>${co.phone?" &nbsp;·&nbsp; 📞 "+co.phone:""}</div>
     ${co.address?'<div style="font-size:10px;margin-top:2px">📍 '+co.address+'</div>':""}
     <div style="margin-top:2px">${co.email?"✉ "+co.email:""}${co.website?" &nbsp;·&nbsp; 🌐 "+co.website:""}</div>
     ${socialHtml?'<div style="margin-top:3px;font-size:10px">'+socialHtml+'</div>':""}
    </div>
   </div>
   <div style="text-align:right">
    <div>Generated ${new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</div>
    <div style="margin-top:2px">Ref: ${itin.id||"—"}</div>
   </div>
  </div>
 </div>
</div>
<div id="action-bar" style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#fff;border-top:2px solid #E6ECF5;padding:12px 20px;display:flex;gap:12px;justify-content:center;box-shadow:0 -4px 18px rgba(0,0,0,.12)">
 <button id="downloadPdfBtn" style="background:${pc};color:#fff;border:none;padding:11px 32px;border-radius:8px;font-size:15px;cursor:pointer;font-weight:700;letter-spacing:.3px">⬇ Download PDF</button>
 <button id="printPdfBtn" style="background:#475569;color:#fff;border:none;padding:11px 32px;border-radius:8px;font-size:15px;cursor:pointer;font-weight:700;letter-spacing:.3px">🖨 Print / Save as PDF</button>
</div>
<div style="height:70px"></div>
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
})();
</script>
</body></html>`;
  // Open the itinerary in a new tab via Blob URL — fully visible so images load
  // reliably. The tab has its own Download PDF and Print buttons.
  const blob = new Blob([html], { type: "text/html; charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const newTab = window.open(blobUrl, "_blank");
  if (!newTab) toast$("Pop-up blocked — please allow pop-ups and try again.", true);
  // Revoke after 5 min to free memory
  setTimeout(() => URL.revokeObjectURL(blobUrl), 300000);
    }}>Download PDF</Btn>
    {onEmailItin && <Btn v="secondary" icon="email" s={{ fontSize:12 }} onClick={()=>onEmailItin(itin)}>Email to Lead</Btn>}
    {onWhatsAppItin && <Btn s={{ background:"#25D366", color:"#fff", border:"none", fontSize:12, borderRadius:8, padding:"7px 14px", cursor:"pointer", fontWeight:600 }} onClick={()=>onWhatsAppItin(itin)}>💬 WhatsApp to Lead</Btn>}
    {!(itin.lead_id && itineraries.some(x => x.id === itin.id)) && <Btn v="success" icon="check" onClick={saveItin}>💾 Save</Btn>}
   </div>

   {/* Cost summary strip */}
   {(grandTotal > 0 || itin.final_price > 0) && (
    <div style={{ display:"flex", gap:10, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
     {itin.show_total_only ? (
      <div style={{ background:"#E0F2FE", border:"1px solid #BAE6FD", borderRadius:9, padding:"7px 18px", display:"flex", alignItems:"center", gap:8 }}>
       <Icon name="check" size={13}/>
       <span style={{ fontSize:11, color:"#0284C7" }}>Customer sees total only:</span>
       <span style={{ fontSize:15, fontWeight:800, color:"#0F172A" }}>{fmtINR(Number(itin.final_price)||grandTotal)}</span>
       <span style={{ fontSize:11, color:"#64748B" }}>({fmtINR(Math.round((Number(itin.final_price)||grandTotal)/(itin.pax||1)))}/person)</span>
      </div>
     ) : (
      [["Flights", flightTotal, "flight"],["Hotels", hotelTotal, "hotel_star"],["Activities", actTotal, "adventure"],["Total", grandTotal, "check"]].map(([lbl,amt,icon])=>(
       <div key={lbl} style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:9, padding:"7px 14px", display:"flex", alignItems:"center", gap:7 }}>
        <Icon name={icon} size={13}/>
        <span style={{ fontSize:11, color:"#64748B" }}>{lbl}</span>
        <span style={{ fontSize:13, fontWeight:700, color: lbl==="Total"?"#1A6B8A":"#0F172A" }}>{fmtINR(amt)}</span>
       </div>
      ))
     )}
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
      {/* Lead selector — first field, full width, auto-fills all fields */}
      <div style={{ gridColumn:"1/-1" }}>
       <F label="Select Lead">
        <Sel value={itin.lead_id||""} onChange={e=>{
         const l = leads.find(x=>x.id===e.target.value);
         if (l) {
          const matchedDest = l.destination ? matchDestination(l.destination) : "";
          const coverImg = matchedDest ? findDestImg(matchedDest) : null;
          setItin(p=>({...p,
           lead_id:   l.id,
           lead_name: l.name,
           destination: matchedDest || p.destination || "",
           city:        l.city        || p.city || "",
           pax:         l.pax         || p.pax  || 2,
           kids:        l.kids        !== undefined ? l.kids : (p.kids || 0),
           start_date:  l.travel_date || p.start_date || "",
           end_date:    l.end_date    || p.end_date   || "",
           notes:       l.notes       || p.notes      || "",
           ...(coverImg ? { cover_image_url: coverImg } : {}),
          }));
         } else {
          upd("lead_id", "");
          upd("lead_name", "");
         }
        }}>
         <option value="">— No lead (fill manually below) —</option>
         {leads.map(l => <option key={l.id} value={l.id}>{l.name}{l.destination ? ` — ${l.destination}` : ""}{l.pax ? ` · ${l.pax} pax` : ""}{l.travel_date ? ` · ${l.travel_date}` : ""}</option>)}
        </Sel>
        {itin.lead_id && (
         <div style={{ fontSize:11, color:"#16a34a", marginTop:4 }}>
          ✓ Linked to {itin.lead_name} — fields auto-populated from lead. You can still edit below.
         </div>
        )}
       </F>
      </div>
      <div style={{ gridColumn:"1/-1" }}>
       <F label="Package / Itinerary Title">
        <Inp value={itin.title||""} onChange={e=>upd("title",e.target.value)} placeholder={itin.destination ? `${itin.destination} Itinerary` : "e.g. Bali Honeymoon 5N/6D"}/>
       </F>
      </div>
      <F label="Destination *">
       <SelectOrAdd value={itin.destination} options={allDestinations}
        onChange={v=>{
         const img = findDestImg(v);
         setItin(p=>({ ...p, destination:v, city:"", ...(img?{cover_image_url:img}:{}) }));
        }}
        onAddNew={addCustomDest} placeholder="— Select destination —"
        loading={refLoading && !allDestinations.length}/>
      </F>
      <F label="City / Base Location">
       <SelectOrAdd value={itin.city||""} options={citiesFor(itin.destination)}
        onChange={v=>upd("city",v)}
        onAddNew={city=>addCustomCity(itin.destination,city)}
        placeholder="— Select city —"
        loading={refLoading && !itin.destination}/>
      </F>
      <F label="Start Date"><Inp type="date" value={itin.start_date} onChange={e=>upd("start_date",e.target.value)}/></F>
      <F label="End Date"><Inp type="date" value={itin.end_date} onChange={e=>upd("end_date",e.target.value)}/></F>
      <F label="Adults"><Inp type="number" min={1} value={itin.pax} onChange={e=>upd("pax",Number(e.target.value))}/></F>
      <F label="Kids"><Inp type="number" min={0} value={itin.kids} onChange={e=>upd("kids",Number(e.target.value))}/></F>
      <F label="Tour Type">
       <Sel value={itin.tour_type||""} onChange={e=>upd("tour_type",e.target.value)}>
        <option value="">— Select tour type —</option>
        {TOUR_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
       </Sel>
      </F>
      <div style={{ gridColumn:"1/-1" }}>
       <F label="Preferences / Notes"><TA value={itin.notes} onChange={e=>upd("notes",e.target.value)} placeholder="E.g. honeymoon, adventure activities, vegetarian food, 4-star hotels only…"/></F>
      </div>
      <div style={{ gridColumn:"1/-1" }}>
       <div style={{ fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Special Instructions / Notes for Customer</div>
       <div style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center", flexWrap:"wrap" }}>
        <select
         value=""
         onChange={e=>{ if(e.target.value) upd("special_instructions", (itin.special_instructions ? itin.special_instructions+"\n\n" : "")+e.target.value); }}
         style={{ flex:"1 1 200px", background:"#F8FAFC", border:"1px solid #D5E1EE", borderRadius:8, padding:"7px 10px", fontSize:12, color:"#334155", outline:"none", cursor:"pointer" }}
        >
         <option value="">📋 Load from saved template…</option>
         {siCatalog
          .filter(s => (!s.destination || s.destination===itin.destination) && (!itin.tour_type || s.tour_type===itin.tour_type || s.tour_type==="General"))
          .map((s,i) => <option key={i} value={s.instruction}>{s.title || s.instruction.slice(0,65)}</option>)
         }
        </select>
        <button onClick={async()=>{
         if (!itin.special_instructions?.trim()) return toast$("Enter instructions first");
         try {
          const r = await fetch("/api/reference/special-instruction",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ destination:itin.destination||null, tour_type:itin.tour_type||"General", instruction:itin.special_instructions }) });
          if(r.ok){
           toast$("Template saved ✓");
           fetch("/api/special-instructions").then(r2=>r2.ok?r2.json():[]).then(d=>{if(Array.isArray(d))setSiCatalog(d);}).catch(()=>{});
          } else { const j=await r.json().catch(()=>({})); toast$(j.error||"Save failed"); }
         } catch(e){ toast$("Network error — is the backend running?"); }
        }} style={{ background:"#F0FDF4", border:"1px solid #86EFAC", borderRadius:7, color:"#15803D", fontSize:11, padding:"6px 12px", cursor:"pointer", fontWeight:600, whiteSpace:"nowrap", flexShrink:0 }}>
         💾 Save as Template
        </button>
       </div>
       <TA value={itin.special_instructions||""} onChange={e=>upd("special_instructions",e.target.value)} rows={4} placeholder="E.g. Please carry a valid ID proof, Check-in time is 2 PM, Terms & Conditions apply, Cancellation policy…" style={{ minHeight:80 }}/>
       <div style={{ fontSize:11, color:"#64748B", marginTop:4 }}>These notes appear in the customer PDF as a highlighted box. Select a template above or type directly.</div>
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
      <div style={{ gridColumn:"1/-1" }}>
       <F label="Pricing Display">
        <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
         <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:13 }}>
          <input type="checkbox" checked={!!itin.show_total_only} onChange={e => upd("show_total_only", e.target.checked)} style={{ width:16, height:16 }}/>
          <span>Show <strong>total price only</strong> to customer (hide per-item costs in preview)</span>
         </label>
        </div>
       </F>
      </div>
      {itin.show_total_only && (
       <div style={{ gridColumn:"1/-1" }}>
        <F label="Final Price to Show Customer (₹)">
         <Inp type="number" value={itin.final_price || grandTotal || ""} placeholder="Auto-calculated from items if 0"
          onChange={e => upd("final_price", Number(e.target.value))}/>
        </F>
        <div style={{ fontSize:11, color:"#64748B", marginTop:4 }}>
         Calculated from items: <strong>₹{grandTotal.toLocaleString("en-IN")}</strong>
         {itin.final_price > 0 && itin.final_price !== grandTotal && <span style={{ marginLeft:8, color:"#FFB74D" }}>→ Override: ₹{Number(itin.final_price).toLocaleString("en-IN")}</span>}
        </div>
       </div>
      )}
      {/* ── Cover / Banner Image ── */}
      {itin.destination && (
       <div style={{ gridColumn:"1/-1" }}>
        <F label="Cover / Banner Image">
         {(()=>{
          const coverImgs = mediaData.filter(m=>(m.type==="destination_photo"||m.type==="property_photo")&&m.destination===itin.destination);
          const allCoverImgs = coverImgs.length>0 ? coverImgs : mediaData.filter(m=>m.type==="destination_photo"||m.type==="property_photo");
          const currentCover = itin.cover_image_url || destImgUrl(itin.destination, 800, 160);
          return (
           <>
            {/* Always-visible preview */}
            <div style={{ position:"relative", height:130, borderRadius:9, overflow:"hidden", background:"#E6ECF5", marginBottom:8 }}>
             <img src={currentCover} alt="banner" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} onError={e=>e.currentTarget.style.opacity="0"}/>
             <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top,rgba(0,0,0,.4) 0%,transparent 60%)" }}/>
             <div style={{ position:"absolute", bottom:8, left:10, color:"#fff", fontSize:11, fontWeight:700, textShadow:"0 1px 3px rgba(0,0,0,.6)" }}>{itin.title||itin.destination}</div>
             {itin.cover_image_url && <div style={{ position:"absolute", bottom:8, right:10, background:"rgba(0,0,0,.45)", color:"#fff", fontSize:9, padding:"2px 6px", borderRadius:4 }}>Custom ✓</div>}
             {!itin.cover_image_url && <div style={{ position:"absolute", bottom:8, right:10, background:"rgba(0,0,0,.35)", color:"#fff", fontSize:9, padding:"2px 6px", borderRadius:4 }}>Auto-generated</div>}
            </div>
            {/* Controls: library + upload + clear */}
            <div style={{ display:"flex", gap:6, marginBottom:6, flexWrap:"wrap", alignItems:"center" }}>
             <select value={itin.cover_image_url||""} onChange={e=>upd("cover_image_url",e.target.value)}
              style={{ ...IS, flex:"1 1 160px", padding:"5px 8px", fontSize:11 }}>
              <option value="">— Auto-generate from destination —</option>
              {allCoverImgs.map((m,mi)=><option key={mi} value={m.url}>{m.title}{m.vendor_name?` · ${m.vendor_name}`:""}{coverImgs.length===0?` [${m.destination}]`:""}</option>)}
             </select>
             <label title="Upload from your laptop" style={{ background:"#EEF3F9", border:"1px solid #B3D1E8", borderRadius:7, color:"#1A6B8A", fontSize:11, padding:"5px 10px", cursor:"pointer", fontWeight:600, whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:4 }}>
              📁 Upload
              <input type="file" accept="image/*" style={{ display:"none" }} onChange={async e=>{
               const file=e.target.files?.[0]; if(!file) return;
               e.target.value="";
               const dataUrl = await compressImage(file, 1200, 0.85);
               if (!dataUrl) return;
               upd("cover_image_url", dataUrl);
               const saved = await saveUploadedMedia(dataUrl,{ baseTitle:(itin.destination||'Banner')+' Cover ', title:(itin.destination||'Banner')+' Cover', type:'destination_photo', destination:itin.destination||'', category:'cover' });
               if (saved) {
                refreshMedia&&refreshMedia(true);
                // If backend returned a proper HTTP URL, use it so the image persists as a URL (not base64)
                if (saved.url && !saved.url.startsWith('data:')) upd("cover_image_url", saved.url);
                toast$&&toast$('Banner image saved to media library ✓','success');
               }
              }}/>
             </label>
             {itin.cover_image_url && (
              <button onClick={()=>upd("cover_image_url","")} style={{ background:"#FEE2E2", border:"1px solid #FECACA", borderRadius:7, color:"#B91C1C", fontSize:11, padding:"5px 9px", cursor:"pointer", whiteSpace:"nowrap" }}>✕ Clear</button>
             )}
            </div>
            <input value={itin.cover_image_url&&!itin.cover_image_url.startsWith("data:")?itin.cover_image_url:""} onChange={e=>upd("cover_image_url",e.target.value)}
             placeholder="…or paste image URL here"
             style={{ ...IS, width:"100%", padding:"5px 8px", fontSize:11, boxSizing:"border-box", marginBottom:4 }}/>
            <div style={{ fontSize:10, color:"#64748B" }}>
             Hero image at the top of the PDF. Upload from laptop for best quality — uploaded images embed directly into the PDF.
            </div>
           </>
          );
         })()}
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
       const bannerHidden = day.show_banner === false;
       const imgSrc = bannerHidden || imgErrors[dayIdx]
        ? null
        : (day.image_url || dayImgUrl(day.destination || itin.destination, day.day || dayIdx+1, 800, 280));
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
            <button onClick={() => updDay(dayIdx, "show_banner", false)} style={{ background:"rgba(255,255,255,.2)", border:"1px solid rgba(255,255,255,.4)", borderRadius:6, color:"#fff", fontSize:10, padding:"3px 7px", cursor:"pointer" }}>Hide banner</button>
            <button onClick={() => removeDay(dayIdx)} style={{ background:"rgba(183,28,28,.7)", border:"none", borderRadius:6, color:"#fff", fontSize:10, padding:"3px 8px", cursor:"pointer" }}>✕</button>
           </div>
          </div>
         )}

         <div style={{ padding:14 }}>
          {!imgSrc && (
           <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span style={{ background:"linear-gradient(135deg,#1A6B8A,#0D4D6B)", borderRadius:8, padding:"3px 10px", fontSize:11, fontWeight:700, color:"#fff" }}>Day {day.day}</span>
            <div style={{ display:"flex", gap:6 }}>
             <button onClick={() => { updDay(dayIdx, "show_banner", true); setImgErrors(p => ({ ...p, [dayIdx]: false })); }} style={{ background:"#EEF3F9", border:"1px solid #D5E1EE", borderRadius:6, color:"#1A6B8A", fontSize:11, padding:"3px 9px", cursor:"pointer" }}>Show banner</button>
             <button onClick={() => removeDay(dayIdx)} style={{ background:"#FEE2E2", border:"none", borderRadius:6, color:"#B91C1C", fontSize:11, padding:"3px 9px", cursor:"pointer" }}>Remove Day</button>
            </div>
           </div>
          )}

          {/* Day meta row */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:8 }}>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Title</div>
            <input value={day.title} onChange={e=>updDay(dayIdx,"title",e.target.value)} style={{ ...IS, padding:"6px 9px", fontSize:12 }}/>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Date</div>
            <input type="date" value={day.date} onChange={e=>updDay(dayIdx,"date",e.target.value)} style={{ ...IS, padding:"6px 9px", fontSize:12 }}/>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Destination</div>
            <SelectOrAdd small value={day.destination || itin.destination || ""} options={allDestinations}
             onChange={v=>{
              const img = findDestImg(v);
              setItin(p=>({ ...p, days: p.days.map((d,i)=>i!==dayIdx ? d : { ...d, destination:v, location:"", ...(img?{image_url:img}:{}) }) }));
             }}
             onAddNew={addCustomDest} placeholder="— Destination —"
             loading={refLoading && !allDestinations.length}/>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>City / Location</div>
            <SelectOrAdd small value={day.location||""} options={citiesFor(day.destination || itin.destination || "")}
             onChange={v=>updDay(dayIdx,"location",v)}
             onAddNew={city=>addCustomCity(day.destination || itin.destination || "",city)}
             placeholder="— City —"
             loading={refLoading && !(day.destination || itin.destination)}/>
           </div>
          </div>
          {/* Day Banner Image picker */}
          {(()=>{
           const dayDest = day.destination || itin.destination || "";
           const dayLibImgs = mediaData.filter(m=>(m.type==="destination_photo"||m.type==="property_photo")&&m.destination===dayDest);
           const allDayImgs = dayLibImgs.length>0 ? dayLibImgs : mediaData.filter(m=>m.type==="destination_photo"||m.type==="property_photo");
           return (
            <div style={{ marginBottom:12, background:"#F8FAFC", border:"1px solid #E6ECF5", borderRadius:9, padding:10 }}>
             <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <div style={{ fontSize:10, color:"#64748B", fontWeight:700, textTransform:"uppercase", letterSpacing:.5 }}>🖼 Day Banner Image</div>
              {day.image_url && (
               <button onClick={()=>{ updDay(dayIdx,"image_url",""); setImgErrors(p=>({...p,[dayIdx]:false})); }}
                style={{ background:"#FEE2E2", border:"1px solid #FECACA", borderRadius:6, color:"#B91C1C", fontSize:10, padding:"2px 8px", cursor:"pointer" }}>✕ Clear (use auto)</button>
              )}
             </div>
             {/* Row: library dropdown + upload button */}
             <div style={{ display:"flex", gap:6, marginBottom:6, flexWrap:"wrap", alignItems:"center" }}>
              <select value={day.image_url&&!day.image_url.startsWith("data:")?day.image_url:""} onChange={e=>{ updDay(dayIdx,"image_url",e.target.value); setImgErrors(p=>({...p,[dayIdx]:false})); }}
               style={{ ...IS, flex:"1 1 160px", padding:"5px 8px", fontSize:11 }}>
               <option value="">{allDayImgs.length>0?`— Library (${allDayImgs.length}) —`:"— No library images —"}</option>
               {allDayImgs.map((m,mi)=><option key={mi} value={m.url}>{m.title}{allDayImgs===dayLibImgs?"":` [${m.destination}]`}</option>)}
              </select>
              <label title="Upload from laptop" style={{ background:"#EEF3F9", border:"1px solid #B3D1E8", borderRadius:7, color:"#1A6B8A", fontSize:11, padding:"5px 10px", cursor:"pointer", fontWeight:600, whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:4 }}>
               📁 Upload
               <input type="file" accept="image/*" style={{ display:"none" }} onChange={async e=>{
                const file=e.target.files?.[0]; if(!file) return;
                e.target.value="";
                const dataUrl = await compressImage(file, 1000, 0.83);
                if (!dataUrl) return;
                updDay(dayIdx,"image_url",dataUrl); setImgErrors(p=>({...p,[dayIdx]:false}));
                const dest = day.destination||itin.destination||'';
                const dayNum = day.day||dayIdx+1;
                const saved = await saveUploadedMedia(dataUrl,{ baseTitle:`${dest} Day${dayNum}-`, title:`${dest} Day${dayNum}-1`, type:'destination_photo', destination:dest, category:'day_banner' });
                if (saved) {
                 refreshMedia&&refreshMedia(true);
                 // If backend returned a proper HTTP URL, swap out the base64 so the image persists as a URL
                 if (saved.url && !saved.url.startsWith('data:')) { updDay(dayIdx,"image_url",saved.url); setImgErrors(p=>({...p,[dayIdx]:false})); }
                 toast$&&toast$('Day image saved to media library ✓','success');
                }
               }}/>
              </label>
             </div>
             <input value={day.image_url&&!day.image_url.startsWith("data:")?day.image_url:""} onChange={e=>{ updDay(dayIdx,"image_url",e.target.value); setImgErrors(p=>({...p,[dayIdx]:false})); }}
              placeholder="…or paste image URL here"
              style={{ ...IS, width:"100%", padding:"5px 8px", fontSize:11, boxSizing:"border-box" }}/>
             <div style={{ fontSize:10, color:"#94A3B8", marginTop:4 }}>
              {day.image_url ? (day.image_url.startsWith("data:") ? "✓ Image uploaded from laptop — embeds directly into PDF" : "✓ Custom URL set") : "Auto-generating from destination · day number"}
             </div>
            </div>
           );
          })()}
          {/* Hotel for this day */}
          {(()=>{
           // Show all hotels — destination filter was causing empty dropdowns when hotel city ≠ itinerary destination
           const itinHotels = itin.hotels || [];
           return (
            <div style={{ marginBottom:10 }}>
             <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Night Stay (Hotel)</div>
             <select value={day.hotel||""} onChange={e=>updDay(dayIdx,"hotel",e.target.value)} style={{ ...IS, padding:"6px 9px", fontSize:12, width:"100%" }}>
              <option value="">— Select hotel —</option>
              {itinHotels.map((h,i)=>(
               <option key={i} value={h.name}>{h.name}{h.destination ? ` (${h.destination})` : ""}{h.room_type ? ` · ${h.room_type}` : ""}{h.meals ? ` · ${h.meals}` : ""}</option>
              ))}
             </select>
             {itinHotels.length===0 && (
              <div style={{ fontSize:11, color:"#94A3B8", marginTop:4, display:"flex", alignItems:"center", gap:6 }}>
               No hotels added yet —
               <button onClick={()=>setTab("hotels")} style={{ background:"none", border:"none", color:"#1A6B8A", cursor:"pointer", fontSize:11, fontWeight:700, padding:0, textDecoration:"underline" }}>+ Add in Hotels tab</button>
              </div>
             )}
            </div>
           );
          })()}
          {/* Meals + Transfer Row */}
          <div style={{ display:"flex", gap:8, marginBottom:10, alignItems:"center", background:"#F0FDF4", border:"1px solid #BBF7D0", borderRadius:8, padding:"8px 12px", flexWrap:"wrap" }}>
           <span style={{ fontSize:10, color:"#16a34a", fontWeight:700, textTransform:"uppercase", letterSpacing:.5, marginRight:4 }}>Meals:</span>
           {["breakfast","lunch","dinner"].map(m => (
            <label key={m} style={{ display:"flex", alignItems:"center", gap:4, cursor:"pointer", fontSize:12, color:"#334155", marginRight:8 }}>
             <input type="checkbox" checked={day.meals?.[m]||false} onChange={e=>updDay(dayIdx,"meals",{...(day.meals||{}), [m]:e.target.checked})} style={{ width:14, height:14, accentColor:"#16a34a" }}/>
             {m.charAt(0).toUpperCase()+m.slice(1)}
            </label>
           ))}
           <div style={{ flex:1, display:"flex", gap:6, alignItems:"center", marginLeft:8, minWidth:200 }}>
            <span style={{ fontSize:10, color:"#1A6B8A", fontWeight:700, textTransform:"uppercase", letterSpacing:.5, whiteSpace:"nowrap" }}>Transfer:</span>
            <input value={day.transfer||""} onChange={e=>updDay(dayIdx,"transfer",e.target.value)} placeholder="e.g. Airport → Hotel by AC taxi" style={{ ...IS, flex:1, padding:"4px 8px", fontSize:11 }}/>
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
            const dayDest = day.destination || itin.destination || "";
            const actOptions = activitiesFor(dayDest);
            const actCatalog = (refData?.activities_catalog||[]);
            const actMediaOpts = mediaData.filter(m => m.type==="destination_photo" || m.type==="property_photo");
            return (
             <div key={actIdx} style={{ marginBottom:8, background:"#F8FAFB", border:"1px solid #E6ECF5", borderRadius:9, padding:"10px 12px" }}>
              {/* Row 1: thumbnail/icon | time | title | type | cost | × */}
              <div style={{ display:"flex", gap:7, alignItems:"center", marginBottom:7 }}>
               {act.image_url
                ? <img src={act.image_url} alt={act.title} style={{ width:54, height:54, objectFit:"cover", borderRadius:7, flexShrink:0 }} onError={e=>e.target.style.display="none"}/>
                : <div style={{ width:54, height:54, background:at.bg, color:at.color, borderRadius:7, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0, gap:2 }}>
                   <Icon name={at.icon} size={20}/>
                   <div style={{ fontSize:9, fontWeight:700 }}>{at.label}</div>
                  </div>
               }
               <input type="time" value={act.time} onChange={e=>updActivity(dayIdx,actIdx,"time",e.target.value)} style={{ ...IS, padding:"5px 6px", fontSize:12, width:90, flexShrink:0 }}/>
               <div style={{ flex:1, minWidth:0 }}>
                <SelectOrAdd small value={act.title} options={actOptions}
                 onChange={v=>{
                  const cat = actCatalog.find(a=>a.name===v && (a.destination===dayDest||a.destination===itin.destination)) || actCatalog.find(a=>a.name===v);
                  const updates = { title:v, desc: cat?.description || "" };
                  if (cat?.image_url) updates.image_url = cat.image_url;
                  if (cat?.type) updates.type = cat.type;
                  updActivityFields(dayIdx,actIdx,updates);
                 }}
                 onAddNew={v=>addCustomActivity(dayDest,v)}
                 placeholder="Activity name"
                 loading={refLoading && !actOptions.length}/>
               </div>
               <select value={act.type} onChange={e=>updActivity(dayIdx,actIdx,"type",e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:7, padding:"5px 8px", fontSize:11, color:"#334155", flexShrink:0 }}>
                {Object.entries(ACT_TYPES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
               </select>
               <input type="number" value={act.cost||0} min={0} onChange={e=>updActivity(dayIdx,actIdx,"cost",Number(e.target.value))} placeholder="₹" style={{ ...IS, padding:"5px 7px", fontSize:11, width:80, flexShrink:0 }}/>
               <button onClick={() => removeActivity(dayIdx, actIdx)} style={{ background:"none", border:"none", color:"#94A3B8", cursor:"pointer", fontSize:20, lineHeight:1, padding:0, flexShrink:0 }}>×</button>
              </div>
              {/* Row 2: description + image URL */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:7, paddingLeft:61 }}>
               <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                <input value={act.desc||""} onChange={e=>updActivity(dayIdx,actIdx,"desc",e.target.value)} placeholder="Verbiage / description shown on client itinerary…" style={{ ...IS, padding:"6px 9px", fontSize:12, flex:1 }}/>
                {act.title && act.desc && (
                 <button title="Save description to database for future auto-fill" onClick={async()=>{
                  try {
                   const r = await fetch("/api/activities/description",{ method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ name:act.title, description:act.desc, destination:dayDest }) });
                   if (r.ok){ toast$("Description saved ✓"); refreshRef&&refreshRef(true); }
                   else { const j=await r.json(); toast$(j.error||"Save failed",true); }
                  } catch(e){ toast$("Save failed",true); }
                 }} style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:7, color:"#1D4ED8", fontSize:11, padding:"4px 9px", cursor:"pointer", whiteSpace:"nowrap", fontWeight:600, flexShrink:0 }}>
                  💾 Save desc
                 </button>
                )}
               </div>
               <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                {actMediaOpts.length > 0
                 ? <select value={act.image_url||""} onChange={e=>updActivity(dayIdx,actIdx,"image_url",e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D5E1EE", borderRadius:7, padding:"5px 8px", fontSize:11, color:act.image_url?"#0F172A":"#94A3B8", maxWidth:200 }}>
                    <option value="">— Activity image —</option>
                    {actMediaOpts.map((m,mi)=><option key={mi} value={m.url}>{m.title}</option>)}
                   </select>
                 : <input value={act.image_url||""} onChange={e=>updActivity(dayIdx,actIdx,"image_url",e.target.value)} placeholder="Image URL" style={{ ...IS, padding:"5px 9px", fontSize:11, width:180 }}/>
                }
                {act.image_url && <button onClick={()=>updActivity(dayIdx,actIdx,"image_url","")} style={{ background:"none", border:"none", color:"#94A3B8", cursor:"pointer", fontSize:13, padding:0 }} title="Clear image">✕</button>}
               </div>
              </div>
             </div>
            );
           })}
          </div>
          {/* Agent Notes (internal) */}
          <div style={{ marginTop:8 }}>
           <div style={{ fontSize:10, color:"#78350F", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Agent Notes (internal — not shown to client)</div>
           <textarea value={day.agent_notes||""} onChange={e=>updDay(dayIdx,"agent_notes",e.target.value)} placeholder="Internal notes for this day, supplier reference, special instructions…" style={{ width:"100%", padding:"6px 9px", border:"1px solid #FDE68A", borderRadius:7, fontSize:11, background:"#FFFBEB", color:"#78350F", fontFamily:"inherit", minHeight:44, resize:"vertical", outline:"none", boxSizing:"border-box" }}/>
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
       <div style={{ display:"flex", gap:8 }}>
        <Btn v="secondary" icon="flight" s={{ color:"#1A6B8A" }} onClick={()=>setFlightSearch({ open:true })}>Search & Book Flights</Btn>
        <Btn v="primary" icon="flight" onClick={addFlight}>+ Add Manual</Btn>
       </div>
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
         {[["from","From City"],["to","To City"],["date","Date"]].map(([f,lbl])=>(
          <div key={f}>
           <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>{lbl}</div>
           <Inp type={f==="date"?"date":"text"} value={fl[f]} onChange={e=>updFlight(idx,f,e.target.value)} placeholder={lbl}/>
          </div>
         ))}
         <div>
          <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Airline</div>
          <SelectOrAdd small value={fl.airline} options={airlinesList}
           onChange={v=>updFlight(idx,"airline",v)}
           onAddNew={v=>addToBizList("airlines",v)}
           placeholder="Select…"/>
         </div>
         {[["flight_no","Flight No"],["departure","Departure"],["arrival","Arrival"],["class","Class"]].map(([f,lbl])=>(
          <div key={f}>
           <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>{lbl}</div>
           {f==="class"
            ? <SelectOrAdd small value={fl.class||""} options={flightClasses} onChange={v=>updFlight(idx,"class",v)} onAddNew={v=>addToBizList("flight_classes",v)} placeholder="Select…"/>
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
       <div style={{ display:"flex", gap:8 }}>
        <Btn v="secondary" icon="hotel_star" s={{ color:"#0D5C6B" }} onClick={()=>setHotelSearch({ open:true })}>Search & Book Hotels</Btn>
        <Btn v="primary" icon="hotel_star" onClick={addHotel}>+ Add Manual</Btn>
       </div>
      </div>
      {itin.hotels.length === 0 && (
       <div style={{ background:"#F6F8FC", border:"2px dashed #D5E1EE", borderRadius:12, padding:40, textAlign:"center", color:"#94A3B8", fontSize:13 }}>
        No hotels added yet. Click "+ Add Hotel" or use AI Generate to auto-fill.
       </div>
      )}
      {itin.hotels.map((h, idx) => {
       const hotelPrimary = h.image_url || hotelImgUrl(h.name, itin.destination || h.destination, 1000, 280, idx);
       const hotelFallback = h.image_url || hotelImgUrl((h.name||"hotel")+"alt", itin.destination || h.destination, 1000, 280, idx);
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
          {(()=>{
           // Use itinerary-level destination for vendor/media lookup;
           // h.destination holds a city name and must not override the main destination key.
           const hDest = itin.destination || h.destination || "";
           const hVendorKeys = DEST_VENDOR_KEYS[hDest] || (hDest ? [hDest] : []);
           const hotelVendors = vendors.filter(v =>
            ["Hotel","Resort","Villa"].includes(v.category) &&
            (!hDest || v.destination===hDest || hVendorKeys.includes(v.destination))
           );
           const pickVendor = name => {
            const v = vendors.find(vv=>vv.name===name);
            const dest = v?.destination || hDest;
            const mediaImg = findHotelImg(name, dest);
            setItin(p=>({ ...p, hotels: p.hotels.map((hotel,i) => i!==idx ? hotel : {
             ...hotel, name,
             destination: v?.destination || hotel.destination,
             rating: v?.rating ? Number(v.rating) : hotel.rating,
             ...(mediaImg ? { image_url: mediaImg } : {}),
            })}));
           };
           return (<>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:9, marginBottom:10 }}>
             <div style={{ gridColumn:"1/3" }}>
              <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Hotel / Property Name</div>
              <SelectOrAdd small value={h.name||""} options={hotelVendors.map(v=>v.name)}
               onChange={pickVendor} onAddNew={v=>updHotel(idx,"name",v)}
               placeholder={hotelVendors.length ? "— Select from vendors —" : "Type hotel name…"}/>
              {hotelVendors.length===0 && hDest && <div style={{ fontSize:10, color:"#94A3B8", marginTop:2 }}>No {hDest} vendors — add in Vendors module</div>}
             </div>
             <div>
              <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>City / Destination</div>
              <SelectOrAdd small value={h.destination||""} options={citiesFor(hDest || itin.destination)}
               onChange={v=>updHotel(idx,"destination",v)}
               onAddNew={city=>addCustomCity(hDest || itin.destination, city)}
               placeholder="— Select city —"
               loading={refLoading && !(hDest || itin.destination)}/>
             </div>
             <div>
              <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Meal Plan</div>
              <SelectOrAdd small value={h.meals||""} options={mealPlans} onChange={v=>updHotel(idx,"meals",v)} onAddNew={v=>addToBizList("meal_plans",v)} placeholder="Select…"/>
             </div>
             <div>
              <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Check-in</div>
              <Inp type="date" value={h.check_in||""}
               min={itin.start_date||undefined} max={itin.end_date||undefined}
               onChange={e=>{
                const ci=e.target.value; const updates={check_in:ci};
                const co=h.check_out;
                if(co&&ci&&co<ci) updates.check_out=ci;
                const eff=updates.check_out||co;
                if(ci&&eff) updates.nights=Math.max(1,Math.round((new Date(eff)-new Date(ci))/86400000));
                setItin(p=>({...p,hotels:p.hotels.map((hh,i)=>i!==idx?hh:{...hh,...updates})}));
               }}/>
             </div>
             <div>
              <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Check-out</div>
              <Inp type="date" value={h.check_out||""}
               min={h.check_in||itin.start_date||undefined} max={itin.end_date||undefined}
               onChange={e=>{
                const co=e.target.value; const updates={check_out:co};
                const ci=h.check_in;
                if(ci&&co&&co>=ci) updates.nights=Math.max(1,Math.round((new Date(co)-new Date(ci))/86400000));
                setItin(p=>({...p,hotels:p.hotels.map((hh,i)=>i!==idx?hh:{...hh,...updates})}));
               }}/>
             </div>
             <div>
              <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Star Rating</div>
              <Sel value={h.rating} onChange={e=>updHotel(idx,"rating",Number(e.target.value))}>{[2,3,4,5].map(r=><option key={r} value={r}>{r} Star</option>)}</Sel>
             </div>
             <div>
              <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Nights</div>
              <Inp type="number" min={1} value={h.nights||1} onChange={e=>updHotel(idx,"nights",Number(e.target.value))}/>
             </div>
            </div>
            {/* ── Rooms ── */}
            <div style={{ marginBottom:10 }}>
             <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#1A6B8A", textTransform:"uppercase", letterSpacing:.7 }}>🛏 Rooms</div>
              <button onClick={()=>addHotelRoom(idx)} style={{ background:"#EEF3F9", border:"1px solid #B3D1E8", borderRadius:6, color:"#1A6B8A", fontSize:10, padding:"3px 10px", cursor:"pointer", fontWeight:600 }}>+ Add Room</button>
             </div>
             <div style={{ border:"1px solid #E6ECF5", borderRadius:8, overflow:"hidden", fontSize:11 }}>
              <div style={{ display:"grid", gridTemplateColumns:"2fr 2fr 60px 110px 28px", background:"#F8FAFC", padding:"5px 8px", color:"#64748B", fontWeight:700, fontSize:10, textTransform:"uppercase", letterSpacing:.5, gap:6 }}>
               <div>Room Type</div><div>Bedding</div><div># Rooms</div><div>Cost/Room/Night</div><div/>
              </div>
              {getHotelRooms(h).map((r, ri) => (
               <div key={ri} style={{ display:"grid", gridTemplateColumns:"2fr 2fr 60px 110px 28px", gap:6, padding:"5px 8px", borderTop:"1px solid #F1F5F9", alignItems:"center" }}>
                <SelectOrAdd small value={r.room_type||""} options={roomTypes} onChange={v=>updHotelRoom(idx,ri,"room_type",v)} onAddNew={v=>addToBizList("room_types",v)} placeholder="Type…"/>
                <SelectOrAdd small value={r.bedding||""} options={effectiveBeddingTypes} onChange={v=>updHotelRoom(idx,ri,"bedding",v)} onAddNew={addBeddingType} placeholder="Bedding…"/>
                <Inp type="number" min={1} value={r.num_rooms||1} onChange={e=>updHotelRoom(idx,ri,"num_rooms",Number(e.target.value))} style={{ padding:"5px 6px", fontSize:11 }}/>
                <Inp type="number" min={0} value={r.cost_per_room_night||0} onChange={e=>updHotelRoom(idx,ri,"cost_per_room_night",Number(e.target.value))} style={{ padding:"5px 6px", fontSize:11 }}/>
                <button onClick={()=>removeHotelRoom(idx,ri)} disabled={getHotelRooms(h).length<=1} style={{ background:"none", border:"none", cursor:"pointer", color:"#94A3B8", fontSize:13, padding:0, lineHeight:1 }} title="Remove room">✕</button>
               </div>
              ))}
             </div>
             <div style={{ textAlign:"right", fontSize:10, color:"#64748B", marginTop:4 }}>
              ₹{hotelCostPerNight(h).toLocaleString("en-IN")} / night &nbsp;·&nbsp; Total: ₹{(hotelCostPerNight(h)*(Number(h.nights)||1)).toLocaleString("en-IN")}
             </div>
            </div>
            {/* ── Hotel Photo ── */}
            {(()=>{
             const mediaKey = itin.destination || hDest;
             const byDest = mediaData.filter(m=>(m.type==="property_photo"||m.type==="destination_photo")&&m.destination===mediaKey);
             const hotelImgs = byDest.length>0 ? byDest : mediaData.filter(m=>m.type==="property_photo"||m.type==="destination_photo");
             const am = addMediaState[idx] || {};
             const currentHotelImg = h.image_url || hotelImgUrl(h.name, itin.destination||h.destination, 860, 180, idx);
             return (
              <div style={{ marginTop:10, borderTop:"1px solid #E6ECF5", paddingTop:10 }}>
               <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <div style={{ fontSize:10, color:"#64748B", fontWeight:700, textTransform:"uppercase", letterSpacing:.5 }}>🏨 Hotel Photo</div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                 {h.image_url && <button onClick={()=>updHotel(idx,"image_url","")} style={{ background:"#FEE2E2", border:"1px solid #FECACA", borderRadius:6, color:"#B91C1C", fontSize:10, padding:"2px 8px", cursor:"pointer" }}>✕ Clear</button>}
                 <button onClick={()=>refreshMedia&&refreshMedia(true)} style={{ background:"none", border:"1px solid #D5E1EE", borderRadius:6, color:"#1A6B8A", fontSize:10, padding:"2px 8px", cursor:"pointer", fontWeight:600 }}>↻ Refresh</button>
                </div>
               </div>
               {/* Always-visible preview */}
               <div style={{ position:"relative", height:100, borderRadius:8, overflow:"hidden", background:"#E6ECF5", marginBottom:8 }}>
                <img src={currentHotelImg} alt="hotel" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} onError={e=>e.currentTarget.style.opacity="0"}/>
                {h.image_url && <div style={{ position:"absolute", bottom:5, left:8, background:"rgba(0,0,0,.5)", color:"#fff", fontSize:9, padding:"2px 6px", borderRadius:4 }}>Custom image set ✓</div>}
                {!h.image_url && <div style={{ position:"absolute", bottom:5, left:8, background:"rgba(0,0,0,.4)", color:"#fff", fontSize:9, padding:"2px 6px", borderRadius:4 }}>Auto-generated</div>}
               </div>
               {/* Controls row: library dropdown + upload from laptop + paste URL */}
               <div style={{ display:"flex", gap:6, marginBottom:6, flexWrap:"wrap" }}>
                <select value={h.image_url||""} onChange={e=>updHotel(idx,"image_url",e.target.value)}
                 style={{ ...IS, flex:"1 1 160px", padding:"5px 8px", fontSize:11 }}>
                 <option value="">{hotelImgs.length>0?`— Library (${hotelImgs.length}) —`:"— No library images —"}</option>
                 {hotelImgs.map((m,mi)=><option key={mi} value={m.url}>{m.title}{m.vendor_name?` · ${m.vendor_name}`:""}{m.category?` (${m.category})`:""}</option>)}
                </select>
                <label title="Upload from your laptop" style={{ background:"#EEF3F9", border:"1px solid #B3D1E8", borderRadius:7, color:"#1A6B8A", fontSize:11, padding:"5px 10px", cursor:"pointer", fontWeight:600, whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:4 }}>
                 📁 Upload
                 <input type="file" accept="image/*" style={{ display:"none" }} onChange={async e=>{
                  const file=e.target.files?.[0]; if(!file) return;
                  e.target.value="";
                  const dataUrl = await compressImage(file, 960, 0.82);
                  if (!dataUrl) return;
                  updHotel(idx,"image_url",dataUrl);
                  const hotelBase = (h.name||'Hotel')+' · '+(itin.destination||hDest||'');
                  const saved = await saveUploadedMedia(dataUrl,{ baseTitle:`${hotelBase} `, title:`${hotelBase} 1`, type:'property_photo', destination:itin.destination||hDest||'', category:'hotel_exterior', vendor_name:h.name||'' });
                  if (saved) { refreshMedia&&refreshMedia(true); toast$&&toast$('Hotel photo saved to media library ✓','success'); }
                 }}/>
                </label>
               </div>
               <input value={h.image_url&&!h.image_url.startsWith("data:")?h.image_url:""} onChange={e=>updHotel(idx,"image_url",e.target.value)}
                placeholder="…or paste image URL here"
                style={{ ...IS, width:"100%", padding:"5px 8px", fontSize:11, boxSizing:"border-box", marginBottom:6 }}/>
               {/* Add to library */}
               <button onClick={()=>updAddMedia(idx,"open",!am.open)}
                style={{ background:"none", border:"1px dashed #94A3B8", borderRadius:7, color:"#64748B", fontSize:11, padding:"4px 10px", cursor:"pointer", width:"100%", textAlign:"left" }}>
                {am.open ? "▲ Cancel" : "＋ Save to media library for reuse"}
               </button>
               {am.open && (
                <div style={{ background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:8, padding:10, marginTop:6, display:"grid", gridTemplateColumns:"1fr 1fr", gap:7 }}>
                 <div style={{ gridColumn:"1/-1", fontSize:10, color:"#0369A1", fontWeight:600, marginBottom:4 }}>Save this image to media library for reuse in future itineraries</div>
                 <div>
                  <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Title *</div>
                  <input value={am.title||""} onChange={e=>updAddMedia(idx,"title",e.target.value)} placeholder="e.g. Park Hyatt Pool View" style={{ ...IS, width:"100%", padding:"5px 8px", fontSize:11, boxSizing:"border-box" }}/>
                 </div>
                 <div>
                  <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Category</div>
                  <select value={am.category||"hotel_exterior"} onChange={e=>updAddMedia(idx,"category",e.target.value)} style={{ ...IS, width:"100%", padding:"5px 8px", fontSize:11 }}>
                   {["hotel_exterior","hotel_room","pool","dining","amenities","beach","city","nature","adventure"].map(c=><option key={c} value={c}>{c.replace(/_/g," ")}</option>)}
                  </select>
                 </div>
                 <div style={{ gridColumn:"1/-1" }}>
                  <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Image URL *</div>
                  <input value={am.url||""} onChange={e=>updAddMedia(idx,"url",e.target.value)} placeholder="https://…" style={{ ...IS, width:"100%", padding:"5px 8px", fontSize:11, boxSizing:"border-box" }}/>
                 </div>
                 {am.url && <div style={{ gridColumn:"1/-1" }}><img src={am.url} alt="preview" style={{ width:"100%", height:60, objectFit:"cover", borderRadius:6 }} onError={e=>e.target.style.display="none"}/></div>}
                 <div style={{ gridColumn:"1/-1", display:"flex", justifyContent:"flex-end" }}>
                  <button onClick={()=>saveMediaEntry(idx,hDest,h.name)} style={{ background:"#0369A1", color:"#fff", border:"none", borderRadius:8, padding:"6px 16px", fontSize:12, fontWeight:700, cursor:"pointer" }}>Save to Library &amp; Use</button>
                 </div>
                </div>
               )}
              </div>
             );
            })()}
           </>);
          })()}
          <div style={{ background:"#EEF3F9", borderRadius:8, padding:"8px 12px", fontSize:13, color:"#0F172A", textAlign:"right" }}>
           Hotel subtotal: <strong>{fmtINR(hotelCostPerNight(h) * (Number(h.nights)||1))}</strong> ({h.nights || 1} nights × {fmtINR(hotelCostPerNight(h))}/night)
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

    {/* ─── INCLUSIONS / EXCLUSIONS TAB ─── */}
    {tab==="inclusions" && (()=>{
     const panels = [
      { label:"Inclusions", key:"inclusions", color:"#16a34a", bg:"#F0FDF4", border:"#BBF7D0", dbKey:"inclusions_by_destination", endpoint:"/api/reference/inclusion" },
      { label:"Exclusions", key:"exclusions", color:"#b45309", bg:"#FFFBEB", border:"#FDE68A", dbKey:"exclusions_by_destination", endpoint:"/api/reference/exclusion" },
     ];
     const hasIncData = !!(refData?.inclusions_by_destination);
     const forceRefresh = () => refreshRef && refreshRef(true);
     const availableDestinations = Object.keys(refData?.inclusions_by_destination || {});
     return (
      <div style={{ maxWidth:800 }}>
       {/* Top bar: status + refresh */}
       <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, gap:12, flexWrap:"wrap" }}>
        <div style={{ fontSize:12, color:"#64748B" }}>
         {refLoading ? "⏳ Loading data from server…"
          : !refData ? "⚠ No reference data — is the backend server running?"
          : !hasIncData ? "⚠ Inclusions data not in cache — restart backend and click Refresh"
          : `✓ ${availableDestinations.length} destinations loaded`}
        </div>
        <button onClick={forceRefresh} disabled={refLoading}
         style={{ background:"#1A6B8A", color:"#fff", border:"none", borderRadius:7, padding:"5px 14px", fontSize:11, cursor:refLoading?"not-allowed":"pointer", fontWeight:700, opacity:refLoading?.6:1 }}>
         {refLoading ? "Refreshing…" : "↻ Refresh Reference Data"}
        </button>
       </div>

       {/* Destination not set */}
       {!itin.destination && (
        <div style={{ background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:9, padding:"12px 16px", marginBottom:16, fontSize:13, color:"#0369A1" }}>
         Go to <strong>Overview</strong> tab and select a Destination first.
        </div>
       )}

       {/* Destination set but no match in DB — show available keys to help debug */}
       {itin.destination && hasIncData && !refData.inclusions_by_destination[itin.destination] && (
        <div style={{ background:"#FEF9C3", border:"1px solid #FDE047", borderRadius:9, padding:"10px 14px", marginBottom:14, fontSize:12, color:"#713F12" }}>
         No data for <strong>"{itin.destination}"</strong> in DB.
         Available: {availableDestinations.slice(0,8).join(", ")}{availableDestinations.length>8 ? ` +${availableDestinations.length-8} more` : ""}
        </div>
       )}

       <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18 }}>
        {panels.map(({ label, key, color, bg, border, dbKey, endpoint }) => {
         const destItems = refData?.[dbKey]?.[itin.destination] || [];
         const selected  = itin[key] || [];
         const toggle = item => {
          const next = selected.includes(item) ? selected.filter(x=>x!==item) : [...selected, item];
          upd(key, next);
         };
         const addNew = text => {
          if (!text) return;
          if (itin.destination) {
           fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ destination:itin.destination, text }) })
            .then(()=>refreshRef && refreshRef())
            .catch(()=>{});
          }
          upd(key, selected.includes(text) ? selected : [...selected, text]);
         };
         const customSelected = selected.filter(s => !destItems.includes(s));
         // Full list across all destinations for the pick-from-list dropdown
         const allDbItems = [...new Set(Object.values(refData?.[dbKey]||{}).flat())].filter(i => !selected.includes(i));
         return (
          <div key={key} style={{ background:bg, border:`1px solid ${border}`, borderRadius:12, padding:16 }}>
           <div style={{ fontWeight:700, color, fontSize:13, marginBottom:10 }}>
            {label}
            {selected.length > 0 && <span style={{ marginLeft:8, fontWeight:400, fontSize:11 }}>({selected.length} selected)</span>}
           </div>
           {/* Quick-pick dropdown from full DB list */}
           {allDbItems.length > 0 && (
            <select value="" onChange={e=>{ if(e.target.value) toggle(e.target.value); }}
             style={{ width:"100%", background:"#fff", border:`1px solid ${border}`, borderRadius:7, padding:"6px 8px", fontSize:11, color:"#334155", marginBottom:8, cursor:"pointer", outline:"none" }}>
             <option value="">+ Pick from list…</option>
             {allDbItems.map((item,i)=><option key={i} value={item}>{item}</option>)}
            </select>
           )}
           {destItems.length === 0 && itin.destination && hasIncData && (
            <div style={{ fontSize:11, color:"#94A3B8", marginBottom:8 }}>
             No standard {label.toLowerCase()} for <strong>{itin.destination}</strong>. Add custom below.
            </div>
           )}
           {!hasIncData && (
            <div style={{ fontSize:11, color:"#94A3B8", marginBottom:8 }}>
             Data not loaded — restart backend then click ↻ Refresh above.
            </div>
           )}
           <div style={{ maxHeight:240, overflowY:"auto" }}>
            {destItems.map((item,i) => (
             <label key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", cursor:"pointer", marginBottom:7, fontSize:12, color:"#334155", lineHeight:1.4 }}>
              <input type="checkbox" checked={selected.includes(item)} onChange={()=>toggle(item)} style={{ marginTop:2, accentColor:color, flexShrink:0 }}/>
              <span>{item}</span>
             </label>
            ))}
            {customSelected.map((item,i) => (
             <label key={`c${i}`} style={{ display:"flex", gap:8, alignItems:"flex-start", cursor:"pointer", marginBottom:7, fontSize:12, color:"#334155", lineHeight:1.4, opacity:.8 }}>
              <input type="checkbox" checked onChange={()=>toggle(item)} style={{ marginTop:2, accentColor:color, flexShrink:0 }}/>
              <span>{item} <em style={{ color:"#94A3B8", fontSize:10 }}>(custom)</em></span>
             </label>
            ))}
           </div>
           <AddNewInline placeholder={`Add new ${label.toLowerCase()}…`} onAdd={addNew} color={color}/>
          </div>
         );
        })}
       </div>
      </div>
     );
    })()}

    {/* ─── COST SHEET TAB ─── */}
    {tab==="costsheet" && (() => {
     const markup = Number(itin.markup_pct||22);
     const baseTotal = grandTotal;
     const sellingCalc = Math.round(baseTotal * (1 + markup/100));
     const sellingPrice = Number(itin.selling_price||0) || sellingCalc;
     const pax = Number(itin.pax||1);
     const perPerson = pax > 0 ? Math.round(sellingPrice / pax) : 0;
     const profit = sellingPrice - baseTotal;
     const costRows = [
      ...((itin.flights||[]).map((f,i)=>({ cat:"Flight", desc:`${f.airline||"Flight"} ${f.flight_no||""} (${f.from||""}→${f.to||""})`, cost:Number(f.cost)||0 }))),
      ...((Array.isArray(itin.hotels)?itin.hotels:[]).map(h=>({ cat:"Hotel", desc:`${h.name||"Hotel"} × ${h.nights||1} nights`, cost:(Number(h.cost_per_night)||0)*(Number(h.nights)||1) }))),
      ...((itin.days||[]).flatMap(d=>(d.activities||[]).filter(a=>Number(a.cost)>0).map(a=>({ cat:"Activity", desc:a.title||"Activity", cost:Number(a.cost)||0 })))),
     ];
     const catColor = { Flight:"#7c3aed", Hotel:"#1A6B8A", Activity:"#d97706" };
     return (
      <div style={{ maxWidth:720 }}>
       {/* Cost breakdown table */}
       <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, overflow:"hidden", marginBottom:16 }}>
        <div style={{ background:"#F6F8FC", padding:"10px 14px", fontWeight:700, color:"#0F172A", fontSize:13 }}>Component Costs (Supplier / Purchase Price)</div>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
         <thead><tr style={{ background:"#EEF3F9" }}>
          {["Category","Description","Cost (INR)"].map(h=><th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:10, color:"#475569", fontWeight:700, textTransform:"uppercase" }}>{h}</th>)}
         </tr></thead>
         <tbody>
          {costRows.length === 0 && <tr><td colSpan={3} style={{ padding:"20px", textAlign:"center", color:"#94a3b8", fontSize:12 }}>No costs entered yet. Add costs in Flights, Hotels, and Activities.</td></tr>}
          {costRows.map((r,i) => (
           <tr key={i} style={{ borderBottom:"1px solid #EEF3F9" }}>
            <td style={{ padding:"8px 12px" }}><span style={{ background:(catColor[r.cat]||"#64748b")+"18", color:catColor[r.cat]||"#64748b", borderRadius:5, padding:"2px 8px", fontSize:11, fontWeight:700 }}>{r.cat}</span></td>
            <td style={{ padding:"8px 12px", fontSize:12, color:"#334155" }}>{r.desc}</td>
            <td style={{ padding:"8px 12px", fontWeight:600, color:"#0F172A" }}>{fmtINR(r.cost)}</td>
           </tr>
          ))}
         </tbody>
         <tfoot>
          <tr style={{ background:"#F0F4F8" }}>
           <td colSpan={2} style={{ padding:"10px 12px", fontWeight:700, color:"#0F172A" }}>Total Base Cost</td>
           <td style={{ padding:"10px 12px", fontWeight:800, color:"#1A6B8A", fontSize:15 }}>{fmtINR(baseTotal)}</td>
          </tr>
         </tfoot>
        </table>
       </div>
       {/* Markup + Selling price */}
       <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:16 }}>
        <F label="Markup %">
         <Inp type="number" min={0} max={200} value={itin.markup_pct||22} onChange={e=>upd("markup_pct",Number(e.target.value))} placeholder="22"/>
        </F>
        <F label="Selling Price (Override ₹)">
         <Inp type="number" min={0} value={itin.selling_price||""} onChange={e=>upd("selling_price",Number(e.target.value))} placeholder={String(sellingCalc)}/>
        </F>
        <F label="Adults (Pax)">
         <Inp type="number" min={1} value={itin.pax||2} onChange={e=>upd("pax",Number(e.target.value))}/>
        </F>
       </div>
       {/* Summary boxes */}
       <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12 }}>
        {[
         { label:"Base Cost",    value:fmtINR(baseTotal),   color:"#1A6B8A", bg:"#E0F7FA" },
         { label:"Selling Price",value:fmtINR(sellingPrice),color:"#16a34a", bg:"#F0FDF4" },
         { label:"Profit",       value:fmtINR(profit),      color: profit>=0?"#16a34a":"#dc2626", bg: profit>=0?"#F0FDF4":"#FEF2F2" },
         { label:"Per Person",   value:fmtINR(perPerson),   color:"#7c3aed", bg:"#F3E8FF" },
        ].map(s=>(
         <div key={s.label} style={{ background:s.bg, border:`1px solid ${s.color}33`, borderRadius:10, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:10, color:"#64748b", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>{s.label}</div>
          <div style={{ fontSize:18, fontWeight:800, color:s.color }}>{s.value}</div>
         </div>
        ))}
       </div>
       <div style={{ fontSize:11, color:"#94a3b8", marginTop:10 }}>Cost sheet is internal only — not shown to clients. Use selling price to generate invoice.</div>
      </div>
     );
    })()}

    {/* ─── OPTION 2 TAB ─── */}
    {tab==="option2" && (
     <div style={{ maxWidth:780 }}>
      {/* Toggle + explanation */}
      <div style={{ background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:12, padding:16, marginBottom:18 }}>
       <label style={{ display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}>
        <input type="checkbox" checked={!!itin.option2_enabled} onChange={e=>upd("option2_enabled",e.target.checked)} style={{ width:18, height:18, accentColor:"#1A6B8A" }}/>
        <div>
         <div style={{ fontWeight:700, fontSize:14, color:"#0F172A" }}>Enable Option 2 (Dual-Option Proposal)</div>
         <div style={{ fontSize:12, color:"#475569", marginTop:2 }}>When enabled, the PDF will show two package options (e.g. Standard vs Luxury) side-by-side so the customer can choose.</div>
        </div>
       </label>
      </div>

      {itin.option2_enabled && (<>
       {/* Package label names */}
       <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:18 }}>
        <div>
         <div style={{ fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Option 1 Label</div>
         <Inp value={itin.option1_title||"Standard Package"} onChange={e=>upd("option1_title",e.target.value)} placeholder="Standard Package"/>
        </div>
        <div>
         <div style={{ fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Option 2 Label</div>
         <Inp value={itin.option2_title||"Luxury Package"} onChange={e=>upd("option2_title",e.target.value)} placeholder="Luxury Package"/>
        </div>
       </div>

       {/* Option 2 price override */}
       <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:16, marginBottom:18 }}>
        <div style={{ fontWeight:700, fontSize:13, color:"#0F172A", marginBottom:12 }}>Option 2 Pricing</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
         <div>
          <div style={{ fontSize:11, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:4 }}>Option 2 Total Price (₹)</div>
          <Inp type="number" min={0} value={itin.option2_price||0} onChange={e=>upd("option2_price",Number(e.target.value))} placeholder="e.g. 180000"/>
         </div>
         <div style={{ background:"#F8FAFC", borderRadius:9, padding:"10px 14px", display:"flex", flexDirection:"column", justifyContent:"center" }}>
          <div style={{ fontSize:11, color:"#64748B" }}>Option 1 (current itinerary total)</div>
          <div style={{ fontWeight:800, fontSize:16, color:"#1A6B8A", marginTop:3 }}>{(itin.selling_price||grandTotal||0).toLocaleString("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:0 })}</div>
         </div>
        </div>
       </div>

       {/* Option 2 Hotels */}
       <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:16, marginBottom:18 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
         <div style={{ fontWeight:700, fontSize:13, color:"#0F172A" }}>Option 2 Hotels <span style={{ fontWeight:400, fontSize:11, color:"#64748B" }}>(alternative accommodation)</span></div>
         <Btn v="primary" icon="hotel_star" onClick={addOption2Hotel}>+ Add Hotel</Btn>
        </div>
        {(itin.option2_hotels||[]).length === 0 && (
         <div style={{ background:"#F6F8FC", border:"2px dashed #D5E1EE", borderRadius:10, padding:28, textAlign:"center", color:"#94A3B8", fontSize:13 }}>
          Add the alternate hotels for this package option.
         </div>
        )}
        {(itin.option2_hotels||[]).map((h,idx) => (
         <div key={idx} style={{ border:"1px solid #E6ECF5", borderRadius:10, padding:14, marginBottom:12, background:"#FAFCFF" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
           <span style={{ fontWeight:600, fontSize:13, color:"#1A6B8A" }}>{h.name||"Hotel Name"} {h.destination?`· ${h.destination}`:""}</span>
           <button onClick={()=>removeOption2Hotel(idx)} style={{ background:"#FEE2E2", border:"none", borderRadius:6, color:"#B91C1C", fontSize:11, padding:"3px 9px", cursor:"pointer" }}>Remove</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:9, marginBottom:10 }}>
           <div style={{ gridColumn:"1/3" }}>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Hotel / Property Name</div>
            {(()=>{
             const o2Dest = itin.destination || h.destination || "";
             const o2VendorKeys = DEST_VENDOR_KEYS[o2Dest] || (o2Dest ? [o2Dest] : []);
             const o2HotelVendors = vendors.filter(v =>
              ["Hotel","Resort","Villa"].includes(v.category) &&
              (!o2Dest || v.destination===o2Dest || o2VendorKeys.includes(v.destination))
             );
             return (
              <SelectOrAdd small value={h.name||""}
               options={o2HotelVendors.map(v=>v.name)}
               onChange={v=>{ const vd=vendors.find(vv=>vv.name===v); setItin(p=>({...p,option2_hotels:(p.option2_hotels||[]).map((hh,i)=>i!==idx?hh:{...hh,name:v,destination:vd?.destination||hh.destination,rating:vd?.rating?Number(vd.rating):hh.rating})})); }}
               onAddNew={v=>updOption2Hotel(idx,"name",v)}
               placeholder={o2HotelVendors.length ? "— Select from vendors —" : "Type hotel name…"}/>
             );
            })()}
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>City / Destination</div>
            <SelectOrAdd small value={h.destination||""} options={citiesFor(itin.destination)}
             onChange={v=>updOption2Hotel(idx,"destination",v)}
             onAddNew={city=>addCustomCity(itin.destination, city)}
             placeholder="— Select city —"/>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Meal Plan</div>
            <SelectOrAdd small value={h.meals||""} options={mealPlans} onChange={v=>updOption2Hotel(idx,"meals",v)} onAddNew={v=>addToBizList("meal_plans",v)} placeholder="Select…"/>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Star Rating</div>
            <Sel value={h.rating||4} onChange={e=>updOption2Hotel(idx,"rating",Number(e.target.value))}>
             {[2,3,4,5].map(r=><option key={r} value={r}>{r} Star</option>)}
            </Sel>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Check-in</div>
            <Inp type="date" value={h.check_in||""}
             min={itin.start_date||undefined} max={itin.end_date||undefined}
             onChange={e=>{
              const ci=e.target.value; const updates={check_in:ci};
              const co=h.check_out;
              if(co&&ci&&co<ci) updates.check_out=ci;
              const eff=updates.check_out||co;
              if(ci&&eff) updates.nights=Math.max(1,Math.round((new Date(eff)-new Date(ci))/86400000));
              setItin(p=>({...p,option2_hotels:(p.option2_hotels||[]).map((hh,i)=>i!==idx?hh:{...hh,...updates})}));
             }}/>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Check-out</div>
            <Inp type="date" value={h.check_out||""}
             min={h.check_in||itin.start_date||undefined} max={itin.end_date||undefined}
             onChange={e=>{
              const co=e.target.value; const updates={check_out:co};
              const ci=h.check_in;
              if(ci&&co&&co>=ci) updates.nights=Math.max(1,Math.round((new Date(co)-new Date(ci))/86400000));
              setItin(p=>({...p,option2_hotels:(p.option2_hotels||[]).map((hh,i)=>i!==idx?hh:{...hh,...updates})}));
             }}/>
           </div>
           <div>
            <div style={{ fontSize:10, color:"#64748B", textTransform:"uppercase", letterSpacing:.5, marginBottom:3 }}>Nights</div>
            <Inp type="number" min={1} value={h.nights||1} onChange={e=>updOption2Hotel(idx,"nights",Number(e.target.value))}/>
           </div>
          </div>
          {/* Rooms */}
          <div style={{ marginBottom:10 }}>
           <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#1A6B8A", textTransform:"uppercase", letterSpacing:.7 }}>🛏 Rooms</div>
            <button onClick={()=>addO2HotelRoom(idx)} style={{ background:"#EEF3F9", border:"1px solid #B3D1E8", borderRadius:6, color:"#1A6B8A", fontSize:10, padding:"3px 10px", cursor:"pointer", fontWeight:600 }}>+ Add Room</button>
           </div>
           <div style={{ border:"1px solid #E6ECF5", borderRadius:8, overflow:"hidden", fontSize:11 }}>
            <div style={{ display:"grid", gridTemplateColumns:"2fr 2fr 60px 110px 28px", background:"#F8FAFC", padding:"5px 8px", color:"#64748B", fontWeight:700, fontSize:10, textTransform:"uppercase", letterSpacing:.5, gap:6 }}>
             <div>Room Type</div><div>Bedding</div><div># Rooms</div><div>Cost/Room/Night</div><div/>
            </div>
            {getO2HotelRooms(h).map((r, ri) => (
             <div key={ri} style={{ display:"grid", gridTemplateColumns:"2fr 2fr 60px 110px 28px", gap:6, padding:"5px 8px", borderTop:"1px solid #F1F5F9", alignItems:"center" }}>
              <SelectOrAdd small value={r.room_type||""} options={roomTypes} onChange={v=>updO2HotelRoom(idx,ri,"room_type",v)} onAddNew={v=>addToBizList("room_types",v)} placeholder="Type…"/>
              <SelectOrAdd small value={r.bedding||""} options={effectiveBeddingTypes} onChange={v=>updO2HotelRoom(idx,ri,"bedding",v)} onAddNew={addBeddingType} placeholder="Bedding…"/>
              <Inp type="number" min={1} value={r.num_rooms||1} onChange={e=>updO2HotelRoom(idx,ri,"num_rooms",Number(e.target.value))} style={{ padding:"5px 6px", fontSize:11 }}/>
              <Inp type="number" min={0} value={r.cost_per_room_night||0} onChange={e=>updO2HotelRoom(idx,ri,"cost_per_room_night",Number(e.target.value))} style={{ padding:"5px 6px", fontSize:11 }}/>
              <button onClick={()=>removeO2HotelRoom(idx,ri)} disabled={getO2HotelRooms(h).length<=1} style={{ background:"none", border:"none", cursor:"pointer", color:"#94A3B8", fontSize:13, padding:0, lineHeight:1 }}>✕</button>
             </div>
            ))}
           </div>
           <div style={{ textAlign:"right", fontSize:10, color:"#64748B", marginTop:4 }}>
            ₹{hotelCostPerNight(h).toLocaleString("en-IN")} / night &nbsp;·&nbsp; Total: ₹{(hotelCostPerNight(h)*(Number(h.nights)||1)).toLocaleString("en-IN")}
           </div>
          </div>
          {/* Option 2 Hotel Photo */}
          {(()=>{
           const o2Dest = itin.destination || h.destination || "";
           const o2HotelImgs = mediaData.filter(m=>(m.type==="property_photo"||m.type==="destination_photo")&&(m.destination===o2Dest||!o2Dest));
           return (
            <div style={{ marginTop:10, borderTop:"1px solid #E6ECF5", paddingTop:10 }}>
             <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <div style={{ fontSize:10, color:"#64748B", fontWeight:700, textTransform:"uppercase", letterSpacing:.5 }}>🏨 Hotel Photo</div>
              {h.image_url && <button onClick={()=>updOption2Hotel(idx,"image_url","")} style={{ background:"#FEE2E2", border:"1px solid #FECACA", borderRadius:6, color:"#B91C1C", fontSize:10, padding:"2px 8px", cursor:"pointer" }}>✕ Clear</button>}
             </div>
             <div style={{ position:"relative", height:90, borderRadius:8, overflow:"hidden", background:"#E6ECF5", marginBottom:8 }}>
              <img src={h.image_url || hotelImgUrl(h.name, o2Dest, 860, 180, idx+100)} alt="hotel" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} onError={e=>e.currentTarget.style.opacity="0"}/>
              {h.image_url && <div style={{ position:"absolute", bottom:4, left:7, background:"rgba(0,0,0,.5)", color:"#fff", fontSize:9, padding:"2px 6px", borderRadius:4 }}>Custom ✓</div>}
             </div>
             <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              <select value={h.image_url||""} onChange={e=>updOption2Hotel(idx,"image_url",e.target.value)}
               style={{ ...IS, flex:"1 1 160px", padding:"5px 8px", fontSize:11 }}>
               <option value="">{o2HotelImgs.length>0?`— Library (${o2HotelImgs.length}) —`:"— No library images —"}</option>
               {o2HotelImgs.map((m,mi)=><option key={mi} value={m.url}>{m.title}{m.vendor_name?` · ${m.vendor_name}`:""}</option>)}
              </select>
              <label style={{ background:"#EEF3F9", border:"1px solid #B3D1E8", borderRadius:7, color:"#1A6B8A", fontSize:11, padding:"5px 10px", cursor:"pointer", fontWeight:600, whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:4 }}>
               📁 Upload
               <input type="file" accept="image/*" style={{ display:"none" }} onChange={async e=>{
                const file=e.target.files?.[0]; if(!file) return;
                e.target.value="";
                const dataUrl = await compressImage(file, 960, 0.82);
                if (!dataUrl) return;
                updOption2Hotel(idx,"image_url",dataUrl);
                const base = (h.name||'Hotel')+' · '+(o2Dest||'Opt2');
                const saved = await saveUploadedMedia(dataUrl,{ baseTitle:`${base} `, title:`${base} 1`, type:'property_photo', destination:o2Dest, category:'hotel_exterior', vendor_name:h.name||'' });
                if (saved) { refreshMedia&&refreshMedia(true); toast$&&toast$('Hotel photo saved ✓'); }
               }}/>
              </label>
             </div>
             <input value={h.image_url&&!h.image_url.startsWith("data:")?h.image_url:""} onChange={e=>updOption2Hotel(idx,"image_url",e.target.value)} placeholder="Or paste image URL…" style={{ ...IS, marginTop:5, padding:"5px 8px", fontSize:11, width:"100%", boxSizing:"border-box" }}/>
            </div>
           );
          })()}
          <div style={{ background:"#EEF3F9", borderRadius:8, padding:"7px 12px", fontSize:12, color:"#0F172A", textAlign:"right" }}>
           Hotel subtotal: <strong>{fmtINR(hotelCostPerNight(h)*(Number(h.nights)||1))}</strong>
          </div>
         </div>
        ))}
        {(itin.option2_hotels||[]).length > 0 && (
         <div style={{ background:"#EEF3F9", borderRadius:9, padding:"10px 14px", fontSize:13, fontWeight:700, color:"#0F172A", textAlign:"right" }}>
          Total Option 2 Hotel Cost: {option2HotelTotal.toLocaleString("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0})}
         </div>
        )}
       </div>

       {/* Option 2 Inclusions / Exclusions — same DB-backed checkboxes as Option 1 */}
       <div style={{ background:"#FFFFFF", border:"1px solid #E6ECF5", borderRadius:12, padding:16 }}>
        <div style={{ fontWeight:700, fontSize:13, color:"#0F172A", marginBottom:14 }}>Option 2 Inclusions &amp; Exclusions</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
         {[
          { key:"option2_inclusions", label:"Inclusions", color:"#16a34a", bg:"#F0FDF4", border:"#BBF7D0", dbKey:"inclusions_by_destination", endpoint:"/api/reference/inclusion" },
          { key:"option2_exclusions", label:"Exclusions", color:"#b45309", bg:"#FFFBEB", border:"#FDE68A", dbKey:"exclusions_by_destination", endpoint:"/api/reference/exclusion" },
         ].map(({ key, label, color, bg, border, dbKey, endpoint }) => {
          const destItems = refData?.[dbKey]?.[itin.destination] || [];
          const selected = itin[key] || [];
          const toggle = item => upd(key, selected.includes(item) ? selected.filter(x=>x!==item) : [...selected, item]);
          const addNew = text => {
           if (!text) return;
           if (itin.destination) {
            fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ destination:itin.destination, text }) })
             .then(()=>refreshRef && refreshRef()).catch(()=>{});
           }
           upd(key, selected.includes(text) ? selected : [...selected, text]);
          };
          const customSelected = selected.filter(s => !destItems.includes(s));
          return (
           <div key={key} style={{ background:bg, border:`1px solid ${border}`, borderRadius:12, padding:16 }}>
            <div style={{ fontWeight:700, color, fontSize:13, marginBottom:10 }}>
             {label}
             {selected.length > 0 && <span style={{ marginLeft:8, fontWeight:400, fontSize:11 }}>({selected.length} selected)</span>}
            </div>
            {/* Quick-pick dropdown from full DB list */}
            {(()=>{ const allO2Items = [...new Set(Object.values(refData?.[dbKey]||{}).flat())].filter(i=>!selected.includes(i)); return allO2Items.length>0 && (
             <select value="" onChange={e=>{ if(e.target.value) toggle(e.target.value); }}
              style={{ width:"100%", background:"#fff", border:`1px solid ${border}`, borderRadius:7, padding:"6px 8px", fontSize:11, color:"#334155", marginBottom:8, cursor:"pointer", outline:"none" }}>
              <option value="">+ Pick from list…</option>
              {allO2Items.map((item,i)=><option key={i} value={item}>{item}</option>)}
             </select>
            ); })()}
            {destItems.length === 0 && itin.destination && refData?.inclusions_by_destination && (
             <div style={{ fontSize:11, color:"#94A3B8", marginBottom:8 }}>No standard {label.toLowerCase()} for <strong>{itin.destination}</strong>. Add custom below.</div>
            )}
            {!refData?.inclusions_by_destination && (
             <div style={{ fontSize:11, color:"#94A3B8", marginBottom:8 }}>Data not loaded — restart backend then click ↻ Refresh in Inclusions tab.</div>
            )}
            <div style={{ maxHeight:240, overflowY:"auto" }}>
             {destItems.map((item,i) => (
              <label key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", cursor:"pointer", marginBottom:7, fontSize:12, color:"#334155", lineHeight:1.4 }}>
               <input type="checkbox" checked={selected.includes(item)} onChange={()=>toggle(item)} style={{ marginTop:2, accentColor:color, flexShrink:0 }}/>
               <span>{item}</span>
              </label>
             ))}
             {customSelected.map((item,i) => (
              <label key={`c${i}`} style={{ display:"flex", gap:8, alignItems:"flex-start", cursor:"pointer", marginBottom:7, fontSize:12, color:"#334155", lineHeight:1.4, opacity:.8 }}>
               <input type="checkbox" checked onChange={()=>toggle(item)} style={{ marginTop:2, accentColor:color, flexShrink:0 }}/>
               <span>{item} <em style={{ color:"#94A3B8", fontSize:10 }}>(custom)</em></span>
              </label>
             ))}
            </div>
            <AddNewInline placeholder={`Add new ${label.toLowerCase()}…`} onAdd={addNew} color={color}/>
           </div>
          );
         })}
        </div>
       </div>
      </>)}
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
       {(grandTotal > 0 || itin.final_price > 0) && (
        <div style={{ display:"flex", gap:20, background:"#F8FAFC", padding:"10px 16px", borderRadius:8, marginTop:12 }}>
         {itin.show_total_only ? (
          <div><div style={{ fontSize:10, color:"#64748B" }}>💰 Package Price</div><div style={{ fontSize:18, fontWeight:800 }}>{fmtINR(Number(itin.final_price)||grandTotal)}</div></div>
         ) : (
          [["✈ Flights",flightTotal],["🏨 Hotels",hotelTotal],["🗺 Activities",actTotal],["💰 Total",grandTotal]].map(([l,v])=>(
           <div key={l}><div style={{ fontSize:10, color:"#64748B" }}>{l}</div><div style={{ fontSize:14, fontWeight:700 }}>{fmtINR(v)}</div></div>
          ))
         )}
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
            src={day.image_url || dayImgUrl(day.destination||itin.destination, day.day||di+1, 200, 90)}
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

   {/* ── Quote Status strip — visible to all employees, no vendor names ── */}
   {vrStatus.length > 0 && (
    <div style={{ margin:"10px 0 0 0", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", padding:"8px 14px", background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:10 }}>
     <span style={{ fontSize:12, fontWeight:700, color:"#0369A1" }}>📋 Vendor Quotes:</span>
     {vrStatus.map((s,i) => (
      <span key={i} style={{ fontSize:11, background:s.status==="forwarded"?"#D1FAE5":s.status==="received"?"#FEF9C3":"#F1F5F9", border:`1px solid ${s.status==="forwarded"?"#6EE7B7":s.status==="received"?"#FDE047":"#CBD5E1"}`, borderRadius:20, padding:"3px 10px", color:s.status==="forwarded"?"#065F46":s.status==="received"?"#713F12":"#475569" }}>
       {s.status==="forwarded"?`Quoted: ₹${Number(s.final_price||0).toLocaleString("en-IN")}`:s.status==="received"?"Reply received — awaiting admin review":"Pending reply"}
      </span>
     ))}
     <button onClick={()=>loadVrStatus(itin.lead_id)} style={{ marginLeft:"auto", background:"none", border:"1px solid #BAE6FD", borderRadius:6, color:"#0369A1", fontSize:10, padding:"3px 8px", cursor:"pointer" }}>↻ Refresh</button>
    </div>
   )}
   </div>
  </div>

  {/* ── Vendor Quote Request Modal ── */}
  {vrModal && (
   <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:1100, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
    <div style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:620, maxHeight:"90vh", overflow:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.5)" }}>
     <div style={{ padding:"16px 22px", borderBottom:"1px solid #E6ECF5", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <div>
       <div style={{ fontWeight:700, fontSize:15, color:"#0F172A" }}>Request Vendor Quotes</div>
       <div style={{ fontSize:11, color:"#64748B", marginTop:2 }}>{itin.destination} · Vendor names are hidden from this view</div>
      </div>
      <button onClick={()=>setVrModal(null)} style={{ background:"none", border:"none", color:"#64748B", cursor:"pointer", fontSize:20, lineHeight:1 }}>×</button>
     </div>
     <div style={{ padding:22 }}>
      {vrModal.vendors.length === 0 ? (
       <div style={{ background:"#FEF9C3", border:"1px solid #FDE047", borderRadius:8, padding:"12px 16px", fontSize:13, color:"#713F12" }}>
        No vendors registered for <strong>{itin.destination}</strong>. Ask admin to add vendors in the Vendors module first.
       </div>
      ) : (
       <>
        <div style={{ fontSize:12, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:.8, marginBottom:8 }}>Select Vendors to Contact</div>
        <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
         {vrModal.vendors.map((v,i) => (
          <label key={i} style={{ display:"flex", gap:10, alignItems:"center", padding:"9px 13px", background:vrModal.selected.includes(i)?"#EFF6FF":"#F8FAFC", border:`1px solid ${vrModal.selected.includes(i)?"#93C5FD":"#E6ECF5"}`, borderRadius:8, cursor:"pointer" }}>
           <input type="checkbox" checked={vrModal.selected.includes(i)} onChange={()=>setVrModal(p=>({...p,selected:p.selected.includes(i)?p.selected.filter(x=>x!==i):[...p.selected,i]}))} style={{ width:16, height:16, accentColor:"#1A6B8A", flexShrink:0 }}/>
           <div style={{ flex:1 }}>
            <div style={{ fontWeight:600, fontSize:13, color:"#0F172A" }}>{v.label}</div>
            <div style={{ fontSize:11, color:"#64748B" }}>{v.destination}</div>
           </div>
          </label>
         ))}
        </div>
        <div style={{ marginBottom:10 }}>
         <div style={{ fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:.7, marginBottom:4 }}>Email Subject</div>
         <input value={vrModal.subject} onChange={e=>setVrModal(p=>({...p,subject:e.target.value}))} style={{ ...IS, fontSize:12 }}/>
        </div>
        <div style={{ marginBottom:16 }}>
         <div style={{ fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:.7, marginBottom:4 }}>Email Body</div>
         <textarea value={vrModal.body} onChange={e=>setVrModal(p=>({...p,body:e.target.value}))} rows={7} style={{ ...IS, resize:"vertical", fontSize:12 }}/>
        </div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
         <Btn v="secondary" onClick={()=>setVrModal(null)}>Cancel</Btn>
         <Btn v="success" icon="send" onClick={sendVrRequests} disabled={vrSending||!vrModal.selected.length}>
          {vrSending ? "Sending…" : `Send to ${vrModal.selected.length} Vendor${vrModal.selected.length!==1?"s":""}`}
         </Btn>
        </div>
       </>
      )}
     </div>
    </div>
   </div>
  )}
  <FlightSearchModal
   open={flightSearch.open}
   onClose={()=>setFlightSearch({open:false})}
   onImport={handleImportFlight}
   initDate={itin.start_date||""}
   adults={itin.pax||1}
   toast$={toast$}
  />
  <HotelSearchModal
   open={hotelSearch.open}
   onClose={()=>setHotelSearch({open:false})}
   onImport={handleImportHotel}
   initCheckin={itin.start_date||""}
   initCheckout={itin.end_date||""}
   adults={itin.pax||2}
   toast$={toast$}
  />
  </>
 );
}

// ─── AUTH SHELL ───────────────────────────────────────────────────────────────
export default function App() {
 const [authUser, setAuthUser] = useState(() => {
  try { const u = localStorage.getItem("sfn_auth_user"); return u ? JSON.parse(u) : null; } catch { return null; }
 });
 const [authChecked, setAuthChecked] = useState(false);
 useEffect(() => {
  const token = localStorage.getItem("sfn_auth_token");
  if (!token) { setAuthChecked(true); return; }
  const base = `${window.location.protocol}//${window.location.hostname}`;
  const tryUrl = (url) => fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  tryUrl("/api/auth/me").catch(() => tryUrl(`${base}:3002/api/auth/me`))
   .then(r => r.ok ? r.json() : null)
   .then(user => {
    if (user?.id) { setAuthUser(user); localStorage.setItem("sfn_auth_user", JSON.stringify(user)); }
    else { localStorage.removeItem("sfn_auth_token"); localStorage.removeItem("sfn_auth_user"); setAuthUser(null); }
   })
   .catch(() => {})
   .finally(() => setAuthChecked(true));
 }, []);

 const doLogout = () => { localStorage.removeItem("sfn_auth_token"); localStorage.removeItem("sfn_auth_user"); setAuthUser(null); };

 if (!authChecked) return (
  <div style={{ minHeight:"100vh", background:"#0D2030", display:"flex", alignItems:"center", justifyContent:"center", color:"#94A3B8", fontSize:14 }}>
   Loading…
  </div>
 );
 if (!authUser) return (
  <LoginPage onLogin={(user, token) => {
   localStorage.setItem("sfn_auth_token", token);
   localStorage.setItem("sfn_auth_user", JSON.stringify(user));
   setAuthUser(user);
  }} />
 );
 return <AppInner authUser={authUser} doLogout={doLogout} />;
}

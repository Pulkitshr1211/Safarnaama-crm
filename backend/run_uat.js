/**
 * TripJack UAT Certification Runner
 * Executes all 22 required test cases and saves logs in TripJack's exact format.
 *
 * Usage:  cd backend && node run_uat.js
 * Output: backend/uat_logs/Tripjack API logs/{oneway|roundtrip|multicity}/{FOLDER}/
 *         8 files per folder: SearchRequest, SearchResponse, ReviewRequest, ReviewResponse,
 *         BookingRequest, BookingResponse, BookingDetailRequest, BookingDetailResponse
 */

require("dotenv").config();
const axios  = require("axios");
const fs     = require("fs");
const path   = require("path");

// ─── Config ───────────────────────────────────────────────────────────────────
const TJ_KEY  = process.env.TRIPJACK_API_KEY;
const TJ_BASE = process.env.TRIPJACK_ENV === "production"
 ? "https://api.tripjack.com"
 : "https://apitest.tripjack.com";
const OUT_DIR = path.join(__dirname, "uat_logs", "Tripjack API logs");

// Pass --clean to wipe output before running
if (process.argv.includes("--clean") && fs.existsSync(OUT_DIR)) {
 fs.rmSync(OUT_DIR, { recursive: true, force: true });
 console.log("Cleaned previous output.\n");
}

if (!TJ_KEY) {
 console.error("ERROR: TRIPJACK_API_KEY not set in backend/.env");
 process.exit(1);
}
console.log(`TripJack base: ${TJ_BASE}`);

const hdrs = () => ({ apikey: TJ_KEY, "Content-Type": "application/json" });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep  = ms => new Promise(r => setTimeout(r, ms));
const future = days => { const d = new Date(); d.setDate(d.getDate()+days); return d.toISOString().split("T")[0]; };

function save(tripType, folderName, filename, payload) {
 const dir = path.join(OUT_DIR, tripType, folderName);
 fs.mkdirSync(dir, { recursive: true });
 fs.writeFileSync(path.join(dir, filename), JSON.stringify(payload, null, 4));
 process.stdout.write(`    ✓ ${filename}\n`);
}

// Build folder name from routeInfos (TripJack's exact naming convention)
// Roundtrip uses only the outbound leg: DEL-BOM-1A-DIRECT (not DEL-BOM-DEL-...)
// Multicity uses unique airport sequence: BLR-BKK-DXB-SIN or DEL-BKK-HKT-BKK-DEL
function buildFolderName(routeInfos, adults, children, infants, direct) {
 const tripType = getTripType(routeInfos);
 let codes = [];
 if (tripType === "roundtrip") {
  codes = [routeInfos[0].fromCityOrAirport.code, routeInfos[0].toCityOrAirport.code];
 } else {
  for (const ri of routeInfos) {
   const fr = ri.fromCityOrAirport.code;
   const to = ri.toCityOrAirport.code;
   if (!codes.length || codes[codes.length-1] !== fr) codes.push(fr);
   if (codes[codes.length-1] !== to) codes.push(to);
  }
 }
 const pax = [adults>0?`${adults}A`:"", children>0?`${children}C`:"", infants>0?`${infants}I`:""].filter(Boolean).join("-");
 const ft  = direct ? "DIRECT" : "CONNECTING";
 return `${codes.join("-")}-${pax}-${ft}`;
}

// Detect trip type from routeInfos
function getTripType(routeInfos) {
 if (routeInfos.length === 1) return "oneway";
 if (routeInfos.length === 2) {
  const isReturn = routeInfos[1].toCityOrAirport.code === routeInfos[0].fromCityOrAirport.code
   && routeInfos[1].fromCityOrAirport.code === routeInfos[0].toCityOrAirport.code;
  return isReturn ? "roundtrip" : "multicity";
 }
 return "multicity";
}

// Build traveler list exactly matching TripJack sample format.
// All 4 passport fields (pNum, eD, pid, pNat) included — required for international routes.
// Unique suffix prevents TripJack duplicate-booking detection across re-runs.
const RUN_SUFFIX = Date.now().toString().slice(-4); // e.g. "7531"
function makeTravelers(adults, children, infants) {
 const letters = "ABCDEFGHIJ";
 const out = [];
 for (let i = 0; i < adults; i++) {
  out.push({
   ti: "Mr", fN: `Test${letters[i]}${RUN_SUFFIX}`, lN: `Adult${letters[i]}`,
   pt: "ADULT", dob: `199${i % 7 || 6}-0${(i % 8) + 1}-09`,
   pNat: "IN", eD: "2030-09-08", pid: "2015-01-01", pNum: `J${7654321 + i}`,
  });
 }
 for (let i = 0; i < children; i++) {
  out.push({
   ti: "Master", fN: `Test${letters[i]}${RUN_SUFFIX}`, lN: `Child${letters[i]}`,
   pt: "CHILD", dob: `2019-0${(i % 8) + 1}-09`,
   pNat: "IN", eD: "2030-09-08", pid: "2020-06-01", pNum: `K${7654321 + i}`,
  });
 }
 for (let i = 0; i < infants; i++) {
  out.push({
   ti: "Master", fN: `Test${letters[i]}${RUN_SUFFIX}`, lN: `Infant${letters[i]}`,
   pt: "INFANT", dob: `2023-0${(i % 8) + 1}-09`,
   pNat: "IN", eD: "2030-09-08", pid: "2024-01-01", pNum: `L${7654321 + i}`,
  });
 }
 return out;
}

// Pick best flight from a trips array
function pickTrip(trips, direct) {
 if (!trips?.length) return null;
 for (const t of trips) {
  const stops = (t.sI || []).reduce((s, seg) => s + (seg.stops || 0), 0);
  if (direct && stops === 0) return t;
  if (!direct && stops > 0)  return t;
 }
 return trips[0]; // fallback: first available
}

// Pick the best priceId from a trip's totalPriceList.
// Prefers PUBLISHED over SPECIAL_RETURN (which requires a pre-linked paired return leg).
function pickPriceId(trip) {
 const list = trip?.totalPriceList;
 if (!list?.length) return null;
 const published = list.find(pl => pl.fareIdentifier && pl.fareIdentifier !== "SPECIAL_RETURN");
 return (published || list[0])?.id || null;
}

// Extract priceIds for review based on trip type and search result.
// offset: skip this many candidates before picking (used for retry on errCode 1000).
function extractPriceIds(tripInfos, tripType, direct, offset = 0) {
 // Domestic multicity returns per-leg numeric keys: { "0": [...], "1": [...], "2": [...] }
 const numericKeys = Object.keys(tripInfos).filter(k => /^\d+$/.test(k));
 if (numericKeys.length > 0) {
  const ids = [];
  for (const key of numericKeys.sort((a, b) => Number(a) - Number(b))) {
   const trips = tripInfos[key] || [];
   // Try trips in order, skipping `offset` matched ones
   let found = 0;
   let picked = null;
   for (const t of trips) {
    const stops = (t.sI || []).reduce((s, seg) => s + (seg.stops || 0), 0);
    const match = (direct && stops === 0) || (!direct && stops > 0);
    if (match || trips.length === 1) {
     if (found === offset) { picked = t; break; }
     found++;
    }
   }
   picked = picked || trips[offset] || trips[0];
   const pid = pickPriceId(picked);
   if (pid) ids.push(pid);
  }
  return ids;
 }
 if (tripType === "multicity") {
  const combo = tripInfos.COMBO || [];
  const trip  = pickNthTrip(combo, direct, offset);
  const pid   = pickPriceId(trip);
  return pid ? [pid] : [];
 }
 if (tripType === "roundtrip") {
  const combo = tripInfos.COMBO || [];
  if (combo.length) {
   // COMBO roundtrip: each trip contains both outbound and return legs — send ONE priceId
   const trip = pickNthTrip(combo, direct, offset);
   const pid  = pickPriceId(trip);
   if (pid) return [pid];
  }
  // Separate ONWARD + RETURN: pick non-SPECIAL_RETURN from each
  const onwardTrip = pickNthTrip(tripInfos.ONWARD || [], direct, offset) || (tripInfos.ONWARD||[])[offset] || (tripInfos.ONWARD||[])[0];
  const returnTrip = pickNthTrip(tripInfos.RETURN || [], direct, offset) || (tripInfos.RETURN||[])[offset] || (tripInfos.RETURN||[])[0];
  return [pickPriceId(onwardTrip), pickPriceId(returnTrip)].filter(Boolean);
 }
 // oneway
 const trip = pickNthTrip(tripInfos.ONWARD || [], direct, offset) || (tripInfos.ONWARD||[])[offset] || (tripInfos.ONWARD||[])[0];
 const pid  = pickPriceId(trip);
 return pid ? [pid] : [];
}

// Like pickTrip but skips the first `n` matching trips (for retry on 1000 errors)
function pickNthTrip(trips, direct, n = 0) {
 if (!trips?.length) return null;
 let found = 0;
 for (const t of trips) {
  const stops = (t.sI || []).reduce((s, seg) => s + (seg.stops || 0), 0);
  if ((direct && stops === 0) || (!direct && stops > 0)) {
   if (found === n) return t;
   found++;
  }
 }
 // fallback: nth element or first
 return trips[n] || trips[0];
}

const REQUIRED_FILES = [
 "SearchRequest.json","SearchResponse.json",
 "ReviewRequest.json","ReviewResponse.json",
 "BookingRequest.json","BookingResponse.json",
 "BookingDetailRequest.json","BookingDetailResponse.json",
];
function isCaseComplete(tripType, folder) {
 const dir = path.join(OUT_DIR, tripType, folder);
 if (!fs.existsSync(dir)) return false;
 return REQUIRED_FILES.every(f => {
  const fp = path.join(dir, f);
  if (!fs.existsSync(fp)) return false;
  try {
   const d = JSON.parse(fs.readFileSync(fp, "utf8"));
   // BookingResponse must not be an error
   if (f === "BookingResponse.json" && (d?.status?.success === false || d?.error)) return false;
   return true;
  } catch { return false; }
 });
}

// ─── Core test runner ─────────────────────────────────────────────────────────
async function runCase({ routeInfos, adults, children = 0, infants = 0, direct }) {
 const tripType  = getTripType(routeInfos);
 const folder    = buildFolderName(routeInfos, adults, children, infants, direct);

 if (isCaseComplete(tripType, folder)) {
  console.log(`\n[${tripType.toUpperCase()}] ${folder}  — already complete, skipping`);
  return { folder, status: "SKIPPED" };
 }
 const paxInfo   = { ADULT: String(adults), CHILD: String(children), INFANT: String(infants) };
 const searchQuery = {
  cabinClass: "ECONOMY",
  paxInfo,
  routeInfos,
  searchModifiers: { isDirectFlight: direct, isConnectingFlight: !direct },
 };

 console.log(`\n[${tripType.toUpperCase()}] ${folder}`);

 // 1 — SEARCH
 const searchBody = { searchQuery };
 save(tripType, folder, "SearchRequest.json", searchBody);

 let searchResp;
 try {
  const r  = await axios.post(`${TJ_BASE}/fms/v1/air-search-all`, searchBody, { headers: hdrs(), timeout: 30000 });
  searchResp = r.data;
 } catch (e) {
  const err = e.response?.data || { error: e.message };
  save(tripType, folder, "SearchResponse.json", err);
  console.log(`    ✗ Search failed: ${e.response?.status || ""} ${JSON.stringify(err).slice(0, 200)}`);
  return { folder, status: "SEARCH_FAILED" };
 }
 save(tripType, folder, "SearchResponse.json", searchResp);

 const tripInfos = searchResp?.searchResult?.tripInfos || {};

 if (!Object.keys(tripInfos).length) {
  console.log(`    ✗ No tripInfos in search response`);
  return { folder, status: "NO_PRICE_ID" };
 }

 // 2 — REVIEW (retry up to 5 times on errCode 1000 "flight no longer available")
 let reviewResp;
 let priceIds = [];
 for (let attempt = 0; attempt <= 5; attempt++) {
  priceIds = extractPriceIds(tripInfos, tripType, direct, attempt);
  if (!priceIds.length) {
   console.log(`    ✗ No priceId found (tripInfos keys: ${Object.keys(tripInfos).join(",")})`);
   return { folder, status: "NO_PRICE_ID" };
  }
  const reviewBody = { priceIds };
  save(tripType, folder, "ReviewRequest.json", reviewBody);
  let reviewErr = null;
  try {
   const r  = await axios.post(`${TJ_BASE}/fms/v1/review`, reviewBody, { headers: hdrs(), timeout: 30000 });
   reviewResp = r.data;
   break; // success
  } catch (e) {
   reviewErr = e.response?.data || { error: e.message };
   const errCode = reviewErr?.errors?.[0]?.errCode;
   save(tripType, folder, "ReviewResponse.json", reviewErr);
   if (errCode === "1000" && attempt < 5) {
    console.log(`    ↻ Review errCode 1000, retrying with trip[${attempt + 1}]...`);
    await sleep(1000);
    continue;
   }
   console.log(`    ✗ Review failed: ${e.response?.status || ""} ${JSON.stringify(reviewErr).slice(0, 200)}`);
   return { folder, status: "REVIEW_FAILED" };
  }
 }
 save(tripType, folder, "ReviewResponse.json", reviewResp);

 const bookingId = reviewResp?.bookingId || reviewResp?.data?.bookingId;
 const amount    =
  reviewResp?.totalPriceInfo?.totalFareDetail?.fC?.TF   ||
  reviewResp?.data?.totalPriceInfo?.totalFareDetail?.fC?.TF ||
  reviewResp?.totalPriceInfo?.fC?.TF || 5000;

 if (!bookingId) {
  console.log(`    ✗ No bookingId in review response`);
  return { folder, status: "NO_BOOKING_ID" };
 }

 // 3 — BOOK
 const bookBody = {
  bookingId,
  paymentInfos: [{ amount: Number(amount) }],
  travellerInfo: makeTravelers(adults, children, infants),
  deliveryInfo: { emails: ["test@safarnaama.in"], contacts: ["9999999999"] },
 };
 save(tripType, folder, "BookingRequest.json", bookBody);

 let bookResp;
 try {
  const r  = await axios.post(`${TJ_BASE}/oms/v1/air/book`, bookBody, { headers: hdrs(), timeout: 30000 });
  bookResp = r.data;
 } catch (e) {
  const err = e.response?.data || { error: e.message };
  save(tripType, folder, "BookingResponse.json", err);
  console.log(`    ✗ Book failed: ${e.response?.status || ""} ${JSON.stringify(err).slice(0, 200)}`);
  return { folder, status: "BOOK_FAILED" };
 }
 save(tripType, folder, "BookingResponse.json", bookResp);

 const confirmedId = bookResp?.order?.bookingId || bookResp?.bookingId || bookingId;
 const status      = bookResp?.order?.status    || bookResp?.status    || "SUBMITTED";

 // 4 — BOOKING DETAIL
 const detailBody = { bookingId: confirmedId };
 save(tripType, folder, "BookingDetailRequest.json", detailBody);

 let detailResp;
 try {
  await sleep(2000); // small pause before detail fetch
  const r  = await axios.post(`${TJ_BASE}/oms/v1/booking-details`, { bookingId: confirmedId, requirePaxPricing: false }, { headers: hdrs(), timeout: 30000 });
  detailResp = r.data;
 } catch (e) {
  const err = e.response?.data || { error: e.message };
  save(tripType, folder, "BookingDetailResponse.json", err);
  console.log(`    ✗ BookingDetail failed: ${e.response?.status || ""} ${JSON.stringify(err).slice(0, 200)}`);
  return { folder, status: "DETAIL_FAILED", bookingId: confirmedId };
 }
 save(tripType, folder, "BookingDetailResponse.json", detailResp);

 console.log(`    ✓ COMPLETE  bookingId=${confirmedId}  status=${status}`);
 return { folder, status: "OK", bookingId: confirmedId };
}

// ─── Test cases ───────────────────────────────────────────────────────────────
// Each case uses a unique departure date (7 days apart) to prevent inventory collisions
const BASE = 30;
const D = n => future(BASE + n); // each n unit = 1 day from today+30

const TEST_CASES = [
 // ── ONEWAY (8 cases) — each departure 7 days apart ────────────────
 { routeInfos:[{ fromCityOrAirport:{code:"DEL"}, toCityOrAirport:{code:"BOM"}, travelDate:D(0)  }], adults:1,                  direct:true  },
 { routeInfos:[{ fromCityOrAirport:{code:"DEL"}, toCityOrAirport:{code:"BOM"}, travelDate:D(7)  }], adults:1,                  direct:false },
 { routeInfos:[{ fromCityOrAirport:{code:"DEL"}, toCityOrAirport:{code:"DXB"}, travelDate:D(14) }], adults:2, children:2,      direct:true  },
 { routeInfos:[{ fromCityOrAirport:{code:"BOM"}, toCityOrAirport:{code:"SIN"}, travelDate:D(21) }], adults:2, children:2,      direct:false },
 { routeInfos:[{ fromCityOrAirport:{code:"BOM"}, toCityOrAirport:{code:"MAA"}, travelDate:D(28) }], adults:5, children:4, infants:3, direct:true  },
 { routeInfos:[{ fromCityOrAirport:{code:"DXB"}, toCityOrAirport:{code:"BKK"}, travelDate:D(35) }], adults:5, children:3, infants:2, direct:true  },
 { routeInfos:[{ fromCityOrAirport:{code:"DXB"}, toCityOrAirport:{code:"BKK"}, travelDate:D(42) }], adults:5, children:3, infants:2, direct:false },
 { routeInfos:[{ fromCityOrAirport:{code:"MAA"}, toCityOrAirport:{code:"DMK"}, travelDate:future(15) }], adults:2, children:3, direct:false },

 // ── ROUNDTRIP (10 cases) — outbound dates well-separated ──────────
 { routeInfos:[
    { fromCityOrAirport:{code:"DEL"}, toCityOrAirport:{code:"BOM"}, travelDate:D(56) },
    { fromCityOrAirport:{code:"BOM"}, toCityOrAirport:{code:"DEL"}, travelDate:D(60) },
   ], adults:1,                  direct:true  },
 { routeInfos:[
    { fromCityOrAirport:{code:"DEL"}, toCityOrAirport:{code:"BOM"}, travelDate:D(63) },
    { fromCityOrAirport:{code:"BOM"}, toCityOrAirport:{code:"DEL"}, travelDate:D(67) },
   ], adults:1,                  direct:false },
 { routeInfos:[
    { fromCityOrAirport:{code:"DEL"}, toCityOrAirport:{code:"BOM"}, travelDate:D(70) },
    { fromCityOrAirport:{code:"BOM"}, toCityOrAirport:{code:"DEL"}, travelDate:D(74) },
   ], adults:3, children:2,      direct:true  },
 { routeInfos:[
    { fromCityOrAirport:{code:"DEL"}, toCityOrAirport:{code:"BOM"}, travelDate:D(77) },
    { fromCityOrAirport:{code:"BOM"}, toCityOrAirport:{code:"DEL"}, travelDate:D(81) },
   ], adults:5, children:3, infants:2, direct:false },
 { routeInfos:[
    { fromCityOrAirport:{code:"DEL"}, toCityOrAirport:{code:"DXB"}, travelDate:future(25) },
    { fromCityOrAirport:{code:"DXB"}, toCityOrAirport:{code:"DEL"}, travelDate:future(30) },
   ], adults:2, children:2,      direct:true  },
 { routeInfos:[
    { fromCityOrAirport:{code:"BOM"}, toCityOrAirport:{code:"SIN"}, travelDate:future(27) },
    { fromCityOrAirport:{code:"SIN"}, toCityOrAirport:{code:"BOM"}, travelDate:future(32) },
   ], adults:2, children:2,      direct:false },
 { routeInfos:[
    { fromCityOrAirport:{code:"BOM"}, toCityOrAirport:{code:"MAA"}, travelDate:D(98) },
    { fromCityOrAirport:{code:"MAA"}, toCityOrAirport:{code:"BOM"}, travelDate:D(102) },
   ], adults:5, children:4, infants:3, direct:true  },
 { routeInfos:[
    { fromCityOrAirport:{code:"DXB"}, toCityOrAirport:{code:"BKK"}, travelDate:D(105) },
    { fromCityOrAirport:{code:"BKK"}, toCityOrAirport:{code:"DXB"}, travelDate:D(110) },
   ], adults:5, children:3, infants:2, direct:true  },
 { routeInfos:[
    { fromCityOrAirport:{code:"DXB"}, toCityOrAirport:{code:"BKK"}, travelDate:future(29) },
    { fromCityOrAirport:{code:"BKK"}, toCityOrAirport:{code:"DXB"}, travelDate:future(34) },
   ], adults:5, children:3, infants:2, direct:false },
 { routeInfos:[
    { fromCityOrAirport:{code:"MAA"}, toCityOrAirport:{code:"DMK"}, travelDate:future(18) },
    { fromCityOrAirport:{code:"DMK"}, toCityOrAirport:{code:"MAA"}, travelDate:future(23) },
   ], adults:3, children:2, direct:false },

 // ── MULTICITY (4 cases) ──────────────────────────────────────────
 { routeInfos:[
    { fromCityOrAirport:{code:"BLR"}, toCityOrAirport:{code:"BKK"}, travelDate:D(126) },
    { fromCityOrAirport:{code:"BKK"}, toCityOrAirport:{code:"DXB"}, travelDate:D(131) },
    { fromCityOrAirport:{code:"DXB"}, toCityOrAirport:{code:"SIN"}, travelDate:D(136) },
   ], adults:4, children:2, infants:2, direct:false },
 { routeInfos:[
    { fromCityOrAirport:{code:"DEL"}, toCityOrAirport:{code:"BKK"}, travelDate:D(133) },
    { fromCityOrAirport:{code:"HKT"}, toCityOrAirport:{code:"BKK"}, travelDate:D(138) },
    { fromCityOrAirport:{code:"BKK"}, toCityOrAirport:{code:"DEL"}, travelDate:D(143) },
   ], adults:4, children:2, infants:2, direct:true  },
 { routeInfos:[
    { fromCityOrAirport:{code:"MAA"}, toCityOrAirport:{code:"BLR"}, travelDate:D(140) },
    { fromCityOrAirport:{code:"BLR"}, toCityOrAirport:{code:"BOM"}, travelDate:D(145) },
    { fromCityOrAirport:{code:"BOM"}, toCityOrAirport:{code:"DEL"}, travelDate:D(150) },
   ], adults:5, children:3,           direct:false },
 { routeInfos:[
    { fromCityOrAirport:{code:"MAA"}, toCityOrAirport:{code:"BLR"}, travelDate:D(147) },
    { fromCityOrAirport:{code:"BLR"}, toCityOrAirport:{code:"BOM"}, travelDate:D(152) },
    { fromCityOrAirport:{code:"BOM"}, toCityOrAirport:{code:"DEL"}, travelDate:D(157) },
   ], adults:5, children:4, infants:1, direct:true  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
 console.log(`\n${"=".repeat(60)}`);
 console.log(` TripJack UAT Certification — ${TEST_CASES.length} test cases`);
 console.log(` Output: ${OUT_DIR}`);
 console.log(`${"=".repeat(60)}`);

 const results = [];
 for (let i = 0; i < TEST_CASES.length; i++) {
  const tc = TEST_CASES[i];
  const result = await runCase(tc);
  results.push(result);
  if (i < TEST_CASES.length - 1) await sleep(3000); // 3s between cases
 }

 // Summary
 console.log(`\n${"=".repeat(60)}`);
 console.log(" SUMMARY");
 console.log(`${"=".repeat(60)}`);
 const ok      = results.filter(r => r.status === "OK" || r.status === "SKIPPED");
 const skipped = results.filter(r => r.status === "SKIPPED");
 const fail    = results.filter(r => r.status !== "OK" && r.status !== "SKIPPED");
 console.log(` PASSED : ${ok.length}/${results.length}  (${skipped.length} already complete, skipped)`);
 if (fail.length) {
  console.log(` FAILED : ${fail.length}`);
  fail.forEach(r => console.log(`   ✗ ${r.folder}  (${r.status})`));
 }
 console.log(`\n Output directory:`);
 console.log(`   ${OUT_DIR}`);
 console.log(`\n To submit: zip the "Tripjack API logs" folder and email to`);
 console.log(`   apitechsupport@tripjack.com`);
 console.log(`${"=".repeat(60)}\n`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });

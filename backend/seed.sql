-- ============================================================
-- SAFARNAAMA HOLIDAYS CRM — SEED DATA (self-contained)
-- ============================================================
-- HOW TO RUN (single file — no need to run schema.sql first):
--   1. Go to Supabase → SQL Editor → New Query
--   2. Paste this entire file and click "Run"
-- ============================================================

-- ── CREATE TABLES (safe — skipped if already exist) ───────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendors (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  email2      TEXT,
  phone       TEXT,
  destination TEXT,
  category    TEXT,
  rating      NUMERIC(3,1),
  status      TEXT DEFAULT 'Active',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT,
  phone          TEXT,
  destination    TEXT,
  pax            INTEGER DEFAULT 1,
  kids           INTEGER DEFAULT 0,
  budget         TEXT,
  budget_range   TEXT,
  travel_date    DATE,
  end_date       DATE,
  status         TEXT DEFAULT 'New',
  notes          TEXT,
  assigned_to    TEXT,
  source         TEXT,
  follow_up_date DATE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       TEXT REFERENCES vendors(id) ON DELETE CASCADE,
  package_name    TEXT,
  destination     TEXT,
  duration_nights INTEGER,
  price_per_pax   NUMERIC(12,2),
  hotel_name      TEXT,
  hotel_category  TEXT,
  room_type       TEXT,
  inclusions      JSONB DEFAULT '[]',
  valid_from      DATE,
  valid_till      DATE,
  raw_content     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotes (
  id                TEXT PRIMARY KEY,
  lead_id           TEXT REFERENCES leads(id),
  lead_name         TEXT,
  destination       TEXT,
  query_code        TEXT UNIQUE,
  status            TEXT DEFAULT 'Quote Requested',
  vendors_contacted JSONB DEFAULT '[]',
  vendor_replies    JSONB DEFAULT '[]',
  final_amount      NUMERIC(12,2),
  markup_applied    NUMERIC(5,2),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id          TEXT PRIMARY KEY,
  lead_id     TEXT REFERENCES leads(id),
  lead_name   TEXT,
  destination TEXT,
  invoice_no  TEXT UNIQUE,
  date        DATE,
  due_date    DATE,
  items       JSONB DEFAULT '[]',
  subtotal    NUMERIC(12,2) DEFAULT 0,
  discount    NUMERIC(12,2) DEFAULT 0,
  tax_rate    NUMERIC(5,2)  DEFAULT 5,
  gst         NUMERIC(12,2) DEFAULT 0,
  total       NUMERIC(12,2) DEFAULT 0,
  paid_amount NUMERIC(12,2) DEFAULT 0,
  balance     NUMERIC(12,2) DEFAULT 0,
  payments    JSONB DEFAULT '[]',
  notes       TEXT,
  status      TEXT DEFAULT 'Draft',
  currency    TEXT DEFAULT 'INR',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vouchers (
  id                TEXT PRIMARY KEY,
  lead_id           TEXT REFERENCES leads(id),
  voucher_no        TEXT,
  voucher_type      TEXT DEFAULT 'Hotel',
  client_name       TEXT,
  destination       TEXT,
  travel_date       DATE,
  return_date       DATE,
  adults            INTEGER DEFAULT 1,
  kids              INTEGER DEFAULT 0,
  hotel             TEXT,
  room_type         TEXT,
  meal_plan         TEXT,
  booking_ref       TEXT,
  special_requests  TEXT,
  airline           TEXT,
  flight_no         TEXT,
  pnr               TEXT,
  from_location     TEXT,
  to_location       TEXT,
  travel_class      TEXT,
  baggage           TEXT,
  passengers        TEXT,
  vehicle_type      TEXT,
  pickup_from       TEXT,
  drop_to           TEXT,
  pickup_time       TEXT,
  driver_name       TEXT,
  driver_contact    TEXT,
  activity_name     TEXT,
  activity_time     TEXT,
  meeting_point     TEXT,
  operator          TEXT,
  operator_contact  TEXT,
  inclusions        JSONB DEFAULT '[]',
  special_notes     TEXT,
  emergency_contact TEXT,
  status            TEXT DEFAULT 'Active',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS itineraries (
  id            TEXT PRIMARY KEY,
  lead_id       TEXT REFERENCES leads(id),
  lead_name     TEXT,
  title         TEXT,
  destination   TEXT,
  start_date    DATE,
  end_date      DATE,
  pax           INTEGER DEFAULT 2,
  kids          INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'Draft',
  notes         TEXT,
  highlights    JSONB DEFAULT '[]',
  flights       JSONB DEFAULT '[]',
  hotels        JSONB DEFAULT '[]',
  days          JSONB DEFAULT '[]',
  inclusions    JSONB DEFAULT '[]',
  exclusions    JSONB DEFAULT '[]',
  markup_pct    NUMERIC(5,2) DEFAULT 22,
  selling_price NUMERIC(12,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  description TEXT,
  lead_id     TEXT,
  assigned_to TEXT,
  created_by  TEXT,
  due_date    DATE,
  priority    TEXT DEFAULT 'Medium',
  status      TEXT DEFAULT 'Pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_log (
  id          BIGSERIAL PRIMARY KEY,
  direction   TEXT DEFAULT 'outbound',
  from_addr   TEXT,
  to_addrs    JSONB,
  subject     TEXT,
  body        TEXT,
  query_code  TEXT,
  lead_id     TEXT,
  vendor_id   TEXT,
  sendgrid_id TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  type       TEXT DEFAULT 'info',
  message    TEXT,
  read       BOOLEAN DEFAULT FALSE,
  user_id    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vendors_destination ON vendors(destination);
CREATE INDEX IF NOT EXISTS idx_vendors_category    ON vendors(category);
CREATE INDEX IF NOT EXISTS idx_leads_status        ON leads(status);
CREATE INDEX IF NOT EXISTS idx_invoices_status     ON invoices(status);

-- ── DEFAULT APP SETTINGS ──────────────────────────────────────────────────────
INSERT INTO app_settings (key, value) VALUES
  ('markup',  '{"star3":18,"star4":22,"transport":15,"activities":20,"hotel4star":22}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO app_settings (key, value) VALUES
  ('company', '{"name":"Safarnaama Holidays","email":"enquiry@SafarnaamaHolidays.com","phone":"+91-9999999999","address":""}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ── VENDORS — 131 hotels, resorts, villas, DMCs across all destinations ────────
INSERT INTO vendors (id, name, email, email2, phone, destination, category, rating, status) VALUES

-- ── INDIA: GOA ────────────────────────────────────────────────────────────────
('V001', 'Taj Exotica Resort & Spa Goa',        'reservations.goa@tajhotels.com',          NULL, '+91-832-6650000',  'Goa',                'Resort',       4.9, 'Active'),
('V002', 'Grand Hyatt Goa',                     'reservations.goa@hyatt.com',              NULL, '+91-832-2721234',  'Goa',                'Hotel',        4.7, 'Active'),
('V003', 'The Leela Goa Cavelossim Beach',      'reservations@theleela.com',               NULL, '+91-832-6622222',  'Goa',                'Resort',       4.8, 'Active'),
('V004', 'Club Mahindra Varca Beach Goa',       'goa@clubmahindra.com',                    NULL, '+91-832-2745555',  'Goa',                'Resort',       4.3, 'Active'),
('V005', 'Alila Diwa Goa',                      'diwa@alilahotels.com',                    NULL, '+91-832-2746800',  'Goa',                'Resort',       4.7, 'Active'),
('V006', 'Thomas Cook India - Goa DMC',         'goa@thomascook.in',                       NULL, '+91-832-2438000',  'Goa',                'DMC',          4.5, 'Active'),

-- ── INDIA: KERALA ─────────────────────────────────────────────────────────────
('V007', 'Kumarakom Lake Resort Kerala',        'reservations@kumarakomlakeresort.com',    NULL, '+91-481-2524900',  'Kerala',             'Resort',       4.9, 'Active'),
('V008', 'Coconut Lagoon CGH Earth Kumarakom',  'coconutlagoon@cghearth.com',              NULL, '+91-481-2524491',  'Kerala',             'Resort',       4.8, 'Active'),
('V009', 'Spice Village CGH Earth Thekkady',    'spicevillage@cghearth.com',               NULL, '+91-486-9222315',  'Kerala',             'Resort',       4.7, 'Active'),
('V010', 'Somatheeram Ayurvedic Health Resort', 'info@somatheeram.in',                     NULL, '+91-471-2268101',  'Kerala',             'Resort',       4.6, 'Active'),
('V011', 'Kerala Premium Houseboats Alleppey',  'bookings@keralahouseboats.net',           NULL, '+91-477-2232444',  'Kerala',             'Villa',        4.7, 'Active'),
('V012', 'KTDC Kerala Tourism DMC',             'info@ktdc.com',                           NULL, '+91-471-2330031',  'Kerala',             'Tour Operator',4.5, 'Active'),

-- ── INDIA: KASHMIR ────────────────────────────────────────────────────────────
('V013', 'The Lalit Grand Palace Srinagar',         'reservations.srinagar@thelalit.com',  NULL, '+91-194-2501001',  'Kashmir',            'Hotel',        4.8, 'Active'),
('V014', 'Houseboat New King Dal Lake Srinagar',    'bookings@newkingdalview.com',          NULL, '+91-194-2422282',  'Kashmir',            'Villa',        4.5, 'Active'),
('V015', 'Hotel Highland Park Gulmarg',             'reservations@highlandparkgulmarg.com',NULL, '+91-1954-254455',  'Kashmir',            'Hotel',        4.4, 'Active'),
('V016', 'Pahalgam Hotel Pahalgam Valley',          'reservations@hotelpahalgam.com',       NULL, '+91-1936-243013',  'Kashmir',            'Hotel',        4.2, 'Active'),
('V017', 'Kashmir Himalayan Expedition Tours',      'info@kashmirhimalayan.com',            NULL, '+91-194-2456789',  'Kashmir',            'Tour Operator',4.6, 'Active'),

-- ── INDIA: RAJASTHAN ──────────────────────────────────────────────────────────
('V018', 'Rambagh Palace Jaipur by Taj',        'rambagh.jaipur@tajhotels.com',            NULL, '+91-141-2385700',  'Rajasthan',          'Hotel',        4.9, 'Active'),
('V019', 'Umaid Bhawan Palace Jodhpur by Taj',  'umaidbhawan.jodhpur@tajhotels.com',       NULL, '+91-291-2510101',  'Rajasthan',          'Hotel',        4.9, 'Active'),
('V020', 'Taj Lake Palace Udaipur',             'lakepalace.udaipur@tajhotels.com',        NULL, '+91-294-2428800',  'Rajasthan',          'Hotel',        5.0, 'Active'),
('V021', 'Suryagarh Jaisalmer Heritage Hotel',  'reservations@suryagarh.com',              NULL, '+91-2992-269269',  'Rajasthan',          'Hotel',        4.8, 'Active'),
('V022', 'RAAS Jodhpur Boutique Hotel',         'reservations@raasjodhpur.com',            NULL, '+91-291-2636455',  'Rajasthan',          'Hotel',        4.7, 'Active'),
('V023', 'Heritage Hotels Rajasthan DMC',       'bookings@heritagehotelsrajasthan.com',    NULL, '+91-141-2571741',  'Rajasthan',          'DMC',          4.6, 'Active'),

-- ── INDIA: HIMACHAL PRADESH ───────────────────────────────────────────────────
('V024', 'Wildflower Hall Shimla by Oberoi',    'reservations@oberoihotels.com',           NULL, '+91-177-2648585',  'Himachal Pradesh',   'Resort',       4.9, 'Active'),
('V025', 'Span Resort & Spa Manali',            'span@spanresorts.com',                    NULL, '+91-1902-252138',  'Himachal Pradesh',   'Resort',       4.5, 'Active'),
('V026', 'The Himalayan Manali by Taj',         'himalayan.manali@tajhotels.com',          NULL, '+91-1902-252555',  'Himachal Pradesh',   'Hotel',        4.7, 'Active'),
('V027', 'Club Mahindra Manali Resort',         'manali@clubmahindra.com',                 NULL, '+91-1902-252341',  'Himachal Pradesh',   'Resort',       4.3, 'Active'),
('V028', 'Solang Valley Resort Manali',         'info@solangvalleyresorts.com',            NULL, '+91-1902-253333',  'Himachal Pradesh',   'Resort',       4.4, 'Active'),

-- ── INDIA: ANDAMAN ISLANDS ────────────────────────────────────────────────────
('V029', 'Barefoot at Havelock Andaman',            'reservations@barefootindia.com',      NULL, '+91-3192-282323',  'Andaman Islands',    'Resort',       4.8, 'Active'),
('V030', 'Fortune Resort Bay Island Port Blair',    'fortbay@fortunehotels.in',            NULL, '+91-3192-234101',  'Andaman Islands',    'Hotel',        4.4, 'Active'),
('V031', 'Munjoh Ocean Resort Havelock Island',     'info@munjoh.com',                     NULL, '+91-3192-282328',  'Andaman Islands',    'Resort',       4.6, 'Active'),
('V032', 'Symphony Palms Beach Resort Havelock',    'reservations@symphonypalms.com',      NULL, '+91-3192-282526',  'Andaman Islands',    'Resort',       4.5, 'Active'),
('V033', 'Andaman & Nicobar Tourism',               'andaman.tourism@nic.in',              NULL, '+91-3192-232747',  'Andaman Islands',    'Tour Operator',4.4, 'Active'),

-- ── INDIA: LEH-LADAKH ─────────────────────────────────────────────────────────
('V034', 'The Grand Dragon Ladakh Leh',             'reservations@granddragonladakh.com',  NULL, '+91-1982-257786',  'Leh-Ladakh',         'Hotel',        4.7, 'Active'),
('V035', 'Hotel Ladakh Sarai Leh',                  'info@ladakhsarai.com',                NULL, '+91-1982-251360',  'Leh-Ladakh',         'Hotel',        4.3, 'Active'),
('V036', 'Chamba Camp Thiksey Ladakh by Shakti',    'info@shaktihimalaya.com',             NULL, '+91-11-41661000',  'Leh-Ladakh',         'Villa',        4.9, 'Active'),
('V037', 'Adventure Leh Ladakh Tours',              'info@adventureladakhtours.com',       NULL, '+91-1982-250756',  'Leh-Ladakh',         'Tour Operator',4.6, 'Active'),

-- ── INDIA: COORG / SOUTH INDIA ────────────────────────────────────────────────
('V038', 'Orange County Coorg Resort',          'reservations@orangecounty.in',            NULL, '+91-8272-265100',  'Coorg',              'Resort',       4.8, 'Active'),
('V039', 'Club Mahindra Madikeri Coorg',        'madikeri@clubmahindra.com',               NULL, '+91-8272-228889',  'Coorg',              'Resort',       4.3, 'Active'),
('V040', 'Windermere Estate Munnar',            'info@windermereresort.com',               NULL, '+91-4865-230512',  'Munnar',             'Resort',       4.7, 'Active'),
('V041', 'Savoy Hotel Ooty by Taj',             'savoy.ooty@tajhotels.com',                NULL, '+91-423-2244142',  'Ooty',               'Hotel',        4.5, 'Active'),

-- ── INDIA: DELHI / AGRA / GOLDEN TRIANGLE ─────────────────────────────────────
('V042', 'The Imperial New Delhi',              'luxury@theimperialindia.com',             NULL, '+91-11-23341234',  'Delhi',              'Hotel',        4.9, 'Active'),
('V043', 'ITC Maurya New Delhi',                'itcmaurya@itchotels.in',                  NULL, '+91-11-26112233',  'Delhi',              'Hotel',        4.8, 'Active'),
('V044', 'The Oberoi Agra',                     'reservations.agra@oberoihotels.com',      NULL, '+91-562-4011234',  'Agra',               'Hotel',        4.9, 'Active'),
('V045', 'ITC Mughal Agra',                     'reservations.mughalagra@itchotels.com',   NULL, '+91-562-4021700',  'Agra',               'Hotel',        4.7, 'Active'),
('V046', 'Cox & Kings India - Golden Triangle', 'goldentriangle@coxandkings.com',          NULL, '+91-11-23351722',  'Delhi',              'Tour Operator',4.7, 'Active'),

-- ── INDIA: VARANASI / RISHIKESH ───────────────────────────────────────────────
('V047', 'Nadesar Palace Varanasi by Taj',      'nadesar.varanasi@tajhotels.com',          NULL, '+91-542-6660000',  'Varanasi',           'Hotel',        4.8, 'Active'),
('V048', 'Ananda in the Himalayas Rishikesh',   'sales@anandaspa.com',                     NULL, '+91-1378-227500',  'Rishikesh',          'Resort',       4.9, 'Active'),
('V049', 'The Haveli Hari Ganga Haridwar',      'info@harganharidwar.com',                 NULL, '+91-133-2226443',  'Rishikesh',          'Hotel',        4.4, 'Active'),

-- ── INDIA: DARJEELING / SIKKIM ────────────────────────────────────────────────
('V050', 'Glenburn Tea Estate Darjeeling',      'info@glenburnteaestate.com',              NULL, '+91-33-22883633',  'Darjeeling',         'Resort',       4.8, 'Active'),
('V051', 'Elgin Hotel Darjeeling Heritage',     'reservations@elginhotels.com',            NULL, '+91-354-2257226',  'Darjeeling',         'Hotel',        4.4, 'Active'),
('V052', 'Sikkim Holiday Treks & Tours DMC',    'info@sikkimholidaytreks.com',             NULL, '+91-3592-202681',  'Darjeeling',         'Tour Operator',4.5, 'Active'),

-- ── INDIA: MUMBAI ─────────────────────────────────────────────────────────────
('V053', 'The Taj Mahal Palace Mumbai',         'tmhp.bom@tajhotels.com',                  NULL, '+91-22-66653366',  'Mumbai',             'Hotel',        5.0, 'Active'),
('V054', 'The Oberoi Mumbai',                   'reservations.obm@oberoihotels.com',       NULL, '+91-22-66325757',  'Mumbai',             'Hotel',        4.9, 'Active'),

-- ── DUBAI ─────────────────────────────────────────────────────────────────────
('V055', 'Burj Al Arab Jumeirah Dubai',         'reservations@jumeirah.com',               NULL, '+971-4-3017777',   'Dubai',              'Hotel',        5.0, 'Active'),
('V056', 'Atlantis The Palm Dubai',             'reservations@atlantisthepalm.com',        NULL, '+971-4-4260000',   'Dubai',              'Resort',       4.8, 'Active'),
('V057', 'Jumeirah Beach Hotel Dubai',          'jbhreservations@jumeirah.com',            NULL, '+971-4-3480000',   'Dubai',              'Hotel',        4.7, 'Active'),
('V058', 'Address Downtown Dubai',              'addressdowntown@addresshotels.com',       NULL, '+971-4-4368888',   'Dubai',              'Hotel',        4.8, 'Active'),
('V059', 'One&Only Royal Mirage Dubai',         'royalmirage@oneandonlyresorts.com',       NULL, '+971-4-3999999',   'Dubai',              'Resort',       4.9, 'Active'),
('V060', 'Waldorf Astoria Dubai Palm Jumeirah', 'wapj.reservations@waldorfastoria.com',    NULL, '+971-4-8181000',   'Dubai',              'Hotel',        4.8, 'Active'),
('V061', 'Arabian Adventures Dubai DMC',        'arabian.adventures@emiratesgroup.com',    NULL, '+971-4-3034888',   'Dubai',              'DMC',          4.7, 'Active'),

-- ── SINGAPORE ─────────────────────────────────────────────────────────────────
('V062', 'Marina Bay Sands Singapore',          'reservations@marinabaysands.com',         NULL, '+65-6688-8888',    'Singapore',          'Hotel',        4.8, 'Active'),
('V063', 'Raffles Hotel Singapore',             'singapore@raffles.com',                   NULL, '+65-6337-1886',    'Singapore',          'Hotel',        4.9, 'Active'),
('V064', 'The Fullerton Hotel Singapore',       'info@fullertonhotel.com',                 NULL, '+65-6733-8388',    'Singapore',          'Hotel',        4.7, 'Active'),
('V065', 'Capella Singapore Sentosa Island',    'singapore@capellahotels.com',             NULL, '+65-6377-8888',    'Singapore',          'Resort',       4.9, 'Active'),
('V066', 'Mandarin Oriental Singapore',         'mosin-reservations@mohg.com',             NULL, '+65-6338-0066',    'Singapore',          'Hotel',        4.8, 'Active'),
('V067', 'Chan Brothers Travel Singapore DMC',  'info@chanbrothers.com.sg',                NULL, '+65-6212-3000',    'Singapore',          'DMC',          4.6, 'Active'),

-- ── MALDIVES ──────────────────────────────────────────────────────────────────
('V068', 'Velaa Private Island Maldives',       'reservations@velaaprivateisland.com',     NULL, '+960-660-3000',    'Maldives',           'Villa',        5.0, 'Active'),
('V069', 'Soneva Fushi Maldives',               'enquiries@soneva.com',                    NULL, '+960-660-0304',    'Maldives',           'Resort',       5.0, 'Active'),
('V070', 'Anantara Veli Maldives Resort',       'veli@anantara.com',                       NULL, '+960-664-4100',    'Maldives',           'Resort',       4.8, 'Active'),
('V071', 'Niyama Private Islands Maldives',     'discover@niyama.com',                     NULL, '+960-676-0011',    'Maldives',           'Resort',       4.9, 'Active'),
('V072', 'LUX* South Ari Atoll Maldives',       'luxsaa@luxresorts.com',                   NULL, '+960-668-0901',    'Maldives',           'Resort',       4.8, 'Active'),
('V073', 'Milaidhoo Island Maldives',           'info@milaidhoo.com',                      NULL, '+960-528-2002',    'Maldives',           'Resort',       4.9, 'Active'),
('V074', 'Cheval Blanc Randheli Maldives',      'reservations.randheli@chevalblanc.com',   NULL, '+960-656-1515',    'Maldives',           'Villa',        5.0, 'Active'),
('V075', 'Maldives Overwater Specialists DMC',  'bookings@maldivesspecialists.com',        NULL, '+960-330-0999',    'Maldives',           'DMC',          4.7, 'Active'),

-- ── MAURITIUS ─────────────────────────────────────────────────────────────────
('V076', 'LUX* Le Morne Mauritius',             'luxmorne@luxresorts.com',                 NULL, '+230-401-4000',    'Mauritius',          'Resort',       4.8, 'Active'),
('V077', 'The Oberoi Mauritius',                'reservations@oberoihotels.com',           NULL, '+230-204-3600',    'Mauritius',          'Resort',       4.9, 'Active'),
('V078', 'Constance Belle Mare Plage Mauritius','bellemareplage@constancehotels.com',      NULL, '+230-402-2600',    'Mauritius',          'Resort',       4.8, 'Active'),
('V079', 'Shanti Maurice Wellness Resort',      'res@shantimaurice.com',                   NULL, '+230-603-7200',    'Mauritius',          'Resort',       4.7, 'Active'),
('V080', 'Heritage Awali Golf & Spa Resort',    'awali@heritageresorts.mu',                NULL, '+230-623-5500',    'Mauritius',          'Resort',       4.6, 'Active'),
('V081', 'Air Mauritius Holidays DMC',          'holidays@airmauritius.com',               NULL, '+230-207-7575',    'Mauritius',          'Tour Operator',4.5, 'Active'),

-- ── SRI LANKA ─────────────────────────────────────────────────────────────────
('V082', 'Shangri-La Colombo Sri Lanka',        'slc@shangri-la.com',                      NULL, '+94-11-788-5700',  'Sri Lanka',          'Hotel',        4.8, 'Active'),
('V083', 'Anantara Peace Haven Tangalle',       'tangalle@anantara.com',                   NULL, '+94-47-808-0800',  'Sri Lanka',          'Resort',       4.8, 'Active'),
('V084', 'Aman Amangalla Galle Fort',           'amangalla@aman.com',                      NULL, '+94-91-223-3388',  'Sri Lanka',          'Hotel',        4.9, 'Active'),
('V085', 'The Fortress Resort & Spa Galle',     'info@thefortress.lk',                     NULL, '+94-91-438-9400',  'Sri Lanka',          'Resort',       4.7, 'Active'),
('V086', 'Wild Coast Tented Lodge Yala Safari', 'wildcoast@resplendent.lk',                NULL, '+94-115-300-700',  'Sri Lanka',          'Villa',        4.9, 'Active'),
('V087', 'Jetwing Travels Sri Lanka DMC',       'leisure@jetwing.net',                     NULL, '+94-11-234-5700',  'Sri Lanka',          'DMC',          4.6, 'Active'),

-- ── VIETNAM ───────────────────────────────────────────────────────────────────
('V088', 'Four Seasons The Nam Hai Hoi An',     'hoian@fourseasons.com',                   NULL, '+84-235-394-0000', 'Vietnam',            'Resort',       4.9, 'Active'),
('V089', 'Anantara Hoi An Resort',              'hoian@anantara.com',                      NULL, '+84-235-391-4555', 'Vietnam',            'Resort',       4.7, 'Active'),
('V090', 'Park Hyatt Saigon Ho Chi Minh City',  'saigon.park@hyatt.com',                   NULL, '+84-28-3824-1234', 'Vietnam',            'Hotel',        4.8, 'Active'),
('V091', 'Paradise Elegance Cruise Ha Long Bay','info@paradisecruises.vn',                 NULL, '+84-24-3942-4443', 'Vietnam',            'Villa',        4.8, 'Active'),
('V092', 'La Siesta Premium Hoi An Hotel',      'reservation@lasiesta-hoian.com',          NULL, '+84-235-391-5915', 'Vietnam',            'Hotel',        4.6, 'Active'),
('V093', 'Destination Asia Vietnam DMC',        'vietnam@destination-asia.com',            NULL, '+84-28-3925-2055', 'Vietnam',            'DMC',          4.7, 'Active'),

-- ── MALAYSIA ──────────────────────────────────────────────────────────────────
('V094', 'The Ritz-Carlton Kuala Lumpur',       'rckl.reservations@ritzcarlton.com',       NULL, '+60-3-2142-8000',  'Malaysia',           'Hotel',        4.8, 'Active'),
('V095', 'The Datai Langkawi',                  'reservations@thedatai.com',               NULL, '+60-4-952-4000',   'Malaysia',           'Resort',       5.0, 'Active'),
('V096', 'Mandarin Oriental Kuala Lumpur',      'mokul-reservations@mohg.com',             NULL, '+60-3-2380-8888',  'Malaysia',           'Hotel',        4.8, 'Active'),
('V097', 'Four Seasons Resort Langkawi',        'reservations.langkawi@fourseasons.com',   NULL, '+60-4-950-8888',   'Malaysia',           'Resort',       4.9, 'Active'),
('V098', 'Shangri-La Rasa Sayang Penang',       'slrsp@shangri-la.com',                    NULL, '+60-4-888-8888',   'Malaysia',           'Resort',       4.7, 'Active'),
('V099', 'Asian Overland Services Malaysia DMC','info@asianoverland.com.my',               NULL, '+60-3-4252-9100',  'Malaysia',           'DMC',          4.5, 'Active'),

-- ── BALI, INDONESIA ───────────────────────────────────────────────────────────
('V100', 'Amandari Ubud Bali',                  'amandari@aman.com',                       NULL, '+62-361-975333',   'Bali',               'Resort',       5.0, 'Active'),
('V101', 'Four Seasons Bali at Sayan Ubud',     'sayan.bali@fourseasons.com',              NULL, '+62-361-977577',   'Bali',               'Resort',       4.9, 'Active'),
('V102', 'The Mulia Nusa Dua Bali',             'reservation@themulia.com',                NULL, '+62-361-3017777',  'Bali',               'Resort',       4.9, 'Active'),
('V103', 'Alila Villas Uluwatu Bali',           'uluwatu@alilahotels.com',                 NULL, '+62-361-848-2166', 'Bali',               'Villa',        4.9, 'Active'),
('V104', 'COMO Shambhala Estate Ubud Bali',     'csebali@comohotels.com',                  NULL, '+62-361-978888',   'Bali',               'Resort',       4.9, 'Active'),
('V105', 'Komaneka at Bisma Ubud Bali',         'reservation@komaneka.com',                NULL, '+62-361-971933',   'Bali',               'Resort',       4.8, 'Active'),
('V106', 'Bali DMC - Discovery Destination Mgmt','info@ddmbali.com',                       NULL, '+62-361-754754',   'Bali',               'DMC',          4.7, 'Active'),

-- ── EUROPE: PARIS ─────────────────────────────────────────────────────────────
('V107', 'Hotel Le Bristol Paris',              'resa@lebristolparis.com',                 NULL, '+33-1-5343-4300',  'Paris',              'Hotel',        5.0, 'Active'),
('V108', 'Shangri-La Paris Eiffel Tower View',  'reservations.slpa@shangri-la.com',        NULL, '+33-1-5367-1998',  'Paris',              'Hotel',        4.9, 'Active'),
('V109', 'Le Meurice Paris Luxury Hotel',       'reservations@lemeurice.com',              NULL, '+33-1-4458-1010',  'Paris',              'Hotel',        4.9, 'Active'),

-- ── EUROPE: SWITZERLAND ───────────────────────────────────────────────────────
('V110', 'Victoria-Jungfrau Grand Hotel Interlaken','welcome@victoria-jungfrau.ch',        NULL, '+41-33-828-2828',  'Switzerland',        'Hotel',        4.9, 'Active'),
('V111', 'Badrutt''s Palace Hotel St. Moritz',  'info@badruttspalace.com',                 NULL, '+41-81-837-1000',  'Switzerland',        'Hotel',        5.0, 'Active'),
('V112', 'The Dolder Grand Zurich',             'reservations@thedoldergrand.com',         NULL, '+41-44-456-6000',  'Switzerland',        'Hotel',        4.8, 'Active'),
('V113', 'Fairmont Le Montreux Palace',         'montreux@fairmont.com',                   NULL, '+41-21-962-1212',  'Switzerland',        'Hotel',        4.7, 'Active'),

-- ── EUROPE: ITALY ─────────────────────────────────────────────────────────────
('V114', 'Hotel Splendido Portofino Italy',     'reservations@hotelsplendido.com',         NULL, '+39-0185-267801',  'Italy',              'Hotel',        5.0, 'Active'),
('V115', 'Four Seasons Hotel Firenze Florence', 'firenze@fourseasons.com',                 NULL, '+39-055-2626-1',   'Italy',              'Hotel',        4.9, 'Active'),
('V116', 'Belmond Cipriani Venice',             'reservation.cipriani@belmond.com',        NULL, '+39-041-240-801',  'Italy',              'Hotel',        5.0, 'Active'),
('V117', 'Rome Cavalieri Waldorf Astoria',      'romecavalieri.reservations@waldorfastoria.com',NULL,'+39-06-35091', 'Italy',              'Hotel',        4.8, 'Active'),

-- ── EUROPE: GREECE ────────────────────────────────────────────────────────────
('V118', 'Canaves Oia Suites Santorini',        'info@canaves.com',                        NULL, '+30-22860-71453',  'Greece',             'Villa',        5.0, 'Active'),
('V119', 'Mystique Hotel Santorini',            'info@mystique.gr',                        NULL, '+30-22860-71114',  'Greece',             'Hotel',        4.9, 'Active'),
('V120', 'Bill & Coo Suites Mykonos',           'info@bill-coo-hotel.com',                 NULL, '+30-22890-26292',  'Greece',             'Hotel',        4.8, 'Active'),
('V121', 'Hotel Grande Bretagne Athens',        'sales.hgb@marriott.com',                  NULL, '+30-210-333-0000', 'Greece',             'Hotel',        4.8, 'Active'),

-- ── EUROPE: SPAIN ─────────────────────────────────────────────────────────────
('V122', 'Mandarin Oriental Barcelona',         'mobcn-reservations@mohg.com',             NULL, '+34-93-151-8888',  'Spain',              'Hotel',        4.9, 'Active'),
('V123', 'Hotel Arts Barcelona Ritz-Carlton',   'reservations.barcelona@ritzcarlton.com',  NULL, '+34-93-221-1000',  'Spain',              'Hotel',        4.8, 'Active'),

-- ── EUROPE: UK / LONDON ───────────────────────────────────────────────────────
('V124', 'The Langham London',                  'tllon.reservations@langhamhotels.com',    NULL, '+44-20-7636-1000', 'London',             'Hotel',        4.8, 'Active'),
('V125', 'Rosewood London Holborn',             'enquiries.london@rosewoodhotels.com',     NULL, '+44-20-7781-8888', 'London',             'Hotel',        4.9, 'Active'),
('V126', 'Claridge''s Hotel London Mayfair',    'info@claridges.co.uk',                    NULL, '+44-20-7629-8860', 'London',             'Hotel',        5.0, 'Active'),

-- ── EUROPE: TURKEY ────────────────────────────────────────────────────────────
('V127', 'Mandarin Oriental Bosphorus Istanbul','mobosph-reservations@mohg.com',           NULL, '+90-212-232-2000', 'Turkey',             'Hotel',        4.9, 'Active'),
('V128', 'Argos in Cappadocia Cave Hotel',      'reservation@argosincappadocia.com',       NULL, '+90-384-219-3130', 'Turkey',             'Hotel',        4.8, 'Active'),
('V129', 'Museum Hotel Cappadocia',             'reservation@museumhotel.com.tr',          NULL, '+90-384-219-2220', 'Turkey',             'Hotel',        4.9, 'Active'),

-- ── EUROPE: AMSTERDAM / PRAGUE ────────────────────────────────────────────────
('V130', 'Waldorf Astoria Amsterdam',           'waldorf.amsterdam@waldorfastoria.com',    NULL, '+31-20-718-4600',  'Amsterdam',          'Hotel',        4.9, 'Active'),
('V131', 'Four Seasons Hotel Prague',           'prague@fourseasons.com',                  NULL, '+420-221-427-000', 'Prague',             'Hotel',        4.9, 'Active')

ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  email       = EXCLUDED.email,
  phone       = EXCLUDED.phone,
  destination = EXCLUDED.destination,
  category    = EXCLUDED.category,
  rating      = EXCLUDED.rating,
  status      = EXCLUDED.status;

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SELECT
  destination,
  COUNT(*) as total,
  ROUND(AVG(rating::NUMERIC),1) as avg_rating,
  STRING_AGG(category, ', ' ORDER BY category) as categories
FROM vendors
GROUP BY destination
ORDER BY destination;

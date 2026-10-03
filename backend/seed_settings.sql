-- ============================================================
-- SAFARNAAMA CRM — SETTINGS & REFERENCE DATA SEED
-- Run in: Supabase SQL Editor → New Query → Run
-- Safe to re-run (uses ON CONFLICT DO UPDATE / IF NOT EXISTS)
-- ============================================================

-- ─── 1. MISSING COLUMNS ON VENDORS ───────────────────────────────────────────
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS destination TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS status      TEXT DEFAULT 'Active';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS image_url   TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email2      TEXT;

-- ─── 2. ITINERARIES TABLE ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS itineraries (
  id            TEXT PRIMARY KEY,
  lead_id       TEXT REFERENCES leads(id) ON DELETE SET NULL,
  title         TEXT,
  destination   TEXT,
  start_date    DATE,
  end_date      DATE,
  num_days      INTEGER DEFAULT 1,
  pax           INTEGER DEFAULT 1,
  adults        INTEGER DEFAULT 1,
  kids          INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'Draft',
  data          JSONB  DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS itineraries_lead_idx   ON itineraries(lead_id);
CREATE INDEX IF NOT EXISTS itineraries_status_idx ON itineraries(status);

-- ─── 3. DESTINATIONS TABLE ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS destinations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  country       TEXT DEFAULT 'India',
  region        TEXT,
  duration      TEXT,
  description   TEXT,
  image_url     TEXT,
  image_query   TEXT,
  highlights    TEXT[],
  inclusions    TEXT[],
  exclusions    TEXT[],
  is_active     BOOLEAN DEFAULT TRUE,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 4. LOOKUP / REFERENCE TABLES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_types (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicle_types (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  capacity INTEGER,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS airlines (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  code  TEXT,
  country TEXT DEFAULT 'India',
  sort_order INTEGER DEFAULT 0
);

-- ─── 5. POPULATE ROOM TYPES ───────────────────────────────────────────────────
INSERT INTO room_types (name, sort_order) VALUES
  ('Standard',              1),
  ('Superior',              2),
  ('Deluxe',                3),
  ('Premium Deluxe',        4),
  ('Junior Suite',          5),
  ('Suite',                 6),
  ('Executive Suite',       7),
  ('Presidential Suite',    8),
  ('Studio',                9),
  ('Cottage',               10),
  ('Villa',                 11),
  ('Tent (Luxury)',         12),
  ('Overwater Bungalow',    13),
  ('Sea View Room',         14),
  ('Garden View Room',      15),
  ('Pool View Room',        16),
  ('Mountain View Room',    17),
  ('Duplex Suite',          18)
ON CONFLICT (name) DO NOTHING;

-- ─── 6. POPULATE VEHICLE TYPES ───────────────────────────────────────────────
INSERT INTO vehicle_types (name, capacity, sort_order) VALUES
  ('Hatchback',                  4,  1),
  ('Sedan',                      4,  2),
  ('SUV',                        6,  3),
  ('Innova Crysta',              7,  4),
  ('Tempo Traveller (12 Seater)',12,  5),
  ('Tempo Traveller (17 Seater)',17,  6),
  ('Mini Bus (20 Seater)',       20,  7),
  ('Luxury Coach (45 Seater)',   45,  8),
  ('Speed Boat',                 8,  9),
  ('Yacht',                     12, 10)
ON CONFLICT (name) DO NOTHING;

-- ─── 7. POPULATE AIRLINES ─────────────────────────────────────────────────────
INSERT INTO airlines (name, code, country, sort_order) VALUES
  -- Indian carriers
  ('IndiGo',           '6E', 'India',        1),
  ('Air India',        'AI', 'India',        2),
  ('Vistara',          'UK', 'India',        3),
  ('SpiceJet',         'SG', 'India',        4),
  ('Go First',         'G8', 'India',        5),
  ('AirAsia India',    'I5', 'India',        6),
  ('Akasa Air',        'QP', 'India',        7),
  ('Alliance Air',     '9I', 'India',        8),
  ('Star Air',         'S5', 'India',        9),
  -- International
  ('Emirates',         'EK', 'UAE',          10),
  ('Qatar Airways',    'QR', 'Qatar',        11),
  ('Singapore Airlines','SQ','Singapore',   12),
  ('Etihad Airways',   'EY', 'UAE',          13),
  ('British Airways',  'BA', 'UK',           14),
  ('Air France',       'AF', 'France',       15),
  ('Lufthansa',        'LH', 'Germany',      16),
  ('Thai Airways',     'TG', 'Thailand',     17),
  ('Malaysia Airlines','MH', 'Malaysia',     18),
  ('SriLankan Airlines','UL','Sri Lanka',    19),
  ('Maldivian',        'Q2', 'Maldives',     20),
  ('Air Mauritius',    'MK', 'Mauritius',    21),
  ('Vietnam Airlines', 'VN', 'Vietnam',      22),
  ('Turkish Airlines', 'TK', 'Turkey',       23),
  ('Oman Air',         'WY', 'Oman',         24),
  ('Air Arabia',       'G9', 'UAE',          25)
ON CONFLICT (name) DO NOTHING;

-- ─── 8. POPULATE DESTINATIONS ────────────────────────────────────────────────
INSERT INTO destinations (id, name, country, region, duration, description, image_query, highlights, inclusions, exclusions, sort_order) VALUES

('DEST001','Goa','India','West India','4N/5D',
 'India''s party capital with golden beaches, Portuguese heritage, and vibrant nightlife.',
 'Goa beach sunset palm trees',
 ARRAY['Baga & Calangute Beach','Old Goa Churches (UNESCO)','Dudhsagar Waterfall','Spice Plantation Tour','Cruise on Mandovi River'],
 ARRAY['4 nights accommodation in selected hotel','Daily breakfast','Airport/railway station transfers (AC vehicle)','Half-day North Goa sightseeing','Half-day South Goa sightseeing','Mandovi River cruise'],
 ARRAY['Airfare / train fare','Lunch & dinner (unless specified)','Personal expenses','Travel insurance','Tips & gratuities'],
 1),

('DEST002','Kerala','India','South India','6N/7D',
 'God''s Own Country — backwaters, hill stations, Ayurveda, and pristine beaches.',
 'Kerala backwaters houseboats green',
 ARRAY['Alleppey Backwater Houseboat Stay','Munnar Tea Plantations','Periyar Wildlife Sanctuary','Kovalam Beach','Ayurvedic Spa & Treatments'],
 ARRAY['6 nights accommodation (2N Munnar | 1N Thekkady | 2N Alleppey Houseboat | 1N Kovalam)','Daily breakfast','All transfers in AC vehicle','Houseboat with all meals included','Boat jetty transfers'],
 ARRAY['Airfare','Lunch & dinner (except houseboat)','Personal expenses','Travel insurance','Jeep safari charges'],
 2),

('DEST003','Kashmir','India','North India','5N/6D',
 'Paradise on Earth — snow-capped peaks, Dal Lake, Mughal gardens, and Gulmarg skiing.',
 'Kashmir Dal Lake snow mountains',
 ARRAY['Dal Lake Shikara Ride','Gulmarg Gondola (Asia''s highest cable car)','Pahalgam Valley & Betaab Valley','Mughal Gardens','Houseboat Stay'],
 ARRAY['5 nights accommodation (2N Houseboat | 1N Gulmarg | 2N Pahalgam)','Daily breakfast & dinner (MAP)','All transfers in AC vehicle','Shikara ride on Dal Lake','Mughal garden visits'],
 ARRAY['Airfare','Gondola cable car tickets','Pony/sledge charges','Personal expenses','Travel insurance'],
 3),

('DEST004','Rajasthan','India','North India','7N/8D',
 'Land of Kings — majestic forts, opulent palaces, golden deserts, and vibrant culture.',
 'Rajasthan Jaipur fort palace desert',
 ARRAY['Amber Fort & City Palace Jaipur','Mehrangarh Fort Jodhpur','Jaisalmer Desert Safari & Camp','Lake Palace Udaipur','Pushkar Camel Fair (seasonal)'],
 ARRAY['7 nights accommodation in palace/heritage hotels','Daily breakfast','All transfers in AC vehicle','Camel safari in Jaisalmer','Boat ride on Lake Pichola Udaipur','Guided fort/palace tours'],
 ARRAY['Airfare','Lunch & dinner (unless specified)','Monument entry fees','Personal expenses','Travel insurance'],
 4),

('DEST005','Andaman Islands','India','Islands','5N/6D',
 'Pristine tropical islands with turquoise waters, coral reefs, and World War II history.',
 'Andaman islands beach coral turquoise water',
 ARRAY['Radhanagar Beach (Asia''s Best Beach)','Cellular Jail & Light & Sound Show','Elephant Beach Snorkelling','Neil Island - Natural Bridge','Ross Island Heritage Walk'],
 ARRAY['5 nights accommodation','Daily breakfast','All ferry transfers & airport transfers','Snorkelling at Elephant Beach (equipment included)','Cellular Jail tour','Glass-bottom boat ride'],
 ARRAY['Airfare to Port Blair','Scuba diving charges','Sea walk charges','Personal expenses','Travel insurance'],
 5),

('DEST006','Himachal Pradesh','India','North India','6N/7D',
 'Mountain paradise — Shimla, Manali, Dalhousie with snow, rivers, and adventure sports.',
 'Himachal Pradesh mountains snow Manali Shimla',
 ARRAY['Shimla Mall Road & Jakhu Temple','Rohtang Pass (snow point)','Solang Valley Adventure Sports','Dalhousie & Khajjiar (Mini Switzerland)','Old Manali Cafes & Culture'],
 ARRAY['6 nights accommodation','Daily breakfast','All transfers in AC vehicle/SUV','Rohtang Pass excursion (if open)','Solang Valley visit'],
 ARRAY['Airfare','Rohtang Pass permit fee','Adventure sports charges','Personal expenses','Travel insurance'],
 6),

('DEST007','Leh-Ladakh','India','North India','6N/7D',
 'World''s highest motorable roads, monasteries, and surreal moonscapes.',
 'Leh Ladakh monastery mountains lake',
 ARRAY['Pangong Tso Lake (14,270 ft)','Khardung La Pass (18,380 ft)','Nubra Valley & Bactrian Camels','Thiksey & Hemis Monasteries','Magnetic Hill & Sangam Point'],
 ARRAY['6 nights accommodation (3N Leh | 1N Nubra | 2N Pangong)','Daily breakfast & dinner','All transfers in SUV/Innova','Inner Line Permits','Oxygen cylinders on request'],
 ARRAY['Airfare','Monastery entry fees','Camel safari in Nubra','Personal expenses','Travel insurance'],
 7),

('DEST008','Golden Triangle','India','North India','5N/6D',
 'India''s classic circuit — Delhi, Agra Taj Mahal, and Jaipur Pink City.',
 'Golden Triangle India Taj Mahal Delhi Jaipur',
 ARRAY['Taj Mahal Sunrise Visit','Red Fort & Qutub Minar Delhi','Amber Fort Jaipur Elephant Ride','Agra Fort','Chandni Chowk Food Walk'],
 ARRAY['5 nights accommodation (2N Delhi | 1N Agra | 2N Jaipur)','Daily breakfast','All transfers in AC vehicle','Guided city tours'],
 ARRAY['Airfare','Monument entry fees','Lunch & dinner','Elephant ride charges','Personal expenses'],
 8),

('DEST009','Dubai','UAE','Middle East','5N/6D',
 'City of superlatives — Burj Khalifa, desert safaris, gold souks, and world-class shopping.',
 'Dubai Burj Khalifa skyline desert',
 ARRAY['Burj Khalifa (At the Top)','Desert Safari with BBQ Dinner','Dubai Mall & Dubai Fountain','Palm Jumeirah & Atlantis','Dhow Cruise Marina'],
 ARRAY['5 nights accommodation in 4-star/5-star hotel','Daily breakfast','Airport transfers','Desert safari with BBQ dinner','Dhow cruise with dinner','Dubai city tour'],
 ARRAY['Visa fees','International airfare','Lunch (unless specified)','Personal expenses','Travel insurance'],
 9),

('DEST010','Singapore','Singapore','Southeast Asia','4N/5D',
 'Asia''s cleanest city — Gardens by the Bay, Universal Studios, Sentosa, and street food.',
 'Singapore Marina Bay Sands Gardens by the Bay',
 ARRAY['Gardens by the Bay & Cloud Forest','Universal Studios Singapore','Sentosa Island Cable Car','Marina Bay Sands SkyPark','Hawker Centre Food Trail'],
 ARRAY['4 nights accommodation','Daily breakfast','Airport transfers','City tour','Sentosa Island day pass'],
 ARRAY['International airfare','Singapore visa fees','Universal Studios tickets','Personal expenses','Travel insurance'],
 10),

('DEST011','Maldives','Maldives','Indian Ocean','5N/6D',
 'Tropical paradise of overwater bungalows, coral reefs, and crystal-clear lagoons.',
 'Maldives overwater bungalow turquoise ocean',
 ARRAY['Overwater Villa Stay','Snorkelling & Manta Ray Watching','Sunset Dolphin Cruise','Underwater Restaurant Dining','Private Beach Picnic'],
 ARRAY['5 nights overwater/beach villa (All Inclusive)','All meals & selected beverages','Speedboat airport transfers','Snorkelling equipment','Sunset fishing trip','Water sports (non-motorised)'],
 ARRAY['International airfare','Seaplane transfers (if required)','Motorised water sports','Personal expenses','Travel insurance'],
 11),

('DEST012','Mauritius','Mauritius','Indian Ocean','6N/7D',
 'Island of romance — lagoons, rainforests, rum distilleries, and pristine beaches.',
 'Mauritius beach lagoon tropical island',
 ARRAY['Le Morne Brabant Beach','Chamarel Coloured Earth & Rum Distillery','Ile aux Cerfs Island','Casela Nature Park','Port Louis Market'],
 ARRAY['6 nights resort accommodation (Half Board)','Breakfast & dinner daily','Airport transfers','Island tour','Glass-bottom boat ride'],
 ARRAY['International airfare','Lunch','Water activities','Personal expenses','Travel insurance'],
 12),

('DEST013','Sri Lanka','Sri Lanka','South Asia','6N/7D',
 'Teardrop of India — ancient temples, tea plantations, leopards, and whale watching.',
 'Sri Lanka Sigiriya Rock temple tea plantation',
 ARRAY['Sigiriya Rock Fortress (UNESCO)','Kandy Temple of the Tooth','Nuwara Eliya Tea Plantation','Yala National Park Safari (Leopard)','Mirissa Whale Watching'],
 ARRAY['6 nights accommodation (1N Colombo | 1N Sigiriya | 2N Kandy/Nuwara | 2N Yala/Mirissa)','Daily breakfast','All transfers in AC vehicle','Guided temple & heritage tours'],
 ARRAY['International airfare','National park entry & jeep safari fees','Whale watching charges','Personal expenses','Travel insurance'],
 13),

('DEST014','Bali','Indonesia','Southeast Asia','6N/7D',
 'Island of the Gods — rice terraces, volcanic peaks, spiritual temples, and surf beaches.',
 'Bali rice terrace temple volcano tropical',
 ARRAY['Uluwatu Temple at Sunset','Tegallalang Rice Terraces','Mount Batur Sunrise Trekking','Seminyak & Kuta Beach','Ubud Monkey Forest & Art Markets'],
 ARRAY['6 nights villa/resort accommodation','Daily breakfast','Airport transfers','Kintamani volcano & Ubud cultural tour','Uluwatu temple & Kecak dance'],
 ARRAY['International airfare','Visa on arrival fee','Lunch & dinner','Personal expenses','Travel insurance'],
 14),

('DEST015','Vietnam','Vietnam','Southeast Asia','8N/9D',
 'From Hanoi''s ancient streets to Ha Long Bay''s limestone karsts and Hoi An lanterns.',
 'Vietnam Ha Long Bay limestone karsts Hoi An',
 ARRAY['Ha Long Bay Cruise (Overnight)','Hoi An Ancient Town & Lanterns','Hue Imperial Citadel','Ho Chi Minh City War Museum','Mekong Delta Day Trip'],
 ARRAY['8 nights accommodation (2N Hanoi | 1N Halong Bay Cruise | 2N Hoi An | 1N Hue | 2N Ho Chi Minh)','Daily breakfast','All domestic flights in Vietnam','Airport transfers','Ha Long Bay cruise with all meals'],
 ARRAY['International airfare to Hanoi / from Ho Chi Minh','Visa fees','Lunch & dinner (except cruise)','Personal expenses','Travel insurance'],
 15),

('DEST016','Malaysia','Malaysia','Southeast Asia','5N/6D',
 'Kuala Lumpur, Langkawi, Penang — a blend of modern city, island paradise, and heritage.',
 'Malaysia Kuala Lumpur Petronas Towers Langkawi',
 ARRAY['Petronas Twin Towers Kuala Lumpur','Langkawi Cable Car & Sky Bridge','Penang George Town Street Art','Batu Caves','Genting Highlands Theme Park'],
 ARRAY['5 nights accommodation (2N KL | 3N Langkawi or Penang)','Daily breakfast','Airport transfers','KL city tour','Langkawi island hopping'],
 ARRAY['International airfare','Visa fees','Lunch & dinner','Personal expenses','Travel insurance'],
 16),

('DEST017','Thailand','Thailand','Southeast Asia','6N/7D',
 'Land of Smiles — Bangkok temples, Phuket beaches, Chiang Mai elephants, and street food.',
 'Thailand Bangkok temple Phuket beach elephant',
 ARRAY['Grand Palace & Wat Pho Bangkok','Phi Phi Islands Boat Tour','Elephant Sanctuary Chiang Mai','Floating Market Bangkok','Patong Beach Phuket'],
 ARRAY['6 nights accommodation (2N Bangkok | 1N Chiang Mai | 3N Phuket)','Daily breakfast','Airport transfers','Phi Phi islands speedboat tour','Bangkok temple tour'],
 ARRAY['International airfare','Thailand visa','Lunch & dinner','Personal expenses','Travel insurance'],
 17),

('DEST018','Turkey','Turkey','Europe/Asia','5N/6D',
 'Istanbul''s domes and minarets meet Cappadocia''s fairy chimneys and hot air balloons.',
 'Turkey Istanbul Cappadocia hot air balloon',
 ARRAY['Hot Air Balloon Ride Cappadocia','Hagia Sophia & Blue Mosque','Göreme Open Air Museum (UNESCO)','Bosphorus Cruise Istanbul','Underground City Derinkuyu'],
 ARRAY['5 nights accommodation (3N Cappadocia | 2N Istanbul)','Daily breakfast','Airport & intercity transfers','Guided Cappadocia tour','Bosphorus cruise'],
 ARRAY['International airfare','Hot air balloon charges','Visa fees','Lunch & dinner','Personal expenses'],
 18),

('DEST019','Europe - Paris & Switzerland','Europe','Europe','8N/9D',
 'Eiffel Tower, Louvre, Swiss Alps, and Rhine Falls — the ultimate European dream.',
 'Paris Eiffel Tower Switzerland Alps snow',
 ARRAY['Eiffel Tower Paris','Louvre Museum','Mount Titlis Switzerland','Rhine Falls Schaffhausen','Zurich & Lucerne Old Town'],
 ARRAY['8 nights accommodation (4N Paris | 4N Switzerland)','Daily breakfast','Intercity coach/train transfers','Mount Titlis cable car','Paris city tour'],
 ARRAY['International airfare','Schengen visa','Lunch & dinner','Eiffel Tower summit ticket','Personal expenses'],
 19),

('DEST020','Europe - Greece','Europe','Europe','5N/6D',
 'Athens Acropolis, Santorini sunsets, and Mykonos nightlife — ancient meets glam.',
 'Greece Santorini blue dome sunset Acropolis',
 ARRAY['Acropolis & Parthenon Athens','Santorini Caldera Sunset','Mykonos Windmills & Little Venice','Oia Village & Blue Domed Churches','Athens Plaka Neighbourhood'],
 ARRAY['5 nights accommodation (2N Athens | 3N Santorini or Mykonos)','Daily breakfast','Ferry or short flight Athens↔island','Airport transfers','Athens guided tour'],
 ARRAY['International airfare','Schengen visa','Lunch & dinner','Personal expenses','Travel insurance'],
 20),

('DEST021','Europe - Italy','Europe','Europe','7N/8D',
 'Rome''s Colosseum, Venice canals, Florence art, and Amalfi Coast cliffs.',
 'Italy Rome Colosseum Venice canal Florence',
 ARRAY['Colosseum & Roman Forum Rome','Vatican Museums & Sistine Chapel','Venice Grand Canal Gondola','Uffizi Gallery Florence','Amalfi Coast Drive'],
 ARRAY['7 nights accommodation (2N Rome | 2N Florence | 2N Venice | 1N Amalfi)','Daily breakfast','Intercity train (Frecciarossa)','Airport transfers','Gondola ride Venice'],
 ARRAY['International airfare','Schengen visa','Lunch & dinner','Museum entry fees','Personal expenses'],
 21),

('DEST022','Varanasi & Rishikesh','India','North India','4N/5D',
 'Spiritual India — Ganga Aarti at Varanasi and yoga & adventure at Rishikesh.',
 'Varanasi Ganga Aarti ghats Rishikesh yoga',
 ARRAY['Ganga Aarti at Dashashwamedh Ghat','Sarnath Buddhist Pilgrimage Site','Bungee Jumping Rishikesh','River Rafting Ganga','Beatles Ashram Rishikesh'],
 ARRAY['4 nights accommodation (2N Varanasi | 2N Rishikesh)','Daily breakfast','All transfers in AC vehicle','Boat ride on Ganga at Varanasi','Evening Ganga Aarti viewing'],
 ARRAY['Airfare/train fare','River rafting & adventure charges','Lunch & dinner','Personal expenses','Travel insurance'],
 22),

('DEST023','Darjeeling & Sikkim','India','East India','5N/6D',
 'Toy train, tea gardens, Buddhist monasteries, and panoramic views of Kanchenjunga.',
 'Darjeeling tea garden Sikkim monastery mountains',
 ARRAY['Darjeeling Toy Train (UNESCO Heritage)','Tiger Hill Sunrise & Kanchenjunga View','Rumtek Monastery Sikkim','Tsomgo Lake (Changu Lake)','Pelling & Rabdentse Ruins'],
 ARRAY['5 nights accommodation (2N Darjeeling | 3N Gangtok/Pelling)','Daily breakfast','All transfers in SUV','Toy train joy ride','Tea estate visit'],
 ARRAY['Airfare/train to Bagdogra','NJP to Darjeeling cab not included','Tsomgo Lake permit','Personal expenses','Travel insurance'],
 23)

ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  image_query = EXCLUDED.image_query,
  highlights  = EXCLUDED.highlights,
  inclusions  = EXCLUDED.inclusions,
  exclusions  = EXCLUDED.exclusions,
  sort_order  = EXCLUDED.sort_order;

-- ─── 9. BIZ SETTINGS (dropdown lists & defaults) ─────────────────────────────
INSERT INTO app_settings (key, value) VALUES ('biz_settings', '{
  "tax_name": "GST",
  "tax_rate": 5,
  "currency_symbol": "₹",
  "currency_locale": "en-IN",
  "emergency_contact": "+91-9999999999",
  "default_markup_pct": 22,
  "lead_statuses":     ["New","Quote Requested","Quote Received","Quote Sent","Confirmed","Cancelled"],
  "quote_statuses":    ["Quote Requested","Quote Received","Quote Sent"],
  "task_statuses":     ["Open","In Progress","Done"],
  "task_priorities":   ["Low","Medium","High"],
  "itin_statuses":     ["Draft","Confirmed","Sent","Archived"],
  "flight_classes":    ["Economy","Premium Economy","Business","First"],
  "meal_plans":        ["Room Only","CP (Breakfast Only)","MAP (Breakfast + Dinner)","AP (All Meals)","All Inclusive"],
  "vendor_categories": ["Hotel","Resort","Villa","Tour Operator","DMC","Activity","Transport","Airline","Restaurant"],
  "room_types":        ["Standard","Superior","Deluxe","Premium Deluxe","Junior Suite","Suite","Executive Suite","Presidential Suite","Studio","Cottage","Villa","Tent (Luxury)","Overwater Bungalow","Sea View Room","Garden View Room","Pool View Room","Mountain View Room"],
  "vehicle_types":     ["Hatchback","Sedan","SUV","Innova Crysta","Tempo Traveller (12 Seater)","Tempo Traveller (17 Seater)","Mini Bus (20 Seater)","Luxury Coach (45 Seater)","Speed Boat","Yacht"],
  "airlines":          ["IndiGo","Air India","Vistara","SpiceJet","Go First","AirAsia India","Akasa Air","Alliance Air","Star Air","Emirates","Qatar Airways","Singapore Airlines","Etihad Airways","British Airways","Air France","Lufthansa","Thai Airways","Malaysia Airlines","SriLankan Airlines","Maldivian","Air Mauritius","Vietnam Airlines","Turkish Airlines","Oman Air","Air Arabia"]
}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- ─── 10. VERIFY ────────────────────────────────────────────────────────────────
SELECT 'destinations' as tbl, COUNT(*) FROM destinations
UNION ALL SELECT 'room_types',    COUNT(*) FROM room_types
UNION ALL SELECT 'vehicle_types', COUNT(*) FROM vehicle_types
UNION ALL SELECT 'airlines',      COUNT(*) FROM airlines
UNION ALL SELECT 'biz_settings',  COUNT(*) FROM app_settings WHERE key='biz_settings'
UNION ALL SELECT 'itineraries_table_created', COUNT(*) FROM itineraries;

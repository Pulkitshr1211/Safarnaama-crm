-- ============================================================
-- SAFARNAAMA CRM — REFERENCE DATA SEED (self-contained)
-- Creates all reference tables if missing, then seeds data.
-- Run in: Supabase SQL Editor → New Query → Run
-- Safe to re-run (uses ON CONFLICT DO NOTHING / IF NOT EXISTS)
-- ============================================================

-- ─── 1. CREATE TABLES IF NOT EXISTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS destinations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  country     TEXT DEFAULT 'India',
  region      TEXT,
  duration    TEXT,
  description TEXT,
  image_url   TEXT,
  image_query TEXT,
  highlights  TEXT[],
  inclusions  TEXT[],
  exclusions  TEXT[],
  is_active   BOOLEAN DEFAULT TRUE,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_types (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicle_types (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  capacity   INTEGER,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS airlines (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  code       TEXT,
  country    TEXT DEFAULT 'India',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. SEED ROOM TYPES ───────────────────────────────────────────────────────
INSERT INTO room_types (name, sort_order) VALUES
  ('Standard',1),('Superior',2),('Deluxe',3),('Premium Deluxe',4),
  ('Junior Suite',5),('Suite',6),('Executive Suite',7),('Presidential Suite',8),
  ('Studio',9),('Cottage',10),('Villa',11),('Tent (Luxury)',12),
  ('Overwater Bungalow',13),('Sea View Room',14),('Garden View Room',15),
  ('Pool View Room',16),('Mountain View Room',17),('Duplex Suite',18)
ON CONFLICT (name) DO NOTHING;

-- ─── 3. SEED VEHICLE TYPES ───────────────────────────────────────────────────
INSERT INTO vehicle_types (name, capacity, sort_order) VALUES
  ('Hatchback',4,1),('Sedan',4,2),('SUV',6,3),('Innova Crysta',7,4),
  ('Tempo Traveller (12 Seater)',12,5),('Tempo Traveller (17 Seater)',17,6),
  ('Mini Bus (20 Seater)',20,7),('Luxury Coach (45 Seater)',45,8),
  ('Speed Boat',8,9),('Yacht',12,10)
ON CONFLICT (name) DO NOTHING;

-- ─── 4. SEED AIRLINES ────────────────────────────────────────────────────────
INSERT INTO airlines (name, code, country, sort_order) VALUES
  ('IndiGo','6E','India',1),('Air India','AI','India',2),('Vistara','UK','India',3),
  ('SpiceJet','SG','India',4),('Go First','G8','India',5),('AirAsia India','I5','India',6),
  ('Akasa Air','QP','India',7),('Alliance Air','9I','India',8),('Star Air','S5','India',9),
  ('Emirates','EK','UAE',10),('Qatar Airways','QR','Qatar',11),('Singapore Airlines','SQ','Singapore',12),
  ('Etihad Airways','EY','UAE',13),('British Airways','BA','UK',14),('Air France','AF','France',15),
  ('Lufthansa','LH','Germany',16),('Thai Airways','TG','Thailand',17),('Malaysia Airlines','MH','Malaysia',18),
  ('SriLankan Airlines','UL','Sri Lanka',19),('Maldivian','Q2','Maldives',20),
  ('Air Mauritius','MK','Mauritius',21),('Vietnam Airlines','VN','Vietnam',22),
  ('Turkish Airlines','TK','Turkey',23),('Oman Air','WY','Oman',24),('Air Arabia','G9','UAE',25)
ON CONFLICT (name) DO NOTHING;

-- ─── 5. SEED DESTINATIONS (base rows, no cities yet) ─────────────────────────
INSERT INTO destinations (id, name, country, region, sort_order) VALUES
  ('DEST001','Goa','India','West India',1),
  ('DEST002','Kerala','India','South India',2),
  ('DEST003','Kashmir','India','North India',3),
  ('DEST004','Rajasthan','India','North India',4),
  ('DEST005','Andaman Islands','India','Island',5),
  ('DEST006','Himachal Pradesh','India','North India',6),
  ('DEST007','Leh-Ladakh','India','North India',7),
  ('DEST008','Golden Triangle','India','North India',8),
  ('DEST009','Varanasi & Rishikesh','India','North India',9),
  ('DEST010','Darjeeling & Sikkim','India','East India',10),
  ('DEST011','Dubai','UAE','Middle East',11),
  ('DEST012','Singapore','Singapore','South East Asia',12),
  ('DEST013','Maldives','Maldives','Indian Ocean',13),
  ('DEST014','Mauritius','Mauritius','Indian Ocean',14),
  ('DEST015','Sri Lanka','Sri Lanka','South Asia',15),
  ('DEST016','Bali','Indonesia','South East Asia',16),
  ('DEST017','Vietnam','Vietnam','South East Asia',17),
  ('DEST018','Malaysia','Malaysia','South East Asia',18),
  ('DEST019','Thailand','Thailand','South East Asia',19),
  ('DEST020','Turkey','Turkey','Europe / Middle East',20),
  ('DEST021','Europe - Paris & Switzerland','Europe','Europe',21),
  ('DEST022','Europe - Greece','Europe','Europe',22),
  ('DEST023','Europe - Italy','Europe','Europe',23)
ON CONFLICT (id) DO NOTHING;

-- ─── 6. ADD cities COLUMN TO destinations ────────────────────────────────────
ALTER TABLE destinations ADD COLUMN IF NOT EXISTS cities JSONB DEFAULT '[]'::jsonb;

-- ─── 7. UPDATE CITIES PER DESTINATION ────────────────────────────────────────
UPDATE destinations SET cities = '["North Goa","South Goa","Panaji","Calangute","Baga","Anjuna","Vagator","Colva","Palolem","Margao","Old Goa"]'::jsonb WHERE name = 'Goa';
UPDATE destinations SET cities = '["Kochi","Munnar","Alleppey","Thekkady","Kovalam","Thiruvananthapuram","Kumarakom","Varkala","Wayanad","Fort Kochi"]'::jsonb WHERE name = 'Kerala';
UPDATE destinations SET cities = '["Srinagar","Gulmarg","Pahalgam","Sonamarg","Dal Lake","Doodhpathri"]'::jsonb WHERE name = 'Kashmir';
UPDATE destinations SET cities = '["Jaipur","Jodhpur","Udaipur","Jaisalmer","Pushkar","Ajmer","Mount Abu","Bikaner","Chittorgarh","Ranthambore"]'::jsonb WHERE name = 'Rajasthan';
UPDATE destinations SET cities = '["Port Blair","Havelock Island","Neil Island","Diglipur","Long Island","Ross Island","Baratang"]'::jsonb WHERE name = 'Andaman Islands';
UPDATE destinations SET cities = '["Shimla","Manali","Dalhousie","Dharamsala","McLeod Ganj","Kasauli","Spiti Valley","Kufri","Kullu","Bir Billing"]'::jsonb WHERE name = 'Himachal Pradesh';
UPDATE destinations SET cities = '["Leh","Nubra Valley","Pangong Tso","Diskit","Turtuk","Kargil","Zanskar","Magnetic Hill"]'::jsonb WHERE name = 'Leh-Ladakh';
UPDATE destinations SET cities = '["Delhi","Agra","Jaipur","Mathura","Vrindavan","Fatehpur Sikri"]'::jsonb WHERE name = 'Golden Triangle';
UPDATE destinations SET cities = '["Varanasi","Rishikesh","Haridwar","Prayagraj","Sarnath"]'::jsonb WHERE name = 'Varanasi & Rishikesh';
UPDATE destinations SET cities = '["Darjeeling","Gangtok","Pelling","Lachen","Lachung","Namchi","Ravangla","Yuksom"]'::jsonb WHERE name = 'Darjeeling & Sikkim';
UPDATE destinations SET cities = '["Dubai","Abu Dhabi","Sharjah","Ajman","Ras Al Khaimah","Fujairah"]'::jsonb WHERE name = 'Dubai';
UPDATE destinations SET cities = '["Singapore City","Sentosa Island","Marina Bay","Orchard Road","Little India","Chinatown"]'::jsonb WHERE name = 'Singapore';
UPDATE destinations SET cities = '["Malé","Hulhumalé","Maafushi","Baa Atoll","Ari Atoll","Kaafu Atoll","Raa Atoll","Noonu Atoll","Lhaviyani Atoll"]'::jsonb WHERE name = 'Maldives';
UPDATE destinations SET cities = '["Port Louis","Grand Baie","Flic en Flac","Belle Mare","Chamarel","Mahébourg","Trou aux Biches","Blue Bay"]'::jsonb WHERE name = 'Mauritius';
UPDATE destinations SET cities = '["Colombo","Kandy","Nuwara Eliya","Galle","Yala","Sigiriya","Mirissa","Trincomalee","Ella","Bentota"]'::jsonb WHERE name = 'Sri Lanka';
UPDATE destinations SET cities = '["Ubud","Seminyak","Kuta","Nusa Dua","Canggu","Uluwatu","Sanur","Jimbaran","Lovina","Amed"]'::jsonb WHERE name = 'Bali';
UPDATE destinations SET cities = '["Hanoi","Ho Chi Minh City","Hoi An","Hue","Ha Long Bay","Da Nang","Sapa","Nha Trang","Phú Quốc","Mũi Né"]'::jsonb WHERE name = 'Vietnam';
UPDATE destinations SET cities = '["Kuala Lumpur","Langkawi","Penang","Genting Highlands","Kota Kinabalu","Malacca","Cameron Highlands"]'::jsonb WHERE name = 'Malaysia';
UPDATE destinations SET cities = '["Bangkok","Phuket","Chiang Mai","Koh Samui","Pattaya","Krabi","Hua Hin","Koh Phangan","Koh Lanta","Chiang Rai"]'::jsonb WHERE name = 'Thailand';
UPDATE destinations SET cities = '["Istanbul","Cappadocia","Antalya","Bodrum","Izmir","Ephesus","Pamukkale","Ankara","Alanya"]'::jsonb WHERE name = 'Turkey';
UPDATE destinations SET cities = '["Paris","Versailles","Zurich","Lucerne","Interlaken","Geneva","Bern","Grindelwald","Zermatt","Lausanne"]'::jsonb WHERE name = 'Europe - Paris & Switzerland';
UPDATE destinations SET cities = '["Athens","Santorini","Mykonos","Thessaloniki","Crete","Rhodes","Corfu","Meteora","Delphi"]'::jsonb WHERE name = 'Europe - Greece';
UPDATE destinations SET cities = '["Rome","Florence","Venice","Milan","Amalfi Coast","Naples","Cinque Terre","Turin","Positano"]'::jsonb WHERE name = 'Europe - Italy';

-- ─── 8. CREATE activities TABLE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id          SERIAL PRIMARY KEY,
  destination TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INT  DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS activities_dest_name_idx ON activities (destination, name);

-- ─── 9. SEED ACTIVITIES ───────────────────────────────────────────────────────
INSERT INTO activities (destination, name, sort_order) VALUES
-- Goa
('Goa','Water Sports (Baga Beach)',1),('Goa','Dudhsagar Waterfall Trek',2),('Goa','Old Goa Heritage Walk',3),('Goa','Spice Plantation Visit',4),('Goa','Sunset Cruise on Mandovi River',5),('Goa','Casino Night',6),('Goa','Anjuna Flea Market',7),('Goa','Dolphin Watching',8),('Goa','Parasailing',9),('Goa','Jet Skiing',10),('Goa','Scuba Diving',11),
-- Kerala
('Kerala','Kathakali Dance Performance',1),('Kerala','Kalaripayattu Show',2),('Kerala','Ayurvedic Massage & Spa',3),('Kerala','Elephant Feeding at Periyar',4),('Kerala','Munnar Tea Factory Tour',5),('Kerala','Backwater Kayaking',6),('Kerala','Houseboat Cruise',7),('Kerala','Snake Boat Race',8),('Kerala','Thekkady Jungle Safari',9),('Kerala','Wayanad Trekking',10),
-- Kashmir
('Kashmir','Shikara Ride on Dal Lake',1),('Kashmir','Gulmarg Gondola Cable Car',2),('Kashmir','Pahalgam Horse Riding',3),('Kashmir','Sonamarg Glacier Trek',4),('Kashmir','Betaab Valley Visit',5),('Kashmir','Skiing at Gulmarg',6),('Kashmir','Mughal Garden Tour',7),('Kashmir','Saffron Field Visit',8),('Kashmir','Pahalgam River Rafting',9),
-- Rajasthan
('Rajasthan','Camel Safari in Jaisalmer',1),('Rajasthan','Desert Camp with Folk Dance',2),('Rajasthan','Amber Fort Elephant Ride',3),('Rajasthan','City Palace Tour Jaipur',4),('Rajasthan','Mehrangarh Fort Tour',5),('Rajasthan','Lake Pichola Boat Ride',6),('Rajasthan','Hot Air Balloon Ride Jaipur',7),('Rajasthan','Pushkar Camel Fair',8),('Rajasthan','Turban Tying Experience',9),('Rajasthan','Rajasthani Cooking Class',10),
-- Andaman Islands
('Andaman Islands','Snorkelling at Elephant Beach',1),('Andaman Islands','Scuba Diving at Havelock',2),('Andaman Islands','Glass Bottom Boat Ride',3),('Andaman Islands','Sea Walk',4),('Andaman Islands','Cellular Jail Tour & Light Show',5),('Andaman Islands','Ross Island Heritage Walk',6),('Andaman Islands','Kayaking at Neil Island',7),('Andaman Islands','Jet Skiing',8),('Andaman Islands','Parasailing',9),('Andaman Islands','Deep Sea Fishing',10),
-- Himachal Pradesh
('Himachal Pradesh','Rohtang Pass Snow Experience',1),('Himachal Pradesh','Solang Valley Adventure Sports',2),('Himachal Pradesh','River Rafting on Beas',3),('Himachal Pradesh','Paragliding at Bir Billing',4),('Himachal Pradesh','Khajjiar Meadow Walk',5),('Himachal Pradesh','Shimla Toy Train Ride',6),('Himachal Pradesh','Triund Trek',7),('Himachal Pradesh','Apple Orchard Visit',8),('Himachal Pradesh','Hadimba Devi Temple Visit',9),
-- Leh-Ladakh
('Leh-Ladakh','Pangong Lake Visit',1),('Leh-Ladakh','Khardung La Pass Drive',2),('Leh-Ladakh','Nubra Valley Camel Safari',3),('Leh-Ladakh','Thiksey Monastery Visit',4),('Leh-Ladakh','River Rafting on Zanskar',5),('Leh-Ladakh','Stargazing at Pangong',6),('Leh-Ladakh','Kargil War Memorial Visit',7),('Leh-Ladakh','Alchi Monastery Tour',8),('Leh-Ladakh','Mountain Biking',9),('Leh-Ladakh','Hemis Festival',10),
-- Golden Triangle
('Golden Triangle','Taj Mahal Sunrise Visit',1),('Golden Triangle','Red Fort & Chandni Chowk',2),('Golden Triangle','Amber Fort Jaipur',3),('Golden Triangle','Agra Fort Tour',4),('Golden Triangle','Qutub Minar Delhi',5),('Golden Triangle','Fatehpur Sikri Excursion',6),('Golden Triangle','Old Delhi Street Food Walk',7),('Golden Triangle','Jaipur Bazaar Shopping',8),('Golden Triangle','Mathura Vrindavan Day Trip',9),
-- Varanasi & Rishikesh
('Varanasi & Rishikesh','Ganga Aarti at Dashashwamedh Ghat',1),('Varanasi & Rishikesh','Sunrise Boat Ride on Ganga',2),('Varanasi & Rishikesh','Sarnath Buddhist Site Visit',3),('Varanasi & Rishikesh','River Rafting Rishikesh',4),('Varanasi & Rishikesh','Bungee Jumping Rishikesh',5),('Varanasi & Rishikesh','Beatles Ashram Visit',6),('Varanasi & Rishikesh','Yoga Class Rishikesh',7),('Varanasi & Rishikesh','Kashi Vishwanath Temple',8),('Varanasi & Rishikesh','Laxman Jhula Walk',9),
-- Darjeeling & Sikkim
('Darjeeling & Sikkim','Darjeeling Toy Train Ride',1),('Darjeeling & Sikkim','Tiger Hill Sunrise View',2),('Darjeeling & Sikkim','Rumtek Monastery Visit',3),('Darjeeling & Sikkim','Tsomgo Lake Excursion',4),('Darjeeling & Sikkim','Tea Garden Walk',5),('Darjeeling & Sikkim','Himalayan Mountaineering Institute',6),('Darjeeling & Sikkim','Pelling Skywalk',7),('Darjeeling & Sikkim','Nathula Pass Excursion',8),('Darjeeling & Sikkim','Kanchenjunga View Point',9),
-- Dubai
('Dubai','Desert Safari with BBQ Dinner',1),('Dubai','Burj Khalifa (At the Top)',2),('Dubai','Dubai Mall & Fountain Show',3),('Dubai','Palm Jumeirah Tour',4),('Dubai','Dhow Cruise Marina',5),('Dubai','Global Village Visit',6),('Dubai','IMG Worlds of Adventure',7),('Dubai','Ski Dubai',8),('Dubai','Dubai Frame',9),('Dubai','Helicopter Tour',10),
-- Singapore
('Singapore','Universal Studios Singapore',1),('Singapore','Gardens by the Bay',2),('Singapore','Night Safari',3),('Singapore','S.E.A. Aquarium',4),('Singapore','Singapore Cable Car',5),('Singapore','Sentosa Luge & Skyride',6),('Singapore','River Wonders',7),('Singapore','ArtScience Museum',8),('Singapore','Chinatown Heritage Walk',9),('Singapore','Little India Exploration',10),
-- Maldives
('Maldives','Snorkelling at House Reef',1),('Maldives','Scuba Diving',2),('Maldives','Manta Ray Watching',3),('Maldives','Dolphin Cruise',4),('Maldives','Sunset Fishing Trip',5),('Maldives','Submarine Ride',6),('Maldives','Whale Shark Safari',7),('Maldives','Private Beach Picnic',8),('Maldives','Water Skiing',9),('Maldives','Parasailing',10),
-- Mauritius
('Mauritius','Ile aux Cerfs Island Trip',1),('Mauritius','Chamarel Coloured Earth',2),('Mauritius','Casela Nature Park',3),('Mauritius','Rum Distillery Tour',4),('Mauritius','Catamaran Cruise',5),('Mauritius','Undersea Walk',6),('Mauritius','Zipline Adventure',7),('Mauritius','Dolphin Swimming',8),('Mauritius','7 Coloured Earth Tour',9),('Mauritius','Port Louis Market Walk',10),
-- Sri Lanka
('Sri Lanka','Sigiriya Rock Climb',1),('Sri Lanka','Yala National Park Safari',2),('Sri Lanka','Whale Watching Mirissa',3),('Sri Lanka','Temple of the Tooth Tour',4),('Sri Lanka','Tea Plantation Walk Nuwara Eliya',5),('Sri Lanka','Kandy Cultural Dance Show',6),('Sri Lanka','Galle Fort Walk',7),('Sri Lanka','White Water Rafting Kitulgala',8),
-- Bali
('Bali','Uluwatu Temple & Kecak Dance',1),('Bali','Mount Batur Sunrise Trek',2),('Bali','Tegallalang Rice Terrace Walk',3),('Bali','Ubud Monkey Forest',4),('Bali','Bali Swing',5),('Bali','White Water Rafting Ayung',6),('Bali','Tanah Lot Sunset Visit',7),('Bali','Balinese Cooking Class',8),('Bali','Spa & Traditional Massage',9),
-- Vietnam
('Vietnam','Ha Long Bay Cruise',1),('Vietnam','Hoi An Lantern Making Class',2),('Vietnam','Cu Chi Tunnels Tour',3),('Vietnam','Hue Imperial Citadel Tour',4),('Vietnam','Mekong Delta Day Trip',5),('Vietnam','Sapa Trekking',6),('Vietnam','Vietnamese Cooking Class',7),('Vietnam','Cyclo Ride Hanoi Old Quarter',8),('Vietnam','Water Puppet Show',9),
-- Malaysia
('Malaysia','Petronas Twin Towers Visit',1),('Malaysia','Langkawi Cable Car & SkyBridge',2),('Malaysia','Penang Street Art Walk',3),('Malaysia','Batu Caves Climb',4),('Malaysia','Genting Theme Park',5),('Malaysia','Mangrove Firefly River Cruise',6),('Malaysia','Kuala Lumpur City Tour',7),('Malaysia','Malacca Heritage Walk',8),
-- Thailand
('Thailand','Phi Phi Islands Boat Tour',1),('Thailand','Elephant Sanctuary Visit',2),('Thailand','Thai Cooking Class',3),('Thailand','Grand Palace & Wat Pho Tour',4),('Thailand','Water Sports Patong Beach',5),('Thailand','Muay Thai Show',6),('Thailand','Night Bazaar Shopping',7),('Thailand','ATV Quad Biking',8),
-- Turkey
('Turkey','Hot Air Balloon Ride Cappadocia',1),('Turkey','Hagia Sophia & Blue Mosque',2),('Turkey','Bosphorus Cruise Istanbul',3),('Turkey','Underground City Tour',4),('Turkey','Göreme Open Air Museum',5),('Turkey','Whirling Dervish Show',6),('Turkey','Turkish Bath (Hammam)',7),('Turkey','Grand Bazaar Shopping',8),('Turkey','Ephesus Ancient City Tour',9),('Turkey','Pamukkale Thermal Pools',10),
-- Europe - Paris & Switzerland
('Europe - Paris & Switzerland','Eiffel Tower Visit',1),('Europe - Paris & Switzerland','Louvre Museum Tour',2),('Europe - Paris & Switzerland','Mount Titlis Excursion',3),('Europe - Paris & Switzerland','Rhine Falls Visit',4),('Europe - Paris & Switzerland','Versailles Palace Tour',5),('Europe - Paris & Switzerland','Seine River Cruise',6),('Europe - Paris & Switzerland','Champs-Élysées Walk',7),('Europe - Paris & Switzerland','Interlaken Adventure Sports',8),('Europe - Paris & Switzerland','Matterhorn View Zermatt',9),('Europe - Paris & Switzerland','Swiss Chocolate Factory Tour',10),
-- Europe - Greece
('Europe - Greece','Acropolis & Parthenon Tour',1),('Europe - Greece','Santorini Caldera Boat Tour',2),('Europe - Greece','Mykonos Windmills Walk',3),('Europe - Greece','Athens Plaka Food Tour',4),('Europe - Greece','Wine Tasting Santorini',5),('Europe - Greece','Sunset at Oia',6),('Europe - Greece','Meteora Monastery Visit',7),('Europe - Greece','Greek Cooking Class',8),('Europe - Greece','Island Hopping',9),
-- Europe - Italy
('Europe - Italy','Colosseum & Roman Forum Tour',1),('Europe - Italy','Vatican Museums & Sistine Chapel',2),('Europe - Italy','Venice Gondola Ride',3),('Europe - Italy','Uffizi Gallery Florence',4),('Europe - Italy','Amalfi Coast Drive',5),('Europe - Italy','Pompeii Ruins Tour',6),('Europe - Italy','Cinque Terre Hiking',7),('Europe - Italy','Pizza & Pasta Cooking Class',8)
ON CONFLICT (destination, name) DO NOTHING;

-- ─── 10. ENSURE meal_plans + flight_classes are in biz_settings ──────────────
INSERT INTO app_settings (key, value) VALUES (
  'biz_settings',
  '{"meal_plans":["Room Only","CP (Breakfast Only)","MAP (Breakfast + Dinner)","AP (All Meals)","All Inclusive"],"flight_classes":["Economy","Premium Economy","Business","First"]}'::jsonb
)
ON CONFLICT (key) DO UPDATE
  SET value = app_settings.value
    || '{"meal_plans":["Room Only","CP (Breakfast Only)","MAP (Breakfast + Dinner)","AP (All Meals)","All Inclusive"],"flight_classes":["Economy","Premium Economy","Business","First"]}'::jsonb;

-- ─── 11. VERIFY ───────────────────────────────────────────────────────────────
SELECT 'destinations' AS tbl, COUNT(*)::TEXT AS cnt, COUNT(CASE WHEN jsonb_array_length(cities)>0 THEN 1 END)::TEXT AS with_cities FROM destinations
UNION ALL
SELECT 'activities', COUNT(*)::TEXT, COUNT(DISTINCT destination)::TEXT FROM activities
UNION ALL
SELECT 'room_types', COUNT(*)::TEXT, '' FROM room_types
UNION ALL
SELECT 'airlines', COUNT(*)::TEXT, '' FROM airlines
UNION ALL
SELECT 'vehicle_types', COUNT(*)::TEXT, '' FROM vehicle_types;

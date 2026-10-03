-- ============================================================
-- SAFARNAAMA CRM — Destination Inclusions & Exclusions Seed
-- Run once in Supabase SQL Editor (or psql) after tables exist.
-- Safe to re-run: all inserts use ON CONFLICT DO NOTHING.
-- ============================================================

-- ── TABLE: destination_inclusions ────────────────────────────
CREATE TABLE IF NOT EXISTS destination_inclusions (
  id          SERIAL PRIMARY KEY,
  destination TEXT,
  text        TEXT NOT NULL,
  sort_order  INT  DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inc_dest_text
  ON destination_inclusions (destination, text);

-- ── TABLE: destination_exclusions ────────────────────────────
CREATE TABLE IF NOT EXISTS destination_exclusions (
  id          SERIAL PRIMARY KEY,
  destination TEXT,
  text        TEXT NOT NULL,
  sort_order  INT  DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exc_dest_text
  ON destination_exclusions (destination, text);

-- ============================================================
-- SEED: INCLUSIONS
-- ============================================================

-- GOA
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Goa', 'Return airfare (Economy class) from major metro', 1),
  ('Goa', 'Hotel on twin sharing with daily breakfast (4-star beach property)', 2),
  ('Goa', 'Goa city tour — Old Goa churches, spice plantation', 3),
  ('Goa', 'South Goa beach hopping (Colva, Benaulim, Palolem)', 4),
  ('Goa', 'North Goa day trip (Calangute, Baga, Anjuna flea market)', 5),
  ('Goa', 'Sunset cruise on Mandovi River with dinner', 6),
  ('Goa', 'All transfers in AC vehicle', 7),
  ('Goa', 'Airport meet & assist', 8)
ON CONFLICT (destination, text) DO NOTHING;

-- KERALA
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Kerala', 'Return airfare (Economy) to Kochi', 1),
  ('Kerala', '1N Kochi — Fort Kochi heritage walk, Chinese fishing nets', 2),
  ('Kerala', '2N Munnar — tea plantation tour, Eravikulam National Park', 3),
  ('Kerala', '1N Thekkady — Periyar Wildlife Sanctuary boat ride', 4),
  ('Kerala', '2N Alleppey — Premium AC houseboat with all meals', 5),
  ('Kerala', 'All transfers in AC vehicle', 6),
  ('Kerala', 'Daily breakfast at hotels', 7)
ON CONFLICT (destination, text) DO NOTHING;

-- KASHMIR
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Kashmir', 'Return airfare to Srinagar', 1),
  ('Kashmir', '3N Deluxe Houseboat on Dal Lake with breakfast & dinner', 2),
  ('Kashmir', '2N Pahalgam hotel with breakfast & dinner', 3),
  ('Kashmir', 'Shikara ride on Dal Lake (1 hour)', 4),
  ('Kashmir', 'Gulmarg Gondola ride (Phase 1 included)', 5),
  ('Kashmir', 'Pahalgam local sightseeing — Baisaran, Betaab Valley', 6),
  ('Kashmir', 'Mughal Gardens visit', 7),
  ('Kashmir', 'All transfers in private vehicle', 8)
ON CONFLICT (destination, text) DO NOTHING;

-- RAJASTHAN
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Rajasthan', 'Return airfare or AC train (Delhi ↔ Jaipur)', 1),
  ('Rajasthan', 'Hotel accommodation with daily breakfast (heritage/4-star)', 2),
  ('Rajasthan', 'Jaipur city tour — Amber Fort, City Palace, Hawa Mahal', 3),
  ('Rajasthan', 'Jodhpur — Mehrangarh Fort, Jaswant Thada', 4),
  ('Rajasthan', 'Udaipur — City Palace, Pichola Lake boat ride', 5),
  ('Rajasthan', 'Jaisalmer — Golden Fort, Desert Safari with camel ride & bonfire', 6),
  ('Rajasthan', 'All intercity transfers in AC vehicle', 7)
ON CONFLICT (destination, text) DO NOTHING;

-- HIMACHAL PRADESH
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Himachal Pradesh', 'Return airfare to Chandigarh or Kullu-Manali', 1),
  ('Himachal Pradesh', '2N Shimla with breakfast — Mall Road, Jakhu Temple, Kufri', 2),
  ('Himachal Pradesh', '3N Manali with breakfast — Rohtang Pass excursion, Solang Valley, Hadimba Temple', 3),
  ('Himachal Pradesh', 'Old Manali & Manu Temple visit', 4),
  ('Himachal Pradesh', 'All transfers in AC vehicle', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- ANDAMAN ISLANDS
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Andaman Islands', 'Return airfare (Economy) to Port Blair', 1),
  ('Andaman Islands', '2N Port Blair — Cellular Jail Light & Sound show', 2),
  ('Andaman Islands', '2N Havelock Island — Radhanagar Beach', 3),
  ('Andaman Islands', '1N Neil Island — Natural Bridge, Laxmanpur Beach', 4),
  ('Andaman Islands', 'Snorkelling at Elephant Beach (equipment included)', 5),
  ('Andaman Islands', 'All ferry transfers', 6),
  ('Andaman Islands', 'All hotel transfers in AC vehicle', 7)
ON CONFLICT (destination, text) DO NOTHING;

-- LEH-LADAKH
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Leh-Ladakh', 'Return airfare (Economy) to Leh', 1),
  ('Leh-Ladakh', '1N Leh acclimatization', 2),
  ('Leh-Ladakh', 'Leh Palace, Shanti Stupa, Leh Market visit', 3),
  ('Leh-Ladakh', 'Pangong Tso Lake day trip', 4),
  ('Leh-Ladakh', 'Nubra Valley 2N via Khardung La Pass', 5),
  ('Leh-Ladakh', 'Camel safari at Hunder Sand Dunes', 6),
  ('Leh-Ladakh', 'All transfers in Toyota Innova / SUV', 7),
  ('Leh-Ladakh', 'Inner Line Permits included', 8)
ON CONFLICT (destination, text) DO NOTHING;

-- GOLDEN TRIANGLE
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Golden Triangle', 'Return airfare or AC train to Delhi', 1),
  ('Golden Triangle', '2N Delhi — Qutub Minar, India Gate, Red Fort, Humayun''s Tomb', 2),
  ('Golden Triangle', '1N Agra — Taj Mahal at sunrise, Agra Fort', 3),
  ('Golden Triangle', '2N Jaipur — Amber Fort, City Palace, Jantar Mantar', 4),
  ('Golden Triangle', 'Daily breakfast at hotels', 5),
  ('Golden Triangle', 'All intercity transfers in AC vehicle', 6),
  ('Golden Triangle', 'Professional English-speaking guide', 7)
ON CONFLICT (destination, text) DO NOTHING;

-- VARANASI & RISHIKESH
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Varanasi & Rishikesh', 'Return airfare to Varanasi', 1),
  ('Varanasi & Rishikesh', '2N Varanasi — Ganga Aarti (morning & evening)', 2),
  ('Varanasi & Rishikesh', 'Early morning boat ride on River Ganga at sunrise', 3),
  ('Varanasi & Rishikesh', 'Sarnath day excursion', 4),
  ('Varanasi & Rishikesh', '2N Rishikesh — Beatles Ashram, Ram Jhula & Lakshman Jhula', 5),
  ('Varanasi & Rishikesh', 'River Rafting on Ganga in Rishikesh', 6),
  ('Varanasi & Rishikesh', 'Parmarth Niketan Ganga Aarti at sunset', 7),
  ('Varanasi & Rishikesh', 'All transfers in AC vehicle', 8)
ON CONFLICT (destination, text) DO NOTHING;

-- DARJEELING & SIKKIM
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Darjeeling & Sikkim', 'Return airfare to Bagdogra + taxi transfer to Darjeeling', 1),
  ('Darjeeling & Sikkim', '2N Darjeeling — Tiger Hill sunrise, Batasia Loop, Ghoom Monastery', 2),
  ('Darjeeling & Sikkim', 'Darjeeling Himalayan Railway (Toy Train) joy ride', 3),
  ('Darjeeling & Sikkim', '3N Gangtok Sikkim — Rumtek Monastery, Tsomgo Lake', 4),
  ('Darjeeling & Sikkim', 'MG Marg evening walk & local cuisine tasting', 5),
  ('Darjeeling & Sikkim', 'All transfers in SUV', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- DUBAI
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Dubai', 'Return airfare (Economy)', 1),
  ('Dubai', 'Hotel in Dubai on twin sharing with breakfast (4-star or 5-star)', 2),
  ('Dubai', 'Desert Safari with dune bashing & BBQ dinner', 3),
  ('Dubai', 'Dubai City Tour — Burj Khalifa area, Gold & Spice Souk', 4),
  ('Dubai', 'Abu Dhabi Full Day Tour — Sheikh Zayed Grand Mosque', 5),
  ('Dubai', 'Dhow Cruise dinner on Dubai Creek', 6),
  ('Dubai', 'All transfers in AC vehicle', 7),
  ('Dubai', 'Airport meet & assist', 8)
ON CONFLICT (destination, text) DO NOTHING;

-- SINGAPORE
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Singapore', 'Return airfare (Economy)', 1),
  ('Singapore', 'Hotel on twin sharing with breakfast (4-star)', 2),
  ('Singapore', 'Universal Studios Singapore full-day (tickets included)', 3),
  ('Singapore', 'Gardens by the Bay — Flower Dome & Cloud Forest domes', 4),
  ('Singapore', 'Singapore Cable Car & Sentosa Island experience', 5),
  ('Singapore', 'Night Safari (tram ride + walking trails)', 6),
  ('Singapore', 'All airport & hotel transfers', 7)
ON CONFLICT (destination, text) DO NOTHING;

-- MALDIVES
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Maldives', 'Return airfare (Economy) to Malé', 1),
  ('Maldives', 'Speedboat or domestic flight transfer to resort island', 2),
  ('Maldives', '5N Overwater or Beach Villa with Half Board (breakfast + dinner)', 3),
  ('Maldives', 'Snorkelling equipment provided complimentary', 4),
  ('Maldives', 'Glass-bottom boat tour', 5),
  ('Maldives', 'Sunset fishing excursion', 6),
  ('Maldives', 'Dolphin watching cruise', 7),
  ('Maldives', 'Non-motorised water sports', 8)
ON CONFLICT (destination, text) DO NOTHING;

-- MAURITIUS
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Mauritius', 'Return airfare (Economy) to Mauritius', 1),
  ('Mauritius', '6N beach resort with Half Board (breakfast & dinner)', 2),
  ('Mauritius', 'Island tour — Chamarel Coloured Earth, 7 Cascade Waterfall', 3),
  ('Mauritius', 'North tour — Pamplemousses Botanical Garden', 4),
  ('Mauritius', 'Catamaran cruise to Ile aux Cerfs with BBQ lunch', 5),
  ('Mauritius', 'All airport & hotel transfers', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- SRI LANKA
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Sri Lanka', 'Return airfare (Economy) to Colombo', 1),
  ('Sri Lanka', '2N Colombo — National Museum, Gangaramaya Temple', 2),
  ('Sri Lanka', '1N Kandy — Tooth Relic Temple, Kandy Cultural Show', 3),
  ('Sri Lanka', '1N Nuwara Eliya — Tea Factory tour, Gregory Lake', 4),
  ('Sri Lanka', '2N Galle — Galle Fort, Unawatuna Beach', 5),
  ('Sri Lanka', 'Daily breakfast + 3 lunches included', 6),
  ('Sri Lanka', 'All transfers in AC vehicle', 7),
  ('Sri Lanka', 'All entry fees to cultural sites', 8)
ON CONFLICT (destination, text) DO NOTHING;

-- BALI
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Bali', 'Return airfare (Economy)', 1),
  ('Bali', 'Hotel Seminyak 3N + Ubud 3N with breakfast (4-star)', 2),
  ('Bali', 'Kecak Fire Dance & Uluwatu Temple cliff tour at sunset', 3),
  ('Bali', 'Tegallalang Rice Terrace visit with Bali Swing', 4),
  ('Bali', 'Tanah Lot temple at sunset', 5),
  ('Bali', 'Ubud Art Market, Monkey Forest & Ubud Palace', 6),
  ('Bali', 'Tirta Empul holy spring water temple visit', 7),
  ('Bali', 'All transfers in AC vehicle', 8)
ON CONFLICT (destination, text) DO NOTHING;

-- VIETNAM
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Vietnam', 'Return airfare (Economy class)', 1),
  ('Vietnam', 'Hotel accommodation with daily breakfast', 2),
  ('Vietnam', 'All airport & hotel transfers in AC vehicle', 3),
  ('Vietnam', 'Ha Long Bay 2-day cruise (meals included on cruise)', 4),
  ('Vietnam', 'Ho Chi Minh City full-day city tour', 5),
  ('Vietnam', 'Hoi An guided walking tour', 6),
  ('Vietnam', 'Hue day trip — Imperial Citadel, Royal Tombs', 7),
  ('Vietnam', 'English-speaking local guide', 8),
  ('Vietnam', 'Travel insurance', 9)
ON CONFLICT (destination, text) DO NOTHING;

-- MALAYSIA
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Malaysia', 'Return airfare (Economy) to Kuala Lumpur', 1),
  ('Malaysia', '2N Kuala Lumpur — Petronas Twin Towers, Batu Caves, Chinatown', 2),
  ('Malaysia', '1N Langkawi (domestic flight/ferry included)', 3),
  ('Malaysia', '2N Langkawi — Cable Car & Sky Bridge, Kilim Geopark mangrove tour', 4),
  ('Malaysia', 'Island Hopping — Pulau Singa Besar', 5),
  ('Malaysia', 'Daily breakfast at hotels', 6),
  ('Malaysia', 'All airport & hotel transfers', 7)
ON CONFLICT (destination, text) DO NOTHING;

-- THAILAND
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Thailand', 'Return airfare (Economy)', 1),
  ('Thailand', 'Hotel Bangkok 3N + Phuket 3N with breakfast (4-star)', 2),
  ('Thailand', 'Bangkok — Grand Palace & Wat Pho, Chatuchak Weekend Market', 3),
  ('Thailand', 'Phi Phi Islands full-day speedboat tour (lunch included)', 4),
  ('Thailand', 'Elephant Ethical Sanctuary visit', 5),
  ('Thailand', 'James Bond Island excursion', 6),
  ('Thailand', 'All airport & hotel transfers', 7)
ON CONFLICT (destination, text) DO NOTHING;

-- TURKEY
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Turkey', 'Return airfare (Economy) to Istanbul', 1),
  ('Turkey', '2N Istanbul — Hagia Sophia, Blue Mosque, Topkapi Palace, Grand Bazaar', 2),
  ('Turkey', 'Bosphorus Sunset Cruise', 3),
  ('Turkey', 'Domestic flight Istanbul → Cappadocia', 4),
  ('Turkey', '3N Cappadocia — Hot Air Balloon ride at sunrise', 5),
  ('Turkey', 'Göreme Open Air Museum, Derinkuyu Underground City', 6),
  ('Turkey', 'Daily breakfast + 3 dinners', 7)
ON CONFLICT (destination, text) DO NOTHING;

-- EUROPE - PARIS & SWITZERLAND
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Europe - Paris & Switzerland', 'Return airfare (Economy) to Paris', 1),
  ('Europe - Paris & Switzerland', '3N Paris — Eiffel Tower, Louvre Museum, Versailles day trip', 2),
  ('Europe - Paris & Switzerland', 'Paris Seine River cruise at sunset', 3),
  ('Europe - Paris & Switzerland', 'Train transfer Paris → Lucerne or Interlaken', 4),
  ('Europe - Paris & Switzerland', '2N Lucerne/Interlaken — Mt. Titlis or Jungfraujoch excursion', 5),
  ('Europe - Paris & Switzerland', '2N Zurich — Rhine Falls, departure', 6),
  ('Europe - Paris & Switzerland', 'Daily breakfast + 4 dinners', 7),
  ('Europe - Paris & Switzerland', 'All transfers in AC coach', 8)
ON CONFLICT (destination, text) DO NOTHING;

-- EUROPE - GREECE
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Europe - Greece', 'Return airfare to Athens (Economy class)', 1),
  ('Europe - Greece', '2N Athens — Acropolis & Parthenon, Acropolis Museum, Monastiraki', 2),
  ('Europe - Greece', 'Ferry transfer Athens → Santorini', 3),
  ('Europe - Greece', '3N Santorini — Oia village sunset walk, caldera volcanic hot springs cruise', 4),
  ('Europe - Greece', 'Black Sand Beach & Red Sand Beach visit', 5),
  ('Europe - Greece', 'Wine tasting at Santorini winery', 6),
  ('Europe - Greece', 'Daily breakfast + 2 romantic dinners', 7),
  ('Europe - Greece', 'All airport & port transfers', 8)
ON CONFLICT (destination, text) DO NOTHING;

-- EUROPE - ITALY
INSERT INTO destination_inclusions (destination, text, sort_order) VALUES
  ('Europe - Italy', 'Return airfare (Economy) to Rome', 1),
  ('Europe - Italy', '2N Rome — Colosseum & Roman Forum, Vatican Museums & Sistine Chapel', 2),
  ('Europe - Italy', 'High-speed train Rome → Florence', 3),
  ('Europe - Italy', '2N Florence — Uffizi Gallery, David statue, Ponte Vecchio', 4),
  ('Europe - Italy', 'Tuscany day trip — Chianti wine tasting, Siena', 5),
  ('Europe - Italy', 'High-speed train Florence → Venice', 6),
  ('Europe - Italy', '2N Venice — Grand Canal gondola ride, St. Mark''s Basilica', 7),
  ('Europe - Italy', 'Daily breakfast + 3 dinners', 8),
  ('Europe - Italy', 'All transfers in AC vehicle', 9)
ON CONFLICT (destination, text) DO NOTHING;

-- ============================================================
-- SEED: EXCLUSIONS
-- ============================================================

-- GOA
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Goa', 'Meals other than breakfast', 1),
  ('Goa', 'Water sports & adventure activities', 2),
  ('Goa', 'Personal expenses, shopping & tips', 3),
  ('Goa', 'Casino entry & drinks', 4),
  ('Goa', 'Travel insurance', 5),
  ('Goa', 'Single supplement charges', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- KERALA
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Kerala', 'Meals other than mentioned', 1),
  ('Kerala', 'Kerala Ayurvedic treatments (chargeable)', 2),
  ('Kerala', 'Entry fees to wildlife sanctuaries', 3),
  ('Kerala', 'Personal expenses & tips', 4),
  ('Kerala', 'Travel insurance', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- KASHMIR
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Kashmir', 'Gondola Phase 2 ticket (chargeable)', 1),
  ('Kashmir', 'Meals other than specified', 2),
  ('Kashmir', 'Inner Line Permit if applicable', 3),
  ('Kashmir', 'Personal expenses', 4),
  ('Kashmir', 'Pony rides & activity charges', 5),
  ('Kashmir', 'Travel insurance', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- RAJASTHAN
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Rajasthan', 'Meals other than breakfast', 1),
  ('Rajasthan', 'Monument entry fees', 2),
  ('Rajasthan', 'Personal expenses & tips', 3),
  ('Rajasthan', 'Travel insurance', 4)
ON CONFLICT (destination, text) DO NOTHING;

-- HIMACHAL PRADESH
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Himachal Pradesh', 'Rohtang Pass snow activities (chargeable)', 1),
  ('Himachal Pradesh', 'Meals other than breakfast', 2),
  ('Himachal Pradesh', 'Personal expenses & tips', 3),
  ('Himachal Pradesh', 'Monument entry fees', 4),
  ('Himachal Pradesh', 'Travel insurance', 5),
  ('Himachal Pradesh', 'Single room supplement', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- ANDAMAN ISLANDS
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Andaman Islands', 'Scuba diving, sea walking (chargeable)', 1),
  ('Andaman Islands', 'Meals other than breakfast', 2),
  ('Andaman Islands', 'Cellular Jail entry fee', 3),
  ('Andaman Islands', 'Personal expenses', 4),
  ('Andaman Islands', 'Travel insurance', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- LEH-LADAKH
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Leh-Ladakh', 'Meals (all on own — limited options at high altitude)', 1),
  ('Leh-Ladakh', 'Personal medical expenses & altitude sickness medication', 2),
  ('Leh-Ladakh', 'Oxygen cylinder (recommended)', 3),
  ('Leh-Ladakh', 'Monastery entry fees', 4),
  ('Leh-Ladakh', 'Travel insurance', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- GOLDEN TRIANGLE
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Golden Triangle', 'Meals other than breakfast', 1),
  ('Golden Triangle', 'Monument entry fees', 2),
  ('Golden Triangle', 'Elephant ride at Amber (optional)', 3),
  ('Golden Triangle', 'Shopping expenses', 4),
  ('Golden Triangle', 'Travel insurance', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- VARANASI & RISHIKESH
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Varanasi & Rishikesh', 'Meals (all on own)', 1),
  ('Varanasi & Rishikesh', 'Personal puja expenses', 2),
  ('Varanasi & Rishikesh', 'Bungee jumping, zip-lining (chargeable)', 3),
  ('Varanasi & Rishikesh', 'Travel insurance', 4),
  ('Varanasi & Rishikesh', 'Camera fees at monuments', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- DARJEELING & SIKKIM
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Darjeeling & Sikkim', 'Flights (Book separately — Bagdogra airport)', 1),
  ('Darjeeling & Sikkim', 'Meals (own account)', 2),
  ('Darjeeling & Sikkim', 'Nathula Pass visit (restricted — separate permit)', 3),
  ('Darjeeling & Sikkim', 'Personal expenses', 4),
  ('Darjeeling & Sikkim', 'Travel insurance', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- DUBAI
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Dubai', 'Dubai Tourist Visa (AED 350 approx)', 1),
  ('Dubai', 'Burj Khalifa At The Top tickets (optional)', 2),
  ('Dubai', 'Meals other than mentioned', 3),
  ('Dubai', 'Ski Dubai, IMG Worlds (optional add-ons)', 4),
  ('Dubai', 'Personal shopping expenses', 5),
  ('Dubai', 'Travel insurance', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- SINGAPORE
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Singapore', 'Singapore — no visa for Indian passport holders', 1),
  ('Singapore', 'Meals other than breakfast', 2),
  ('Singapore', 'Personal expenses & shopping', 3),
  ('Singapore', 'Adventure Cove water park (optional add-on)', 4),
  ('Singapore', 'Travel insurance', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- MALDIVES
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Maldives', 'Maldives Green Tax (USD 6/night — paid at resort)', 1),
  ('Maldives', 'Lunch on own account', 2),
  ('Maldives', 'Motorised water sports (jetski, banana boat, parasailing)', 3),
  ('Maldives', 'Scuba diving (chargeable)', 4),
  ('Maldives', 'Spa treatments', 5),
  ('Maldives', 'Travel insurance', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- MAURITIUS
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Mauritius', 'Mauritius Visa on Arrival (free for Indians)', 1),
  ('Mauritius', 'Lunch on own account', 2),
  ('Mauritius', 'Water sports (parasailing, sea bob — chargeable)', 3),
  ('Mauritius', 'Helicopter island tours', 4),
  ('Mauritius', 'Personal expenses & tips', 5),
  ('Mauritius', 'Travel insurance', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- SRI LANKA
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Sri Lanka', 'Sri Lanka e-Visa (USD 35 + processing)', 1),
  ('Sri Lanka', 'Meals other than mentioned', 2),
  ('Sri Lanka', 'Water sports at beach', 3),
  ('Sri Lanka', 'Safari at Yala (optional)', 4),
  ('Sri Lanka', 'Personal expenses', 5),
  ('Sri Lanka', 'Travel insurance', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- BALI
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Bali', 'Bali Visa on Arrival (USD 35)', 1),
  ('Bali', 'Meals other than breakfast', 2),
  ('Bali', 'Personal expenses', 3),
  ('Bali', 'Water sports — surfing, white-water rafting (chargeable)', 4),
  ('Bali', 'Travel insurance', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- VIETNAM
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Vietnam', 'Vietnam e-Visa fees (approx ₹4,000)', 1),
  ('Vietnam', 'Meals other than breakfast and cruise', 2),
  ('Vietnam', 'Personal expenses & tips', 3),
  ('Vietnam', 'Optional activities & night market shopping', 4),
  ('Vietnam', 'Single room supplement', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- MALAYSIA
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Malaysia', 'Malaysia — no visa for Indian passport holders', 1),
  ('Malaysia', 'Meals other than breakfast', 2),
  ('Malaysia', 'Petronas Tower Skybridge tickets (optional)', 3),
  ('Malaysia', 'Langkawi duty-free shopping', 4),
  ('Malaysia', 'Travel insurance', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- THAILAND
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Thailand', 'Thailand Visa on Arrival (THB 2,000)', 1),
  ('Thailand', 'Meals other than breakfast', 2),
  ('Thailand', 'Muay Thai show (optional)', 3),
  ('Thailand', 'Ladyboy Cabaret show (optional)', 4),
  ('Thailand', 'Personal expenses & shopping', 5),
  ('Thailand', 'Travel insurance', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- TURKEY
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Turkey', 'Turkey e-Visa (USD 60)', 1),
  ('Turkey', 'Meals other than mentioned', 2),
  ('Turkey', 'Istanbul hammam experience (optional)', 3),
  ('Turkey', 'Whirling Dervish show (optional)', 4),
  ('Turkey', 'Personal expenses', 5),
  ('Turkey', 'Travel insurance', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- EUROPE - PARIS & SWITZERLAND
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Europe - Paris & Switzerland', 'Schengen Visa (approx ₹8,000 + fees)', 1),
  ('Europe - Paris & Switzerland', 'Meals other than mentioned', 2),
  ('Europe - Paris & Switzerland', 'Eiffel Tower summit (optional)', 3),
  ('Europe - Paris & Switzerland', 'Personal shopping at luxury outlets', 4),
  ('Europe - Paris & Switzerland', 'Ski activities (winter only — chargeable)', 5),
  ('Europe - Paris & Switzerland', 'Travel insurance', 6)
ON CONFLICT (destination, text) DO NOTHING;

-- EUROPE - GREECE
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Europe - Greece', 'Schengen Visa (approx ₹8,000 + fees)', 1),
  ('Europe - Greece', 'Meals other than mentioned', 2),
  ('Europe - Greece', 'Helicopter tour over caldera (optional)', 3),
  ('Europe - Greece', 'Personal expenses', 4),
  ('Europe - Greece', 'Travel insurance', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- EUROPE - ITALY
INSERT INTO destination_exclusions (destination, text, sort_order) VALUES
  ('Europe - Italy', 'Schengen Visa (approx ₹8,000 + fees)', 1),
  ('Europe - Italy', 'Meals other than mentioned', 2),
  ('Europe - Italy', 'Vatican Sistine Chapel skip-the-line tickets (recommended pre-booking)', 3),
  ('Europe - Italy', 'Personal expenses & fashion shopping', 4),
  ('Europe - Italy', 'Travel insurance', 5)
ON CONFLICT (destination, text) DO NOTHING;

-- ============================================================
-- VERIFY
-- ============================================================
SELECT 'destination_inclusions' AS table_name, COUNT(*) AS total_rows FROM destination_inclusions
UNION ALL
SELECT 'destination_exclusions', COUNT(*) FROM destination_exclusions;

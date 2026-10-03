-- ============================================================
-- SAFARNAAMA CRM — MEDIA LIBRARY SEED
-- Run in: Supabase SQL Editor → New Query → Run
-- Safe to re-run (uses ON CONFLICT DO NOTHING on title+type)
-- ============================================================

-- ─── TABLE ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS media_library (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('property_photo','destination_photo','marketing_asset')),
  category      TEXT,           -- beach | mountains | temple | city | hotel_exterior | hotel_room | pool | brochure | banner | social_post | food | adventure | wildlife
  destination   TEXT,           -- matches destinations.name
  vendor_name   TEXT,           -- hotel/property name (for property_photo type)
  url           TEXT NOT NULL,
  thumbnail_url TEXT,
  description   TEXT,
  tags          TEXT[] DEFAULT '{}',
  width         INTEGER DEFAULT 800,
  height        INTEGER DEFAULT 500,
  format        TEXT DEFAULT 'jpg',
  source        TEXT DEFAULT 'pollinations',
  is_featured   BOOLEAN DEFAULT false,
  is_active     BOOLEAN DEFAULT true,
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_type_idx   ON media_library(type);
CREATE INDEX IF NOT EXISTS media_dest_idx   ON media_library(destination);
CREATE INDEX IF NOT EXISTS media_vendor_idx ON media_library(vendor_name);
CREATE INDEX IF NOT EXISTS media_cat_idx    ON media_library(category);
CREATE UNIQUE INDEX IF NOT EXISTS media_title_type_uidx ON media_library(title, type);

-- ─── DESTINATION PHOTOS ──────────────────────────────────────────────────────

INSERT INTO media_library (title, type, category, destination, url, thumbnail_url, description, tags, is_featured, sort_order) VALUES

-- GOA
('Goa Calangute Beach Golden Hour',
 'destination_photo','beach','Goa',
 'https://image.pollinations.ai/prompt/Goa%20Calangute%20beach%20golden%20hour%20sunset%20palm%20trees%20travel%20photography?width=800&height=500&seed=101&nologo=true',
 'https://image.pollinations.ai/prompt/Goa%20Calangute%20beach%20golden%20hour%20sunset%20palm%20trees%20travel%20photography?width=400&height=250&seed=101&nologo=true',
 'Calangute beach at golden hour with swaying palms and gentle waves.',
 ARRAY['goa','beach','sunset','calangute','palm'], true, 1),

('Goa Old Portuguese Quarter Fontainhas',
 'destination_photo','culture','Goa',
 'https://image.pollinations.ai/prompt/Goa%20Fontainhas%20Latin%20Quarter%20colorful%20Portuguese%20colonial%20architecture%20travel%20photography?width=800&height=500&seed=102&nologo=true',
 'https://image.pollinations.ai/prompt/Goa%20Fontainhas%20Latin%20Quarter%20colorful%20Portuguese%20colonial%20architecture%20travel%20photography?width=400&height=250&seed=102&nologo=true',
 'Vibrant Portuguese-style colonial buildings in Fontainhas, Old Goa.',
 ARRAY['goa','fontainhas','culture','heritage','architecture'], false, 2),

('Goa Dudhsagar Waterfall',
 'destination_photo','adventure','Goa',
 'https://image.pollinations.ai/prompt/Dudhsagar%20waterfall%20Goa%20lush%20green%20jungle%20waterfall%20train%20track%20India?width=800&height=500&seed=103&nologo=true',
 'https://image.pollinations.ai/prompt/Dudhsagar%20waterfall%20Goa%20lush%20green%20jungle%20waterfall%20train%20track%20India?width=400&height=250&seed=103&nologo=true',
 'Majestic Dudhsagar falls tumbling through lush Western Ghat forests.',
 ARRAY['goa','dudhsagar','waterfall','jungle','nature'], false, 3),

-- KERALA
('Kerala Alleppey Backwaters Houseboat',
 'destination_photo','backwaters','Kerala',
 'https://image.pollinations.ai/prompt/Kerala%20Alleppey%20backwaters%20houseboat%20rice%20fields%20sunset%20reflection%20travel%20photography?width=800&height=500&seed=201&nologo=true',
 'https://image.pollinations.ai/prompt/Kerala%20Alleppey%20backwaters%20houseboat%20rice%20fields%20sunset%20reflection%20travel%20photography?width=400&height=250&seed=201&nologo=true',
 'Traditional kettuvallam houseboat gliding through Kerala backwater canals at dusk.',
 ARRAY['kerala','alleppey','backwaters','houseboat','sunset'], true, 1),

('Kerala Munnar Tea Gardens',
 'destination_photo','nature','Kerala',
 'https://image.pollinations.ai/prompt/Munnar%20Kerala%20tea%20plantation%20rolling%20hills%20green%20misty%20landscape%20India%20photography?width=800&height=500&seed=202&nologo=true',
 'https://image.pollinations.ai/prompt/Munnar%20Kerala%20tea%20plantation%20rolling%20hills%20green%20misty%20landscape%20India%20photography?width=400&height=250&seed=202&nologo=true',
 'Endless emerald tea gardens rolling across Munnar''s misty highland ridges.',
 ARRAY['kerala','munnar','tea','nature','hills'], false, 2),

('Kerala Kathakali Performance',
 'destination_photo','culture','Kerala',
 'https://image.pollinations.ai/prompt/Kerala%20Kathakali%20classical%20dance%20elaborate%20costume%20makeup%20performer%20cultural%20photography?width=800&height=500&seed=203&nologo=true',
 'https://image.pollinations.ai/prompt/Kerala%20Kathakali%20classical%20dance%20elaborate%20costume%20makeup%20performer%20cultural%20photography?width=400&height=250&seed=203&nologo=true',
 'Kathakali dancer in vivid costume performing a classical Kerala art form.',
 ARRAY['kerala','kathakali','culture','dance','art'], false, 3),

-- KASHMIR
('Kashmir Dal Lake Shikara Reflection',
 'destination_photo','lake','Kashmir',
 'https://image.pollinations.ai/prompt/Kashmir%20Dal%20Lake%20shikara%20boat%20Himalaya%20mountains%20reflection%20sunrise%20India%20photography?width=800&height=500&seed=301&nologo=true',
 'https://image.pollinations.ai/prompt/Kashmir%20Dal%20Lake%20shikara%20boat%20Himalaya%20mountains%20reflection%20sunrise%20India%20photography?width=400&height=250&seed=301&nologo=true',
 'Colourful shikaras gliding across mirror-still Dal Lake against Himalayan backdrops.',
 ARRAY['kashmir','dal lake','shikara','himalayas','reflection'], true, 1),

('Kashmir Pahalgam Pine Valley',
 'destination_photo','mountains','Kashmir',
 'https://image.pollinations.ai/prompt/Pahalgam%20Kashmir%20pine%20forest%20valley%20snow%20mountains%20river%20landscape%20photography?width=800&height=500&seed=302&nologo=true',
 'https://image.pollinations.ai/prompt/Pahalgam%20Kashmir%20pine%20forest%20valley%20snow%20mountains%20river%20photography?width=400&height=250&seed=302&nologo=true',
 'Lidder River winding through Pahalgam''s aromatic pine forests with snow peaks beyond.',
 ARRAY['kashmir','pahalgam','mountains','pine','snow'], false, 2),

('Kashmir Tulip Garden Srinagar',
 'destination_photo','nature','Kashmir',
 'https://image.pollinations.ai/prompt/Srinagar%20tulip%20garden%20Kashmir%20colorful%20tulips%20bloom%20Dal%20Lake%20spring%20photography?width=800&height=500&seed=303&nologo=true',
 'https://image.pollinations.ai/prompt/Srinagar%20tulip%20garden%20Kashmir%20colorful%20tulips%20bloom%20Dal%20Lake%20spring%20photography?width=400&height=250&seed=303&nologo=true',
 'Asia''s largest tulip garden ablaze with colour in spring, Srinagar.',
 ARRAY['kashmir','tulip','spring','srinagar','flowers'], false, 3),

-- RAJASTHAN
('Rajasthan Jaisalmer Golden Fort Desert',
 'destination_photo','heritage','Rajasthan',
 'https://image.pollinations.ai/prompt/Jaisalmer%20golden%20fort%20Rajasthan%20desert%20sunset%20camel%20Thar%20India%20photography?width=800&height=500&seed=401&nologo=true',
 'https://image.pollinations.ai/prompt/Jaisalmer%20golden%20fort%20Rajasthan%20desert%20sunset%20camel%20Thar%20India%20photography?width=400&height=250&seed=401&nologo=true',
 'Golden Jaisalmer Fort glowing at dusk, rising dramatically from Thar Desert sands.',
 ARRAY['rajasthan','jaisalmer','fort','desert','heritage'], true, 1),

('Rajasthan Udaipur City Palace Lake',
 'destination_photo','city','Rajasthan',
 'https://image.pollinations.ai/prompt/Udaipur%20City%20Palace%20Lake%20Pichola%20Rajasthan%20India%20royal%20palace%20reflection%20travel%20photography?width=800&height=500&seed=402&nologo=true',
 'https://image.pollinations.ai/prompt/Udaipur%20City%20Palace%20Lake%20Pichola%20Rajasthan%20India%20royal%20palace%20reflection%20travel%20photography?width=400&height=250&seed=402&nologo=true',
 'Majestic City Palace reflected in Lake Pichola — the City of Lakes at its finest.',
 ARRAY['rajasthan','udaipur','palace','lake','royal'], false, 2),

('Rajasthan Camel Safari Thar Desert',
 'destination_photo','adventure','Rajasthan',
 'https://image.pollinations.ai/prompt/Thar%20Desert%20camel%20safari%20Rajasthan%20sand%20dunes%20sunset%20silhouette%20India%20photography?width=800&height=500&seed=403&nologo=true',
 'https://image.pollinations.ai/prompt/Thar%20Desert%20camel%20safari%20Rajasthan%20sand%20dunes%20sunset%20silhouette%20India%20photography?width=400&height=250&seed=403&nologo=true',
 'Camel caravan silhouetted against burning orange dunes at sunset, Thar Desert.',
 ARRAY['rajasthan','desert','camel','safari','adventure'], false, 3),

-- BALI
('Bali Tegalalang Rice Terrace',
 'destination_photo','nature','Bali',
 'https://image.pollinations.ai/prompt/Bali%20Tegalalang%20rice%20terraces%20palm%20trees%20green%20lush%20morning%20light%20travel%20photography?width=800&height=500&seed=601&nologo=true',
 'https://image.pollinations.ai/prompt/Bali%20Tegalalang%20rice%20terraces%20palm%20trees%20green%20lush%20morning%20light%20travel%20photography?width=400&height=250&seed=601&nologo=true',
 'Iconic stepped rice terraces of Tegalalang catching soft morning light in Ubud.',
 ARRAY['bali','rice terraces','ubud','nature','green'], true, 1),

('Bali Tanah Lot Sea Temple',
 'destination_photo','temple','Bali',
 'https://image.pollinations.ai/prompt/Bali%20Tanah%20Lot%20temple%20ocean%20sunset%20dramatic%20sky%20Indonesia%20travel%20photography?width=800&height=500&seed=602&nologo=true',
 'https://image.pollinations.ai/prompt/Bali%20Tanah%20Lot%20temple%20ocean%20sunset%20dramatic%20sky%20Indonesia%20travel%20photography?width=400&height=250&seed=602&nologo=true',
 'Ancient Tanah Lot temple perched on a sea stack, waves crashing below at sunset.',
 ARRAY['bali','tanah lot','temple','sunset','ocean'], false, 2),

('Bali Seminyak Beach Sunset',
 'destination_photo','beach','Bali',
 'https://image.pollinations.ai/prompt/Bali%20Seminyak%20beach%20sunset%20surfing%20dramatic%20sky%20ocean%20waves%20Indonesia%20photography?width=800&height=500&seed=603&nologo=true',
 'https://image.pollinations.ai/prompt/Bali%20Seminyak%20beach%20sunset%20surfing%20dramatic%20sky%20ocean%20waves%20Indonesia%20photography?width=400&height=250&seed=603&nologo=true',
 'Surfers catching the last waves on Seminyak Beach as the sky turns crimson.',
 ARRAY['bali','seminyak','beach','surf','sunset'], false, 3),

-- MALDIVES
('Maldives Overwater Villa Sunrise',
 'destination_photo','beach','Maldives',
 'https://image.pollinations.ai/prompt/Maldives%20overwater%20villa%20bungalow%20turquoise%20ocean%20sunrise%20luxury%20travel%20photography?width=800&height=500&seed=701&nologo=true',
 'https://image.pollinations.ai/prompt/Maldives%20overwater%20villa%20bungalow%20turquoise%20ocean%20sunrise%20luxury%20travel%20photography?width=400&height=250&seed=701&nologo=true',
 'Private overwater villa with glass floor above crystal-clear Maldivian lagoon.',
 ARRAY['maldives','overwater','villa','luxury','turquoise'], true, 1),

('Maldives Snorkelling Coral Reef',
 'destination_photo','adventure','Maldives',
 'https://image.pollinations.ai/prompt/Maldives%20snorkelling%20coral%20reef%20fish%20underwater%20photography%20tropical%20ocean?width=800&height=500&seed=702&nologo=true',
 'https://image.pollinations.ai/prompt/Maldives%20snorkelling%20coral%20reef%20fish%20underwater%20photography%20tropical%20ocean?width=400&height=250&seed=702&nologo=true',
 'Vibrant coral gardens teeming with tropical fish in shallow Maldivian waters.',
 ARRAY['maldives','snorkelling','reef','underwater','marine'], false, 2),

('Maldives Beach Bar Sunset',
 'destination_photo','beach','Maldives',
 'https://image.pollinations.ai/prompt/Maldives%20sandbar%20beach%20bar%20champagne%20sunset%20luxury%20infinity%20ocean%20photography?width=800&height=500&seed=703&nologo=true',
 'https://image.pollinations.ai/prompt/Maldives%20sandbar%20beach%20bar%20champagne%20sunset%20luxury%20infinity%20ocean%20photography?width=400&height=250&seed=703&nologo=true',
 'Secluded sandbar dining setup with candles as the sun melts into the Indian Ocean.',
 ARRAY['maldives','beach','romance','sunset','luxury'], false, 3),

-- DUBAI
('Dubai Burj Khalifa Night Skyline',
 'destination_photo','city','Dubai',
 'https://image.pollinations.ai/prompt/Dubai%20Burj%20Khalifa%20night%20skyline%20lights%20fountain%20show%20UAE%20travel%20photography?width=800&height=500&seed=801&nologo=true',
 'https://image.pollinations.ai/prompt/Dubai%20Burj%20Khalifa%20night%20skyline%20lights%20fountain%20show%20UAE%20travel%20photography?width=400&height=250&seed=801&nologo=true',
 'Dubai skyline blazing at night with the world-famous Burj Khalifa fountain show.',
 ARRAY['dubai','burj khalifa','skyline','night','fountain'], true, 1),

('Dubai Desert Safari Dune Bashing',
 'destination_photo','adventure','Dubai',
 'https://image.pollinations.ai/prompt/Dubai%20desert%20safari%20dune%20bashing%20SUV%20Arabian%20desert%20sunset%20UAE%20photography?width=800&height=500&seed=802&nologo=true',
 'https://image.pollinations.ai/prompt/Dubai%20desert%20safari%20dune%20bashing%20SUV%20Arabian%20desert%20sunset%20UAE%20photography?width=400&height=250&seed=802&nologo=true',
 'Thrilling 4x4 dune bashing across the Arabian desert at dusk, Dubai.',
 ARRAY['dubai','desert','safari','adventure','4x4'], false, 2),

('Dubai Gold Souk Old Town',
 'destination_photo','culture','Dubai',
 'https://image.pollinations.ai/prompt/Dubai%20Gold%20Souk%20market%20traditional%20architecture%20spice%20old%20town%20Deira%20UAE%20photography?width=800&height=500&seed=803&nologo=true',
 'https://image.pollinations.ai/prompt/Dubai%20Gold%20Souk%20market%20traditional%20architecture%20spice%20old%20town%20Deira%20UAE%20photography?width=400&height=250&seed=803&nologo=true',
 'Glittering jewelry displays in the historic Gold Souk of Deira, Old Dubai.',
 ARRAY['dubai','gold souk','market','culture','heritage'], false, 3),

-- SINGAPORE
('Singapore Gardens by the Bay Night',
 'destination_photo','city','Singapore',
 'https://image.pollinations.ai/prompt/Singapore%20Gardens%20by%20the%20Bay%20Supertrees%20night%20lights%20futuristic%20travel%20photography?width=800&height=500&seed=901&nologo=true',
 'https://image.pollinations.ai/prompt/Singapore%20Gardens%20by%20the%20Bay%20Supertrees%20night%20lights%20futuristic%20travel%20photography?width=400&height=250&seed=901&nologo=true',
 'Supertrees illuminated in the nightly light show at Gardens by the Bay.',
 ARRAY['singapore','gardens by the bay','supertrees','night','futuristic'], true, 1),

('Singapore Marina Bay Sands Skyline',
 'destination_photo','city','Singapore',
 'https://image.pollinations.ai/prompt/Singapore%20Marina%20Bay%20Sands%20skyline%20reflection%20city%20lights%20travel%20photography?width=800&height=500&seed=902&nologo=true',
 'https://image.pollinations.ai/prompt/Singapore%20Marina%20Bay%20Sands%20skyline%20reflection%20city%20lights%20travel%20photography?width=400&height=250&seed=902&nologo=true',
 'Singapore''s iconic MBS hotel reflecting in Marina Bay''s shimmering waters.',
 ARRAY['singapore','marina bay sands','skyline','city','reflection'], false, 2),

('Singapore Chinatown Heritage Streets',
 'destination_photo','culture','Singapore',
 'https://image.pollinations.ai/prompt/Singapore%20Chinatown%20colorful%20shophouses%20lanterns%20street%20culture%20travel%20photography?width=800&height=500&seed=903&nologo=true',
 'https://image.pollinations.ai/prompt/Singapore%20Chinatown%20colorful%20shophouses%20lanterns%20street%20culture%20travel%20photography?width=400&height=250&seed=903&nologo=true',
 'Red lanterns strung between colourful shophouses in Singapore''s vibrant Chinatown.',
 ARRAY['singapore','chinatown','culture','lanterns','heritage'], false, 3),

-- THAILAND
('Thailand Phi Phi Island Aerial',
 'destination_photo','beach','Thailand',
 'https://image.pollinations.ai/prompt/Thailand%20Phi%20Phi%20island%20aerial%20drone%20turquoise%20water%20limestone%20cliffs%20travel%20photography?width=800&height=500&seed=1001&nologo=true',
 'https://image.pollinations.ai/prompt/Thailand%20Phi%20Phi%20island%20aerial%20drone%20turquoise%20water%20limestone%20cliffs%20travel%20photography?width=400&height=250&seed=1001&nologo=true',
 'Drone view of Phi Phi Islands with emerald waters and dramatic limestone karsts.',
 ARRAY['thailand','phi phi','beach','aerial','island'], true, 1),

('Thailand Bangkok Grand Palace',
 'destination_photo','temple','Thailand',
 'https://image.pollinations.ai/prompt/Bangkok%20Grand%20Palace%20Wat%20Phra%20Kaew%20temple%20golden%20spires%20Thailand%20photography?width=800&height=500&seed=1002&nologo=true',
 'https://image.pollinations.ai/prompt/Bangkok%20Grand%20Palace%20Wat%20Phra%20Kaew%20temple%20golden%20spires%20Thailand%20photography?width=400&height=250&seed=1002&nologo=true',
 'Grand Palace''s golden spires and intricate mosaics dazzling in the Bangkok sun.',
 ARRAY['thailand','bangkok','grand palace','temple','heritage'], false, 2),

('Thailand Floating Markets',
 'destination_photo','culture','Thailand',
 'https://image.pollinations.ai/prompt/Thailand%20Damnoen%20Saduak%20floating%20market%20colorful%20boats%20vendors%20food%20photography?width=800&height=500&seed=1003&nologo=true',
 'https://image.pollinations.ai/prompt/Thailand%20Damnoen%20Saduak%20floating%20market%20colorful%20boats%20vendors%20food%20photography?width=400&height=250&seed=1003&nologo=true',
 'Vibrant floating market with vendors selling tropical fruits from wooden boats.',
 ARRAY['thailand','floating market','culture','food','boats'], false, 3),

-- EUROPE - PARIS & SWITZERLAND
('Paris Eiffel Tower River Seine',
 'destination_photo','landmark','Europe - Paris & Switzerland',
 'https://image.pollinations.ai/prompt/Paris%20Eiffel%20Tower%20River%20Seine%20sunset%20golden%20hour%20France%20travel%20photography?width=800&height=500&seed=1101&nologo=true',
 'https://image.pollinations.ai/prompt/Paris%20Eiffel%20Tower%20River%20Seine%20sunset%20golden%20hour%20France%20travel%20photography?width=400&height=250&seed=1101&nologo=true',
 'Eiffel Tower glowing gold at sunset reflected in the Seine River, Paris.',
 ARRAY['paris','eiffel tower','seine','sunset','france'], true, 1),

('Swiss Alps Interlaken Jungfrau',
 'destination_photo','mountains','Europe - Paris & Switzerland',
 'https://image.pollinations.ai/prompt/Switzerland%20Jungfrau%20Swiss%20Alps%20Interlaken%20snow%20mountains%20green%20valley%20travel%20photography?width=800&height=500&seed=1102&nologo=true',
 'https://image.pollinations.ai/prompt/Switzerland%20Jungfrau%20Swiss%20Alps%20Interlaken%20snow%20mountains%20green%20valley%20travel%20photography?width=400&height=250&seed=1102&nologo=true',
 'Jungfrau peak towering over emerald Swiss valleys, Interlaken in the foreground.',
 ARRAY['switzerland','jungfrau','alps','mountains','interlaken'], false, 2),

-- EUROPE - ITALY
('Rome Colosseum Historic',
 'destination_photo','landmark','Europe - Italy',
 'https://image.pollinations.ai/prompt/Rome%20Colosseum%20ancient%20historic%20blue%20sky%20Italy%20travel%20photography?width=800&height=500&seed=1201&nologo=true',
 'https://image.pollinations.ai/prompt/Rome%20Colosseum%20ancient%20historic%20blue%20sky%20Italy%20travel%20photography?width=400&height=250&seed=1201&nologo=true',
 'The ancient Roman Colosseum standing proud under a deep blue Italian sky.',
 ARRAY['italy','rome','colosseum','ancient','heritage'], true, 1),

('Venice Grand Canal Gondolas',
 'destination_photo','city','Europe - Italy',
 'https://image.pollinations.ai/prompt/Venice%20Grand%20Canal%20gondolas%20sunrise%20colorful%20buildings%20Italy%20travel%20photography?width=800&height=500&seed=1202&nologo=true',
 'https://image.pollinations.ai/prompt/Venice%20Grand%20Canal%20gondolas%20sunrise%20colorful%20buildings%20Italy%20travel%20photography?width=400&height=250&seed=1202&nologo=true',
 'Gondolas resting on the Grand Canal as pastel buildings glow in Venice sunrise.',
 ARRAY['italy','venice','gondola','canal','sunrise'], false, 2),

-- EUROPE - GREECE
('Santorini Blue Domes Oia Sunset',
 'destination_photo','city','Europe - Greece',
 'https://image.pollinations.ai/prompt/Santorini%20blue%20dome%20church%20Oia%20sunset%20Greece%20Mediterranean%20travel%20photography?width=800&height=500&seed=1301&nologo=true',
 'https://image.pollinations.ai/prompt/Santorini%20blue%20dome%20church%20Oia%20sunset%20Greece%20Mediterranean%20travel%20photography?width=400&height=250&seed=1301&nologo=true',
 'Iconic blue-domed church of Oia silhouetted against Santorini''s legendary sunset.',
 ARRAY['greece','santorini','oia','blue dome','sunset'], true, 1),

-- LEH-LADAKH
('Ladakh Pangong Lake Blue Waters',
 'destination_photo','mountains','Leh-Ladakh',
 'https://image.pollinations.ai/prompt/Ladakh%20Pangong%20Lake%20blue%20water%20snow%20mountains%20Tibet%20India%20travel%20photography?width=800&height=500&seed=1401&nologo=true',
 'https://image.pollinations.ai/prompt/Ladakh%20Pangong%20Lake%20blue%20water%20snow%20mountains%20Tibet%20India%20travel%20photography?width=400&height=250&seed=1401&nologo=true',
 'Pangong Lake''s surreal blue waters stretching to the Tibetan border, Ladakh.',
 ARRAY['ladakh','pangong','lake','mountains','himalaya'], true, 1),

('Ladakh Thiksey Monastery Sunrise',
 'destination_photo','temple','Leh-Ladakh',
 'https://image.pollinations.ai/prompt/Ladakh%20Thiksey%20monastery%20sunrise%20mountains%20Buddhist%20Himalayas%20India%20photography?width=800&height=500&seed=1402&nologo=true',
 'https://image.pollinations.ai/prompt/Ladakh%20Thiksey%20monastery%20sunrise%20mountains%20Buddhist%20Himalayas%20India%20photography?width=400&height=250&seed=1402&nologo=true',
 'Thiksey Monastery perched on a hillside as dawn breaks over snow-capped peaks.',
 ARRAY['ladakh','thiksey','monastery','sunrise','buddhist'], false, 2),

-- ANDAMAN ISLANDS
('Andaman Radhanagar Beach Turquoise',
 'destination_photo','beach','Andaman Islands',
 'https://image.pollinations.ai/prompt/Andaman%20Radhanagar%20beach%20Havelock%20turquoise%20sea%20white%20sand%20tropical%20India%20photography?width=800&height=500&seed=1501&nologo=true',
 'https://image.pollinations.ai/prompt/Andaman%20Radhanagar%20beach%20Havelock%20turquoise%20sea%20white%20sand%20tropical%20India%20photography?width=400&height=250&seed=1501&nologo=true',
 'Asia''s finest beach — Radhanagar on Havelock Island with pristine turquoise water.',
 ARRAY['andaman','radhanagar','beach','turquoise','havelock'], true, 1),

-- VIETNAM
('Vietnam Ha Long Bay Karst Limestone',
 'destination_photo','nature','Vietnam',
 'https://image.pollinations.ai/prompt/Vietnam%20Ha%20Long%20Bay%20limestone%20karst%20islands%20boat%20misty%20morning%20travel%20photography?width=800&height=500&seed=1601&nologo=true',
 'https://image.pollinations.ai/prompt/Vietnam%20Ha%20Long%20Bay%20limestone%20karst%20islands%20boat%20misty%20morning%20travel%20photography?width=400&height=250&seed=1601&nologo=true',
 'Thousands of limestone karst islands rising from Ha Long Bay''s jade-green waters.',
 ARRAY['vietnam','ha long bay','karst','limestone','boat'], true, 1),

('Vietnam Hoi An Ancient Town Lanterns',
 'destination_photo','culture','Vietnam',
 'https://image.pollinations.ai/prompt/Vietnam%20Hoi%20An%20ancient%20town%20colorful%20lanterns%20night%20river%20reflection%20photography?width=800&height=500&seed=1602&nologo=true',
 'https://image.pollinations.ai/prompt/Vietnam%20Hoi%20An%20ancient%20town%20colorful%20lanterns%20night%20river%20reflection%20photography?width=400&height=250&seed=1602&nologo=true',
 'Hoi An Ancient Town glowing with hundreds of silk lanterns reflected in the river.',
 ARRAY['vietnam','hoi an','lanterns','night','culture'], false, 2),

-- MAURITIUS
('Mauritius Flic-en-Flac Lagoon Snorkelling',
 'destination_photo','beach','Mauritius',
 'https://image.pollinations.ai/prompt/Mauritius%20Flic%20en%20Flac%20beach%20turquoise%20lagoon%20palm%20trees%20Indian%20Ocean%20photography?width=800&height=500&seed=1701&nologo=true',
 'https://image.pollinations.ai/prompt/Mauritius%20Flic%20en%20Flac%20beach%20turquoise%20lagoon%20palm%20trees%20Indian%20Ocean%20photography?width=400&height=250&seed=1701&nologo=true',
 'Crystal-clear lagoon at Flic-en-Flac framed by swaying palm trees, Mauritius.',
 ARRAY['mauritius','beach','lagoon','palm','island'], true, 1),

-- TURKEY
('Turkey Cappadocia Hot Air Balloons',
 'destination_photo','adventure','Turkey',
 'https://image.pollinations.ai/prompt/Cappadocia%20Turkey%20hot%20air%20balloons%20sunrise%20fairy%20chimneys%20landscape%20photography?width=800&height=500&seed=1801&nologo=true',
 'https://image.pollinations.ai/prompt/Cappadocia%20Turkey%20hot%20air%20balloons%20sunrise%20fairy%20chimneys%20landscape%20photography?width=400&height=250&seed=1801&nologo=true',
 'Hundreds of hot air balloons drifting over Cappadocia''s fairy chimneys at sunrise.',
 ARRAY['turkey','cappadocia','balloon','sunrise','adventure'], true, 1),

-- SRI LANKA
('Sri Lanka Sigiriya Lion Rock Sunrise',
 'destination_photo','heritage','Sri Lanka',
 'https://image.pollinations.ai/prompt/Sri%20Lanka%20Sigiriya%20Lion%20Rock%20ancient%20fortress%20sunrise%20lush%20jungle%20photography?width=800&height=500&seed=1901&nologo=true',
 'https://image.pollinations.ai/prompt/Sri%20Lanka%20Sigiriya%20Lion%20Rock%20ancient%20fortress%20sunrise%20lush%20jungle%20photography?width=400&height=250&seed=1901&nologo=true',
 'Ancient Sigiriya Rock Fortress towering above emerald jungle at sunrise, Sri Lanka.',
 ARRAY['sri lanka','sigiriya','heritage','sunrise','jungle'], true, 1),

-- MALAYSIA
('Malaysia Kuala Lumpur Petronas Twin Towers',
 'destination_photo','city','Malaysia',
 'https://image.pollinations.ai/prompt/Kuala%20Lumpur%20Petronas%20Twin%20Towers%20night%20skyline%20Malaysia%20travel%20photography?width=800&height=500&seed=2001&nologo=true',
 'https://image.pollinations.ai/prompt/Kuala%20Lumpur%20Petronas%20Twin%20Towers%20night%20skyline%20Malaysia%20travel%20photography?width=400&height=250&seed=2001&nologo=true',
 'Petronas Twin Towers illuminated against Kuala Lumpur''s glittering night skyline.',
 ARRAY['malaysia','kuala lumpur','petronas','skyline','night'], true, 1),

-- GOLDEN TRIANGLE
('Golden Triangle Taj Mahal Sunrise Agra',
 'destination_photo','landmark','Golden Triangle',
 'https://image.pollinations.ai/prompt/Taj%20Mahal%20Agra%20India%20sunrise%20reflection%20pond%20marble%20golden%20hour%20photography?width=800&height=500&seed=2101&nologo=true',
 'https://image.pollinations.ai/prompt/Taj%20Mahal%20Agra%20India%20sunrise%20reflection%20pond%20marble%20golden%20hour%20photography?width=400&height=250&seed=2101&nologo=true',
 'The Taj Mahal bathed in soft golden light, perfectly mirrored in the reflecting pool.',
 ARRAY['golden triangle','taj mahal','agra','sunrise','heritage'], true, 1),

-- HIMACHAL PRADESH
('Himachal Pradesh Spiti Valley Moonscape',
 'destination_photo','mountains','Himachal Pradesh',
 'https://image.pollinations.ai/prompt/Spiti%20Valley%20Himachal%20Pradesh%20moonscape%20high%20altitude%20mountains%20India%20photography?width=800&height=500&seed=2201&nologo=true',
 'https://image.pollinations.ai/prompt/Spiti%20Valley%20Himachal%20Pradesh%20moonscape%20high%20altitude%20mountains%20India%20photography?width=400&height=250&seed=2201&nologo=true',
 'Otherworldly barren landscape of the Spiti Valley at 12,500 ft, Himachal Pradesh.',
 ARRAY['himachal pradesh','spiti','mountains','high altitude','adventure'], true, 1),

-- VARANASI
('Varanasi Ganga Aarti Ceremony Night',
 'destination_photo','culture','Varanasi & Rishikesh',
 'https://image.pollinations.ai/prompt/Varanasi%20Ganga%20Aarti%20ceremony%20night%20flames%20priests%20Ghats%20India%20photography?width=800&height=500&seed=2301&nologo=true',
 'https://image.pollinations.ai/prompt/Varanasi%20Ganga%20Aarti%20ceremony%20night%20flames%20priests%20Ghats%20India%20photography?width=400&height=250&seed=2301&nologo=true',
 'Priests swinging flaming diyas in the mesmerising Ganga Aarti ceremony, Varanasi.',
 ARRAY['varanasi','ganga aarti','culture','spiritual','ghats'], true, 1),

-- DARJEELING
('Darjeeling Toy Train Tea Garden',
 'destination_photo','nature','Darjeeling & Sikkim',
 'https://image.pollinations.ai/prompt/Darjeeling%20toy%20train%20tea%20garden%20Himalaya%20mountains%20misty%20India%20photography?width=800&height=500&seed=2401&nologo=true',
 'https://image.pollinations.ai/prompt/Darjeeling%20toy%20train%20tea%20garden%20Himalaya%20mountains%20misty%20India%20photography?width=400&height=250&seed=2401&nologo=true',
 'The iconic toy train winding through mist-draped tea gardens with Kangchenjunga beyond.',
 ARRAY['darjeeling','toy train','tea garden','himalaya','misty'], true, 1)

ON CONFLICT (title, type) DO NOTHING;

-- ─── PROPERTY / HOTEL PHOTOS ─────────────────────────────────────────────────

INSERT INTO media_library (title, type, category, destination, vendor_name, url, thumbnail_url, description, tags, is_featured, sort_order) VALUES

-- BALI HOTELS
('Komaneka at Bisma Ubud Infinity Pool',
 'property_photo','pool','Bali','Komaneka at Bisma',
 'https://image.pollinations.ai/prompt/Bali%20luxury%20resort%20Ubud%20jungle%20infinity%20pool%20rice%20field%20view%20pool%20villa%20photography?width=800&height=500&seed=5001&nologo=true',
 'https://image.pollinations.ai/prompt/Bali%20luxury%20resort%20Ubud%20jungle%20infinity%20pool%20rice%20field%20view%20pool%20villa%20photography?width=400&height=250&seed=5001&nologo=true',
 'Infinity pool at Komaneka at Bisma overlooking Ubud''s jungle canopy.',
 ARRAY['bali','ubud','pool','infinity','jungle','luxury'], true, 1),

('Komaneka at Bisma Jungle Villa Interior',
 'property_photo','hotel_room','Bali','Komaneka at Bisma',
 'https://image.pollinations.ai/prompt/Bali%20luxury%20villa%20interior%20wood%20tropical%20bedroom%20private%20balcony%20jungle%20view%20photography?width=800&height=500&seed=5002&nologo=true',
 'https://image.pollinations.ai/prompt/Bali%20luxury%20villa%20interior%20wood%20tropical%20bedroom%20private%20balcony%20jungle%20view%20photography?width=400&height=250&seed=5002&nologo=true',
 'Open-plan jungle villa with private plunge pool and rice terrace vistas.',
 ARRAY['bali','villa','interior','bedroom','luxury'], false, 2),

('The Layar Seminyak Private Villas Exterior',
 'property_photo','hotel_exterior','Bali','The Layar Seminyak',
 'https://image.pollinations.ai/prompt/Bali%20Seminyak%20luxury%20villa%20exterior%20private%20pool%20tropical%20garden%20sunset%20photography?width=800&height=500&seed=5003&nologo=true',
 'https://image.pollinations.ai/prompt/Bali%20Seminyak%20luxury%20villa%20exterior%20private%20pool%20tropical%20garden%20sunset%20photography?width=400&height=250&seed=5003&nologo=true',
 'Private villa exterior with lush tropical garden and personal pool, Seminyak.',
 ARRAY['bali','seminyak','villa','pool','tropical'], true, 3),

-- MALDIVES HOTELS
('Soneva Jani Overwater Villa Deck',
 'property_photo','hotel_exterior','Maldives','Soneva Jani',
 'https://image.pollinations.ai/prompt/Maldives%20Soneva%20Jani%20overwater%20villa%20deck%20slide%20lagoon%20tropical%20luxury%20resort%20photography?width=800&height=500&seed=5101&nologo=true',
 'https://image.pollinations.ai/prompt/Maldives%20Soneva%20Jani%20overwater%20villa%20deck%20slide%20lagoon%20tropical%20luxury%20resort%20photography?width=400&height=250&seed=5101&nologo=true',
 'Overwater villa with private water slide into the crystal Maldivian lagoon.',
 ARRAY['maldives','soneva jani','overwater','villa','lagoon'], true, 1),

('Gili Lankanfushi Open-Air Bedroom',
 'property_photo','hotel_room','Maldives','Gili Lankanfushi',
 'https://image.pollinations.ai/prompt/Maldives%20open%20air%20overwater%20bedroom%20ocean%20view%20luxury%20resort%20sunrise%20photography?width=800&height=500&seed=5102&nologo=true',
 'https://image.pollinations.ai/prompt/Maldives%20open%20air%20overwater%20bedroom%20ocean%20view%20luxury%20resort%20sunrise%20photography?width=400&height=250&seed=5102&nologo=true',
 'Open-air bedroom with ocean views in every direction, Gili Lankanfushi, Maldives.',
 ARRAY['maldives','gili lankanfushi','bedroom','ocean view','luxury'], false, 2),

-- DUBAI HOTELS
('Burj Al Arab Exterior Iconic',
 'property_photo','hotel_exterior','Dubai','Burj Al Arab',
 'https://image.pollinations.ai/prompt/Burj%20Al%20Arab%20hotel%20exterior%20Dubai%20luxury%20iconic%20architecture%20sea%20photography?width=800&height=500&seed=5201&nologo=true',
 'https://image.pollinations.ai/prompt/Burj%20Al%20Arab%20hotel%20exterior%20Dubai%20luxury%20iconic%20architecture%20sea%20photography?width=400&height=250&seed=5201&nologo=true',
 'The sail-shaped Burj Al Arab, world''s most iconic luxury hotel, rising from the sea.',
 ARRAY['dubai','burj al arab','luxury','architecture','iconic'], true, 1),

('Atlantis The Palm Private Beach',
 'property_photo','beach','Dubai','Atlantis The Palm',
 'https://image.pollinations.ai/prompt/Atlantis%20Palm%20Dubai%20private%20beach%20resort%20pool%20luxury%20Aquaventure%20photography?width=800&height=500&seed=5202&nologo=true',
 'https://image.pollinations.ai/prompt/Atlantis%20Palm%20Dubai%20private%20beach%20resort%20pool%20luxury%20Aquaventure%20photography?width=400&height=250&seed=5202&nologo=true',
 'Atlantis The Palm''s expansive private beach and Aquaventure waterpark on Palm Jumeirah.',
 ARRAY['dubai','atlantis','palm','beach','pool'], false, 2),

-- GOA HOTELS
('Taj Holiday Village Goa Beachside Cottage',
 'property_photo','hotel_exterior','Goa','Taj Holiday Village',
 'https://image.pollinations.ai/prompt/Goa%20luxury%20beachside%20resort%20cottage%20tropical%20garden%20pool%20sunset%20photography?width=800&height=500&seed=5301&nologo=true',
 'https://image.pollinations.ai/prompt/Goa%20luxury%20beachside%20resort%20cottage%20tropical%20garden%20pool%20sunset%20photography?width=400&height=250&seed=5301&nologo=true',
 'Portuguese-inspired beachside cottages with tropical gardens, Taj Holiday Village Goa.',
 ARRAY['goa','taj','cottage','beach','tropical'], true, 1),

('W Goa Beach Bar Sundowner',
 'property_photo','dining','Goa','W Goa',
 'https://image.pollinations.ai/prompt/Goa%20beach%20bar%20sunset%20cocktails%20W%20hotel%20luxury%20ocean%20view%20nightlife%20photography?width=800&height=500&seed=5302&nologo=true',
 'https://image.pollinations.ai/prompt/Goa%20beach%20bar%20sunset%20cocktails%20W%20hotel%20luxury%20ocean%20view%20nightlife%20photography?width=400&height=250&seed=5302&nologo=true',
 'Stylish beachfront bar at W Goa with crafted cocktails and ocean sunset views.',
 ARRAY['goa','w hotel','bar','cocktails','sunset'], false, 2),

-- KERALA HOTELS
('Kumarakom Lake Resort Water Villa',
 'property_photo','hotel_exterior','Kerala','Kumarakom Lake Resort',
 'https://image.pollinations.ai/prompt/Kerala%20Kumarakom%20lake%20resort%20water%20villa%20backwater%20private%20balcony%20photography?width=800&height=500&seed=5401&nologo=true',
 'https://image.pollinations.ai/prompt/Kerala%20Kumarakom%20lake%20resort%20water%20villa%20backwater%20private%20balcony%20photography?width=400&height=250&seed=5401&nologo=true',
 'Thatched water villa on Vembanad Lake with private backwater deck, Kerala.',
 ARRAY['kerala','kumarakom','lake','villa','backwater'], true, 1),

('Marari Beach Resort Eco Cottage',
 'property_photo','hotel_exterior','Kerala','Marari Beach Resort',
 'https://image.pollinations.ai/prompt/Kerala%20Marari%20beach%20eco%20resort%20thatched%20cottage%20garden%20coconut%20palms%20photography?width=800&height=500&seed=5402&nologo=true',
 'https://image.pollinations.ai/prompt/Kerala%20Marari%20beach%20eco%20resort%20thatched%20cottage%20garden%20coconut%20palms%20photography?width=400&height=250&seed=5402&nologo=true',
 'Charming thatched eco-cottage surrounded by coconut palms at Marari Beach, Kerala.',
 ARRAY['kerala','marari','eco','beach','thatched'], false, 2),

-- KASHMIR HOTELS
('The Khyber Himalayan Resort Snow View',
 'property_photo','hotel_exterior','Kashmir','The Khyber Himalayan Resort',
 'https://image.pollinations.ai/prompt/Kashmir%20Gulmarg%20Khyber%20resort%20snow%20mountains%20winter%20luxury%20hotel%20photography?width=800&height=500&seed=5501&nologo=true',
 'https://image.pollinations.ai/prompt/Kashmir%20Gulmarg%20Khyber%20resort%20snow%20mountains%20winter%20luxury%20hotel%20photography?width=400&height=250&seed=5501&nologo=true',
 'The Khyber Himalayan Resort blanketed in snow with Gulmarg peaks as a backdrop.',
 ARRAY['kashmir','gulmarg','khyber','snow','mountains'], true, 1),

('Kashmir Heritage Houseboat Dal Lake',
 'property_photo','hotel_exterior','Kashmir','Heritage Houseboats',
 'https://image.pollinations.ai/prompt/Kashmir%20Dal%20Lake%20heritage%20luxury%20houseboat%20carved%20wood%20mountains%20photography?width=800&height=500&seed=5502&nologo=true',
 'https://image.pollinations.ai/prompt/Kashmir%20Dal%20Lake%20heritage%20luxury%20houseboat%20carved%20wood%20mountains%20photography?width=400&height=250&seed=5502&nologo=true',
 'Intricately carved wooden houseboat moored on Dal Lake with snow peaks beyond.',
 ARRAY['kashmir','houseboat','dal lake','heritage','carved'], false, 2),

-- RAJASTHAN HOTELS
('Oberoi Udaivilas Udaipur Pool View',
 'property_photo','pool','Rajasthan','Oberoi Udaivilas',
 'https://image.pollinations.ai/prompt/Udaipur%20Oberoi%20Udaivilas%20luxury%20pool%20palace%20hotel%20Lake%20Pichola%20Rajasthan%20photography?width=800&height=500&seed=5601&nologo=true',
 'https://image.pollinations.ai/prompt/Udaipur%20Oberoi%20Udaivilas%20luxury%20pool%20palace%20hotel%20Lake%20Pichola%20Rajasthan%20photography?width=400&height=250&seed=5601&nologo=true',
 'Oberoi Udaivilas'' palatial pool terrace overlooking Lake Pichola, Rajasthan.',
 ARRAY['rajasthan','udaipur','oberoi','pool','palace'], true, 1)

ON CONFLICT (title, type) DO NOTHING;

-- ─── MARKETING ASSETS ────────────────────────────────────────────────────────

INSERT INTO media_library (title, type, category, destination, url, thumbnail_url, description, tags, format, is_featured, sort_order) VALUES

('Summer Getaways 2025 — Campaign Banner',
 'marketing_asset','banner',NULL,
 'https://image.pollinations.ai/prompt/travel%20agency%20summer%20getaways%202025%20marketing%20banner%20beach%20vacation%20professional%20design?width=1200&height=400&seed=9001&nologo=true',
 'https://image.pollinations.ai/prompt/travel%20agency%20summer%20getaways%202025%20marketing%20banner%20beach%20vacation%20professional%20design?width=600&height=200&seed=9001&nologo=true',
 'Horizontal campaign banner for summer 2025 packages. Use for email headers and website.',
 ARRAY['banner','summer','2025','campaign','email'], 'jpg', true, 1),

('Maldives Luxury Escape — Social Post',
 'marketing_asset','social_post','Maldives',
 'https://image.pollinations.ai/prompt/Maldives%20luxury%20travel%20Instagram%20social%20media%20post%20square%20overwater%20villa%20branding?width=800&height=800&seed=9002&nologo=true',
 'https://image.pollinations.ai/prompt/Maldives%20luxury%20travel%20Instagram%20social%20media%20post%20square%20overwater%20villa%20branding?width=400&height=400&seed=9002&nologo=true',
 'Instagram-ready square post for Maldives luxury packages.',
 ARRAY['social','instagram','maldives','luxury','square'], 'jpg', false, 2),

('Europe Honeymoon Special — Brochure Cover',
 'marketing_asset','brochure','Europe - Paris & Switzerland',
 'https://image.pollinations.ai/prompt/Europe%20honeymoon%20travel%20brochure%20cover%20Paris%20couple%20romantic%20professional%20design?width=700&height=1000&seed=9003&nologo=true',
 'https://image.pollinations.ai/prompt/Europe%20honeymoon%20travel%20brochure%20cover%20Paris%20couple%20romantic%20professional%20design?width=350&height=500&seed=9003&nologo=true',
 'Portrait brochure cover for Europe honeymoon packages — Paris + Switzerland.',
 ARRAY['brochure','europe','honeymoon','paris','romantic'], 'jpg', true, 3),

('Dubai Shopping Festival — Email Header',
 'marketing_asset','email_template','Dubai',
 'https://image.pollinations.ai/prompt/Dubai%20Shopping%20Festival%20luxury%20email%20marketing%20header%20banner%20gold%20skyline%20professional?width=1200&height=400&seed=9004&nologo=true',
 'https://image.pollinations.ai/prompt/Dubai%20Shopping%20Festival%20luxury%20email%20marketing%20header%20banner%20gold%20skyline%20professional?width=600&height=200&seed=9004&nologo=true',
 'Email marketing header for Dubai Shopping Festival promotional campaigns.',
 ARRAY['dubai','email','banner','shopping','gold'], 'jpg', false, 4),

('Bali Yoga Retreat — Instagram Story',
 'marketing_asset','social_post','Bali',
 'https://image.pollinations.ai/prompt/Bali%20yoga%20retreat%20wellness%20Instagram%20story%20vertical%20travel%20social%20media%20design?width=600&height=1067&seed=9005&nologo=true',
 'https://image.pollinations.ai/prompt/Bali%20yoga%20retreat%20wellness%20Instagram%20story%20vertical%20travel%20social%20media%20design?width=300&height=533&seed=9005&nologo=true',
 'Vertical Instagram Story template for Bali wellness and yoga retreat packages.',
 ARRAY['bali','yoga','wellness','story','instagram'], 'jpg', false, 5),

('Kerala Backwaters Houseboat — Facebook Ad',
 'marketing_asset','banner','Kerala',
 'https://image.pollinations.ai/prompt/Kerala%20backwaters%20houseboat%20Facebook%20advertisement%20banner%20travel%20agency%20professional?width=1200&height=630&seed=9006&nologo=true',
 'https://image.pollinations.ai/prompt/Kerala%20backwaters%20houseboat%20Facebook%20advertisement%20banner%20travel%20agency%20professional?width=600&height=315&seed=9006&nologo=true',
 'Facebook-sized ad creative for Kerala backwaters houseboat vacation packages.',
 ARRAY['kerala','facebook','ad','houseboat','backwaters'], 'jpg', false, 6),

('Safarnaama Holidays — Company Profile Brochure',
 'marketing_asset','brochure',NULL,
 'https://image.pollinations.ai/prompt/travel%20agency%20company%20profile%20brochure%20cover%20luxury%20collage%20destinations%20professional%20design?width=700&height=1000&seed=9007&nologo=true',
 'https://image.pollinations.ai/prompt/travel%20agency%20company%20profile%20brochure%20cover%20luxury%20collage%20destinations%20professional%20design?width=350&height=500&seed=9007&nologo=true',
 'Corporate profile brochure cover for Safarnaama Holidays. Use for B2B and client pitches.',
 ARRAY['brochure','company','profile','corporate','safarnaama'], 'jpg', true, 7),

('Rajasthan Royal Heritage — Campaign Poster',
 'marketing_asset','banner','Rajasthan',
 'https://image.pollinations.ai/prompt/Rajasthan%20royal%20heritage%20travel%20campaign%20poster%20palace%20desert%20camel%20India%20professional?width=800&height=1200&seed=9008&nologo=true',
 'https://image.pollinations.ai/prompt/Rajasthan%20royal%20heritage%20travel%20campaign%20poster%20palace%20desert%20camel%20India%20professional?width=400&height=600&seed=9008&nologo=true',
 'Portrait campaign poster for Rajasthan royal heritage tour packages.',
 ARRAY['rajasthan','poster','heritage','royal','palace'], 'jpg', false, 8),

('New Year Countdown 2026 — WhatsApp Status',
 'marketing_asset','social_post',NULL,
 'https://image.pollinations.ai/prompt/New%20Year%202026%20travel%20countdown%20WhatsApp%20status%20vertical%20fireworks%20destinations%20design?width=600&height=1067&seed=9009&nologo=true',
 'https://image.pollinations.ai/prompt/New%20Year%202026%20travel%20countdown%20WhatsApp%20status%20vertical%20fireworks%20destinations%20design?width=300&height=533&seed=9009&nologo=true',
 'Vertical WhatsApp/Instagram Story for New Year 2026 travel package promotion.',
 ARRAY['new year','whatsapp','story','2026','countdown'], 'jpg', false, 9),

('Honeymoon Packages All-Inclusive — Flyer',
 'marketing_asset','flyer',NULL,
 'https://image.pollinations.ai/prompt/honeymoon%20travel%20package%20flyer%20romantic%20all%20inclusive%20couple%20destinations%20professional%20design?width=800&height=1100&seed=9010&nologo=true',
 'https://image.pollinations.ai/prompt/honeymoon%20travel%20package%20flyer%20romantic%20all%20inclusive%20couple%20destinations%20professional%20design?width=400&height=550&seed=9010&nologo=true',
 'A5 flyer for all-inclusive honeymoon packages. Print-ready design for front desk use.',
 ARRAY['honeymoon','flyer','romantic','couple','package'], 'jpg', true, 10),

('Thailand Songkran Festival Special — Post',
 'marketing_asset','social_post','Thailand',
 'https://image.pollinations.ai/prompt/Thailand%20Songkran%20festival%20water%20social%20media%20marketing%20post%20square%20colorful%20travel?width=800&height=800&seed=9011&nologo=true',
 'https://image.pollinations.ai/prompt/Thailand%20Songkran%20festival%20water%20social%20media%20marketing%20post%20square%20colorful%20travel?width=400&height=400&seed=9011&nologo=true',
 'Social media post for Thailand Songkran Festival themed tour packages.',
 ARRAY['thailand','songkran','festival','social','square'], 'jpg', false, 11),

('Himachal Pradesh Winter Snow — Campaign',
 'marketing_asset','banner','Himachal Pradesh',
 'https://image.pollinations.ai/prompt/Himachal%20Pradesh%20winter%20snow%20mountains%20travel%20campaign%20banner%20skiing%20Manali%20India?width=1200&height=400&seed=9012&nologo=true',
 'https://image.pollinations.ai/prompt/Himachal%20Pradesh%20winter%20snow%20mountains%20travel%20campaign%20banner%20skiing%20Manali%20India?width=600&height=200&seed=9012&nologo=true',
 'Winter campaign banner for Himachal Pradesh snow packages — Manali, Spiti, Kullu.',
 ARRAY['himachal','winter','snow','banner','skiing'], 'jpg', false, 12),

('Safarnaama 5-Star Reviews — Testimonial Card',
 'marketing_asset','social_post',NULL,
 'https://image.pollinations.ai/prompt/travel%20agency%205%20star%20review%20testimonial%20social%20media%20card%20luxury%20professional%20design?width=800&height=800&seed=9013&nologo=true',
 'https://image.pollinations.ai/prompt/travel%20agency%205%20star%20review%20testimonial%20social%20media%20card%20luxury%20professional%20design?width=400&height=400&seed=9013&nologo=true',
 'Client testimonial card template for sharing 5-star reviews on social media.',
 ARRAY['testimonial','review','social','5star','branding'], 'jpg', false, 13)

ON CONFLICT (title, type) DO NOTHING;

-- ─── VERIFY ──────────────────────────────────────────────────────────────────
SELECT
  type,
  category,
  COUNT(*) as count
FROM media_library
GROUP BY type, category
ORDER BY type, category;

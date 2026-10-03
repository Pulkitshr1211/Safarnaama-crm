-- ============================================================
-- SAFARNAAMA — Activities Catalog with English Verbiage
-- Run in Supabase SQL Editor
-- ============================================================

-- Step 1: Add columns to existing activities table
ALTER TABLE activities ADD COLUMN IF NOT EXISTS type        TEXT    DEFAULT 'sightseeing';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS duration    TEXT    DEFAULT '2–3 hours';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS image_url   TEXT;

-- Step 2: Unique index so upsert works cleanly
CREATE UNIQUE INDEX IF NOT EXISTS activities_dest_name_idx ON activities (destination, name);

-- ============================================================
-- MALDIVES
-- ============================================================
INSERT INTO activities (destination, name, type, description, duration, image_url, sort_order) VALUES

('Maldives', 'Snorkelling at House Reef', 'adventure',
'Step off the jetty and into a shimmering underwater paradise. The house reef surrounding your resort is alive with vibrant coral gardens, sea turtles gliding effortlessly overhead, reef sharks resting on the sandy floor, and thousands of tropical fish darting through the formations. Equipped with a mask, snorkel and fins, you will glide over coral bommies in water so clear visibility stretches to 20 metres. Morning sessions offer the calmest seas and best light. A resident marine biologist guides you through the reef, pointing out rare species along the way. This quintessential Maldivian experience is available daily and included in most resort packages.',
'2–3 hours', 'https://picsum.photos/seed/snorkellingmaldives/800/500', 1),

('Maldives', 'Scuba Diving Excursion', 'adventure',
'Explore some of the Indian Ocean''s most spectacular dive sites with a PADI-certified divemaster. From vibrant coral walls to current-swept channels teeming with mantas, reef sharks and hammerheads, the Maldives is consistently ranked among the world''s top diving destinations. Introductory dives are available for first-timers in a calm, shallow lagoon before venturing to deeper sites. All equipment — BCD, regulator, wetsuit and tank — is provided at the dive centre. Two-tank morning dives are the most popular option, covering different sites in a single outing. Night dives are also available for certified divers.',
'Half day', 'https://picsum.photos/seed/scubamaldives/800/500', 2),

('Maldives', 'Sunset Dolphin Cruise', 'leisure',
'As the sky turns golden, board a traditional Maldivian dhoni and head out to open waters where pods of spinner dolphins gather each evening. These playful creatures are known to ride the bow wave and leap acrobatically alongside the boat. Freshly cut fruit, Maldivian short eats and cool drinks are served on board as you watch the sun dip below the horizon in a blaze of colour. The cruise typically lasts 90 minutes and is suitable for all ages, making it one of the most memorable family experiences on the islands.',
'1.5 hours', 'https://picsum.photos/seed/dolphincruisemaldives/800/500', 3),

('Maldives', 'Seaplane Scenic Transfer', 'transfer',
'The iconic seaplane journey to your island resort is a travel experience in itself. Flying low over the atolls, you will be treated to a bird''s-eye view of the Maldives'' extraordinary geography — hundreds of ring-shaped coral atolls, each enclosing a lagoon of impossible blue. On a clear day the colours range from deep navy to the palest turquoise. Seaplanes operate during daylight hours, so morning or early afternoon transfers deliver the best views. The flight time varies from 20 to 45 minutes depending on the resort location, and the window seats on both sides offer equally spectacular panoramas.',
'30–45 min', 'https://picsum.photos/seed/seaplanemaldives/800/500', 4),

('Maldives', 'Traditional Night Fishing', 'leisure',
'Join local Maldivian fishermen on an authentic hand-line fishing trip as the stars emerge. This age-old tradition, known as "mas vadi", uses bamboo rods and no electric lights — just moonlight and the gentle rocking of a wooden dhoni. The fish are plentiful in these rich waters and your catch — often reef fish and small tuna — can be grilled by the resort kitchen and served to you the same evening. The trip is as much about the experience of the open ocean at night, away from resort lights, as it is about the fishing itself.',
'2 hours', 'https://picsum.photos/seed/fishingmaldives/800/500', 5),

('Maldives', 'Overwater Spa Treatment', 'leisure',
'Surrender to complete tranquillity in an overwater spa pavilion set directly above the turquoise lagoon. Through the glass floor panels beneath your treatment bed, tropical fish drift lazily below as skilled therapists perform traditional Maldivian "Dhivehi" massages blended with Ayurvedic and aromatherapy techniques. Signature treatments include a Four Hands Massage, Coconut Scrub and Wrap, and the popular Rasul Mud Ritual. Most resorts offer couples'' suites with open-air bathtubs perched above the water. The combination of the ocean soundtrack, warm tropical breeze and expert hands creates an incomparably restorative experience.',
'1.5–2 hours', 'https://picsum.photos/seed/spamaldives/800/500', 6),

('Maldives', 'Water Sports (Jet Ski & Parasailing)', 'adventure',
'The warm, crystal-clear lagoon surrounding your resort provides a perfect natural playground for an exhilarating morning of water sports. Hop on a jet ski and carve through the gentle swells at speed, or strap into a parasailing harness and soar 80 metres above the lagoon for an eagle''s-eye view of the entire atoll. Windsurfing, stand-up paddleboarding and kayaking are also available for those who prefer a slower pace. Qualified instructors give safety briefings and are on the water at all times. Equipment hire is typically available by the hour or as a bundled package.',
'2–3 hours', 'https://picsum.photos/seed/watersportsmaldives/800/500', 7),

-- ============================================================
-- GOA
-- ============================================================
('Goa', 'Baga Beach Leisure & Water Sports', 'leisure',
'Goa''s most famous stretch of sand offers something for every type of traveller. Spend the morning lounging on a sunbed under a palm-thatch umbrella with a cold Kingfisher in hand, then work up some energy with jet skiing, banana boat rides, or parasailing over the Arabian Sea. Beach shacks lining the shore serve freshly grilled seafood, Goan fish curry and ice-cold coconut water throughout the day. As evening approaches, beach clubs fill with music and colour, creating a festive atmosphere unlike anywhere else in India. Sunsets at Baga are legendary — painted in shades of orange and violet over the sea.',
'Full day', 'https://picsum.photos/seed/goabeach/800/500', 1),

('Goa', 'Old Goa Heritage Walk', 'sightseeing',
'Step back 500 years on a guided walk through the UNESCO-listed churches and convents of Old Goa, once the "Rome of the East" and the capital of Portuguese India. The Basilica of Bom Jesus, built in 1605, houses the sacred relics of St Francis Xavier in an ornate gilded casket. Next door, the Se Cathedral — the largest church in Asia — features a golden bell said to have the most harmonious ring in the world. Your guide will bring the colonial history alive with stories of the Inquisition, spice trade routes, and the remarkable blending of Indian and European cultures that defines Goan heritage.',
'3 hours', 'https://picsum.photos/seed/oldgoa/800/500', 2),

('Goa', 'Spice Plantation Tour & Lunch', 'sightseeing',
'Escape the beach and venture inland to one of Goa''s fragrant spice estates, set in the lush foothills of the Western Ghats. Guided trails wind through plantations of cardamom, vanilla, pepper, nutmeg and turmeric, with knowledgeable guides explaining the history, cultivation and medicinal uses of each spice. Exotic animals — including crocodiles, peacocks and giant squirrels — are often spotted along the way. The tour concludes with a traditional Goan buffet lunch served on banana leaves, featuring fish curry, pork vindaloo, bebinca dessert and unlimited feni. A cultural dance performance and elephant interaction are included at most estates.',
'Half day', 'https://picsum.photos/seed/spiceplantationgoa/800/500', 3),

('Goa', 'Dolphin Watching Boat Cruise', 'leisure',
'The calm waters off the Goan coast are home to large pods of friendly Indian Ocean humpback and spinner dolphins. Board a local fishing boat in the early morning when dolphins are most active, and head to the known hotspots between Sinquerim and Grand Island. Sightings are almost guaranteed, with the dolphins often swimming alongside the boat and surfacing just metres away. The cruise also passes the iconic Aguada Fort, colonial lighthouse and bird-rich estuaries. Refreshing nimbu pani and fresh fruit are served on board, and the guide provides fascinating commentary on marine conservation and dolphin behaviour.',
'2 hours', 'https://picsum.photos/seed/dolphingoa/800/500', 4),

('Goa', 'Dudhsagar Waterfall Trek', 'adventure',
'Journey to one of India''s tallest waterfalls, the majestic Dudhsagar — meaning "Sea of Milk" — which plunges 310 metres in four tiers from the Bhagwan Mahavir Wildlife Sanctuary into a milky-white pool below. The trail passes through dense sal and bamboo forest, with opportunities to spot wild gaur, flying squirrels and kingfishers. A jeep safari through the sanctuary covers part of the route, with a final trek to the viewpoint over rocky, forested terrain. Best visited during or just after the monsoon (July–October) when water levels are at their peak. Swimming in the plunge pool is permitted during the dry season.',
'Full day', 'https://picsum.photos/seed/dudhsaagargoa/800/500', 5),

('Goa', 'Sunset River Cruise on Mandovi', 'leisure',
'As the sun begins to set over the Mandovi River, board a traditional Goan folk boat decorated with coloured lights for an unforgettable evening cruise. Cultural performances of Mando and Dekhni — the folk dances of Goa — are staged on the deck by performers in traditional costume, bringing alive the musical heritage of this former Portuguese colony. The cruise also features a live band playing classic Konkani melodies, cocktails and canapés. Warm orange lights reflect on the river as Old Goa''s illuminated skyline drifts past. This is the perfect gentle introduction to Goan culture for families and first-time visitors.',
'1.5 hours', 'https://picsum.photos/seed/sunsetcruisegoa/800/500', 6),

-- ============================================================
-- KERALA
-- ============================================================
('Kerala', 'Alleppey Backwater Houseboat Cruise', 'leisure',
'Drift through one of the world''s most unique ecosystems aboard a luxury kettuvallam — a traditional rice barge converted into a floating cottage. The Alleppey backwaters are a network of over 900 kilometres of canals, rivers, lakes and lagoons weaving through a landscape of coconut groves, paddy fields and tiny fishing villages. Your houseboat comes with a private chef who prepares authentic Kerala meals — fish molee, prawn masala, avial and fresh coconut rice — served as you glide past local life unfolding on the banks. An overnight cruise allows you to anchor under the stars and wake to birdsong at dawn, surrounded by still, mirror-like water.',
'Full day / Overnight', 'https://picsum.photos/seed/alleppeykerala/800/500', 1),

('Kerala', 'Kathakali Cultural Performance', 'sightseeing',
'Witness one of India''s most elaborate classical art forms in an intimate theatre setting. Kathakali performers spend hours applying intricate makeup — layers of rice paste, mineral pigments and paper cutouts — that transform their faces into mythological characters. The dance-drama, performed to live percussion and vocal accompaniment, narrates episodes from the Ramayana and Mahabharata through precise hand gestures (mudras) and powerful facial expressions (navarasas). Arrive 45 minutes early to watch the makeup application ceremony, which is itself a fascinating spectacle. Performance venues in Kochi and Thrissur offer pre-show introductions in English for international visitors.',
'2 hours', 'https://picsum.photos/seed/kathakalikerala/800/500', 2),

('Kerala', 'Munnar Tea Plantation Visit', 'sightseeing',
'Drive into the mist-wrapped hills of Munnar, where emerald tea gardens carpet the Western Ghats as far as the eye can see. A guided walk through a working estate explains the entire journey from leaf to cup — plucking by hand, withering, rolling, fermenting, drying and grading. Visit the KDHP Tea Museum, housed in a century-old factory, for a deeper understanding of the industry that has shaped these hills since British planters first arrived in the 1880s. The estate tea room offers tastings of Munnar''s prized single-estate teas, including the rare white tea and the locally famous cardamom-infused blend.',
'4 hours', 'https://picsum.photos/seed/munnartea/800/500', 3),

('Kerala', 'Ayurvedic Spa & Panchakarma', 'leisure',
'Kerala is the birthplace of Ayurveda — the ancient Indian science of life and wellbeing — and the state''s practitioners are among the most skilled in the world. A traditional Abhyanga (four-hand synchronised oil massage using warm medicated sesame oil) followed by Shirodhara (a continuous stream of warm oil poured over the forehead) induces a state of deep relaxation that guests describe as transformative. Longer Panchakarma detox programmes spanning 7–21 days are available at specialised retreat centres. Each treatment is preceded by a consultation with an Ayurvedic physician who assesses your dosha and tailors therapies accordingly.',
'2–3 hours (or multi-day)', 'https://picsum.photos/seed/ayurvedakerala/800/500', 4),

('Kerala', 'Periyar Wildlife Sanctuary Boat Ride', 'adventure',
'The Periyar Tiger Reserve in Thekkady offers one of India''s most relaxed wildlife viewing experiences — a two-hour bamboo raft or motor launch ride across the tranquil Periyar Lake that sits at the heart of the forest. Herds of wild elephants come to the water''s edge to drink and bathe, especially in the early morning. Sambar deer, otters, giant squirrels and over 265 bird species inhabit the reserve, and tiger pugmarks are occasionally spotted on the muddy banks. Night treks with forest department guides are available for those seeking a more immersive experience.',
'2–3 hours', 'https://picsum.photos/seed/periyarwildlife/800/500', 5),

('Kerala', 'Fort Kochi Heritage Walk', 'sightseeing',
'Fort Kochi is a living museum of the spice trade era — an island neighbourhood where Portuguese churches stand beside Dutch cemeteries, Jewish synagogues and Chinese fishing nets all within walking distance. Begin at the iconic cantilevered Chinese fishing nets along the waterfront, then visit St Francis Church — the oldest European-built church in India — where Vasco da Gama was originally buried. The neighbourhood''s Art District is packed with galleries, open studios and street art installations. Conclude with a visit to the 450-year-old Paradesi Synagogue in Mattancherry''s "Jew Town," where antique spice warehouses still fill the air with the scent of cardamom and pepper.',
'3 hours', 'https://picsum.photos/seed/fortkochi/800/500', 6),

-- ============================================================
-- DUBAI
-- ============================================================
('Dubai', 'Burj Khalifa At the Top (Level 124)', 'sightseeing',
'Ascend to the world''s tallest building for breathtaking 360-degree panoramas across Dubai''s extraordinary skyline, the Arabian Desert beyond, and the glittering Persian Gulf. High-speed double-decker elevators whisk you to the observation deck on the 124th floor in under 60 seconds. Interactive telescope stations zoom in on key landmarks, while informative displays trace Dubai''s remarkable transformation from fishing village to global metropolis in just 50 years. The experience is at its most spectacular at sunset when the city lights begin to glow — book tickets in advance as this popular session sells out weeks ahead. Premium upper-deck access to Level 148 is also available.',
'2 hours', 'https://picsum.photos/seed/burjkhalifadubai/800/500', 1),

('Dubai', 'Desert Safari with Dune Bashing & BBQ', 'adventure',
'As the afternoon heat mellows, a 4WD convoy heads into the vast red sand dunes of the Arabian Desert for one of Dubai''s most iconic experiences. Expert drivers deflate the tyres and tackle the dunes with heart-pumping dips and turns — adrenaline is guaranteed. At the Bedouin-style desert camp, camels are saddled for gentle rides, henna artists await, and traditional Arabic attire is available for photographs. As stars emerge, a lavish BBQ buffet is served under the open sky — grilled meats, mezze, fresh Arabic bread and endless tea. Belly dancing and tanoura spinning performances follow under the desert stars.',
'6 hours', 'https://picsum.photos/seed/desertsafaridubai/800/500', 2),

('Dubai', 'Dubai Marina Dhow Dinner Cruise', 'leisure',
'Glide along the glittering Dubai Marina on a traditional wooden dhow converted for elegant evening dining. The two-hour cruise passes the iconic twisted Cayan Tower, JBR Beach and the glowing Ain Dubai ferris wheel as you enjoy a lavish international and Arabic buffet served on the upper deck. Live traditional music and a Tanoura dancer perform on deck as the city skyline reflects in the still marina waters. A fully stocked bar, soft drinks and unlimited Arabic coffee and dates are included. This is a magical setting for couples and a fantastic way to see Dubai''s most photographed skyline from a completely different angle.',
'2 hours', 'https://picsum.photos/seed/dhoweveningdubai/800/500', 3),

('Dubai', 'Gold & Spice Souk Walking Tour', 'sightseeing',
'Cross Dubai Creek on a traditional abra (water taxi) to explore the atmospheric souks of Deira — unchanged in character for generations. The Gold Souk glitters with over 25 tonnes of gold on display at any given time, from traditional Arabic wedding jewellery to contemporary investment pieces. Skilled negotiation can yield excellent prices. Just a few lanes away, the Spice Souk fills the air with the intoxicating scent of saffron, frankincense, dried rose petals and cardamom. Your guide provides the cultural context behind each commodity and helps with bargaining. The abra crossing itself — just one dirham — is one of the most authentic transport experiences in the city.',
'3 hours', 'https://picsum.photos/seed/goldsoukdubai/800/500', 4),

('Dubai', 'Dubai Frame & Old Dubai Heritage', 'sightseeing',
'The Dubai Frame is one of the city''s most clever architectural conceits — a 150-metre picture frame that offers old Dubai from one window and futuristic Dubai from the other. The glass-floored sky bridge between the two towers provides a nerve-testing walk with vertiginous views straight down. Combine this with a visit to Al Fahidi Historical Neighbourhood, where wind-tower courtyard houses now contain galleries, craft workshops and the excellent Dubai Museum. The neighbourhood''s labyrinthine lanes are ideal for photography, and the nearby Textile Souk offers colourful fabrics at exceptional prices.',
'3–4 hours', 'https://picsum.photos/seed/dubaiframe/800/500', 5),

('Dubai', 'Burj Al Arab Afternoon Tea', 'dining',
'Experience Dubai''s most iconic luxury at the world''s most recognised hotel. Afternoon tea at the Burj Al Arab''s Skyview Bar — perched on the 27th floor with cantilevered views over the sea — is a theatrical three-tier affair featuring finger sandwiches, miniature pastries, scones with clotted cream and an extensive selection of specialty teas and Champagne. The interior is famously opulent: 22-carat gold-leaf walls, a soaring atrium rising 180 metres, and attentive butler service for every guest. Dress code is smart casual and reservation is essential. The experience is a genuine one-of-a-kind memory of Dubai''s golden age of excess.',
'2 hours', 'https://picsum.photos/seed/burjalarabdubai/800/500', 6),

-- ============================================================
-- BALI
-- ============================================================
('Bali', 'Tanah Lot Temple at Sunset', 'sightseeing',
'Perched on a dramatic sea rock lashed by Indian Ocean surf, Tanah Lot is Bali''s most photographed temple and one of the island''s holiest sea temples. As the sun descends toward the horizon, the silhouette of the tiered pagoda against a sky blazing with colour creates a scene that encapsulates everything magical about Bali. The temple complex is accessible on foot at low tide, and colourful market stalls and warungs line the clifftop path. A resident holy sea snake, believed to be the temple''s guardian, can sometimes be spotted in a cave at the rock''s base. The visit pairs perfectly with a light dinner at one of the clifftop restaurants overlooking the ocean.',
'2–3 hours', 'https://picsum.photos/seed/tanahlotbali/800/500', 1),

('Bali', 'Ubud Monkey Forest & Royal Palace', 'sightseeing',
'Deep in the heart of Ubud, the Sacred Monkey Forest Sanctuary is home to over 700 Balinese long-tailed macaques living freely among three ancient Hindu temples dated to the 14th century. A shaded trail winds through giant fig and strangler trees as monkeys descend from the canopy to investigate visitors at close range — both delightful and occasionally mischievous. From the Monkey Forest, a short walk along Ubud''s main street leads to the Ubud Royal Palace (Puri Saren Agung), where traditional architecture, carved stone gateways and manicured lotus ponds provide a serene counterpoint. Legong and Kecak performances are held in the palace courtyard every evening.',
'3 hours', 'https://picsum.photos/seed/ububmonkeyforest/800/500', 2),

('Bali', 'Tegalalang Rice Terrace Trekking', 'adventure',
'Trek through the UNESCO-listed Tegalalang rice terraces, a cascading landscape of emerald-green paddies that descend from the village to the Cebok River gorge below. The ancient subak irrigation system — a 1000-year-old cooperative water management tradition — keeps the paddies continuously flooded and productive. Walking trails zig-zag through the working rice fields where farmers in conical hats tend their crops by hand, largely unchanged from their ancestors. Photo opportunities abound — traditional bamboo swings are perched over the valley for the truly brave. The best light is in the early morning when the mist still clings to the valleys and the terraces are at their greenest.',
'2–3 hours', 'https://picsum.photos/seed/riceterracebali/800/500', 3),

('Bali', 'Traditional Balinese Cooking Class', 'dining',
'Begin with a colourful morning market tour where your local chef guide introduces the key ingredients of Balinese cuisine — fresh galangal, lemongrass, candlenut and coconut. Then head to a traditional family compound to cook a four-course feast: pelecing kangkung (water spinach in chilli paste), sate lilit (minced fish satay on lemongrass skewers), ayam betutu (slow-roasted spiced chicken) and the famous Balinese black rice pudding. The class is highly hands-on and the recipes are yours to take home. Lunch is the feast you''ve cooked, enjoyed in the family''s garden compound surrounded by tropical flowers and the sound of gamelan from a nearby temple.',
'4 hours', 'https://picsum.photos/seed/cookingclassbali/800/500', 4),

('Bali', 'Kecak Fire Dance at Uluwatu', 'sightseeing',
'Perched on a 70-metre cliff above crashing Indian Ocean waves, the Uluwatu Temple hosts one of Bali''s most electrifying cultural performances. As dusk falls, a chorus of 70 bare-chested men chanting "cak-cak-cak" in hypnotic rhythm enact the battle from the Hindu epic Ramayana — without instruments, only voice and movement. The climax involves a dancer wrapped in coconut husks who walks through and kicks burning torches, creating showers of sparks against the darkening sky. The backdrop of the ancient sea temple and the crashing waves below makes this one of the most atmospheric theatre experiences in all of Asia.',
'2 hours', 'https://picsum.photos/seed/kecakdancebali/800/500', 5),

('Bali', 'Mount Batur Sunrise Trek', 'adventure',
'Set off at 2am with a local guide for the 1.5-hour ascent of Mount Batur (1717m), Bali''s active volcano, to witness one of Asia''s most celebrated sunrises. As dawn breaks, the surrounding caldera lake, distant Mount Agung and the shadow of Bali itself come into view in sequence as the sky shifts from deep indigo to rose gold. At the crater rim, volcanic heat vents are used to cook eggs and corn for a volcanic breakfast. The descent offers different views and passes through coffee and fruit plantations. No prior trekking experience is required, and the entire experience — pre-dawn start, cool mountain air, and the dramatic volcanic landscape — is genuinely life-changing.',
'6 hours', 'https://picsum.photos/seed/mountbaturbali/800/500', 6),

-- ============================================================
-- SINGAPORE
-- ============================================================
('Singapore', 'Gardens by the Bay & Cloud Forest', 'sightseeing',
'Gardens by the Bay is one of the 21st century''s greatest public spaces — a futuristic botanical garden on reclaimed land featuring the iconic Supertree Grove, Cloud Forest and Flower Dome conservatories. The Cloud Forest conservatory houses the world''s tallest indoor waterfall (35m) cascading down a mountain covered in orchids, ferns and carnivorous plants. The Flower Dome — the world''s largest glass greenhouse — displays Mediterranean plants and seasonal floral displays. After dark, the Supertrees come alive in the Garden Rhapsody light and sound show, their interconnected canopy walkways illuminated in shifting colours above the paths below. A stunning hour-long self-guided walk completes the evening.',
'3–4 hours', 'https://picsum.photos/seed/gardensbaysingapore/800/500', 1),

('Singapore', 'Marina Bay Sands SkyPark Observation Deck', 'sightseeing',
'The observation deck atop the famous ship-shaped SkyPark — suspended 200 metres above Singapore — offers unobstructed 360-degree views across the city-state and into Malaysia and Indonesia on a clear day. The infinity pool (reserved for hotel guests) and the public observation deck are separated by clever design, but both share the same extraordinary sense of floating above the urban landscape. At night, the city lights create a breathtaking canvas. Combine the deck with drinks at the Ce La Vi Sky Bar — the highest alfresco bar in Singapore — as you watch the Marina Bay Light Show (Spectra) play out on the waterfront far below.',
'2 hours', 'https://picsum.photos/seed/marinabaysingapore/800/500', 2),

('Singapore', 'Universal Studios Singapore', 'sightseeing',
'Southeast Asia''s only Universal Studios theme park on Sentosa Island offers 24 rides and attractions across seven themed zones. Hollywood, New York, Sci-Fi City, Ancient Egypt, The Lost World, Far Far Away and Madagascar each transport guests into a different world. Highlights include Battlestar Galactica (Singapore''s tallest roller coasters), Transformers The Ride, and the immersive Jurassic World Raptor Encounter. The park''s smaller scale compared to its American counterparts means shorter queues, and most attractions can be covered in a single day. Evening performances, including the fantastical Monster Rock show, are staged in the park''s central New York Street.',
'Full day', 'https://picsum.photos/seed/universalstudiossingapore/800/500', 3),

('Singapore', 'Hawker Centre Food Tour', 'dining',
'Singapore''s hawker centres are living cultural institutions — vast open-air food courts where multi-generational stallholders serve dishes that have been perfected over decades at astonishingly low prices. A guided food tour covers the city''s essential dishes: Hainanese Chicken Rice (the unofficial national dish), Char Kway Teow (wok-fried flat noodles), Laksa (spicy coconut noodle soup), Chilli Crab, Roti Prata, and the extraordinary Teh Tarik (pulled tea). Maxwell Food Centre, Newton Circus and the Lau Pa Sat are the most famous centres. The guide explains the history and technique behind each dish and steers you to the stalls with the longest queues — a reliable indicator of quality.',
'3 hours', 'https://picsum.photos/seed/hawkersingapore/800/500', 4),

('Singapore', 'Chinatown & Little India Heritage Walk', 'sightseeing',
'Singapore preserves its multicultural heritage in remarkably authentic style — and nowhere more so than in Chinatown and Little India, two neighbourhoods that feel entirely distinct from the gleaming financial district just minutes away. In Chinatown, the ornate Buddha Tooth Relic Temple, incense-scented tea houses, and traditional medicine shops line streets of perfectly restored shophouses. In Little India, the Sri Veeramakaliamman Temple erupts in vivid colour, the scent of jasmine garlands fills the air, and fabric merchants spill their wares onto the pavement. The guide provides rich historical context about the waves of immigrants who built colonial Singapore.',
'3 hours', 'https://picsum.photos/seed/chinatownsingapore/800/500', 5),

-- ============================================================
-- THAILAND
-- ============================================================
('Thailand', 'Grand Palace & Wat Phra Kaew', 'sightseeing',
'The Grand Palace complex in Bangkok is Thailand''s most awe-inspiring architectural ensemble — a shimmering city within a city of golden spires, mirrored mosaic towers, ornate pavilions and manicured lawns covering 218,000 square metres. The complex was built in 1782 and served as the official residence of the Kings of Siam for 150 years. Within its walls lies Wat Phra Kaew, the Temple of the Emerald Buddha, home to a sacred 14th-century jade figurine so revered that the King himself changes its golden raiment three times a year. Dress modestly (shoulders and knees covered) as a mark of respect — sarongs are available for hire at the entrance.',
'3 hours', 'https://picsum.photos/seed/grandpalacethailand/800/500', 1),

('Thailand', 'Damnoen Saduak Floating Market', 'sightseeing',
'Board a longtail boat and plunge into the extraordinary colour and chaos of Thailand''s most famous floating market, located 80km southwest of Bangkok. Vendors in wide-brimmed bamboo hats paddle wooden boats loaded with tropical fruits, pad thai, fresh-squeezed juices, jasmine garlands, and handmade handicrafts. The best time to visit is between 7am and 10am when the market is busiest and the early morning light is at its most photogenic. Your guide navigates through the network of narrow khlong (canals) to the quieter sections of the market away from the tourist boats, where local life continues exactly as it has for centuries.',
'Half day', 'https://picsum.photos/seed/floatingmarketthailand/800/500', 2),

('Thailand', 'Phi Phi Islands Day Trip by Speedboat', 'adventure',
'Board a sleek speedboat from Krabi or Phuket for a full-day island-hopping adventure through the otherworldly Ko Phi Phi archipelago. Maya Bay — immortalised in the film "The Beach" — is a first stop, with its sheer limestone cliffs enclosing a perfect crescent of white sand. Viking Cave, Monkey Beach and the turquoise waters of Phi Phi Leh offer world-class snorkelling among reef sharks, sea turtles and tropical fish. The trip includes a leisurely seafood lunch on Phi Phi Don — the main inhabited island — and unlimited snorkelling equipment. The return journey at golden hour, with the limestone karsts silhouetted against the sunset sky, is worth the trip alone.',
'Full day', 'https://picsum.photos/seed/phiphithailand/800/500', 3),

('Thailand', 'Elephant Sanctuary Visit', 'adventure',
'Spend a half-day at an ethical elephant sanctuary in the forests of Chiang Mai where retired working elephants — once used in the logging industry or street begging — live out their days in peace. Unlike traditional elephant camps, this experience involves no riding or performances. Instead, guests walk alongside the elephants through the forest, learning about their behaviour and history from mahouts who have cared for them for decades. You will feed the elephants bananas and sugarcane, bathe them in the river, and watch them play and interact with each other. The visit includes a vegetarian sanctuary lunch and a strong conservation education component.',
'Half day', 'https://picsum.photos/seed/elephantthailand/800/500', 4),

('Thailand', 'Thai Cooking Class', 'dining',
'Thai cuisine is one of the world''s most complex and aromatic, and learning to prepare it from a local chef is one of the most rewarding ways to connect with the culture. The class begins with a guided tour of a local market to source ingredients — galangal, kaffir lime leaves, Thai basil, bird''s eye chillies — before moving to a traditional open-air kitchen. You will prepare four to five dishes, typically including Tom Yum Goong, Green Curry with Coconut Milk, Pad Thai, Som Tam (green papaya salad) and Mango Sticky Rice. Every student gets their own wok and receives a recipe booklet to take home, along with the confidence to recreate these dishes anywhere in the world.',
'4 hours', 'https://picsum.photos/seed/cookingclassthailand/800/500', 5),

('Thailand', 'Chao Phraya River Dinner Cruise', 'dining',
'As Bangkok''s legendary traffic jams bring the city''s roads to a standstill, the Chao Phraya River offers a serene and strikingly beautiful alternative perspective on the capital. Boarding a converted rice barge or luxury river cruiser, guests are treated to an international and Thai buffet dinner as the city''s landmarks glide past — Wat Arun''s moonlit spires reflected in the dark water, Rama VIII Bridge lit in shifting colours, and the atmospheric riverside neighbourhoods of Thonburi. Live traditional Thai music accompanies dinner, and the cooler river breeze provides welcome relief from the city heat. The return cruise is often the most romantic part of the evening.',
'2 hours', 'https://picsum.photos/seed/dinnercruisebangkok/800/500', 6),

-- ============================================================
-- VIETNAM
-- ============================================================
('Vietnam', 'Ha Long Bay Overnight Cruise', 'leisure',
'Sail through one of the world''s most spectacular UNESCO World Heritage Sites — Ha Long Bay — aboard a traditional wooden junk with overnight accommodation in private en-suite cabins. Nearly 2000 limestone karst islands rise from an emerald sea, each covered in dense tropical vegetation and harbouring hidden lagoons, grottos and beaches accessible only by sea. Kayaking through the caves of Thien Cung and Dau Go is a highlight, as is watching the sunrise from the top deck as mist rises from the water between the islands. Meals are freshly prepared on board and feature the finest seafood of the Gulf of Tonkin. This is Vietnam''s single most iconic travel experience.',
'2 days / 1 night', 'https://picsum.photos/seed/halongbay/800/500', 1),

('Vietnam', 'Hoi An Old Town Night Walk', 'sightseeing',
'Hoi An''s ancient trading port, perfectly preserved from the 15th–19th centuries, is among Southeast Asia''s most enchanting destinations. As dusk falls, hundreds of silk lanterns are lit throughout the Old Town, casting the temples, merchants'' houses and covered Japanese bridge in a warm amber glow. The Thursday Full Moon Festival transforms the riverside into a lantern-lit celebration with no motor vehicles, traditional music performances and floating candle boats released on the Thu Bon River. Your guide leads you through the UNESCO-listed lanes, into the centuries-old Tan Ky Merchant House with its Japanese-Chinese architectural blend, and along the lantern-makers'' street where artisans work by hand.',
'3 hours', 'https://picsum.photos/seed/hoianvietnam/800/500', 2),

('Vietnam', 'Cu Chi Tunnels Historical Tour', 'sightseeing',
'Journey 40km northwest of Ho Chi Minh City to the extraordinary network of Cu Chi tunnels — 250km of underground passages used by Viet Cong fighters during the American War. The guided tour descends into the tunnel system (now widened slightly for visitors) to experience the claustrophobic conditions that fighters endured for years. Above ground, the jungle conceals booby trap displays, weapons demonstrations and a firing range where visitors can shoot period firearms. The guide, often a local whose own family sheltered in the tunnels, provides a powerful first-person perspective on this chapter of history that fundamentally shaped modern Vietnam.',
'Half day', 'https://picsum.photos/seed/cuchivietnam/800/500', 3),

('Vietnam', 'Mekong Delta Day Trip', 'sightseeing',
'Leave the noise of Ho Chi Minh City behind for a full day exploring the extraordinary river life of the Mekong Delta — a vast, flat landscape of rice paddies, coconut groves and waterways where millions of people live their entire lives on or beside the river. Sampan boats navigate through narrow canals lined with water hyacinths to visit a rice paper factory, a coconut candy workshop, a bee farm, and a local home where lunch is prepared over a wood fire. The authentic village homestay experience includes a traditional music performance and a final boat ride through the floating market before the return journey to the city.',
'Full day', 'https://picsum.photos/seed/mekongdelta/800/500', 4),

('Vietnam', 'Vietnamese Cooking Class', 'dining',
'Unlock the secrets of one of Asia''s most complex and celebrated cuisines in a hands-on cooking class led by a local chef. Begin with a walk through Ben Thanh Market or a local wet market to source the freshest ingredients — morning glory, bean sprouts, fresh pho noodles, lemongrass and fermented shrimp paste. The class covers the dishes most iconic to the region: Pho Bo (beef noodle soup), Banh Mi assembly, Goi Cuon (fresh spring rolls), and the sublime Bun Bo Hue (spicy lemongrass beef noodle). Every student works at their own station and receives a recipe booklet. The session concludes with a shared lunch of everything cooked.',
'4 hours', 'https://picsum.photos/seed/cookingclassvietnam/800/500', 5),

-- ============================================================
-- RAJASTHAN
-- ============================================================
('Rajasthan', 'Amber Fort Elephant Ride & Guided Tour', 'sightseeing',
'Ascend to the majestic Amber Fort on the back of a painted elephant — one of Rajasthan''s most iconic images — as you ride up the cobblestone ramp to the great Suraj Pol gateway. Built in 1592 by Raja Man Singh, the fort is a masterpiece of Rajput military architecture, its sandstone and marble palaces overlooking the Maota Lake and the surrounding Aravalli hills. The Sheesh Mahal (Palace of Mirrors) is the fort''s most breathtaking chamber — thousands of tiny convex mirrors embedded in the ceiling create the effect of a starlit sky when a single candle is lit. Evening visits are enhanced by a Sound and Light show that dramatises the fort''s history.',
'3–4 hours', 'https://picsum.photos/seed/amberfortjaipur/800/500', 1),

('Rajasthan', 'Taj Mahal Sunrise Visit', 'sightseeing',
'No description in a brochure can fully prepare you for the moment the Taj Mahal appears in real life. Arriving before dawn to secure a position at the Great Gate, you wait as the sky lightens and the white marble mausoleum — built by Emperor Shah Jahan in memory of his beloved wife Mumtaz Mahal — resolves from a ghostly silhouette into an object of breathtaking beauty. The symmetry of the main dome, the four minarets, the reflecting pool and the perfectly manicured gardens creates a composition unlike anything else on earth. The Taj changes colour with the light — pearl white at dawn, warm gold as the morning advances, and ethereal blue-white under the full moon.',
'3 hours', 'https://picsum.photos/seed/tajmahalrajasthan/800/500', 2),

('Rajasthan', 'Jaisalmer Desert Camel Safari', 'adventure',
'The Thar Desert stretches to the Pakistan border on three sides of the golden sandstone city of Jaisalmer, and a camel safari into the Sam or Khuri sand dunes is the definitive way to experience this vast, hauntingly beautiful landscape. Mounted on Rajasthani camels, the group moves in single file through a landscape of shifting dunes, thorn scrub and the occasional desert village where women in brilliant tie-dye saris draw water from ancient wells. Camp is made among the dunes at sunset, with dhurrie-laid mats, a campfire, folk musicians playing the sarangi and ravanhatta, and a simple yet delicious dal baati churma dinner under an immense canopy of desert stars.',
'Half day / Overnight', 'https://picsum.photos/seed/camelsafarirajasthan/800/500', 3),

('Rajasthan', 'Udaipur Lake Palace Boat Ride', 'leisure',
'Udaipur''s Lake Pichola is the jewel in the crown of the "City of Lakes" — a 4km-long artificial lake created in 1362, its calm waters perfectly reflecting the white marble palaces and ghats that line its shores. A boat cruise across the lake offers the finest views of the City Palace complex, the Jag Mandir island palace, and the legendary Lake Palace Hotel — appearing to float on the water like a mirage. The best time to cruise is at sunset when the marble facades turn gold, then rose, then violet as darkness falls. Dinner at a haveli restaurant overlooking the lake extends the romance of the evening.',
'1.5 hours', 'https://picsum.photos/seed/udaipurlake/800/500', 4)

ON CONFLICT (destination, name) DO UPDATE SET
  type        = EXCLUDED.type,
  description = EXCLUDED.description,
  duration    = EXCLUDED.duration,
  image_url   = EXCLUDED.image_url;

-- ============================================================
-- Fix media library — replace Pollinations AI URLs with Picsum
-- ============================================================
UPDATE media_library
SET
  url           = CONCAT('https://picsum.photos/seed/', LOWER(REGEXP_REPLACE(title, '[^a-zA-Z0-9]', '', 'g')), '/800/600'),
  thumbnail_url = CONCAT('https://picsum.photos/seed/', LOWER(REGEXP_REPLACE(title, '[^a-zA-Z0-9]', '', 'g')), '/400/300')
WHERE url LIKE '%pollinations%' OR thumbnail_url LIKE '%pollinations%';

-- ── SPECIAL INSTRUCTIONS TABLE ───────────────────────────────────────────────
-- Run this in Supabase SQL Editor to create the table and seed default templates.
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS special_instructions (
  id           SERIAL PRIMARY KEY,
  destination  TEXT,                          -- NULL = applies to any destination
  tour_type    TEXT NOT NULL DEFAULT 'General',
  title        TEXT,                          -- Short display name for the dropdown
  instruction  TEXT NOT NULL,
  sort_order   INT  DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: same instruction text shouldn't repeat for same dest+type
CREATE UNIQUE INDEX IF NOT EXISTS si_dest_type_inst_idx
  ON special_instructions (COALESCE(destination,''), tour_type, instruction);

-- ── SEED DATA ─────────────────────────────────────────────────────────────────

-- GENERAL (applies to all tours)
INSERT INTO special_instructions (destination, tour_type, title, instruction, sort_order) VALUES
(NULL, 'General', 'Validity & Quote Terms',
'This quotation is valid for 7 days from the date of issue. Prices are subject to change based on availability at the time of confirmation.', 1),
(NULL, 'General', 'Payment Terms',
'Booking confirmation requires 25% advance payment. Balance payment to be made 15 days prior to departure. Payments can be made via bank transfer or UPI.', 2),
(NULL, 'General', 'Cancellation Policy',
E'Cancellation charges applicable:\n• 30+ days before departure: 10% of total cost\n• 16–30 days: 25% of total cost\n• 8–15 days: 50% of total cost\n• 0–7 days: 100% of total cost', 3),
(NULL, 'General', 'Important Documents',
E'Please carry the following:\n• Valid Government-issued ID / Passport\n• Visa documents (if applicable)\n• Confirmed flight tickets\n• Hotel vouchers provided by us\n• Travel insurance policy copy', 4),
(NULL, 'General', 'Check-in / Check-out',
'Standard hotel check-in time is 2:00 PM and check-out is 11:00 AM. Early check-in and late check-out are subject to availability and may attract additional charges.', 5)
ON CONFLICT DO NOTHING;

-- HONEYMOON
INSERT INTO special_instructions (destination, tour_type, title, instruction, sort_order) VALUES
(NULL, 'Honeymoon', 'Room Decoration',
'Complimentary honeymoon room decoration (flower arrangement + welcome card) will be arranged on arrival. Please inform us if you have any specific preferences at least 48 hours in advance.', 1),
(NULL, 'Honeymoon', 'Candle-light Dinner',
'A special candle-light dinner can be arranged on request at most properties. Please contact our team at least 24 hours in advance to make reservations.', 2),
(NULL, 'Honeymoon', 'Privacy & Special Requests',
'As honeymooners, you may request extra privacy, pool/beach access, or in-room dining. Most resorts offer complimentary honeymoon amenities — please present your marriage certificate at check-in.', 3)
ON CONFLICT DO NOTHING;

-- FAMILY
INSERT INTO special_instructions (destination, tour_type, title, instruction, sort_order) VALUES
(NULL, 'Family', 'Child Policy',
E'Child Policy:\n• Below 5 years: Complimentary (no extra bed)\n• 5–11 years: Child rate with extra bed\n• 12 years and above: Adult rate\n\nPlease carry a copy of birth certificate for children under 12 years.', 1),
(NULL, 'Family', 'Activity Age Restrictions',
'Some adventure activities (river rafting, zip-lining, parasailing) may not be suitable for children under 12 years or guests with medical conditions. Please check activity age/health requirements before participation.', 2),
(NULL, 'Family', 'Meal & Dietary Preferences',
'Please inform us in advance of any dietary restrictions or allergies for family members, especially children. We will coordinate with hotels/restaurants to accommodate requirements wherever possible.', 3)
ON CONFLICT DO NOTHING;

-- GROUP
INSERT INTO special_instructions (destination, tour_type, title, instruction, sort_order) VALUES
(NULL, 'Group', 'Group Booking Terms',
E'Group Booking Policy:\n• Full payment required 30 days before departure\n• Minimum group size: 10 pax\n• Complimentary 1 pax for every 15 confirmed paying guests\n• Group leader is responsible for coordinating timings', 1),
(NULL, 'Group', 'Coach & Transfers',
'Seating in the group coach is on a first-come-first-served basis. Please ensure all group members report at the designated meeting point 15 minutes before departure time.', 2),
(NULL, 'Group', 'ID & Documentation',
'All group members must carry a valid government-issued photo ID throughout the tour. International groups must carry valid passports and visas. A group list with ID details will be required 7 days prior to travel.', 3)
ON CONFLICT DO NOTHING;

-- SOLO
INSERT INTO special_instructions (destination, tour_type, title, instruction, sort_order) VALUES
(NULL, 'Solo', 'Solo Traveller Safety',
E'Tips for solo travellers:\n• Always share your daily itinerary with a family member or friend\n• Keep a copy of emergency contacts and our 24×7 support number\n• Avoid isolated areas after dark\n• Register with your country''s embassy if travelling internationally', 1),
(NULL, 'Solo', 'Single Occupancy',
'This package is priced on single occupancy basis. If you wish to share accommodation to reduce costs, please let us know and we will try to arrange a suitable roommate from our group tours.', 2)
ON CONFLICT DO NOTHING;

-- ADVENTURE
INSERT INTO special_instructions (destination, tour_type, title, instruction, sort_order) VALUES
(NULL, 'Adventure', 'Health & Fitness',
'Adventure activities require reasonable physical fitness. Guests with heart conditions, high blood pressure, back problems, or pregnancy should consult a doctor before participation. Inform your guide of any medical conditions.', 1),
(NULL, 'Adventure', 'Gear & Equipment',
'All necessary safety equipment is provided. Wear comfortable, closed-toe shoes and weather-appropriate clothing. Do not carry valuables during outdoor activities. Follow all safety briefings from your guide.', 2)
ON CONFLICT DO NOTHING;

-- PILGRIMAGE
INSERT INTO special_instructions (destination, tour_type, title, instruction, sort_order) VALUES
(NULL, 'Pilgrimage', 'Dress Code & Conduct',
'Please dress modestly (covered shoulders and knees) at all religious sites. Maintain silence and respect local customs. Leather goods (belts, shoes) may not be permitted inside certain temples.', 1),
(NULL, 'Pilgrimage', 'Physical Requirements',
'Some pilgrimage routes involve walking on uneven terrain or climbing stairs. Elderly guests or those with mobility issues should inform us in advance so we can arrange special assistance or alternative routes where available.', 2)
ON CONFLICT DO NOTHING;

-- CORPORATE
INSERT INTO special_instructions (destination, tour_type, title, instruction, sort_order) VALUES
(NULL, 'Corporate', 'Corporate Booking Terms',
'Corporate rates are applicable on minimum booking of 15 pax. GST invoice will be provided. All bookings must be confirmed with a purchase order or official booking confirmation from your organisation.', 1),
(NULL, 'Corporate', 'Meeting & Event Facilities',
'Conference rooms, AV equipment, and business centre facilities can be arranged on request. Please share your requirements (room capacity, equipment list, catering preferences) at least 72 hours in advance.', 2)
ON CONFLICT DO NOTHING;

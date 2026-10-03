-- ── BEDDING TYPES TABLE ──────────────────────────────────────────────────────
-- Run in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS bedding_types (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO bedding_types (name, sort_order) VALUES
  ('Double Sharing',   1),
  ('King Bed',         2),
  ('Queen Bed',        3),
  ('Twin Bed',         4),
  ('Triple Sharing',   5),
  ('Extra Bed',        6),
  ('Extra Mattress',   7),
  ('Normal Bedding',   8)
ON CONFLICT (name) DO NOTHING;

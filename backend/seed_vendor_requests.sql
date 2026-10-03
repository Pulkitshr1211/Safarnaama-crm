-- ── VENDOR REQUESTS TABLE ────────────────────────────────────────────────────
-- Run in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS vendor_requests (
  id              TEXT PRIMARY KEY,
  lead_id         TEXT,
  lead_name       TEXT,
  lead_ref        TEXT,
  destination     TEXT,
  vendor_id       TEXT,
  vendor_name     TEXT,
  vendor_email    TEXT NOT NULL,
  subject         TEXT,
  body_sent       TEXT,
  message_id      TEXT,   -- Message-ID of our outgoing email (for reply threading)
  -- Response (populated when vendor replies)
  response_uid    TEXT,
  response_folder TEXT DEFAULT 'INBOX',
  response_from   TEXT,
  response_subject TEXT,
  response_body   TEXT,
  response_html   TEXT,
  extracted_prices JSONB DEFAULT '[]'::jsonb,
  original_price  NUMERIC,
  -- Markup applied when forwarding to employee
  markup_type     TEXT DEFAULT 'percent',  -- 'percent' or 'flat'
  markup_value    NUMERIC DEFAULT 0,
  final_price     NUMERIC,
  -- Tracking
  status          TEXT DEFAULT 'sent',     -- sent | received | forwarded
  forwarded_to    TEXT,
  forwarded_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  received_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Add default markup columns to vendors table
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS markup_type  TEXT    DEFAULT 'percent';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS markup_value NUMERIC DEFAULT 0;

-- Add currency column (for multi-currency price extraction)
ALTER TABLE vendor_requests ADD COLUMN IF NOT EXISTS extracted_currency TEXT DEFAULT 'INR';

-- Add notification tracking column (prevents duplicate "no reply" alerts)
ALTER TABLE vendor_requests ADD COLUMN IF NOT EXISTS notif_sent_at TIMESTAMPTZ;

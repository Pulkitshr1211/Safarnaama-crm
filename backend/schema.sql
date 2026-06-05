-- ============================================================
-- SAFARNAAMA HOLIDAYS CRM — SUPABASE DATABASE SCHEMA
-- Run in: Supabase SQL Editor → New Query → Run
-- ============================================================

-- ─── LEADS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id            TEXT PRIMARY KEY,            -- e.g. "L123456"
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  destination   TEXT,
  travel_date   DATE,
  pax           INTEGER DEFAULT 1,
  kids          INTEGER DEFAULT 0,
  budget        NUMERIC(12,2),
  status        TEXT DEFAULT 'New',          -- New | Quote Sent | Confirmed | Cancelled
  source        TEXT,                         -- Website | Walk-in | Referral | ...
  notes         TEXT,
  assigned_to   TEXT,                         -- user id
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_status_idx      ON leads(status);
CREATE INDEX IF NOT EXISTS leads_travel_date_idx ON leads(travel_date);

-- ─── VENDORS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id            TEXT PRIMARY KEY,            -- e.g. "V123456"
  name          TEXT NOT NULL,
  category      TEXT,                         -- Hotel | Transport | Tour Operator | ...
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  city          TEXT,
  rating        NUMERIC(2,1),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── VENDOR PACKAGES / DOCUMENTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_packages (
  id            TEXT PRIMARY KEY,
  vendor_id     TEXT REFERENCES vendors(id) ON DELETE CASCADE,
  name          TEXT,
  destination   TEXT,
  hotel_name    TEXT,
  room_type     TEXT,
  per_person_cost NUMERIC(12,2),
  total_cost    NUMERIC(12,2),
  pax           INTEGER,
  inclusions    TEXT[],
  valid_till    DATE,
  raw_text      TEXT,                         -- extracted doc text
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── QUOTES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id            TEXT PRIMARY KEY,            -- e.g. "QC-2506-1234"
  lead_id       TEXT REFERENCES leads(id),
  vendor_id     TEXT REFERENCES vendors(id),
  status        TEXT DEFAULT 'Draft',        -- Draft | Sent | Replied | Accepted
  destination   TEXT,
  travel_date   DATE,
  pax           INTEGER,
  adults        INTEGER,
  kids          INTEGER DEFAULT 0,
  hotel         TEXT,
  room_type     TEXT,
  hotel_rating  TEXT,
  inclusions    TEXT[],
  body_text     TEXT,                         -- full email body sent to vendor
  markup_pct    NUMERIC(5,2),
  base_cost     NUMERIC(12,2),
  final_cost    NUMERIC(12,2),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INVOICES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,            -- e.g. "INV-2506-1234"
  lead_id       TEXT REFERENCES leads(id),
  client_name   TEXT,
  destination   TEXT,
  travel_date   DATE,
  adults        INTEGER,
  kids          INTEGER DEFAULT 0,
  hotel         TEXT,
  inclusions    TEXT[],
  base_amount   NUMERIC(12,2),
  gst_amount    NUMERIC(12,2),
  total_amount  NUMERIC(12,2),
  advance_paid  NUMERIC(12,2) DEFAULT 0,
  balance_due   NUMERIC(12,2),
  status        TEXT DEFAULT 'Draft',        -- Draft | Sent | Paid
  due_date      DATE,
  paid_date     DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);

-- ─── VOUCHERS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vouchers (
  id            TEXT PRIMARY KEY,            -- e.g. "VCH123456"
  voucher_no    TEXT UNIQUE,
  lead_id       TEXT REFERENCES leads(id),
  client_name   TEXT,
  destination   TEXT,
  travel_date   DATE,
  return_date   DATE,
  adults        INTEGER,
  kids          INTEGER DEFAULT 0,
  hotel         TEXT,
  room_type     TEXT,
  inclusions    TEXT[],
  special_notes TEXT,
  emergency_contact TEXT,
  status        TEXT DEFAULT 'Active',       -- Active | Used | Cancelled
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── EMAIL LOG ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_log (
  id            BIGSERIAL PRIMARY KEY,
  direction     TEXT DEFAULT 'outbound',     -- outbound | inbound
  from_addr     TEXT,
  to_addrs      TEXT[],
  subject       TEXT,
  body          TEXT,
  query_code    TEXT,
  lead_id       TEXT REFERENCES leads(id),
  vendor_id     TEXT REFERENCES vendors(id),
  sendgrid_id   TEXT,
  status        TEXT DEFAULT 'pending',      -- pending | sent | failed
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id            BIGSERIAL PRIMARY KEY,
  type          TEXT DEFAULT 'info',         -- info | success | warning | error
  message       TEXT NOT NULL,
  read          BOOLEAN DEFAULT FALSE,
  user_id       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── APP SETTINGS ─────────────────────────────────────────────────────────────
-- Stores JSON blobs keyed by name (e.g. "markup", "company", "smtp")
CREATE TABLE IF NOT EXISTS app_settings (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Default markup settings
INSERT INTO app_settings (key, value) VALUES
  ('markup',  '{"star3":18,"star4":22,"transport":15,"activities":20}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value) VALUES
  ('company', '{"name":"Safarnaama Holidays","email":"enquiry@SafarnaamaHolidays.com","phone":"+91-9999999999","address":""}')
ON CONFLICT (key) DO NOTHING;

-- ─── TASKS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  task_title    TEXT NOT NULL,
  description   TEXT,
  assigned_to   TEXT,                         -- user id
  assigned_user_name TEXT,
  due_date      DATE,
  priority      TEXT DEFAULT 'Medium',       -- Low | Medium | High
  status        TEXT DEFAULT 'Open',         -- Open | In Progress | Done
  lead_id       TEXT REFERENCES leads(id),
  lead_name     TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── USERS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  role          TEXT DEFAULT 'User',
  status        TEXT DEFAULT 'Active',       -- Active | Inactive
  password_hash TEXT,                         -- bcrypt hash (optional — for future auth)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ROLES ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_roles (
  id            TEXT PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,
  description   TEXT,
  permissions   TEXT[],                       -- array of permission ids
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── WHITE-LABEL PORTALS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_configs (
  id             TEXT PRIMARY KEY,            -- e.g. "WL123456"
  company_name   TEXT NOT NULL,
  tagline        TEXT,
  logo_url       TEXT,
  primary_color  TEXT DEFAULT '#1A6B8A',
  accent_color   TEXT DEFAULT '#4FC3F7',
  bg_color       TEXT DEFAULT '#F6F8FC',
  text_color     TEXT DEFAULT '#0F172A',
  contact_email  TEXT,
  admin_name     TEXT,
  admin_email    TEXT,
  modules        TEXT[],
  powered_by     BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ROW LEVEL SECURITY (recommended for production) ─────────────────────────
-- Enable RLS on sensitive tables and add appropriate policies.
-- For a service_role client the following is not strictly required,
-- but is recommended as defence-in-depth.

-- ALTER TABLE leads        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE invoices     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE crm_users    ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE portal_configs ENABLE ROW LEVEL SECURITY;

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$
DECLARE tbl TEXT;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['leads','vendors','quotes','invoices','tasks','crm_users','portal_configs']
 LOOP
  EXECUTE format(
   'DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;
    CREATE TRIGGER trg_%I_updated_at
    BEFORE UPDATE ON %I
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
   tbl, tbl, tbl, tbl
  );
 END LOOP;
END;
$$;

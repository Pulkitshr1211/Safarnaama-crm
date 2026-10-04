-- ============================================================
-- SAFARNAAMA CRM — DATABASE MIGRATION
-- Run in: Supabase SQL Editor → New Query → Run
-- Safe to re-run (uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS)
-- ============================================================

-- ── ITINERARIES: add missing columns ──────────────────────────────────────────
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS cover_image_url    TEXT;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS tour_type          TEXT;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS city               TEXT;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS version            INTEGER DEFAULT 1;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS special_instructions TEXT;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS option1_title      TEXT;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS option2_enabled    BOOLEAN DEFAULT FALSE;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS option2_title      TEXT;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS option2_hotels     JSONB DEFAULT '[]';
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS option2_price      NUMERIC(12,2) DEFAULT 0;
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS option2_inclusions JSONB DEFAULT '[]';
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS option2_exclusions JSONB DEFAULT '[]';
ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();

-- ── VOUCHERS: add missing columns (Package voucher + general) ─────────────────
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS package_title TEXT;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS duration      TEXT;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS activities    TEXT;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS exclusions    JSONB DEFAULT '[]';
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS flight_date   TEXT;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS pax           INTEGER DEFAULT 1;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT NOW();

-- ── CRM USERS & ROLES (from seed_users.sql, safe to re-run) ──────────────────
CREATE TABLE IF NOT EXISTS crm_roles (
  id          TEXT PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions TEXT[],
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  role          TEXT DEFAULT 'Agent',
  status        TEXT DEFAULT 'Active',
  password_hash TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── DEFAULT ROLES (seed) ──────────────────────────────────────────────────────
INSERT INTO crm_roles (id, name, description, permissions) VALUES
('R001', 'Admin',   'Full access to all modules',
 ARRAY['leads','quotes','invoices','vouchers','vendors','tasks','assign_task','users','roles','chat','settings','whitelabel','itinerary']),
('R002', 'Manager', 'Manage leads, quotes, invoices and team tasks',
 ARRAY['leads','quotes','invoices','vouchers','vendors','tasks','assign_task','chat','itinerary']),
('R003', 'Agent',   'Handle assigned leads, tasks and itineraries',
 ARRAY['leads','tasks','quotes','chat','itinerary']),
('R004', 'Viewer',  'Read-only access to leads and quotes',
 ARRAY['leads','quotes'])
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions;

-- ── DEFAULT USERS (seed) ─────────────────────────────────────────────────────
INSERT INTO crm_users (id, name, email, role, status) VALUES
('U001', 'Admin',  'operations@safarnaamaholidays.com', 'Admin',   'Active'),
('U002', 'Priya',  'priya@SafarnaamaHolidays.com',      'Manager', 'Active'),
('U003', 'Arjun',  'arjun@SafarnaamaHolidays.com',      'Agent',   'Active')
ON CONFLICT (id) DO UPDATE SET
  name   = EXCLUDED.name,
  email  = EXCLUDED.email,
  role   = EXCLUDED.role,
  status = EXCLUDED.status;

-- ── VENDORS: extended columns ────────────────────────────────────────────────
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_code      TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_person   TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone2           TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS website          TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS city             TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS country          TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS services         TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS hotel_properties TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS commission       NUMERIC(5,2);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS notes            TEXT;

-- ── LEAD DOCUMENTS ───────────────────────────────────────────────────────────
-- Tracks document metadata; actual files live in Supabase Storage bucket "lead-docs"
CREATE TABLE IF NOT EXISTS lead_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      TEXT REFERENCES leads(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  original_name TEXT,
  file_type    TEXT,
  doc_type     TEXT DEFAULT 'other',
  storage_path TEXT NOT NULL,
  file_size    INTEGER DEFAULT 0,
  uploaded_by  TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_documents_lead_id ON lead_documents(lead_id);

-- ── VERIFY ────────────────────────────────────────────────────────────────────
-- ── AUTH: add password + temp-password columns to crm_users ─────────────────
ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS password_hash      TEXT;
ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS password_salt      TEXT;
ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS temp_password_hash TEXT;
ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS temp_password_salt TEXT;

SELECT 'itineraries' as tbl, COUNT(*) as rows FROM itineraries
UNION ALL SELECT 'vouchers',    COUNT(*) FROM vouchers
UNION ALL SELECT 'crm_roles',   COUNT(*) FROM crm_roles
UNION ALL SELECT 'crm_users',   COUNT(*) FROM crm_users
UNION ALL SELECT 'vendors',     COUNT(*) FROM vendors;

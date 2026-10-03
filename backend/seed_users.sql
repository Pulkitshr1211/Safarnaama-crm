-- ============================================================
-- SAFARNAAMA CRM — DEFAULT ROLES & USERS SEED
-- Run in: Supabase SQL Editor → New Query → Run
-- Safe to re-run (uses ON CONFLICT DO UPDATE)
-- ============================================================

-- ─── 1. CREATE TABLES IF NOT EXISTS ─────────────────────────────────────────
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

-- ─── 2. DEFAULT ROLES ────────────────────────────────────────────────────────
INSERT INTO crm_roles (id, name, description, permissions) VALUES

('R001', 'Admin', 'Full access to all modules',
 ARRAY['leads','quotes','invoices','vouchers','vendors','tasks','assign_task','users','roles','chat','settings','whitelabel','itinerary']),

('R002', 'Manager', 'Manage leads, quotes, invoices and team tasks',
 ARRAY['leads','quotes','invoices','vouchers','vendors','tasks','assign_task','chat','itinerary']),

('R003', 'Agent', 'Handle assigned leads, tasks and itineraries',
 ARRAY['leads','tasks','quotes','chat','itinerary']),

('R004', 'Viewer', 'Read-only access to leads and quotes',
 ARRAY['leads','quotes'])

ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions;

-- ─── 3. DEFAULT USERS ────────────────────────────────────────────────────────
INSERT INTO crm_users (id, name, email, role, status) VALUES

('U001', 'Admin User',  'enquiry@SafarnaamaHolidays.com', 'Admin',   'Active'),
('U002', 'Priya',       'priya@SafarnaamaHolidays.com',   'Manager', 'Active'),
('U003', 'Arjun',       'arjun@SafarnaamaHolidays.com',   'Agent',   'Active')

ON CONFLICT (id) DO UPDATE SET
  name   = EXCLUDED.name,
  email  = EXCLUDED.email,
  role   = EXCLUDED.role,
  status = EXCLUDED.status;

-- ─── 4. VERIFY ───────────────────────────────────────────────────────────────
SELECT 'crm_roles' as tbl, id, name, array_length(permissions,1)::TEXT as detail FROM crm_roles
UNION ALL
SELECT 'crm_users', id, name, role FROM crm_users
ORDER BY tbl, id;

# Safarnaama CRM — Deployment Guide
# Live URL: https://crm.safarnaamaholidays.com

## Overview

- **Backend + Frontend** → Railway (Node.js server that also serves the React build)
- **Domain** → CNAME in cPanel: `crm` → Railway app URL
- **SSL** → Automatic via Railway (Let's Encrypt)
- **Database** → Supabase (already cloud-hosted, no change)

---

## Step 1 — Push your code to GitHub

If you haven't already:

1. Go to https://github.com → **New repository** → name it `safarnaama-crm` → **Private** → Create
2. In your project folder, open a terminal and run:

```bash
git remote add origin https://github.com/YOUR_USERNAME/safarnaama-crm.git
git branch -M main
git push -u origin main
```

Make sure `backend/.env` is NOT committed (it's in `.gitignore` ✓).

---

## Step 2 — Deploy to Railway

### 2a. Create a Railway account

Go to **https://railway.app** → Sign in with GitHub

### 2b. Create a new project

1. Click **New Project**
2. Select **Deploy from GitHub repo**
3. Choose your `safarnaama-crm` repo
4. When asked for root directory → type **`backend`**
5. Railway detects Node.js automatically

### 2c. Configure build settings

In Railway → your service → **Settings** tab:

| Setting | Value |
|---|---|
| **Root Directory** | `backend` |
| **Build Command** | `npm run build` |
| **Start Command** | `node server.js` |

> `npm run build` inside `backend/` runs `cd ../frontend && npm install && npm run build`
> which compiles React into `frontend/build/` — then Express serves it in production.

### 2d. Add Environment Variables

In Railway → your service → **Variables** tab, add every variable below.
Copy the values from your local `backend/.env` file.

**Required:**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ANTHROPIC_API_KEY` | your Claude API key |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | your Supabase service_role key |
| `FRONTEND_URL` | `https://crm.safarnaamaholidays.com` |
| `INBOUND_WEBHOOK_SECRET` | any random string (e.g. `saf2024xK9mP`) |

**TripJack:**

| Variable | Value |
|---|---|
| `TRIPJACK_API_KEY` | your TripJack API key |
| `TRIPJACK_ENV` | `test` (change to `production` when going live with real bookings) |

**Email (optional but recommended):**

| Variable | Value |
|---|---|
| `SENDGRID_API_KEY` | your SendGrid key |
| `ENQUIRY_EMAIL` | enquiry@safarnaamaholidays.com |
| `ADMIN_EMAIL` | admin@safarnaamaholidays.com |

**Amadeus flights (optional):**

| Variable | Value |
|---|---|
| `AMADEUS_CLIENT_ID` | your Amadeus client ID |
| `AMADEUS_CLIENT_SECRET` | your Amadeus client secret |
| `AMADEUS_ENV` | `test` |

> Do NOT set `PORT` — Railway sets it automatically.

### 2e. Deploy

Click **Deploy** (or it auto-deploys on push). Watch the build logs.
A successful build ends with:
```
Safarnaama CRM API running on port XXXX
Supabase: configured ✓
```

Your app is now live at a Railway URL like:
`https://safarnaama-crm-production.up.railway.app`

---

## Step 3 — Add Custom Domain on Railway

1. In Railway → your service → **Settings** → **Networking** → **Custom Domain**
2. Click **+ Add Custom Domain**
3. Enter: `crm.safarnaamaholidays.com`
4. Railway shows you a CNAME target like:
   `safarnaama-crm-production.up.railway.app`
   
   **Copy this value — you need it in Step 4.**

---

## Step 4 — Add CNAME in cPanel (Shared Hosting)

1. Log into your hosting control panel (cPanel)
2. Go to **Domains** → **Zone Editor** (or **DNS Zone Editor**)
3. Find `safarnaamaholidays.com` → click **Manage**
4. Click **+ Add Record** and fill in:

| Field | Value |
|---|---|
| **Type** | `CNAME` |
| **Name** | `crm` |
| **Record / Points to** | `safarnaama-crm-production.up.railway.app` (the value from Step 3) |
| **TTL** | `3600` (or Auto) |

5. Save the record.

> DNS propagation takes 5–30 minutes. You can check at https://dnschecker.org — search for `crm.safarnaamaholidays.com`

---

## Step 5 — Verify SSL

Railway auto-provisions a Let's Encrypt SSL certificate once the CNAME is detected.
This usually takes 2–5 minutes after DNS propagates.

Visit **https://crm.safarnaamaholidays.com** — you should see the Safarnaama CRM login.

---

## Step 6 — Run the SQL Migration (first deploy only)

If not already done: Go to **Supabase → SQL Editor → New Query**, paste the contents of `backend/seed_migration.sql` and click **Run**.

---

## Going Live with TripJack (production bookings)

When you're ready to take real bookings:
1. Contact TripJack to activate your **production API key**
2. In Railway Variables, update:
   - `TRIPJACK_API_KEY` → production key
   - `TRIPJACK_ENV` → `production`
3. Redeploy

---

## Re-deploying After Code Changes

Every `git push origin main` automatically triggers a new Railway build and redeploy.
Zero downtime — Railway swaps the new version in once it's ready.

```bash
git add .
git commit -m "your change description"
git push origin main
# Railway picks it up automatically
```

---

## Local Development (unchanged)

```bash
# Terminal 1 — Backend
cd backend
node server.js          # runs on port 3002

# Terminal 2 — Frontend
cd frontend
npm start               # runs on port 3000 (proxies /api → port 3002)
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Build fails | Check Railway build logs — usually a missing `npm install` or env var |
| White screen | Check browser console — likely a missing env var or API error |
| `crm.` domain not working | Wait 30 min for DNS, check CNAME at dnschecker.org |
| API calls failing | Check Railway → **Logs** tab for backend errors |
| Supabase errors | Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are correct |

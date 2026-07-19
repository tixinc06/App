# Tracker — Reselling & Fitness PWA

A single installable web app (PWA) to track reselling inventory & profit, food macros,
and workouts. Plain HTML/CSS/JS + Supabase (auth + database). No build step.

## Features (v1)
- **Reselling** — inventory with cost/status/photo, log sales, auto profit & ROI dashboard.
- **Food** — reusable food library + daily log with calorie/macro totals.
- **Fitness** — workouts (exercises & sets) + bodyweight tracking.
- Private per-user accounts (email + password). Everyone sees only their own data.

## One-time setup

### 1. Create a Supabase project
1. Go to [supabase.com](https://supabase.com) → **New project** (free tier is fine).
2. When it's ready, open **SQL Editor → New query**, paste all of [`schema.sql`](schema.sql), and **Run**.
   This creates the tables, security policies, and the photo storage bucket.
3. (Optional, for easy signups) **Authentication → Providers → Email** → turn **off**
   "Confirm email" so you and your friends can log in immediately without email confirmation.

### 2. Connect the app
1. In Supabase: **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
2. Open [`js/config.js`](js/config.js) and paste them into `SUPABASE_URL` and `SUPABASE_ANON`.
   > The anon key is safe to ship in client code — Row-Level Security (from `schema.sql`) is what protects your data.

### 3. Run it
This app uses ES modules + a service worker, so it must be served over **http**, not opened
as a `file://` double-click. Use the deploy step below, or any static server.

## Deploy to Vercel (free)
1. `git init` in this folder, commit, and push to a new **GitHub** repo.
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.
3. Framework preset: **Other**. No build command, output = the repo root. Click **Deploy**.
4. Open the live URL on your phone → browser menu → **Add to Home Screen**. It installs like an app.

## Adding more people
Each person just opens the URL and taps **Create an account**. Their data is completely
separate from yours.

## Project layout
```
index.html        app shell (header, tab bar, view container)
css/styles.css    theme + components
js/config.js      ← paste your Supabase URL + anon key here
js/supabase.js    Supabase client
js/auth.js        login / signup / session
js/ui.js          shared helpers (DOM, modals, toasts, formatting)
js/resell.js      reselling view
js/food.js        food view
js/fitness.js     fitness view
js/app.js         bootstrap + tab routing
schema.sql        run once in Supabase SQL Editor
manifest.json     PWA manifest
sw.js             service worker (offline shell)
```

## Coming later (not in v1)
Goals/targets, sharing with friends, shared "duo" reselling, charts.

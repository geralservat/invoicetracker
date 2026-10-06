# Invoice Tracking — PWA (for iPhones, no Mac / no App Store needed)

Phone-friendly web app on the same Supabase backend as the planned mobile
future. Android (`app/`) and iOS scaffold (`ios/`) are untouched.

## Before sharing the link (Supabase dashboard, once)

1. SQL Editor → run `supabase/03_harden_profiles.sql` (blocks self-promotion
   to ADMIN — mandatory now that the anon key ships in a client).
2. Authentication → Providers → Email → disable **Allow new users to sign up**
   (accounts are created by you in Authentication → Users, then linked with
   `supabase/link_auth_users.sql`).

## Publish (pick one, all free, browser-only)

- **Netlify Drop:** drag the `web/` folder onto app.netlify.com/drop → live
  URL in seconds. Free, HTTPS included (required for installability).
- **Cloudflare Pages:** dash.cloudflare.com → Pages → Upload assets → drop
  `web/`.
- **GitHub Pages:** push `web/` to a repo → Settings → Pages → deploy.

Then send Marcela, Deepesh and Mohan the URL.

## Install on iPhone

Open the link in Safari → Share → **Add to Home Screen** → opens fullscreen
with its own icon, just like a native app. (Android/Chrome users get an
automatic Install prompt instead.) Requires internet on first open; the app
shell then works offline, data needs connection.

## What it does (core slice, same rules as Android)

Login (Supabase email+password) → Dashboard (outstanding, overdue,
collected-this-month + collections by month for the last 6) → Invoices
(search, role-filtered) → Invoice detail (terms incl. Consignation, payments)
→ Record Payment (amount, **date** — monthly allocation follows it, method,
reference; CLEARED-only recalc, consignation never overdue).

## Dev notes

- `logic.js` holds all pure rules and is unit-tested:
  `node /tmp/test_logic.mjs` (kept outside the repo).
- No build step. Static files only; Supabase client loads from CDN
  (needs internet at first load — login needs it anyway).
- Strict RLS scopes everything server-side; the UI additionally filters by
  role exactly like Android's DashboardViewModel.
- ⚠️ Split-brain reminder: Android still lives in Google Sheets. Until its
  data layer moves to Supabase, phone entries won't appear on Android.

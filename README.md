# Migrate

A web-based rental listing platform connecting students of **Presbyterian University of East Africa** to vacant houses in **Thogoto and Kikuyu**, Kenya. Students browse, filter, save favourites and contact landlords; landlords and agents post and manage listings; administrators moderate. Payments, leases and in-app chat are out of scope for the first release.

## Stack

Static HTML5 / CSS3 / vanilla JavaScript front end, Supabase (Auth, Postgres, Storage) back end, Google Maps for maps (OpenStreetMap/Leaflet fallback when no key is set). There is no build step. The existing architecture already matched the proposal, so it was kept rather than rewritten.

## Run locally

Prerequisites: Node 18+.

```bash
npm install        # dev dependency only: jsdom, used by the tests
npm start          # static dev server on http://localhost:8080
npm test           # 37 page/logic tests (jsdom + in-memory fake Supabase)
```

## Configuration

| Setting | Where | Public? |
|---|---|---|
| Supabase URL and **publishable** key | `js/supabaseClient.js` | Public by design; Row Level Security is the protection |
| Google Maps API key | `js/config.js` → `GOOGLE_MAPS_API_KEY` | Public in the browser, so **restrict it** in Google Cloud Console to your site's HTTP referrers and the Maps JavaScript API only |
| Campus coordinates | `js/config.js` → `CAMPUS` | Public. Verify against the real gate location |

Never put the Supabase **service-role** key in this repository or in any browser file. If it was ever committed, rotate it.

## Database

`supabase/migrations/20261027000000_migrate_overhaul.sql` adds moderation status, constraints, indexes, the favourites uniqueness constraint, role-protection triggers, Row Level Security policies and the `property-images` storage bucket policies. It is idempotent and backward compatible (existing listings are backfilled as `approved`). It was applied to the live project on 2026-10-29 (the project had 1 profile and 0 listings at the time), together with a small hardening step that revokes API access to trigger functions. For any other environment, back up first (Dashboard → Database → Backups), then run it in the SQL editor.

Create the first administrator manually (never from the app):

```sql
update public.profiles set role = 'admin' where id = '<auth user uuid>';
```

Rollback: new columns can be dropped and the previous policies re-created from your backup/dump.

## Database tests

`tests/db/run.sh` applies the migration twice to a throwaway local Postgres (with a Supabase stub) and runs 53 RLS/constraint/storage checks:

```bash
PGHOST=<socket dir> PGPORT=<port> PGUSER=<user> tests/db/run.sh
```

These prove the policies as written, not the behaviour of the real hosted project.

## Deployment

Any static host works (Netlify, Vercel, GitHub Pages). Add a `Sitemap:` line to `robots.txt` with your real domain. In Supabase Auth settings, set the Site URL and redirect URLs to the deployed domain.

## Known limitations

- The live database security rules were tested directly in SQL (13 role-impersonation checks, rolled back). Registration, login, photo upload and the browser journeys have not been tested end to end against the live API.
- Turn on leaked-password protection in the Supabase dashboard (Auth → Passwords).
- Google Maps has not been tested with a real key; the OpenStreetMap fallback is used until one is configured.
- Distances are straight-line (Haversine), not road distance, and are labelled that way.
- Listings are moderated but landlords are **not** independently verified; the site makes no verification claim.
- No sitemap yet (needs the production domain); `supabase-js` is loaded from a pinned CDN version.

# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Email the maintainer
(see the GitHub profile) or use GitHub's "Report a vulnerability" button on the
Security tab. Expect an acknowledgement within a few days.

## Design notes

- The browser only ever holds the Supabase **publishable** key. Authorization is
  enforced by Postgres Row Level Security, not by the UI.
- Roles are protected by database triggers; administrators are created manually
  in SQL, never from the app.
- The service-role key must never be committed. If one ever was, rotate it.

// The publishable (anon) key is meant to be public: Row Level Security controls what it can do.
// NEVER place the service-role key in browser code.
const SUPABASE_URL = "https://rrfbejmlxirzmiohhpee.supabase.co";
const SUPABASE_KEY = "sb_publishable_tqtyvmstwqg708gsIg4P9Q_J4i0gyzL";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Shared helpers come from js/lib.js (also unit tested in Node).
const { PROPERTY_TYPES, esc, formatKES } = MigrateLib;
const CAMPUS = (window.MIGRATE_CONFIG && window.MIGRATE_CONFIG.CAMPUS) || MigrateLib.CAMPUS;

// Current user + profile, fetched once per page.
let _me;
async function getMe() {
  if (_me) return _me;
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return (_me = { user: null, profile: null, role: null });
    const { data: profile } = await db.from("profiles").select("full_name,phone,role").eq("id", session.user.id).maybeSingle();
    return (_me = { user: session.user, profile, role: profile?.role || "student" });
  } catch (e) {
    return (_me = { user: null, profile: null, role: null, error: true });
  }
}
const friendlyError = (e) => {
  const m = String(e?.message || e || "");
  if (/failed to fetch|network|load failed/i.test(m)) return "Network problem. Check your connection and try again.";
  if (/jwt|expired|not authenticated/i.test(m)) return "Your session has expired. Please log in again.";
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
  return "Something went wrong. Please try again.";
};
// Show per-field validation errors next to their inputs (ids are `${prefix}${key}`; errors go to `${prefix}${key}-err`).
function showFieldErrors(prefix, errors) {
  document.querySelectorAll(`[id^="${prefix}"][id$="-err"]`).forEach((n) => { n.textContent = ""; });
  document.querySelectorAll(`[id^="${prefix}"][aria-invalid]`).forEach((n) => n.removeAttribute("aria-invalid"));
  let first = null;
  for (const [k, msg] of Object.entries(errors)) {
    const input = document.getElementById(prefix + k), out = document.getElementById(`${prefix}${k}-err`);
    if (out) out.textContent = msg;
    if (input) { input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", `${prefix}${k}-err`); first = first || input; }
  }
  if (first) first.focus();
  return !first;
}

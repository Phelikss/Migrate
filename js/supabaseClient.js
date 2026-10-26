// Publishable key is safe in the browser: Row Level Security controls access.
const SUPABASE_URL = "https://rrfbejmlxirzmiohhpee.supabase.co";
const SUPABASE_KEY = "sb_publishable_tqtyvmstwqg708gsIg4P9Q_J4i0gyzL";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const PROPERTY_TYPES = {
  bedsitter: "Bedsitter", single_room: "Single room", one_bedroom: "1 bedroom",
  two_bedroom: "2 bedroom", shared: "Shared", hostel: "Hostel",
};
const formatKES = (n) => "KES " + Number(n).toLocaleString("en-KE");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 0712345678 or +254712345678 -> 254712345678 (wa.me needs the country code)
const waNumber = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.startsWith("0") ? "254" + d.slice(1) : d; };
// Thogoto campus, default map centre
const CAMPUS = { lat: -1.2196, lng: 36.6676 };

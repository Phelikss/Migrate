/* Migrate shared pure logic: validation, distance, filtering, sorting.
   Works in the browser (window.MigrateLib) and in Node (module.exports) so it can be unit tested. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MigrateLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const PROPERTY_TYPES = {
    bedsitter: "Bedsitter", single_room: "Single room", one_bedroom: "1 bedroom",
    two_bedroom: "2 bedroom", shared: "Shared", hostel: "Hostel", other: "Other",
  };
  const CAMPUS = { lat: -1.2196, lng: 36.6676 }; // Presbyterian University of East Africa, Thogoto (approximate)
  const LIMITS = { descMax: 1000, maxImageBytes: 5 * 1024 * 1024, maxImages: 8 };
  const PAGE_SIZE = 12;

  // ---- formatting -------------------------------------------------------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const formatKES = (n) => "KES " + Number(n).toLocaleString("en-KE");

  // ---- phone ------------------------------------------------------------
  // Accepts 07XXXXXXXX, 01XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX (spaces/dashes ignored).
  function normalizeKenyanPhone(input) {
    const d = String(input ?? "").replace(/[\s\-()]/g, "");
    let m = d.match(/^(?:\+?254|0)([17]\d{8})$/);
    return m ? "254" + m[1] : null;
  }
  const isValidKenyanPhone = (p) => normalizeKenyanPhone(p) !== null;
  const telHref = (p) => { const n = normalizeKenyanPhone(p); return n ? "tel:+" + n : ""; };
  const waHref = (p, text) => { const n = normalizeKenyanPhone(p); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text || "")}` : ""; };

  // ---- validation -------------------------------------------------------
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function validateSignup(v) {
    const e = {};
    const name = String(v.name ?? "").trim();
    if (!name) e.name = "Enter your full name.";
    else if (name.length < 2 || name.length > 60) e.name = "Name must be 2 to 60 characters.";
    if (!String(v.email ?? "").trim()) e.email = "Enter your email address.";
    else if (!EMAIL_RE.test(String(v.email).trim())) e.email = "Enter a valid email address.";
    if (!String(v.phone ?? "").trim()) e.phone = "Enter your phone number.";
    else if (!isValidKenyanPhone(v.phone)) e.phone = "Use a Kenyan number like 0712345678 or +254712345678.";
    if (!["student", "landlord"].includes(v.role)) e.role = "Choose Student or Landlord / Agent.";
    if (!v.password) e.password = "Enter a password.";
    else if (v.password.length < 8) e.password = "Password must be at least 8 characters.";
    if (v.password && v.confirm !== v.password) e.confirm = "Passwords do not match.";
    return e;
  }

  function validateListing(v, imageCount) {
    const e = {};
    if (!String(v.title ?? "").trim()) e.title = "Enter a title.";
    else if (String(v.title).trim().length > 120) e.title = "Keep the title under 120 characters.";
    const desc = String(v.description ?? "").trim();
    if (!desc) e.description = "Enter a description.";
    else if (desc.length > LIMITS.descMax) e.description = `Description must be ${LIMITS.descMax} characters or fewer (now ${desc.length}).`;
    const rent = Number(v.rent);
    if (v.rent === "" || v.rent == null || !Number.isFinite(rent) || rent <= 0) e.rent = "Monthly rent must be greater than zero.";
    if (!PROPERTY_TYPES[v.property_type]) e.property_type = "Choose a house type.";
    const beds = v.bedrooms === "" || v.bedrooms == null ? NaN : Number(v.bedrooms);
    if (!Number.isInteger(beds) || beds < 0) e.bedrooms = "Bedrooms must be 0 or more (use 0 for a bedsitter).";
    if (!String(v.area ?? "").trim()) e.area = "Enter the area or neighbourhood.";
    if (!String(v.contact_phone ?? "").trim()) e.contact_phone = "Enter a contact phone number.";
    else if (!isValidKenyanPhone(v.contact_phone)) e.contact_phone = "Use a Kenyan number like 0712345678.";
    const hasLat = v.latitude !== "" && v.latitude != null, hasLng = v.longitude !== "" && v.longitude != null;
    if (hasLat !== hasLng) e.latitude = "Enter both latitude and longitude, or leave both empty.";
    else if (hasLat) {
      const la = Number(v.latitude), lo = Number(v.longitude);
      if (!Number.isFinite(la) || la < -90 || la > 90) e.latitude = "Latitude must be between -90 and 90.";
      else if (!Number.isFinite(lo) || lo < -180 || lo > 180) e.latitude = "Longitude must be between -180 and 180.";
    }
    if (imageCount < 1) e.photos = "Add at least one photo.";
    else if (imageCount > LIMITS.maxImages) e.photos = `Add at most ${LIMITS.maxImages} photos.`;
    return e;
  }

  // Detect the real image type from the first bytes (do not trust the file extension / MIME the browser reports).
  function sniffImageType(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
    return null;
  }
  function validateImageMeta(size, sniffedType) {
    if (!sniffedType) return "Only JPG, PNG or WebP photos are allowed.";
    if (size > LIMITS.maxImageBytes) return `Each photo must be under ${LIMITS.maxImageBytes / 1048576} MB.`;
    if (size === 0) return "This file is empty.";
    return null;
  }

  // ---- distance ---------------------------------------------------------
  // Straight-line (great-circle) distance in km via the Haversine formula. NOT road distance.
  function haversineKm(a, b) {
    const R = 6371.0088, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function distanceFromCampus(p, campus = CAMPUS) {
    if (p == null || p.latitude == null || p.longitude == null || p.latitude === "" || p.longitude === "") return null;
    const la = Number(p.latitude), lo = Number(p.longitude);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    return haversineKm(campus, { lat: la, lng: lo });
  }
  const formatKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

  // ---- filtering & sorting ---------------------------------------------
  // filters: {q, minRent, maxRent, type, beds ('' | '0' | '1' | '2' | '3+'), maxKm, sort}
  const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  function matchesSearch(p, q) {
    const terms = norm(q).split(" ").filter(Boolean);
    if (!terms.length) return true;
    const hay = norm([p.title, p.area, p.location, p.description].join(" "));
    return terms.every((t) => hay.includes(t));
  }
  function applyFilters(rows, f) {
    const min = f.minRent === "" || f.minRent == null ? null : Number(f.minRent);
    const max = f.maxRent === "" || f.maxRent == null ? null : Number(f.maxRent);
    const maxKm = f.maxKm === "" || f.maxKm == null ? null : Number(f.maxKm);
    return rows.filter((p) => {
      if (p.moderation_status !== undefined && p.moderation_status !== "approved") return false;
      if (p.status !== undefined && p.status !== "Available") return false;
      if (!matchesSearch(p, f.q)) return false;
      if (min != null && !(Number(p.rent) >= min)) return false;
      if (max != null && !(Number(p.rent) <= max)) return false;
      if (f.type && p.property_type !== f.type) return false;
      if (f.beds !== "" && f.beds != null) {
        const b = p.bedrooms == null ? null : Number(p.bedrooms);
        if (b == null) return false;
        if (f.beds === "3+") { if (b < 3) return false; } else if (b !== Number(f.beds)) return false;
      }
      if (maxKm != null) { const d = distanceFromCampus(p); if (d == null || d > maxKm) return false; } // unknown location never matches a distance filter
      return true;
    });
  }
  function sortRows(rows, sort) {
    const r = [...rows];
    const t = (p) => Date.parse(p.created_at) || 0;
    if (sort === "low") r.sort((a, b) => a.rent - b.rent || t(b) - t(a));
    else if (sort === "high") r.sort((a, b) => b.rent - a.rent || t(b) - t(a));
    else if (sort === "near") r.sort((a, b) => (distanceFromCampus(a) ?? Infinity) - (distanceFromCampus(b) ?? Infinity) || t(b) - t(a));
    else r.sort((a, b) => t(b) - t(a));
    return r;
  }
  const dedupeById = (rows) => { const s = new Set(); return rows.filter((p) => (s.has(p.id) ? false : (s.add(p.id), true))); };

  // Names to show for the two independent status axes.
  const availabilityLabel = (s) => (s === "Taken" || s === "Occupied" ? "Taken" : "Available");
  const moderationLabel = (s) => ({ pending: "Pending review", approved: "Approved", flagged: "Flagged", rejected: "Rejected" }[s] || s);

  return {
    PROPERTY_TYPES, CAMPUS, LIMITS, PAGE_SIZE, esc, formatKES,
    normalizeKenyanPhone, isValidKenyanPhone, telHref, waHref,
    validateSignup, validateListing, sniffImageType, validateImageMeta,
    haversineKm, distanceFromCampus, formatKm,
    matchesSearch, applyFilters, sortRows, dedupeById, availabilityLabel, moderationLabel,
  };
});

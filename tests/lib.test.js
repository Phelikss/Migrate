const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/lib.js");

const mk = (o) => ({ id: Math.random().toString(36).slice(2), title: "House", rent: 5000, property_type: "bedsitter", bedrooms: 0,
  area: "Thogoto", location: "", description: "", status: "Available", moderation_status: "approved",
  latitude: -1.2196, longitude: 36.6676, created_at: "2026-01-01T00:00:00Z", ...o });

test("Kenyan phone validation", () => {
  for (const ok of ["0712345678", "+254712345678", "254712345678", "0112345678", "0712 345 678", "0712-345-678"]) assert.ok(L.isValidKenyanPhone(ok), ok);
  for (const bad of ["", "12345", "0612345678", "+255712345678", "07123456789", "abcdefghij", null]) assert.ok(!L.isValidKenyanPhone(bad), String(bad));
  assert.equal(L.telHref("0712345678"), "tel:+254712345678");
  assert.equal(L.telHref("nope"), "");
  assert.match(L.waHref("0712345678", "Hi & bye"), /^https:\/\/wa\.me\/254712345678\?text=Hi%20%26%20bye$/);
});

test("signup validation follows the proposal", () => {
  const good = { name: "Jane Doe", email: "jane@example.com", phone: "0712345678", role: "student", password: "12345678", confirm: "12345678" };
  assert.deepEqual(L.validateSignup(good), {});
  assert.ok(L.validateSignup({ ...good, name: "J" }).name);
  assert.ok(L.validateSignup({ ...good, name: "x".repeat(61) }).name);
  assert.ok(L.validateSignup({ ...good, name: "  " }).name);
  assert.ok(L.validateSignup({ ...good, email: "bad@" }).email);
  assert.ok(L.validateSignup({ ...good, phone: "123" }).phone);
  assert.ok(L.validateSignup({ ...good, password: "1234567", confirm: "1234567" }).password);
  assert.ok(L.validateSignup({ ...good, confirm: "different" }).confirm);
  assert.ok(L.validateSignup({ ...good, role: "admin" }).role, "admin cannot be self-selected");
});

const listing = { title: "Nice", description: "Good place", rent: "6500", property_type: "bedsitter", bedrooms: "0", area: "Thogoto", contact_phone: "0712345678", latitude: "", longitude: "" };
test("listing validation follows the proposal", () => {
  assert.deepEqual(L.validateListing(listing, 1), {});
  assert.ok(L.validateListing({ ...listing, title: " " }, 1).title);
  assert.ok(L.validateListing({ ...listing, description: "" }, 1).description);
  assert.ok(L.validateListing({ ...listing, description: "x".repeat(1001) }, 1).description);
  assert.deepEqual(L.validateListing({ ...listing, description: "x".repeat(1000) }, 1), {});
  assert.ok(L.validateListing({ ...listing, rent: "0" }, 1).rent);
  assert.ok(L.validateListing({ ...listing, rent: "-5" }, 1).rent);
  assert.ok(L.validateListing({ ...listing, rent: "" }, 1).rent);
  assert.ok(L.validateListing({ ...listing, property_type: "castle" }, 1).property_type);
  assert.ok(L.validateListing({ ...listing, bedrooms: "-1" }, 1).bedrooms);
  assert.ok(L.validateListing({ ...listing, bedrooms: "1.5" }, 1).bedrooms);
  assert.ok(L.validateListing({ ...listing, bedrooms: "" }, 1).bedrooms);
  assert.ok(L.validateListing(listing, 0).photos);
  assert.ok(L.validateListing({ ...listing, contact_phone: "abc" }, 1).contact_phone);
  assert.ok(L.validateListing({ ...listing, latitude: "-1.2" }, 1).latitude, "lat without lng");
  assert.ok(L.validateListing({ ...listing, latitude: "95", longitude: "36" }, 1).latitude);
  assert.deepEqual(L.validateListing({ ...listing, latitude: "-1.2", longitude: "36.6" }, 1), {});
});

test("image validation uses real bytes, not the extension", () => {
  assert.equal(L.sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
  assert.equal(L.sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(L.sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(L.sniffImageType(new TextEncoder().encode("<?php echo 1; ?>")), null);
  assert.equal(L.sniffImageType(new TextEncoder().encode("GIF89a....")), null);
  assert.ok(L.validateImageMeta(10, null));
  assert.ok(L.validateImageMeta(L.LIMITS.maxImageBytes + 1, "image/png"));
  assert.ok(L.validateImageMeta(0, "image/png"));
  assert.equal(L.validateImageMeta(1000, "image/png"), null);
});

test("haversine is accurate and symmetric", () => {
  // Nairobi CBD -> JKIA is roughly 13 km in a straight line.
  const d = L.haversineKm({ lat: -1.2864, lng: 36.8172 }, { lat: -1.3192, lng: 36.9278 });
  assert.ok(d > 11 && d < 13.5, String(d));
  assert.equal(L.haversineKm(L.CAMPUS, L.CAMPUS), 0);
  const a = { lat: 0, lng: 0 }, b = { lat: 1, lng: 1 };
  assert.ok(Math.abs(L.haversineKm(a, b) - L.haversineKm(b, a)) < 1e-9);
  assert.ok(Math.abs(L.haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111.195) < 0.05);
});

test("missing coordinates never produce a fake distance", () => {
  assert.equal(L.distanceFromCampus({ latitude: null, longitude: null }), null);
  assert.equal(L.distanceFromCampus({ latitude: "", longitude: "" }), null);
  assert.equal(L.distanceFromCampus({}), null);
  assert.equal(L.distanceFromCampus({ latitude: "x", longitude: 1 }), null);
  assert.equal(L.formatKm(0.45), "450 m");
  assert.equal(L.formatKm(2.345), "2.3 km");
});

test("combined filters: bedsitter + max 8000 + within 3 km (the proposal's example)", () => {
  const rows = [
    mk({ id: "ok", property_type: "bedsitter", rent: 7000, latitude: -1.22, longitude: 36.668 }),
    mk({ id: "too-dear", property_type: "bedsitter", rent: 9000 }),
    mk({ id: "wrong-type", property_type: "one_bedroom", rent: 7000, bedrooms: 1 }),
    mk({ id: "too-far", property_type: "bedsitter", rent: 7000, latitude: -1.3, longitude: 36.9 }),
    mk({ id: "no-coords", property_type: "bedsitter", rent: 7000, latitude: null, longitude: null }),
  ];
  const out = L.applyFilters(rows, { maxRent: "8000", type: "bedsitter", maxKm: "3" });
  assert.deepEqual(out.map((p) => p.id), ["ok"]);
});

test("rent range, bedrooms and search", () => {
  const rows = [mk({ id: "a", rent: 4000, bedrooms: 0 }), mk({ id: "b", rent: 8000, bedrooms: 1, title: "Sunny One Bedroom", area: "Kikuyu town" }),
    mk({ id: "c", rent: 12000, bedrooms: 3, description: "Near the main gate" }), mk({ id: "d", rent: 15000, bedrooms: 4 })];
  const ids = (f) => L.applyFilters(rows, f).map((p) => p.id);
  assert.deepEqual(ids({ minRent: "5000", maxRent: "12000" }), ["b", "c"]);
  assert.deepEqual(ids({ beds: "0" }), ["a"]);
  assert.deepEqual(ids({ beds: "1" }), ["b"]);
  assert.deepEqual(ids({ beds: "3+" }), ["c", "d"]);
  assert.deepEqual(ids({ q: "  sunny   BED " }), ["b"], "whitespace + case + partial");
  assert.deepEqual(ids({ q: "kikuyu" }), ["b"]);
  assert.deepEqual(ids({ q: "main gate" }), ["c"], "description is searched");
  assert.deepEqual(ids({ q: "zzz" }), []);
  assert.equal(ids({}).length, 4);
});

test("taken / unapproved listings never appear in results", () => {
  const rows = [mk({ id: "live" }), mk({ id: "taken", status: "Taken" }), mk({ id: "pending", moderation_status: "pending" }),
    mk({ id: "flag", moderation_status: "flagged" }), mk({ id: "rej", moderation_status: "rejected" })];
  assert.deepEqual(L.applyFilters(rows, {}).map((p) => p.id), ["live"]);
});

test("sorting is stable and puts unknown distance last", () => {
  const rows = [mk({ id: "x", rent: 9000, created_at: "2026-01-02T00:00:00Z" }), mk({ id: "y", rent: 3000, created_at: "2026-01-03T00:00:00Z" }),
    mk({ id: "z", rent: 3000, created_at: "2026-01-04T00:00:00Z", latitude: null, longitude: null })];
  assert.deepEqual(L.sortRows(rows, "low").map((p) => p.id), ["z", "y", "x"]);
  assert.deepEqual(L.sortRows(rows, "high").map((p) => p.id), ["x", "z", "y"]);
  assert.deepEqual(L.sortRows(rows, "new").map((p) => p.id), ["z", "y", "x"]);
  assert.equal(L.sortRows(rows, "near").at(-1).id, "z");
});

test("dedupe and escaping", () => {
  assert.equal(L.dedupeById([{ id: 1 }, { id: 1 }, { id: 2 }]).length, 2);
  assert.equal(L.esc(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(L.esc(null), "");
  assert.equal(L.formatKES(8000), "KES 8,000");
  assert.equal(L.availabilityLabel("Occupied"), "Taken");
});

// Page-level tests: real page scripts in jsdom + in-memory fake Supabase (see tests/helpers/dom.js).
// These are NOT real-browser tests; they catch wiring/logic bugs, not CSS/layout/network issues.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPage, fixtures, text, U } = require("./helpers/dom");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const titles = (d, sel = "#grid h3") => [...d.querySelectorAll(sel)].map(text).sort();
async function listings(opts) {
  const p = await loadPage("listings.html", opts);
  await p.settle(() => p.d.querySelectorAll("#grid .card:not(.skeleton)").length > 0 || p.d.querySelector("#grid .empty, #grid .error"));
  return p;
}
async function setFilters(p, vals) {
  for (const [id, v] of Object.entries(vals)) p.d.getElementById(id).value = v;
  p.d.getElementById("filters").dispatchEvent(new p.w.Event("input", { bubbles: true }));
  await sleep(350);
}

test("home: shows only real approved+available listings, no placeholder cards", async () => {
  const p = await loadPage("index.html");
  await p.settle(() => p.d.querySelectorAll("#featured .card").length > 0);
  assert.deepEqual(titles(p.d, "#featured h3"), ["<img src=x onerror=window.__xss=1>Evil", "Big one bedroom", "Cosy bedsitter"].sort());
  assert.ok(!/Photo \d/.test(p.d.body.textContent), "no fabricated placeholder photo slots");
  assert.equal(p.w.__xss, undefined, "listing title is escaped, script did not run");
  assert.equal(p.errors.length, 0, String(p.errors[0]));
  assert.match(text(p.d.querySelector("h1")), /Find your next digs near campus\./);
});

test("home: honest empty state when there are no listings", async () => {
  const s = fixtures(); s.properties = [];
  const p = await loadPage("index.html", { state: s });
  await p.settle(() => p.d.querySelector("#featured .empty"));
  assert.match(text(p.d.getElementById("featured")), /No houses are listed yet/);
});

test("listings: taken and pending listings never appear; titles are escaped", async () => {
  const p = await listings();
  const t = titles(p.d);
  assert.ok(!t.includes("Taken place") && !t.includes("Pending place") && !t.includes("Other landlord house"));
  assert.equal(t.length, 3);
  assert.equal(text(p.d.getElementById("result-count")), "3 houses available");
  assert.equal(p.w.__xss, undefined);
  assert.equal(p.errors.length, 0, String(p.errors[0]));
});

test("listings: combined filters (type + max rent + distance) operate on real data", async () => {
  const p = await listings();
  await setFilters(p, { "f-type": "bedsitter", "f-max": "8000", "f-km": "3" });
  assert.deepEqual(titles(p.d), ["<img src=x onerror=window.__xss=1>Evil", "Cosy bedsitter"].sort());
  assert.equal(text(p.d.getElementById("result-count")), "2 houses available");
  assert.ok(p.d.querySelectorAll("#active-filters .chip").length >= 3, "active filter chips are shown");
  assert.match(p.w.location.search, /type=bedsitter/); assert.match(p.w.location.search, /km=3/);

  await setFilters(p, { "f-type": "one_bedroom", "f-km": "3" }); // p2 is far from campus
  assert.match(text(p.d.getElementById("grid")), /No houses match these filters/);
  assert.equal(text(p.d.getElementById("result-count")), "No matches");

  p.d.getElementById("reset-filters-2").click(); await sleep(100);
  assert.equal(p.d.querySelectorAll("#grid .card").length, 3, "reset restores every listing");
});

test("listings: search is case/whitespace tolerant and sorting works", async () => {
  const p = await listings();
  await setFilters(p, { "f-q": "  BIG   one " });
  assert.deepEqual(titles(p.d), ["Big one bedroom"]);
  await setFilters(p, { "f-q": "", "f-sort": "low" });
  assert.match(p.d.querySelector("#grid .card .price").textContent, /5,000/);
  await setFilters(p, { "f-sort": "high" });
  assert.match(p.d.querySelector("#grid .card .price").textContent, /12,000/);
});

test("listings: URL parameters from the home search prefill the filters", async () => {
  const p = await listings({ search: "?type=bedsitter&max=6000" });
  assert.equal(p.d.getElementById("f-type").value, "bedsitter"); assert.equal(p.d.getElementById("f-max").value, "6000");
  assert.deepEqual(titles(p.d), ["<img src=x onerror=window.__xss=1>Evil"]);
});

test("listings: network failure shows an error with retry, not a blank page", async () => {
  const p = await loadPage("listings.html", { failNext: /select:properties/ });
  await p.settle(() => p.d.querySelector("#grid .error"));
  assert.match(text(p.d.querySelector("#grid .error")), /Network problem/);
});

test("favourites: student can save and unsave; state follows the database", async () => {
  const p = await listings({ user: U.student });
  const heart = () => p.d.querySelector('[data-fav="p1"]');
  assert.equal(heart().getAttribute("aria-pressed"), "false");
  heart().click(); await p.settle(() => heart().getAttribute("aria-pressed") === "true");
  assert.deepEqual(p.state.favorites.map((f) => [f.user_id, f.property_id]), [[U.student, "p1"]]);
  heart().click(); await p.settle(() => heart().getAttribute("aria-pressed") === "false");
  assert.equal(p.state.favorites.length, 0);
});

test("favourites: a failed save leaves the heart unchanged and tells the user", async () => {
  const p = await listings({ user: U.student });
  p.ctl.failNext = /upsert:favorites/;
  p.d.querySelector('[data-fav="p1"]').click();
  await p.settle(() => p.d.getElementById("toast"));
  assert.equal(p.d.querySelector('[data-fav="p1"]').getAttribute("aria-pressed"), "false");
  assert.equal(p.state.favorites.length, 0);
  assert.match(text(p.d.getElementById("toast")), /Network problem/);
});

test("favourites page: lists saved houses, handles unavailable ones, empty state", async () => {
  const s = fixtures(); s.favorites = [{ id: "f1", user_id: U.student, property_id: "p1", created_at: "2026-10-05" }, { id: "f2", user_id: U.student, property_id: "p4", created_at: "2026-10-04" }];
  const p = await loadPage("favorites.html", { user: U.student, state: s });
  await p.settle(() => p.d.querySelectorAll("#fav-grid .card").length === 2);
  assert.match(text(p.d.getElementById("fav-grid")), /Cosy bedsitter/);
  assert.match(text(p.d.getElementById("fav-grid")), /No longer available/, "pending/removed property handled gracefully");
  p.d.querySelector('[data-remove="p4"]').click();
  await p.settle(() => p.d.querySelectorAll("#fav-grid .card").length === 1);
  assert.equal(s.favorites.length, 1);
  const e = await loadPage("favorites.html", { user: U.student, state: Object.assign(fixtures(), {}) });
  await e.settle(() => e.d.querySelector("#fav-grid .empty"));
  assert.match(text(e.d.getElementById("fav-grid")), /Nothing saved yet/);
});

test("property page: details, contact links, distance label, escaping", async () => {
  const p = await loadPage("property.html", { search: "?id=p1" });
  await p.settle(() => p.d.querySelector("#property-details h1"));
  const tel = p.d.querySelector('a[href^="tel:"]'), wa = p.d.querySelector('a[href^="https://wa.me/"]');
  assert.equal(tel.getAttribute("href"), "tel:+254711111111");
  assert.match(wa.getAttribute("href"), /^https:\/\/wa\.me\/254711111111\?text=/); assert.match(wa.rel, /noopener/);
  assert.match(text(p.d.getElementById("property-details")), /straight line, not by road/);
  assert.match(text(p.d.getElementById("property-details")), /Regarding: Cosy bedsitter/);
  assert.equal(p.errors.length, 0, String(p.errors[0]));
  const x = await loadPage("property.html", { search: "?id=p5" });
  await x.settle(() => x.d.querySelector("#property-details h1"));
  assert.equal(x.w.__xss, undefined); assert.match(text(x.d.querySelector("h1")), /<img src=x/);
});

test("property page: pending listing is invisible to the public but visible (labelled) to its owner", async () => {
  const anon = await loadPage("property.html", { search: "?id=p4" });
  await anon.settle(() => anon.d.querySelector("#property-details .error"));
  assert.match(text(anon.d.getElementById("property-details")), /not found/i);
  const owner = await loadPage("property.html", { search: "?id=p4", user: U.landlord });
  await owner.settle(() => owner.d.querySelector("#property-details h1"));
  assert.match(text(owner.d.querySelector(".notice")), /Not public/);
  assert.ok(owner.d.querySelector('a[href^="post-house.html?edit=p4"]'), "owner gets an Edit link");
  const other = await loadPage("property.html", { search: "?id=p4", user: U.other });
  await other.settle(() => other.d.querySelector("#property-details .error"));
  assert.match(text(other.d.getElementById("property-details")), /not found/i);
});

test("property page: bad id and missing phone are handled", async () => {
  const bad = await loadPage("property.html", { search: "?id=<script>" });
  await bad.settle(() => bad.d.querySelector(".error"));
  assert.match(text(bad.d.getElementById("property-details")), /No property specified/);
  const s = fixtures(); s.properties[0].contact_phone = "";
  const np = await loadPage("property.html", { search: "?id=p1", state: s });
  await np.settle(() => np.d.querySelector("#property-details h1"));
  assert.equal(np.d.querySelector('a[href^="tel:"]'), null);
  assert.match(text(np.d.getElementById("property-details")), /hasn't added a valid phone number/);
});

test("dashboard: only own listings, real counts, mark taken / restore with confirmation", async () => {
  const p = await loadPage("dashboard.html", { user: U.landlord });
  await p.settle(() => p.d.querySelectorAll(".row-card").length > 0);
  assert.equal(p.d.querySelectorAll(".row-card").length, 5, "p1-p5 (not the other landlord's p6)");
  const stats = [...p.d.querySelectorAll(".stat")].map((s) => `${text(s.querySelector(".stat-n"))} ${text(s.querySelector(".stat-l"))}`);
  assert.deepEqual(stats, ["5 Total listings", "3 Available", "1 Taken", "1 Pending review"]);
  p.d.querySelector('[data-id="p1"] [data-act="toggle"]').click();
  await p.settle(() => p.state.properties.find((x) => x.id === "p1").status === "Taken");
  await p.settle(() => /Mark available/.test(text(p.d.querySelector('[data-id="p1"]'))));
  assert.ok(p.ctl.calls.some((c) => c.op === "update" && c.table === "properties" && c.filters.some((f) => f[0] === "host_id")), "update is scoped to the owner");
  p.d.querySelector('[data-id="p1"] [data-act="toggle"]').click(); // restore: no confirmation needed
  await p.settle(() => p.state.properties.find((x) => x.id === "p1").status === "Available");
});

test("dashboard: cancelling the confirmation changes nothing; failed update keeps UI honest", async () => {
  const c = await loadPage("dashboard.html", { user: U.landlord, confirm: "cancel" });
  await c.settle(() => c.d.querySelectorAll(".row-card").length > 0);
  c.d.querySelector('[data-id="p4"] [data-act="delete"]').click(); await sleep(100);
  assert.ok(c.state.properties.some((x) => x.id === "p4"), "not deleted after cancel");
  const f = await loadPage("dashboard.html", { user: U.landlord });
  await f.settle(() => f.d.querySelectorAll(".row-card").length > 0);
  f.ctl.failNext = /update:properties/;
  f.d.querySelector('[data-id="p1"] [data-act="toggle"]').click();
  await f.settle(() => f.d.getElementById("toast"));
  assert.equal(f.state.properties.find((x) => x.id === "p1").status, "Available");
  assert.match(text(f.d.querySelector('[data-id="p1"]')), /Mark as taken/, "button still offers the same action");
});

test("dashboard: delete asks for confirmation and removes the listing", async () => {
  const p = await loadPage("dashboard.html", { user: U.landlord });
  await p.settle(() => p.d.querySelectorAll(".row-card").length > 0);
  p.d.querySelector('[data-id="p4"] [data-act="delete"]').click();
  await p.settle(() => !p.state.properties.some((x) => x.id === "p4"));
  await p.settle(() => p.d.querySelectorAll(".row-card").length === 4);
});

test("dashboard: students are turned away", async () => {
  const p = await loadPage("dashboard.html", { user: U.student });
  await p.settle(() => !p.d.getElementById("gate").hidden);
  assert.match(text(p.d.getElementById("gate")), /landlord and agent accounts/);
});

test("admin: non-admins are blocked; admin can approve, flag and remove", async () => {
  const bad = await loadPage("admin.html", { user: U.landlord });
  await bad.settle(() => !bad.d.getElementById("gate").hidden);
  assert.ok(bad.d.getElementById("admin-body").hidden);
  assert.equal(bad.d.querySelectorAll(".row-card").length, 0);

  const p = await loadPage("admin.html", { user: U.admin });
  await p.settle(() => p.d.querySelectorAll("#mod-list .row-card").length === 2); // p4 + p6 are pending
  p.d.querySelector('[data-id="p4"] [data-mod="approved"]').click();
  await p.settle(() => p.state.properties.find((x) => x.id === "p4").moderation_status === "approved");
  await p.settle(() => p.d.querySelectorAll("#mod-list .row-card").length === 1);
  p.w.prompt = () => "looks fake";
  p.d.querySelector('[data-id="p6"] [data-mod="flagged"]').click();
  await p.settle(() => p.state.properties.find((x) => x.id === "p6").moderation_status === "flagged");
  assert.equal(p.state.properties.find((x) => x.id === "p6").moderation_note, "looks fake");
  p.d.querySelector('[data-filter="flagged"]').click();
  p.d.querySelector('[data-id="p6"] [data-mod="remove"]').click();
  await p.settle(() => !p.state.properties.some((x) => x.id === "p6"));
});

test("admin: role changes are limited to student/landlord; admin accounts can't be created here", async () => {
  const p = await loadPage("admin.html", { user: U.admin });
  await p.settle(() => p.d.querySelector("#user-list table"));
  const sel = p.d.querySelector(`[data-user="${U.student}"]`);
  assert.deepEqual([...sel.options].map((o) => o.value), ["student", "landlord"]);
  assert.equal(p.d.querySelector(`[data-user="${U.admin}"]`), null, "admins and yourself have no dropdown");
  sel.value = "landlord"; sel.dispatchEvent(new p.w.Event("change", { bubbles: true }));
  await p.settle(() => p.state.profiles.find((x) => x.id === U.student).role === "landlord");
});

test("signup: client validation blocks bad input and never sends it", async () => {
  const p = await loadPage("signup.html");
  p.d.getElementById("signup-form").dispatchEvent(new p.w.Event("submit", { cancelable: true, bubbles: true }));
  await sleep(50);
  for (const k of ["name", "email", "phone", "password"]) assert.ok(text(p.d.getElementById(`s-${k}-err`)), `${k} shows an error`);
  assert.equal(p.ctl.signUps.length, 0);
  const set = (id, v) => { p.d.getElementById(id).value = v; };
  set("s-name", "Jane Doe"); set("s-email", "jane@example.com"); set("s-phone", "12345"); set("s-password", "short"); set("s-confirm", "different");
  p.d.getElementById("signup-form").dispatchEvent(new p.w.Event("submit", { cancelable: true, bubbles: true })); await sleep(50);
  assert.match(text(p.d.getElementById("s-phone-err")), /Kenyan number/);
  assert.match(text(p.d.getElementById("s-password-err")), /at least 8/);
  assert.match(text(p.d.getElementById("s-confirm-err")), /do not match/);
  assert.equal(p.ctl.signUps.length, 0);
});

test("signup: valid data goes to Supabase Auth with a normalised phone; role cannot be admin", async () => {
  const p = await loadPage("signup.html");
  const set = (id, v) => { p.d.getElementById(id).value = v; };
  set("s-name", "  Jane Doe "); set("s-email", " jane@example.com "); set("s-phone", "0712 345 678"); set("s-role", "landlord"); set("s-password", "12345678"); set("s-confirm", "12345678");
  p.d.getElementById("signup-form").dispatchEvent(new p.w.Event("submit", { cancelable: true, bubbles: true }));
  await p.settle(() => p.ctl.signUps.length === 1);
  const a = p.ctl.signUps[0];
  assert.equal(a.email, "jane@example.com"); assert.equal(a.password, "12345678");
  assert.deepEqual([a.options.data.full_name, a.options.data.phone, a.options.data.role], ["Jane Doe", "+254712345678", "landlord"]);
  await p.settle(() => /Check your email/.test(text(p.d.getElementById("auth-msg"))));

  const q = await loadPage("signup.html");
  q.d.getElementById("s-role").value = "admin"; // not an option, so the value collapses to ""
  ["s-name:Jane Doe", "s-email:j@e.com", "s-phone:0712345678", "s-password:12345678", "s-confirm:12345678"].forEach((kv) => { const [k, v] = kv.split(":"); q.d.getElementById(k).value = v; });
  q.d.getElementById("signup-form").dispatchEvent(new q.w.Event("submit", { cancelable: true, bubbles: true })); await sleep(50);
  assert.equal(q.ctl.signUps.length, 0); assert.ok(text(q.d.getElementById("s-role-err")));
});

test("signup: an already-registered email gets a clear message", async () => {
  const p = await loadPage("signup.html");
  p.ctl.signUpResult = { data: { user: { identities: [] }, session: null }, error: null };
  const set = (id, v) => { p.d.getElementById(id).value = v; };
  set("s-name", "Jane Doe"); set("s-email", "jane@example.com"); set("s-phone", "0712345678"); set("s-password", "12345678"); set("s-confirm", "12345678");
  p.d.getElementById("signup-form").dispatchEvent(new p.w.Event("submit", { cancelable: true, bubbles: true }));
  await p.settle(() => /already exists/.test(text(p.d.getElementById("auth-msg"))));
});

test("login: wrong password shows a friendly message and re-enables the button", async () => {
  const p = await loadPage("login.html");
  p.d.getElementById("l-email").value = "a@b.co"; p.d.getElementById("l-password").value = "wrongwrong";
  p.d.getElementById("login-form").dispatchEvent(new p.w.Event("submit", { cancelable: true, bubbles: true }));
  await p.settle(() => /incorrect/.test(text(p.d.getElementById("auth-msg"))));
  assert.equal(p.d.querySelector("#login-form button[type=submit]").disabled, false);
  p.d.getElementById("l-email").value = "";
  p.d.getElementById("login-form").dispatchEvent(new p.w.Event("submit", { cancelable: true, bubbles: true })); await sleep(30);
  assert.ok(text(p.d.getElementById("l-email-err")));
});

test("post form: students are blocked; landlords get field errors and nothing is sent without a photo", async () => {
  const s = await loadPage("post-house.html", { user: U.student });
  await s.settle(() => !s.d.getElementById("gate").hidden);
  assert.match(text(s.d.getElementById("gate")), /Only landlord or agent accounts/); assert.ok(s.d.getElementById("post-form").hidden);

  const p = await loadPage("post-house.html", { user: U.landlord });
  await p.settle(() => p.d.getElementById("p-contact_phone").value !== "");
  assert.equal(p.d.getElementById("p-contact_phone").value, "0711111111", "phone pre-filled from profile");
  const submit = () => p.d.getElementById("post-form").dispatchEvent(new p.w.Event("submit", { cancelable: true, bubbles: true }));
  submit(); await sleep(50);
  for (const k of ["title", "description", "rent", "property_type", "bedrooms", "area", "photos"]) assert.ok(text(p.d.getElementById(`p-${k}-err`)), `${k} error shown`);
  const set = (id, v) => { p.d.getElementById(id).value = v; };
  set("p-title", "Nice room"); set("p-description", "x".repeat(1001)); set("p-rent", "0"); set("p-property_type", "bedsitter"); set("p-bedrooms", "-1"); set("p-area", "Thogoto");
  submit(); await sleep(50);
  assert.match(text(p.d.getElementById("p-description-err")), /1000/); assert.match(text(p.d.getElementById("p-rent-err")), /greater than zero/); assert.match(text(p.d.getElementById("p-bedrooms-err")), /0 or more/);
  assert.equal(p.ctl.calls.filter((c) => c.op === "insert").length, 0, "nothing sent to the database");
});

test("no page threw an uncaught error while loading", async () => {
  for (const [f, o] of [["index.html", {}], ["listings.html", {}], ["login.html", {}], ["signup.html", {}], ["favorites.html", { user: U.student }], ["dashboard.html", { user: U.landlord }], ["admin.html", { user: U.admin }], ["post-house.html", { user: U.landlord }], ["property.html", { search: "?id=p1" }]]) {
    const p = await loadPage(f, o); await sleep(250);
    assert.equal(p.errors.length, 0, `${f}: ${p.errors[0]}`);
    assert.ok(p.d.getElementById("nav").innerHTML.length > 0, `${f}: nav rendered`);
    p.close();
  }
});

test("nav is role-aware (convenience only; the database enforces access)", async () => {
  const nav = async (user) => { const p = await loadPage("index.html", { user }); await p.settle(() => !user || p.d.getElementById("logout")); return text(p.d.getElementById("nav")); };
  assert.match(await nav(null), /Log in/); assert.doesNotMatch(await nav(null), /Admin|My listings|Post a house/);
  const s = await nav(U.student); assert.match(s, /Favourites/); assert.doesNotMatch(s, /Admin|Post a house|My listings/);
  const l = await nav(U.landlord); assert.match(l, /My listings/); assert.match(l, /Post a house/); assert.doesNotMatch(l, /Admin|Favourites/);
  assert.match(await nav(U.admin), /Admin/);
});

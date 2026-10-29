// Optional real-browser check (Chromium via Playwright). Run: `npm start` in one terminal, then
//   NODE_PATH=$(npm root -g) node tests/e2e/journey.js
// Supabase network calls are INTERCEPTED and answered with clearly fake TEST data, so this proves the
// pages, scripts, filters and layout work in a real browser. It does NOT test the real Supabase project.
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:8080";
const SB = "https://rrfbejmlxirzmiohhpee.supabase.co";
const iso = (d) => new Date(Date.now() - d * 864e5).toISOString();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const ROWS = [
  { id: 1, title: "TEST Bedsitter near gate", rent: 6500, property_type: "bedsitter", bedrooms: 0, area: "Thogoto", latitude: -1.2200, longitude: 36.6680, status: "Available", moderation_status: "approved", created_at: iso(1), amenities: ["Water", "WiFi"], description: "test", property_images: [{ image_url: SB + "/storage/test1.png", position: 0 }] },
  { id: 2, title: "TEST 1 bedroom Kikuyu", rent: 12000, property_type: "one_bedroom", bedrooms: 1, area: "Kikuyu", latitude: -1.2460, longitude: 36.6630, status: "Available", moderation_status: "approved", created_at: iso(2), amenities: [], description: "test", property_images: [] },
  { id: 3, title: "TEST Bedsitter far, no coordinates", rent: 5000, property_type: "bedsitter", bedrooms: 0, area: "Kikuyu", latitude: null, longitude: null, status: "Available", moderation_status: "approved", created_at: iso(3), amenities: [], description: "test", property_images: [] },
];
let failures = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (extra ? " - " + extra : "")); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch();
  for (const [w, h] of [[360, 800], [768, 1024], [1366, 768]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    // Playwright runs the most recently registered matching route first, so the catch-all goes first.
    await ctx.route(SB + "/rest/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await ctx.route("https://fonts.g*/**", (r) => r.abort());
    await ctx.route(SB + "/storage/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: png }));
    await ctx.route(SB + "/rest/v1/properties*", (r) => {
      const u = new URL(r.request().url());
      const id = u.searchParams.get("id");
      if (id && id.startsWith("eq.")) { const row = ROWS.find((x) => "eq." + x.id === id); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row || null) }); }
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ROWS) });
    });
    const page = await ctx.newPage(); const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/fonts|ERR_FAILED|net::/.test(m.text())) errs.push(m.text()); });
    const tag = `[${w}px] `;

    await page.goto(BASE + "/listings.html"); await page.waitForSelector(".card:not(.skeleton)");
    check(tag + "listings render 3 cards", (await page.locator("#grid .card").count()) === 3);
    check(tag + "no horizontal overflow", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    if (w < 768) await page.click("#toggle-filters");
    await page.selectOption("#f-type", "bedsitter"); await page.fill("#f-max", "8000"); await page.selectOption("#f-km", "3");
    await page.waitForTimeout(300);
    const titles = await page.locator("#grid .card h3").allTextContents();
    check(tag + "bedsitter + max 8000 + within 3 km -> only the located bedsitter (no-coordinate listing excluded)", titles.length === 1 && /near gate/.test(titles[0]), JSON.stringify(titles));
    await page.fill("#f-q", "zzzz-nothing"); await page.waitForTimeout(300);
    check(tag + "no-results feedback shown", (await page.locator("#grid .card").count()) === 0 && /no|match|found/i.test(await page.locator("main").innerText()));
    await page.fill("#f-q", ""); await page.selectOption("#f-type", ""); await page.fill("#f-max", ""); await page.selectOption("#f-km", ""); await page.selectOption("#f-sort", "low"); await page.waitForTimeout(300);
    const sorted = await page.locator("#grid .card h3").allTextContents();
    check(tag + "sort lowest rent first", /no coordinates/.test(sorted[0]), JSON.stringify(sorted));

    await page.goto(BASE + "/property.html?id=1"); await page.waitForSelector("h1");
    check(tag + "details page shows title", /near gate/.test(await page.locator("h1").innerText()));
    check(tag + "details: no overflow", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await page.waitForSelector(".leaflet-container", { timeout: 8000 }).catch(() => {});
    check(tag + "details: map renders (Leaflet loaded from vendor/, no Google key set)", (await page.locator(".leaflet-container").count()) > 0 && (await page.evaluate(() => !!window.L)));

    for (const p of ["index", "login", "signup", "post-house", "favorites", "dashboard", "admin"]) {
      await page.goto(`${BASE}/${p}.html`); await page.waitForTimeout(400);
      check(tag + p + " no overflow", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    }
    check(tag + "no JS/console errors", errs.length === 0, errs.slice(0, 3).join(" | "));
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll browser checks passed");
  process.exit(failures ? 1 : 0);
})();

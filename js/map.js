// Map module. Uses Google Maps when MIGRATE_CONFIG.GOOGLE_MAPS_API_KEY is set; otherwise falls back
// to OpenStreetMap via Leaflet (loaded on demand, so pages without a map stay light).
// Usage: MigrateMap.show(el, { points: [{lat,lng,title,html}], campus: CAMPUS, zoom: 15 }) -> Promise<{ok, provider}>
const MigrateMap = (function () {
  const cfg = window.MIGRATE_CONFIG || {};
  let gPromise, lPromise;
  const loadScript = (src, attrs = {}) => new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.async = true; Object.assign(s, attrs);
    s.onload = res; s.onerror = () => rej(new Error("script failed: " + src)); document.head.appendChild(s);
  });
  function loadGoogle() {
    if (window.google?.maps) return Promise.resolve();
    return (gPromise ||= new Promise((res, rej) => {
      window.__migrateGmapsReady = res;
      loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.GOOGLE_MAPS_API_KEY)}&callback=__migrateGmapsReady&loading=async`).catch(rej);
      window.gm_authFailure = () => rej(new Error("Google Maps key rejected"));
      setTimeout(() => rej(new Error("Google Maps timed out")), 12000);
    }));
  }
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    return (lPromise ||= new Promise((res, rej) => {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
      loadScript("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js").then(res, rej);
    }));
  }
  const valid = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

  async function showGoogle(el, o) {
    await loadGoogle();
    const g = google.maps, centre = o.points[0] || o.campus;
    const map = new g.Map(el, { center: { lat: centre.lat, lng: centre.lng }, zoom: o.zoom || 15, mapTypeControl: false, streetViewControl: false, gestureHandling: "cooperative" });
    const bounds = new g.LatLngBounds(), info = new g.InfoWindow();
    if (o.campus) {
      new g.Marker({ position: o.campus, map, title: o.campus.name || "Campus", icon: { path: g.SymbolPath.CIRCLE, scale: 9, fillColor: "#D9A441", fillOpacity: 1, strokeColor: "#174A36", strokeWeight: 3 } });
      bounds.extend(o.campus);
    }
    o.points.forEach((p) => {
      const m = new g.Marker({ position: { lat: p.lat, lng: p.lng }, map, title: p.title });
      bounds.extend(m.getPosition());
      if (p.html) m.addListener("click", () => { const d = document.createElement("div"); d.innerHTML = p.html; info.setContent(d); info.open({ map, anchor: m }); });
    });
    if (o.points.length > 1 || (o.points.length && o.campus)) map.fitBounds(bounds, 48);
    return "google";
  }
  async function showLeaflet(el, o) {
    await loadLeaflet();
    el.replaceChildren();
    const c = o.points[0] || o.campus, map = L.map(el, { scrollWheelZoom: false }).setView([c.lat, c.lng], o.zoom || 15);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    const pts = [];
    if (o.campus) { L.circleMarker([o.campus.lat, o.campus.lng], { radius: 9, color: "#174A36", fillColor: "#D9A441", fillOpacity: 1, weight: 3 }).addTo(map).bindTooltip(o.campus.name || "Campus"); pts.push([o.campus.lat, o.campus.lng]); }
    o.points.forEach((p) => { const m = L.marker([p.lat, p.lng], { title: p.title, alt: p.title }).addTo(map); if (p.html) m.bindPopup(p.html); pts.push([p.lat, p.lng]); });
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
    setTimeout(() => map.invalidateSize(), 50);
    return "osm";
  }
  async function show(el, opts) {
    const o = { points: [], campus: null, ...opts }; o.points = o.points.filter(valid);
    if (!o.points.length && !o.campus) return { ok: false, reason: "no-coordinates" };
    try {
      if (cfg.GOOGLE_MAPS_API_KEY) {
        try { return { ok: true, provider: await showGoogle(el, o) }; }
        catch (e) { el.replaceChildren(); console.warn("Google Maps unavailable, using OpenStreetMap:", e.message); }
      }
      return { ok: true, provider: await showLeaflet(el, o) };
    } catch (e) { return { ok: false, reason: "load-failed" }; }
  }
  return { show };
})();

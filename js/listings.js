// Listings page: search, filters, sorting, result count, "load more" pagination, map, favourites.
const $ = (id) => document.getElementById(id);
const grid = $("grid"), countEl = $("result-count"), form = $("filters"), more = $("load-more"), chips = $("active-filters");
const mapBtn = $("toggle-map-btn"), mapEl = $("listings-map"), mapNote = $("map-note");
let all = [], filtered = [], shown = 0, favIds = new Set(), canFav = false, mapOpen = false;

Object.entries(PROPERTY_TYPES).forEach(([v, l]) => $("f-type").insertAdjacentHTML("beforeend", `<option value="${v}">${l}</option>`));

const FIELDS = { q: "f-q", minRent: "f-min", maxRent: "f-max", type: "f-type", beds: "f-beds", maxKm: "f-km", sort: "f-sort" };
const PARAM = { q: "q", minRent: "min", maxRent: "max", type: "type", beds: "beds", maxKm: "km", sort: "sort" };

// Initial values from the URL (the home page search sends type/max/q; "area" from older links is treated as a text search)
const params = new URLSearchParams(location.search);
for (const [k, id] of Object.entries(FIELDS)) $(id).value = params.get(PARAM[k]) || (k === "q" ? params.get("area") || "" : "") || (k === "sort" ? "new" : "");

const readFilters = () => Object.fromEntries(Object.entries(FIELDS).map(([k, id]) => [k, $(id).value.trim()]));

function syncUrl(f) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v && !(k === "sort" && v === "new")) p.set(PARAM[k], v);
  history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
}

function filterLabels(f) {
  const l = [];
  if (f.q) l.push(["q", `Search: "${f.q}"`]);
  if (f.minRent) l.push(["minRent", `From ${formatKES(f.minRent)}`]);
  if (f.maxRent) l.push(["maxRent", `Up to ${formatKES(f.maxRent)}`]);
  if (f.type) l.push(["type", PROPERTY_TYPES[f.type]]);
  if (f.beds !== "") l.push(["beds", f.beds === "0" ? "No separate bedroom" : f.beds === "3+" ? "3+ bedrooms" : `${f.beds} bedroom${f.beds === "1" ? "" : "s"}`]);
  if (f.maxKm) l.push(["maxKm", `Within ${f.maxKm} km of campus`]);
  return l;
}

function render() {
  grid.innerHTML = filtered.slice(0, shown).map((p, i) => cardHTML(p, { saved: favIds.has(p.id), canFav, eager: i < 2 })).join("");
  more.hidden = shown >= filtered.length;
  more.textContent = `Show more (${filtered.length - shown} left)`;
}

function apply(resetPage = true) {
  const f = readFilters();
  syncUrl(f);
  const rows = MigrateLib.sortRows(MigrateLib.applyFilters(all, f), f.sort);
  filtered = rows;
  if (resetPage) shown = Math.min(MigrateLib.PAGE_SIZE, rows.length);
  const labels = filterLabels(f);
  chips.innerHTML = labels.map(([k, t]) => `<button type="button" class="chip" data-clear="${k}">${esc(t)} <span aria-hidden="true">&times;</span><span class="sr-only">remove filter</span></button>`).join("")
    + (labels.length ? `<button type="button" class="chip chip-reset" id="reset-filters">Reset all filters</button>` : "");
  if (!all.length) {
    countEl.textContent = "";
    grid.innerHTML = `<div class="empty"><h2>No houses listed yet</h2><p>Be the first to list a vacant house near campus.</p><a class="btn" href="post-house.html">Post a house</a></div>`;
    more.hidden = true;
  } else if (!rows.length) {
    countEl.textContent = "No matches";
    grid.innerHTML = `<div class="empty"><h2>No houses match these filters</h2><p>Try a higher rent, fewer filters, or a different search.</p>${labels.length ? '<button type="button" class="btn btn-outline" id="reset-filters-2">Reset filters</button>' : ""}</div>`;
    more.hidden = true;
  } else {
    countEl.textContent = `${rows.length} ${rows.length === 1 ? "house" : "houses"} available`;
    render();
  }
  if (mapOpen) drawMap();
}

async function drawMap() {
  const pts = filtered.filter((p) => MigrateLib.distanceFromCampus(p) !== null)
    .map((p) => ({ lat: +p.latitude, lng: +p.longitude, title: p.title, html: `<strong>${esc(p.title)}</strong><br>${formatKES(p.rent)} / month<br><a href="property.html?id=${encodeURIComponent(p.id)}">View details</a>` }));
  const missing = filtered.length - pts.length;
  mapNote.textContent = missing ? `${missing} of ${filtered.length} listings have no map pin and are not shown on the map.` : "";
  const r = await MigrateMap.show(mapEl, { points: pts, campus: CAMPUS, zoom: 14 });
  if (!r.ok) { mapEl.hidden = true; mapNote.textContent = "The map couldn't load. The list below still shows each house's area and details."; }
}

mapBtn.addEventListener("click", () => {
  mapOpen = !mapOpen; mapEl.hidden = !mapOpen; mapNote.hidden = !mapOpen;
  mapBtn.setAttribute("aria-expanded", String(mapOpen)); mapBtn.textContent = mapOpen ? "Hide map" : "Show map";
  if (mapOpen) drawMap();
});

let t; form.addEventListener("input", () => { clearTimeout(t); t = setTimeout(apply, 200); });
form.addEventListener("submit", (e) => { e.preventDefault(); apply(); });
form.addEventListener("reset", () => setTimeout(() => { $("f-sort").value = "new"; apply(); }, 0));
more.addEventListener("click", () => { shown = Math.min(shown + MigrateLib.PAGE_SIZE, filtered.length); render(); });
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-clear]");
  if (c) { $(FIELDS[c.dataset.clear]).value = ""; apply(); return; }
  if (e.target.id === "reset-filters" || e.target.id === "reset-filters-2") { form.reset(); }
});
wireFavButtons(grid);

async function init() {
  grid.setAttribute("aria-busy", "true");
  grid.innerHTML = Array.from({ length: 6 }, () => `<div class="card skeleton" aria-hidden="true"><div class="card-img"></div><div class="card-body"><span></span><span></span><span></span></div></div>`).join("");
  const [me, res] = await Promise.all([
    getMe(),
    db.from("properties")
      .select("id,title,description,rent,location,area,property_type,bedrooms,amenities,latitude,longitude,status,moderation_status,created_at,property_images(image_url,position)")
      .eq("moderation_status", "approved").eq("status", "Available")
      .order("created_at", { ascending: false }).limit(500),
  ]);
  grid.removeAttribute("aria-busy");
  if (res.error) { countEl.textContent = ""; grid.innerHTML = `<div class="error"><p>We couldn't load listings. ${esc(friendlyError(res.error))}</p><button class="btn btn-outline" onclick="location.reload()">Try again</button></div>`; return; }
  all = MigrateLib.dedupeById(res.data || []);
  canFav = !me.user || me.role === "student"; // logged-out visitors get a heart that sends them to log in
  if (me.user && canFav) favIds = await loadFavIds();
  apply();
}
init();

// Phones: collapse the secondary filters behind a button (search stays visible).
(() => {
  const btn = document.getElementById("toggle-filters"), extra = document.getElementById("filter-extra");
  if (!btn || !extra) return;
  btn.addEventListener("click", () => { const open = extra.classList.toggle("open"); btn.setAttribute("aria-expanded", String(open)); });
})();

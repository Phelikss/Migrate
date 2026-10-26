const grid = document.getElementById("grid");
const countEl = document.getElementById("result-count");
const fArea = document.getElementById("f-area"), fType = document.getElementById("f-type");
const fMax = document.getElementById("f-max"), fSort = document.getElementById("f-sort");
const mapBtn = document.getElementById("toggle-map-btn"), mapEl = document.getElementById("listings-map");
let map, markers, lastRows = [];

Object.entries(PROPERTY_TYPES).forEach(([v, l]) => fType.insertAdjacentHTML("beforeend", `<option value="${v}">${l}</option>`));
const params = new URLSearchParams(location.search);
fType.value = params.get("type") || "";
fMax.value = params.get("max") || "";

async function loadAreas() {
  const { data } = await db.from("properties").select("area").eq("status", "Available");
  [...new Set((data || []).map((p) => p.area).filter(Boolean))].sort()
    .forEach((a) => fArea.insertAdjacentHTML("beforeend", `<option value="${esc(a)}">${esc(a)}</option>`));
  fArea.value = params.get("area") || "";
}

function cardHTML(p) {
  const img = p.property_images?.[0]?.image_url;
  const photo = img
    ? `<div class="card-img" style="background-image:url('${encodeURI(img)}')" role="img" aria-label="${esc(p.title)}"></div>`
    : `<div class="card-img">No photo yet</div>`;
  const tags = [p.property_type ? PROPERTY_TYPES[p.property_type] : null, p.bedrooms ? `${p.bedrooms} bed` : null, p.bathrooms ? `${p.bathrooms} bath` : null]
    .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  const amenities = (p.amenities || []).slice(0, 3).map((a) => `<span class="tag tag-ok">${esc(a)}</span>`).join("");
  const rent = p.rent != null ? `<div class="price">${formatKES(p.rent)} <small>/ month</small></div>` : "";
  return `<article class="card">${photo}<div class="card-body">${rent}<h3>${esc(p.title)}</h3>
    <div class="meta">${esc(p.area || p.location || "")}</div><div>${tags}${amenities}</div>
    <a class="btn" href="property.html?id=${p.id}">View details</a></div></article>`;
}

function drawMap() {
  if (typeof L === "undefined") return;
  if (!map) {
    map = L.map(mapEl).setView([CAMPUS.lat, CAMPUS.lng], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    markers = L.layerGroup().addTo(map);
  }
  markers.clearLayers();
  const pts = lastRows.filter((p) => p.latitude != null && p.longitude != null);
  pts.forEach((p) => L.marker([+p.latitude, +p.longitude]).addTo(markers)
    .bindPopup(`<strong>${esc(p.title)}</strong><br>${formatKES(p.rent)} / month<br><a href="property.html?id=${p.id}">View details</a>`));
  if (pts.length) map.fitBounds(pts.map((p) => [+p.latitude, +p.longitude]), { padding: [40, 40], maxZoom: 16 });
  map.invalidateSize();
}

mapBtn.addEventListener("click", () => {
  const show = mapEl.style.display === "none";
  mapEl.style.display = show ? "block" : "none";
  mapBtn.classList.toggle("on", show);
  mapBtn.textContent = show ? "Hide map" : "View on map";
  if (show) drawMap();
});

async function loadListings() {
  let q = db.from("properties")
    .select("id,title,rent,location,area,property_type,bedrooms,bathrooms,amenities,latitude,longitude,property_images(image_url)")
    .eq("status", "Available");
  if (fArea.value) q = q.eq("area", fArea.value);
  if (fType.value) q = q.eq("property_type", fType.value);
  if (fMax.value) q = q.lte("rent", Number(fMax.value));
  if (fSort.value === "low") q = q.order("rent", { ascending: true });
  else if (fSort.value === "high") q = q.order("rent", { ascending: false });
  else q = q.order("created_at", { ascending: false });

  const { data, error } = await q;
  if (error) { countEl.textContent = ""; grid.innerHTML = `<p class="error">We couldn't load listings. Check your connection and refresh.</p>`; return; }
  lastRows = data;
  if (!data.length) { countEl.textContent = "No matches"; grid.innerHTML = `<p class="empty">No rentals match these filters. Try a higher rent or a different area.</p>`; }
  else { countEl.textContent = `${data.length} ${data.length === 1 ? "place" : "places"} available`; grid.innerHTML = data.map(cardHTML).join(""); }
  if (mapEl.style.display !== "none") drawMap();
}

// debounce so typing a rent amount doesn't fire a query per keystroke
let t; document.getElementById("filters").addEventListener("input", () => { clearTimeout(t); t = setTimeout(loadListings, 250); });
document.getElementById("filters").addEventListener("submit", (e) => e.preventDefault());
loadAreas().then(loadListings);

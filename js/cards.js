// Property cards + favourites, shared by Home, Listings and Favourites.
const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
const NO_PHOTO = `<div class="card-img ph-img" role="img" aria-label="No photo available"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg><span>No photo yet</span></div>`;

function sortedImages(p) {
  return [...(p.property_images || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((i) => i.image_url).filter(Boolean);
}

function cardHTML(p, opts = {}) {
  const { saved = false, canFav = false, eager = false, extra = "" } = opts;
  const img = sortedImages(p)[0];
  const photo = img
    ? `<img class="card-img" src="${esc(img)}" alt="" width="400" height="300" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card-img ph-img',textContent:'Photo unavailable'}))">`
    : NO_PHOTO;
  const km = MigrateLib.distanceFromCampus(p);
  const tags = [
    p.property_type ? PROPERTY_TYPES[p.property_type] : null,
    p.bedrooms != null ? (p.bedrooms === 0 ? "No separate bedroom" : `${p.bedrooms} bed`) : null,
  ].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  const amenities = (Array.isArray(p.amenities) ? p.amenities : []).slice(0, 3).map((a) => `<span class="tag tag-ok">${esc(a)}</span>`).join("");
  const taken = MigrateLib.availabilityLabel(p.status) === "Taken";
  const heart = canFav
    ? `<button type="button" class="fav-btn${saved ? " on" : ""}" data-fav="${esc(p.id)}" aria-pressed="${saved}" aria-label="${saved ? "Remove from" : "Add to"} favourites: ${esc(p.title)}">${HEART}</button>`
    : "";
  return `<article class="card${taken ? " is-taken" : ""}"><div class="card-media">${photo}${taken ? '<span class="badge badge-taken">Taken</span>' : ""}${heart}</div>
    <div class="card-body"><div class="price">${p.rent != null ? formatKES(p.rent) : "Rent on request"} <small>/ month</small></div>
    <h3><a class="stretched" href="property.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></h3>
    <div class="meta">${esc(p.area || p.location || "")}${km != null ? ` &middot; ${MigrateLib.formatKm(km)} from campus (straight line)` : ""}</div>
    <div class="tags">${tags}${amenities}</div>${extra}</div></article>`;
}

// ---- favourites (persisted in the database, scoped to the signed-in user by RLS) ----
let _favIds;
async function loadFavIds() {
  if (_favIds) return _favIds;
  const me = await getMe();
  _favIds = new Set();
  if (!me.user) return _favIds;
  const { data, error } = await db.from("favorites").select("property_id").eq("user_id", me.user.id);
  if (!error) (data || []).forEach((r) => _favIds.add(r.property_id));
  return _favIds;
}
// Returns {ok, saved, message}. UI should only change state when ok is true.
async function setFavourite(propertyId, wantSaved) {
  const me = await getMe();
  if (!me.user) return { ok: false, needLogin: true, message: "Please log in to save houses." };
  const q = wantSaved
    ? db.from("favorites").upsert({ user_id: me.user.id, property_id: propertyId }, { onConflict: "user_id,property_id", ignoreDuplicates: true })
    : db.from("favorites").delete().eq("user_id", me.user.id).eq("property_id", propertyId);
  const { error } = await q;
  if (error) return { ok: false, message: friendlyError(error) };
  (await loadFavIds())[wantSaved ? "add" : "delete"](propertyId);
  return { ok: true, saved: wantSaved };
}
function wireFavButtons(container, onChange) {
  container.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-fav]"); if (!b || b.disabled) return;
    const id = b.dataset.fav, want = b.getAttribute("aria-pressed") !== "true";
    b.disabled = true;
    const r = await setFavourite(id, want);
    b.disabled = false;
    if (r.needLogin) { location.href = "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search); return; }
    if (!r.ok) { toast(r.message, true); return; }
    b.setAttribute("aria-pressed", String(r.saved)); b.classList.toggle("on", r.saved);
    b.setAttribute("aria-label", `${r.saved ? "Remove from" : "Add to"} favourites`);
    if (onChange) onChange(id, r.saved);
  });
}

// Small accessible toast
function toast(msg, bad = false) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
  t.className = "toast show" + (bad ? " bad" : ""); t.textContent = msg;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 4500);
}

// Accessible confirmation dialog built on the native <dialog> element (focus trap + Esc handled by the browser).
// Resolves true only if the user explicitly confirms.
function confirmDialog({ title, body, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog"); d.className = "dlg"; d.setAttribute("aria-labelledby", "dlg-t");
    d.innerHTML = `<form method="dialog"><h2 id="dlg-t" class="h3">${esc(title)}</h2><p>${esc(body)}</p>
      <div class="actions"><button value="cancel" class="btn btn-outline" autofocus>Cancel</button><button value="ok" class="btn${danger ? " btn-danger" : ""}">${esc(confirmLabel)}</button></div></form>`;
    const opener = document.activeElement;
    d.addEventListener("close", () => { const ok = d.returnValue === "ok"; d.remove(); if (opener && opener.focus) opener.focus(); resolve(ok); });
    document.body.appendChild(d); d.showModal();
  });
}

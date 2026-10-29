const box = document.getElementById("property-details");
const propertyId = new URLSearchParams(location.search).get("id");
// Accept any plain id token (uuid or numeric); anything with markup/query characters is rejected before it reaches the API.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function loadProperty() {
  if (!propertyId || !ID_RE.test(propertyId)) { box.innerHTML = `<div class="error"><p>No property specified.</p><a class="btn" href="listings.html">Back to listings</a></div>`; return; }
  const [me, res] = await Promise.all([
    getMe(),
    db.from("properties").select("*, property_images(image_url,position)").eq("id", propertyId).maybeSingle(),
  ]);
  const p = res.data;
  if (res.error) { box.innerHTML = `<div class="error"><p>We couldn't load this house. ${esc(friendlyError(res.error))}</p><button class="btn btn-outline" onclick="location.reload()">Try again</button></div>`; return; }
  if (!p) { box.innerHTML = `<div class="error"><p>This house was not found. It may have been removed.</p><a class="btn" href="listings.html">Back to listings</a></div>`; return; }

  document.title = `${p.title} | Migrate`;
  const imgs = sortedImages(p);
  const phone = p.contact_phone || "";
  const msg = `Hi, I'm interested in "${p.title}" on Migrate.`;
  const tel = MigrateLib.telHref(phone), wa = MigrateLib.waHref(phone, msg);
  const amenities = Array.isArray(p.amenities) ? p.amenities : [];
  const taken = MigrateLib.availabilityLabel(p.status) === "Taken";
  const isOwner = me.user && me.user.id === p.host_id, isAdmin = me.role === "admin";
  const km = MigrateLib.distanceFromCampus(p);
  const listed = p.created_at ? new Date(p.created_at).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" }) : "";
  const unpublished = p.moderation_status !== "approved"
    ? `<div class="notice" role="status"><strong>Not public.</strong> This listing is "${esc(MigrateLib.moderationLabel(p.moderation_status))}" and is only visible to you${isAdmin && !isOwner ? " as an administrator" : ""}.${p.moderation_note ? ` Note: ${esc(p.moderation_note)}` : ""}</div>` : "";

  const gallery = imgs.length
    ? `<div class="gallery" aria-roledescription="carousel" aria-label="Photos of ${esc(p.title)}">
         <div class="gallery-main"><img id="main-img" class="detail-img" src="${esc(imgs[0])}" alt="${esc(p.title)}, photo 1 of ${imgs.length}" width="800" height="600" fetchpriority="high">
         ${imgs.length > 1 ? `<button class="g-nav g-prev" aria-label="Previous photo">&#8249;</button><button class="g-nav g-next" aria-label="Next photo">&#8250;</button><span class="g-count" id="g-count" aria-live="polite">1 / ${imgs.length}</span>` : ""}</div>
         ${imgs.length > 1 ? `<div class="thumbs" role="group" aria-label="Choose a photo">${imgs.map((u, i) => `<button type="button" class="thumb${i ? "" : " active"}" data-i="${i}" aria-label="Show photo ${i + 1}" aria-current="${i === 0}"><img src="${esc(u)}" alt="" width="84" height="64" loading="lazy"></button>`).join("")}</div>` : ""}
       </div>`
    : `<div class="card-img ph-img detail-img" role="img" aria-label="No photos available">No photos yet</div>`;

  box.innerHTML = `${unpublished}
    <nav class="crumbs" aria-label="Breadcrumb"><a href="listings.html">&larr; All houses</a></nav>
    <div class="detail">
      <div>${gallery}</div>
      <div class="detail-info">
        <div class="badges"><span class="badge ${taken ? "badge-taken" : "badge-ok"}">${taken ? "Taken" : "Available"}</span>${isOwner || isAdmin ? `<span class="badge badge-mod">${esc(MigrateLib.moderationLabel(p.moderation_status))}</span>` : ""}</div>
        <h1 class="page-title" style="font-size:clamp(1.6rem,4vw,2.4rem)">${esc(p.title)}</h1>
        <div class="price big">${p.rent != null ? formatKES(p.rent) : "Rent on request"} <small>/ month</small></div>
        <dl class="facts">
          <div><dt>Type</dt><dd>${esc(PROPERTY_TYPES[p.property_type] || "Rental")}</dd></div>
          <div><dt>Bedrooms</dt><dd>${p.bedrooms == null ? "Not stated" : p.bedrooms === 0 ? "None (single space)" : p.bedrooms}</dd></div>
          <div><dt>Area</dt><dd>${esc(p.area || "Near campus")}${p.location ? `, ${esc(p.location)}` : ""}</dd></div>
          ${km != null ? `<div><dt>Distance from campus</dt><dd>${MigrateLib.formatKm(km)} <small>straight line, not by road</small></dd></div>` : ""}
          ${listed ? `<div><dt>Listed</dt><dd>${esc(listed)}</dd></div>` : ""}
        </dl>
        <h2 class="h3">Amenities</h2>
        <div class="tags">${amenities.length ? amenities.map((a) => `<span class="tag tag-ok">${esc(a)}</span>`).join("") : '<span class="meta">None listed</span>'}</div>
        <h2 class="h3">Description</h2>
        <p class="prewrap">${esc(p.description || "No description provided.")}</p>

        <section class="contact" aria-labelledby="contact-h">
          <h2 class="h3" id="contact-h">Contact about this house</h2>
          <p class="meta">Regarding: <strong>${esc(p.title)}</strong>${p.contact_name ? ` &middot; Listed by ${esc(p.contact_name)}` : ""}</p>
          ${phone && tel ? `<div class="actions"><a class="btn" href="${esc(tel)}">Call ${esc(phone)}</a><a class="btn btn-wa" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></div>
            <p class="meta small">Always view a house in person before paying any money. Migrate does not handle rent payments.</p>`
            : `<p class="meta">The landlord hasn't added a valid phone number to this listing.</p>`}
        </section>
        <div class="actions"><button id="btn-fav" class="btn btn-outline" aria-pressed="false">Save to favourites</button>${isOwner || isAdmin ? `<a class="btn btn-outline" href="post-house.html?edit=${encodeURIComponent(p.id)}">Edit listing</a>` : ""}</div>
      </div>
    </div>
    <h2 class="h3">Location</h2>
    <p class="meta" id="map-note">${esc([p.area, p.location].filter(Boolean).join(", ") || "Location not stated")}</p>
    <div id="map" class="map" role="region" aria-label="Map showing this house and the campus"></div>`;

  setupGallery(imgs, p.title);
  renderMap(p);
  setupFavorite(p.id, me);
}

function setupGallery(imgs, title) {
  if (imgs.length < 2) return;
  let i = 0;
  const main = document.getElementById("main-img"), count = document.getElementById("g-count");
  const go = (n) => {
    i = (n + imgs.length) % imgs.length;
    main.src = imgs[i]; main.alt = `${title}, photo ${i + 1} of ${imgs.length}`; count.textContent = `${i + 1} / ${imgs.length}`;
    box.querySelectorAll(".thumb").forEach((t, k) => { t.classList.toggle("active", k === i); t.setAttribute("aria-current", String(k === i)); });
  };
  box.querySelector(".g-prev").addEventListener("click", () => go(i - 1));
  box.querySelector(".g-next").addEventListener("click", () => go(i + 1));
  box.querySelectorAll(".thumb").forEach((t) => t.addEventListener("click", () => go(+t.dataset.i)));
  const g = box.querySelector(".gallery");
  g.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") go(i - 1); if (e.key === "ArrowRight") go(i + 1); });
  let x0 = null; // swipe on touch screens
  main.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  main.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); x0 = null; });
  main.onerror = () => { main.alt = "Photo unavailable"; };
}

async function renderMap(p) {
  const el = document.getElementById("map"), note = document.getElementById("map-note");
  if (MigrateLib.distanceFromCampus(p) === null) { el.hidden = true; note.textContent += " . The landlord hasn't pinned this house on the map."; return; }
  const r = await MigrateMap.show(el, { points: [{ lat: +p.latitude, lng: +p.longitude, title: p.title, html: `<strong>${esc(p.title)}</strong>` }], campus: CAMPUS, zoom: 15 });
  if (!r.ok) { el.hidden = true; note.textContent += " . The map couldn't load, but the address above is still correct."; }
}

async function setupFavorite(id, me) {
  const btn = document.getElementById("btn-fav");
  if (me.role && me.role !== "student") { btn.hidden = true; return; } // landlords/admins don't keep favourites
  const paint = (saved) => { btn.textContent = saved ? "Saved to favourites" : "Save to favourites"; btn.classList.toggle("on", saved); btn.setAttribute("aria-pressed", String(saved)); };
  const ids = await loadFavIds(); let saved = ids.has(id); paint(saved);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const r = await setFavourite(id, !saved);
    btn.disabled = false;
    if (r.needLogin) { location.href = `login.html?next=${encodeURIComponent("property.html?id=" + id)}`; return; }
    if (!r.ok) { toast(r.message, true); return; }
    saved = r.saved; paint(saved);
  });
}
loadProperty();

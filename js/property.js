const box = document.getElementById("property-details");
const propertyId = new URLSearchParams(location.search).get("id");

async function loadProperty() {
  if (!propertyId) { box.innerHTML = `<p class="error">No property specified. <a href="listings.html">Back to listings</a></p>`; return; }
  const { data: p, error } = await db.from("properties")
    .select("*, property_images(image_url), profiles:host_id(full_name, phone, university)")
    .eq("id", propertyId).single();
  if (error || !p) { box.innerHTML = `<p class="error">Property not found or unavailable. <a href="listings.html">Back to listings</a></p>`; return; }

  document.title = `${p.title} | Migrate`;
  const imgs = (p.property_images || []).map((i) => i.image_url).filter(Boolean);
  const phone = p.contact_phone || p.profiles?.phone || "";
  const wa = phone ? `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent("Hi, I'm interested in your property on Migrate: " + p.title)}` : "";
  const amenities = Array.isArray(p.amenities) ? p.amenities : typeof p.amenities === "string" ? p.amenities.split(",").map((a) => a.trim()).filter(Boolean) : [];

  box.innerHTML = `
    <div class="detail">
      <div>
        ${imgs.length ? `<img id="main-img" class="detail-img" src="${esc(imgs[0])}" alt="${esc(p.title)}">` : `<div class="card-img detail-img">No photo yet</div>`}
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<img src="${esc(u)}" alt="Photo ${i + 1}" class="${i ? "" : "active"}">`).join("")}</div>` : ""}
      </div>
      <div>
        <h1 style="font-size:2rem">${esc(p.title)}</h1>
        ${p.status === "Occupied" ? `<span class="tag tag-off">Occupied</span>` : `<span class="tag tag-ok">Available</span>`}
        <div class="price" style="margin:.75rem 0">${p.rent != null ? formatKES(p.rent) : "Rent on request"} <small>/ month</small></div>
        <p class="meta"><strong>Campus:</strong> ${esc(p.campus || "N/A")}</p>
        <p class="meta"><strong>Area:</strong> ${esc(p.area || p.location || "Near campus")}</p>
        <p class="meta"><strong>Type:</strong> ${esc(PROPERTY_TYPES[p.property_type] || p.property_type || "Rental")}</p>
        ${p.profiles?.full_name ? `<p class="meta"><strong>Listed by:</strong> ${esc(p.profiles.full_name)}</p>` : ""}
        <h3 style="margin-top:1.25rem">Amenities</h3>
        <div>${amenities.length ? amenities.map((a) => `<span class="tag tag-ok">${esc(a)}</span>`).join("") : '<span class="meta">None listed</span>'}</div>
        <h3 style="margin-top:1.25rem">Description</h3>
        <p>${esc(p.description || "No description provided.")}</p>
        <div class="actions">
          <button id="btn-fav" class="btn btn-outline">Save to favorites</button>
          ${phone ? `<a class="btn" href="tel:${esc(phone)}">Call landlord</a><a class="btn btn-wa" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
        </div>
      </div>
    </div>
    <div id="map"></div>`;

  box.querySelectorAll(".thumbs img").forEach((t) => t.addEventListener("click", () => {
    document.getElementById("main-img").src = t.src;
    box.querySelectorAll(".thumbs img").forEach((x) => x.classList.toggle("active", x === t));
  }));
  renderMap(p);
  setupFavorite(p.id);
}

function renderMap(p) {
  const el = document.getElementById("map");
  if (typeof L === "undefined") return;
  if (p.latitude == null || p.longitude == null) { el.outerHTML = `<p class="meta">The landlord hasn't pinned this house on the map yet.</p>`; return; }
  const pos = [+p.latitude, +p.longitude];
  const m = L.map(el).setView(pos, 16);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
  L.marker(pos).addTo(m).bindPopup(esc(p.title));
}

async function setupFavorite(id) {
  const btn = document.getElementById("btn-fav");
  const { data: { user } } = await db.auth.getUser();
  const paint = (saved) => { btn.textContent = saved ? "Saved to favorites" : "Save to favorites"; btn.classList.toggle("on", saved); };
  if (!user) { btn.onclick = () => { location.href = "login.html"; }; return; }
  const { data: existing } = await db.from("favorites").select("id").eq("user_id", user.id).eq("property_id", id).maybeSingle();
  let saved = !!existing; paint(saved);
  btn.onclick = async () => {
    btn.disabled = true;
    const { error } = saved
      ? await db.from("favorites").delete().eq("user_id", user.id).eq("property_id", id)
      : await db.from("favorites").insert([{ user_id: user.id, property_id: id }]);
    if (!error) { saved = !saved; paint(saved); } else alert("Couldn't update favorites: " + error.message);
    btn.disabled = false;
  };
}
loadProperty();

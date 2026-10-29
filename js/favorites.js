const favGrid = document.getElementById("fav-grid"), favCount = document.getElementById("fav-count");

async function loadFavorites() {
  const me = await getMe();
  if (!me.user) { location.replace("login.html?next=favorites.html"); return; }
  if (me.role !== "student") { favCount.textContent = ""; favGrid.innerHTML = `<div class="empty"><p>Favourites are for student accounts.</p><a class="btn" href="listings.html">Browse houses</a></div>`; return; }

  favGrid.setAttribute("aria-busy", "true");
  const { data: favs, error } = await db.from("favorites")
    .select("property_id, created_at, properties:property_id(id,title,rent,location,area,property_type,bedrooms,amenities,latitude,longitude,status,moderation_status,property_images(image_url,position))")
    .eq("user_id", me.user.id).order("created_at", { ascending: false });
  favGrid.removeAttribute("aria-busy");
  if (error) { favCount.textContent = ""; favGrid.innerHTML = `<div class="error"><p>Couldn't load your favourites. ${esc(friendlyError(error))}</p><button class="btn btn-outline" onclick="location.reload()">Try again</button></div>`; return; }

  if (!favs.length) { favCount.textContent = "0 saved houses"; favGrid.innerHTML = `<div class="empty"><h2>Nothing saved yet</h2><p>Tap the heart on a house to keep it here.</p><a class="btn" href="listings.html">Browse houses near campus</a></div>`; return; }
  favCount.textContent = `${favs.length} saved ${favs.length === 1 ? "house" : "houses"}`;

  favGrid.innerHTML = favs.map((f) => {
    const p = f.properties;
    const rm = `<button type="button" class="btn btn-outline btn-sm" data-remove="${esc(f.property_id)}">Remove</button>`;
    if (!p) return `<article class="card is-gone"><div class="card-body"><h3>No longer available</h3><p class="meta">This house was removed or is no longer public.</p>${rm}</div></article>`;
    return cardHTML(p, { extra: `<div class="card-actions">${rm}</div>` });
  }).join("");
}

favGrid.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-remove]"); if (!b) return;
  b.disabled = true;
  const r = await setFavourite(b.dataset.remove, false);
  if (!r.ok) { b.disabled = false; toast(r.message, true); return; }
  toast("Removed from favourites.");
  loadFavorites();
});
loadFavorites();

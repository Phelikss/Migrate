const favGrid = document.getElementById("fav-grid"), favCount = document.getElementById("fav-count");

async function loadFavorites() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) { favCount.textContent = ""; favGrid.innerHTML = `<div class="empty"><p>Please <a href="login.html">log in</a> to see your saved rentals.</p></div>`; return; }

  const { data: favs, error } = await db.from("favorites")
    .select("id, properties:property_id(id, title, rent, location, area, property_images(image_url))")
    .eq("user_id", user.id);
  if (error) { favCount.textContent = ""; favGrid.innerHTML = `<p class="error">Couldn't load saved rentals. Refresh to try again.</p>`; return; }

  const rows = (favs || []).filter((f) => f.properties);
  if (!rows.length) { favCount.textContent = "0 saved places"; favGrid.innerHTML = `<div class="empty"><p>Nothing saved yet. <a href="listings.html">Browse rentals near campus</a>.</p></div>`; return; }
  favCount.textContent = `${rows.length} saved ${rows.length === 1 ? "place" : "places"}`;

  favGrid.innerHTML = rows.map(({ id, properties: p }) => {
    const img = p.property_images?.[0]?.image_url;
    const photo = img ? `<div class="card-img" style="background-image:url('${encodeURI(img)}')" role="img" aria-label="${esc(p.title)}"></div>` : `<div class="card-img">No photo yet</div>`;
    return `<article class="card">${photo}<div class="card-body">
      <div class="price">${p.rent != null ? formatKES(p.rent) : ""} <small>/ month</small></div>
      <h3>${esc(p.title)}</h3><div class="meta">${esc(p.area || p.location || "")}</div>
      <a class="btn" href="property.html?id=${p.id}">View details</a>
      <button class="btn btn-outline" data-remove="${id}">Remove</button></div></article>`;
  }).join("");
}
favGrid.addEventListener("click", async (e) => {
  const id = e.target.dataset.remove; if (!id) return;
  const { error } = await db.from("favorites").delete().eq("id", id);
  if (!error) loadFavorites();
});
loadFavorites();

const typeSel = document.getElementById("type"), feat = document.getElementById("featured");
Object.entries(PROPERTY_TYPES).forEach(([v, l]) => typeSel.insertAdjacentHTML("beforeend", `<option value="${v}">${l}</option>`));

document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const p = new URLSearchParams();
  const q = document.getElementById("q").value.trim(), max = document.getElementById("max-rent").value;
  if (q) p.set("q", q); if (typeSel.value) p.set("type", typeSel.value); if (max) p.set("max", max);
  location.href = "listings.html" + (p.toString() ? "?" + p : "");
});

(async function () {
  // Only real data: if nothing is published yet, show an honest empty state.
  const { data, error } = await db.from("properties")
    .select("id,title,rent,area,location,property_type,bedrooms,amenities,latitude,longitude,status,created_at,property_images(image_url,position)")
    .eq("moderation_status", "approved").eq("status", "Available").order("created_at", { ascending: false }).limit(6);
  if (error) { feat.innerHTML = `<div class="error"><p>We couldn't load the latest houses right now.</p><a class="btn btn-outline" href="listings.html">Browse all houses</a></div>`; return; }
  if (!data.length) { feat.innerHTML = `<div class="empty"><h3>No houses are listed yet</h3><p>New listings will appear here once landlords post them.</p><a class="btn" href="signup.html">List a house</a></div>`; return; }
  feat.innerHTML = data.map((p) => cardHTML(p)).join("");
})();

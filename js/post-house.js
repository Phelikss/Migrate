const BUCKET = "property-images"; // create this public bucket in Supabase Storage
const form = document.getElementById("post-form"), msg = document.getElementById("post-msg"), gate = document.getElementById("gate");
const val = (id) => document.getElementById(id).value.trim();
const typeSel = document.getElementById("p-type");
Object.entries(PROPERTY_TYPES).forEach(([v, l]) => typeSel.insertAdjacentHTML("beforeend", `<option value="${v}">${l}</option>`));

let user = null;
(async () => {
  ({ data: { user } } = await db.auth.getUser());
  if (!user) { form.style.display = "none"; gate.innerHTML = `Please <a href="login.html?next=post-house.html">log in</a> or <a href="signup.html">sign up</a> to list a house.`; }
})();

document.getElementById("p-geo").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Your browser can't share its location.");
  navigator.geolocation.getCurrentPosition((pos) => {
    document.getElementById("p-lat").value = pos.coords.latitude.toFixed(6);
    document.getElementById("p-lng").value = pos.coords.longitude.toFixed(6);
  }, () => alert("Couldn't get your location. Enter the coordinates by hand."));
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fail = (t) => { msg.className = "msg bad"; msg.textContent = t; };
  msg.className = "msg"; msg.textContent = "Posting...";
  const num = (id) => (val(id) === "" ? null : Number(val(id)));
  const { data: prop, error } = await db.from("properties").insert([{
    title: val("p-title"), rent: num("p-rent"), property_type: typeSel.value, area: val("p-area"), location: val("p-location") || null,
    bedrooms: num("p-beds"), bathrooms: num("p-baths"), contact_phone: val("p-phone"), description: val("p-desc") || null,
    amenities: val("p-amen").split(",").map((a) => a.trim()).filter(Boolean),
    latitude: num("p-lat"), longitude: num("p-lng"), host_id: user.id, status: "Available",
  }]).select("id").single();
  if (error) return fail("Couldn't post the listing: " + error.message);

  const files = [...document.getElementById("p-photos").files];
  const urls = [];
  for (const f of files) {
    const path = `${user.id}/${prop.id}-${Date.now()}-${f.name.replace(/[^\w.-]/g, "_")}`;
    const { error: uErr } = await db.storage.from(BUCKET).upload(path, f);
    if (uErr) return fail(`Listing saved, but a photo failed to upload (${uErr.message}). Check that the "${BUCKET}" bucket exists and is public.`);
    urls.push({ property_id: prop.id, image_url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
  }
  if (urls.length) { const { error: iErr } = await db.from("property_images").insert(urls); if (iErr) return fail("Photos uploaded, but saving them failed: " + iErr.message); }
  msg.className = "msg ok"; msg.textContent = "Listing posted. Redirecting...";
  setTimeout(() => location.href = `property.html?id=${prop.id}`, 900);
});

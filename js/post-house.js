// Create or edit a listing (edit mode: post-house.html?edit=<id>).
const BUCKET = "property-images";
const $p = (id) => document.getElementById(id);
const form = $p("post-form"), msg = $p("post-msg"), gate = $p("gate"), submitBtn = $p("post-submit"), photosEl = $p("p-photos"), previews = $p("photo-previews");
const editId = new URLSearchParams(location.search).get("edit");
let me, existing = [], removed = new Set(), picked = [], busy = false;

Object.entries(PROPERTY_TYPES).forEach(([v, l]) => $p("p-property_type").insertAdjacentHTML("beforeend", `<option value="${v}">${l}</option>`));
const FIELDS = ["title", "description", "rent", "property_type", "bedrooms", "area", "location", "amenities", "contact_phone", "latitude", "longitude"];
const read = () => Object.fromEntries(FIELDS.map((k) => [k, $p("p-" + k).value.trim()]));

$p("p-description").addEventListener("input", () => {
  const n = $p("p-description").value.length, c = $p("desc-count");
  c.textContent = `${n} / ${MigrateLib.LIMITS.descMax}`; c.classList.toggle("over", n > MigrateLib.LIMITS.descMax);
});

$p("p-geo").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("Your browser can't share its location. Enter the coordinates by hand.", true);
  navigator.geolocation.getCurrentPosition((pos) => {
    $p("p-latitude").value = pos.coords.latitude.toFixed(6); $p("p-longitude").value = pos.coords.longitude.toFixed(6);
    toast("Location filled in. Make sure you are standing at the house.");
  }, () => toast("Couldn't get your location. Enter the coordinates by hand.", true), { enableHighAccuracy: true, timeout: 10000 });
});

function renderPreviews() {
  const keep = existing.filter((i) => !removed.has(i.id));
  previews.innerHTML = keep.map((i) => `<li><img src="${esc(i.image_url)}" alt="Existing photo"><button type="button" class="x" data-rm-existing="${esc(i.id)}" aria-label="Remove this photo">&times;</button></li>`).join("")
    + picked.map((f, k) => `<li><img src="${f.url}" alt="New photo ${k + 1}"><button type="button" class="x" data-rm-new="${k}" aria-label="Remove new photo ${k + 1}">&times;</button></li>`).join("");
}
previews.addEventListener("click", (e) => {
  const a = e.target.closest("[data-rm-existing]"), b = e.target.closest("[data-rm-new]");
  if (a) removed.add(a.dataset.rmExisting);
  if (b) { const [f] = picked.splice(+b.dataset.rmNew, 1); URL.revokeObjectURL(f.url); }
  renderPreviews();
});

photosEl.addEventListener("change", async () => {
  const errs = [];
  for (const file of photosEl.files) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const type = MigrateLib.sniffImageType(head), problem = MigrateLib.validateImageMeta(file.size, type); // checks real bytes, not the extension
    if (problem) errs.push(`${file.name}: ${problem}`); else picked.push({ file, type, url: URL.createObjectURL(file) });
  }
  photosEl.value = "";
  $p("p-photos-err").textContent = errs.join(" ");
  renderPreviews();
});

const setBusy = (b, label) => { busy = b; submitBtn.disabled = b; submitBtn.textContent = b ? label : submitBtn.dataset.label; };
const fail = (t) => { msg.className = "msg bad"; msg.textContent = t; setBusy(false); };

async function init() {
  submitBtn.dataset.label = submitBtn.textContent;
  me = await getMe();
  if (!me.user) { form.hidden = true; gate.hidden = false; gate.innerHTML = `Please <a href="login.html?next=${encodeURIComponent("post-house.html" + location.search)}">log in</a> or <a href="signup.html">create a landlord account</a> to list a house.`; return; }
  if (me.role !== "landlord" && me.role !== "admin") { form.hidden = true; gate.hidden = false; gate.textContent = "Only landlord or agent accounts can post houses. Student accounts can browse and save houses."; return; }
  $p("p-contact_phone").value = me.profile?.phone ? me.profile.phone.replace(/^\+254/, "0") : "";

  if (editId) {
    $p("page-h").textContent = "Edit your listing"; submitBtn.textContent = "Save changes"; submitBtn.dataset.label = "Save changes";
    const { data: p, error } = await db.from("properties").select("*, property_images(id,image_url,storage_path,position)").eq("id", editId).maybeSingle();
    if (error || !p || (p.host_id !== me.user.id && me.role !== "admin")) { form.hidden = true; gate.hidden = false; gate.textContent = "This listing wasn't found, or you don't have permission to edit it."; return; }
    FIELDS.forEach((k) => { $p("p-" + k).value = k === "amenities" ? (p.amenities || []).join(", ") : p[k] ?? ""; });
    existing = (p.property_images || []).sort((a, b) => a.position - b.position);
    $p("p-description").dispatchEvent(new Event("input")); renderPreviews();
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return; // prevents duplicate submissions
  msg.className = "msg"; msg.textContent = "";
  const v = read();
  const imageCount = existing.filter((i) => !removed.has(i.id)).length + picked.length;
  const errs = MigrateLib.validateListing(v, imageCount);
  if (!showFieldErrors("p-", errs)) { msg.className = "msg bad"; msg.textContent = "Please fix the highlighted fields."; return; }
  setBusy(true, editId ? "Saving..." : "Posting...");

  const row = {
    title: v.title, description: v.description, rent: Number(v.rent), property_type: v.property_type, bedrooms: Number(v.bedrooms),
    area: v.area, location: v.location || null, contact_phone: "+" + MigrateLib.normalizeKenyanPhone(v.contact_phone),
    amenities: v.amenities.split(",").map((a) => a.trim()).filter(Boolean).slice(0, 20),
    latitude: v.latitude === "" ? null : Number(v.latitude), longitude: v.longitude === "" ? null : Number(v.longitude),
  };
  const uploaded = []; let propId = editId, created = false;
  try {
    if (editId) {
      const { error } = await db.from("properties").update(row).eq("id", editId);
      if (error) throw error;
    } else {
      const { data, error } = await db.from("properties").insert([{ ...row, host_id: me.user.id, status: "Available" }]).select("id").single();
      if (error) throw error; propId = data.id; created = true;
    }
    // Upload new photos (path is scoped to the user's own folder, which Storage policies enforce).
    for (const [k, f] of picked.entries()) {
      const path = `${me.user.id}/${propId}/${crypto.randomUUID()}.${f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg"}`;
      const { error } = await db.storage.from(BUCKET).upload(path, f.file, { contentType: f.type, upsert: false });
      if (error) throw error;
      uploaded.push({ property_id: propId, image_url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, storage_path: path, position: existing.length + k });
    }
    if (uploaded.length) { const { error } = await db.from("property_images").insert(uploaded); if (error) throw error; }
    if (removed.size) {
      const gone = existing.filter((i) => removed.has(i.id));
      const { error } = await db.from("property_images").delete().in("id", gone.map((i) => i.id)); if (error) throw error;
      const paths = gone.map((i) => i.storage_path).filter(Boolean); if (paths.length) await db.storage.from(BUCKET).remove(paths);
    }
  } catch (err) {
    // Roll back a half-created listing so the landlord never ends up with a photo-less ghost.
    if (created) { try { await db.from("properties").delete().eq("id", propId); } catch {} }
    if (uploaded.length) { try { await db.storage.from(BUCKET).remove(uploaded.map((u) => u.storage_path)); } catch {} }
    return fail(`Couldn't ${editId ? "save" : "post"} the listing. ${friendlyError(err)}`);
  }
  msg.className = "msg ok";
  msg.textContent = editId ? "Changes saved. Redirecting..." : "Listing submitted. It will appear publicly once an administrator approves it. Redirecting...";
  setTimeout(() => { location.href = "dashboard.html"; }, 1400);
});
init();

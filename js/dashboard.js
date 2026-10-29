// Landlord dashboard: own listings, real counts, edit, mark taken / restore, delete (with confirmation).
const $d = (id) => document.getElementById(id);
const listEl = $d("my-listings"), statsEl = $d("stats"), gateEl = $d("gate");
let me, rows = [];

async function load() {
  me = await getMe();
  if (!me.user) { location.replace("login.html?next=dashboard.html"); return; }
  if (me.role !== "landlord" && me.role !== "admin") { gateEl.hidden = false; gateEl.textContent = "The dashboard is for landlord and agent accounts."; $d("dash-body").hidden = true; return; }
  listEl.setAttribute("aria-busy", "true");
  const { data, error } = await db.from("properties")
    .select("id,title,rent,area,status,moderation_status,moderation_note,created_at,property_type,bedrooms,property_images(image_url,position)")
    .eq("host_id", me.user.id).order("created_at", { ascending: false });
  listEl.removeAttribute("aria-busy");
  if (error) { listEl.innerHTML = `<div class="error"><p>Couldn't load your listings. ${esc(friendlyError(error))}</p><button class="btn btn-outline" onclick="location.reload()">Try again</button></div>`; return; }
  rows = data; render();
}

function render() {
  const n = (f) => rows.filter(f).length;
  // Only real counts from the database; nothing invented.
  statsEl.innerHTML = [
    ["Total listings", rows.length], ["Available", n((p) => p.status === "Available" && p.moderation_status === "approved")],
    ["Taken", n((p) => p.status === "Taken")], ["Pending review", n((p) => p.moderation_status === "pending")],
  ].map(([l, v]) => `<div class="stat"><div class="stat-n">${v}</div><div class="stat-l">${l}</div></div>`).join("");

  if (!rows.length) { listEl.innerHTML = `<div class="empty"><h2>You haven't listed a house yet</h2><p>Add your first vacant house. It goes live after a quick administrator review.</p><a class="btn" href="post-house.html">Post a house</a></div>`; return; }
  listEl.innerHTML = rows.map((p) => {
    const taken = p.status === "Taken", img = sortedImages(p)[0];
    const note = p.moderation_status === "flagged" || p.moderation_status === "rejected" ? `<p class="notice small">${esc(MigrateLib.moderationLabel(p.moderation_status))}${p.moderation_note ? `: ${esc(p.moderation_note)}` : ""}</p>` : "";
    return `<article class="row-card" data-id="${esc(p.id)}">
      ${img ? `<img src="${esc(img)}" alt="" width="120" height="90" loading="lazy">` : `<div class="row-ph" aria-hidden="true">No photo</div>`}
      <div class="row-main"><h3><a href="property.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></h3>
        <div class="meta">${formatKES(p.rent)} / month &middot; ${esc(p.area || "")}</div>
        <div class="badges"><span class="badge ${taken ? "badge-taken" : "badge-ok"}">${taken ? "Taken" : "Available"}</span>
          <span class="badge badge-mod mod-${esc(p.moderation_status)}">${esc(MigrateLib.moderationLabel(p.moderation_status))}</span></div>${note}</div>
      <div class="row-actions">
        <a class="btn btn-outline btn-sm" href="post-house.html?edit=${encodeURIComponent(p.id)}">Edit</a>
        <button class="btn btn-outline btn-sm" data-act="toggle">${taken ? "Mark available" : "Mark as taken"}</button>
        <button class="btn btn-outline btn-sm btn-danger-o" data-act="delete">Delete</button>
      </div></article>`;
  }).join("");
}

listEl.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const id = b.closest("[data-id]").dataset.id, p = rows.find((r) => r.id === id); if (!p) return;
  if (b.dataset.act === "toggle") {
    const to = p.status === "Taken" ? "Available" : "Taken";
    if (to === "Taken" && !(await confirmDialog({ title: "Mark as taken?", body: `"${p.title}" will disappear from the public listings until you mark it available again.`, confirmLabel: "Mark as taken" }))) return;
    b.disabled = true;
    const { error } = await db.from("properties").update({ status: to }).eq("id", id).eq("host_id", me.user.id);
    b.disabled = false;
    if (error) { toast("Couldn't update the listing. " + friendlyError(error), true); return; } // UI untouched on failure
    p.status = to; render(); toast(to === "Taken" ? "Marked as taken." : "Marked as available.");
  } else if (b.dataset.act === "delete") {
    if (!(await confirmDialog({ title: "Delete this listing?", body: `"${p.title}" and its photos will be permanently deleted. This cannot be undone.`, confirmLabel: "Delete permanently", danger: true }))) return;
    b.disabled = true;
    const { data: imgs } = await db.from("property_images").select("storage_path").eq("property_id", id);
    const { error } = await db.from("properties").delete().eq("id", id).eq("host_id", me.user.id);
    if (error) { b.disabled = false; toast("Couldn't delete the listing. " + friendlyError(error), true); return; }
    const paths = (imgs || []).map((i) => i.storage_path).filter(Boolean);
    if (paths.length) db.storage.from("property-images").remove(paths).catch(() => {});
    rows = rows.filter((r) => r.id !== id); render(); toast("Listing deleted.");
  }
});
load();

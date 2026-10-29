// Admin moderation. Authorization is enforced by the database (is_admin() + RLS), not by this page.
const $m = (id) => document.getElementById(id);
const modList = $m("mod-list"), userList = $m("user-list"), tabs = document.querySelectorAll("[data-tab]");
let me, listings = [], users = [], filter = "pending";

async function init() {
  me = await getMe();
  if (!me.user) { location.replace("login.html?next=admin.html"); return; }
  if (me.role !== "admin") { $m("admin-body").hidden = true; $m("gate").hidden = false; $m("gate").textContent = "This page is for administrators only."; return; }
  await Promise.all([loadListings(), loadUsers()]);
}

async function loadListings() {
  modList.setAttribute("aria-busy", "true");
  const { data, error } = await db.from("properties")
    .select("id,title,description,rent,area,location,property_type,bedrooms,status,moderation_status,moderation_note,contact_name,contact_phone,created_at,property_images(image_url,position)")
    .order("created_at", { ascending: false }).limit(500);
  modList.removeAttribute("aria-busy");
  if (error) { modList.innerHTML = `<div class="error"><p>Couldn't load listings. ${esc(friendlyError(error))}</p></div>`; return; }
  listings = data; renderListings();
}

function renderListings() {
  const count = (s) => listings.filter((p) => p.moderation_status === s).length;
  document.querySelectorAll("[data-filter]").forEach((b) => {
    const s = b.dataset.filter; b.setAttribute("aria-pressed", String(s === filter));
    b.querySelector(".n").textContent = s === "all" ? listings.length : count(s);
  });
  const rows = filter === "all" ? listings : listings.filter((p) => p.moderation_status === filter);
  if (!rows.length) { modList.innerHTML = `<div class="empty"><p>No ${filter === "all" ? "" : esc(MigrateLib.moderationLabel(filter).toLowerCase()) + " "}listings.</p></div>`; return; }
  modList.innerHTML = rows.map((p) => {
    const img = sortedImages(p)[0];
    return `<article class="row-card" data-id="${esc(p.id)}">
      ${img ? `<img src="${esc(img)}" alt="" width="120" height="90" loading="lazy">` : `<div class="row-ph" aria-hidden="true">No photo</div>`}
      <div class="row-main"><h3><a href="property.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></h3>
        <div class="meta">${formatKES(p.rent)} / month &middot; ${esc(PROPERTY_TYPES[p.property_type] || "")} &middot; ${esc(p.area || "")}</div>
        <div class="meta small">Listed by ${esc(p.contact_name || "unknown")} &middot; ${esc(p.contact_phone || "no phone")} &middot; ${new Date(p.created_at).toLocaleDateString("en-KE")}</div>
        <p class="clamp">${esc(p.description || "")}</p>
        <div class="badges"><span class="badge badge-mod mod-${esc(p.moderation_status)}">${esc(MigrateLib.moderationLabel(p.moderation_status))}</span>
          <span class="badge ${p.status === "Taken" ? "badge-taken" : "badge-ok"}">${p.status === "Taken" ? "Taken" : "Available"}</span></div>
        ${p.moderation_note ? `<p class="meta small">Note: ${esc(p.moderation_note)}</p>` : ""}</div>
      <div class="row-actions">
        ${p.moderation_status !== "approved" ? `<button class="btn btn-sm" data-mod="approved">Approve</button>` : ""}
        ${p.moderation_status !== "flagged" ? `<button class="btn btn-outline btn-sm" data-mod="flagged">Flag</button>` : ""}
        ${p.moderation_status !== "rejected" ? `<button class="btn btn-outline btn-sm" data-mod="rejected">Reject</button>` : ""}
        <button class="btn btn-outline btn-sm btn-danger-o" data-mod="remove">Remove</button>
      </div></article>`;
  }).join("");
}

document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.filter; renderListings(); }));

modList.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-mod]"); if (!b) return;
  const id = b.closest("[data-id]").dataset.id, p = listings.find((x) => x.id === id), action = b.dataset.mod;
  if (action === "remove") {
    if (!(await confirmDialog({ title: "Remove this listing?", body: `"${p.title}" will be permanently deleted for everyone.`, confirmLabel: "Remove permanently", danger: true }))) return;
    b.disabled = true;
    const { error } = await db.from("properties").delete().eq("id", id);
    if (error) { b.disabled = false; toast("Couldn't remove it. " + friendlyError(error), true); return; }
    listings = listings.filter((x) => x.id !== id); renderListings(); toast("Listing removed."); return;
  }
  let note = null;
  if (action !== "approved") {
    note = (prompt(`Optional note for the landlord (why is this ${action}?)`, p.moderation_note || "") ?? null);
    if (note === null) return; // cancelled
    note = note.trim().slice(0, 300) || null;
  }
  b.disabled = true;
  const { error } = await db.from("properties").update({ moderation_status: action, moderation_note: action === "approved" ? null : note }).eq("id", id);
  b.disabled = false;
  if (error) { toast("Couldn't update the listing. " + friendlyError(error), true); return; }
  p.moderation_status = action; p.moderation_note = action === "approved" ? null : note; renderListings();
  toast(`Listing ${action}.`);
});

async function loadUsers() {
  const { data, error } = await db.from("profiles").select("id,full_name,phone,role,created_at").order("created_at", { ascending: false }).limit(500);
  if (error) { userList.innerHTML = `<div class="error"><p>Couldn't load users. ${esc(friendlyError(error))}</p></div>`; return; }
  users = data; renderUsers();
}
function renderUsers() {
  userList.innerHTML = `<div class="table-wrap"><table><caption class="sr-only">Registered users</caption><thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Role</th><th scope="col">Joined</th></tr></thead><tbody>${
    users.map((u) => `<tr><td>${esc(u.full_name || "(no name)")}</td><td>${esc(u.phone || "")}</td><td>${u.role === "admin" || u.id === me.user.id
      ? `<span class="badge badge-mod">${esc(u.role)}</span>`
      : `<label class="sr-only" for="r-${esc(u.id)}">Role for ${esc(u.full_name || "user")}</label><select id="r-${esc(u.id)}" data-user="${esc(u.id)}"><option value="student"${u.role === "student" ? " selected" : ""}>student</option><option value="landlord"${u.role === "landlord" ? " selected" : ""}>landlord</option></select>`}</td><td>${u.created_at ? new Date(u.created_at).toLocaleDateString("en-KE") : ""}</td></tr>`).join("")
  }</tbody></table></div><p class="meta small">Administrator accounts can only be granted directly in the database (see README), never from this page.</p>`;
}
userList.addEventListener("change", async (e) => {
  const s = e.target.closest("[data-user]"); if (!s) return;
  const u = users.find((x) => x.id === s.dataset.user), prev = u.role;
  const { error } = await db.from("profiles").update({ role: s.value }).eq("id", u.id);
  if (error) { s.value = prev; toast("Couldn't change the role. " + friendlyError(error), true); return; }
  u.role = s.value; toast("Role updated.");
});

tabs.forEach((t) => t.addEventListener("click", () => {
  tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
  $m("panel-listings").hidden = t.dataset.tab !== "listings"; $m("panel-users").hidden = t.dataset.tab !== "users";
}));
init();

// Role-aware navigation. Hiding links is only a convenience; real access control lives in the database (RLS).
(async function () {
  const nav = document.getElementById("nav");
  if (!nav) return;
  const page = location.pathname.split("/").pop() || "index.html";
  const link = (h, t, c = "") => `<a href="${h}" class="${c}"${page === h ? ' aria-current="page"' : ""}>${t}</a>`;
  const publicLinks = link("index.html", "Home") + link("listings.html", "Browse houses");
  const render = (inner) => {
    nav.innerHTML = `<button class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="nav-links" aria-label="Menu"><span></span></button><div class="nav-links" id="nav-links">${inner}</div>`;
    const t = document.getElementById("nav-toggle");
    t.addEventListener("click", () => { const o = nav.classList.toggle("open"); t.setAttribute("aria-expanded", String(o)); });
    nav.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.classList.contains("open")) { nav.classList.remove("open"); t.setAttribute("aria-expanded", "false"); t.focus(); } });
  };
  render(publicLinks + link("login.html", "Log in") + link("signup.html", "Sign up", "btn"));

  const me = await getMe();
  if (!me.user) return;
  const name = me.profile?.full_name?.split(" ")[0] || "Account";
  let items = publicLinks;
  if (me.role === "student") items += link("favorites.html", "Favourites");
  if (me.role === "landlord") items += link("dashboard.html", "My listings") + link("post-house.html", "Post a house", "btn");
  if (me.role === "admin") items += link("admin.html", "Admin") + link("dashboard.html", "My listings");
  items += `<span class="hi">Hi, ${esc(name)}</span><a href="#" id="logout">Log out</a>`;
  render(items);
  document.getElementById("logout").addEventListener("click", async (e) => {
    e.preventDefault();
    await db.auth.signOut();
    location.href = "index.html";
  });
})();

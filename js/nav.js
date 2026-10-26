(async function () {
  const nav = document.getElementById("nav");
  if (!nav) return;
  const page = location.pathname.split("/").pop() || "index.html";
  const link = (h, t, c = "") => `<a href="${h}" class="${c}"${page === h ? ' aria-current="page"' : ""}>${t}</a>`;
  const base = link("index.html", "Home") + link("listings.html", "Browse houses") + link("favorites.html", "Saved");
  const post = link("post-house.html", "Post a house", "btn");
  nav.innerHTML = base + link("login.html", "Log in") + post;

  const { data: { session } } = await db.auth.getSession();
  if (!session) return;
  const { data: profile } = await db.from("profiles").select("full_name").eq("id", session.user.id).maybeSingle();
  const name = profile?.full_name?.split(" ")[0] || "Account";
  nav.innerHTML = base + `<span class="hi">Hi, ${esc(name)}</span><a href="#" id="logout">Log out</a>` + post;
  document.getElementById("logout").addEventListener("click", async (e) => {
    e.preventDefault();
    await db.auth.signOut();
    location.href = "index.html";
  });
})();

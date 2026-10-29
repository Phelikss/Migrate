// Login + signup. Passwords are handled entirely by Supabase Auth (never stored or logged here).
const $a = (id) => document.getElementById(id);
const safeNext = () => { const n = new URLSearchParams(location.search).get("next") || "index.html"; return /^[\w\-./?=&%]+$/.test(n) && !n.startsWith("//") && !/^[a-z]+:/i.test(n) ? n : "index.html"; };
function setBusy(btn, busy, label) { btn.disabled = busy; btn.textContent = busy ? label : btn.dataset.label; }

const loginForm = $a("login-form");
if (loginForm) {
  const btn = loginForm.querySelector("button[type=submit]"); btn.dataset.label = btn.textContent;
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $a("auth-msg"); msg.className = "msg";
    const email = $a("l-email").value.trim(), password = $a("l-password").value;
    const errs = {};
    if (!email) errs.email = "Enter your email address."; else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errs.email = "Enter a valid email address.";
    if (!password) errs.password = "Enter your password.";
    if (!showFieldErrors("l-", errs)) return;
    setBusy(btn, true, "Logging in...");
    try {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) {
        msg.className = "msg bad";
        msg.textContent = /invalid login/i.test(error.message) ? "Email or password is incorrect."
          : /confirm/i.test(error.message) ? "Please confirm your email first. Check your inbox for the link." : friendlyError(error);
        return;
      }
      msg.className = "msg ok"; msg.textContent = "Logged in. Redirecting...";
      location.href = safeNext();
    } catch (err) { msg.className = "msg bad"; msg.textContent = friendlyError(err); }
    finally { if (!/Redirecting/.test(msg.textContent)) setBusy(btn, false); }
  });
}

const signupForm = $a("signup-form");
if (signupForm) {
  const btn = signupForm.querySelector("button[type=submit]"); btn.dataset.label = btn.textContent;
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $a("auth-msg"); msg.className = "msg";
    const v = { name: $a("s-name").value, email: $a("s-email").value, phone: $a("s-phone").value, role: $a("s-role").value, password: $a("s-password").value, confirm: $a("s-confirm").value };
    if (!showFieldErrors("s-", MigrateLib.validateSignup(v))) return;
    setBusy(btn, true, "Creating account...");
    try {
      const { data, error } = await db.auth.signUp({
        email: v.email.trim(), password: v.password,
        options: { data: { full_name: v.name.trim(), phone: "+" + MigrateLib.normalizeKenyanPhone(v.phone), university: "Presbyterian University of East Africa", role: v.role } },
      });
      if (error) {
        msg.className = "msg bad";
        msg.textContent = /already|registered/i.test(error.message) ? "An account with this email already exists. Try logging in." : /password/i.test(error.message) ? error.message : friendlyError(error);
        return;
      }
      // Supabase returns a user with no identities when the email is already registered (to avoid leaking accounts).
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        msg.className = "msg bad"; msg.textContent = "An account with this email already exists. Try logging in."; return;
      }
      // The database trigger creates the profile from the metadata; role is restricted to student/landlord server-side.
      if (data.session) { msg.className = "msg ok"; msg.textContent = "Account created. Redirecting..."; location.href = v.role === "landlord" ? "dashboard.html" : "listings.html"; }
      else { msg.className = "msg ok"; msg.textContent = "Account created. Check your email to confirm it, then log in."; signupForm.reset(); }
    } catch (err) { msg.className = "msg bad"; msg.textContent = friendlyError(err); }
    finally { if (!/Redirecting/.test(msg.textContent)) setBusy(btn, false); }
  });
}

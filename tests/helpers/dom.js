// jsdom page harness with an in-memory fake Supabase client that mimics the RLS visibility rules.
// This exercises the REAL page scripts. It is NOT a real browser and NOT a real Supabase project.
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "../..");

const U = { landlord: "u-landlord", other: "u-other", student: "u-student", admin: "u-admin" };
const CAMPUS = { lat: -1.2196, lng: 36.6676 };
function fixtures() {
  const mk = (o) => ({ host_id: U.landlord, rent: 7000, property_type: "bedsitter", bedrooms: 0, area: "Thogoto", location: "", description: "d", amenities: ["WiFi"],
    latitude: CAMPUS.lat + 0.005, longitude: CAMPUS.lng, status: "Available", moderation_status: "approved", contact_phone: "+254711111111", contact_name: "Lena", created_at: "2026-10-01T00:00:00Z", ...o });
  return {
    profiles: [
      { id: U.landlord, full_name: "Lena Landlord", phone: "+254711111111", role: "landlord", created_at: "2026-01-01" },
      { id: U.other, full_name: "Olu Other", phone: "+254733333333", role: "landlord", created_at: "2026-01-02" },
      { id: U.student, full_name: "Sam Student", phone: "+254722222222", role: "student", created_at: "2026-01-03" },
      { id: U.admin, full_name: "Ada Admin", phone: "+254744444444", role: "admin", created_at: "2026-01-04" },
    ],
    properties: [
      mk({ id: "p1", title: "Cosy bedsitter", rent: 7000, created_at: "2026-10-03T00:00:00Z" }),
      mk({ id: "p2", title: "Big one bedroom", rent: 12000, property_type: "one_bedroom", bedrooms: 1, latitude: -1.3, longitude: 36.9, area: "Kikuyu town", created_at: "2026-10-02T00:00:00Z" }),
      mk({ id: "p3", title: "Taken place", status: "Taken" }),
      mk({ id: "p4", title: "Pending place", moderation_status: "pending" }),
      mk({ id: "p5", title: "<img src=x onerror=window.__xss=1>Evil", rent: 5000, created_at: "2026-10-04T00:00:00Z" }),
      mk({ id: "p6", title: "Other landlord house", host_id: U.other, moderation_status: "pending" }),
    ],
    property_images: [{ id: "i1", property_id: "p1", image_url: "https://img.example/p1.jpg", position: 0, storage_path: "u/p1/a.jpg" }],
    favorites: [],
  };
}

function makeFake(state, ctl) {
  const uid = () => ctl.user;
  const role = () => state.profiles.find((p) => p.id === uid())?.role;
  const visible = (table, row) => {
    if (table === "properties") return row.moderation_status === "approved" || row.host_id === uid() || role() === "admin";
    if (table === "profiles") return row.id === uid() || role() === "admin";
    if (table === "favorites") return row.user_id === uid();
    return true;
  };
  const decorate = (table, row, sel) => {
    const out = { ...row };
    if (table === "properties" && /property_images/.test(sel || "")) out.property_images = state.property_images.filter((i) => i.property_id === row.id);
    if (table === "favorites" && /properties:property_id/.test(sel || "")) { const p = state.properties.find((x) => x.id === row.property_id); out.properties = p && visible("properties", p) ? decorate("properties", p, "property_images") : null; }
    return out;
  };
  function builder(table) {
    const st = { op: "select", filters: [], sel: "", order: null, limit: null, single: false, maybe: false, payload: null, opts: {} };
    const run = () => {
      ctl.calls.push({ table, op: st.op, filters: st.filters.map((f) => f.slice(0, 3)), payload: st.payload });
      if (ctl.failNext && ctl.failNext.test(st.op + ":" + table)) { ctl.failNext = null; return { data: null, error: { message: "Failed to fetch" } }; }
      const rows = state[table];
      const match = (r) => st.filters.every(([k, op, v]) => (op === "eq" ? r[k] === v : op === "in" ? v.includes(r[k]) : true));
      if (st.op === "select") {
        let out = rows.filter((r) => visible(table, r) && match(r));
        if (st.order) out.sort((a, b) => (st.order.asc ? 1 : -1) * (a[st.order.k] > b[st.order.k] ? 1 : a[st.order.k] < b[st.order.k] ? -1 : 0));
        if (st.limit) out = out.slice(0, st.limit);
        out = out.map((r) => decorate(table, r, st.sel));
        if (st.single || st.maybe) return { data: out[0] ?? null, error: !out[0] && st.single ? { message: "not found" } : null };
        return { data: out, error: null };
      }
      if (st.op === "insert" || st.op === "upsert") {
        const added = [];
        for (const p of [].concat(st.payload)) {
          if (table === "favorites") {
            if (p.user_id !== uid()) return { data: null, error: { message: "new row violates row-level security policy" } };
            if (rows.some((r) => r.user_id === p.user_id && r.property_id === p.property_id)) { if (st.op === "upsert") continue; return { data: null, error: { message: "duplicate key value" } }; }
          }
          if (table === "properties") {
            if (!["landlord", "admin"].includes(role())) return { data: null, error: { message: "new row violates row-level security policy" } };
            p.moderation_status = "pending"; p.id = p.id || "new" + rows.length; p.created_at = new Date().toISOString();
          }
          const row = { id: "r" + Math.random().toString(36).slice(2, 8), ...p }; rows.push(row); added.push(row);
        }
        return { data: st.single ? added[0] : added, error: null };
      }
      const targets = rows.filter((r) => visible(table, r) && match(r) && (table !== "properties" || r.host_id === uid() || role() === "admin"));
      if (st.op === "update") {
        targets.forEach((r) => { const p = { ...st.payload }; if (table === "properties" && role() !== "admin") { delete p.moderation_status; delete p.moderation_note; delete p.host_id; } Object.assign(r, p); });
        return { data: targets, error: null };
      }
      if (st.op === "delete") { targets.forEach((r) => rows.splice(rows.indexOf(r), 1)); return { data: targets, error: null }; }
    };
    const api = {
      select(s) { st.sel = s || st.sel; return api; }, eq(k, v) { st.filters.push([k, "eq", v]); return api; }, in(k, v) { st.filters.push([k, "in", v]); return api; },
      order(k, o = {}) { st.order = { k, asc: o.ascending !== false }; return api; }, limit(n) { st.limit = n; return api; },
      single() { st.single = true; return api; }, maybeSingle() { st.maybe = true; return api; },
      insert(p) { st.op = "insert"; st.payload = p; return api; }, update(p) { st.op = "update"; st.payload = p; return api; },
      upsert(p, o) { st.op = "upsert"; st.payload = p; st.opts = o; return api; }, delete() { st.op = "delete"; return api; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    return api;
  }
  return {
    createClient: () => ({
      from: builder,
      auth: {
        getSession: async () => ({ data: { session: uid() ? { user: { id: uid() } } : null } }),
        getUser: async () => ({ data: { user: uid() ? { id: uid() } : null } }),
        signUp: async (a) => { ctl.signUps.push(a); return ctl.signUpResult || { data: { user: { identities: [{}] }, session: null }, error: null }; },
        signInWithPassword: async (a) => { ctl.signIns.push(a); return ctl.signInResult || { data: {}, error: { message: "Invalid login credentials" } }; },
        signOut: async () => { ctl.user = null; },
      },
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), getPublicUrl: (p) => ({ data: { publicUrl: "https://img.example/" + p } }) }) },
    }),
  };
}

// Load a page with its real local scripts inlined (so top-level const/let behave like in a browser). CDN scripts are replaced by the fake.
async function loadPage(file, { user = null, search = "", failNext = null, state = fixtures(), confirm = "ok" } = {}) {
  const ctl = { user, calls: [], signUps: [], signIns: [], failNext };
  let html = fs.readFileSync(path.join(root, file), "utf8");
  html = html.replace(/<script src="https?:[^"]*"><\/script>/g, "");
  html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, src) => `<script>${fs.readFileSync(path.join(root, src), "utf8")}</script>`);
  html = html.replace(/<link[^>]*>/g, "");
  const errors = [];
  const dom = new JSDOM(html, {
    url: `http://localhost/${file}${search}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.supabase = makeFake(state, ctl);
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); queueMicrotask(() => { this.returnValue = confirm; this.removeAttribute("open"); this.dispatchEvent(new w.Event("close")); }); };
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      w.addEventListener("error", (e) => errors.push(e.error || e.message));
      w.crypto.randomUUID = w.crypto.randomUUID || (() => "uuid-" + Math.random().toString(36).slice(2));
    },
  });
  const w = dom.window;
  const settle = async (cond, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!cond || cond()) { await new Promise((r) => setTimeout(r, 15)); return; } await new Promise((r) => setTimeout(r, 15)); } throw new Error("timeout waiting for condition: " + cond); };
  return { w, d: w.document, ctl, state, errors, settle, close: () => w.close() };
}
const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
module.exports = { loadPage, fixtures, text, U };

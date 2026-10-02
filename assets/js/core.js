// Shared plumbing: DOM helpers, formatting, storage, the API client and the few bits of state every module reads.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
export const f2 = (v) => (v == null ? "–" : v.toFixed(2));
export const pct = (v) => (v == null ? "–" : Math.round(v * 100) + "%");
export const fmt = (n) => (n ?? 0).toLocaleString();
export const MOB = () => matchMedia("(max-width:640px)").matches;
export const lastName = (n) => n.split(/\s+/).slice(-1)[0];
export const sameName = (a, b) => {
  const pa = a.toUpperCase().split(/\s+/), pb = b.toUpperCase().split(/\s+/);
  return pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1];
};

export const store = {
  get(k, d) { try { const v = localStorage.getItem("uwcl." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("uwcl." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/** Tiny pub/sub so modules do not import each other in circles. */
const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

// State filled in by main.boot()
export const app = { tab: "courses", meta: null, term: 0, first: 2006, campusDist: [1, 1, 1, 1, 1, 1, 1], campusTotal: 7, campusGpa: null, insights: {}, designations: [] };

const cfg = window.UWCL || {};
export const API = (new URLSearchParams(location.search).get("api") || cfg.api || "").replace(/\/$/, "");
export const BASE = new URL(".", location.href).href;

export async function api(path, params, opts = {}) {
  const u = new URL(API + path, location.href);
  if (params) u.search = new URLSearchParams(params).toString();
  const r = await fetch(u, { headers: { Accept: "application/json", ...(opts.body ? { "Content-Type": "application/json" } : {}) }, ...opts });
  if (!r.ok) {
    const e = new Error("HTTP " + r.status); e.status = r.status;
    try { e.body = await r.json(); } catch { /* no body */ }
    throw e;
  }
  return r.json();
}

// Course records: list rows are slim, details are full; both get the same defaults
export const ROW = {}, DET = {};
export const rec = (id) => DET[id] || ROW[id];
export const fill = (c) => {
  c.al ||= []; c.br ||= []; c.ins ||= []; c.rd ||= []; c.terms ||= [];
  c.m ||= 0; c.pos ||= 0; c.neg ||= 0; c.rdn ||= 0; c.n ||= 0; c.es ||= 0; c.sn ??= ""; c.t ??= "";
  return c;
};
const detailReq = {};
export function loadDetail(id) {
  if (DET[id]) return Promise.resolve(DET[id]);
  return (detailReq[id] ||= api("/api/course/" + encodeURIComponent(id)).then((c) => (DET[id] = fill(c))).finally(() => { delete detailReq[id]; }));
}
export async function loadRows(ids) {
  const need = ids.filter((id) => !rec(id));
  for (let i = 0; i < need.length; i += 60) {
    const r = await api("/api/courses", { ids: need.slice(i, i + 60).join(",") });
    r.rows.forEach((x) => { ROW[x.id] = fill(x); });
  }
}

export const G = ["A", "AB", "B", "BC", "C", "D", "F"];
export const GV = ["--gA", "--gAB", "--gB", "--gBC", "--gC", "--gD", "--gF"];

// Links out
export const mgUrl = (c) => (c.mg ? "https://madgrades.com/courses/" + c.mg : "https://madgrades.com/search?query=" + encodeURIComponent(c.code));
export const enrollUrl = (code) => "https://public.enroll.wisc.edu/search?term=" + app.term + "&keywords=" + encodeURIComponent(code);
export const guideUrl = (code) => "https://guide.wisc.edu/search/?P=" + encodeURIComponent(code);
export const rmpUrl = (n) => "https://www.ratemyprofessors.com/search/professors/18418?q=" + encodeURIComponent(n);
export const redditUrl = (c) => "https://www.reddit.com/r/UWMadison/search/?q=" + encodeURIComponent('"' + c.code + '"');

// Tooltip: any element with data-tip
const tip = document.createElement("div");
tip.className = "tip"; tip.setAttribute("aria-hidden", "true");
document.body.append(tip);
function moveTip(e) {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
export const hideTip = () => tip.classList.remove("on");
document.addEventListener("pointerover", (e) => { const el = e.target.closest("[data-tip]"); if (el) { tip.innerHTML = el.dataset.tip; tip.classList.add("on"); moveTip(e); } });
document.addEventListener("pointermove", (e) => { if (tip.classList.contains("on")) moveTip(e); });
document.addEventListener("pointerout", (e) => { const el = e.target.closest("[data-tip]"); if (el && !el.contains(e.relatedTarget)) hideTip(); });

/** Plan state shared by the list stars, the drawer and the Plan tab. */
const saved = store.get("plan", null) || { must: store.get("saved", []) };
export const plan = {
  must: new Set((saved.must || []).filter((id) => typeof id === "string")),
  done: new Set(saved.done || []),
  ip: new Set(saved.ip || []),
  program: saved.program || "",
  credits: saved.credits || 15,
  fill: saved.fill !== false,
  prefs: saved.prefs || {},
  save() { store.set("plan", { must: [...this.must], done: [...this.done], ip: [...this.ip], program: this.program, credits: this.credits, fill: this.fill, prefs: this.prefs }); },
  toggle(id) { this.must.has(id) ? this.must.delete(id) : this.must.add(id); this.save(); emit("plan"); },
  add(id) { if (!this.must.has(id)) { this.must.add(id); this.save(); emit("plan"); } },
  remove(id) { if (this.must.delete(id)) { this.save(); emit("plan"); } },
};

// Course reviews: write one, ask others for one, and the tab listing the courses people asked about most.
// No login. One review and one ask per device and course (the server enforces it; this device remembers too).
import { $, $$, esc, api, app, store, on, emit, loadDetail, loadRows, rec } from "./core.js";
import { t } from "./i18n.js";

const HOURS = ["0–3", "3–6", "6–9", "9–12", "12+"];
const TAGS = ["final", "midterm", "paper", "project", "homework", "participation"];

const device = (() => {
  let d = store.get("dev", "");
  if (typeof d !== "string" || d.length < 16) {
    d = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
    store.set("dev", d);
  }
  return d;
})();
const reviewed = new Set(store.get("reviewed", []));
const asked = new Set(store.get("asked", []));
const remember = () => { store.set("reviewed", [...reviewed]); store.set("asked", [...asked]); };
const post = (path, body) => api(path, null, { method: "POST", body: JSON.stringify({ ...body, dev: device }) });

const cache = new Map();   // course id -> { at, data }
let curCourse = null, justSent = null;
const summary = (id) => {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return Promise.resolve(hit.data);
  return api("/api/reviews", { course: id }).then((d) => { cache.set(id, { at: Date.now(), data: d }); return d; });
};

/* ── Drawer section ──────────────────────────────────────── */
function draw(el, c, d) {
  const id = c.id;
  let h = `<h3>${esc(t("rvTitle"))} <span class="muted">${d.n || ""}</span></h3>`;
  if (d.n) {
    const mx = Math.max(1, ...d.hours);
    h += `<div class="rv-hours">` + d.hours.map((n, i) => `<div class="rv-hb" data-tip="${esc(HOURS[i])} · ${n}"><i style="height:${Math.round((n / mx) * 40) + (n ? 2 : 0)}px"></i><span>${HOURS[i]}</span></div>`).join("") + `</div>`;
    const a = d.attend.yes + d.attend.no;
    if (a) h += `<p class="rv-line">${esc(t("rvAttendPct", Math.round((100 * d.attend.yes) / a)))}</p>`;
    const tg = TAGS.filter((k) => d.tags[k]);
    if (tg.length) h += `<p class="rv-tags">` + tg.map((k) => `<span class="rv-tag">${esc(t("rvt_" + k))} <b>${d.tags[k]}</b></span>`).join("") + `</p>`;
    if (d.items.length) h += `<ul class="rv-items">` + d.items.map((x) => `<li><p>${esc(x.text)}</p>${x.instr ? `<span class="muted small">${esc(x.instr)}</span>` : ""}</li>`).join("") + `</ul>`;
  }
  const done = reviewed.has(id), sent = justSent === id;
  h += `<div class="rv-act"><button class="btn primary" data-rv="write"${done ? " disabled" : ""}>${done ? "✓ " : ""}${esc(t("rvWrite"))}</button>` +
    `<button class="btn" data-rv="ask"${asked.has(id) ? " disabled" : ""}>${esc(t(asked.has(id) ? "rvAsked" : "rvAsk"))}${d.asks ? ` · ${d.asks}` : ""}</button></div>`;
  if (sent) h += `<p class="muted small rv-sent">${esc(t("rvSent"))}</p>`;
  el.innerHTML = `<div class="d-sec">${h}</div>`;
  el.dataset.id = id;
  el.querySelector('[data-rv="write"]').onclick = () => openForm(id);
  el.querySelector('[data-rv="ask"]').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await post("/api/ask", { course: id });
      asked.add(id); remember();
      cache.set(id, { at: Date.now(), data: { ...d, asks: r.asks } });
    } catch { e.currentTarget.disabled = false; return; }
    emit("reviews");
  };
}

/** Fill #dRev in the open drawer; stays empty when the reviews service is unreachable. */
export function mount(c) {
  curCourse = c;
  const el = $("#dRev");
  if (!el) return;
  const hit = cache.get(c.id);
  if (hit) draw(el, c, hit.data);
  summary(c.id).then((d) => { const e = $("#dRev"); if (e && curCourse === c) draw(e, c, d); }).catch(() => {});
}

/* ── Form ────────────────────────────────────────────────── */
export async function openForm(id) {
  let c;
  try { c = await loadDetail(id); } catch { return; }
  const names = [...new Set([...(c.now && c.now.who ? c.now.who : []), ...c.ins.map((i) => i[0])])].slice(0, 60);
  const chips = (k, items) => items.map(([v, label]) => `<button type="button" class="rv-chip" data-k="${k}" data-v="${v}" aria-pressed="false">${esc(label)}</button>`).join("");
  $("#rvDlg")?.remove();
  const dlg = document.createElement("dialog");
  dlg.id = "rvDlg"; dlg.className = "rv-dlg";
  dlg.setAttribute("aria-labelledby", "rvH");
  dlg.innerHTML = `<form novalidate>
    <div class="rv-hd"><b id="rvH">${esc(c.code)} <span class="muted">${esc(c.t)}</span></b><button type="button" class="x" data-x aria-label="${esc(t("rvClose"))}">×</button></div>
    ${names.length ? `<label class="rv-l"><span>${esc(t("rvInstr"))}</span><select name="instr"><option value="">–</option>${names.map((n) => `<option>${esc(n)}</option>`).join("")}</select></label>` : ""}
    <div class="rv-l"><span>${esc(t("rvHours"))}</span><div class="rv-chips">${chips("hours", HOURS.map((x, i) => [i, x]))}</div></div>
    <div class="rv-l"><span>${esc(t("rvAttend"))}</span><div class="rv-chips">${chips("attend", [[1, t("rvYes")], [0, t("rvNo")]])}</div></div>
    <div class="rv-l"><span>${esc(t("rvGrade"))}</span><div class="rv-chips">${chips("tags", TAGS.map((k) => [k, t("rvt_" + k)]))}</div></div>
    <textarea name="text" maxlength="400" rows="3" aria-label="${esc(t("rvText"))}"></textarea>
    <p class="rv-st" role="status" aria-live="polite"></p>
    <div class="rv-foot"><button class="btn primary" type="submit" disabled>${esc(t("rvSubmit"))}</button></div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector("form"), go = form.querySelector('[type="submit"]'), st = form.querySelector(".rv-st");
  const sel = { hours: null, attend: null, tags: new Set() };
  const ready = () => { go.disabled = sel.hours == null && sel.attend == null && !sel.tags.size && !form.text.value.trim(); };
  form.onclick = (e) => {
    if (e.target.closest("[data-x]")) { dlg.close(); return; }
    const b = e.target.closest(".rv-chip");
    if (!b) return;
    const k = b.dataset.k, v = b.dataset.v;
    if (k === "tags") { sel.tags.has(v) ? sel.tags.delete(v) : sel.tags.add(v); b.setAttribute("aria-pressed", String(sel.tags.has(v))); }
    else {
      const on = sel[k] === +v;
      sel[k] = on ? null : +v;
      form.querySelectorAll(`.rv-chip[data-k="${k}"]`).forEach((x) => x.setAttribute("aria-pressed", String(sel[k] === +x.dataset.v)));
    }
    ready();
  };
  form.text.oninput = ready;
  form.onsubmit = async (e) => {
    e.preventDefault();
    go.disabled = true; st.textContent = "";
    const body = { course: c.id };
    if (form.instr && form.instr.value) body.instr = form.instr.value;
    if (sel.hours != null) body.hours = sel.hours;
    if (sel.attend != null) body.attend = sel.attend;
    if (sel.tags.size) body.tags = [...sel.tags];
    if (form.text.value.trim()) body.text = form.text.value;
    try { await post("/api/review", body); justSent = c.id; }
    catch (err) {
      if (err.status !== 409) { st.textContent = t("rvFail"); go.disabled = false; return; }
    }
    reviewed.add(c.id); remember(); cache.delete(c.id);
    dlg.close();
    emit("reviews");
  };
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}

/* ── Tab: courses people asked about, most asked first ───── */
export async function renderTab() {
  const el = $("#v-reviews");
  let rows;
  try {
    rows = (await api("/api/review-requests")).rows.filter((r) => !reviewed.has(r.id));
    await loadRows(rows.map((r) => r.id).slice(0, 100));
  } catch { el.innerHTML = `<div class="empty">${esc(t("apiError"))}</div>`; return; }
  if (app.tab !== "reviews") return;
  rows = rows.filter((r) => rec(r.id));
  el.innerHTML = rows.length
    ? `<div class="list rv-list">` + rows.map((r) => { const c = rec(r.id); return `<button class="rv-row" data-id="${esc(r.id)}"><b>${esc(c.code)}</b><span class="title">${esc(c.t)}</span><span class="rv-n">${esc(t("rvAskN", r.asks))}</span></button>`; }).join("") + `</div>`
    : `<div class="empty">${esc(t("rvNone"))}</div>`;
  $$(".rv-row", el).forEach((b) => (b.onclick = () => openForm(b.dataset.id)));
}

on("reviews", () => {
  if (app.tab === "reviews") renderTab();
  if (curCourse && $("#dRev")) mount(curCourse);
});

// Course reviews: write one, ask others for one, and the tab listing the courses people asked about most.
// No login. One review and one ask per device and course (the server enforces it; this device remembers too).
import { $, $$, esc, api, app, store, on, emit, loadDetail, loadRows, rec, plan, ROW, fill } from "./core.js";
import { t, LANG } from "./i18n.js";

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
let curCourse = null, justSent = null, justAsked = null, drawn = null;
const summary = (id) => {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return Promise.resolve(hit.data);
  return api("/api/reviews", { course: id }).then((d) => { cache.set(id, { at: Date.now(), data: d }); return d; });
};

/* ── Drawer section ──────────────────────────────────────── */
function draw(c, d) {
  const id = c.id, top = $("#dRevTop"), el = $("#dRev");
  if (!top || !el) return;
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
  el.innerHTML = d.n ? `<div class="d-sec">${h}</div>` : "";
  const done = reviewed.has(id), isAsked = asked.has(id);
  const landed = justAsked && justAsked.id === id && Date.now() - justAsked.at < 2000;
  const undo = (k) => `<button class="linkbtn rv-undo" data-rv="${k}">${esc(t("rvUndo"))}</button>`;
  top.innerHTML = `<div class="rv-act">` +
    `<span class="rv-pair"><button class="btn rv-ask" data-rv="ask"${isAsked ? " disabled" : ""}>${esc(t(isAsked ? "rvAsked" : "rvAsk"))}${d.asks ? ` · ${d.asks}` : ""}</button>${isAsked ? undo("unask") : ""}</span>` +
    `<span class="rv-pair"><button class="btn primary" data-rv="write"${done ? " disabled" : ""}>${done ? "✓ " : ""}${esc(t(done ? "rvWritten" : "rvWrite"))}</button>${done ? undo("unreview") : ""}</span>` +
    `<a class="rv-hint" href="#/reviews">${esc(t("rvHint"))}</a></div>`;
  top.dataset.id = id; drawn = { id, d };
  const on_ = (k, fn) => { const b = top.querySelector(`[data-rv="${k}"]`); if (b) b.onclick = fn; };
  on_("write", () => openForm(id));
  on_("ask", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await post("/api/ask", { course: id });
      asked.add(id); remember(); justAsked = { id, at: Date.now() };
      cache.set(id, { at: Date.now(), data: { ...d, asks: r.asks } });
    } catch { e.currentTarget.disabled = false; return; }
    emit("reviews");
  });
  on_("unask", async () => {
    try {
      const r = await post("/api/ask/undo", { course: id });
      asked.delete(id); remember(); justAsked = null;
      cache.set(id, { at: Date.now(), data: { ...d, asks: r.asks } });
    } catch { return; }
    emit("reviews");
  });
  on_("unreview", async () => {
    try { await post("/api/review/undo", { course: id }); } catch { return; }
    reviewed.delete(id); remember(); cache.delete(id);
    emit("reviews");
  });
  if (landed && !matchMedia("(prefers-reduced-motion: reduce)").matches) burst(top.querySelector(".rv-pair"));
}

/** A few small emoji float up from the button that was just pressed. */
function burst(host) {
  if (!host) return;
  ["🙋", "💬", "✨", "🙌", "💬", "✨"].forEach((e, i) => {
    const s = document.createElement("span");
    s.className = "rv-fly"; s.textContent = e;
    s.style.left = 8 + i * 15 + "%"; s.style.animationDelay = i * 70 + "ms";
    host.append(s);
    setTimeout(() => s.remove(), 1700);
  });
}

/** Fill #dRevTop (buttons) and #dRev (summary) in the open drawer; both stay empty when the reviews service is unreachable. */
export function mount(c) {
  curCourse = c;
  if (!$("#dRevTop")) return;
  const hit = cache.get(c.id);
  if (hit) draw(c, hit.data);
  summary(c.id).then((d) => {
    const top = $("#dRevTop");
    if (curCourse === c && !(top && top.dataset.id === c.id && drawn && drawn.d === d)) draw(c, d);   // same data already on screen: keep it, so the animation is not replayed
  }).catch(() => {});
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
    dlg.innerHTML = `<div class="rv-hd"><b>✓ ${esc(t("rvSent"))}</b><button type="button" class="x" data-x aria-label="${esc(t("rvClose"))}">×</button></div>
      <div class="rv-foot rv-after"><button type="button" class="linkbtn" data-undo>${esc(t("rvUndo"))}</button><button type="button" class="btn primary" data-more>${esc(t("rvMore"))}</button></div>`;
    dlg.querySelector("[data-x]").onclick = () => dlg.close();
    dlg.querySelector("[data-more]").onclick = () => { dlg.close(); location.hash = "#/reviews"; };
    dlg.querySelector("[data-undo]").onclick = async () => {
      try { await post("/api/review/undo", { course: c.id }); } catch { return; }
      reviewed.delete(c.id); remember(); cache.delete(c.id);
      dlg.close(); emit("reviews");
    };
    emit("reviews");
  };
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}

/* ── Tab: pick a course to review; the ones people asked about come first ───── */
const st = { q: "", mine: false };
let seq = 0, typing = 0;

// A course counts as taken under any of its cross-listed names
const isTaken = (id) => plan.done.has(id) || ((rec(id) || {}).al || []).some((a) => plan.done.has(a.replace(/\s+/g, "-")));

function bar(el) {
  if (el.dataset.l === LANG && $("#rvQ", el)) return;
  el.dataset.l = LANG;
  el.innerHTML = `<div class="toolbar rv-bar"><label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="rvQ" type="search" autocomplete="off" placeholder="${esc(t("searchPh"))}" aria-label="${esc(t("searchPh"))}" value="${esc(st.q)}"></label>` +
    `<label class="chk"><input type="checkbox" id="rvMine"${st.mine ? " checked" : ""}> ${esc(t("rvMine"))}</label></div><div id="rvBody"></div>`;
  $("#rvQ", el).oninput = (e) => { st.q = e.target.value; clearTimeout(typing); typing = setTimeout(renderTab, 250); };
  $("#rvMine", el).onchange = (e) => { st.mine = e.target.checked; renderTab(); };
}

const rowHtml = (r) => { const c = rec(r.id), done = reviewed.has(r.id); return `<button class="rv-row${r.taken ? " taken" : ""}${done ? " done" : ""}" data-id="${esc(r.id)}"${done ? " disabled" : ""}><b>${esc(c.code)}</b><span class="title">${esc(c.t)}</span><span class="rv-n">${done ? "✓" : `${esc(t("rvAskN", r.asks))} · ${esc(t("rvN", r.n))}`}</span></button>`; };

export async function renderTab() {
  const el = $("#v-reviews");
  bar(el);
  const body = $("#rvBody", el), my = ++seq, q = st.q.trim();
  let rows;
  try {
    let ids, found = null;
    if (q) {
      found = (await api("/api/courses", { q, limit: 40 })).rows;
      found.forEach((x) => { ROW[x.id] = fill(x); });
      ids = found.map((x) => x.id);
    } else ids = [...plan.done].slice(0, 100);   // the imported transcript
    const counts = new Map((await api("/api/review-requests", ids.length ? { ids: ids.join(",") } : null)).rows.map((r) => [r.id, r]));
    const list = found ? ids.map((id) => counts.get(id) || { id, asks: 0, n: 0 }) : [...counts.values()];
    if (!found) await loadRows(list.map((r) => r.id));
    rows = list.filter((r) => rec(r.id)).map((r) => ({ ...r, taken: isTaken(r.id) }));
  } catch { if (my === seq) body.innerHTML = `<div class="empty">${esc(t("apiError"))}</div>`; return; }
  if (my !== seq || app.tab !== "reviews") return;
  if (st.mine) rows = rows.filter((r) => r.taken);
  // Taken courses first; then the fewest reviews, then the most asked (searching keeps the search order)
  if (q) rows.sort((a, b) => b.taken - a.taken);
  else {
    rows = rows.filter((r) => !reviewed.has(r.id));
    rows.sort((a, b) => b.taken - a.taken || a.n - b.n || b.asks - a.asks || (rec(a.id).code < rec(b.id).code ? -1 : 1));
  }
  const group = (label, list) => (list.length ? `${label ? `<h3 class="rv-grp">${esc(label)}</h3>` : ""}<div class="rv-grid">${list.map(rowHtml).join("")}</div>` : "");
  const mine = rows.filter((r) => r.taken), rest = rows.filter((r) => !r.taken);
  body.innerHTML = !rows.length ? `<div class="empty">${esc(t("rvNone"))}</div>`
    : q || st.mine ? `<div class="rv-grid">${rows.map(rowHtml).join("")}</div>`
      : group(t("rvGrpMine"), mine) + group(mine.length ? t("rvGrpAsked") : "", rest);
  $$(".rv-row", body).forEach((b) => (b.onclick = () => openForm(b.dataset.id)));
}

on("plan", () => { if (app.tab === "reviews") renderTab(); });
on("reviews", () => {
  if (app.tab === "reviews") renderTab();
  if (curCourse && $("#dRevTop")) mount(curCourse);
});

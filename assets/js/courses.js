// The Courses tab: search, filters and the result list. The server filters; this module asks and draws.
import { $, $$, esc, f2, pct, fmt, api, app, ROW, fill, rec, lastName, plan, on, emit } from "./core.js";
import { t, termShort, termLabel, brName } from "./i18n.js";
import { strip } from "./charts.js";
import { setBand } from "./band.js";

export const listState = { rows: [], total: 0, state: "loading" };
const st = { q: "", sort: "m", subj: "", lvl: "", br: "", gpa: "", now: false, sv: false };
let seq = 0, typing;

function readFilters() {
  st.q = $("#q").value.trim().toLowerCase(); st.sort = $("#sort").value; st.subj = $("#fSubj").value; st.lvl = $("#fLvl").value;
  st.br = $("#fBr").value; st.gpa = $("#fGpa").value; st.now = $("#fNow").checked; st.sv = $("#fSaved").checked;
}
const activeFilters = () => [st.subj, st.lvl, st.br, st.gpa].filter(Boolean).length + (st.now ? 1 : 0) + (st.sv ? 1 : 0);

function queryParams() {
  const p = {};
  if (st.q) p.q = st.q;
  if (st.sort !== "m") p.sort = st.sort;
  for (const k of ["subj", "lvl", "br", "gpa"]) if (st[k]) p[k] = st[k];
  if (st.now) p.now = "1";
  if (st.sv) p.ids = [...plan.must].slice(0, 60).join(",") || "-";
  return p;
}

function statusOf(c) { return !c.now ? ["off", t("notTerm")] : c.now.open ? ["open", t("open")] : c.now.wait ? ["wait", t("wait")] : ["closed", t("full")]; }
export function nowTxt(c, bare, long) {
  const [cls, lbl] = statusOf(c), en = c.now && c.en && !bare ? c.en : 0;
  return `<span class="status"${en ? ` title="${esc(t("enrolledN", en))}"` : ""}><span class="dot ${cls}"></span>${lbl}${en ? `<span class="muted small">· ${long ? esc(t("enrolledN", en)) : fmt(en)}</span>` : ""}</span>`;
}
function whoLine(c) {
  if (!c.now || !c.now.who.length) return "";
  const w = c.now.who.map(lastName), more = w.length > 3 ? " +" + (w.length - 3) : "";
  return `<div class="who">${t("teachingNow", termShort(app.term))}${esc(w.slice(0, 3).join(", "))}${more}</div>`;
}

export function render() {
  const { rows, total, state } = listState;
  $("#cnt").textContent = state === "ok" ? t("count", total, app.meta.count) : "";
  const COLS = [["", ""], ["code", t("colCourse")], ["", t("colCr")], ["gpa", t("colGpa")], ["", t("colA")], ["", termLabel(app.term)]];
  const head = `<div class="row head">` + COLS.map(([k, l], i) =>
    `<div class="${i === 2 || i === 4 ? "num" : ""}"${i === 5 ? ` title="${esc(t("seatsAsOf", app.meta.built_at.slice(0, 10)))}"` : ""}>${k ? `<button data-sort="${k}"${st.sort === k ? ' aria-current="true"' : ""}>${esc(l)}</button>` : esc(l)}</div>`).join("") + "</div>";
  const body = state === "error" ? `<div class="empty">${esc(t("apiError"))} <button class="btn" id="retry">${esc(t("retry"))}</button></div>`
    : state === "loading" && !rows.length ? `<div class="empty">${esc(t("loading"))}</div>`
    : rows.length ? `<div class="rows" role="list" aria-label="${esc(t("tabCourses"))}">` + rows.map((c) => `
    <div class="row" role="listitem" tabindex="0" data-id="${esc(c.id)}">
      <div class="c-star"><button class="star" data-star="${esc(c.id)}" aria-pressed="${plan.must.has(c.id)}" aria-label="${esc(t("save"))} ${esc(c.code)}">${plan.must.has(c.id) ? "★" : "☆"}</button></div>
      <div class="cname"><div><span class="code">${esc(c.code)}</span>${c.al.length ? ` <span class="alias">= ${esc(c.al.join(", "))}</span>` : ""}</div><div class="title">${esc(c.t)}</div>${whoLine(c)}</div>
      <div class="c-cr num small">${esc(c.cr || "–")}</div>
      <div class="c-gpa gcell"><b>${f2(c.gpa)}</b>${strip(c.dist)}</div>
      <div class="c-pa num">${pct(c.pa)}</div>
      <div class="c-now">${nowTxt(c)}</div>
      <div class="c-meta"><span>${esc(c.cr || "?")} cr</span><span>A ${pct(c.pa)}</span>${nowTxt(c, false, true)}</div>
    </div>`).join("") + "</div>" : `<div class="empty">${esc(t("empty"))}</div>`;
  $("#list").innerHTML = head + body;
  $("#list").setAttribute("aria-busy", state === "loading");
  $("#fToggle").textContent = t("filters", activeFilters());
  $("#moreWrap").hidden = state !== "ok" || rows.length >= total;
}

export async function refresh(append) {
  readFilters();
  const my = ++seq, params = queryParams();
  if (append) params.offset = listState.rows.length;
  else { listState.state = "loading"; if (!listState.rows.length) render(); }
  let r;
  try { r = await api("/api/courses", params); }
  catch { if (my === seq) { listState.state = "error"; render(); } return; }
  if (my !== seq) return;
  r.rows.forEach((x) => { ROW[x.id] = fill(x); });
  listState.rows = append ? listState.rows.concat(r.rows) : r.rows; listState.total = r.total; listState.state = "ok";
  render();
  emit("list");
}

function syncQuery() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(st)) if (v && k !== "sv") p.set(k, v === true ? "1" : v);
  if (st.sort === "m") p.delete("sort");
  history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash);
}
function loadQuery() {
  const p = new URLSearchParams(location.search);
  const map = { q: "#q", sort: "#sort", subj: "#fSubj", lvl: "#fLvl", br: "#fBr", gpa: "#fGpa" };
  for (const [k, s] of Object.entries(map)) if (p.get(k)) $(s).value = p.get(k);
  if (p.get("now")) $("#fNow").checked = true;
}
const onFilter = () => { syncQuery(); refresh(); };
export function applyFilter(f) { if (f.subj) $("#fSubj").value = f.subj; onFilter(); }

export function localize() {
  const keepSubj = $("#fSubj").value, keepBr = $("#fBr").value;
  $("#fSubj").innerHTML = `<option value="">${esc(t("allSubj"))}</option>` + (app.meta.subjects || []).map((s) => `<option>${esc(s)}</option>`).join("");
  $("#fBr").innerHTML = `<option value="">${esc(t("anyBr"))}</option>` + (app.meta.breadths || []).map((s) => `<option value="${esc(s)}">${esc(brName(s))}</option>`).join("") + `<option value="__es">${esc(t("esOpt"))}</option><option value="__ge">${esc(t("geOpt"))}</option>`;
  $("#fSubj").value = keepSubj; $("#fBr").value = keepBr;
  $("#fNowLbl").textContent = t("offered", termLabel(app.term));
  render();
}

export function focusedCourse() {
  const r = document.activeElement && document.activeElement.closest && document.activeElement.closest(".row[data-id]");
  return r ? rec(r.dataset.id) : null;
}
export function init() {
  $("#fToggle").onclick = () => { const o = !$("#filters").classList.contains("open"); $("#filters").classList.toggle("open", o); $("#fToggle").setAttribute("aria-expanded", o); };
  $("#q").addEventListener("input", () => { syncQuery(); clearTimeout(typing); typing = setTimeout(refresh, 120); });
  ["#sort", "#fSubj", "#fLvl", "#fBr", "#fGpa", "#fNow", "#fSaved"].forEach((s) => $(s).addEventListener("change", onFilter));
  $("#reset").onclick = () => { ["#q", "#fSubj", "#fLvl", "#fBr", "#fGpa"].forEach((s) => ($(s).value = "")); $("#fNow").checked = $("#fSaved").checked = false; $("#sort").value = "m"; onFilter(); };
  $("#more").onclick = () => refresh(true);

  const list = $("#list");
  list.addEventListener("click", (e) => {
    if (e.target.closest("#retry")) { refresh(); return; }
    const s = e.target.closest("[data-star]"); if (s) { plan.toggle(s.dataset.star); e.stopPropagation(); return; }
    const h = e.target.closest("[data-sort]"); if (h) { $("#sort").value = h.dataset.sort === "gpa" && st.sort === "gpa" ? "gpaL" : h.dataset.sort; onFilter(); return; }
    const r = e.target.closest(".row[data-id]"); if (r) emit("open", r.dataset.id);
  });
  list.addEventListener("pointerover", (e) => { if (e.pointerType !== "mouse") return; const r = e.target.closest(".row[data-id]"); if (r) setBand(rec(r.dataset.id)); });
  list.addEventListener("pointerleave", () => setBand(app.openCourse || focusedCourse()));
  list.addEventListener("focusin", (e) => { const r = e.target.closest(".row[data-id]"); if (r) setBand(rec(r.dataset.id)); });
  list.addEventListener("focusout", (e) => { if (!list.contains(e.relatedTarget)) setBand(app.openCourse || null); });
  on("plan", () => {
    const focusId = focusedCourse() && focusedCourse().id;
    if (st.sv) refresh(); else render();
    if (focusId) { const r = list.querySelector(`.row[data-id="${CSS.escape(focusId)}"]`); if (r) r.focus(); }
  });
  list.addEventListener("keydown", (e) => {   // Tab to a row, Enter opens it
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".row[data-id]")) { e.preventDefault(); emit("open", e.target.dataset.id); }
  });
  loadQuery();
}

export const start = () => { readFilters(); return refresh(); };

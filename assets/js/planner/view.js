// The Plan tab: choose a program, import what you have taken, list must-take courses, build timetables.
import { $, esc, f2, api, app, plan, rec, ROW, fill, loadRows, on, emit, BASE, sameName } from "../core.js";
import { t, LANG, termNow } from "../i18n.js";
import { loadPlanData, planOf } from "./data.js";
import { DEFAULT_PREFS, fmtRange, daysText, DAY_LETTERS, swapOptions, scoreSchedule, describe } from "./schedule.js";
import { parseTranscript, statusOf, progress, candidatesFrom, blockCaps, prereqRisk } from "./degree.js";
import { calendarHtml, buildICS, COLORS } from "./calendar.js";
import { openCompare } from "../compare.js";

const S = { index: [], program: null, results: null, i: 0, colors: {}, courses: new Map(), building: false, open: new Set(), swap: null, draft: null, error: "" };
let solver = null;

const prefs = () => ({ ...DEFAULT_PREFS, ...plan.prefs });
const setPref = (k, v) => { plan.prefs = { ...plan.prefs, [k]: v }; plan.save(); };
const programMeta = () => S.index.find((p) => p.id === plan.program);
const colorOf = (id) => (S.colors[id] ??= Object.keys(S.colors).length);
const crOf = (c) => parseFloat(String(c ?? "").split(/[–-]/)[0]) || 0;
const statuses = () => (S.program ? statusOf(S.program, plan.done, plan.ip) : null);

/* ── Solver in a worker (falls back to the page thread) ───────────────── */
function runSolve(args) {
  return new Promise((resolve, reject) => {
    try {
      solver ||= new Worker(new URL("./solve.worker.js", import.meta.url), { type: "module" });
      const done = (e) => { solver.removeEventListener("message", done); solver.removeEventListener("error", fail); resolve(e.data); };
      const fail = (e) => { solver.removeEventListener("message", done); solver.removeEventListener("error", fail); solver = null; reject(e); };
      solver.addEventListener("message", done); solver.addEventListener("error", fail);
      solver.postMessage(args);
    } catch (e) { reject(e); }
  }).catch(async () => (await import("./schedule.js")).solve(args));
}

/* ── Step 1: degree ───────────────────────────────────────────────────── */
async function loadProgram(id) {
  S.program = null;
  if (!id) { renderDegree(); return; }
  try { S.program = await (await fetch(new URL(`assets/programs/${id}.json`, BASE))).json(); }
  catch { S.program = null; }
  renderDegree();
}

function optLabel(o) { return `<b>${esc(o.i[0].replace(/-/g, " ").replace(/ (\d+)$/, " $1"))}</b> <span class="muted">${esc(o.t)}${o.c ? ` · ${esc(t("cr", o.c))}` : ""}</span>`; }
const idText = (id) => id.replace(/-/g, " ");

function itemHtml(x) {
  const { item, state, via } = x;
  if (state === "used") {
    return `<li class="req-item used"><span class="mark">–</span><span class="req-opts">${optLabel(via)} <span class="muted">${esc(t("countedAbove"))}</span></span></li>`;
  }
  if (state !== "todo") {
    return `<li class="req-item ${state}"><span class="mark" title="${esc(t(state === "done" ? "taken" : "inProgress"))}">${state === "done" ? "✓" : "◐"}</span><span class="req-opts">${optLabel(via)}</span></li>`;
  }
  const opts = item.o.map((o) => {
    const p = o.i.map(planOf).find(Boolean);
    const noTerm = p && p.pk.length === 0;
    const added = o.i.some((i) => plan.must.has(i) || (p && plan.must.has(p.id)));
    return `<span class="req-opt"><button class="mini-btn${added ? " on" : ""}" data-addreq="${esc(o.i[0])}" aria-pressed="${added}" aria-label="${esc(t(added ? "added" : "add"))} ${esc(idText(o.i[0]))}">${added ? "✓" : "+"}</button>${optLabel(o)}${noTerm ? ` <span class="tag">${esc(t("notOffered"))}</span>` : ""}<button class="linkbtn" data-took="${esc(o.i[0])}">${esc(t("tookIt"))}</button></span>`;
  }).join(`<span class="or">${LANG === "zh" ? "或" : "or"}</span>`);
  return `<li class="req-item todo"><span class="mark">○</span><span class="req-opts">${opts}</span></li>`;
}

function blockHtml(s) {
  const r = s.block.rule, pctDone = s.need ? Math.min(100, (s.have / s.need) * 100) : 0, pctIp = s.need ? Math.min(100, (s.haveIp / s.need) * 100) : 0;
  const label = !s.counted ? t("reqInfo") : t("reqUnit", s.unit, +s.have.toFixed(1), s.need);
  const open = S.open.has(s.index);
  const head = s.block.h.split(" › ");
  return `<details class="req${s.met ? " met" : ""}" data-b="${s.index}"${open ? " open" : ""}>
    <summary><span class="req-title">${esc(head[head.length - 1])}${head.length > 1 ? `<span class="muted"> · ${esc(head[0])}</span>` : ""}</span>
      <span class="req-prog">${esc(label)}</span>${s.counted ? `<i class="meter"><b class="ip" style="width:${pctIp}%"></b><b style="width:${pctDone}%"></b></i>` : ""}</summary>
    ${s.block.note ? `<p class="muted req-note">${esc(s.block.note)}</p>` : ""}
    ${r.t === "n" ? `<p class="muted req-note">${esc(t("chooseN", r.n))}</p>` : ""}
    <ul class="req-items">${s.items.map(itemHtml).join("")}</ul></details>`;
}

function renderDegree() {
  const pm = programMeta(), st = statuses();
  const imported = plan.done.size + plan.ip.size;
  let h = `<div class="field-row"><label class="field grow"><span>${esc(t("program"))}</span><input id="pgInput" list="pgList" autocomplete="off" placeholder="${esc(t("programPh"))}" value="${esc(pm ? pm.name : "")}"><datalist id="pgList">${S.index.map((p) => `<option value="${esc(p.name)}"></option>`).join("")}</datalist></label>
    <button class="btn" id="pgImport">${esc(t("importBtn"))}</button></div>`;
  h += `<p class="line">${imported ? `${esc(t("importedN", imported))} · <button class="linkbtn" id="pgEdit">${esc(t("importEdit"))}</button>` : ""}</p>`;
  if (!S.program) h += `<p class="muted">${esc(t("noProgram"))}</p>`;
  else {
    const pr = progress(st);
    h += `<div class="prog-sum"><b>${esc(t("reqDone", pr.met, pr.total))}</b> <a href="${esc(S.program.url)}" target="_blank" rel="noopener">${esc(t("viewGuide"))}</a><i class="meter wide"><b class="ip" style="width:${pr.total ? (pr.planned / pr.total) * 100 : 0}%"></b><b style="width:${pr.total ? (pr.met / pr.total) * 100 : 0}%"></b></i></div>`;
    const order = [...st].sort((a, b) => Number(a.met) - Number(b.met) || a.index - b.index);
    h += `<div class="reqs">${order.map(blockHtml).join("")}</div><p class="muted">${esc(t("reqNote"))}</p>`;
  }
  $("#stDegree").innerHTML = h;
}

/* ── Step 2: courses and preferences ──────────────────────────────────── */
const TIMES = (list, anyKey) => list.map(([v, l]) => `<option value="${v}">${esc(l || t(anyKey))}</option>`).join("");

function renderCourses() {
  const p = prefs(), ids = [...plan.must];
  const chips = ids.map((id) => {
    const c = rec(id) || planOf(id);
    return `<span class="pill c${colorOf(id) % COLORS + 1}"><b>${esc(c ? c.code : idText(id))}</b>${c && (c.cr || c.cr === 0) ? `<span class="muted"> ${esc(t("cr", c.cr))}</span>` : ""}<button data-rm="${esc(id)}" aria-label="${esc(t("remove"))} ${esc(c ? c.code : id)}">×</button></span>`;
  }).join("");
  const mustCr = ids.reduce((a, id) => a + crOf((rec(id) || planOf(id) || {}).cr), 0);
  let h = `<div class="musts"><div class="label">${esc(t("mustHave"))}${ids.length ? ` <span class="muted">${esc(t("planSummary", ids.length, +mustCr.toFixed(1)))}</span>` : ""}</div>${chips || `<span class="muted">${esc(t("mustEmpty"))}</span>`}
    ${ids.length > 1 ? `<button class="linkbtn" id="plCompare">${esc(t("compare"))}</button>` : ""}</div>
    <div class="add"><input id="addQ" type="search" autocomplete="off" placeholder="${esc(t("addCourse"))}" aria-label="${esc(t("addCourse"))}"><div id="addRes" class="suggest" hidden></div></div>
    <div class="fill-row"><label class="chk"><input type="checkbox" id="fillBox"${plan.fill ? " checked" : ""}> ${esc(t("fillLabel"))}</label>
      <label class="num-field">${esc(t("targetCr"))} <input id="crInput" type="number" min="1" max="24" value="${plan.credits}"></label></div>
    <div class="prefs"><div class="label">${esc(t("prefs"))}</div><div class="prefs-grid">
      <label class="field"><span>${esc(t("noBefore"))}</span><select id="pEarly">${TIMES([[0, ""], [480, "8:00"], [540, "9:00"], [600, "10:00"], [660, "11:00"]], "anyTime")}</select></label>
      <label class="field"><span>${esc(t("noAfter"))}</span><select id="pLate">${TIMES([[1440, ""], [900, "3:00 pm"], [960, "4:00 pm"], [1020, "5:00 pm"], [1080, "6:00 pm"], [1140, "7:00 pm"]], "anyTime")}</select></label>
      <label class="field"><span>${esc(t("seatsLbl"))}</span><select id="pSeats"><option value="open">${esc(t("seatsOpen"))}</option><option value="open+wait">${esc(t("seatsWait"))}</option><option value="any">${esc(t("seatsAny"))}</option></select></label>
      <div class="field"><span>${esc(t("daysOff"))}</span><div class="days">${[0, 1, 2, 3, 4].map((d) => `<button class="day-btn" data-day="${d}" aria-pressed="${p.daysOff.includes(d)}">${LANG === "zh" ? "一二三四五"[d] : "MTWRF"[d]}</button>`).join("")}</div></div></div>
      <div class="prefs-checks"><label class="chk"><input type="checkbox" data-pref="freeDays"${p.freeDays ? " checked" : ""}> ${esc(t("freeDays"))}</label>
      <label class="chk"><input type="checkbox" data-pref="compact"${p.compact ? " checked" : ""}> ${esc(t("compact"))}</label>
      <label class="chk"><input type="checkbox" data-pref="quality"${p.quality ? " checked" : ""}> ${esc(t("quality"))}</label></div></div>
    <button class="btn primary big" id="build"${S.building ? " disabled" : ""}>${esc(t(S.building ? "building" : "build"))}</button>`;
  $("#stCourses").innerHTML = h;
  $("#pEarly").value = p.earliest; $("#pLate").value = p.latest; $("#pSeats").value = p.seats;
}

/* ── Step 3: results ──────────────────────────────────────────────────── */
function pkTags(p) {
  const tags = [];
  if (p.consent) tags.push(t("consent"));
  if (p.risk) tags.push(t("riskPrq"));
  if (p.meets.some((m) => m.w)) tags.push(t("partTerm"));
  return tags.map((x) => `<span class="tag">${esc(x)}</span>`).join(" ");
}
function statusChip(p) {
  const cls = p.status === "O" ? "open" : p.status === "W" ? "wait" : "closed";
  const lbl = p.status === "O" ? `${t("open")} · ${p.seats}` : p.status === "W" ? `${t("wait")}` : t("full");
  return `<span class="status"><span class="dot ${cls}"></span>${esc(lbl)}</span>`;
}
function secLines(p, c) {
  const raw = p.raw.s || [];
  const lines = raw.map((s) => {
    const when = s.m.length ? s.m.map((m) => `${daysText([...m[0]].map((ch) => DAY_LETTERS.indexOf(ch)))} ${fmtRange(m[1], m[2])}`).join(", ") : t("online");
    const loc = s.m[0] && s.m[0][3] ? ` · ${s.m[0][3]}` : "";
    let who = "";
    if (s.i && s.i.length && (s.t === "LEC" || s.t === "SEM" || raw.length === 1)) {
      const hist = c && c.ins ? c.ins.find((i) => sameName(i[0], s.i[0])) : null;
      who = ` · ${s.i.slice(0, 2).join(", ")}${hist && hist[2] >= 30 ? ` <span class="muted">(${f2(hist[1])})</span>` : ""}`;
    }
    return `<div class="sec"><b>${esc(s.t)} ${esc(s.n)}</b>${s.k ? ` <span class="muted">#${s.k}</span>` : ""} ${esc(when)}${esc(loc)}${who}</div>`;
  });
  return lines.join("");
}

function resultsHtml() {
  const r = S.results;
  if (S.building) return `<p class="muted">${esc(t("building"))}</p>`;
  if (!r) return "";
  if (!r.ok) {
    return `<ul class="reasons">${r.reasons.map((x) => `<li>${esc(
      x.type === "none" ? t("why_none", x.code, x.why) : x.type === "clash" ? t("why_clash", x.a, x.b) : x.type === "over" ? t("why_credits", x.have, x.hi) : t("why_nofit"))}</li>`).join("")}</ul>`;
  }
  const sch = r.schedules[S.i] || r.schedules[0], n = r.schedules.length;
  const days = LANG === "zh" ? "一二三四五" : "MTWRF";
  const free = sch.freeDays.map((d) => days[d]);
  const time = sch.earliest != null ? t("schedSpan", fmtRange(sch.earliest, sch.latest).split("–")[0], fmtRange(sch.earliest, sch.latest).split("–")[1]) : "";
  const meta = [t("schedCredits", +sch.credits.toFixed(1)), t("schedFree", free), time, sch.waitlisted ? t("schedWait", sch.waitlisted) : "", sch.full ? t("schedFull", sch.full) : ""].filter(Boolean);
  const picks = sch.picks.slice().sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const online = picks.filter((p) => !p.meets.length);
  let h = `<div class="res-bar"><div class="variants">${r.schedules.map((_, i) => `<button class="var-btn" data-var="${i}" aria-pressed="${i === S.i}">${i + 1}</button>`).join("")}<span class="muted">${esc(t("variant", S.i + 1, n))}</span></div>
    <div class="res-actions"><button class="linkbtn" id="rsCopy">${esc(t("copyNums"))}</button><button class="linkbtn" id="rsIcs">${esc(t("icsBtn"))}</button></div></div>
    <p class="res-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}${sch.short ? `<span class="warn">${esc(t("why_credits", +sch.credits.toFixed(1), plan.credits))}</span>` : ""}</p>
    ${calendarHtml(picks, colorOf, LANG)}
    ${online.length ? `<p class="muted">${esc(t("online"))}: ${online.map((p) => esc(p.code)).join(", ")}</p>` : ""}
    <ul class="picks">`;
  h += picks.map((p) => {
    const c = S.courses.get(p.course);
    return `<li class="pick" data-pick="${esc(p.course)}"><span class="sw c${colorOf(p.course) % COLORS + 1}"></span>
      <div class="pk-main"><div><b>${esc(p.code)}</b> ${esc(p.title || "")} <span class="muted">${esc(t("cr", p.cr))}</span> ${pkTags(p)}</div>${secLines(p, c)}</div>
      <div class="pk-side">${statusChip(p)}<button class="linkbtn" data-swap="${esc(p.course)}">${esc(t("swap"))}</button></div>
      ${S.swap === p.course ? swapHtml(sch, p.course) : ""}</li>`;
  }).join("") + "</ul>";
  return h;
}

function swapHtml(sch, courseId) {
  const c = S.courses.get(courseId);
  const alts = c ? swapOptions(sch, courseId, c, prefs()).slice(0, 12) : [];
  return `<div class="swap">${alts.map((a) => `<button class="swap-opt${a.id === sch.picks.find((p) => p.course === courseId)?.id ? " on" : ""}" data-swapto="${esc(a.id)}">${(a.raw.s || []).map((s) => `${esc(s.t)} ${esc(s.m.length ? s.m.map((m) => daysText([...m[0]].map((ch) => DAY_LETTERS.indexOf(ch))) + " " + fmtRange(m[1], m[2])).join(", ") : t("online"))}`).join(" + ")} · ${statusChip(a)}</button>`).join("") || `<span class="muted">${esc(t("noSections"))}</span>`}</div>`;
}

function renderResults() { $("#stResults").innerHTML = resultsHtml(); }

/* ── Building ─────────────────────────────────────────────────────────── */
const asCourse = (p, extra = {}) => ({ id: p.id, code: p.code, title: p.t, cr: p.cr, packages: p.pk, gpa: p.gpa, ins: p.ins, weight: 0, ...extra });

export async function build(override = {}) {
  if (S.building) return S.results;
  S.building = true; S.results = null; S.i = 0; S.swap = null; renderCourses(); renderResults();
  try {
    const mustIds = [...plan.must], st = statuses(), cands = plan.fill && st ? candidatesFrom(st) : [];
    await loadPlanData([...mustIds, ...cands.flatMap((c) => c.ids)]);
    const must = mustIds.map((id) => planOf(id)).filter(Boolean).map((p) => asCourse(p));
    const taken = new Set([...plan.done, ...plan.ip]);
    const seen = new Set(must.map((m) => m.id)), pool = [];
    for (const c of cands) {
      const p = c.ids.map(planOf).find(Boolean);
      if (!p || seen.has(p.id) || !p.pk.length) continue;
      const risk = prereqRisk(p.prq, app.designations, taken);
      seen.add(p.id);
      pool.push(asCourse(p, { weight: c.weight - (risk ? 2 : 0), slot: c.slot, block: c.block, risk }));
    }
    S.courses = new Map([...must, ...pool].map((c) => [c.id, c]));
    const mustCr = must.reduce((a, c) => a + crOf(c.cr), 0), lo = plan.credits;
    const credits = plan.fill ? [lo, Math.max(lo + 3, mustCr)] : [0, 99];
    const res = await runSolve({ must, pool: plan.fill ? pool : [], prefs: { ...prefs(), ...override }, credits, caps: blockCaps(st || []), limit: 6 });
    for (const s of res.schedules || []) for (const p of s.picks) p.risk = !!(S.courses.get(p.course) || {}).risk;
    S.results = res;
  } catch (e) {
    S.results = { ok: false, schedules: [], reasons: [{ type: "nofit" }] };
  }
  S.building = false; renderCourses(); renderResults();
  return S.results;
}

/* ── Import dialog ────────────────────────────────────────────────────── */
async function pdfText(file) {
  const V = "4.4.168", base = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${V}/`;
  const pdfjs = await import(base + "pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const items = (await (await doc.getPage(p)).getTextContent()).items.filter((i) => i.str);
    const rows = new Map();
    for (const it of items) { const y = Math.round(it.transform[5] / 3); (rows.get(y) || rows.set(y, []).get(y)).push(it); }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) out += rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(" ") + "\n";
  }
  return out;
}

function draftHtml() {
  const d = S.draft;
  const chips = (arr, kind) => arr.map((g, i) => `<span class="pill sm">${esc(idText(g[0]))}${g.length > 1 ? esc(" = " + g.slice(1).map(idText).join(", ")) : ""}<button data-dr="${kind}:${i}" aria-label="${esc(t("remove"))} ${esc(idText(g[0]))}">×</button></span>`).join("");
  return `<div class="draft"><p>${esc(t("importFound", d.done.length, d.ip.length))}${d.failed.length ? ` <span class="muted">${esc(t("importFailed", d.failed.length))}</span>` : ""}</p>
    ${d.done.length ? `<div class="label">${esc(t("taken"))}</div><div class="chips-row">${chips(d.done, "done")}</div>` : ""}
    ${d.ip.length ? `<div class="label">${esc(t("inProgress"))}</div><div class="chips-row">${chips(d.ip, "ip")}</div>` : ""}</div>`;
}

function openImport() {
  S.draft = { done: [...plan.done].map((id) => [id]), ip: [...plan.ip].map((id) => [id]), failed: [] };
  const dlg = $("#importDlg");
  dlg.innerHTML = `<form method="dialog" class="dlg"><div class="cmp-head"><h2 class="serif">${esc(t("importTitle"))}</h2><button class="icon-btn" value="cancel" aria-label="${esc(t("close"))}">✕</button></div>
    <p class="muted">${esc(t("importHelp"))}</p>
    <div class="field-row"><input type="file" id="impFile" accept=".pdf,.txt,.csv,text/plain,application/pdf" hidden><button type="button" class="btn" id="impChoose">${esc(t("importChoose"))}</button><span class="muted" id="impName"></span></div>
    <label class="field"><span>${esc(t("importPaste"))}</span><textarea id="impText" rows="5" spellcheck="false"></textarea></label>
    <div class="field-row"><button type="button" class="btn" id="impRead">${esc(t("importRead"))}</button></div>
    <div id="impDraft">${S.draft.done.length || S.draft.ip.length ? draftHtml() : ""}</div>
    <div class="dlg-foot"><button type="button" class="btn primary" id="impApply">${esc(t("importApply"))}</button></div></form>`;
  dlg.showModal();
}

function readImport() {
  const txt = $("#impText").value;
  const r = parseTranscript(txt, app.designations);
  S.draft = { done: r.doneGroups, ip: r.ipGroups, failed: r.failed };
  $("#impDraft").innerHTML = r.done.length || r.ip.length ? draftHtml() : `<p class="muted">${esc(t("importNone"))}</p>`;
}

/* ── Wiring ───────────────────────────────────────────────────────────── */
let suggestTimer;
async function suggest(q) {
  const box = $("#addRes");
  if (!q.trim()) { box.hidden = true; return; }
  try {
    const r = await api("/api/courses", { q, limit: 8, sort: "m" });
    box.innerHTML = r.rows.map((c) => `<button data-addc="${esc(c.id)}"><b>${esc(c.code)}</b> ${esc(c.t)} <span class="muted">${c.now ? "" : esc(t("notOffered"))}</span></button>`).join("") || `<span class="muted pad">${esc(t("empty"))}</span>`;
    r.rows.forEach((c) => { ROW[c.id] ||= fill(c); });
    box.hidden = false;
  } catch { box.hidden = true; }
}

function renderAll() { renderDegree(); renderCourses(); renderResults(); }

export function localize() {
  $("#plTitle").textContent = t("planTitle", termNow());
  $("#plD").textContent = t("stepDegree"); $("#plC").textContent = t("stepCourses"); $("#plS").textContent = t("stepSchedule");
  renderAll();
}

export async function init() {
  const root = $("#v-plan");
  root.innerHTML = `<div class="page-head"><h1 class="serif" id="plTitle"></h1></div>
    <section class="step"><h2><span class="n">1</span><span id="plD"></span></h2><div id="stDegree"></div></section>
    <section class="step"><h2><span class="n">2</span><span id="plC"></span></h2><div id="stCourses"></div></section>
    <section class="step"><h2><span class="n">3</span><span id="plS"></span></h2><div id="stResults" aria-live="polite"></div></section>`;
  try { S.index = await (await fetch(new URL("assets/programs/index.json", BASE))).json(); } catch { S.index = []; }
  if (plan.program) await loadProgram(plan.program);

  root.addEventListener("input", (e) => {
    if (e.target.id === "addQ") { clearTimeout(suggestTimer); suggestTimer = setTimeout(() => suggest(e.target.value), 150); }
    if (e.target.id === "crInput") { plan.credits = Math.min(24, Math.max(1, +e.target.value || 15)); plan.save(); }
  });
  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.id === "pgInput") {
      const m = S.index.find((p) => p.name.toLowerCase() === el.value.trim().toLowerCase());
      if (m || !el.value.trim()) { plan.program = m ? m.id : ""; plan.save(); loadProgram(plan.program); }
    } else if (el.id === "fillBox") { plan.fill = el.checked; plan.save(); }
    else if (el.id === "pEarly") setPref("earliest", +el.value);
    else if (el.id === "pLate") setPref("latest", +el.value);
    else if (el.id === "pSeats") setPref("seats", el.value);
    else if (el.dataset.pref) setPref(el.dataset.pref, el.checked ? 1 : 0);
  });
  root.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!d.matches || !d.matches("details.req")) return;
    const bi = +d.dataset.b;
    d.open ? S.open.add(bi) : S.open.delete(bi);
    if (d.open && S.program) {
      const ids = S.program.blocks[bi].items.flatMap((i) => i.o.map((o) => o.i[0]));
      loadPlanData(ids).then(() => { if (S.open.has(bi)) { const keep = new Set(S.open); renderDegree(); S.open = keep; } }).catch(() => {});
    }
  }, true);
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("button, a"); if (!b) { if (!e.target.closest(".add")) $("#addRes") && ($("#addRes").hidden = true); return; }
    if (b.id === "pgImport" || b.id === "pgEdit") openImport();
    else if (b.dataset.addreq) { const p = planOf(b.dataset.addreq); const id = p ? p.id : b.dataset.addreq; plan.must.has(id) ? plan.remove(id) : plan.add(id); }
    else if (b.dataset.took) { const id = b.dataset.took; plan.done.add(id); plan.save(); renderDegree(); }
    else if (b.dataset.rm) plan.remove(b.dataset.rm);
    else if (b.dataset.addc) { plan.add(b.dataset.addc); $("#addQ").value = ""; $("#addRes").hidden = true; }
    else if (b.dataset.day) { const d = +b.dataset.day, cur = new Set(prefs().daysOff); cur.has(d) ? cur.delete(d) : cur.add(d); setPref("daysOff", [...cur]); renderCourses(); }
    else if (b.id === "build") build();
    else if (b.id === "plCompare") openCompare([...plan.must]);
    else if (b.dataset.var) { S.i = +b.dataset.var; S.swap = null; renderResults(); }
    else if (b.dataset.swap) { S.swap = S.swap === b.dataset.swap ? null : b.dataset.swap; renderResults(); }
    else if (b.dataset.swapto) swapTo(b.dataset.swapto);
    else if (b.id === "rsCopy") { const s = S.results.schedules[S.i]; navigator.clipboard && navigator.clipboard.writeText([...new Set(s.picks.flatMap((p) => p.raw.s.map((x) => x.k).filter(Boolean)))].join(", ")); b.textContent = t("copied"); }
    else if (b.id === "rsIcs") download(S.results.schedules[S.i]);
  });
  on("plan", () => { renderCourses(); renderDegree(); loadRows([...plan.must]).then(renderCourses).catch(() => {}); });
  on("lang", localize);

  const dlg = $("#importDlg");
  dlg.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "impChoose") $("#impFile").click();
    else if (b.id === "impRead") readImport();
    else if (b.dataset.dr) { const [k, i] = b.dataset.dr.split(":"); S.draft[k].splice(+i, 1); $("#impDraft").innerHTML = draftHtml(); }
    else if (b.id === "impApply") {
      plan.done = new Set(S.draft.done.flat()); plan.ip = new Set(S.draft.ip.flat()); plan.save(); dlg.close(); emit("plan"); renderDegree();
    }
  });
  dlg.addEventListener("change", async (e) => {
    if (e.target.id !== "impFile" || !e.target.files[0]) return;
    const f = e.target.files[0];
    $("#impName").textContent = f.name;
    try { $("#impText").value = /pdf$/i.test(f.name) || f.type === "application/pdf" ? await pdfText(f) : await f.text(); readImport(); }
    catch { $("#impDraft").innerHTML = `<p class="warn">${esc(t("importPdfError"))}</p>`; }
  });
  loadRows([...plan.must]).then(renderCourses).catch(() => {});
  localize();
}

function swapTo(pkgId) {
  const r = S.results, sch = r.schedules[S.i], courseId = S.swap, c = S.courses.get(courseId);
  const alt = swapOptions(sch, courseId, c, prefs()).find((a) => a.id === pkgId);
  if (!alt) return;
  alt.risk = (c || {}).risk;
  sch.picks = sch.picks.map((p) => (p.course === courseId ? alt : p));
  sch.credits = sch.picks.reduce((a, p) => a + p.cr, 0);
  Object.assign(sch, describe(sch.picks), { score: scoreSchedule(sch.picks, prefs()), short: Math.max(0, plan.credits - sch.credits) });
  S.swap = null; renderResults();
}

function download(sch) {
  const ics = buildICS(sch.picks, `${termNow()} timetable`);
  if (!ics) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = "timetable.ics"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Entry points for the assistant. */
export const planApi = {
  state() {
    const st = statuses();
    return {
      program: programMeta() ? programMeta().name : null,
      taken: [...plan.done], inProgress: [...plan.ip], mustTake: [...plan.must], targetCredits: plan.credits, fillFromRequirements: plan.fill,
      preferences: prefs(),
      unmetRequirements: st ? st.filter((s) => s.counted && !s.planned).map((s) => ({ block: s.block.h, need: `${s.need} ${s.unit}`, have: s.have, options: s.items.filter((x) => x.state === "todo").slice(0, 10).map((x) => x.item.o.map((o) => o.i[0]).join(" | ")) })) : [],
      timetable: S.results && S.results.ok ? S.results.schedules[S.i].picks.map((p) => ({ course: p.code, sections: p.raw.s.map((x) => `${x.t} ${x.n} (class ${x.k || "?"})`).join(" + "), when: p.meets.map((m) => `${DAY_LETTERS[m.d]} ${fmtRange(m.s, m.e)}`).join(", ") })) : null,
    };
  },
  setPrefs(p) { plan.prefs = { ...plan.prefs, ...p }; plan.save(); renderCourses(); },
  addMust(ids) { ids.forEach((id) => plan.must.add(id)); plan.save(); emit("plan"); },
  removeMust(ids) { ids.forEach((id) => plan.must.delete(id)); plan.save(); emit("plan"); },
  setTarget(n) { plan.credits = n; plan.save(); renderCourses(); },
  async setProgram(id) { plan.program = id; plan.save(); await loadProgram(id); },
  programs: () => S.index,
  build,
};

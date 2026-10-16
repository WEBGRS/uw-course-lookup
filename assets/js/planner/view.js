// The Plan tab: choose a program, import what you have taken, list must-take courses, build timetables.
import { $, esc, f2, pct, fmt, api, app, plan, rec, ROW, fill, loadRows, on, emit, BASE, sameName, store, toast } from "../core.js";
import { strip } from "../charts.js";
import { t, LANG, termNow, termLabel, brName } from "../i18n.js";
import { loadPlanData, planOf } from "./data.js";
import { DEFAULT_PREFS, fmtRange, daysText, DAY_LETTERS, swapOptions, scoreSchedule, describe } from "./schedule.js";
import { parseTranscript, statusOf, progress, candidatesFrom, blockCaps, prereqRisk } from "./degree.js";
import { calendarHtml, buildICS, COLORS } from "./calendar.js";
import { openCompare } from "../compare.js";
import { pickRequired, layout, chooseLight, termsFrom, termsBetween, nextTerm, crNum } from "./roadmap.js";

const S = { index: [], program: null, results: null, i: 0, colors: {}, courses: new Map(), building: false, open: new Set(), openPick: new Set(), sort: store.get("planSort", "gpa"), swap: null, draft: null, error: "" };
let solver = null;
const R = { busy: false, out: null, pools: null, error: "" };   // semester roadmap

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
  S.program = null; R.out = null;
  if (!id) { renderDegree(); renderRoad(); return; }
  try { S.program = await (await fetch(new URL(`assets/programs/${id}.json`, BASE))).json(); }
  catch { S.program = null; }
  renderDegree(); renderRoad();
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

function renderDegree() { renderProgram(); renderTranscript(); renderReqs(); }

function renderProgram() {
  const pm = programMeta(), st = statuses();
  let h = `<div class="combo"><input id="pgInput" role="combobox" aria-expanded="false" aria-controls="pgList" aria-label="${esc(t("program"))}" autocomplete="off" spellcheck="false" placeholder="${esc(t("programPh"))}" value="${esc(pm ? pm.name : "")}"><div id="pgList" class="suggest" role="listbox" hidden></div></div>`;
  if (S.program && st) {
    const pr = progress(st);
    h += `<div class="prog-sum"><b>${esc(t("reqDone", pr.met, pr.total))}</b> <a href="${esc(S.program.url)}" target="_blank" rel="noopener">${esc(t("viewGuide"))}</a><i class="meter wide"><b class="ip" style="width:${pr.total ? (pr.planned / pr.total) * 100 : 0}%"></b><b style="width:${pr.total ? (pr.met / pr.total) * 100 : 0}%"></b></i></div>`;
  }
  $("#stDegree").innerHTML = h;
}

function renderTranscript() {
  const cr = plan.transcriptCredits(), keys = Object.keys(plan.creditOf);
  const nd = keys.length ? keys.filter((id) => plan.done.has(id)).length : plan.done.size, ni = keys.length ? keys.filter((id) => plan.ip.has(id)).length : plan.ip.size, n = nd + ni;
  $("#stTranscript").innerHTML = n
    ? `<div class="tr-row"><div class="tr-n"><b>${esc(t("importedN", n))}</b><span class="muted"> · ${esc(t("importedSub", nd, ni, cr ? +(cr.done + cr.ip).toFixed(1) : 0))}</span></div><button class="btn" id="pgEdit">${esc(t("importEdit"))}</button></div>`
    : `<div class="tr-row"><span class="muted">${esc(t("transcriptShort"))}</span><button class="btn" id="pgImport">${esc(t("importBtn"))}</button></div>`;
}

function renderReqs() {
  const card = $("#reqCard"), st = statuses();
  card.hidden = !S.program || !st;
  if (card.hidden) return;
  const pr = progress(st);
  $("#reqSum").innerHTML = `<span class="req-h">${esc(t("reqTitle"))}</span><span class="muted">${esc(t("reqDone", pr.met, pr.total))}</span>`;
  const order = [...st].sort((a, b) => Number(a.met) - Number(b.met) || a.index - b.index);
  $("#stReqs").innerHTML = `<div class="reqs">${order.map(blockHtml).join("")}</div><p class="muted">${esc(t("reqNote"))}</p>`;
}

/* Program picker: a listbox exactly as wide as the field */
function pgOptions(q) {
  const k = q.trim().toLowerCase(), pm = programMeta();
  const list = k && !(pm && pm.name.toLowerCase() === k) ? S.index.filter((p) => p.name.toLowerCase().includes(k)) : S.index;
  return list.slice(0, 40);
}
function pgOpen() {
  const box = $("#pgList"), inp = $("#pgInput");
  const rows = pgOptions(inp.value);
  box.innerHTML = rows.map((p, i) => `<button type="button" role="option" id="pgo${i}" data-pg="${esc(p.id)}"${p.id === plan.program ? ' aria-selected="true"' : ""}>${esc(p.name)}</button>`).join("") || `<span class="muted pad">${esc(t("empty"))}</span>`;
  box.hidden = false; inp.setAttribute("aria-expanded", "true");
}
function pgClose() {
  const b = $("#pgList"), i = $("#pgInput");
  if (b) b.hidden = true;
  if (i) i.setAttribute("aria-expanded", "false");
}
function pgChoose(id) { plan.program = id; plan.save(); pgClose(); loadProgram(id); const pm = S.index.find((p) => p.id === id); if (pm) toast(t("toastProgram", pm.name)); }
function pgMove(dir) {
  const box = $("#pgList");
  if (box.hidden) { pgOpen(); return; }
  const opts = [...box.querySelectorAll("[data-pg]")];
  if (!opts.length) return;
  let i = opts.findIndex((o) => o.classList.contains("hl"));
  opts.forEach((o) => o.classList.remove("hl"));
  i = i < 0 ? (dir > 0 ? 0 : opts.length - 1) : (i + dir + opts.length) % opts.length;
  opts[i].classList.add("hl"); opts[i].scrollIntoView({ block: "nearest" });
  $("#pgInput").setAttribute("aria-activedescendant", opts[i].id);
}

/* ── Step 2: courses and preferences ──────────────────────────────────── */
function crRangeHtml() {
  return `<input type="number" inputmode="numeric" min="1" max="24" data-cr="min" value="${plan.crMin}" aria-label="${esc(t("crRange"))} min"><span class="to">${esc(t("crTo"))}</span><input type="number" inputmode="numeric" min="1" max="24" data-cr="max" value="${plan.crMax}" aria-label="${esc(t("crRange"))} max">`;
}
function setCredits(lo, hi) {
  lo = Math.min(24, Math.max(1, Math.round(+lo) || 12));
  hi = Math.min(24, Math.max(lo, Math.round(+hi) || 16));
  plan.crMin = lo; plan.crMax = hi; plan.save();
}

function renderCourses() {
  const p = prefs(), ids = [...plan.must];
  const chips = ids.map((id) => {
    const c = rec(id) || planOf(id);
    return `<span class="pill c${colorOf(id) % COLORS + 1}"><b>${esc(c ? c.code : idText(id))}</b>${c && (c.cr || c.cr === 0) ? `<span class="muted"> ${esc(t("cr", c.cr))}</span>` : ""}<button data-rm="${esc(id)}" aria-label="${esc(t("remove"))} ${esc(c ? c.code : id)}">×</button></span>`;
  }).join("");
  const mustCr = ids.reduce((a, id) => a + crOf((rec(id) || planOf(id) || {}).cr), 0);
  const opt = (list, fmtLabel) => list.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  const sel = (id, label, list) => `<label class="field"><span>${esc(label)}</span><select id="${id}">${opt(list)}</select></label>`;
  const h = `<div class="bgrid">
    <section class="bsec b-courses"><div class="bh"><h3>${esc(t("mustHave"))}${ids.length ? ` <span class="muted">${esc(t("planSummary", ids.length, +mustCr.toFixed(1)))}</span>` : ""}</h3>${ids.length > 1 ? `<button class="linkbtn" id="plCompare">${esc(t("compare"))}</button>` : ""}</div>
      ${chips ? `<div class="chips-row">${chips}</div>` : ""}
      <div class="add"><input id="addQ" type="search" autocomplete="off" placeholder="${esc(t("addCourse"))}" aria-label="${esc(t("addCourse"))}"><div id="addRes" class="suggest" hidden></div></div></section>
    <section class="bsec b-credits"><div class="bh"><h3>${esc(t("crRange"))}</h3></div>
      <div class="cr-row">${crRangeHtml()}</div>
      <label class="chk"><input type="checkbox" id="fillBox"${plan.fill ? " checked" : ""}> ${esc(t("fillLabel"))}</label></section>
    <section class="bsec b-prefs"><div class="bh"><h3>${esc(t("prefs"))}</h3></div>
      <div class="fgrid">
        ${sel("pEarly", t("noBefore"), [[0, t("anyTime")], [480, "8:00"], [540, "9:00"], [600, "10:00"], [660, "11:00"]])}
        ${sel("pLate", t("noAfter"), [[1440, t("anyTime")], [900, "3:00 pm"], [960, "4:00 pm"], [1020, "5:00 pm"], [1080, "6:00 pm"], [1140, "7:00 pm"]])}
        ${sel("pBuffer", t("bufLbl"), [[0, t("bufNone")], [10, t("bufMin", 10)], [15, t("bufMin", 15)], [20, t("bufMin", 20)]])}
        ${sel("pOverlap", t("ovLbl"), [[0, t("ovNone")], [15, t("ovUpTo", 15)], [30, t("ovUpTo", 30)], [9999, t("ovAny")]])}
        ${sel("pSeats", t("seatsLbl"), [["open", t("seatsOpen")], ["open+wait", t("seatsWait")], ["any", t("seatsAny")]])}
        ${sel("pMaxDays", t("mdLbl"), [[5, t("mdAny")], [4, t("mdUpTo", 4)], [3, t("mdUpTo", 3)], [2, t("mdUpTo", 2)]])}
        ${sel("pFormat", t("fmLbl"), [["any", t("fmAny")], ["inperson", t("fmIn")]])}
        <div class="field"><span>${esc(t("daysOff"))}</span><div class="days">${[0, 1, 2, 3, 4].map((d) => `<button class="day-btn" data-day="${d}" aria-pressed="${p.daysOff.includes(d)}">${LANG === "zh" ? "一二三四五"[d] : "MTWRF"[d]}</button>`).join("")}</div></div>
      </div>
      <div class="opts"><label class="chk"><input type="checkbox" data-pref="freeDays"${p.freeDays ? " checked" : ""}> ${esc(t("freeDays"))}</label>
        <label class="chk"><input type="checkbox" data-pref="compact"${p.compact ? " checked" : ""}> ${esc(t("compact"))}</label>
        <label class="chk"><input type="checkbox" data-pref="lunch"${p.lunch ? " checked" : ""}> ${esc(t("lunchLbl"))}</label>
        <label class="chk"><input type="checkbox" data-pref="quality"${p.quality ? " checked" : ""}> ${esc(t("quality"))}</label></div></section>
  </div>
  <div class="bfoot"><button class="btn primary big" id="build"${S.building ? " disabled" : ""}>${esc(t(S.building ? "building" : "build"))}</button></div>`;
  $("#stCourses").innerHTML = h;
  $("#pEarly").value = p.earliest; $("#pLate").value = p.latest; $("#pSeats").value = p.seats;
  $("#pBuffer").value = p.buffer; $("#pOverlap").value = p.overlap > 9000 ? 9999 : p.overlap; $("#pMaxDays").value = p.maxDays; $("#pFormat").value = p.format;
}

/* ── Step 3: results ──────────────────────────────────────────────────── */
function pkTags(p, brief = false) {
  const tags = [];
  if (p.consent) tags.push(t("consent"));
  if (p.risk) tags.push(t("riskPrq"));
  if (!brief && p.meets.some((m) => m.w)) tags.push(t("partTerm"));
  return tags.map((x) => `<span class="tag">${esc(x)}</span>`).join(" ");
}
function statusChip(p) {
  const cls = p.status === "O" ? "open" : p.status === "W" ? "wait" : "closed";
  const lbl = p.status === "O" ? `${t("open")} · ${p.seats}` : p.status === "W" ? `${t("wait")}` : t("full");
  return `<span class="status"><span class="dot ${cls}"></span>${esc(lbl)}</span>`;
}
function statusDot(p) {
  const cls = p.status === "O" ? "open" : p.status === "W" ? "wait" : "closed";
  const lbl = p.status === "O" ? `${t("open")} · ${p.seats}` : p.status === "W" ? t("wait") : t("full");
  return `<span class="dot ${cls}" role="img" title="${esc(lbl)}" aria-label="${esc(lbl)}"></span>`;
}
const gpaTier = (g) => (g == null ? "na" : g >= 3.5 ? "hi" : g >= 3.2 ? "mid" : "lo");
const gpaBadge = (g) => `<span class="gpa-badge ${gpaTier(g)}"><b>${g == null ? "–" : f2(g)}</b><i>${esc(t("gpaLbl"))}</i></span>`;
const secWhen = (s) => (s.m.length ? s.m.map((m) => `${daysText([...m[0]].map((ch) => DAY_LETTERS.indexOf(ch)))} ${fmtRange(m[1], m[2])}`).join(", ") : t("online"));
const leadOf = (p) => (p.raw.s || []).find((s) => s.t === "LEC" || s.t === "SEM") || (p.raw.s || [])[0];

function histOf(c, name) { return c && c.ins ? c.ins.find((i) => sameName(i[0], name)) : null; }

function pickSummary(p) {
  const lead = leadOf(p);
  const when = lead ? secWhen(lead) : t("online");
  const tags = pkTags(p, true);
  return `<div class="pk-title"><b>${esc(p.code)}</b> <span class="pk-name">${esc(p.title || "")}</span></div>
    <div class="pk-line">${esc(when)}${tags ? ` ${tags}` : ""}</div>`;
}

/** Every course in any of the options, with the options (and the packages) it appears in. */
function courseEntries(r) {
  const map = new Map();
  r.schedules.forEach((sch, i) => sch.picks.forEach((p) => {
    const e = map.get(p.course) || map.set(p.course, { course: p.course, pkgs: new Map(), opts: [] }).get(p.course);
    if (!e.opts.includes(i)) e.opts.push(i);
    const k = e.pkgs.get(p.id) || e.pkgs.set(p.id, { p, opts: [] }).get(p.id);
    k.opts.push(i);
  }));
  return [...map.values()].map((e) => {
    const here = [...e.pkgs.values()].find((k) => k.opts.includes(S.i));
    return { ...e, here: !!here, p: (here || [...e.pkgs.values()][0]).p, gpa: (S.courses.get(e.course) || {}).gpa ?? null };
  });
}

const earliestOf = (p) => (p.meets.length ? Math.min(...p.meets.map((m) => m.s)) : 9999);
const SEAT_RANK = { O: 0, W: 1 };
const SORTS = {
  gpa: (a, b) => (b.gpa ?? -1) - (a.gpa ?? -1),
  gpaL: (a, b) => (a.gpa ?? 9) - (b.gpa ?? 9),
  code: (a, b) => a.p.code.localeCompare(b.p.code, "en", { numeric: true }),
  cr: (a, b) => b.p.cr - a.p.cr,
  start: (a, b) => earliestOf(a.p) - earliestOf(b.p),
  seats: (a, b) => (SEAT_RANK[a.p.status] ?? 2) - (SEAT_RANK[b.p.status] ?? 2) || b.p.seats - a.p.seats,
  opts: (a, b) => b.opts.length - a.opts.length,
  here: (a, b) => Number(b.here) - Number(a.here),
};
const SORT_KEYS = Object.keys(SORTS);
const sortKey = () => (SORT_KEYS.includes(S.sort) ? S.sort : "gpa");

function optChips(e, n) {
  if (n <= 1) return "";
  if (e.opts.length === n) return "";
  return `<span class="opt-chips"><span class="opt-lbl">${esc(t("optLbl"))}</span>${e.opts.map((i) => `<button type="button" class="opt-chip${i === S.i ? " on" : ""}" data-var="${i}" aria-label="${esc(t("variant", i + 1, n))}">${i + 1}</button>`).join("")}</span>`;
}

function pickDetail(e, c, sch) {
  const p = e.p, r = rec(p.course), d = planOf(p.course), n = S.results.schedules.length;
  const dist = r && r.dist ? `<div class="pd-grades">${strip(r.dist, 12)}<div class="pd-stats"><span>${esc(t("cr", p.cr))}</span><span><b>${f2(c && c.gpa)}</b> ${esc(t("gpaLbl"))}</span>${r.pa != null ? `<span><b>${esc(pct(r.pa))}</b> ${esc(t("kA"))}</span>` : ""}${r.n ? `<span><b>${esc(fmt(r.n))}</b> ${esc(t("pdStudents"))}</span>` : ""}</div></div>` : `<div class="pd-stats"><span>${esc(t("cr", p.cr))}</span></div><p class="muted">${esc(t("noGrades"))}</p>`;
  const pkgs = [...e.pkgs.values()];
  const names = [...new Set(pkgs.flatMap((k) => (k.p.raw.s || []).flatMap((s) => s.i || [])))];
  const ins = names.map((nm) => {
    const h = histOf(c, nm);
    return `<li><span>${esc(nm)}</span><span class="pd-ig">${h && h[2] >= 30 ? `${esc(f2(h[1]))} <i>${esc(t("pdStudentsN", fmt(h[2])))}</i>` : "–"}</span></li>`;
  }).join("");
  const secsOf = (k) => (k.p.raw.s || []).map((s) => `<li><b>${esc(s.t)} ${esc(s.n)}</b><span class="muted">${s.k ? "#" + s.k : ""}</span><span>${esc(secWhen(s))}${s.m[0] && s.m[0][3] ? ` · ${esc(s.m[0][3])}` : ""}</span></li>`).join("");
  const secs = pkgs.map((k) => `${pkgs.length > 1 ? `<div class="pd-pkg"><span class="opt-lbl">${esc(t("optLbl"))}</span> ${k.opts.map((i) => `<b>${i + 1}</b>`).join(" ")} ${statusChip(k.p)}</div>` : ""}<ul class="pd-secs">${secsOf(k)}</ul>`).join("");
  const br = ((d && d.br) || []).map((b) => `<span class="tag soft">${esc(brName(b))}</span>`).join(" ");
  return `<div class="pk-detail">
    <div class="pd-col"><h4>${esc(t("grades"))}</h4>${dist}${ins ? `<h4>${esc(t("instructors"))}</h4><ul class="pd-ins">${ins}</ul>` : ""}</div>
    <div class="pd-col"><h4>${esc(t("pdSections"))} ${pkgs.length === 1 ? statusChip(p) : ""}</h4>${secs}
      ${d && d.prq ? `<h4 class="h-prq">${esc(t("pdPrereq"))}</h4><p class="pd-prq">${esc(String(d.prq).slice(0, 260))}${d.prq.length > 260 ? "…" : ""}</p>` : ""}
      ${br || pkTags(p) ? `<div class="pd-tags">${br} ${pkTags(p)}</div>` : ""}
      <div class="pd-actions">${e.here ? `<button class="btn" data-swap="${esc(p.course)}">${esc(t("swap"))}</button>` : ""}<button class="btn" data-opencourse="${esc(p.course)}">${esc(t("pdOpen"))}</button>${plan.must.has(p.course) || [...plan.must].some((id) => (planOf(id) || {}).id === p.course) ? `<button class="btn" data-rmres="${esc(p.course)}">${esc(t("pdRemove"))}</button>` : ""}</div>
      ${S.swap === p.course && e.here ? swapHtml(sch, p.course) : ""}</div></div>`;
}

function resultsHtml() {
  const r = S.results;
  if (S.building) return `<p class="muted">${esc(t("building"))}</p>`;
  if (!r) return `<div class="empty-state"><p>${esc(t("resultEmpty"))}</p></div>`;
  if (!r.ok) {
    return `<ul class="reasons">${r.reasons.map((x) => `<li>${esc(
      x.type === "empty" ? t("why_empty") : x.type === "none" ? t("why_none", x.code, x.why) : x.type === "clash" ? t("why_clash", x.a, x.b) : x.type === "over" ? t("why_credits", x.have, x.hi) : x.type === "days" ? t("why_days", x.n) : t("why_nofit"))}</li>`).join("")}</ul>`;
  }
  const sch = r.schedules[S.i] || r.schedules[0], n = r.schedules.length;
  const days = LANG === "zh" ? "一二三四五" : "MTWRF";
  const free = sch.freeDays.map((d) => days[d]);
  const time = sch.earliest != null ? t("schedSpan", fmtRange(sch.earliest, sch.latest).split("–")[0], fmtRange(sch.earliest, sch.latest).split("–")[1]) : "";
  const graded = sch.picks.filter((p) => (S.courses.get(p.course) || {}).gpa != null);
  const gw = graded.reduce((a, p) => a + p.cr, 0);
  const avg = gw ? graded.reduce((a, p) => a + (S.courses.get(p.course).gpa * p.cr), 0) / gw : null;
  const meta = [t("schedCredits", +sch.credits.toFixed(1)), avg != null ? t("schedAvg", f2(avg)) : "", t("schedFree", free), time, sch.waitlisted ? t("schedWait", sch.waitlisted) : "", sch.full ? t("schedFull", sch.full) : ""].filter(Boolean);
  const entries = courseEntries(r).sort((a, b) => SORTS[sortKey()](a, b) || SORTS.code(a, b));
  const online = sch.picks.filter((p) => !p.meets.length);
  let h = `<div class="res-bar"><div class="variants">${r.schedules.map((_, i) => `<button class="var-btn" data-var="${i}" aria-pressed="${i === S.i}">${i + 1}</button>`).join("")}<span class="muted">${esc(t("variant", S.i + 1, n))}</span></div>
    <div class="res-actions"><button class="linkbtn" id="rsCopy">${esc(t("copyNums"))}</button><button class="linkbtn" id="rsIcs">${esc(t("icsBtn"))}</button></div></div>
    <p class="res-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}${sch.overlapMin ? `<span class="warn">${esc(t("schedOverlap", sch.overlapMin))}</span>` : ""}${sch.short ? `<span class="warn">${esc(t("why_credits", +sch.credits.toFixed(1), plan.crMin))}</span>` : ""}</p>
    ${calendarHtml(sch.picks, colorOf, LANG)}
    ${online.length ? `<p class="muted">${esc(t("online"))}: ${online.map((p) => esc(p.code)).join(", ")}</p>` : ""}
    <div class="list-head"><h3 class="sub-h">${esc(t("courseList", entries.length))}</h3>
      <label class="field inline"><span>${esc(t("sortBy"))}</span><select id="pkSort">${SORT_KEYS.map((k) => `<option value="${k}"${k === sortKey() ? " selected" : ""}>${esc(t("psort_" + k))}</option>`).join("")}</select></label></div>
    <ul class="picks">`;
  h += entries.map((e) => {
    const p = e.p, c = S.courses.get(p.course);
    return `<li class="pick${e.here ? "" : " off"}" data-pick="${esc(p.course)}"><details${S.openPick.has(p.course) ? " open" : ""} data-pk="${esc(p.course)}"><summary>
      <span class="sw c${colorOf(p.course) % COLORS + 1}"></span>${gpaBadge(c && c.gpa)}
      <div class="pk-main">${pickSummary(p)}</div><span class="pk-side">${optChips(e, n)}${statusDot(p)}</span><span class="chev" aria-hidden="true"></span></summary>
      ${pickDetail(e, c, sch)}</details></li>`;
  }).join("") + `</ul>
    <div class="add add-result"><label class="field"><span>${esc(t("addMore"))}</span><input id="addQ2" type="search" autocomplete="off" placeholder="${esc(t("addCourse"))}" aria-label="${esc(t("addMore"))}"></label><div id="addRes2" class="suggest" hidden></div></div>`;
  return h;
}

function swapHtml(sch, courseId) {
  const c = S.courses.get(courseId);
  const alts = c ? swapOptions(sch, courseId, c, prefs()).slice(0, 12) : [];
  return `<div class="swap">${alts.map((a) => `<button class="swap-opt${a.id === sch.picks.find((p) => p.course === courseId)?.id ? " on" : ""}" data-swapto="${esc(a.id)}">${(a.raw.s || []).map((s) => `${esc(s.t)} ${esc(secWhen(s))}`).join(" + ")} · ${statusChip(a)}</button>`).join("") || `<span class="muted">${esc(t("noSections"))}</span>`}</div>`;
}

function renderResults() { $("#stResults").innerHTML = resultsHtml(); }

/* ── Building ─────────────────────────────────────────────────────────── */
const asCourse = (p, extra = {}) => ({ id: p.id, code: p.code, title: p.t, cr: p.cr, packages: p.pk, gpa: p.gpa, ins: p.ins, weight: 0, ...extra });

export async function build(override = {}) {
  if (S.building) return S.results;
  S.building = true; S.results = null; S.i = 0; S.swap = null; renderCourses(); renderResults();
  try {
    if (!plan.must.size && !plan.fill && plan.program) { plan.fill = true; plan.save(); }  // nothing picked: fill from the program
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
    const credits = plan.fill ? [plan.crMin, plan.crMax] : [0, plan.crMax];
    const res = must.length || (plan.fill && pool.length)  // nothing to place: say so instead of an empty timetable
      ? await runSolve({ must, pool: plan.fill ? pool : [], prefs: { ...prefs(), ...override }, credits, caps: blockCaps(st || []), limit: 6 })
      : { ok: false, schedules: [], reasons: [{ type: "empty" }] };
    for (const s of res.schedules || []) for (const p of s.picks) p.risk = !!(S.courses.get(p.course) || {}).risk;
    S.results = res;
    loadRows([...new Set((res.schedules || []).flatMap((s) => s.picks.map((p) => p.course)))]).then(renderResults).catch(() => {});
  } catch (e) {
    S.results = { ok: false, schedules: [], reasons: [{ type: "nofit" }] };
  }
  S.building = false; renderCourses(); renderResults();
  const r = S.results;
  toast(r && r.ok ? t("toastBuilt", r.schedules.length) : t("toastNoFit"), r && r.ok ? "" : "err");
  if (r && r.ok) {
    const card = document.querySelector(".card.result"), top = card ? card.getBoundingClientRect().top : 0;
    if (card && (top > innerHeight * 0.55 || top < 0)) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return S.results;
}

/* ── Semester roadmap ─────────────────────────────────────────────────── */
const DEGREE_CR = 120;
// The published term has started: in-progress courses are in it, so plan from the next one
const termStarted = () => !(Date.parse((app.meta.term_range || "").split("/")[0] + "T00:00:00") > Date.now());
const startTerm = () => (plan.ip.size && termStarted() ? nextTerm(app.term) : app.term);
const idKey = (id) => id.replace(/\s+/g, "-");

/** list rows for any id or cross-listing, keyed by every id they answer to */
function rowMap(ids) {
  const m = new Map();
  for (const r of Object.values(ROW)) { m.set(r.id, r); (r.al || []).forEach((a) => m.set(idKey(a), r)); }
  return new Map([...new Set(ids)].map((id) => [id, m.get(id)]).filter((x) => x[1]));
}

const earnedAuto = () => { const c = plan.transcriptCredits(); return c ? c.done + c.ip : null; };

async function creditsEarned() {
  if (plan.earned != null) return plan.earned;
  if (earnedAuto() != null) return earnedAuto();
  const ids = [...plan.done, ...plan.ip];
  await loadRows(ids).catch(() => {});
  const rows = rowMap(ids), seen = new Set();
  let sum = 0;
  for (const id of ids) {
    const r = rows.get(id), k = r ? r.id : id;
    if (seen.has(k)) continue;
    seen.add(k); sum += r ? crNum(r.cr) : 3;
  }
  return sum;
}

async function lightPools() {
  if (R.pools) return R.pools;
  const base = { lens: "easy", sort: "gpa", now: "1", limit: "60" };
  const defs = [{}, { br: "__ge" }, ...((app.meta && app.meta.breadths) || []).slice(0, 5).map((br) => ({ br })), { br: "__es" }];
  const lists = await Promise.all(defs.map((d) => api("/api/courses", { ...base, ...d }).then((r) => r.rows.map((x) => (ROW[x.id] ||= fill(x)))).catch(() => [])));
  R.pools = lists.filter((l) => l.length);
  return R.pools;
}

async function planRoad() {
  if (R.busy) return;
  const st = statuses();
  if (!S.program || !st) { R.out = null; renderRoad(); return; }
  R.busy = true; R.error = ""; renderRoad();
  try {
    const earned = await creditsEarned();
    const taken = new Set([...plan.done, ...plan.ip]);
    const opts = new Set();
    for (const s of st) if (s.counted && !s.planned) for (const x of s.items) if (x.state === "todo" && (s.block.rule.t !== "all" || x.item.o.length > 1)) for (const o of x.item.o) o.i.forEach((i) => opts.add(i));
    await loadRows([...opts]).catch(() => {});
    const lo = plan.crMin, hi = plan.crMax, remaining = Math.max(0, DEGREE_CR - earned), start = startTerm();
    const auto = !(plan.grad && plan.grad >= start), rows = rowMap([...opts]), keyOf = (id) => (planOf(id) ? planOf(id).id : id);
    const exclude = new Set();
    let picks, have, res, terms, requiredCr, freeCr, n;
    for (let round = 0; round < 5; round++) {   // swap out elective options whose prerequisites cannot be met in time
      picks = pickRequired(st, rows, new Set([...plan.must]), exclude);
      await loadPlanData([...picks.flatMap((p) => p.ids), ...plan.must]);
      have = new Set(picks.flatMap((p) => p.ids.map(keyOf)));
      for (const id of plan.must) {
        const p = planOf(id);
        if (!p || have.has(p.id) || taken.has(id) || taken.has(p.id)) continue;
        have.add(p.id);
        picks.push({ id, ids: [id], t: p.t, cr: crNum(p.cr), block: -1, blockName: "", kind: "extra", user: true });
      }
      requiredCr = picks.reduce((a, p) => a + (planOf(p.id) ? crNum(planOf(p.id).cr) : p.cr), 0);
      n = auto ? Math.min(10, Math.max(1, Math.ceil(remaining / ((lo + hi) / 2)), Math.ceil(requiredCr / hi))) : termsBetween(start, plan.grad).length;
      terms = termsFrom(start, n); freeCr = Math.max(0, remaining - requiredCr);
      res = layout({ picks, data: planOf, taken, designations: app.designations, terms, lo, hi, freeCr, maxMain: plan.mainMax || Infinity, now: app.term });
      const bad = res.unplaced.filter((u) => u.pick.kind === "elective");
      if (!bad.length) break;
      bad.forEach((u) => u.pick.ids.forEach((id) => exclude.add(id)));
    }
    const pools = await lightPools();
    const skip = new Set([...have, ...picks.flatMap((p) => p.ids), ...plan.must]);
    const first = chooseLight({ semesters: res.semesters, pools, data: planOf, taken, designations: app.designations, skip });
    await loadPlanData(first.flatMap((s) => s.light.map((r) => r.id))).catch(() => {});
    res.semesters = chooseLight({ semesters: res.semesters, pools, data: planOf, taken, designations: app.designations, skip });
    R.out = { res, earned, remaining, requiredCr, freeCr, n, auto, terms };
  } catch (e) {
    R.out = null; R.error = String((e && e.message) || e);
  }
  R.busy = false; renderRoad();
  toast(R.out ? t("toastRoad", R.out.res.semesters.length) : t("apiError"), R.out ? "" : "err");
}

function useSemester(btn) {
  const sem = R.out && R.out.res.semesters[0];
  if (!sem) return;
  sem.main.forEach((p) => plan.must.add(p.id));
  plan.save(); emit("plan");
  btn.textContent = t("roadUsed"); btn.disabled = true;
  toast(t("toastAddedN", sem.main.length));
}

const courseLine = (code, title, cr, gpa, extra = "") => `<b>${esc(code)}</b> ${esc(title || "")} <span class="muted">${esc(t("roadCredits", +(+cr).toFixed(1)))}</span>${gpa != null ? ` <span class="gpa-chip">${esc(f2(gpa))}</span>` : ""}${extra}`;

function semHtml(s, i) {
  const kinds = t("roadKind"), avg = s.main.filter((p) => p.gpa != null);
  const avgGpa = avg.length ? avg.reduce((a, p) => a + p.gpa, 0) / avg.length : null;
  const main = s.main.map((p) => {
    const d = planOf(p.id), code = d ? d.code : idText(p.id);
    return `<li>${courseLine(code, d ? d.t : p.t, p.cr, p.gpa, p.kind !== "core" ? ` <span class="tag soft">${esc(kinds[p.kind] || "")}</span>` : "")}${p.blockName ? `<span class="rd-why muted">${esc(p.blockName)}</span>` : ""}</li>`;
  }).join("") || `<li class="muted">${esc(t("roadNoMain"))}</li>`;
  const light = (s.light || []).map((r) => `<li>${courseLine(r.code, r.t, crNum(r.cr), r.gs ?? r.gpa ?? null, (r.br || []).slice(0, 2).map((b) => ` <span class="tag soft">${esc(brName(b))}</span>`).join(""))}${i === 0 ? `<button class="mini-btn" data-rdadd="${esc(r.id)}" aria-label="${esc(t("roadAddOne"))} ${esc(r.code)}">+</button>` : ""}</li>`).join("");
  const total = s.mainCr + (s.lightGot ?? s.lightCr);
  return `<article class="road-sem${i === 0 ? " now" : ""}"><header><b class="serif">${esc(termLabel(s.term))}</b>${i === 0 ? `<span class="tag soft">${esc(t("roadFirst"))}</span>` : ""}
      <span class="rd-tot">${esc(t("roadCredits", +total.toFixed(1)))}${avgGpa != null ? ` · ${esc(t("roadAvg", avgGpa.toFixed(2)))}` : ""}</span></header>
    <div class="label">${esc(t("roadMain"))} · ${esc(t("roadCount", s.main.length))} · ${esc(t("roadCredits", +s.mainCr.toFixed(1)))}</div><ul class="road-list">${main}</ul>
    ${s.lightCr > 0 ? `<div class="label">${esc(t("roadLight"))} · ${esc(t("roadCredits", +s.lightCr.toFixed(1)))}</div><ul class="road-list light">${light || `<li class="muted">–</li>`}</ul>` : ""}
    ${s.short ? `<p class="warn rd-note">${esc(t("roadShort", +s.short.toFixed(1)))}</p>` : ""}
    ${i === 0 && s.main.length ? `<button class="btn" data-rduse="1">${esc(t("roadUse"))}</button>` : ""}</article>`;
}

// One line confirming what the imported transcript gave, shown at the top of the route card
function importLine() {
  const cr = plan.transcriptCredits(), keys = Object.keys(plan.creditOf);
  const nd = keys.length ? keys.filter((id) => plan.done.has(id)).length : plan.done.size, ni = keys.length ? keys.filter((id) => plan.ip.has(id)).length : plan.ip.size;
  return nd + ni ? `<p class="rd-import">✓ ${esc(t("importedN", nd + ni))} <span class="muted">· ${esc(t("importedSub", nd, ni, cr ? +(cr.done + cr.ip).toFixed(1) : 0))}</span></p>` : "";
}

function renderRoad() {
  const box = $("#stRoad");
  if (!box) return;
  if (!S.program) { box.innerHTML = importLine() + `<p class="muted">${esc(t("roadNoProgram"))}</p>`; return; }
  const start = startTerm(), o = R.out;
  const sel = [`<option value="0">${esc(o && o.auto ? t("roadAuto", o.n, termLabel(o.terms[o.terms.length - 1])) : t("roadAutoPlain"))}</option>`,
    ...termsFrom(start, 10).map((c) => `<option value="${c}"${plan.grad === c ? " selected" : ""}>${esc(termLabel(c))}</option>`)].join("");
  let h = importLine() + `<p class="muted rd-help">${esc(t("roadHelp"))}</p>
    <div class="fgrid road-ctl">
      <label class="field"><span>${esc(t("roadGrad"))}</span><select id="rdGrad">${sel}</select></label>
      <label class="field"><span>${esc(t("roadEarned"))}</span><input id="rdEarned" type="number" inputmode="numeric" min="0" max="300" value="${plan.earned ?? (earnedAuto() != null ? +earnedAuto().toFixed(1) : o ? Math.round(o.earned) : "")}" placeholder="–"><small class="hint">${esc(t(plan.earned != null ? "roadEdited" : earnedAuto() != null ? "roadFromTr" : "roadEstimated"))}</small></label>
      <div class="field"><span>${esc(t("crRange"))}</span><div class="cr-row">${crRangeHtml()}</div></div>
      <label class="field"><span>${esc(t("roadMainN"))}</span><select id="rdMain">${[0, 2, 3, 4, 5].map((k) => `<option value="${k}"${(plan.mainMax || 0) === k ? " selected" : ""}>${esc(k ? t("roadAtMost", k) : t("roadAutoPlain"))}</option>`).join("")}</select></label>
      <button class="btn primary" id="rdGo"${R.busy ? " disabled" : ""}>${esc(t(R.busy ? "roadWorking" : "roadGo"))}</button>
    </div>`;
  if (R.error) h += `<p class="warn">${esc(t("apiError"))}</p>`;
  if (o) {
    const { res } = o, per = res.semesters.length ? res.needCr / res.semesters.length : 0;
    h += `<p class="rd-sum"><b>${esc(t("roadSummary", +res.needCr.toFixed(1), +o.requiredCr.toFixed(1), +o.freeCr.toFixed(1), res.semesters.length, +per.toFixed(1)))}</b></p>`;
    if (res.over > 0) h += `<p class="warn">${esc(t("roadOver", +res.over.toFixed(1), res.earliest))}</p>`;
    else if (res.earliest < res.semesters.length) h += `<p class="muted">${esc(t("roadEarly", res.earliest))}</p>`;
    h += `<div class="road-grid">${res.semesters.map(semHtml).join("")}</div>`;
    if (res.unplaced.length) {
      h += `<div class="blk"><div class="label">${esc(t("roadLeft"))}</div><ul class="road-list">${res.unplaced.map((u) => {
        const d = planOf(u.pick.id);
        return `<li>${courseLine(d ? d.code : idText(u.pick.id), d ? d.t : u.pick.t, u.pick.cr, null)} <span class="warn">${esc(t("roadWhy")[u.reason])}</span></li>`;
      }).join("")}</ul></div>`;
    }
    h += `<p class="muted rd-note">${esc(t("roadEx"))} ${esc(t("roadAssume"))}</p>`;
  }
  box.innerHTML = h;
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
  S.draft = { done: [...plan.done].map((id) => [id]), ip: [...plan.ip].map((id) => [id]), failed: [], creditOf: { ...plan.creditOf } };
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
  S.draft = { done: r.doneGroups, ip: r.ipGroups, failed: r.failed, creditOf: r.creditOf || {} };
  $("#impDraft").innerHTML = r.done.length || r.ip.length ? draftHtml() : `<p class="muted">${esc(t("importNone"))}</p>`;
}

/* ── Wiring ───────────────────────────────────────────────────────────── */
let suggestTimer;
async function suggest(q, boxSel = "#addRes") {
  const box = $(boxSel);
  if (!q.trim()) { box.hidden = true; return; }
  try {
    const r = await api("/api/courses", { q, limit: 8, sort: "m" });
    box.innerHTML = r.rows.map((c) => `<button data-addc="${esc(c.id)}"><b>${esc(c.code)}</b> ${esc(c.t)} <span class="muted">${c.now ? "" : esc(t("notOffered"))}</span></button>`).join("") || `<span class="muted pad">${esc(t("empty"))}</span>`;
    r.rows.forEach((c) => { ROW[c.id] ||= fill(c); });
    box.hidden = false;
  } catch { box.hidden = true; }
}

function renderAll() { renderDegree(); renderCourses(); renderResults(); renderRoad(); }

export function localize() {
  $("#plTitle").textContent = t("planTitle", termNow());
  $("#plP").textContent = t("cardProgram"); $("#plT").textContent = t("cardTranscript");
  $("#plC").textContent = t("cardBuild"); $("#plS").textContent = t("stepSchedule"); $("#plR").textContent = t("cardRoad");
  renderAll();
}

export async function init() {
  const root = $("#v-plan");
  root.innerHTML = `<div class="page-head"><h1 class="serif" id="plTitle"></h1></div>
    <div class="plan-top">
      <section class="card"><h2 id="plP"></h2><div id="stDegree"></div></section>
      <section class="card"><h2 id="plT"></h2><div id="stTranscript"></div></section>
    </div>
    <details class="card reqcard" id="reqCard" hidden><summary id="reqSum"></summary><div id="stReqs"></div></details>
    <section class="card road" id="roadCard"><h2 id="plR"></h2><div id="stRoad" aria-live="polite"></div></section>
    <div class="plan-work">
      <section class="card build"><h2 id="plC"></h2><div id="stCourses"></div></section>
      <section class="card result"><h2 id="plS"></h2><div id="stResults" aria-live="polite"></div></section>
    </div>`;
  try { S.index = await (await fetch(new URL("assets/programs/index.json", BASE))).json(); } catch { S.index = []; }
  if (plan.program) await loadProgram(plan.program);

  root.addEventListener("input", (e) => {
    if (e.target.id === "pgInput") pgOpen();
    if (e.target.id === "addQ" || e.target.id === "addQ2") { const box = e.target.id === "addQ" ? "#addRes" : "#addRes2"; clearTimeout(suggestTimer); suggestTimer = setTimeout(() => suggest(e.target.value, box), 150); }
  });
  root.addEventListener("focusin", (e) => { if (e.target.id === "pgInput") { e.target.select(); pgOpen(); } });
  root.addEventListener("focusout", (e) => {
    if (e.target.id !== "pgInput") return;
    setTimeout(() => {
      const i = $("#pgInput"), pm = programMeta();
      if (!i || document.activeElement === i) return;
      pgClose();
      if (pm && i.value.trim() && !S.index.some((p) => p.name.toLowerCase() === i.value.trim().toLowerCase())) i.value = pm.name;
    }, 120);
  });
  root.addEventListener("mousedown", (e) => { if (e.target.closest("#pgList")) e.preventDefault(); });
  root.addEventListener("keydown", (e) => {
    // Add-a-course box: Enter takes the first suggestion
    if ((e.target.id === "addQ" || e.target.id === "addQ2") && e.key === "Enter") {
      const box = $(e.target.id === "addQ" ? "#addRes" : "#addRes2"), first = box && !box.hidden && box.querySelector("[data-addc]");
      if (first) { e.preventDefault(); first.click(); }
      return;
    }
    if (e.target.id !== "pgInput") return;
    if (e.key === "ArrowDown") { e.preventDefault(); pgMove(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); pgMove(-1); }
    else if (e.key === "Enter") { const h = $("#pgList .hl") || (pgOptions(e.target.value).length === 1 ? $("#pgList [data-pg]") : null); if (h) { e.preventDefault(); pgChoose(h.dataset.pg); } }
    else if (e.key === "Escape") pgClose();
  });
  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.id === "pgInput") {
      const m = S.index.find((p) => p.name.toLowerCase() === el.value.trim().toLowerCase());
      if (m) { if (m.id !== plan.program) pgChoose(m.id); }
      else if (!el.value.trim() && plan.program) { plan.program = ""; plan.save(); loadProgram(""); }
    } else if (el.dataset.cr) {
      if (el.dataset.cr === "min") setCredits(el.value, Math.max(plan.crMax, +el.value || 0));
      else setCredits(plan.crMin, el.value);
      renderCourses(); renderRoad();
      if (R.out) planRoad();
    } else if (el.id === "rdGrad") { plan.grad = +el.value || 0; plan.save(); if (R.out) planRoad(); else renderRoad(); }
    else if (el.id === "rdMain") { plan.mainMax = +el.value || 0; plan.save(); if (R.out) planRoad(); }
    else if (el.id === "rdEarned") {
      const v = el.value.trim() === "" ? null : Math.min(300, Math.max(0, +el.value || 0));
      plan.earned = v != null && earnedAuto() != null && Math.abs(v - earnedAuto()) < 0.05 ? null : v;
      plan.save(); renderRoad(); if (R.out) planRoad();
    }
    else if (el.id === "fillBox") { plan.fill = el.checked; plan.save(); }
    else if (el.id === "pkSort") { S.sort = el.value; store.set("planSort", S.sort); renderResults(); }
    else if (el.id === "pEarly") setPref("earliest", +el.value);
    else if (el.id === "pLate") setPref("latest", +el.value);
    else if (el.id === "pSeats") setPref("seats", el.value);
    else if (el.id === "pBuffer") setPref("buffer", +el.value);
    else if (el.id === "pOverlap") setPref("overlap", +el.value);
    else if (el.id === "pMaxDays") setPref("maxDays", +el.value);
    else if (el.id === "pFormat") setPref("format", el.value);
    else if (el.dataset.pref) setPref(el.dataset.pref, el.checked ? 1 : 0);
  });
  root.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d.matches && d.matches("details[data-pk]")) { d.open ? S.openPick.add(d.dataset.pk) : S.openPick.delete(d.dataset.pk); return; }
    if (!d.matches || !d.matches("details.req")) return;
    const bi = +d.dataset.b;
    d.open ? S.open.add(bi) : S.open.delete(bi);
    if (d.open && S.program) {
      const ids = S.program.blocks[bi].items.flatMap((i) => i.o.map((o) => o.i[0]));
      loadPlanData(ids).then(() => { if (S.open.has(bi)) { const keep = new Set(S.open); renderReqs(); S.open = keep; } }).catch(() => {});
    }
  }, true);
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("button, a"); if (!b) { if (!e.target.closest(".add")) document.querySelectorAll(".add .suggest").forEach((x) => { x.hidden = true; }); return; }
    if (b.dataset.pg) pgChoose(b.dataset.pg);
    else if (b.id === "pgImport" || b.id === "pgEdit") openImport();
    else if (b.dataset.addreq) { const p = planOf(b.dataset.addreq); const id = p ? p.id : b.dataset.addreq; plan.must.has(id) ? plan.remove(id) : plan.add(id); }
    else if (b.dataset.took) { const id = b.dataset.took; plan.done.add(id); plan.save(); renderDegree(); }
    else if (b.dataset.rm) plan.remove(b.dataset.rm);
    else if (b.dataset.addc) {
      const box = b.closest(".add"), inRes = !!b.closest(".add-result");
      plan.add(b.dataset.addc);
      if (box) { box.querySelector("input").value = ""; box.querySelector(".suggest").hidden = true; }
      if (inRes) build();
    }
    else if (b.dataset.rmres) { removeCourse(b.dataset.rmres); }
    else if (b.dataset.day) { const d = +b.dataset.day, cur = new Set(prefs().daysOff); cur.has(d) ? cur.delete(d) : cur.add(d); setPref("daysOff", [...cur]); renderCourses(); }
    else if (b.id === "build") build();
    else if (b.dataset.opencourse) emit("open", b.dataset.opencourse);
    else if (b.id === "rdGo") planRoad();
    else if (b.dataset.rduse) useSemester(b);
    else if (b.dataset.rdadd) { plan.add(b.dataset.rdadd); b.textContent = "✓"; b.disabled = true; }
    else if (b.id === "plCompare") openCompare([...plan.must]);
    else if (b.dataset.var) { e.preventDefault(); S.i = +b.dataset.var; S.swap = null; renderResults(); }
    else if (b.dataset.swap) { S.swap = S.swap === b.dataset.swap ? null : b.dataset.swap; S.openPick.add(b.dataset.swap); renderResults(); }
    else if (b.dataset.swapto) swapTo(b.dataset.swapto);
    else if (b.id === "rsCopy") { const s = S.results.schedules[S.i]; navigator.clipboard && navigator.clipboard.writeText([...new Set(s.picks.flatMap((p) => p.raw.s.map((x) => x.k).filter(Boolean)))].join(", ")); b.textContent = t("copied"); toast(t("toastCopied")); }
    else if (b.id === "rsIcs") download(S.results.schedules[S.i]);
  });
  on("plan", () => { renderCourses(); renderDegree(); loadRows([...plan.must]).then(renderCourses).catch(() => {}); });
  on("plan-sync", (d) => { if (d && d.programChanged) loadProgram(plan.program); });
  on("lang", localize);

  const dlg = $("#importDlg");
  dlg.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "impChoose") $("#impFile").click();
    else if (b.id === "impRead") readImport();
    else if (b.dataset.dr) { const [k, i] = b.dataset.dr.split(":"); S.draft[k].splice(+i, 1); $("#impDraft").innerHTML = draftHtml(); }
    else if (b.id === "impApply") {
      plan.done = new Set(S.draft.done.flat()); plan.ip = new Set(S.draft.ip.flat());
      plan.creditOf = Object.fromEntries(Object.entries(S.draft.creditOf || {}).filter(([id]) => plan.done.has(id) || plan.ip.has(id)));
      plan.earned = null; plan.save(); R.out = null; dlg.close(); emit("plan"); renderDegree(); renderRoad();
      const tc = plan.transcriptCredits();
      toast(t("toastImported", S.draft.done.length, S.draft.ip.length, tc ? +(tc.done + tc.ip).toFixed(1) : 0));
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

/** Drop a course from the must-take list (it may be stored under a cross-listed id) and rebuild. */
function removeCourse(courseId) {
  for (const id of [...plan.must]) if (id === courseId || (planOf(id) && planOf(id).id === courseId)) plan.must.delete(id);
  S.openPick.delete(courseId);
  plan.save(); emit("plan"); build();
}

function swapTo(pkgId) {
  const r = S.results, sch = r.schedules[S.i], courseId = S.swap, c = S.courses.get(courseId);
  const alt = swapOptions(sch, courseId, c, prefs()).find((a) => a.id === pkgId);
  if (!alt) return;
  alt.risk = (c || {}).risk;
  sch.picks = sch.picks.map((p) => (p.course === courseId ? alt : p));
  sch.credits = sch.picks.reduce((a, p) => a + p.cr, 0);
  Object.assign(sch, describe(sch.picks), { score: scoreSchedule(sch.picks, prefs()), short: Math.max(0, plan.crMin - sch.credits) });
  S.swap = null; renderResults();
}

function download(sch) {
  const ics = buildICS(sch.picks, `${termNow()} timetable`);
  if (!ics) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = "timetable.ics"; a.click(); toast(t("toastIcs"));
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Entry points for the assistant. */
export const planApi = {
  state() {
    const st = statuses();
    return {
      program: programMeta() ? programMeta().name : null,
      taken: [...plan.done], inProgress: [...plan.ip], mustTake: [...plan.must], creditRange: [plan.crMin, plan.crMax], fillFromRequirements: plan.fill,
      preferences: prefs(),
      unmetRequirements: st ? st.filter((s) => s.counted && !s.planned).map((s) => ({ block: s.block.h, need: `${s.need} ${s.unit}`, have: s.have, options: s.items.filter((x) => x.state === "todo").slice(0, 10).map((x) => x.item.o.map((o) => o.i[0]).join(" | ")) })) : [],
      timetable: S.results && S.results.ok ? S.results.schedules[S.i].picks.map((p) => ({ course: p.code, sections: p.raw.s.map((x) => `${x.t} ${x.n} (class ${x.k || "?"})`).join(" + "), when: p.meets.map((m) => `${DAY_LETTERS[m.d]} ${fmtRange(m.s, m.e)}`).join(", ") })) : null,
    };
  },
  setPrefs(p) { plan.prefs = { ...plan.prefs, ...p }; plan.save(); renderCourses(); },
  addMust(ids) { ids.forEach((id) => plan.must.add(id)); plan.save(); emit("plan"); },
  removeMust(ids) { ids.forEach((id) => plan.must.delete(id)); plan.save(); emit("plan"); },
  setTarget(n) { setCredits(n, Math.max(n, plan.crMax)); renderCourses(); renderRoad(); },
  setCreditRange(lo, hi) { setCredits(lo ?? plan.crMin, hi ?? plan.crMax); renderCourses(); renderRoad(); },
  async setProgram(id) { plan.program = id; plan.save(); await loadProgram(id); },
  programs: () => S.index,
  build,
};

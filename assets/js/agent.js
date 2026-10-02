// The assistant panel. The model lives behind /api/chat; this file runs the tool loop and implements the tools
// against the same API and planner the rest of the page uses.
import { $, esc, f2, pct, fmt, api, app, plan, rec, DET, ROW, fill, loadDetail, emit, sameName } from "./core.js";
import { t, LANG, termNow } from "./i18n.js";
import { loadPlanData, planOf } from "./planner/data.js";
import { planApi } from "./planner/view.js";
import { fmtRange, daysText, DAY_LETTERS } from "./planner/schedule.js";
import { cur } from "./drawer.js";

const MAX_STEPS = 6;
let msgs = [], busy = false, status = "", err = "";   // msgs: what the model sees; the UI renders the same list

const toId = (code) => String(code || "").trim().replace(/[\s/]+/g, "-").toUpperCase();
const hhmm = (s) => { const m = String(s || "").match(/^(\d{1,2}):?(\d{2})?$/); return m ? +m[1] * 60 + +(m[2] || 0) : null; };

/* ── Tools ────────────────────────────────────────────────────────────── */
const summary = (c) => ({
  code: c.code, title: c.t, credits: c.cr || null, gpa: c.gpa ?? null, share_of_A: c.pa ?? null, students_graded: c.n || 0,
  this_term: c.now ? { seats: c.now.open ? "open" : c.now.wait ? "waitlist only" : "full", teaching: (c.now.who || []).slice(0, 4) } : "not offered",
});

function lectureLines(pk) {
  const seen = new Set(), out = [];
  for (const p of pk || []) {
    const lead = p.s.find((s) => s.t === "LEC" || s.t === "SEM") || p.s[0];
    if (!lead) continue;
    const key = lead.t + lead.n;
    if (seen.has(key)) continue; seen.add(key);
    const open = (pk || []).filter((q) => (q.s[0] && q.s[0].t + q.s[0].n) === key || q.s.some((s) => s.t + s.n === key)).some((q) => q.st === "O");
    out.push(`${lead.t} ${lead.n}: ${lead.m.map((m) => `${daysText([...m[0]].map((ch) => DAY_LETTERS.indexOf(ch)))} ${fmtRange(m[1], m[2])}`).join(", ") || "no set time"}${(lead.i || []).length ? ` (${lead.i.slice(0, 2).join(", ")})` : ""} - ${open ? "has open seats" : "no open seats"}`);
  }
  return out.slice(0, 8);
}

const TOOL_IMPL = {
  async search_courses(a) {
    const p = { limit: "10" };
    if (a.q) p.q = String(a.q).slice(0, 80);
    if (a.subject) { const s = (app.meta.subjects || []).find((x) => x.toLowerCase() === String(a.subject).trim().toLowerCase()); if (s) p.subj = s; }
    if (a.level) p.lvl = String(a.level);
    if (a.min_gpa != null) p.gpa = String(a.min_gpa);
    if (a.offered_now) p.now = "1";
    if (a.sort) p.sort = String(a.sort);
    const r = await api("/api/courses", p);
    r.rows.forEach((x) => { ROW[x.id] ||= fill(x); });
    return { total: r.total, showing: r.rows.length, courses: r.rows.map(summary), note: r.rows.length ? undefined : "No match. Drop the level/subject/GPA filters or use fewer, simpler keywords and search again." };
  },
  async get_course(a) {
    const id = toId(a.id);
    let c;
    try { c = await loadDetail(id); }
    catch (e) {
      if (e.status !== 404) throw e;
      const r = await api("/api/courses", { q: String(a.id).slice(0, 60), limit: "1" });
      if (!r.rows.length) return { error: "No such course." };
      c = await loadDetail(r.rows[0].id);
    }
    const p = c.now ? (await loadPlanData([c.id]), planOf(c.id)) : null;
    return {
      ...summary(c), description: (c.d || "").slice(0, 500), prerequisites: c.prq || null, level: c.lvl, breadth: c.br, usually_offered: c.typ,
      recent_gpa: c.gr ?? null, share_D_or_F: c.pdf ?? null, gpa_trend_per_year: c.tr ?? null, instructor_gap_in_gpa_points: c.sp ?? null,
      teaching_now_with_history: (c.now ? c.now.who : []).map((n) => { const m = c.ins.find((i) => sameName(i[0], n)); return { name: n, past_gpa_here: m ? m[1] : null, students: m ? m[2] : 0 }; }),
      other_instructors: c.ins.filter((i) => !i[5] && i[2] >= 30).slice(0, 6).map((i) => ({ name: i[0], gpa: i[1], students: i[2] })),
      sections_this_term: p ? lectureLines(p.pk) : [],
      reddit_threads: c.rd.slice(0, 3).map((x) => x[0]),
    };
  },
  async get_my_plan() { return planApi.state(); },
  async update_plan(a) {
    const out = { changed: [], not_found: [] };
    if (a.program) {
      const want = String(a.program).toLowerCase(), idx = planApi.programs();
      const m = idx.find((p) => p.name.toLowerCase() === want) || idx.find((p) => p.name.toLowerCase().includes(want)) || idx.find((p) => p.id === want);
      if (m) { await planApi.setProgram(m.id); out.changed.push("program: " + m.name); } else out.not_found.push("program " + a.program);
    }
    const resolve = async (codes) => {
      const ids = (codes || []).map(toId).filter(Boolean).slice(0, 12);
      if (!ids.length) return [];
      const r = await api("/api/courses", { ids: ids.join(",") });
      r.rows.forEach((x) => { ROW[x.id] ||= fill(x); });
      const found = new Set(r.rows.map((x) => x.id));
      ids.forEach((id) => { if (!found.has(id) && !r.rows.some((x) => x.al.map(toId).includes(id))) out.not_found.push(id.replace(/-/g, " ")); });
      return r.rows.map((x) => x.id);
    };
    if (a.add_courses) { const ids = await resolve(a.add_courses); planApi.addMust(ids); out.changed.push("added " + ids.length + " course(s)"); }
    if (a.remove_courses) { const ids = await resolve(a.remove_courses); planApi.removeMust(ids); out.changed.push("removed " + ids.length + " course(s)"); }
    const pr = {};
    if (a.no_class_before !== undefined) pr.earliest = a.no_class_before ? hhmm(a.no_class_before) ?? 0 : 0;
    if (a.no_class_after !== undefined) pr.latest = a.no_class_after ? hhmm(a.no_class_after) ?? 1440 : 1440;
    if (Array.isArray(a.days_off)) pr.daysOff = a.days_off.map((d) => "MTWRF".indexOf(String(d).toUpperCase())).filter((d) => d >= 0);
    if (a.seats) pr.seats = a.seats;
    if (Object.keys(pr).length) { planApi.setPrefs(pr); out.changed.push("preferences"); }
    if (a.target_credits) { planApi.setTarget(Math.max(1, Math.min(24, +a.target_credits))); out.changed.push("credit target " + a.target_credits); }
    if (a.fill_from_requirements !== undefined) { plan.fill = !!a.fill_from_requirements; plan.save(); out.changed.push("fill from requirements: " + plan.fill); }
    emit("plan");
    out.plan = planApi.state();
    delete out.plan.unmetRequirements;
    return out;
  },
  async build_timetable() {
    if (app.tab !== "plan") location.hash = "#/plan";
    const r = await planApi.build();
    if (!r.ok) return { possible: false, reasons: r.reasons.map((x) => (x.type === "none" ? `${x.code}: no usable section (${x.why})` : x.type === "clash" ? `${x.a} and ${x.b} always overlap` : x.type === "over" ? `required courses alone exceed the credit ceiling (${x.have} > ${x.hi})` : "no combination fits")) };
    const s = planApi.state();
    return { possible: true, options_found: r.schedules.length, shown: "option 1", credits: r.schedules[0].credits, short_of_target: r.schedules[0].short || 0, free_weekdays: r.schedules[0].freeDays.map((d) => "MTWRF"[d]), timetable: s.timetable };
  },
};

/* ── Rendering ────────────────────────────────────────────────────────── */
function md(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const html = [];
  let list = false, tbl = null;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const flush = () => { if (list) { html.push("</ul>"); list = false; } if (tbl) { html.push(`<div class="tw"><table>${tbl.map((r, i) => `<tr>${r.map((c) => `<${i ? "td" : "th"}>${inline(c)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table></div>`); tbl = null; } };
  for (const ln of lines) {
    if (/^\s*\|.*\|\s*$/.test(ln)) { if (/^\s*\|[\s:|-]+\|\s*$/.test(ln)) continue; if (list) flush(); (tbl ||= []).push(ln.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())); continue; }
    if (tbl) flush();
    const li = ln.match(/^\s*[-*•]\s+(.*)$/) || ln.match(/^\s*\d+[.)]\s+(.*)$/);
    if (li) { if (!list) { html.push("<ul>"); list = true; } html.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) flush();
    if (ln.trim()) html.push(`<p>${inline(ln)}</p>`);
  }
  flush();
  return linkCourses(html.join(""));
}

let codeRe = null;
function linkCourses(html) {
  if (!codeRe) {
    const alt = [...app.designations].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
    codeRe = alt ? new RegExp(`\\b((?:${alt})(?:\\s*/\\s*(?:${alt}))*)\\s*(\\d{3})\\b`, "g") : null;
  }
  if (!codeRe) return html;
  return html.split(/(<[^>]+>)/).map((part, i, all) => {
    if (part.startsWith("<")) return part;
    return part.replace(codeRe, (m, subj, num) => `<a class="cc" href="#/c/${esc(toId(subj.split("/")[0] + " " + num))}">${m}</a>`);
  }).join("");
}

function render() {
  const log = $("#agLog");
  if (!log) return;
  const shown = msgs.filter((m) => (m.role === "user" || m.role === "assistant") && (m.content || "").trim());
  log.innerHTML = shown.length ? shown.map((m) => `<div class="msg ${m.role}">${m.role === "user" ? `<p>${esc(m.content)}</p>` : md(m.content)}</div>`).join("") : `<div class="ag-empty"><p>${esc(t("agentHello"))}</p>${t("agentSug").map((s) => `<button class="sug" data-sug="${esc(s)}">${esc(s)}</button>`).join("")}</div>`;
  if (busy) log.insertAdjacentHTML("beforeend", `<div class="msg status" role="status">${esc(status || t("agentBusy"))}</div>`);
  if (err) log.insertAdjacentHTML("beforeend", `<div class="msg err" role="alert">${esc(err)}</div>`);
  log.scrollTop = log.scrollHeight;
  $("#agSend").disabled = busy;
}

function context() {
  const view = cur ? `the course ${cur.code} (${cur.t})` : app.tab === "plan" ? "the Plan tab" : app.tab === "courses" ? "the course list" : `the ${app.tab} tab`;
  return { view, lang: LANG };
}

async function ask(text) {
  text = text.trim();
  if (!text || busy) return;
  err = ""; busy = true; status = t("agentBusy");
  msgs.push({ role: "user", content: text }); render();
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await api("/api/chat", null, { method: "POST", body: JSON.stringify({ messages: msgs.slice(-30), context: context() }) });
      const m = res.message;
      msgs.push(m);
      if (!m.tool_calls || !m.tool_calls.length) break;
      for (const call of m.tool_calls) {
        const name = call.function.name;
        status = t("tool_" + ({ search_courses: "search", get_course: "course", get_my_plan: "plan", update_plan: "add", build_timetable: "build" }[name] || "search")) + "…"; render();
        let result;
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          result = TOOL_IMPL[name] ? await TOOL_IMPL[name](args) : { error: "unknown tool" };
        } catch (e) { result = { error: String(e.message || e) }; }
        msgs.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 7000) });
      }
      if (step === MAX_STEPS - 1) msgs.push({ role: "assistant", content: "…" });
    }
  } catch (e) {
    err = e.status === 429 ? (e.body && e.body.error === "quota" ? t("agentLimit") : t("retry")) : t("agentErr");
    if (msgs[msgs.length - 1].role === "user") { /* keep the question so retry is one click */ }
  }
  busy = false; status = ""; render();
}

export function open(on_ = true) {
  const el = $("#agent");
  el.hidden = !on_;
  $("#askBtn").setAttribute("aria-expanded", on_);
  document.body.classList.toggle("agent-open", on_);
  if (on_) { build(); $("#agIn").focus(); }
}

function build() {
  const el = $("#agent");
  el.innerHTML = `<div class="ag-head"><h2 class="serif">${esc(t("agentTitle"))}</h2><span class="ag-tools"><button class="linkbtn" id="agNew">${esc(t("agentNew"))}</button><button class="icon-btn" id="agClose" aria-label="${esc(t("close"))}">✕</button></span></div>
    <div class="ag-log" id="agLog" aria-live="polite"></div>
    <form class="ag-form" id="agForm"><textarea id="agIn" rows="1" maxlength="1500" placeholder="${esc(t("agentPh"))}" aria-label="${esc(t("agentPh"))}"></textarea><button class="btn primary" id="agSend" type="submit">${esc(t("agentSend"))}</button></form>`;
  render();
}

export function init() {
  $("#askBtn").onclick = () => open($("#agent").hidden);
  $("#agent").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "agClose") { open(false); $("#askBtn").focus(); }
    else if (b.id === "agNew") { msgs = []; err = ""; render(); }
    else if (b.dataset.sug) ask(b.dataset.sug);
  });
  $("#agent").addEventListener("submit", (e) => { e.preventDefault(); const i = $("#agIn"); const v = i.value; i.value = ""; i.style.height = ""; ask(v); });
  $("#agent").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && e.target.id === "agIn") { e.preventDefault(); $("#agForm").requestSubmit(); }
    if (e.key === "Escape") { open(false); $("#askBtn").focus(); }
  });
  $("#agent").addEventListener("input", (e) => { if (e.target.id === "agIn") { e.target.style.height = "auto"; e.target.style.height = Math.min(140, e.target.scrollHeight) + "px"; } });
}
export const relocalize = () => { if (!$("#agent").hidden) build(); };

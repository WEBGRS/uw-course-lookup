// The Insights tab: aggregate charts over the featured courses.
import { $, esc, f2, fmt, api, app, rec, emit } from "./core.js";
import { t, LANG, termLabel, termYear } from "./i18n.js";
import { scatter, dotPlot, dumbbell, lineChart, trendTxt } from "./charts.js";
import { applyFilter } from "./courses.js";
import { setBand } from "./band.js";

let insLang = null, loading = false;

const rhoTxt = (r) => (r ? "ρ " + (r.rho > 0 ? "+" : "") + r.rho.toFixed(2) + ", p " + (r.p < 0.001 ? "< .001" : r.p.toFixed(3)) + ", n " + r.n : "–");
function rhoRead(r) {
  if (!r) return t("nodata");
  const a = Math.abs(r.rho);
  return (a < 0.1 ? t("none") : (a < 0.3 ? t("weak") : a < 0.5 ? t("moderate") : t("strong")) + (r.rho > 0 ? t("positive") : t("negative"))) + (r.p < 0.05 ? "" : t("ns"));
}
function courseTable(rows, cols) {
  return `<table><thead><tr>${cols.map((c) => `<th${c[2] ? ' class="r"' : ""}>${esc(c[0])}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((r) => `<tr data-c="${r.code.replace(/ /g, "-")}">${cols.map((c) => `<td${c[2] ? ' class="r"' : ""}>${c[1](r)}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
}
const panel = (title, lede, body, wide) => `<div class="panel${wide ? " wide" : ""}"><h2 class="serif">${esc(title)}</h2><p class="lede">${esc(lede)}</p>${body}</div>`;

export function invalidate() { insLang = null; }

export async function render() {
  const view = $("#v-insights");
  if (!app.insights.scatter) {
    if (loading) return;
    loading = true;
    try { app.insights = await api("/api/insights"); }
    catch { view.innerHTML = `<div class="empty">${esc(t("apiError"))} <button class="btn" id="insRetry">${esc(t("retry"))}</button></div>`; return; }
    finally { loading = false; }
  }
  if (insLang === LANG) return;
  insLang = LANG;
  const INS = app.insights, k = INS.counts || {}, cr = INS.correlations || {};
  let h = `<p class="lede" style="margin:0 0 12px">${esc(t("insNote", k.courses, fmt(app.meta.count)))}</p><div class="stats">` + [
    [k.courses, t("st_courses", k.from_chat, k.from_enrollment)], [fmt(k.graded_students), t("st_grades")],
    [fmt(k.instructors), t("st_instr")], [k.reddit_threads, t("st_reddit")],
    [k.offered_now, t("st_now", termLabel(app.term))], [k.rejected_seed_codes, t("st_rej")]].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${esc(l)}</span></div>`).join("") + `</div><div class="grid2">`;
  h += panel(t("p1"), t("p1l", rhoTxt(cr.mentions_vs_gpa)), scatter(), true);
  h += panel(t("p2"), t("p2l"), dumbbell((INS.instructor_spread || []).slice(0, 10)), true);
  h += panel(t("p3"), t("p3l"), `<table><thead><tr><th>${esc(t("thSignal"))}</th><th>${esc(t("thResult"))}</th><th>${esc(t("thReading"))}</th></tr></thead><tbody>` +
    [["c1", cr.mentions_vs_gpa], ["c2", cr.chat_sentiment_vs_gpa], ["c3", cr.reddit_tone_vs_gpa], ["c4", cr.chat_vs_reddit_volume], ["c5", cr.course_level_vs_gpa]]
      .map(([l, r]) => `<tr><td>${esc(t(l))}</td><td class="small">${rhoTxt(r)}</td><td class="small">${esc(rhoRead(r))}</td></tr>`).join("") + "</tbody></table>");
  h += panel(t("p4"), t("p4l"), dotPlot(INS.by_level || [], 2.8, 4.0));
  if ((INS.campus_trend || []).length > 4) {
    h += panel(t("p5"), t("p5l"), lineChart([{ name: "", color: "var(--series)", points: INS.campus_trend.map((x) => ({ x: termYear(x.term), y: x.gpa, label: `<b>${termLabel(x.term)}</b><br>GPA ${x.gpa.toFixed(3)} · ${fmt(x.graded)}` })) }], { w: 1080, h: 240, label: t("p5"), notes: [{ x: termYear(1204), text: t("pandemic") }] }), true);
  }
  const tcols = [[t("thCourse"), (r) => `<b>${esc(r.code)}</b> <span class="muted small">${esc(r.title)}</span>`], ["GPA", (r) => f2(r.gpa), 1], [t("thPerYr"), (r) => trendTxt(r.trend), 1]];
  h += panel(t("p6"), t("p6l"), courseTable(INS.rising || [], tcols));
  h += panel(t("p7"), t("p7l"), courseTable(INS.falling || [], tcols));
  h += panel(t("p8"), t("p8l"), courseTable(INS.popular_and_tough || [], [tcols[0], ["GPA", (r) => f2(r.gpa), 1], [t("rDF"), (r) => (r.pct_df * 100).toFixed(1) + "%", 1]]));
  h += panel(t("p9"), t("p9l"), courseTable(INS.quiet_high_gpa || [], [tcols[0], ["GPA", (r) => f2(r.gpa), 1], [t("thN"), (r) => fmt(r.graded), 1]]));
  h += panel(t("p10"), t("p10l"), `<table><thead><tr><th>${esc(t("thSubj"))}</th><th class="r">${esc(t("thCourses"))}</th><th class="r">${esc(t("thMent"))}</th><th class="r">GPA</th></tr></thead><tbody>` +
    (INS.by_subject || []).map((s) => `<tr data-subj="${esc(s.subject)}"><td><b>${esc(s.subject)}</b></td><td class="r">${s.courses}</td><td class="r">${s.mentions ?? "<3"}</td><td class="r">${f2(s.gpa)}</td></tr>`).join("") + "</tbody></table>", true);
  view.innerHTML = h + "</div>";
}

export function init() {
  const v = $("#v-insights");
  v.addEventListener("click", (e) => {
    if (e.target.closest("#insRetry")) { render(); return; }
    const c = e.target.closest("[data-c]"); if (c) { emit("open", c.dataset.c); return; }
    const s = e.target.closest("[data-subj]"); if (s) { location.hash = "#/courses"; applyFilter({ subj: s.dataset.subj }); }
  });
  v.addEventListener("pointerover", (e) => { if (e.pointerType !== "mouse") return; const g = e.target.closest("[data-c]"); if (g && rec(g.dataset.c)) setBand(rec(g.dataset.c)); });
  v.addEventListener("pointerleave", () => setBand(app.openCourse || null));
  matchMedia("(max-width:640px)").addEventListener("change", () => { invalidate(); if (app.tab === "insights") render(); });
}

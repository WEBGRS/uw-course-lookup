// Entry point: boot the app, route between tabs, wire theme and language.
import { $, $$, esc, api, app, store, on, emit, loadRows, plan } from "./core.js";
import { t, LANG, setLang } from "./i18n.js";
import * as courses from "./courses.js";
import * as drawer from "./drawer.js";
import * as insights from "./insights.js";
import * as planner from "./planner/view.js";
import * as planbar from "./planbar.js";
import * as agent from "./agent.js";
import { initBand, setBand, resetBand } from "./band.js";

const TABS = ["courses", "plan", "insights", "about"];

/* ── Theme ───────────────────────────────────────────────── */
(function theme() {
  const th = store.get("theme", null);
  if (th) document.documentElement.dataset.theme = th;
  $("#themeBtn").onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const nx = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nx; store.set("theme", nx);
  };
})();

/* ── Language ────────────────────────────────────────────── */
function applyLang() {
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
  $$("[data-t]").forEach((el) => (el.innerHTML = esc(t(el.dataset.t))));
  $$("[data-tp]").forEach((el) => (el.placeholder = t(el.dataset.tp)));
  $$("[data-tt]").forEach((el) => { el.title = t(el.dataset.tt); el.setAttribute("aria-label", t(el.dataset.tt)); });
  $$("[data-lang]").forEach((el) => (el.hidden = el.dataset.lang !== LANG));
  $("#langBtn").textContent = t("langBtn");
  $("#foot").innerHTML = `<p>${esc(t("foot"))} <a href="#/about">${esc(t("tabAbout"))}</a> · <a href="https://github.com/WEBGRS/uw-course-lookup" target="_blank" rel="noopener">${esc(t("src"))}</a></p>`;
  courses.localize();
  resetBand();
  agent.relocalize();
  planbar.render();
  insights.invalidate();
  if (app.tab === "insights") insights.render();
  if (drawer.cur) drawer.openDrawer(drawer.cur.id, true);
}
$("#langBtn").onclick = () => setLang(LANG === "zh" ? "en" : "zh");
on("lang", applyLang);

/* ── Router ──────────────────────────────────────────────── */
function show(tab) {
  const prev = app.tab; app.tab = tab;
  if (prev !== tab) scrollTo(0, 0);
  for (const x of TABS) $("#v-" + x).hidden = x !== tab;
  $("#band").hidden = tab === "plan";   // the grade strip says nothing useful while building a timetable
  $$("nav.tabs a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (tab === "insights") insights.render();
  emit("tab", tab);
}
function route() {
  const h = location.hash || "#/courses";
  const m = h.match(/^#\/c\/(.+)$/);
  if (m) { drawer.openDrawer(decodeURIComponent(m[1])); return; }
  if (drawer.isOpen()) drawer.hideDrawer();
  show((h.match(/^#\/(courses|plan|insights|about)/) || [, "courses"])[1]);
}
addEventListener("hashchange", route);
on("route", route);
on("open", (id) => drawer.openCourse(id));
on("not-found", (id) => {
  $("#q").value = id.replace(/-/g, " ");
  history.replaceState(null, "", location.pathname + location.search + "#/courses");
  show("courses"); courses.refresh();
});

/* ── Boot ────────────────────────────────────────────────── */
async function boot() {
  try { app.meta = await api("/api/meta"); }
  catch {
    $("#list").innerHTML = `<div class="empty">${esc(t("apiError"))} <button class="btn" id="retry">${esc(t("retry"))}</button></div>`;
    $("#retry").onclick = boot; return;
  }
  const m = app.meta;
  app.term = +m.term; app.campusDist = m.campusDist; app.campusTotal = m.campusDist.reduce((a, b) => a + b, 0);
  app.first = m.first; app.campusGpa = m.campusGpa; app.designations = m.designations || []; app.insights = { campus_gpa: m.campusGpa };
  initBand(); setBand(null);
  courses.init(); drawer.init(); insights.init(); planbar.init(); agent.init();
  await planner.init();
  applyLang();
  route();
  loadRows([...plan.must].slice(0, 60)).then(planbar.render).catch(() => {});   // saved courses may be off the first page
  await courses.start();
}
boot();

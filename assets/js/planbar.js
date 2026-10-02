// The saved-courses bar at the bottom: totals, plus the way into the Plan tab.
import { $, esc, app, plan, rec, on } from "./core.js";
import { t, brName } from "./i18n.js";
import { openCompare } from "./compare.js";

const crMin = (c) => parseFloat(c.cr) || 0;

export function render() {
  const L = [...plan.must].map(rec).filter(Boolean), bar = $("#plan");
  bar.hidden = !L.length || app.tab === "plan";
  document.body.classList.toggle("has-plan", !bar.hidden);
  if (!L.length) return;
  const cr = L.reduce((a, c) => a + crMin(c), 0);
  const gw = L.filter((c) => c.gpa != null && crMin(c));
  const gpa = gw.length ? gw.reduce((a, c) => a + c.gpa * crMin(c), 0) / gw.reduce((a, c) => a + crMin(c), 0) : null;
  const br = [...new Set(L.flatMap((c) => c.br))].map(brName);
  bar.innerHTML = `<div class="facts"><span>${t("planSaved", L.length)}</span><span>${t("planCr", cr % 1 ? cr.toFixed(1) : cr)}</span>${gpa != null ? `<span class="gp">${t("planGpa", gpa.toFixed(2))}</span>` : ""}${br.length ? `<span class="br">${esc(t("planBr", br.join(", ")))}</span>` : ""}</div>
    <div class="acts"><button class="btn" id="pShow">${esc(t("showSaved"))}</button><button class="btn" id="pCmp"${L.length < 2 ? " disabled" : ""}>${esc(t("compare"))}</button><button class="btn primary" id="pPlan">${esc(t("tabPlan"))}</button><button class="btn" id="pClear">${esc(t("clearSaved"))}</button></div>`;
  $("#pShow").onclick = () => { $("#fSaved").checked = !$("#fSaved").checked; location.hash = "#/courses"; $("#fSaved").dispatchEvent(new Event("change")); };
  $("#pCmp").onclick = () => openCompare([...plan.must]);
  $("#pPlan").onclick = () => { location.hash = "#/plan"; };
  $("#pClear").onclick = () => { plan.must.clear(); plan.save(); $("#fSaved").checked = false; $("#fSaved").dispatchEvent(new Event("change")); import("./core.js").then((m) => m.emit("plan")); };
}

export function init() {
  on("plan", render);
  on("list", render);
  on("tab", render);
}

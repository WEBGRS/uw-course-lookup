// Course detail drawer: grades, instructors, this term's sections with times, what students say.
import { $, $$, esc, f2, pct, fmt, app, plan, DET, loadDetail, mgUrl, enrollUrl, guideUrl, rmpUrl, redditUrl, sameName, hideTip, on, emit } from "./core.js";
import { t, termLabel, termShort, termYear, brName, lvlName } from "./i18n.js";
import { distChart, lineChart, instrChart, trendTxt } from "./charts.js";
import { nowTxt, listState } from "./courses.js";
import { setBand } from "./band.js";
import { loadPlanData, planOf } from "./planner/data.js";
import { fmtRange, daysText, DAY_LETTERS } from "./planner/schedule.js";

export let cur = null;
let lastFocus = null, lastFocusId = null, showAllIns = false, seq = 0;

const courseUrl = (id) => location.pathname + location.search + "#/c/" + id;
export const openCourse = (id) => { history.pushState({ drawer: 1 }, "", courseUrl(id)); emit("route"); };
export function stepCourse(d) {
  const L = listState.rows, i = cur ? L.findIndex((r) => r.id === cur.id) : -1;
  if (i < 0) return;
  history.replaceState(history.state, "", courseUrl(L[(i + d + L.length) % L.length].id)); emit("route");
}
export const isOpen = () => $("#drawer").classList.contains("on");

function setModal(on_) {
  $$("body > header, body > .band, body > main, body > footer, body > .plan, body > .agent").forEach((e) => (e.inert = on_));
  $("#drawer").inert = !on_;
  document.body.classList.toggle("modal", on_);
}

/** This term's sections: one row per lecture with its time, room, instructor and seats. */
function sectionsTable(pk) {
  if (!pk || !pk.length) return "";
  const groups = new Map();
  for (const p of pk) {
    const lead = p.s.find((s) => s.t === "LEC" || s.t === "SEM") || p.s[0];
    if (!lead) continue;
    const g = groups.get(lead.t + lead.n) || { lead, pkgs: [] };
    g.pkgs.push(p); groups.set(lead.t + lead.n, g);
  }
  const rows = [...groups.values()].slice(0, 10).map(({ lead, pkgs }) => {
    const open = pkgs.some((p) => p.st === "O"), wait = pkgs.some((p) => p.st === "W");
    const cls = open ? "open" : wait ? "wait" : "closed", lbl = open ? t("open") : wait ? t("wait") : t("full");
    const when = lead.m.length ? lead.m.map((m) => `${daysText([...m[0]].map((ch) => DAY_LETTERS.indexOf(ch)))} ${fmtRange(m[1], m[2])}`).join(", ") : t("online");
    return `<tr><td><b>${esc(lead.t)} ${esc(lead.n)}</b></td><td>${esc(when)}${lead.m[0] && lead.m[0][3] ? `<div class="muted small">${esc(lead.m[0][3])}</div>` : ""}</td><td>${esc((lead.i || []).join(", "))}</td><td><span class="status"><span class="dot ${cls}"></span>${esc(lbl)}</span></td></tr>`;
  });
  return `<div class="tw"><table class="itable"><tbody>${rows.join("")}</tbody></table></div>`;
}

function openDrawerError(id) {
  const dr = $("#drawer"); cur = null;
  dr.innerHTML = `<div class="d-head"><div class="d-nav"><button class="icon-btn" id="dClose" aria-label="${esc(t("close"))}">✕</button></div><h2 class="d-title serif" id="dTitle">${esc(t("apiError"))}</h2></div><div class="d-body"><p><button class="btn" id="dRetry">${esc(t("retry"))}</button></p></div>`;
  dr.setAttribute("aria-label", t("apiError")); setModal(true); dr.classList.add("on"); $("#scrim").classList.add("on");
  $("#dClose").onclick = closeDrawer; $("#dRetry").onclick = () => openDrawer(id); $("#dClose").focus();
}

export async function openDrawer(id, keepScroll) {
  const my = ++seq;
  let c = DET[id];
  if (!c) {
    try { c = await loadDetail(id); }
    catch (e) {
      if (my !== seq) return;
      if (e.status === 404) { emit("not-found", id); return; }
      openDrawerError(id); return;
    }
    if (my !== seq) return;
  }
  const dr = $("#drawer"), wasOpen = isOpen(), fid = dr.contains(document.activeElement) ? document.activeElement.id : "";
  if (!wasOpen) { lastFocus = document.activeElement; const fr = lastFocus && lastFocus.closest && lastFocus.closest(".row[data-id]"); lastFocusId = fr ? fr.dataset.id : null; }
  if (cur !== c) showAllIns = false;
  cur = c; app.openCourse = c;
  const top = keepScroll ? dr.scrollTop : 0, L = listState.rows, idx = L.findIndex((r) => r.id === c.id), pos = idx + 1;
  const saved = plan.must.has(c.id);
  const chips = [c.cr && t("credits", c.cr), lvlName(c.lvl), ...c.br.map(brName), c.ge, c.es && brName("Ethnic Studies"), c.typ && c.typ !== "Not Applicable" && t("usually", c.typ)].filter(Boolean);
  let h = `<div class="d-head">
    <div class="d-nav">${idx >= 0 ? `<button class="icon-btn" id="dPrev" aria-label="${esc(t("prev"))}" title="${esc(t("prev"))} (←)">‹</button><span class="pos">${pos} / ${fmt(listState.total)}</span><button class="icon-btn" id="dNext" aria-label="${esc(t("next"))}" title="${esc(t("next"))} (→)">›</button>` : ""}<button class="icon-btn" id="dClose" aria-label="${esc(t("close"))}">✕</button></div>
    <div class="d-code">${esc(c.code)}${c.al.length ? " · " + esc(t("alsoAs")) + " " + esc(c.al.join(", ")) : ""} · ${esc(c.sn)}</div>
    <h2 class="d-title serif" id="dTitle">${esc(c.t)}</h2>
    <div class="chips">${chips.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div></div><div class="d-body">`;
  h += `<div class="d-sec"><div class="linkrow">
    <button class="btn${saved ? " primary" : ""}" id="dSave" aria-pressed="${saved}">${esc(saved ? t("saved") : t("save"))}</button>
    <a class="btn" target="_blank" rel="noopener" href="${mgUrl(c)}">${esc(t("mg"))}</a>
    <a class="btn" target="_blank" rel="noopener" href="${enrollUrl(c.code)}">${esc(t("cse"))}</a>
    <a class="btn" target="_blank" rel="noopener" href="${guideUrl(c.code)}">${esc(t("guide"))}</a>
    <a class="btn" target="_blank" rel="noopener" href="${redditUrl(c)}">${esc(t("searchReddit"))}</a>
    <button class="btn" id="dShare">${esc(t("copy"))}</button></div></div>`;
  if (c.dist) h += `<div class="d-sec"><div class="kpis">
    <div class="kpi"><b>${f2(c.gpa)}</b><span>${esc(t("kGpa"))}</span></div><div class="kpi"><b>${f2(c.gr)}</b><span>${esc(t("kRecent"))}</span></div>
    <div class="kpi"><b>${pct(c.pa)}</b><span>${esc(t("kA"))}</span></div><div class="kpi"><b>${c.pdf == null ? "–" : (c.pdf * 100).toFixed(1) + "%"}</b><span>${esc(t("kDF"))}</span></div>
    <div class="kpi"><b>${c.now && c.en ? fmt(c.en) : "–"}</b><span>${esc(t("kNow", termShort(app.term)))}</span></div></div></div>`;
  if (c.d || c.prq) h += `<div class="d-sec">${c.d ? `<p class="desc">${esc(c.d)}</p>` : ""}${c.prq ? `<p class="prq"><b>${esc(t("req"))}</b> ${esc(c.prq)}</p>` : ""}</div>`;
  h += `<div class="d-sec"><h3>${esc(termLabel(app.term))}${c.now ? ` <span class="muted">${esc(t("snapshot", app.meta.built_at.slice(0, 10)))}</span>` : ""}</h3>`;
  if (c.now) {
    h += `<p style="margin:0 0 6px">${nowTxt(c, true)} &nbsp;${esc(t("nowLine", c.en, c.now.lec, c.now.open, c.now.pk, c.now.wait))}</p>`;
    h += `<div id="dSections"></div>`;
    if (c.now.who.length) h += `<p class="small" style="margin:8px 0 0;color:var(--ink-2)">${esc(t("teaching"))}` + c.now.who.map((n) => {
      const m = c.ins.find((i) => i[5] && sameName(i[0], n));
      return esc(n) + ` <span class="muted">${esc(m ? t("pastHere", f2(m[1])) : t("noHist"))}</span>`;
    }).join(", ") + "</p>";
  } else h += `<p class="muted" style="margin:0">${esc(t("notOffered", c.last ? termLabel(c.last) : ""))}</p>`;
  h += "</div>";
  if (c.dist) {
    h += `<div class="d-sec"><h3>${esc(t("grades"))} <span class="muted">${esc(t("studentsRange", c.n, termLabel(c.terms[0][0]), termLabel(c.terms[c.terms.length - 1][0])))}</span></h3>${distChart(c)}`;
    const pts = c.terms.filter((x) => x[2] >= 10 && x[0] % 10 !== 6).map((x) => ({ x: termYear(x[0]), y: x[1], label: `<b>${termLabel(x[0])}</b><br>GPA ${x[1].toFixed(2)} · ${fmt(x[2])}` }));
    if (pts.length >= 3) {
      h += `<h3 style="margin-top:16px">${esc(t("byTerm"))} ${c.tr != null ? `<span class="muted">${trendTxt(c.tr)} ${esc(t("since2016"))}</span>` : ""}</h3>`;
      h += lineChart([{ name: c.code, color: "var(--series)", points: pts }], { label: c.code, ref: app.campusGpa, refLabel: t("trackedAvg", f2(app.campusGpa)) });
    }
    h += "</div>";
  } else h += `<div class="d-sec"><h3>${esc(t("grades"))}</h3><p class="muted">${esc(t("noGrades"))}</p></div>`;
  if (c.ins.length) {
    const mxN = Math.max(...c.ins.map((i) => i[2])), LIM = 8, rows = showAllIns ? c.ins : c.ins.slice(0, LIM);
    h += `<div class="d-sec"><h3>${esc(t("instructors"))} <span class="muted">${c.sp != null ? esc(t("spread", c.sp.toFixed(2))) : ""}</span></h3>${instrChart(c)}`;
    h += `<table class="itable"><thead><tr><th>${esc(t("thName"))}</th><th class="r">${esc(t("thGpa"))}</th><th class="r">${esc(t("thA"))}</th><th>${esc(t("thN"))}</th><th class="r">${esc(t("thLast"))}</th><th><span class="sr">${esc(t("thLinks"))}</span></th></tr></thead><tbody>` +
      rows.map((i) => `<tr><td>${esc(i[0])}${i[5] ? `<span class="badge">${termShort(app.term)}</span>` : ""}</td><td class="r"><b>${f2(i[1])}</b></td><td class="r">${pct(i[3])}</td><td><div class="bar" data-tip="${fmt(i[2])}"><i style="width:${(i[2] / mxN) * 100}%"></i></div></td><td class="r small muted">${termShort(i[4])}</td><td class="small"><a target="_blank" rel="noopener" href="${rmpUrl(i[0])}">RMP</a></td></tr>`).join("") + "</tbody></table>";
    if (c.ins.length > LIM) h += `<p style="margin:8px 0 0"><button class="linkbtn" id="dAllIns">${esc(showAllIns ? t("showFewer") : t("showAll", c.ins.length))}</button></p>`;
    if (c.ins.some((i) => i[2] < 30)) h += `<p class="small muted" style="margin:8px 0 0">${esc(t("thin"))}</p>`;
    h += "</div>";
  }
  const tone = c.rdt == null ? "" : c.rdt > 0.15 ? t("tonePos") : c.rdt < -0.15 ? t("toneNeg") : t("toneMix");
  h += c.src === "catalog" ? `<div class="d-sec"><h3>${esc(t("say"))}</h3><p class="small" style="margin:0;color:var(--ink-2)">${esc(t("sayCatalog"))}</p></div>`
    : `<div class="d-sec"><h3>${esc(t("say"))}</h3><p class="small" style="margin:0 0 10px;color:var(--ink-2)">${c.src === "enrollment" ? esc(t("sayEnroll")) : c.ms ? esc(t("sayChatFew")) : t("sayChat", c.m, c.pos, c.neg)}${t("sayReddit", c.rdn, tone)}</p>`;
  if (c.src === "catalog") h += "</div>";
  else {
    if (c.rd.length) h += `<ul class="threads">` + c.rd.map((x) => `<li><a target="_blank" rel="noopener" href="${esc(x[1])}">${esc(x[0])}</a><span class="tone ${x[3] > 0 ? "up" : x[3] < 0 ? "down" : "muted"}">${x[3] > 0 ? "+ " : x[3] < 0 ? "− " : ""}${x[2] || ""}</span></li>`).join("") + "</ul>";
    h += "</div></div>";
  }
  dr.innerHTML = h; dr.scrollTop = top;
  $("#dClose").onclick = closeDrawer;
  if ($("#dPrev")) { $("#dPrev").onclick = () => stepCourse(-1); $("#dNext").onclick = () => stepCourse(1); }
  $("#dSave").onclick = () => plan.toggle(c.id);
  if ($("#dAllIns")) $("#dAllIns").onclick = () => { showAllIns = !showAllIns; openDrawer(c.id, true); };
  $("#dShare").onclick = () => { const u = location.origin + location.pathname + "#/c/" + c.id; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => ($("#dShare").textContent = t("copied")), () => prompt(t("copy"), u)); };
  dr.setAttribute("aria-label", c.code + " " + c.t);
  setModal(true); dr.classList.add("on"); $("#scrim").classList.add("on");
  if (!wasOpen) $("#dClose").focus(); else if (fid && document.getElementById(fid)) document.getElementById(fid).focus();
  setBand(c);
  document.title = c.code + " · UW Course Lookup";
  if (idx >= 0) [L[idx + 1], L[idx - 1]].filter(Boolean).forEach((r) => loadDetail(r.id).catch(() => {}));
  if (c.now) {
    loadPlanData([c.id]).then(() => {
      const el = $("#dSections"), p = planOf(c.id);
      if (el && cur === c && p) el.innerHTML = sectionsTable(p.pk);
    }).catch(() => {});
  }
}

export function hideDrawer() {
  $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); setModal(false); cur = null; app.openCourse = null; hideTip(); setBand(null);
  document.title = "UW Course Lookup";
  const r = lastFocusId && $(`#list .row[data-id="${CSS.escape(lastFocusId)}"]`);
  if (r) r.focus(); else if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
export function closeDrawer() {
  if (history.state && history.state.drawer) { history.back(); return; }
  if (location.hash.startsWith("#/c/")) history.replaceState(null, "", location.pathname + location.search + "#/" + (app.tab || "courses"));
  hideDrawer();
}

export function init() {
  $("#scrim").onclick = closeDrawer;
  on("plan", () => { if (cur && isOpen()) openDrawer(cur.id, true); });
  document.addEventListener("keydown", (e) => {
    if (!isOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === "Escape") closeDrawer();
    else if (!typing && (e.key === "ArrowRight" || e.key === "ArrowLeft")) stepCourse(e.key === "ArrowRight" ? 1 : -1);
  });
}

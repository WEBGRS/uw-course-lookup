// Side-by-side comparison of up to eight saved courses (dialog).
import { $, esc, f2, pct, fmt, api, app, DET, fill, rec } from "./core.js";
import { t, termLabel, termYear, brName } from "./i18n.js";
import { lineChart, miniDist, trendTxt } from "./charts.js";
import { nowTxt } from "./courses.js";

const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];

export async function openCompare(ids) {
  ids = ids.filter((id) => rec(id)).slice(0, 8);
  if (ids.length < 2) return;
  const need = ids.filter((id) => !DET[id]);
  if (need.length) {
    try { (await api("/api/compare", { ids: need.join(",") })).courses.forEach((c) => { DET[c.id] = fill(c); }); }
    catch { return; }
  }
  const L = ids.map((id) => DET[id]).filter(Boolean);
  if (L.length < 2) return;
  const inChart = L.slice(0, 4);
  const series = inChart.map((c, i) => ({ name: c.code, color: SERIES[i], points: c.terms.filter((x) => x[2] >= 10 && x[0] % 10 !== 6 && termYear(x[0]) >= 2012).map((x) => ({ x: termYear(x[0]), y: x[1], label: `<b>${esc(c.code)}</b> · ${termLabel(x[0])}<br>GPA ${x[1].toFixed(2)} · ${fmt(x[2])}` })) })).filter((s) => s.points.length >= 2);
  const rows = [
    [t("rTitle"), (c) => esc(c.t)], [t("rCr"), (c) => esc(c.cr || "–")], [t("rGpa"), (c) => `<b>${f2(c.gpa)}</b> <span class="muted small">${esc(t("rRecent"))} ${f2(c.gr)}</span>`],
    [t("rA"), (c) => pct(c.pa)], [t("rDF"), (c) => (c.pdf == null ? "–" : (c.pdf * 100).toFixed(1) + "%")],
    [t("rTr"), (c) => trendTxt(c.tr) || "–"], [t("rSp"), (c) => (c.sp == null ? "–" : c.sp.toFixed(2))],
    [termLabel(app.term), (c) => nowTxt(c) + (c.now && c.now.who.length ? `<div class="small muted">${esc(c.now.who.slice(0, 4).join(", "))}</div>` : "")],
    [t("rBr"), (c) => esc(c.br.map(brName).join(", ") || "–")],
  ];
  const dot = (c) => { const i = inChart.indexOf(c); return i >= 0 ? `<span class="swatch" style="background:${SERIES[i]}"></span>` : ""; };
  $("#cmp").innerHTML = `<div class="cmp"><div class="cmp-head"><h2 class="serif">${esc(t("cmpTitle"))}</h2><button class="icon-btn" id="cmpClose" aria-label="${esc(t("close"))}">✕</button></div>
    <div class="minis">${L.map((c) => `<div class="mini"><div class="h"><b>${dot(c)}${esc(c.code)}</b><span class="small muted">GPA ${f2(c.gpa)}</span></div>${miniDist(c)}</div>`).join("")}</div>
    ${series.length ? `<h3 style="font-size:14px;margin:6px 0">${esc(t("cmpTrend"))}</h3>` + lineChart(series, { w: 980, h: 220, label: t("cmpTrend"), endLabels: true }) +
      `<div class="legend">${series.map((s) => `<span><i style="background:${s.color};border-radius:50%"></i>${esc(s.name)}</span>`).join("")}</div>` + (L.length > 4 ? `<p class="small muted">${esc(t("cmpCap", 4))}</p>` : "") : ""}
    <div class="tw"><table><thead><tr><th></th>${L.map((c) => `<th>${dot(c)}<a href="#/c/${c.id}" data-close>${esc(c.code)}</a></th>`).join("")}</tr></thead><tbody>
    ${rows.map(([l, f]) => `<tr><th>${esc(l)}</th>${L.map((c) => `<td>${f(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  $("#cmp").showModal();
  $("#cmpClose").onclick = () => $("#cmp").close();
  $("#cmp").querySelectorAll("[data-close]").forEach((a) => (a.onclick = () => $("#cmp").close()));
}

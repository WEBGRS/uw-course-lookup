// Hand-drawn SVG charts. Each returns an HTML string; hover text comes from data-tip (see core.js).
import { app, esc, f2, pct, fmt, MOB, G, GV, lastName } from "./core.js";
import { t, LANG, termShort } from "./i18n.js";

/** Thin A–F strip used in list rows. */
export function strip(dist, h = 10) {
  if (!dist) return `<div class="strip" style="height:${h}px"></div>`;
  const tot = dist.reduce((a, b) => a + b, 0) || 1;
  const tip = G.map((g, i) => `${g} ${((dist[i] / tot) * 100).toFixed(1)}%`).join(" · ");
  return `<div class="strip" style="height:${h}px" data-tip="${esc(tip)}">` +
    dist.map((v, i) => (v ? `<i style="width:${(v / tot) * 100}%;background:var(${GV[i]})"></i>` : "")).join("") + "</div>";
}

export function trendTxt(v) {
  if (v == null) return "";
  const cls = v > 0.01 ? "up" : v < -0.01 ? "down" : "muted";
  return `<span class="${cls} small">${v > 0 ? "+" : ""}${v.toFixed(2)}${LANG === "zh" ? "/年" : "/yr"}</span>`;
}

export function spark(ys) {
  if (!ys || ys.length < 3) return '<span class="muted small">–</span>';
  const lo = Math.min(...ys) - 0.05, hi = Math.max(...ys) + 0.05, W = 60, H = 18;
  const pts = ys.map((y, i) => ((i / (ys.length - 1)) * W).toFixed(1) + "," + (H - ((y - lo) / (hi - lo)) * H).toFixed(1)).join(" ");
  return `<svg width="${W}" height="${H}" aria-hidden="true" style="overflow:visible"><polyline points="${pts}" fill="none" stroke="var(--series)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

export function distChart(c) {
  const d = c.dist, tot = d.reduce((a, b) => a + b, 0);
  const W = MOB() ? 380 : 580, H = 170, L = 8, R = 8, T = 18, B = 24, bw = (W - L - R) / 7;
  const CD = app.campusDist, CT = app.campusTotal;
  const mx = Math.max(...d.map((v) => v / tot), ...CD.map((v) => v / CT));
  const y = (v) => T + (H - T - B) * (1 - v / mx);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(c.code)} grade distribution"><line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  d.forEach((v, i) => {
    const p = v / tot, cp = CD[i] / CT, x = L + i * bw + 5, w = bw - 10, top = y(p), h = Math.max(H - B - top, 0);
    s += `<g data-tip="<b>${G[i]}</b>: ${(p * 100).toFixed(1)}% (${fmt(v)})<br>${esc(t("allTracked", app.meta.count))}: ${(cp * 100).toFixed(1)}%">
      <rect x="${x - 4}" y="${T}" width="${w + 8}" height="${H - B - T}" fill="transparent"/>
      <path d="M${x},${H - B}V${top + Math.min(4, h)}q0,-4 4,-4h${w - 8}q4,0 4,4V${H - B}Z" fill="var(${GV[i]})"/>
      <line x1="${x - 3}" x2="${x + w + 3}" y1="${y(cp)}" y2="${y(cp)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 2" opacity=".55"/>
      <text x="${x + w / 2}" y="${top - 5}" text-anchor="middle" class="lbl">${Math.round(p * 100)}%</text>
      <text x="${x + w / 2}" y="${H - 7}" text-anchor="middle">${G[i]}</text></g>`;
  });
  return s + `</svg><div class="legend"><span><i style="background:var(--gA)"></i>${esc(t("thisCourse"))}</span><span><i class="dash"></i>${esc(t("allTracked", app.meta.count))}</span></div>`;
}

export function miniDist(c) {
  const W = 220, H = 78, T = 12, B = 16, bw = W / 7;
  if (!c.dist) return `<p class="muted">${esc(t("noGrades"))}</p>`;
  const tot = c.dist.reduce((a, b) => a + b, 0), mx = Math.max(...c.dist) / tot;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(c.code)}">`;
  c.dist.forEach((v, i) => {
    const p = v / tot, h = ((H - T - B) * p) / mx, x = i * bw + 3;
    s += `<g data-tip="<b>${G[i]}</b> ${(p * 100).toFixed(1)}%"><rect x="${x}" y="${H - B - h}" width="${bw - 6}" height="${Math.max(h, 0.5)}" rx="2" fill="var(${GV[i]})"/><text x="${x + (bw - 6) / 2}" y="${H - 3}" text-anchor="middle">${G[i]}</text>${p === mx ? `<text class="lbl" x="${x + (bw - 6) / 2}" y="${H - B - h - 3}" text-anchor="middle">${Math.round(p * 100)}%</text>` : ""}</g>`;
  });
  return s + "</svg>";
}

/** series: [{name, color, points:[{x,y,label}]}] */
export function lineChart(series, opt) {
  const W = MOB() ? 380 : opt.w || 580, H = opt.h || 180, L = 36, R = opt.endLabels ? 90 : 12, T = 12, B = 26;
  const all = series.flatMap((s) => s.points), xs = all.map((p) => p.x), ys = all.map((p) => p.y).concat(opt.ref != null ? [opt.ref] : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.floor((Math.min(...ys) - 0.05) * 10) / 10, y1 = Math.ceil((Math.max(...ys) + 0.05) * 10) / 10;
  if (y1 - y0 < 0.4) { const m = (y0 + y1) / 2; y0 = m - 0.2; y1 = m + 0.2; }
  const X = (v) => L + (W - L - R) * (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)), Y = (v) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opt.label)}">`;
  const step = y1 - y0 > 1 ? 0.5 : y1 - y0 > 0.5 ? 0.2 : 0.1;
  for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`;
  for (let yr = Math.ceil(x0); yr <= x1; yr += x1 - x0 > 10 ? 4 : x1 - x0 > 5 ? 2 : 1) s += `<text x="${X(yr)}" y="${H - 8}" text-anchor="middle">${yr}</text>`;
  if (opt.ref != null) s += `<line x1="${L}" x2="${W - R}" y1="${Y(opt.ref)}" y2="${Y(opt.ref)}" stroke="var(--ref)" stroke-dasharray="4 3"/><text x="${W - R}" y="${Y(opt.ref) - 5}" text-anchor="end">${esc(opt.refLabel)}</text>`;
  series.forEach((se) => {
    s += `<polyline points="${se.points.map((p) => X(p.x).toFixed(1) + "," + Y(p.y).toFixed(1)).join(" ")}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round"/>`;
    se.points.forEach((p) => { s += `<g data-tip="${esc(p.label)}"><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="9" fill="transparent"/><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.5" fill="${se.color}" stroke="var(--surface)" stroke-width="1.5"/></g>`; });
  });
  if (opt.endLabels) {
    const ends = series.filter((se) => se.points.length).map((se) => { const p = se.points[se.points.length - 1]; return { name: se.name, x: X(p.x), y: Y(p.y) }; }).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
    const over = ends.length ? ends[ends.length - 1].y - (H - B) : 0;
    if (over > 0) ends.forEach((e) => (e.y -= over));
    ends.forEach((e) => { s += `<text class="lbl" x="${e.x + 8}" y="${e.y + 4}">${esc(e.name)}</text>`; });
  }
  (opt.notes || []).forEach((n) => {
    const p = series[0].points.find((q) => Math.abs(q.x - n.x) < 0.01);
    if (!p) return;
    const flip = X(p.x) + 8 + n.text.length * 6.5 > W - 8;
    s += `<text class="lbl" x="${X(p.x) + (flip ? -8 : 8)}" y="${Y(p.y) + 4}"${flip ? ' text-anchor="end"' : ""}>${esc(n.text)}</text>`;
  });
  return s + "</svg>";
}

export function instrChart(c) {
  const pts = c.ins.filter((i) => i[1] != null && i[2] >= 10);
  if (pts.length < 2) return "";
  const W = MOB() ? 380 : 580, H = 178, L = 12, R = 12, T = 26, B = 24, lanes = 5;
  const lo = Math.min(2.5, Math.floor(Math.min(...pts.map((i) => i[1])) * 2) / 2), hi = 4.0;
  const X = (v) => L + ((W - L - R) * (v - lo)) / (hi - lo), maxN = Math.max(...pts.map((i) => i[2]));
  const rOf = (n) => 3 + 8 * Math.sqrt(n / maxN);
  const laneEnd = Array(lanes).fill(-1e9), placed = [];
  pts.slice().sort((a, b) => a[1] - b[1]).forEach((i) => {
    const x = X(i[1]), r = rOf(i[2]);
    let lane = laneEnd.findIndex((e) => x - r > e + 2);
    if (lane < 0) lane = laneEnd.indexOf(Math.min(...laneEnd));
    laneEnd[lane] = x + r;
    placed.push({ i, x, r, y: T + 6 + ((H - T - B - 12) * (lane + 0.5)) / lanes });
  });
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(c.code)} instructor GPA">`;
  for (let v = Math.ceil(lo * 2) / 2; v <= hi + 1e-9; v += 0.5) s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${T - 6}" y2="${H - B}"/><text x="${X(v)}" y="${H - 8}" text-anchor="middle">${v.toFixed(1)}</text>`;
  if (c.gpa != null) s += `<line x1="${X(c.gpa)}" x2="${X(c.gpa)}" y1="${T - 8}" y2="${H - B}" stroke="var(--ink)" stroke-dasharray="3 3" opacity=".6"/><text x="${X(c.gpa)}" y="${T - 9}" text-anchor="middle" class="lbl">${f2(c.gpa)}</text>`;
  placed.sort((a, b) => b.r - a.r).forEach(({ i, x, r, y }) => {
    s += `<g data-tip="<b>${esc(i[0])}</b><br>GPA ${f2(i[1])} · A ${pct(i[3])} · ${fmt(i[2])} ${LANG === "zh" ? "名学生" : "students"} · ${termShort(i[4])}">
      <circle cx="${x}" cy="${y}" r="${r}" fill="var(--series)" fill-opacity="${i[5] ? 0.9 : 0.32}" stroke="${i[5] ? "var(--ink)" : "var(--surface)"}" stroke-width="${i[5] ? 2 : 1}"/></g>`;
  });
  let prevX = -1e9, flip = false;
  placed.filter((p) => p.i[5]).sort((a, b) => a.x - b.x).forEach(({ i, x, r, y }) => {
    flip = x - prevX < 70 ? !flip : false; prevX = x;
    s += `<text class="lbl" x="${x}" y="${flip ? y + r + 12 : y - r - 4}" text-anchor="middle">${esc(lastName(i[0]))}</text>`;
  });
  return s + `</svg><div class="legend"><span>${esc(t("instrLegend", termShort(app.term)))}</span></div>`;
}

export function scatter() {
  const INS = app.insights;
  const pts = (INS.scatter || []).map(([id, code, title, gpa, m, n, num]) => ({ id, code, t: title, gpa, m, n, num }));
  const W = MOB() ? 380 : 1080, H = MOB() ? 340 : 380, L = 46, R = 16, T = 14, B = 36;
  const X = (v) => L + ((W - L - R) * Math.log10(v)) / Math.log10(80);
  const y0 = 2.4, y1 = 4.0, Y = (v) => T + (H - T - B) * (1 - (Math.max(v, y0) - y0) / (y1 - y0));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(t("xMent"))} / ${esc(t("yGpa"))}">`;
  for (let v = 2.4; v <= 4.0001; v += 0.4) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`;
  [1, 2, 5, 10, 20, 50].forEach((v) => (s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}"/><text x="${X(v)}" y="${H - 16}" text-anchor="middle">${v}</text>`));
  s += `<text x="${(W + L) / 2}" y="${H - 1}" text-anchor="middle">${esc(t("xMent"))}</text><text x="12" y="${(H - B) / 2}" transform="rotate(-90 12 ${(H - B) / 2})" text-anchor="middle">${esc(t("yGpa"))}</text>`;
  if (INS.campus_gpa) s += `<line x1="${L}" x2="${W - R}" y1="${Y(INS.campus_gpa)}" y2="${Y(INS.campus_gpa)}" stroke="var(--ref)" stroke-dasharray="4 3"/>`;
  const jit = (c) => (((c.num * 7919) % 100) / 100) * 0.5 - 0.25;
  const labeled = new Set(pts.slice().sort((a, b) => b.m - a.m).slice(0, MOB() ? 4 : 7).map((c) => c.id).concat(pts.slice().sort((a, b) => a.gpa - b.gpa).slice(0, MOB() ? 1 : 3).map((c) => c.id)));
  pts.forEach((c) => {
    const x = X(Math.max(1, c.m) * Math.pow(10, jit(c) * 0.08)), y = Y(c.gpa), right = x > W - 140;
    s += `<g data-c="${c.id}" style="cursor:pointer" data-tip="<b>${esc(c.code)}</b> ${esc(c.t)}<br>GPA ${c.gpa.toFixed(2)} · ${esc(c.m ? t("chat", c.m) : t("chatFew"))} · ${fmt(c.n)}"><circle cx="${x}" cy="${y}" r="10" fill="transparent"/><circle cx="${x}" cy="${y}" r="4.5" fill="var(--series)" fill-opacity=".72" stroke="var(--surface)" stroke-width="1.5"/>` +
      (labeled.has(c.id) ? `<text class="lbl" x="${right ? x - 8 : x + 8}" y="${y + 4}"${right ? ' text-anchor="end"' : ""}>${esc(c.code)}</text>` : "") + "</g>";
  });
  return s + "</svg>";
}

export function dotPlot(rows, lo, hi) {
  const W = MOB() ? 360 : 520, rowH = 30, L = 76, R = 60, H = rows.length * rowH + 26, X = (v) => L + ((W - L - R) * (v - lo)) / (hi - lo);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(t("p4"))}">`;
  for (let v = lo; v <= hi + 1e-9; v += 0.2) s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="4" y2="${H - 22}"/><text x="${X(v)}" y="${H - 6}" text-anchor="middle">${v.toFixed(1)}</text>`;
  rows.forEach((r, i) => {
    const y = 16 + i * rowH, lvl = LANG === "zh" && r.level === "Under 100" ? "100 以下" : r.level;
    s += `<g data-tip="${esc(t("lvlTip", lvl, r.gpa.toFixed(2), r.median_course_gpa.toFixed(2), r.courses))}"><rect x="0" y="${y - 13}" width="${W}" height="${rowH}" fill="transparent"/><text class="lbl" x="0" y="${y + 4}">${esc(lvl)}</text>
      <line x1="${X(Math.min(r.gpa, r.median_course_gpa))}" x2="${X(Math.max(r.gpa, r.median_course_gpa))}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="3"/>
      <circle cx="${X(r.median_course_gpa)}" cy="${y}" r="5" fill="var(--surface)" stroke="var(--series)" stroke-width="2"/><circle cx="${X(r.gpa)}" cy="${y}" r="5.5" fill="var(--series)"/><text x="${W - R + 8}" y="${y + 4}">${r.gpa.toFixed(2)}</text></g>`;
  });
  return s + `</svg><div class="legend"><span><i class="dot" style="background:var(--series)"></i>${esc(t("wStudents"))}</span><span><i class="dot ring"></i>${esc(t("medCourse"))}</span></div>`;
}

export function dumbbell(rows) {
  const W = MOB() ? 380 : 1080, rowH = 32, L = 110, R = 16, H = rows.length * rowH + 28, lo = 1.8, hi = 4.0, X = (v) => L + ((W - L - R) * (v - lo)) / (hi - lo);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(t("p2"))}">`;
  for (let v = 2.0; v <= 4.0001; v += 0.5) s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="4" y2="${H - 22}"/><text x="${X(v)}" y="${H - 6}" text-anchor="middle">${v.toFixed(1)}</text>`;
  rows.forEach((r, i) => {
    const y = 18 + i * rowH, id = r.code.replace(/ /g, "-");
    s += `<g data-c="${id}" style="cursor:pointer"><rect x="0" y="${y - 14}" width="${W}" height="${rowH}" fill="transparent"/><text class="lbl" x="0" y="${y + 4}">${esc(r.code)}</text>
      <line x1="${X(r.low.gpa)}" x2="${X(r.high.gpa)}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="4" stroke-linecap="round"/>
      <g data-tip="<b>${esc(r.low.name)}</b><br>GPA ${r.low.gpa.toFixed(2)} · ${fmt(r.low.n)}"><circle cx="${X(r.low.gpa)}" cy="${y}" r="9" fill="transparent"/><circle cx="${X(r.low.gpa)}" cy="${y}" r="5.5" fill="var(--gF)"/></g>
      <g data-tip="<b>${esc(r.high.name)}</b><br>GPA ${r.high.gpa.toFixed(2)} · ${fmt(r.high.n)}"><circle cx="${X(r.high.gpa)}" cy="${y}" r="9" fill="transparent"/><circle cx="${X(r.high.gpa)}" cy="${y}" r="5.5" fill="var(--gA)"/></g>
      <text x="${(X(r.low.gpa) + X(r.high.gpa)) / 2}" y="${y - 8}" text-anchor="middle">${r.spread.toFixed(2)}</text></g>`;
  });
  return s + `</svg><div class="legend"><span><i class="dot" style="background:var(--gA)"></i>${esc(t("most"))}</span><span><i class="dot" style="background:var(--gF)"></i>${esc(t("least"))}</span></div>`;
}

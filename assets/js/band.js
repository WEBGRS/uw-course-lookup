// The sticky A–F band: the grade split of whichever course you hover or open.
import { $, $$, esc, f2, app, G, GV } from "./core.js";
import { t } from "./i18n.js";

let bandCourse, SEGS = [];

export function initBand() {
  $("#bandRow").innerHTML = G.map((g, i) => `<div class="seg" style="background:var(${GV[i]});color:var(--t${g})"><span class="g"></span><span class="p"></span></div>`).join("");
  SEGS = $$("#bandRow .seg");
}

export const resetBand = () => { const c = bandCourse; bandCourse = undefined; setBand(c || null); };

// Idle: the campus-wide split with no caption. Hovering or opening a course: its split, captioned with the course.
export function setBand(c) {
  if (c === bandCourse) return;
  bandCourse = c;
  const d = c && c.dist ? c.dist : app.campusDist, tot = d.reduce((a, b) => a + b, 0) || 1;
  SEGS.forEach((el, i) => {
    const p = (d[i] / tot) * 100;
    el.style.flexGrow = Math.max((d[i] / tot) * 1000, 0.001);
    el.querySelector(".g").textContent = p >= 2.2 ? G[i] : "";
    el.querySelector(".p").textContent = p >= 7 ? " " + Math.round(p) + "%" : "";
    el.dataset.tip = `<b>${G[i]}</b>: ${p.toFixed(1)}%`;
  });
  $("#bandL").innerHTML = !c ? "" : c.dist ? `<b>${esc(c.code)}</b> ${esc(c.t)} · GPA ${f2(c.gpa)}` : t("bandNoData", esc(c.code));
}

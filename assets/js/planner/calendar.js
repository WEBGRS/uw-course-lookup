// Weekly timetable grid and .ics export for a schedule's picks.
import { esc, app } from "../core.js";
import { fmtMin, fmtRange } from "./schedule.js";

export const COLORS = 8;  // --c1 … --c8 in style.css
const DAY_NAMES = { en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], zh: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] };
const HOUR = 46;          // px per hour

/** picks: prepared packages (schedule.js). colorOf: course id -> 0…7. */
export function calendarHtml(picks, colorOf, lang) {
  const meets = picks.flatMap((p) => p.meets.map((m) => ({ ...m, p })));
  const days = meets.some((m) => m.d === 5 || m.d === 6) ? 7 : 5;
  const lo = Math.min(8 * 60, ...meets.map((m) => Math.floor(m.s / 60) * 60)), hi = Math.max(17 * 60, ...meets.map((m) => Math.ceil(m.e / 60) * 60));
  const hours = []; for (let h = lo; h <= hi; h += 60) hours.push(h);
  const names = DAY_NAMES[lang] || DAY_NAMES.en;
  let cols = "";
  for (let d = 0; d < days; d++) {
    const day = meets.filter((m) => m.d === d).sort((a, b) => a.s - b.s);
    // lay out overlapping blocks (part-term sections) side by side
    const lanes = [];
    day.forEach((m) => { let i = lanes.findIndex((end) => end <= m.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = m.e; m.lane = i; });
    const nl = Math.max(1, lanes.length);
    cols += `<div class="cal-col" style="height:${(hi - lo) / 60 * HOUR}px">` + day.map((m) => {
      const top = (m.s - lo) / 60 * HOUR, h = (m.e - m.s) / 60 * HOUR;
      return `<div class="ev c${colorOf(m.p.course) % COLORS + 1}" style="top:${top}px;height:${h - 2}px;left:calc(${m.lane / nl * 100}% + 2px);width:calc(${100 / nl}% - 4px)" title="${esc(m.p.code)} ${esc(m.sec)} · ${esc(fmtRange(m.s, m.e))}${m.loc ? " · " + esc(m.loc) : ""}"><b>${esc(m.p.code)}</b><span>${esc(m.sec.split(" ")[0])} ${esc(fmtMin(m.s))}</span>${h > 54 && m.loc ? `<i>${esc(m.loc.replace(/ (Hall|Building)\b/, ""))}</i>` : ""}</div>`;
    }).join("") + "</div>";
  }
  return `<div class="cal" style="--days:${days}"><div class="cal-head"><span></span>${names.slice(0, days).map((n) => `<span>${n}</span>`).join("")}</div>
    <div class="cal-body"><div class="cal-hours">${hours.map((h) => `<span style="height:${HOUR}px">${fmtMin(h).replace(":00", "")}</span>`).join("")}</div>${cols}</div></div>`;
}

const pad = (n) => String(n).padStart(2, "0");
const dateOf = (dayNo) => new Date(dayNo * 86400000);
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const ICS_DAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const esc2 = (s) => String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

/** Weekly events from the first to the last day of the term (or of a part-term section). */
export function buildICS(picks, name = "Timetable") {
  const [a, b] = (app.meta.term_range || "").split("/").map((s) => Date.parse(s + "T00:00:00Z") / 86400000);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UW Course Lookup//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc2(name)}`,
    "BEGIN:VTIMEZONE", "TZID:America/Chicago",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0600", "TZOFFSETTO:-0500", "TZNAME:CDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0600", "TZNAME:CST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD", "END:VTIMEZONE"];
  let n = 0;
  for (const p of picks) {
    const bySig = new Map();  // merge MWF-style days that share a time into one weekly event
    for (const m of p.meets) { const k = `${m.sec}|${m.s}|${m.e}|${m.w ? m.w.join("-") : ""}|${m.loc}`; (bySig.get(k) || bySig.set(k, { m, days: [] }).get(k)).days.push(m.d); }
    for (const { m, days } of bySig.values()) {
      const start = m.w ? m.w[0] : a, end = m.w ? m.w[1] : b;
      const first = Math.min(...days.map((d) => { let x = start; while ((dateOf(x).getUTCDay() + 6) % 7 !== d) x++; return x; }));
      const t = (mm) => `${pad(Math.floor(mm / 60))}${pad(mm % 60)}00`;
      out.push("BEGIN:VEVENT", `UID:${p.id}-${n++}@uw-course-lookup`, `DTSTAMP:${ymd(new Date())}T000000Z`,
        `DTSTART;TZID=America/Chicago:${ymd(dateOf(first))}T${t(m.s)}`, `DTEND;TZID=America/Chicago:${ymd(dateOf(first))}T${t(m.e)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${[...new Set(days)].sort().map((d) => ICS_DAY[d]).join(",")};UNTIL=${ymd(dateOf(end))}T235959Z`,
        `SUMMARY:${esc2(`${p.code} ${m.sec}`)}`, `LOCATION:${esc2(m.loc || "")}`, `DESCRIPTION:${esc2(`${p.title || ""} · class ${p.id}`)}`, "END:VEVENT");
    }
  }
  out.push("END:VCALENDAR");
  return out.join("\r\n");
}

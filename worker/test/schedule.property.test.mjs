// Randomised check of the solver against an independent brute-force oracle, on generated courses.
// (scripts/check_times.py covers the data; this covers the search.)
import test from "node:test";
import assert from "node:assert/strict";
import { solve } from "../../assets/js/planner/schedule.js";

let seed = 20261002;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const sample = (a, k) => { const c = a.slice(), out = []; while (out.length < k) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };

const DAYS = ["MWF", "TR", "MW", "M", "T", "W", "R", "F", "MTWR"];
function randomMeeting() {
  const start = 7 * 60 + 45 + 15 * Math.floor(rnd() * 40);
  return [pick(DAYS), start, start + pick([50, 75, 110, 170]), "Room"];
}
function randomPackage(i, courseId) {
  const lec = { t: "LEC", n: "001", m: [randomMeeting()], i: [] };
  const secs = [lec];
  if (rnd() < 0.6) secs.push({ t: "DIS", n: String(300 + i), m: [randomMeeting()], i: [] });
  if (rnd() < 0.1) lec.w = [100, 140];                       // part-term section
  const c = rnd();
  return { id: `${courseId}-${i}`, st: c < 0.65 ? "O" : c < 0.85 ? "W" : "C", seats: 4, wait: 0, s: secs, ...(rnd() < 0.05 ? { c: 1 } : {}) };
}
const course = (n) => ({ id: `X-${n}`, code: `X ${n}`, title: "t", cr: String(pick([1, 3, 3, 4])), packages: Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, i) => randomPackage(i, `X-${n}`)) });

// oracle: no code shared with schedule.js
const flat = (pkg) => pkg.s.flatMap((sec) => sec.m.flatMap(([days, s, e]) => [...days].map((ch) => ({ d: "MTWRFSU".indexOf(ch), s, e, w: sec.w || null }))));
const hit = (a, b) => a.d === b.d && a.s < b.e && b.s < a.e && (!a.w || !b.w || (a.w[0] <= b.w[1] && b.w[0] <= a.w[1]));
const clash = (p, q) => flat(p).some((x) => flat(q).some((y) => hit(x, y)));
const allowed = (p, pr) => !p.c && !(p.st === "C" && pr.seats !== "any") && !(p.st === "W" && pr.seats === "open") &&
  flat(p).every((m) => m.s >= pr.earliest && m.e <= pr.latest && !pr.daysOff.includes(m.d));
function feasible(courses, pr) {
  const doms = courses.map((c) => c.packages.filter((p) => allowed(p, pr)));
  if (doms.some((d) => !d.length)) return false;
  const order = doms.map((_, i) => i).sort((a, b) => doms[a].length - doms[b].length), chosen = [];
  const go = (i) => {
    if (i === order.length) return true;
    for (const p of doms[order[i]]) { if (chosen.some((q) => clash(p, q))) continue; chosen.push(p); if (go(i + 1)) return true; chosen.pop(); }
    return false;
  };
  return go(0);
}

test("solver agrees with brute force on 600 random requests", () => {
  let solved = 0, impossible = 0;
  for (let n = 0; n < 600; n++) {
    const courses = Array.from({ length: 2 + Math.floor(rnd() * 4) }, (_, i) => course(n * 10 + i));
    const pr = { earliest: pick([0, 0, 540, 600]), latest: pick([1440, 1440, 1020, 960]), daysOff: rnd() < 0.3 ? [pick([0, 1, 2, 3, 4])] : [], seats: pick(["open", "open+wait", "any"]) };
    const r = solve({ must: courses, prefs: pr, limit: 6 });
    const truth = feasible(courses, pr);
    assert.equal(r.ok, truth, `request ${n}: solver ${r.ok ? "found" : "missed"} a timetable the oracle ${truth ? "has" : "lacks"}`);
    if (!r.ok) { impossible++; assert.ok(r.reasons.length, "an impossible request says why"); continue; }
    solved++;
    for (const s of r.schedules) {
      assert.equal(s.picks.length, courses.length);
      assert.deepEqual(s.picks.map((p) => p.course).sort(), courses.map((c) => c.id).sort());
      for (const p of s.picks) {
        const raw = courses.find((c) => c.id === p.course).packages.find((x) => x.id === p.id);
        assert.ok(raw && allowed(raw, pr), `pick ${p.id} breaks a hard limit`);
      }
      for (let i = 0; i < s.picks.length; i++) for (let j = i + 1; j < s.picks.length; j++) {
        const a = courses.find((c) => c.id === s.picks[i].course).packages.find((x) => x.id === s.picks[i].id);
        const b = courses.find((c) => c.id === s.picks[j].course).packages.find((x) => x.id === s.picks[j].id);
        assert.equal(clash(a, b), false, `request ${n}: ${s.picks[i].course} overlaps ${s.picks[j].course}`);
      }
    }
  }
  assert.ok(solved > 60 && impossible > 60, `both outcomes are exercised (${solved} solved, ${impossible} impossible)`);
});

test("auto-fill never overlaps, breaks a limit or exceeds the credit ceiling", () => {
  for (let n = 0; n < 80; n++) {
    const must = Array.from({ length: 2 }, (_, i) => course(9000 + n * 100 + i));
    const pool = Array.from({ length: 25 }, (_, i) => ({ ...course(9500 + n * 100 + i), weight: 1 + (i % 3) }));
    const pr = { earliest: pick([0, 540]), latest: pick([1440, 1020]), daysOff: [], seats: "open+wait" };
    const lo = pick([9, 12]), hi = lo + 3;
    const r = solve({ must, pool, prefs: pr, credits: [lo, hi], limit: 4 });
    if (!r.ok) continue;
    const all = [...must, ...pool];
    for (const s of r.schedules) {
      assert.ok(s.credits <= hi + 1e-9, `credits ${s.credits} over the ceiling ${hi}`);
      const raws = s.picks.map((p) => all.find((c) => c.id === p.course).packages.find((x) => x.id === p.id));
      raws.forEach((raw) => assert.ok(allowed(raw, pr)));
      for (let i = 0; i < raws.length; i++) for (let j = i + 1; j < raws.length; j++) assert.equal(clash(raws[i], raws[j]), false);
      for (const m of must) assert.ok(s.picks.some((p) => p.course === m.id), "required course kept");
    }
  }
});

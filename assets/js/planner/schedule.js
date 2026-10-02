// Timetable engine: no DOM, no network, so the same file runs in the page and in Node tests.
// Times are minutes after local midnight; days are 0 = Mon … 6 = Sun; a package is one valid way to enroll
// in a course (lecture + the discussion/lab that goes with it), exactly as the API returns it.

export const DAY_LETTERS = "MTWRFSU";
const OPEN = "O", WAIT = "W", CLOSED = "C";

export const DEFAULT_PREFS = {
  earliest: 0,          // hard: no meeting starts before this
  latest: 24 * 60,      // hard: no meeting ends after this
  daysOff: [],          // hard: weekdays (0-4) with no classes at all
  seats: "open+wait",   // "open" | "open+wait" | "any"
  start: 9 * 60,        // soft: preferred earliest start
  end: 17 * 60 + 30,    // soft: preferred latest end
  freeDays: 1,          // soft weight: reward each weekday without class
  compact: 1,           // soft weight: penalise long gaps
  quality: 0,           // soft weight: prefer instructors who grade higher in this course
  buffer: 0,            // minutes that must separate two classes
};

export const fmtMin = (m) => { const h = Math.floor(m / 60), mm = m % 60; return `${(h + 11) % 12 + 1}:${String(mm).padStart(2, "0")}${h < 12 ? "a" : "p"}`; };
export const fmtRange = (s, e) => `${fmtMin(s)}–${fmtMin(e)}`;
export const daysText = (idx) => [...new Set(idx)].sort((a, b) => a - b).map((d) => DAY_LETTERS[d]).join("");

const sameName = (a, b) => {
  const pa = a.toUpperCase().split(/\s+/), pb = b.toUpperCase().split(/\s+/);
  return pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1];
};
const credit = (cr) => { const n = parseFloat(String(cr ?? "").split(/[–-]/)[0]); return Number.isFinite(n) ? n : 0; };

/** One API package → flat meetings plus the facts the scorer needs. */
export function prepPackage(pkg, course) {
  const meets = [];
  for (const s of pkg.s || []) {
    for (const [days, start, end, loc] of s.m || []) {
      for (const ch of days) {
        const d = DAY_LETTERS.indexOf(ch);
        if (d >= 0) meets.push({ d, s: start, e: end, w: s.w || null, sec: `${s.t} ${s.n}`, loc });
      }
    }
  }
  const lead = (pkg.s || []).find((s) => s.t === "LEC" || s.t === "SEM") || (pkg.s || [])[0];
  const who = [...new Set((lead && lead.i) || [])];
  const sig = meets.map((m) => `${m.d}${m.s}-${m.e}${m.w ? "w" + m.w : ""}`).sort().join("|");
  return { id: pkg.id, raw: pkg, course: course.id, meets, status: pkg.st, seats: pkg.seats || 0, wait: pkg.wait || 0,
    consent: !!pkg.c, online: meets.length === 0, who, sig, secs: (pkg.s || []).map((s) => `${s.t} ${s.n}`) };
}

const datesOverlap = (a, b) => !a || !b || (a[0] <= b[1] && b[0] <= a[1]);

export function packagesConflict(p, q, buffer = 0) {
  for (const a of p.meets) for (const b of q.meets) {
    if (a.d === b.d && a.s < b.e + buffer && b.s < a.e + buffer && datesOverlap(a.w, b.w)) return true;
  }
  return false;
}

/** Why a package is excluded under hard preferences, or "" if it is fine. */
function rejection(p, prefs) {
  if (p.consent) return "consent";
  if (p.status === CLOSED && prefs.seats !== "any") return "full";
  if (p.status === WAIT && prefs.seats === "open") return "waitlist";
  for (const m of p.meets) {
    if (m.s < prefs.earliest) return "early";
    if (m.e > prefs.latest) return "late";
    if (prefs.daysOff.includes(m.d)) return "dayoff";
  }
  return "";
}

function instructorGpa(course, p) {
  const ins = course.ins || [];
  const vals = p.who.map((n) => ins.find((i) => sameName(i[0], n))).filter((i) => i && i[1] != null && i[2] >= 30).map((i) => i[1]);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Soft score of one package on its own; higher is better. */
function localScore(p, course, prefs) {
  let s = 0;
  for (const m of p.meets) {
    if (m.s < prefs.start) s -= (prefs.start - m.s) / 60;
    if (m.e > prefs.end) s -= (m.e - prefs.end) / 90;
  }
  if (p.status === WAIT) s -= 2.5;
  else if (p.status === CLOSED) s -= 6;
  else if (p.seats > 0 && p.seats < 3) s -= 0.4;
  if (prefs.quality) {
    const g = instructorGpa(course, p);
    if (g != null && course.gpa != null) s += prefs.quality * (g - course.gpa) * 4;
  }
  return s;
}

/** Whole-schedule score: local scores plus how the days fit together. */
export function scoreSchedule(picks, prefs) {
  let s = picks.reduce((a, p) => a + p.local + (p.weight || 0), 0);
  const byDay = Array.from({ length: 7 }, () => []);
  for (const p of picks) for (const m of p.meets) byDay[m.d].push(m);
  let gaps = 0, free = 0;
  for (let d = 0; d < 5; d++) {
    const ms = byDay[d].sort((a, b) => a.s - b.s);
    if (!ms.length) { free++; continue; }
    for (let i = 1; i < ms.length; i++) gaps += Math.max(0, ms[i].s - ms[i - 1].e - 60);
  }
  return s + prefs.freeDays * free * 1.5 - prefs.compact * gaps / 45;
}

export function describe(picks) {
  const byDay = Array.from({ length: 7 }, () => []);
  for (const p of picks) for (const m of p.meets) byDay[m.d].push(m);
  const days = byDay.map((ms) => ms.sort((a, b) => a.s - b.s));
  const used = days.flatMap((ms, d) => (ms.length ? [d] : []));
  const all = days.flat();
  let gap = 0;
  for (const ms of days) for (let i = 1; i < ms.length; i++) gap += Math.max(0, ms[i].s - ms[i - 1].e);
  return { freeDays: [0, 1, 2, 3, 4].filter((d) => !days[d].length), daysUsed: used,
    earliest: all.length ? Math.min(...all.map((m) => m.s)) : null, latest: all.length ? Math.max(...all.map((m) => m.e)) : null,
    gapMinutes: gap, waitlisted: picks.filter((p) => p.status === WAIT).length, full: picks.filter((p) => p.status === CLOSED).length };
}

/** Prepare a course's options once: filter by hard preferences, then keep the best package per distinct timetable. */
function options(course, prefs) {
  const all = (course.packages || []).map((pk) => prepPackage(pk, course));
  const removed = {};
  const kept = [];
  for (const p of all) {
    const why = rejection(p, prefs);
    if (why) removed[why] = (removed[why] || 0) + 1;
    else kept.push(p);
  }
  const best = new Map();
  const rank = (p) => (p.status === OPEN ? 2 : p.status === WAIT ? 1 : 0) * 1000 + p.seats;
  for (const p of kept) {
    p.local = localScore(p, course, prefs);
    p.weight = course.weight || 0;
    p.cr = credit(course.cr);
    p.code = course.code; p.title = course.title; p.slot = course.slot || ""; p.block = course.block || "";
    const cur = best.get(p.sig);
    if (!cur || rank(p) > rank(cur)) best.set(p.sig, p);
  }
  const opts = [...best.values()].sort((a, b) => b.local - a.local);
  return { course, all, opts, removed };
}

function whyEmpty(o) {
  if (!o.all.length) return "unscheduled";
  const r = o.removed, top = Object.entries(r).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : "unscheduled";
}

/**
 * Find timetables.
 *   must   – courses that have to be in every result
 *   pool   – optional courses the solver may add to reach the credit window
 *   credits – [lo, hi] total credits wanted
 *   caps   – {block: n} most pool courses to take from one requirement block; pool courses sharing a `slot` are alternatives
 * Returns { ok, schedules: [{ picks, credits, score, ...describe() }], reasons: [] }.
 */
export function solve({ must = [], pool = [], prefs = {}, credits = [0, 99], limit = 6, budget = 80000, caps = {} }) {
  prefs = { ...DEFAULT_PREFS, ...prefs };
  const M = must.map((c) => options(c, prefs));
  const reasons = [];
  for (const o of M) if (!o.opts.length) reasons.push({ type: "none", course: o.course.id, code: o.course.code, why: whyEmpty(o), removed: o.removed });
  if (reasons.length) return { ok: false, schedules: [], reasons };

  for (let i = 0; i < M.length; i++) for (let j = i + 1; j < M.length; j++) {
    const clash = M[i].opts.every((a) => M[j].opts.every((b) => packagesConflict(a, b, prefs.buffer)));
    if (clash) reasons.push({ type: "clash", a: M[i].course.code, b: M[j].course.code });
  }
  if (reasons.length) return { ok: false, schedules: [], reasons };

  const leaves = [];
  let nodes = 0;
  const maxLeaves = 1500;
  const fits = (p, picks) => !picks.some((q) => packagesConflict(p, q, prefs.buffer));

  // Depth-first with forward checking; the most constrained course goes first
  (function dfs(picks, domains) {
    if (leaves.length >= maxLeaves || nodes > budget) return;
    if (!domains.length) { leaves.push(picks.slice()); return; }
    let bi = 0;
    for (let i = 1; i < domains.length; i++) if (domains[i].dom.length < domains[bi].dom.length) bi = i;
    const { dom } = domains[bi];
    const rest = domains.filter((_, i) => i !== bi);
    for (const p of dom) {
      nodes++;
      const next = [];
      let dead = false;
      for (const d of rest) {
        const nd = d.dom.filter((q) => !packagesConflict(p, q, prefs.buffer));
        if (!nd.length) { dead = true; break; }
        next.push({ dom: nd });
      }
      if (dead) continue;
      picks.push(p);
      dfs(picks, next);
      picks.pop();
      if (leaves.length >= maxLeaves || nodes > budget) return;
    }
  })([], M.map((o) => ({ dom: o.opts })));

  if (!leaves.length) return { ok: false, schedules: [], reasons: [{ type: "nofit" }] };

  const lo = credits[0], hi = credits[1];
  const P = pool.map((c) => options(c, prefs)).filter((o) => o.opts.length);
  P.sort((a, b) => (b.course.weight || 0) - (a.course.weight || 0));
  const scored = leaves.map((picks) => ({ picks, s: scoreSchedule(picks, prefs) })).sort((a, b) => b.s - a.s).slice(0, 150);

  const finals = [];
  for (const { picks } of scored) {
    const base = picks.reduce((a, p) => a + p.cr, 0);
    if (base > hi) continue;
    let states = [{ picks, cr: base }];
    if (base < lo || (P.length && base < hi)) {
      for (const o of P) {
        const grown = [];
        for (const st of states) {
          for (const p of o.opts.slice(0, 6)) {
            if (st.cr + p.cr > hi || !fits(p, st.picks)) continue;
            if (p.slot && st.picks.some((q) => q.slot === p.slot)) continue;             // one course per requirement slot
            if (p.block && caps[p.block] != null && st.picks.filter((q) => q.block === p.block).length >= caps[p.block]) continue;
            grown.push({ picks: [...st.picks, p], cr: st.cr + p.cr });
          }
        }
        states = states.concat(grown);
        if (states.length > 120) {
          states = states.map((st) => ({ ...st, s: scoreSchedule(st.picks, prefs) + (st.cr >= lo ? 3 : st.cr / Math.max(lo, 1)) }))
            .sort((a, b) => b.s - a.s).slice(0, 80);
        }
      }
    }
    for (const st of states) if (st.cr <= hi) finals.push(st);
  }

  // Group by course set, then deal out the best of each group first so results differ in courses before sections
  const groups = new Map();
  const dup = new Set();
  for (const st of finals) {
    const set = st.picks.map((p) => p.course).sort().join("+");
    const key = set + "#" + st.picks.map((p) => p.sig).sort().join("/");
    if (dup.has(key)) continue;
    dup.add(key);
    const score = scoreSchedule(st.picks, prefs) - 0.7 * Math.max(0, st.cr - lo) - 6 * Math.max(0, lo - st.cr);
    if (!groups.has(set)) groups.set(set, []);
    groups.get(set).push({ picks: st.picks, credits: st.cr, score });
  }
  const lists = [...groups.values()].map((g) => g.sort((a, b) => b.score - a.score)).sort((a, b) => b[0].score - a[0].score);
  const dealt = [];
  for (let round = 0; dealt.length < limit && round < 8; round++) {
    for (const g of lists) if (g[round] && dealt.length < limit) dealt.push(g[round]);
  }
  const schedules = dealt.map((s) => ({ ...s, ...describe(s.picks), short: Math.max(0, lo - s.credits) }));
  if (!schedules.length) return { ok: false, schedules: [], reasons: [{ type: "over", have: Math.min(...scored.map((x) => x.picks.reduce((a, p) => a + p.cr, 0))), hi }] };
  return { ok: true, schedules, reasons: [], stats: { nodes, leaves: leaves.length } };
}

/** Other packages for one course in a schedule that still fit with the rest (best first). */
export function swapOptions(schedule, courseId, course, prefs = {}) {
  prefs = { ...DEFAULT_PREFS, ...prefs };
  const others = schedule.picks.filter((p) => p.course !== courseId);
  return (course.packages || []).map((pk) => prepPackage(pk, course))
    .filter((p) => !p.consent && !packagesConflict(p, { meets: others.flatMap((o) => o.meets) }, prefs.buffer))
    .map((p) => ({ ...p, local: localScore(p, course, prefs), cr: credit(course.cr), code: course.code, title: course.title, weight: course.weight || 0 }))
    .sort((a, b) => b.local - a.local);
}

/** Tell the user, in one clause, why `reasons` came back. Pure data → short English; the UI localises by `type`. */
export function reasonKey(r) { return r.type === "none" ? `none:${r.why}` : r.type; }

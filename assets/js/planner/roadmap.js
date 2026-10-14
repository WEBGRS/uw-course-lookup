// Semester roadmap: spread what a degree still needs over the semesters left, then fill the gaps with light electives.
// Pure functions, no DOM. Rows are list records from /api/courses, data is /api/plan output.
import { requisiteState, requisiteIds } from "./degree.js";

export const nextTerm = (c) => (c % 10 === 2 ? c + 2 : c + 8);
export const termSeason = (c) => (c % 10 === 2 ? "F" : "S");
export function termsFrom(start, n) {
  const out = [];
  for (let c = start; out.length < n; c = nextTerm(c)) out.push(c);
  return out;
}
/** Semesters from `start` up to and including `last`. */
export const termsBetween = (start, last) => { const out = []; for (let c = start; c <= last && out.length < 20; c = nextTerm(c)) out.push(c); return out; };

export const crNum = (c) => { const n = parseFloat(String(c ?? "").split(/[–-]/)[0]); return Number.isFinite(n) && n > 0 ? n : 3; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const numOf = (p) => parseInt(String(p.id).match(/(\d+)$/)?.[1] || 999, 10);
const score = (o, rows, prefer) => {
  const r = o.i.map((id) => rows.get(id)).find(Boolean);
  return (o.i.some((id) => prefer.has(id)) ? 10 : 0) + (r && r.now ? 0.4 : 0) + (r && r.gpa != null ? r.gpa : 3);
};

/**
 * Choose the courses that finish every unmet requirement block.
 * "all" blocks take every item; "n" and "cr" blocks take the easiest-looking items until they are satisfied.
 * `prefer` holds course ids the user already asked for; they win ties and come first. `exclude` ids are never chosen.
 */
export function pickRequired(statuses, rows, prefer = new Set(), exclude = new Set()) {
  const picks = [], chosen = new Set(exclude);
  const take = (s, o, kind) => {
    chosen.add(o.i[0]);
    picks.push({ id: o.i[0], ids: o.i, t: o.t, cr: crNum(o.c), block: s.index, blockName: s.block.h.split(" › ").pop(), kind, user: o.i.some((id) => prefer.has(id)) });
  };
  const live = statuses.filter((s) => s.counted && !s.planned);
  const free = (o) => !o.i.some((id) => chosen.has(id));
  for (const s of live.filter((x) => x.block.rule.t === "all")) {
    for (const x of s.items) {
      if (x.state !== "todo") continue;
      const o = [...x.item.o].filter(free).sort((a, b) => score(b, rows, prefer) - score(a, rows, prefer))[0];
      if (o) take(s, o, "core");
    }
  }
  for (const s of live.filter((x) => x.block.rule.t !== "all")) {
    const todo = s.items.filter((x) => x.state === "todo").map((x) => ({ x, o: [...x.item.o].filter(free).sort((a, b) => score(b, rows, prefer) - score(a, rows, prefer))[0] })).filter((y) => y.o);
    todo.sort((a, b) => score(b.o, rows, prefer) - score(a.o, rows, prefer));
    let left = s.unit === "credits" ? s.need - s.haveIp : s.need - s.haveIp;
    for (const y of todo) {
      if (left <= 0) break;
      if (!free(y.o)) continue;
      take(s, y.o, "elective");
      left -= s.unit === "credits" ? crNum(y.o.c) : 1;
    }
  }
  return picks;
}

/**
 * Place picks into semesters.
 *   picks   [{id, ids, cr, kind, user, ...}]   data(id) -> {prq, ts, cr, num, gpa} | null
 *   terms   term codes, first = the semester being planned now
 *   lo, hi  credits per semester;  freeCr  credits still needed beyond the picks (free electives)
 * Returns { semesters: [{term, main, mainCr, lightCr, short}], unplaced, needCr, capacity, over, earliest }.
 */
export function layout({ picks, data, taken = new Set(), designations = [], terms, lo, hi, freeCr = 0, maxMain = Infinity }) {
  const info = (p) => data(p.id) || {};
  const cr = (p) => (info(p).cr ? crNum(info(p).cr) : p.cr);
  const prq = (p) => info(p).prq || "";
  const reqIds = new Map(picks.map((p) => [p.id, requisiteIds(prq(p), designations)]));

  // depth = how many courses wait behind this one
  const memo = new Map();
  const depth = (p, seen = new Set()) => {
    if (memo.has(p.id)) return memo.get(p.id);
    if (seen.has(p.id)) return 0;
    seen.add(p.id);
    const kids = picks.filter((q) => q !== p && reqIds.get(q.id).some((id) => p.ids.includes(id)) && requisiteState(prq(q), designations, taken) !== true);
    const d = 1 + Math.max(0, ...kids.map((q) => depth(q, seen)));
    memo.set(p.id, d);
    return d;
  };

  const have = new Set(taken), left = new Set(picks);
  const needCr = picks.reduce((a, p) => a + cr(p), 0) + freeCr;
  const capacity = hi * terms.length;
  let freeLeft = freeCr;
  const semesters = [];
  terms.forEach((term, i) => {
    const season = termSeason(term), termsLeft = terms.length - i;
    const remainingReq = [...left].reduce((a, p) => a + cr(p), 0);
    const target = clamp(Math.round((remainingReq + freeLeft) / termsLeft), lo, hi);
    const minMain = Math.max(0, remainingReq - hi * (termsLeft - 1));
    const ok = (p) => requisiteState(prq(p), designations, have) !== false && (!info(p).ts || info(p).ts.includes(season));
    const order = [...left].filter(ok).sort((a, b) => Number(b.user) - Number(a.user) || depth(b) - depth(a) || Number(b.kind === "core") - Number(a.kind === "core") || numOf(a) - numOf(b));
    const main = [];
    let sum = 0;
    for (const p of order) {
      if (sum >= target && sum >= minMain) break;
      if (main.length >= maxMain || sum + cr(p) > hi) continue;
      main.push({ ...p, cr: cr(p), gpa: info(p).gpa ?? null, ts: info(p).ts || "" });
      sum += cr(p);
    }
    main.forEach((p) => { left.delete(picks.find((q) => q.id === p.id)); });
    let light = clamp(target - sum, 0, freeLeft);
    if (sum + light < lo) light = Math.min(freeLeft, lo - sum);
    light = Math.max(0, light);
    freeLeft -= light;
    semesters.push({ term, season, main, mainCr: sum, lightCr: light, short: Math.max(0, lo - sum - light) });
    main.forEach((p) => p.ids.forEach((id) => have.add(id)));
  });
  const unplaced = [...left].map((p) => ({
    pick: p,
    reason: requisiteState(prq(p), designations, have) === false ? "prereq" : info(p).ts && !terms.some((t) => info(p).ts.includes(termSeason(t))) ? "season" : "room",
  }));
  const over = Math.max(0, needCr - capacity);
  return { semesters, unplaced, needCr, capacity, over, earliest: Math.max(1, Math.ceil(needCr / hi)), freeUnplaced: freeLeft };
}

/**
 * Light electives for each semester's free credits: high-GPA, low-level courses, rotating through the pools
 * (general, gen-ed, humanities, social science, ...) so a semester is not five of the same kind.
 *   pools  [[row, ...], ...] list rows already sorted best first;  data(id) may be null while still loading
 */
export function chooseLight({ semesters, pools, data = () => null, taken = new Set(), designations = [], skip = new Set() }) {
  const used = new Set(skip), have = new Set(taken), cursor = pools.map(() => 0);
  return semesters.map((s, si) => {
    const out = [];
    let sum = 0, turn = si % Math.max(1, pools.length), guard = 0;
    while (sum < s.lightCr - 0.01 && guard++ < 200 && pools.length) {
      const k = turn % pools.length;
      turn++;
      let row = null;
      while (cursor[k] < pools[k].length) {
        const r = pools[k][cursor[k]++];
        const d = data(r.id) || {};
        const dup = used.has(r.id) || (r.al || []).some((a) => used.has(a.replace(/\s+/g, "-")));
        const done = have.has(r.id) || (r.al || []).some((a) => have.has(a.replace(/\s+/g, "-")));
        if (dup || done || r.num >= 400 || crNum(r.cr) > 4 || (crNum(r.cr) < 2 && s.lightCr - sum >= 2)) continue;
        if (d.ts && !d.ts.includes(s.season)) continue;
        if (d.prq && requisiteState(d.prq, designations, have) === false) continue;
        row = r; break;
      }
      if (!row) { if (cursor.every((c, j) => c >= pools[j].length)) break; continue; }
      used.add(row.id); (row.al || []).forEach((a) => used.add(a.replace(/\s+/g, "-")));
      out.push(row); sum += crNum(row.cr);
    }
    s.main.forEach((p) => p.ids.forEach((id) => have.add(id)));
    return { ...s, light: out, lightGot: sum };
  });
}

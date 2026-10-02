// Degree logic: read a transcript / DARS text, score a program's requirements against it, and propose what to take next.
// Pure functions, no DOM; programs come from assets/programs/*.json (scripts/fetch_programs.py).

const PASSED = new Set(["A", "AB", "B", "BC", "C", "D", "S", "CR", "P", "T"]);
const NOT_PASSED = new Set(["F", "U", "NR", "NW", "I"]);
const GRADE_RE = /(\d{1,2}\.\d{1,3})\s+(?:\d{1,2}\.\d{1,3}\s+)?(AB|BC|CR|NR|NW|IP|[ABCDFSUPTI])(?![A-Za-z])/;
const SHORT = { CS: "COMP SCI", STATS: "STAT", ECE: "E C E", BIO: "BIOLOGY", NUTRISCI: "NUTR SCI", POLISCI: "POLI SCI", PSYCH: "PSYCH" };

export const toId = (designation) => designation.trim().replace(/\s+/g, "-");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "COMP SCI/MATH 240" → ["COMP-SCI-240", "MATH-240"] */
export function expand(subjects, num) {
  return subjects.split("/").map((s) => toId(`${s.trim()} ${num}`));
}

function subjectRegex(designations, flags = "g") {
  const alt = [...designations].sort((a, b) => b.length - a.length).map((s) => esc(s).replace(/\s+/g, "\\s+")).join("|");
  return new RegExp(`\\b((?:${alt})(?:\\s*/\\s*(?:${alt}))*)\\s*(\\d{3})\\b`, flags);
}

/**
 * Read a UW transcript or DARS dump.
 * A course counts as taken when a credit/grade pair follows it; credits without a grade mean in progress.
 * With no structured lines at all (a typed list like "cs 300, math 221") every mention counts as taken.
 */
export function parseTranscript(text, designations) {
  const out = { done: new Set(), ip: new Set(), failed: new Set(), mentions: 0, structured: false };
  const groups = { done: new Map(), ip: new Map() };      // a cross-listed course (COMP SCI/MATH 240) is one group of ids
  const note = (kind, ids) => { if (!groups[kind].has(ids[0])) groups[kind].set(ids[0], ids); };
  const flat = String(text || "").replace(/​/g, "").replace(/[ \t]+/g, " ");
  const re = subjectRegex(designations);
  const hits = [...flat.matchAll(re)];
  out.mentions = hits.length;
  hits.forEach((m, i) => {
    const end = m.index + m[0].length, stop = Math.min(hits[i + 1] ? hits[i + 1].index : flat.length, end + 170);
    const win = flat.slice(end, stop);
    const ids = expand(m[1].replace(/\s+/g, " "), m[2]);
    const g = win.match(GRADE_RE);
    if (g) {
      out.structured = true;
      const grade = g[2];
      const bucket = PASSED.has(grade) ? out.done : grade === "IP" ? out.ip : NOT_PASSED.has(grade) ? out.failed : null;
      if (bucket) ids.forEach((id) => bucket.add(id));
      if (bucket === out.done) note("done", ids); else if (bucket === out.ip) note("ip", ids);
    } else if (/\d{1,2}\.\d{2,3}/.test(win.slice(0, 90))) {
      out.structured = true;
      ids.forEach((id) => out.ip.add(id));
      note("ip", ids);
    }
  });
  if (!out.structured) hits.forEach((m) => { const ids = expand(m[1].replace(/\s+/g, " "), m[2]); ids.forEach((id) => out.done.add(id)); note("done", ids); });
  if (!out.structured && !hits.length) {  // loose list: "cs 300, stats 240"
    for (const m of flat.matchAll(/\b(\d{3})\b/g)) {
      const words = flat.slice(Math.max(0, m.index - 24), m.index).toUpperCase().match(/[A-Z]+/g) || [];
      for (let n = Math.min(3, words.length); n >= 1; n--) {  // longest subject first: "COMP SCI" before "SCI"
        const raw = words.slice(-n).join(" ");
        const subj = SHORT[raw.replace(/ /g, "")] || (designations.includes(raw) ? raw : null);
        if (subj) { out.done.add(toId(`${subj} ${m[1]}`)); note("done", [toId(`${subj} ${m[1]}`)]); break; }
      }
    }
  }
  for (const id of out.failed) if (out.done.has(id)) out.failed.delete(id);  // retaken and passed
  return { done: [...out.done], ip: [...out.ip].filter((id) => !out.done.has(id)), failed: [...out.failed], mentions: out.mentions,
    doneGroups: [...groups.done.values()], ipGroups: [...groups.ip.values()].filter((ids) => !ids.some((id) => out.done.has(id))) };
}

const credit = (c) => { const n = parseFloat(String(c ?? "").split(/[–-]/)[0]); return Number.isFinite(n) ? n : 0; };
const anyIn = (set, opt) => opt.i.some((id) => set.has(id));

/** Per block: which items are done / in progress / still to do, and whether the rule is met. */
export function statusOf(program, done, ip = new Set()) {
  return program.blocks.map((block, bi) => {
    const items = block.items.map((item, ii) => {
      const d = item.o.find((o) => anyIn(done, o)), p = !d && item.o.find((o) => anyIn(ip, o));
      return { item, key: `${bi}.${ii}`, state: d ? "done" : p ? "ip" : "todo", via: d || p || null };
    });
    const r = block.rule, nDone = items.filter((x) => x.state === "done").length, nIp = items.filter((x) => x.state !== "todo").length;
    let need = 0, have = 0, haveIp = 0, unit = "courses";
    if (r.t === "all") { need = items.length; have = nDone; haveIp = nIp; }
    else if (r.t === "n") { need = Math.min(r.n, items.length); have = Math.min(need, nDone); haveIp = Math.min(need, nIp); }
    else if (r.t === "cr") {
      need = r.c; unit = "credits";
      have = items.filter((x) => x.state === "done").reduce((a, x) => a + credit(x.via.c), 0);
      haveIp = items.filter((x) => x.state !== "todo").reduce((a, x) => a + credit(x.via.c), 0);
    }
    const counted = r.t !== "info";
    return { index: bi, block, items, need, have, haveIp, unit, counted, met: counted && have >= need, planned: counted && haveIp >= need };
  });
}

export function progress(statuses) {
  const c = statuses.filter((s) => s.counted && s.need > 0);
  const total = c.length, met = c.filter((s) => s.met).length, planned = c.filter((s) => s.planned).length;
  return { total, met, planned };
}

/** Courses that would move an unmet block forward. `weight` says how much the solver should want each. */
export function candidatesFrom(statuses) {
  const out = [];
  for (const s of statuses) {
    if (!s.counted || s.planned) continue;
    const left = s.unit === "credits" ? Math.ceil((s.need - s.haveIp) / 3) : s.need - s.haveIp;
    const weight = s.block.rule.t === "all" ? 3 : s.block.rule.t === "n" ? 2 : 1.5;
    for (const x of s.items) {
      if (x.state !== "todo") continue;
      for (const o of x.item.o) out.push({ id: o.i[0], ids: o.i, title: o.t, cr: o.c || null, weight, slot: `${s.index}.${x.key}`, block: `b${s.index}`, need: left, h: s.block.h });
    }
  }
  return out;
}

export function blockCaps(statuses) {
  const caps = {};
  for (const s of statuses) if (s.counted && !s.planned) caps[`b${s.index}`] = Math.max(1, s.unit === "credits" ? Math.ceil((s.need - s.haveIp) / 3) : s.need - s.haveIp);
  return caps;
}

/** Heuristic: the requisite text names courses, and you have none of them. Not a prerequisite check. */
export function prereqRisk(prqText, designations, taken) {
  if (!prqText) return false;
  const named = [...prqText.replace(/​/g, "").matchAll(subjectRegex(designations))].flatMap((m) => expand(m[1], m[2]));
  return named.length > 0 && !named.some((id) => taken.has(id));
}

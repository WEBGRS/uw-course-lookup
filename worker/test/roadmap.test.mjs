import test from "node:test";
import assert from "node:assert/strict";
import { statusOf } from "../../assets/js/planner/degree.js";
import { pickRequired, layout, chooseLight, termsFrom, termsBetween, nextTerm } from "../../assets/js/planner/roadmap.js";

const DES = ["COMP SCI", "MATH"];
const opt = (id, c = "4") => ({ i: [id], t: id, c });
const item = (...o) => ({ o });
const program = {
  blocks: [
    { h: "Core", rule: { t: "all" }, items: [item(opt("MATH-221", "5")), item(opt("MATH-222", "4")), item(opt("COMP-SCI-300", "3")), item(opt("COMP-SCI-400", "3"))] },
    { h: "Pick two", rule: { t: "n", n: 2 }, items: [item(opt("COMP-SCI-540")), item(opt("COMP-SCI-552")), item(opt("COMP-SCI-564"))] },
  ],
};
const rows = new Map([["COMP-SCI-540", { gpa: 3.2 }], ["COMP-SCI-552", { gpa: 3.7 }], ["COMP-SCI-564", { gpa: 3.5 }]]);
const DATA = {
  "MATH-221": { prq: "", ts: "FS" },
  "MATH-222": { prq: "MATH 221", ts: "FS" },
  "COMP-SCI-300": { prq: "MATH 221", ts: "FS" },
  "COMP-SCI-400": { prq: "COMP SCI 300 and MATH 222", ts: "S" },
  "COMP-SCI-540": { prq: "COMP SCI 400", ts: "FS" },
  "COMP-SCI-552": { prq: "COMP SCI 300", ts: "FS" },
  "COMP-SCI-564": { prq: "COMP SCI 400", ts: "F" },
};
const data = (id) => DATA[id] || null;

test("terms: fall/spring rotation", () => {
  assert.deepEqual(termsFrom(1272, 4), [1272, 1274, 1282, 1284]);
  assert.deepEqual(termsBetween(1274, 1292), [1274, 1282, 1284, 1292]);
  assert.equal(nextTerm(1274), 1282);
});

test("pickRequired: all core items, easiest elective options", () => {
  const picks = pickRequired(statusOf(program, new Set()), rows);
  assert.deepEqual(picks.map((p) => p.id), ["MATH-221", "MATH-222", "COMP-SCI-300", "COMP-SCI-400", "COMP-SCI-552", "COMP-SCI-564"]);
  const done = pickRequired(statusOf(program, new Set(["MATH-221", "MATH-222"])), rows);
  assert.ok(!done.some((p) => p.id.startsWith("MATH")));
  assert.equal(pickRequired(statusOf(program, new Set(["COMP-SCI-540"]), new Set(["COMP-SCI-552"])), rows).filter((p) => p.kind === "elective").length, 0);
});

test("pickRequired: user's own choice wins", () => {
  const picks = pickRequired(statusOf(program, new Set()), rows, new Set(["COMP-SCI-540"]));
  assert.ok(picks.some((p) => p.id === "COMP-SCI-540"));
});

test("layout: prerequisites come first, seasons respected, credits in range", () => {
  const picks = pickRequired(statusOf(program, new Set()), rows);
  const r = layout({ picks, data, designations: DES, terms: termsFrom(1272, 5), lo: 6, hi: 12, freeCr: 12 });
  const where = {};
  r.semesters.forEach((s, i) => s.main.forEach((p) => { where[p.id] = i; }));
  assert.ok(where["MATH-221"] < where["MATH-222"] && where["MATH-221"] < where["COMP-SCI-300"]);
  assert.ok(where["COMP-SCI-400"] > where["COMP-SCI-300"] && where["COMP-SCI-400"] > where["MATH-222"]);
  assert.equal(r.semesters[where["COMP-SCI-400"]].season, "S");     // spring-only course
  assert.equal(r.semesters[where["COMP-SCI-564"]].season, "F");     // fall-only course
  assert.ok(where["COMP-SCI-564"] > where["COMP-SCI-400"]);
  assert.equal(r.unplaced.length, 0);
  for (const s of r.semesters) assert.ok(s.mainCr + s.lightCr <= 12 && s.mainCr + s.lightCr >= 6 - 1e-9, JSON.stringify(s));
  assert.equal(r.semesters.reduce((a, s) => a + s.mainCr + s.lightCr, 0), r.needCr);
});

test("layout: too many credits for the semesters left", () => {
  const picks = pickRequired(statusOf(program, new Set()), rows);
  const r = layout({ picks, data, designations: DES, terms: termsFrom(1272, 2), lo: 3, hi: 9, freeCr: 40 });
  assert.ok(r.over > 0);
  assert.equal(r.capacity, 18);
  assert.ok(r.earliest > 2);
  assert.ok(r.unplaced.length > 0);
});

test("layout: finishing early leaves light semesters short of the minimum", () => {
  const r = layout({ picks: [{ id: "MATH-221", ids: ["MATH-221"], cr: 4, kind: "core" }], data, designations: DES, terms: termsFrom(1272, 3), lo: 12, hi: 16, freeCr: 0 });
  assert.equal(r.semesters[0].short, 8);
  assert.equal(r.earliest, 1);
});

test("layout: courses already taken unlock prerequisites at once", () => {
  const picks = pickRequired(statusOf(program, new Set(["MATH-221"])), rows);
  const r = layout({ picks, data, taken: new Set(["MATH-221"]), designations: DES, terms: termsFrom(1272, 4), lo: 3, hi: 8, freeCr: 0 });
  assert.ok(r.semesters[0].main.some((p) => p.id === "MATH-222" || p.id === "COMP-SCI-300"));
});

test("chooseLight: fills the credits, no repeats, skips taken and upper-level courses", () => {
  const mk = (id, num, cr = "3") => ({ id, code: id, num, cr, gpa: 3.8 });
  const pools = [[mk("A-101", 101), mk("A-102", 102), mk("A-499", 499), mk("A-103", 103)], [mk("B-110", 110), mk("A-101", 101), mk("B-111", 111)]];
  const sems = [{ term: 1272, season: "F", main: [], lightCr: 6 }, { term: 1274, season: "S", main: [], lightCr: 6 }];
  const out = chooseLight({ semesters: sems, pools, taken: new Set(["A-102"]) });
  const ids = out.flatMap((s) => s.light.map((r) => r.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes("A-102") && !ids.includes("A-499"));
  assert.ok(out[0].lightGot >= 6);
});

test("chooseLight: a season mismatch drops the course", () => {
  const rowsF = [{ id: "X-100", num: 100, cr: "3" }, { id: "Y-100", num: 100, cr: "3" }];
  const out = chooseLight({ semesters: [{ term: 1274, season: "S", main: [], lightCr: 3 }], pools: [rowsF], data: (id) => (id === "X-100" ? { ts: "F" } : null) });
  assert.deepEqual(out[0].light.map((r) => r.id), ["Y-100"]);
});

test("pickRequired: excluded ids are skipped for the next-best option", () => {
  const picks = pickRequired(statusOf(program, new Set()), rows, new Set(), new Set(["COMP-SCI-552"]));
  assert.ok(!picks.some((p) => p.id === "COMP-SCI-552"));
  assert.equal(picks.filter((p) => p.kind === "elective").length, 2);
});

test("layout: maxMain caps main courses per semester", () => {
  const picks = pickRequired(statusOf(program, new Set()), rows);
  const r = layout({ picks, data, designations: DES, terms: termsFrom(1272, 6), lo: 3, hi: 16, freeCr: 0, maxMain: 1 });
  for (const s of r.semesters) assert.ok(s.main.length <= 1);
});

test("layout: credits spread evenly, no short last semester", () => {
  const r = layout({ picks: [], data, designations: DES, terms: termsFrom(1272, 7), lo: 12, hi: 16, freeCr: 91 });
  const per = r.semesters.map((s) => s.lightCr);
  assert.equal(per.reduce((a, b) => a + b, 0), 91);
  assert.ok(Math.max(...per) - Math.min(...per) <= 1, per.join());
  assert.ok(r.semesters.every((s) => !s.short));
});

test("chooseLight: skips 1-credit fillers while 2 or more credits are open", () => {
  const rowsX = [{ id: "M-1", num: 10, cr: "1" }, { id: "N-100", num: 100, cr: "3" }];
  const out = chooseLight({ semesters: [{ term: 1272, season: "F", main: [], lightCr: 3 }], pools: [rowsX] });
  assert.deepEqual(out[0].light.map((r) => r.id), ["N-100"]);
});

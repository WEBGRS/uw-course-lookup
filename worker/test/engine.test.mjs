import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIndex, query, detail, details, planData } from "../src/engine.js";

const data = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const ix = buildIndex(data);
const run = (o) => {
  const r = query(ix, new URLSearchParams(o));
  return { total: r.total, ids: r.rows.map((x) => JSON.parse(x).id), rows: r.rows.map((x) => JSON.parse(x)) };
};

test("meta: counts, lenses, subjects, first term", () => {
  const m = JSON.parse(ix.metaJson);
  assert.equal(m.count, 9);
  assert.equal(m.first, 1244);
  assert.equal(m.term_range, "2026-09-02/2026-12-09");
  assert.equal(m.lens.open, 4);
  assert.equal(m.lens.easy, 0);
  assert.deepEqual(m.subjects, ["ANTHRO", "ASIAN", "COMP SCI", "GERMAN", "LITTRANS", "MATH", "PHYSICS", "SURGERY"]);
  assert.deepEqual(m.breadths, ["Natural Science"]);
  assert.ok(m.designations.includes("E C E") && m.designations.includes("COMP SCI"));
});

test("default sort: mentions, then Reddit threads, then enrollment", () => {
  assert.deepEqual(run({}).ids.slice(0, 5), ["MATH-234", "COMP-SCI-300", "COMP-SCI-577", "ANTHRO-104", "LITTRANS-326"]);
});

test("code-like queries match code prefixes only", () => {
  assert.deepEqual(run({ q: "cs 5" }).ids, ["COMP-SCI-577"]);
  assert.deepEqual(run({ q: "cs" }).ids.sort(), ["COMP-SCI-300", "COMP-SCI-577"]); // not "physi-cs"
  assert.deepEqual(run({ q: "e c e 300" }).ids, ["COMP-SCI-300"]); // cross-list alias
  assert.deepEqual(run({ q: "  CS  577 " }).ids, ["COMP-SCI-577"]);
});

test("title words, number and instructor", () => {
  assert.deepEqual(run({ q: "calculus 234" }).ids, ["MATH-234"]);
  assert.deepEqual(run({ q: "calc feldman" }).ids, ["MATH-234"]);
  assert.deepEqual(run({ q: "physics" }).ids, ["PHYSICS-241"]);
  assert.equal(run({ q: "zzzz" }).total, 0);
});

test("words must start words, and may not span two instructors", () => {
  assert.deepEqual(run({ q: "anne frank" }).ids.sort(), ["GERMAN-325", "LITTRANS-326"]); // not ANTHRO 104 (two people)
  assert.equal(run({ q: "nne" }).total, 0); // not mid-word
});

test("filters: subject, level, breadth, gpa, now, lens", () => {
  assert.deepEqual(run({ subj: "MATH" }).ids, ["MATH-234"]);
  assert.deepEqual(run({ lvl: "2" }).ids.sort(), ["MATH-234", "PHYSICS-241"]);
  assert.deepEqual(run({ lvl: "5" }).ids.sort(), ["COMP-SCI-577", "SURGERY-699"]);
  assert.deepEqual(run({ br: "Natural Science" }).ids, ["MATH-234"]);
  assert.deepEqual(run({ br: "__es" }).ids, ["ASIAN-355"]);
  assert.deepEqual(run({ gpa: "3.5" }).ids.sort(), ["LITTRANS-326", "SURGERY-699"]);
  assert.equal(run({ now: "1" }).total, 6);
  assert.deepEqual(run({ lens: "open", sort: "en" }).ids, ["COMP-SCI-577", "COMP-SCI-300", "LITTRANS-326", "GERMAN-325"]);
  assert.deepEqual(run({ lens: "instr" }).ids, ["MATH-234"]);
});

test("GPA sorts ignore courses with fewer than 50 graded students", () => {
  const ids = run({ sort: "gpa" }).ids;
  assert.equal(ids[0], "LITTRANS-326");
  assert.ok(ids.indexOf("SURGERY-699") > ids.indexOf("MATH-234")); // n = 30 sinks
  assert.equal(run({ sort: "gpaL" }).ids[0], "MATH-234");
});

test("paging keeps the total", () => {
  const r = run({ limit: "2", offset: "1" });
  assert.equal(r.total, 9);
  assert.equal(r.ids.length, 2);
  assert.deepEqual(r.ids, run({}).ids.slice(1, 3));
  assert.ok(run({ limit: "9999" }).ids.length <= 60);
});

test("ids restricts the result and ignores unknown ids", () => {
  assert.deepEqual(run({ ids: "MATH-234,NOPE-1,GERMAN-325", sort: "code" }).ids, ["GERMAN-325", "MATH-234"]);
});

test("rows are slim; details are complete", () => {
  const row = run({ q: "cs 300" }).rows[0];
  assert.deepEqual(row.sk, [3.2, 3.3, 3.3, 3.4]);
  assert.equal(row.d, undefined);
  assert.equal(row.ins, undefined);
  assert.equal(JSON.parse(detail(ix, "COMP-SCI-300")).ins[0][0], "Ada Lovelace");
  assert.equal(detail(ix, "NOPE"), null);
  assert.equal(details(ix, ["MATH-234", "NOPE", "GERMAN-325"]).length, 2);
});

test("hidden chat counts stay hidden", () => {
  const row = run({ q: "cs 577" }).rows[0];
  assert.equal(row.ms, 1);
  assert.equal(row.m, undefined);
  const d = JSON.parse(detail(ix, "COMP-SCI-577"));
  assert.equal(d.m, 0);
  assert.equal(d.pos, undefined);
});

test("slim catalog records stay slim in details", () => {
  const d = JSON.parse(detail(ix, "ASIAN-355"));
  assert.equal(d.al, undefined);
  assert.equal(d.rd, undefined);
});

test("planData: facts, instructor GPA and meeting times by id or alias", () => {
  const all = JSON.parse(planData(ix, ["COMP-SCI-577", "NOPE", "E-C-E-300", "MATH-234", "COMP-SCI-300"])), out = all.courses;
  assert.deepEqual(Object.keys(out).sort(), ["COMP-SCI-300", "COMP-SCI-577", "MATH-234"]);  // alias and primary collapse to one key
  assert.deepEqual(all.map, { "E-C-E-300": "COMP-SCI-300" });
  assert.equal(out["COMP-SCI-577"].pk[0].s[0].m[0][0], "TR");
  assert.equal(out["COMP-SCI-577"].code, "COMP SCI 577");
  assert.deepEqual(out["COMP-SCI-300"].pk, []);
  assert.deepEqual(out["COMP-SCI-577"].ins[0], ["Grace Hopper", 2.9, 2000]);
  assert.deepEqual(JSON.parse(planData(ix, [])), { courses: {}, map: {} });
});

test("cross-listed designations resolve as ids", () => {
  assert.equal(detail(ix, "E-C-E-300") && JSON.parse(detail(ix, "E-C-E-300")).id, "COMP-SCI-300");
  assert.deepEqual(run({ ids: "E-C-E-300" }).ids, ["COMP-SCI-300"]);
});

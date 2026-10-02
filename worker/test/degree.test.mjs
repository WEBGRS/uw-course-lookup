import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseTranscript, statusOf, progress, candidatesFrom, blockCaps, prereqRisk } from "../../assets/js/planner/degree.js";
import { solve } from "../../assets/js/planner/schedule.js";

const SUBJ = ["COMP SCI", "MATH", "E C E", "STAT", "ECON", "MUSIC", "CHEM", "ASIAN", "PHYSICS"];

// Shaped like the Student Center unofficial transcript (credits, earned, grade)
const TRANSCRIPT = `
Course Description Attempted Earned Grade Points
CHEM 103 PEC General Chemistry I 4.000 4.000 BC 12.000
COMP SCI 220 NEC Data Sci Programming I 4.000 4.000 B
MATH 221 NIC r Calculus&Analytic Geometry 1 5.000 5.000 B 15.000
COMP SCI/MATH 240 NICx Intro to Discrete Mathematics 3.000 3.000 A 12.000
ECON 101 Principles-Microeconomics 3.000 3.000 T 0.000
MUSIC 113 HEC Music in Performance 1.000 1.000 F
COMP SCI 354 Machine Organization 3.000
Spring: advised to take COMP SCI 577 next
`;

test("transcript: passed, in progress, failed, cross-listings, noise", () => {
  const r = parseTranscript(TRANSCRIPT, SUBJ);
  assert.deepEqual(r.done.sort(), ["CHEM-103", "COMP-SCI-220", "COMP-SCI-240", "ECON-101", "MATH-221", "MATH-240"]);
  assert.deepEqual(r.ip, ["COMP-SCI-354"]);
  assert.deepEqual(r.failed, ["MUSIC-113"]);
  assert.ok(!r.done.includes("COMP-SCI-577"));          // a mention without credits is not a course taken
});

test("a retaken course that passed is not failed", () => {
  const r = parseTranscript("MUSIC 113 1.000 1.000 F\nMUSIC 113 1.000 1.000 A", SUBJ);
  assert.deepEqual(r.done, ["MUSIC-113"]);
  assert.deepEqual(r.failed, []);
});

test("a plain typed list counts everything it names", () => {
  const r = parseTranscript("cs 300, stats 240 and math 221; ece 252", ["COMP SCI", "STAT", "MATH", "E C E"]);
  assert.deepEqual(r.done.sort(), ["COMP-SCI-300", "E-C-E-252", "MATH-221", "STAT-240"]);
});

const PROGRAM = {
  blocks: [
    { h: "Math", rule: { t: "all" }, note: "", items: [{ o: [{ i: ["MATH-221"], t: "Calc 1", c: "5" }] }, { o: [{ i: ["MATH-222"], t: "Calc 2", c: "4" }] }] },
    { h: "Linear Algebra", rule: { t: "n", n: 1 }, note: "", items: [{ o: [{ i: ["MATH-320"], t: "LA+DE", c: "3" }] }, { o: [{ i: ["MATH-340"], t: "Matrix", c: "3" }] }] },
    { h: "Electives", rule: { t: "cr", c: 6 }, note: "", items: [{ o: [{ i: ["COMP-SCI-407"], t: "A", c: "3" }] }, { o: [{ i: ["COMP-SCI-412"], t: "B", c: "3" }] }, { o: [{ i: ["COMP-SCI-535"], t: "C", c: "3" }] }] },
    { h: "Notes", rule: { t: "info" }, note: "see advisor", items: [{ o: [{ i: ["ART-100"], t: "x", c: "3" }] }] },
  ],
};

test("status: rules count done vs planned and ignore info blocks", () => {
  const st = statusOf(PROGRAM, new Set(["MATH-221", "COMP-SCI-407"]), new Set(["MATH-340"]));
  assert.deepEqual(st.map((s) => [s.need, s.have, s.haveIp, s.met, s.planned]),
    [[2, 1, 1, false, false], [1, 0, 1, false, true], [6, 3, 3, false, false], [0, 0, 0, false, false]]);
  assert.deepEqual(progress(st), { total: 3, met: 0, planned: 1 });
});

test("candidates only come from unmet blocks, with caps and slots", () => {
  const st = statusOf(PROGRAM, new Set(["MATH-221"]), new Set(["MATH-340"]));
  const c = candidatesFrom(st);
  assert.deepEqual(c.map((x) => x.id).sort(), ["COMP-SCI-407", "COMP-SCI-412", "COMP-SCI-535", "MATH-222"]);
  assert.equal(c.find((x) => x.id === "MATH-222").weight, 3);
  assert.deepEqual(blockCaps(st), { b0: 1, b2: 2 });
});

test("pool slots and caps stop the solver from over-taking one requirement", () => {
  const pk = (id, d, s, e) => ({ id, st: "O", seats: 9, wait: 0, s: [{ t: "LEC", n: "1", m: [[d, s, e, ""]], i: [] }] });
  const pool = [
    { id: "MATH-320", code: "MATH 320", cr: "3", weight: 2, slot: "1.0", block: "b1", packages: [pk("a", "MWF", 540, 590)] },
    { id: "MATH-340", code: "MATH 340", cr: "3", weight: 2, slot: "1.0", block: "b1", packages: [pk("b", "TR", 540, 615)] },
    { id: "MATH-341", code: "MATH 341", cr: "3", weight: 2, slot: "1.1", block: "b1", packages: [pk("c", "TR", 700, 775)] },
  ];
  const r = solve({ must: [], pool, credits: [6, 9], caps: { b1: 1 } });
  assert.equal(r.schedules[0].picks.length, 1);                                    // cap of one course can never reach 6 credits
  assert.equal(r.schedules[0].short, 3);
  const r2 = solve({ must: [], pool, credits: [3, 9], caps: { b1: 1 } });
  assert.equal(r2.schedules[0].picks.length, 1);
  const r3 = solve({ must: [], pool, credits: [6, 9], caps: { b1: 2 } });
  const slots = r3.schedules[0].picks.map((p) => p.slot);
  assert.equal(new Set(slots).size, slots.length);        // 320 and 340 are the same slot: never both
});

test("prereq risk: flagged only when none of the named courses is taken", () => {
  assert.equal(prereqRisk("COMP SCI 300 or 301, MATH 221", SUBJ, new Set(["MATH-221"])), false);
  assert.equal(prereqRisk("COMP SCI 300 or 301, MATH 221", SUBJ, new Set()), true);
  assert.equal(prereqRisk("Sophomore standing", SUBJ, new Set()), false);
});

test("every shipped program parses into blocks the status code understands", { skip: !existsSync(new URL("../../assets/programs/index.json", import.meta.url)) }, () => {
  const idx = JSON.parse(readFileSync(new URL("../../assets/programs/index.json", import.meta.url), "utf8"));
  assert.ok(idx.length > 150);
  const cs = JSON.parse(readFileSync(new URL("../../assets/programs/computer-sciences-bs.json", import.meta.url), "utf8"));
  const st = statusOf(cs, new Set(["MATH-221", "COMP-SCI-240"]));
  assert.equal(st[0].items.find((x) => x.via).via.i[0], "MATH-221");
  assert.ok(candidatesFrom(st).some((c) => c.id === "COMP-SCI-300"));
  for (const e of idx) {
    const p = JSON.parse(readFileSync(new URL(`../../assets/programs/${e.id}.json`, import.meta.url), "utf8"));
    assert.ok(p.blocks.length > 0 && p.blocks.every((b) => b.items.length > 0 && b.items.every((i) => i.o.length && i.o[0].i.length)), e.id);
    statusOf(p, new Set(), new Set());
  }
});

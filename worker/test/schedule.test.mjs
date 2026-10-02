import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { prepPackage, packagesConflict, solve, swapOptions, describe } from "../../assets/js/planner/schedule.js";

// compact helpers: pk("TR", 840, 915) = one lecture package
const pk = (id, days, s, e, extra = {}) => ({ id, st: "O", seats: 10, wait: 0, s: [{ t: "LEC", n: "001", m: [[days, s, e, "Room"]], i: [] }], ...extra });
const course = (id, packages, extra = {}) => ({ id, code: id.replace(/-/g, " "), title: id, cr: "3", packages, ...extra });

test("conflicts: same day and overlapping minutes only", () => {
  const a = prepPackage(pk("a", "MWF", 540, 590), { id: "A" }), b = prepPackage(pk("b", "MW", 570, 645), { id: "B" });
  const c = prepPackage(pk("c", "TR", 540, 590), { id: "C" }), d = prepPackage(pk("d", "MWF", 590, 640), { id: "D" });
  assert.equal(packagesConflict(a, b), true);
  assert.equal(packagesConflict(a, c), false);
  assert.equal(packagesConflict(a, d), false);        // back to back is fine
  assert.equal(packagesConflict(a, d, 10), true);     // unless a buffer is wanted
});

test("half-term sections only clash when their dates overlap", () => {
  const first = prepPackage({ id: "1", st: "O", s: [{ t: "LEC", n: "1", m: [["M", 540, 590, ""]], w: [100, 150] }] }, { id: "X" });
  const second = prepPackage({ id: "2", st: "O", s: [{ t: "LEC", n: "1", m: [["M", 540, 590, ""]], w: [151, 200] }] }, { id: "Y" });
  const full = prepPackage(pk("3", "M", 540, 590), { id: "Z" });
  assert.equal(packagesConflict(first, second), false);
  assert.equal(packagesConflict(first, full), true);
});

test("solves a simple timetable and respects every clash", () => {
  const must = [
    course("A-1", [pk("a1", "MWF", 540, 590), pk("a2", "TR", 540, 615)]),
    course("B-1", [pk("b1", "MWF", 540, 590), pk("b2", "MWF", 660, 710)]),
  ];
  const r = solve({ must });
  assert.equal(r.ok, true);
  for (const s of r.schedules) assert.equal(packagesConflict(s.picks[0], s.picks[1]), false);
  assert.ok(r.schedules.length >= 1);
});

test("hard preferences: earliest start, days off, full sections", () => {
  const must = [course("A-1", [pk("early", "MWF", 480, 530), pk("late", "MWF", 600, 650), pk("fri", "F", 700, 750), pk("full", "TR", 700, 775, { st: "C", seats: 0 })])];
  const picked = (prefs) => solve({ must, prefs }).schedules.map((s) => s.picks[0].id).sort();
  assert.deepEqual(picked({ earliest: 540 }), ["fri", "late"]);
  assert.equal(solve({ must, prefs: { earliest: 540, daysOff: [4] } }).ok, false);   // both remaining options touch Friday
  assert.deepEqual(picked({ seats: "any" }).includes("full"), true);
  assert.deepEqual(picked({}).includes("full"), false);
});

test("explains an impossible request", () => {
  const same = [pk("x", "MWF", 540, 590)];
  const r = solve({ must: [course("A-1", same), course("B-1", same)] });
  assert.equal(r.ok, false);
  assert.equal(r.reasons[0].type, "clash");
  const none = solve({ must: [course("A-1", [pk("only", "MWF", 480, 530)])], prefs: { earliest: 600 } });
  assert.equal(none.reasons[0].type, "none");
  assert.equal(none.reasons[0].why, "early");
  const full = solve({ must: [course("A-1", [pk("only", "MWF", 480, 530, { st: "C", seats: 0 })])] });
  assert.equal(full.reasons[0].why, "full");
});

test("consent-only sections are never scheduled", () => {
  const r = solve({ must: [course("IND-1", [{ id: "i", st: "O", seats: 5, wait: 0, c: 1, on: 1, s: [{ t: "IND", n: "1", m: [], i: [] }] }])] });
  assert.equal(r.ok, false);
  assert.equal(r.reasons[0].why, "consent");
});

test("the pool fills the credit window with the best-weighted fitting courses", () => {
  const must = [course("A-1", [pk("a", "MWF", 540, 590)])];
  const pool = [
    course("E-1", [pk("e1", "MWF", 540, 590)], { weight: 3 }),     // clashes with the required course
    course("E-2", [pk("e2", "TR", 540, 615)], { weight: 1 }),
    course("E-3", [pk("e3", "TR", 700, 775)], { weight: 3 }),
    course("E-4", [pk("e4", "TR", 540, 615)], { weight: 2 }),
  ];
  const r = solve({ must, pool, credits: [9, 9] });
  assert.equal(r.ok, true);
  const ids = r.schedules[0].picks.map((p) => p.course).sort();
  assert.deepEqual(ids, ["A-1", "E-3", "E-4"]);
  assert.equal(r.schedules[0].credits, 9);
  const short = solve({ must, pool, credits: [30, 99] });          // unreachable target: best effort, flagged
  assert.equal(short.ok, true);
  assert.ok(short.schedules[0].short > 0);
  assert.equal(solve({ must, credits: [0, 2] }).reasons[0].type, "over");   // required courses alone exceed the ceiling
});

test("free-day preference moves classes together", () => {
  const must = [course("A-1", [pk("mon", "M", 600, 700), pk("tue", "T", 600, 700)]), course("B-1", [pk("mon2", "M", 800, 900), pk("tue2", "T", 800, 900)])];
  const r = solve({ must, prefs: { freeDays: 2 } });
  const days = new Set(r.schedules[0].picks.flatMap((p) => p.meets.map((m) => m.d)));
  assert.equal(days.size, 1);
  assert.equal(describe(r.schedules[0].picks).freeDays.length, 4);
});

test("swap options keep the rest of the timetable intact", () => {
  const a = course("A-1", [pk("a1", "MWF", 540, 590), pk("a2", "MWF", 660, 710), pk("a3", "TR", 540, 615)]);
  const b = course("B-1", [pk("b1", "MWF", 600, 650)]);
  const s = solve({ must: [a, b] }).schedules[0];
  const opts = swapOptions(s, "A-1", a);
  assert.ok(opts.every((o) => !packagesConflict(o, s.picks.find((p) => p.course === "B-1"))));
  assert.ok(opts.length >= 2);
});

const dataPath = new URL("../data.json", import.meta.url);
test("real data smoke test: a typical sophomore-year load", { skip: !existsSync(dataPath) }, () => {
  const data = JSON.parse(readFileSync(dataPath, "utf8"));
  const byId = new Map(data.courses.map((c) => [c.id, c]));
  const mk = (id) => ({ ...byId.get(id), packages: data.sections[id] || [] });
  const must = ["COMP-SCI-577", "COMP-SCI-540", "MATH-340"].filter((id) => data.sections[id]).map(mk);
  assert.ok(must.length >= 2);
  const t0 = Date.now();
  const r = solve({ must, prefs: { seats: "open+wait" } });
  assert.ok(Date.now() - t0 < 2000, "solver is fast");
  assert.equal(r.ok, true);
  for (const s of r.schedules) for (let i = 0; i < s.picks.length; i++) for (let j = i + 1; j < s.picks.length; j++) assert.equal(packagesConflict(s.picks[i], s.picks[j]), false);
});

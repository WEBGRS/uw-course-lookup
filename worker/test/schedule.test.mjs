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

test("explains the limit that is really to blame, not just the most common one", () => {
  const closed = (id, d, s, e) => pk(id, d, s, e, { st: "C", seats: 0 });
  // 7 sections are full; the 2 with seats all end after 3 pm
  const pks = [...Array.from({ length: 7 }, (_, i) => closed("c" + i, "TR", 780, 855)), pk("o1", "MWF", 900, 950), pk("o2", "TR", 930, 1005)];
  const r = solve({ must: [course("A-1", pks)], prefs: { latest: 900 } });
  assert.equal(r.reasons[0].why, "combo");
  // one kind of limit removes everything by itself
  assert.equal(solve({ must: [course("A-1", [closed("a", "M", 600, 650), closed("b", "T", 600, 650)])] }).reasons[0].why, "full");
  assert.equal(solve({ must: [course("A-1", [pk("a", "M", 600, 650, { st: "W" })])], prefs: { seats: "open" } }).reasons[0].why, "waitlist");
  assert.equal(solve({ must: [course("A-1", [pk("a", "M", 600, 650, { st: "W" }), closed("b", "T", 600, 650)])], prefs: { seats: "open" } }).reasons[0].why, "seats");
  assert.equal(solve({ must: [course("A-1", [pk("a", "MWF", 480, 530), pk("b", "TR", 500, 575)])], prefs: { earliest: 540 } }).reasons[0].why, "early");
  assert.equal(solve({ must: [course("A-1", [pk("a", "MWF", 480, 530), pk("b", "MW", 600, 650)])], prefs: { daysOff: [0, 2] } }).reasons[0].why, "dayoff");
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

test("overlap tolerance: short overlaps allowed, long ones not", () => {
  const a = prepPackage(pk("a", "MWF", 540, 600), { id: "A" }), b = prepPackage(pk("b", "MWF", 585, 645), { id: "B" });
  assert.equal(packagesConflict(a, b), true);
  assert.equal(packagesConflict(a, b, 0, 15), false);     // 15 minutes overlap
  assert.equal(packagesConflict(a, b, 0, 10), true);
  assert.equal(packagesConflict(a, b, 0, Infinity), false);
});

test("allow overlap: an otherwise impossible pair is solved, flagged, and ranked below clean ones", () => {
  const must = [course("A-1", [pk("a1", "MWF", 540, 600)]), course("B-1", [pk("b1", "MWF", 585, 645)])];
  assert.equal(solve({ must }).ok, false);
  const r = solve({ must, prefs: { overlap: 30 } });
  assert.equal(r.ok, true);
  assert.equal(r.schedules[0].overlapMin, 45);   // 15 minutes on each of three days
  const must2 = [course("A-1", [pk("a1", "MWF", 540, 600)]), course("B-1", [pk("clash", "MWF", 585, 645), pk("clean", "TR", 585, 645)])];
  assert.equal(solve({ must: must2, prefs: { overlap: 30 } }).schedules[0].picks.find((p) => p.course === "B-1").id, "clean");
});

test("max days on campus is a hard limit", () => {
  const must = [course("A-1", [pk("a1", "MW", 540, 590)]), course("B-1", [pk("b1", "TR", 540, 590), pk("b2", "MW", 600, 650)])];
  const days = solve({ must, prefs: { maxDays: 2 } });
  assert.equal(days.ok, true);
  assert.ok(days.schedules.every((s) => s.daysUsed.length <= 2));
  assert.deepEqual(days.schedules.map((s) => s.picks.find((p) => p.course === "B-1").id), ["b2"]);
  const none = solve({ must: [course("A-1", [pk("a1", "MW", 540, 590)]), course("B-1", [pk("b1", "TR", 540, 590)])], prefs: { maxDays: 3 } });
  assert.equal(none.ok, false);
  assert.equal(none.reasons[0].type, "days");
});

test("in-person only drops sections without a meeting time", () => {
  const online = { id: "on", st: "O", seats: 5, s: [{ t: "LEC", n: "001", m: [], i: [] }] };
  const must = [course("A-1", [online, pk("a1", "MWF", 540, 590)])];
  assert.deepEqual(solve({ must, prefs: { format: "inperson" } }).schedules.map((s) => s.picks[0].id), ["a1"]);
  const only = solve({ must: [course("A-1", [online])], prefs: { format: "inperson" } });
  assert.equal(only.ok, false);
  assert.equal(only.reasons[0].why, "online");
});

test("lunch preference moves classes out of 11:30-1:00", () => {
  const must = [course("A-1", [pk("noon", "MWF", 700, 750), pk("early", "MWF", 540, 590)])];
  assert.equal(solve({ must, prefs: { lunch: 1, start: 0, end: 1440 } }).schedules[0].picks[0].id, "early");
});

test("passing time keeps classes apart", () => {
  const must = [course("A-1", [pk("a1", "MWF", 540, 590)]), course("B-1", [pk("tight", "MWF", 590, 640), pk("loose", "MWF", 610, 660)])];
  assert.equal(solve({ must, prefs: { buffer: 15, freeDays: 0, compact: 0 } }).schedules[0].picks.find((p) => p.course === "B-1").id, "loose");
});

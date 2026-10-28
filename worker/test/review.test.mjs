// Fixes ported from the mini program's second review (2026-10-24). Fixture tests always run; the real-data
// tests run where worker/data.json exists (it is private and not in the repository).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildIndex, query, planData } from "../src/engine.js";

const fixture = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const ix = buildIndex(JSON.parse(JSON.stringify(fixture)));
const run = (o, x = ix) => {
  const r = query(x, new URLSearchParams(o));
  return { total: r.total, ids: r.rows.map((s) => JSON.parse(s).id), rows: r.rows.map((s) => JSON.parse(s)) };
};

const dataPath = new URL("../data.json", import.meta.url);
const REAL = existsSync(dataPath);
let real = null;
const R = () => {
  if (!real) {
    const data = JSON.parse(readFileSync(dataPath, "utf8"));
    real = { data, ix: buildIndex(JSON.parse(JSON.stringify(data))), byId: new Map(data.courses.map((c) => [c.id, c])) };
  }
  return real;
};
const every = (o) => {
  const out = [];
  for (let off = 0; ; off += 60) {
    const r = run({ ...o, offset: String(off) }, R().ix);
    out.push(...r.rows);
    if (off + 60 >= r.total) return out;
  }
};
const prefix = (code) => code.replace(/\s*\d[\w]*$/, "");

test("subject filter: a cross-listed course appears under each of its subjects", () => {
  assert.deepEqual(run({ subj: "E C E" }).ids, ["COMP-SCI-300"]);
  assert.deepEqual(run({ subj: "COMP SCI", sort: "code" }).ids, ["COMP-SCI-300", "COMP-SCI-577"]);
});

test("subject filter on real data: every designation counts (MATH lists COMP SCI 240)", { skip: !REAL }, () => {
  const { data } = R();
  const math = every({ subj: "MATH" }).map((r) => r.id);
  assert.ok(math.includes("COMP-SCI-240"));
  const want = data.courses.filter((c) => [c.code, ...(c.al || [])].some((x) => prefix(x) === "MATH")).length;
  assert.equal(math.length, want);
  const primary = data.courses.filter((c) => c.sa === "MATH").length;
  assert.ok(primary < want, "positive control: some MATH listings are cross-listings of another subject");
});

// A copy of the fixture with a few extra records for the sample-size rules
function withExtra(extra) {
  const d = JSON.parse(JSON.stringify(fixture));
  const base = d.courses.find((c) => c.id === "PHYSICS-241");
  for (const [id, o] of Object.entries(extra)) d.courses.push({ ...JSON.parse(JSON.stringify(base)), id, code: id.replace(/-/g, " "), ...o });
  return buildIndex(d);
}

test("GPA and A-share sorts: small samples and independent study rank last", () => {
  const x = withExtra({
    "BIG-1": { t: "Big course", n: 900, gpa: 3.5, gs: 3.5, pa: 0.5 },
    "TINY-1": { t: "Tiny course", n: 4, gpa: 4.0, gs: 3.4, pa: 1 },
    "IND-699": { t: "Independent Study", n: 600, gpa: 3.99, gs: 3.98, pa: 0.99, num: 699 },
    "DIR-1": { t: "Directed Reading in Botany", n: 300, gpa: 3.95, gs: 3.9, pa: 0.97 },
  });
  const gpa = run({ sort: "gpa" }, x).ids, pa = run({ sort: "pa" }, x).ids;
  assert.equal(pa[0], "LITTRANS-326", "its 60% A comes from the distribution");
  for (const ids of [gpa, pa]) {
    for (const low of ["TINY-1", "IND-699", "DIR-1"]) assert.ok(ids.indexOf(low) > ids.indexOf("BIG-1"), low);
  }
  assert.ok(pa.indexOf("TINY-1") > pa.indexOf("COMP-SCI-300"), "a 4-student 100% A sits below a 900-student 34%");
});

test("minimum GPA filter needs 30 graded students; undergraduate level is below 500", () => {
  const x = withExtra({ "TINY-2": { n: 6, gpa: 3.95, gs: 3.4 }, "OK-2": { n: 31, gpa: 3.9, gs: 3.6 } });
  const ids = run({ gpa: "3.5" }, x).ids;
  assert.ok(ids.includes("OK-2") && !ids.includes("TINY-2"));
  const u = run({ lvl: "u" }).rows;
  assert.equal(u.length, fixture.courses.filter((c) => c.num < 500).length);
  assert.ok(u.every((r) => r.num < 500));
});

test("real data: no tiny samples or independent study at the top of the GPA and A-share sorts", { skip: !REAL }, () => {
  const { byId } = R();
  const indep = /^(independent|directed)\b|\b(independent study|directed study|independent reading)\b/i;
  for (const sort of ["gpa", "pa"]) {
    const rows = run({ sort, now: "1" }, R().ix).rows;
    assert.ok(rows.every((r) => byId.get(r.id).n >= 50), sort + ": top 60 have 50+ graded students");
    assert.ok(!rows.some((r) => indep.test(r.t)), sort + ": no independent study in the top 60");
  }
  const thin = every({ now: "1" }).filter((r) => r.gpa >= 3.7 && (r.n || 0) < 30);
  assert.ok(thin.length > 0, "positive control: offered courses with a 3.7+ GPA from under 30 students exist");
  const pass = every({ gpa: "3.7", now: "1" });
  assert.ok(pass.length > 0 && pass.every((r) => r.n >= 30 && r.gpa >= 3.7));
  const u = run({ lvl: "u", now: "1" }, R().ix);
  assert.equal(u.total, R().data.courses.filter((c) => c.now && c.num < 500).length);
});

test("the planner gets the GPA the course page shows, not the adjusted one", () => {
  const x = withExtra({ "SMALL-152": { n: 6, gpa: 1.67, gs: 3.37 } });
  assert.equal(JSON.parse(planData(x, ["SMALL-152"])).courses["SMALL-152"].gpa, 1.67);
});

test("real data: planner GPA equals the course page GPA for every offered course", { skip: !REAL }, () => {
  const { data } = R();
  const off = data.courses.filter((c) => c.now && c.gpa != null);
  assert.ok(off.filter((c) => c.gs != null && Math.abs(c.gs - c.gpa) >= 0.1).length > 500, "positive control: adjusted and course GPA differ often");
  const got = JSON.parse(planData(R().ix, off.slice(0, 40).map((c) => c.id))).courses;
  for (const c of off.slice(0, 40)) assert.equal(got[c.id].gpa, c.gpa, c.code);
});

test("no A or no D/F reads as 0, not as missing", async () => {
  const { shares } = await import("../../assets/js/facts.js");
  assert.deepEqual(shares({ dist: [0, 5, 5, 0, 0, 0, 0] }), { pa: 0, pdf: 0 });
  assert.deepEqual(shares({ dist: [3, 1, 0, 0, 0, 0, 0], pa: 0.75 }), { pa: 0.75, pdf: 0 });
  assert.deepEqual(shares({ dist: [0, 0, 0, 0, 0, 0, 0] }), { pa: null, pdf: null }, "S/U only: no letter grades");
  assert.deepEqual(shares({}), { pa: null, pdf: null });
  const x = withExtra({ "NOA-1": { dist: [0, 4, 6, 0, 0, 0, 0], pa: undefined, n: 10 } });
  assert.equal(run({ ids: "NOA-1" }, x).rows[0].pa, 0);
});

test("real data: every graded course has an A share and a D/F share", { skip: !REAL }, async () => {
  const { shares } = await import("../../assets/js/facts.js");
  const graded = R().data.courses.filter((c) => c.dist && c.dist.some((v) => v > 0));
  assert.ok(graded.filter((c) => c.pdf == null).length > 1000, "positive control: the export leaves D/F out when it is zero");
  assert.ok(graded.every((c) => { const s = shares(c); return s.pa != null && s.pdf != null; }));
});

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

test("rows carry the number their sort ranks by", async () => {
  const { sortValue } = await import("../../assets/js/facts.js");
  assert.deepEqual(sortValue({ en: 0, sz: 1438 }, "en"), ["svSz", 1438]);
  assert.deepEqual(sortValue({ en: 400, sz: 1438 }, "en"), ["svEn", 400]);
  assert.deepEqual(sortValue({ m: 0, ms: 1, rdn: 3 }, "m"), ["chatFew", 0]);
  assert.deepEqual(sortValue({ m: 12 }, "m"), ["chat", 12]);
  assert.deepEqual(sortValue({ gs: 3.81, n: 900 }, "gpa"), ["svGpa", 3.81]);
  assert.equal(sortValue({ gs: 3.81, n: 9 }, "gpa"), null);
  assert.equal(sortValue({ en: 4 }, "code"), null);
  assert.equal(run({ q: "cs 577" }).rows[0].en, 419);
});

test("real data: the size sort before registration opens ranks by last term and every row says so", { skip: !REAL }, async () => {
  const { sortValue } = await import("../../assets/js/facts.js");
  const rows = run({ sort: "en", now: "1" }, R().ix).rows;
  assert.ok(rows.length === 60);
  assert.ok(rows.every((r) => sortValue(r, "en")), "every row shows a size");
  if (rows.every((r) => !r.en)) assert.ok(rows.every((r) => sortValue(r, "en")[0] === "svSz"), "no enrollment yet: last term's size");
  assert.ok(run({ sort: "m", now: "1" }, R().ix).rows.slice(0, 20).every((r) => sortValue(r, "m")));
});

test("instructor names: nicknames match, a surname alone does not", async () => {
  const { sameName, historyOf } = await import("../../assets/js/facts.js");
  assert.ok(sameName("Thomas Curry", "Tom Curry"));
  assert.ok(sameName("Grzegorz Pac", "Gregory Pac"));
  assert.ok(sameName("Matthew Bowman", "Matt Bowman"));
  assert.ok(sameName("Ada Lovelace", "ADA LOVELACE"));
  assert.ok(!sameName("Hezi Zhang", "Ziyi Zhang"));
  assert.ok(!sameName("Thomas Curry", "Tom Smith"));
  const ins = [["Thomas Curry", 3.5, 400, 0.5, 1262, 0], ["Ada Lovelace", 3.1, 90, 0.3, 1262, 1]];
  assert.equal(historyOf(ins, "Tom Curry")[1], 3.5);
  assert.equal(historyOf(ins, "Ziyi Lovelace"), null);
});

test("instructors with identical numbers merge into one row; a nickname match marks them as teaching now", async () => {
  const { mergeInstructors } = await import("../../assets/js/facts.js");
  const ins = [["Prof A", 3.2, 500, 0.3, 1262, 1], ["Ta One", 3.0, 120, 0.2, 1254, 0], ["Ta Two", 3.0, 120, 0.2, 1254, 0], ["Thomas Curry", 3.5, 40, 0.5, 1262, 0]];
  const g = mergeInstructors(ins, ["Tom Curry"]);
  assert.equal(g.length, 3);
  assert.deepEqual(g[1].people.map((p) => p.name), ["Ta One", "Ta Two"]);
  assert.equal(g[2].people[0].now, true, "Tom Curry teaches now, recorded as Thomas Curry");
  assert.equal(g[0].people[0].now, true);
});

test("real data: nickname matches and merged instructor rows", { skip: !REAL }, async () => {
  const { sameName, historyOf, mergeInstructors } = await import("../../assets/js/facts.js");
  const old = (a, b) => { const pa = a.toUpperCase().split(/\s+/), pb = b.toUpperCase().split(/\s+/); return pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1]; };
  let nick = 0, extra = 0;
  for (const c of R().data.courses) {
    const ins = c.ins || [];
    for (const n of (c.now && c.now.who) || []) if (!ins.some((i) => i[5] && old(i[0], n)) && historyOf(ins, n)) nick++;
    extra += ins.length - mergeInstructors(ins).length;
  }
  assert.ok(nick > 100, "instructors found only through a nickname: " + nick);
  assert.ok(extra > 1000, "rows merged: " + extra);
  const cs577 = R().byId.get("COMP-SCI-577");
  assert.ok(mergeInstructors(cs577.ins).length < cs577.ins.length, "positive control: COMP SCI 577 has repeated rows");
  assert.ok(sameName("Jim Williams", "James Williams"));
});

test("course page: the lecture count is the lectures listed", async () => {
  const { lectureGroups } = await import("../../assets/js/facts.js");
  assert.equal(lectureGroups(fixture.sections["COMP-SCI-577"]).length, 1);
  assert.equal(lectureGroups([]).length, 0);
  if (!REAL) return;
  const { data, byId } = R();
  const g = lectureGroups(data.sections["COMP-SCI-577"]);
  assert.ok(byId.get("COMP-SCI-577").now.lec > g.length, "positive control: the export counts more lectures than it lists");
  let differ = 0;
  for (const c of data.courses) if (c.now && data.sections[c.id] && lectureGroups(data.sections[c.id]).length !== c.now.lec) differ++;
  assert.ok(differ > 100, String(differ));
});

test("a near-zero GPA trend is flat, not -0.00", async () => {
  const { isFlat } = await import("../../assets/js/facts.js");
  assert.ok(isFlat(-0.004) && isFlat(0.004) && isFlat(0));
  assert.ok(!isFlat(-0.031) && !isFlat(0.005));
  if (!REAL) return;
  const near = R().data.courses.filter((c) => c.tr != null && c.tr < 0 && c.tr.toFixed(2) === "-0.00");
  assert.ok(near.length > 100 && near.every((c) => isFlat(c.tr)), "courses that used to read -0.00/yr: " + near.length);
});

test("shorthand: cs is COMP SCI only; ai and ml are topics", () => {
  const x = withExtra({
    "CS&D-210": { code: "CS&D 210", sa: "CS&D", t: "Speech Science", num: 210 },
    "COMP-SCI-540": { code: "COMP SCI 540", sa: "COMP SCI", t: "Introduction to Artificial Intelligence", num: 540 },
    "ENVIR-ST-301": { code: "ENVIR ST 301", sa: "ENVIR ST", t: "Air Pollution", num: 301 },
    "STAT-451": { code: "STAT 451", sa: "STAT", t: "Introduction to Machine Learning and Statistical Pattern Classification", num: 451 },
  });
  assert.deepEqual(run({ q: "cs", sort: "code" }, x).ids, ["COMP-SCI-300", "COMP-SCI-540", "COMP-SCI-577"]);
  assert.deepEqual(run({ q: "cs&d" }, x).ids, ["CS&D-210"], "the other subject is still one search away");
  assert.deepEqual(run({ q: "ai" }, x).ids, ["COMP-SCI-540"]);
  assert.deepEqual(run({ q: "ml" }, x).ids, ["STAT-451"]);
  assert.deepEqual(run({ q: "cs 577" }, x).ids, ["COMP-SCI-577"]);
});

test("real data: cs, ai and ml", { skip: !REAL }, () => {
  const cs = every({ q: "cs" });
  assert.ok(cs.length > 50 && cs.every((r) => [r.code, ...(r.al || [])].some((x) => x.startsWith("COMP SCI "))));
  const ai = every({ q: "ai" });
  assert.ok(ai.some((r) => r.id === "COMP-SCI-540"));
  assert.ok(!ai.some((r) => /^A F AERO/.test(r.code)));
  assert.ok(every({ q: "ml" }).some((r) => /machine learning/i.test(r.t)));
  assert.equal(run({ q: "cs 577" }, R().ix).rows[0].id, "COMP-SCI-577");
});

test("'In schedule' lists every saved course, offered this term or not", async () => {
  const { listParams } = await import("../../assets/js/zh-terms.js");
  const st = { q: "", sort: "code", subj: "", lvl: "", br: "", gpa: "", now: true };
  assert.equal(listParams(st, null).p.now, "1");
  const { p } = listParams(st, ["COMP-SCI-577", "PHYSICS-241"]);
  assert.equal(p.now, undefined);
  assert.deepEqual(run(p).ids, ["COMP-SCI-577", "PHYSICS-241"]);
  assert.deepEqual(run({ ...p, now: "1" }).ids, ["COMP-SCI-577"], "positive control: the term filter hid PHYSICS 241");
});

test("transcript: DARS 'SELECT FROM' and 'NEEDS' lists are not courses taken", async () => {
  const { parseTranscript, dropOptionLists } = await import("../../assets/js/planner/degree.js");
  const SUBJ = ["COMP SCI", "MATH", "STAT"];
  const dars = "NEEDS: 1 COURSE\nSELECT FROM: MATH 340, MATH 341, MATH 375\nEARNED: 12.00 CREDITS\nFA24 COMP SCI 300 PROGRAMMING II 3.00 A";
  const raw = parseTranscript(dars.replace(/SELECT FROM:/, "").replace(/NEEDS:/, ""), SUBJ);
  assert.ok(raw.ip.includes("MATH-375"), "positive control: without the fix the list reads as in progress");
  const r = parseTranscript(dars, SUBJ);
  assert.deepEqual(r.done, ["COMP-SCI-300"]);
  assert.deepEqual(r.ip, []);
  const wrapped = "  NEEDS: 2 COURSES\n  SELECT FROM: COMP SCI 400 407\n     MATH 421 431\n  FA23 MATH 340 LINEAR ALGEBRA 3.00 A\nSP25 STAT 340 DATA SCIENCE 4.00";
  const w = parseTranscript(wrapped, SUBJ);
  assert.deepEqual(w.done, ["MATH-340"]);
  assert.deepEqual(w.ip, ["STAT-340"]);
  assert.equal(dropOptionLists("A\n\nB"), "A\n\nB");
});

test("compare: pick which saved courses, two to eight", async () => {
  const { togglePick } = await import("../../assets/js/facts.js");
  const eight = ["A", "B", "C", "D", "E", "F", "G", "H"];
  assert.deepEqual(togglePick(eight, "I"), eight, "a ninth waits until one is removed");
  assert.deepEqual(togglePick(eight, "A"), eight.slice(1));
  assert.deepEqual(togglePick(eight.slice(1), "I"), [...eight.slice(1), "I"]);
  assert.deepEqual(togglePick(["A", "B"], "A"), ["A", "B"], "never fewer than two");
});

test("program search takes Chinese and shorthand", async () => {
  const { programMatch } = await import("../../assets/js/zh-terms.js");
  const index = JSON.parse(readFileSync(new URL("../../assets/programs/index.json", import.meta.url), "utf8"));
  const find = (q) => index.filter((p) => programMatch(p.name, q)).map((p) => p.id);
  assert.equal(index.filter((p) => p.name.toLowerCase().includes("计算机")).length, 0, "positive control: plain substring search finds nothing");
  for (const [q, want] of [["计算机", "computer-sciences-bs"], ["统计", "statistics-bs"], ["cs", "computer-sciences-bs"], ["stats", "statistics-bs"], ["数据科学", "data-science-bs"], ["computer sci", "computer-sciences-bs"], ["Economics, BA", "economics-ba"]]) {
    assert.ok(find(q).includes(want), q);
  }
  assert.ok(!find("cs").includes("economics-ba"), "cs is not every name with c-s in it");
  assert.deepEqual(find("量子烹饪"), []);
});

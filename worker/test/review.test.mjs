// Fixes ported from the mini program's second review (2026-10-24). Fixture tests always run; the real-data
// tests run where worker/data.json exists (it is private and not in the repository).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildIndex, query } from "../src/engine.js";

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

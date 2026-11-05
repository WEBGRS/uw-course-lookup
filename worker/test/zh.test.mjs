// Chinese search: the page rewrites a Chinese query (assets/js/zh-terms.js) before it asks the API.
// Real-data tests run where worker/data.json exists.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildIndex, query } from "../src/engine.js";
import { rewrite, zhParams, listParams, terms, courses } from "../../assets/js/zh-terms.js";

const dataPath = new URL("../data.json", import.meta.url);
const REAL = existsSync(dataPath);
let real = null;
const R = () => (real ||= (() => { const data = JSON.parse(readFileSync(dataPath, "utf8")); return { data, ix: buildIndex(JSON.parse(JSON.stringify(data))) }; })());

// What the course list sends for a query, as courses.js builds it
function search(q, extra = {}, mine = null) {
  const { p: base, zh } = listParams({ q, sort: "m" }, mine), p = { ...base, ...extra };
  if (zh && !zh.q && !zh.lens && !zh.ids && !zh.br) return { total: 0, rows: [], zh };
  const r = query(R().ix, new URLSearchParams(p));
  return { total: r.total, rows: r.rows.map((s) => JSON.parse(s)), zh };
}

test("rewrite: words, lenses, breadths, misses and filler", () => {
  assert.equal(rewrite("comp sci 577"), null, "no Chinese: untouched");
  assert.equal(rewrite("计算机 577").q, "computer sciences 577");
  assert.equal(rewrite("水课").lens, "easy");
  assert.equal(rewrite("人文").br, "Humanities");
  assert.equal(rewrite("量子烹饪").miss, "量子烹饪");
  const v = rewrite("推荐课");
  assert.ok(!v.q && !v.miss && !v.lens, "only filler words: vague");
  assert.deepEqual(zhParams(rewrite("数据结构"), ["MATH-221"]), { ids: "-" });
  assert.deepEqual(zhParams(rewrite("数据结构"), ["COMP-SCI-300", "MATH-221"]), { ids: "COMP-SCI-300" });
});

test("real data: every term finds courses, the same ones as its English words", { skip: !REAL }, () => {
  for (const [zh, val] of Object.entries(terms)) {
    const [en, shown] = val.split("|");
    const a = search(zh), b = query(R().ix, new URLSearchParams({ q: en }));
    assert.ok(a.total > 0, `${zh} -> ${en}: no courses`);
    assert.equal(a.total, b.total, zh);
    if (shown) assert.ok(shown.toLowerCase().startsWith(en), `${zh}: "${shown}" is not a form of "${en}"`);
  }
  const ids = new Set(R().data.courses.map((c) => c.id));
  for (const [zh, list] of Object.entries(courses)) for (const id of list) assert.ok(ids.has(id), `${zh}: ${id}`);
});

test("real data: a Chinese query no longer lists every course", { skip: !REAL }, () => {
  const all = query(R().ix, new URLSearchParams({})).total;
  assert.equal(query(R().ix, new URLSearchParams({ q: "数据结构" })).total, all, "positive control: the engine alone ignores Chinese");
  assert.deepEqual(search("数据结构", { sort: "code" }).rows.map((r) => r.id), ["COMP-SCI-300", "COMP-SCI-400"]);
  assert.equal(search("计算机 577", { sort: "code" }).rows[0].id, "COMP-SCI-577");
  assert.ok(search("math 线性代数").rows.some((r) => r.id === "MATH-340"));
  const easy = search("水课", { limit: "60" });
  const byId = new Map(R().data.courses.map((c) => [c.id, c]));
  assert.ok(easy.total > 0 && easy.rows.every((r) => byId.get(r.id).num < 500 && byId.get(r.id).n >= 500), "水课: undergraduate, 500+ graded");
  const hum = search("人文", { now: "1" });
  assert.ok(hum.total > 0 && hum.rows.every((r) => byId.get(r.id).br.includes("Humanities")));
  assert.equal(search("推荐").total, 0);
  assert.equal(search("量子烹饪").total, 0);
  const part = search("统计 区块链");
  assert.ok(part.total > 0 && part.zh.miss === "区块链");
});

test("real data: sample queries a Chinese-speaking student would type", { skip: !REAL }, () => {
  const SAMPLE = ["微积分", "线性代数", "统计", "计算机", "计算机 577", "算法", "数据结构", "机器学习", "人工智能", "经济学", "宏观经济",
    "微观经济学", "会计", "金融", "心理学", "心理学入门", "有机化学", "普化", "物理", "生物", "天文", "中文", "日语", "西班牙语", "历史",
    "哲学", "政治", "社会学", "音乐", "艺术史", "电影", "写作", "水课", "统计水课", "数据科学", "编程入门", "概率", "离散数学", "营养",
    "有空位的统计课", "普物", "高数", "概率论", "大一"];
  const missed = SAMPLE.filter((q) => { const r = search(q, { limit: "1" }); return !(r.total > 0 && !r.zh.miss); });
  assert.deepEqual(missed, []);
});

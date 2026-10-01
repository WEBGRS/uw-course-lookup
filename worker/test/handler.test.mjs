import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHandler } from "../src/handler.js";

const data = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const OK = { Origin: "https://webgrs.github.io" };
const get = (h, path, headers = OK, env = {}) => h(new Request("https://api.test" + path, { headers }), env);

test("health needs no origin; data routes do", async () => {
  const h = createHandler(data);
  assert.equal((await get(h, "/api/health", {})).status, 200);
  assert.equal((await get(h, "/api/meta", {})).status, 403);
  assert.equal((await get(h, "/api/meta", { Origin: "https://evil.example" })).status, 403);
  assert.equal((await get(h, "/api/meta", { "Sec-Fetch-Site": "same-origin" })).status, 200);
  assert.equal((await get(h, "/api/meta", { Origin: "http://localhost:8787" })).status, 200);
});

test("CORS header echoes only allowed origins; headers are safe", async () => {
  const h = createHandler(data);
  const r = await get(h, "/api/meta");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://webgrs.github.io");
  assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(r.headers.get("Cache-Control"), /max-age=300/);
  const bad = await get(h, "/api/meta", { Origin: "https://evil.example" });
  assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await h(new Request("https://api.test/api/meta", { method: "OPTIONS", headers: OK }))).status, 204);
  assert.equal((await h(new Request("https://api.test/api/meta", { method: "POST", headers: OK }))).status, 405);
});

test("courses, course and compare routes", async () => {
  const h = createHandler(data);
  const list = await (await get(h, "/api/courses?q=calculus%20234")).json();
  assert.equal(list.total, 1);
  assert.equal(list.rows[0].id, "MATH-234");
  assert.equal((await (await get(h, "/api/course/COMP-SCI-577")).json()).code, "COMP SCI 577");
  assert.equal((await get(h, "/api/course/NOPE")).status, 404);
  assert.equal((await get(h, "/api/course/%E0%A4%A")).status, 400);
  assert.equal((await (await get(h, "/api/compare?ids=MATH-234,COMP-SCI-577")).json()).courses.length, 2);
  assert.equal((await get(h, "/api/nothing")).status, 404);
  assert.equal((await get(h, "/")).status, 404);
});

test("in-memory limiter caps one client's detail requests", async () => {
  const h = createHandler(data);
  const hdr = { ...OK, "CF-Connecting-IP": "203.0.113.9" };
  let last;
  for (let i = 0; i < 61; i++) last = await get(h, "/api/course/MATH-234", hdr);
  assert.equal(last.status, 429);
  assert.equal(last.headers.get("Retry-After"), "10");
  assert.equal((await get(h, "/api/course/MATH-234", { ...OK, "CF-Connecting-IP": "203.0.113.10" })).status, 200);
});

test("the Workers rate-limit binding is honoured", async () => {
  const h = createHandler(data);
  const deny = { limit: async () => ({ success: false }) };
  const allow = { limit: async () => ({ success: true }) };
  assert.equal((await get(h, "/api/courses", OK, { RL_LIST: deny, RL_DETAIL: allow })).status, 429);
  assert.equal((await get(h, "/api/course/MATH-234", OK, { RL_LIST: deny, RL_DETAIL: allow })).status, 200);
});

// Reviews and asks through the real handler, guard and an in-memory SQLite standing in for D1.  Run: node --test test/reviews.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHandler } from "../src/handler.js";

const data = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
// Same tables as webgrs-guard/schema.sql (events, sessions, blocked, reviews, review_asks)
const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  site TEXT NOT NULL,
  ts INTEGER NOT NULL,          -- ms since epoch
  day TEXT NOT NULL,            -- UTC date, for quotas
  sid TEXT,                     -- session id from the signed token
  ip_h TEXT,                    -- salted hash of the client IP
  country TEXT,
  kind TEXT NOT NULL,           -- search / detail / ui / session ...
  item TEXT,                    -- the record asked for, when there is one
  q TEXT,                       -- compact JSON of the query
  status INTEGER,
  n INTEGER NOT NULL DEFAULT 1  -- records returned (quotas add these up)
);
CREATE INDEX IF NOT EXISTS ev_quota_sid ON events(site, day, kind, sid);
CREATE INDEX IF NOT EXISTS ev_quota_ip ON events(site, day, kind, ip_h);
CREATE INDEX IF NOT EXISTS ev_site_ts ON events(site, ts);
CREATE TABLE IF NOT EXISTS sessions (
  site TEXT NOT NULL,
  sid TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ip_h TEXT,
  country TEXT,
  ua TEXT,
  human INTEGER,
  PRIMARY KEY (site, sid)
);
CREATE TABLE IF NOT EXISTS blocked (
  site TEXT NOT NULL,           -- a site name, or * for all
  key TEXT NOT NULL,            -- session id or IP hash
  kind TEXT NOT NULL,           -- sid / ip
  reason TEXT,
  ts INTEGER NOT NULL,
  PRIMARY KEY (site, key)
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course TEXT NOT NULL,
  instr TEXT,
  hours INTEGER,                -- bucket 0..4 of weekly hours outside class
  attend INTEGER,               -- 1 attendance required, 0 not
  tags TEXT,                    -- comma-separated grading parts
  text TEXT,
  dev_h TEXT NOT NULL,          -- hashed device id
  ip_h TEXT,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | ok | hidden
  UNIQUE (course, dev_h)
);
CREATE INDEX IF NOT EXISTS rv_course ON reviews(course, status);
CREATE INDEX IF NOT EXISTS rv_status ON reviews(status, ts);
CREATE TABLE IF NOT EXISTS review_asks (
  course TEXT NOT NULL,
  dev_h TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (course, dev_h)
);
`;
const ORIGIN = { Origin: "https://webgrs.github.io" };
const DEV_A = "a".repeat(22), DEV_B = "b".repeat(22);

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes }, changes: r.changes }; },
  });
  return { prepare: (sql) => stmt(sql), batch: async (l) => Promise.all(l.map((s) => s.run())), raw: db };
}
const setup = () => ({ h: createHandler(data, { reviewsHtml: "<p>reviews</p>" }), env: { DB: fakeD1(), SESSION_KEY: "k", ADMIN_TOKEN: "adm" } });

async function session(h, env, ip) {
  const r = await h(new Request("https://api.test/api/session", { method: "POST", headers: { ...ORIGIN, "CF-Connecting-IP": ip, "Content-Type": "application/json" }, body: "{}" }), env);
  return (await r.json()).token;
}
async function call(h, env, tok, path, { method = "GET", body, ip = "9.9.9.9" } = {}) {
  const r = await h(new Request("https://api.test" + path, { method, headers: { ...ORIGIN, "CF-Connecting-IP": ip, "X-Session": tok, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, body: await r.json() };
}
const adm = async (h, env, path, body, auth = "adm") => {
  const r = await h(new Request("https://api.test" + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + auth, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, body: await r.json() };
};

test("a review needs a session; no login", async () => {
  const { h, env } = setup();
  const r = await h(new Request("https://api.test/api/review", { method: "POST", headers: ORIGIN, body: JSON.stringify({ course: "MATH-234", dev: DEV_A, hours: 2 }) }), env);
  assert.equal(r.status, 401);
  const tok = await session(h, env, "1.1.1.1");
  const ok = await call(h, env, tok, "/api/review", { method: "POST", body: { course: "MATH-234", dev: DEV_A, hours: 2 } });
  assert.equal(ok.status, 200);
});

test("one review per device and course", async () => {
  const { h, env } = setup();
  const tok = await session(h, env, "1.1.1.1");
  const post = (course, dev, extra = {}) => call(h, env, tok, "/api/review", { method: "POST", body: { course, dev, hours: 1, ...extra } });
  assert.equal((await post("MATH-234", DEV_A)).status, 200);
  const dup = await post("MATH-234", DEV_A, { hours: 4 });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, "dup");
  assert.equal((await post("COMP-SCI-300", DEV_A)).status, 200, "same device, other course");
  assert.equal((await post("MATH-234", DEV_B)).status, 200, "other device, same course");
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM reviews").get().n, 3);
});

test("validation: course, instructor, buckets, tags, empty", async () => {
  const { h, env } = setup();
  const tok = await session(h, env, "1.1.1.1");
  const post = (body) => call(h, env, tok, "/api/review", { method: "POST", body: { dev: DEV_A, ...body } });
  assert.equal((await post({ course: "NOPE", hours: 1 })).body.error, "course");
  assert.equal((await post({ course: "MATH-234", instr: "Someone Else", hours: 1 })).body.error, "instructor");
  assert.equal((await post({ course: "MATH-234", hours: 5 })).body.error, "hours");
  assert.equal((await post({ course: "MATH-234", hours: 1.5 })).body.error, "hours");
  assert.equal((await post({ course: "MATH-234", attend: 2 })).body.error, "attend");
  assert.equal((await post({ course: "MATH-234", tags: ["final", "nope"] })).body.error, "tags");
  assert.equal((await post({ course: "MATH-234" })).body.error, "empty");
  assert.equal((await post({ course: "MATH-234", text: "   " })).body.error, "empty");
  assert.equal((await call(h, env, tok, "/api/review", { method: "POST", body: { course: "MATH-234", dev: "short", hours: 1 } })).body.error, "dev");
  assert.equal((await post({ course: "MATH-234", instr: "Mikhail Feldman", hours: 0, attend: 0, tags: ["paper", "final"], text: "ok\u0000 \n fine" })).status, 200);
  const row = env.DB.raw.prepare("SELECT instr, hours, attend, tags, text, status, dev_h FROM reviews").get();
  assert.deepEqual({ ...row, dev_h: row.dev_h.length }, { instr: "Mikhail Feldman", hours: 0, attend: 0, tags: "final,paper", text: "ok fine", status: "pending", dev_h: 24 });
});

test("nothing is public until approved; the summary counts approved ones only", async () => {
  const { h, env } = setup();
  const tok = await session(h, env, "1.1.1.1");
  const sub = (dev, body) => call(h, env, tok, "/api/review", { method: "POST", body: { course: "MATH-234", dev, ...body } });
  await sub("1".repeat(20), { hours: 2, attend: 1, tags: ["final", "homework"], text: "first", instr: "Mikhail Feldman" });
  await sub("2".repeat(20), { hours: 2, attend: 0, tags: ["final"], text: "second" });
  await sub("3".repeat(20), { hours: 4, text: "third" });
  let s = (await call(h, env, tok, "/api/reviews?course=MATH-234")).body;
  assert.equal(s.n, 0);
  assert.deepEqual(s.items, []);
  const list = (await adm(h, env, "/api/rv-admin/list")).body;
  assert.equal(list.counts.pending, 3);
  assert.equal(list.rows[0].label.startsWith("MATH 234"), true);
  const [a, b, c] = list.rows.map((r) => r.id).reverse();
  assert.equal((await adm(h, env, "/api/rv-admin/set", { id: a, status: "ok" })).status, 200);
  assert.equal((await adm(h, env, "/api/rv-admin/set", { id: b, status: "ok", text: "second, trimmed" })).status, 200);
  await adm(h, env, "/api/rv-admin/set", { id: c, status: "hidden" });
  s = (await call(h, env, tok, "/api/reviews?course=MATH-234")).body;
  assert.equal(s.n, 2);
  assert.deepEqual(s.hours, [0, 0, 2, 0, 0]);
  assert.deepEqual(s.attend, { yes: 1, no: 1 });
  assert.equal(s.tags.final, 2);
  assert.equal(s.tags.homework, 1);
  assert.deepEqual(s.items.map((i) => i.text).sort(), ["first", "second, trimmed"]);
  assert.equal(s.items.some((i) => "dev_h" in i || "ip_h" in i), false);
  await adm(h, env, "/api/rv-admin/set", { id: a, status: "delete" });
  assert.equal((await call(h, env, tok, "/api/reviews?course=MATH-234")).body.n, 1);
});

test("asks: once per device, ranked by how many asked", async () => {
  const { h, env } = setup();
  const tok = await session(h, env, "1.1.1.1");
  const ask = (course, dev) => call(h, env, tok, "/api/ask", { method: "POST", body: { course, dev } });
  assert.equal((await ask("COMP-SCI-577", DEV_A)).body.asks, 1);
  assert.equal((await ask("COMP-SCI-577", DEV_A)).body.asks, 1, "same device again");
  assert.equal((await ask("COMP-SCI-577", DEV_B)).body.asks, 2);
  await ask("MATH-234", DEV_A);
  await ask("COMP-SCI-300", DEV_A); await ask("COMP-SCI-300", DEV_B); await ask("COMP-SCI-300", "c".repeat(20));
  assert.equal((await ask("NOPE", DEV_A)).status, 404);
  const rows = (await call(h, env, tok, "/api/review-requests")).body.rows;
  assert.deepEqual(rows.map((r) => [r.id, r.asks]), [["COMP-SCI-300", 3], ["COMP-SCI-577", 2], ["MATH-234", 1]]);
  const s = (await call(h, env, tok, "/api/reviews?course=COMP-SCI-577")).body;
  assert.equal(s.asks, 2);
});

test("requests also report the courses the page asks about, asked or not", async () => {
  const { h, env } = setup();
  const tok = await session(h, env, "1.1.1.1");
  await call(h, env, tok, "/api/ask", { method: "POST", body: { course: "MATH-234", dev: DEV_A } });
  await call(h, env, tok, "/api/review", { method: "POST", body: { course: "PHYSICS-241", dev: DEV_A, hours: 1 } });
  const [pending] = (await adm(h, env, "/api/rv-admin/list")).body.rows;
  await adm(h, env, "/api/rv-admin/set", { id: pending.id, status: "ok" });
  const rows = (await call(h, env, tok, "/api/review-requests?ids=PHYSICS-241,COMP-SCI-300,MATH-234,NOPE")).body.rows;
  const by = Object.fromEntries(rows.map((r) => [r.id, [r.asks, r.n]]));
  assert.deepEqual(by, { "MATH-234": [1, 0], "PHYSICS-241": [0, 1], "COMP-SCI-300": [0, 0] });
  assert.equal((await call(h, env, tok, "/api/review-requests")).body.rows.length, 1, "without ids only asked courses");
});

test("the admin side needs the token; the page is served", async () => {
  const { h, env } = setup();
  assert.equal((await adm(h, env, "/api/rv-admin/list", null, "wrong")).status, 401);
  assert.equal((await adm(h, env, "/api/rv-admin/set", { id: 1, status: "ok" }, "wrong")).status, 401);
  const page = await h(new Request("https://api.test/admin/reviews"), env);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("X-Robots-Tag"), /noindex/);
  assert.equal((await adm(h, env, "/api/rv-admin/set", { id: "x", status: "ok" })).status, 400);
});

test("daily quota stops a flood of writes, per session", async () => {
  const { h, env } = setup();
  const tok = await session(h, env, "5.5.5.5");
  let last, ok = 0;
  for (let i = 0; i < 20; i++) {
    last = await call(h, env, tok, "/api/ask", { method: "POST", body: { course: "MATH-234", dev: String(i).padStart(20, "d") }, ip: "5.5.5.5" });
    if (last.status === 200) ok++; else break;
  }
  assert.equal(ok, 12, "unverified session limit");
  assert.equal(last.status, 429);
  assert.equal(last.body.error, "quota");
});

test("without a database the review routes do not exist", async () => {
  const h = createHandler(data);
  const r = await h(new Request("https://api.test/api/reviews?course=MATH-234", { headers: ORIGIN }), {});
  assert.equal(r.status, 404);
});

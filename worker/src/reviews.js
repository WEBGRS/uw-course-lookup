// Course reviews: no login, one review and one "ask" per device and course, shown only after approval in /admin/reviews.
// Tables reviews and review_asks live in the shared webgrs-guard D1 (schema.sql).

export const HOURS = 5;                                   // buckets: 0-3, 3-6, 6-9, 9-12, 12+
export const TAGS = ["final", "midterm", "paper", "project", "homework", "participation"];
export const MAX_TEXT = 400;

async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a, b) {
  const x = String(a), y = String(b);
  let r = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) r |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return r === 0;
}

/** Knows which course ids and instructors are real; ix comes from engine.buildIndex. */
export function createReviews(ix, { adminHtml } = {}) {
  const idx = (id) => (typeof id === "string" ? ix.ids.get(id) : undefined);
  const canon = (id) => ix.C[ix.ids.get(id)].id;
  const names = (i) => { const c = ix.C[i]; return new Set([...c.ins.map((x) => x[0]), ...(c.now ? c.now.who : [])]); };
  const label = (id) => { const i = idx(id); return i == null ? id : `${ix.C[i].code} ${ix.C[i].t}`; };
  const salt = (env) => env.SESSION_KEY || "";
  const devHash = (env, dev) => sha(salt(env) + "|dev|" + dev);

  // Clean one submission; returns { error } or { v }
  function clean(b) {
    const i = idx(b.course);
    if (i == null) return { error: "course" };
    const v = { course: canon(b.course), instr: null, hours: null, attend: null, tags: "", text: "" };
    if (typeof b.instr === "string" && b.instr) {
      if (!names(i).has(b.instr)) return { error: "instructor" };
      v.instr = b.instr;
    }
    if (b.hours != null) {
      if (!Number.isInteger(b.hours) || b.hours < 0 || b.hours >= HOURS) return { error: "hours" };
      v.hours = b.hours;
    }
    if (b.attend != null) {
      if (b.attend !== 0 && b.attend !== 1) return { error: "attend" };
      v.attend = b.attend;
    }
    if (b.tags != null) {
      if (!Array.isArray(b.tags) || b.tags.some((t) => !TAGS.includes(t))) return { error: "tags" };
      v.tags = TAGS.filter((t) => b.tags.includes(t)).join(",");
    }
    if (b.text != null) {
      if (typeof b.text !== "string") return { error: "text" };
      v.text = b.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    }
    if (v.hours == null && v.attend == null && !v.tags && !v.text) return { error: "empty" };
    return { v };
  }

  // GET /api/reviews?course=: approved reviews summarised, plus how many people asked for one
  async function summary(env, course) {
    const i = idx(course);
    if (i == null) return { error: "course", status: 404 };
    const id = canon(course);
    const rows = (await env.DB.prepare("SELECT instr, hours, attend, tags, text, ts FROM reviews WHERE course = ?1 AND status = 'ok' ORDER BY ts DESC LIMIT 200").bind(id).all()).results;
    const asks = (await env.DB.prepare("SELECT COUNT(*) AS n FROM review_asks WHERE course = ?1").bind(id).first()).n || 0;
    const hours = Array(HOURS).fill(0), tags = Object.fromEntries(TAGS.map((t) => [t, 0]));
    let yes = 0, no = 0;
    for (const r of rows) {
      if (r.hours != null) hours[r.hours]++;
      if (r.attend === 1) yes++; else if (r.attend === 0) no++;
      if (r.tags) for (const t of r.tags.split(",")) if (t in tags) tags[t]++;
    }
    return {
      status: 200,
      body: {
        n: rows.length, asks, hours, attend: { yes, no }, tags,
        items: rows.filter((r) => r.text).slice(0, 30).map((r) => ({ instr: r.instr, text: r.text, ts: r.ts })),
      },
    };
  }

  // GET /api/review-requests: courses people asked about, most asked first
  async function requests(env) {
    const rows = (await env.DB.prepare("SELECT course, COUNT(*) AS asks, MAX(ts) AS last FROM review_asks GROUP BY course ORDER BY asks DESC, last DESC LIMIT 100").all()).results;
    const done = (await env.DB.prepare("SELECT course, COUNT(*) AS n FROM reviews WHERE status = 'ok' GROUP BY course").all()).results;
    const nOk = new Map(done.map((r) => [r.course, r.n]));
    return { status: 200, body: { rows: rows.filter((r) => idx(r.course) != null).map((r) => ({ id: r.course, asks: r.asks, n: nOk.get(r.course) || 0 })) } };
  }

  // POST /api/ask {course, dev}: one per device and course; repeating changes nothing
  async function ask(env, b, ipH) {
    if (typeof b.dev !== "string" || b.dev.length < 16 || b.dev.length > 64) return { status: 400, body: { error: "dev" } };
    const i = idx(b.course);
    if (i == null) return { status: 404, body: { error: "course" } };
    const id = canon(b.course), dh = await devHash(env, b.dev);
    await env.DB.prepare("INSERT OR IGNORE INTO review_asks (course, dev_h, ts) VALUES (?1, ?2, ?3)").bind(id, dh, Date.now()).run();
    const asks = (await env.DB.prepare("SELECT COUNT(*) AS n FROM review_asks WHERE course = ?1").bind(id).first()).n;
    return { status: 200, body: { ok: true, asks } };
  }

  // POST /api/review: one per device and course
  async function submit(env, b, ipH) {
    if (typeof b.dev !== "string" || b.dev.length < 16 || b.dev.length > 64) return { status: 400, body: { error: "dev" } };
    const c = clean(b);
    if (c.error) return { status: 400, body: { error: c.error } };
    const { v } = c, dh = await devHash(env, b.dev);
    const r = await env.DB.prepare("INSERT OR IGNORE INTO reviews (course, instr, hours, attend, tags, text, dev_h, ip_h, ts, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending')")
      .bind(v.course, v.instr, v.hours, v.attend, v.tags || null, v.text || null, dh, ipH || null, Date.now()).run();
    const changed = r.meta ? r.meta.changes : r.changes;
    if (!changed) return { status: 409, body: { error: "dup" } };
    return { status: 200, body: { ok: true } };
  }

  // ---------- admin (same ADMIN_TOKEN as /admin): /admin/reviews page and /api/rv-admin/*
  const authed = (request, env) => !!env.ADMIN_TOKEN && sameText((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), env.ADMIN_TOKEN);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

  async function admin(request, env, url) {
    if (url.pathname === "/admin/reviews") {
      return new Response(adminHtml || "page missing", { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
    }
    if (!url.pathname.startsWith("/api/rv-admin/")) return null;
    if (!authed(request, env)) { await new Promise((r) => setTimeout(r, 400)); return json({ error: "unauthorized" }, 401); }
    const route = url.pathname.slice("/api/rv-admin/".length);
    if (route === "list") {
      const status = ["pending", "ok", "hidden"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
      const rows = (await env.DB.prepare("SELECT id, course, instr, hours, attend, tags, text, ts, status FROM reviews WHERE status = ?1 ORDER BY ts DESC LIMIT 200").bind(status).all()).results;
      const counts = (await env.DB.prepare("SELECT status, COUNT(*) AS n FROM reviews GROUP BY status").all()).results;
      return json({ counts: Object.fromEntries(counts.map((r) => [r.status, r.n])), rows: rows.map((r) => ({ ...r, label: label(r.course) })) });
    }
    if (route === "set" && request.method === "POST") {
      let b;
      try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      if (!Number.isInteger(b.id) || !["ok", "hidden", "pending", "delete"].includes(b.status)) return json({ error: "bad request" }, 400);
      if (b.status === "delete") await env.DB.prepare("DELETE FROM reviews WHERE id = ?1").bind(b.id).run();
      else {
        // Moderator may trim the text before approving
        if (typeof b.text === "string") await env.DB.prepare("UPDATE reviews SET text = ?2 WHERE id = ?1").bind(b.id, b.text.slice(0, MAX_TEXT) || null).run();
        await env.DB.prepare("UPDATE reviews SET status = ?2 WHERE id = ?1").bind(b.id, b.status).run();
      }
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }

  return { summary, requests, ask, submit, admin, clean };
}

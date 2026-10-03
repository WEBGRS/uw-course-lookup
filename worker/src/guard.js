// Request guard shared by the WEBGRS data Workers (canonical copy: C:\Users\ghs\webgrs-guard\guard.js; sync.py copies it).
// Human-checked sessions (Turnstile), daily quotas per session and per IP, a D1 request log, a blocklist,
// and the admin API behind /admin. Everything lives in one D1 database; the `site` column tells sites apart.
//
// Worker env: DB (D1 binding), SESSION_KEY, ADMIN_TOKEN, TURNSTILE_SECRET (secrets).

const enc = new TextEncoder();
const SESSION_HOURS = 12;
const DAY_MS = 86_400_000;
const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

function b64u(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
async function hashIp(ip, salt) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(salt + "|" + ip));
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const randomId = () => b64u(crypto.getRandomValues(new Uint8Array(9)));

/**
 * site:      short name stored in the log, e.g. "rentals"
 * quotas:    { kind: { human, unverified, ip } } records per UTC day (see log's n); kinds not listed are unlimited
 * rate:      { kind: "BINDING_NAME" } Workers rate-limit bindings (per minute), optional
 * admin:     { title, html, data(q, offset) -> {cols, rows, total}, item(id) -> object, label(id) -> string }
 */
export function createGuard({ site, quotas = {}, rate = {}, admin = {} }) {
  let blockCache = { t: 0, keys: new Set() };

  async function blockedKeys(env) {
    if (Date.now() - blockCache.t < 60_000) return blockCache.keys;
    const r = await env.DB.prepare("SELECT key FROM blocked WHERE site = ?1 OR site = '*'").bind(site).all();
    blockCache = { t: Date.now(), keys: new Set(r.results.map((x) => x.key)) };
    return blockCache.keys;
  }

  async function who(request, env) {
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const ipH = await hashIp(ip, env.SESSION_KEY || "");
    const country = (request.cf && request.cf.country) || "";
    return { ip, ipH, country, sid: null, human: 0 };
  }

  async function readToken(request, env) {
    const tok = request.headers.get("X-Session") || "";
    const [sid, exp, human, sig] = tok.split(".");
    if (!sid || !exp || !sig || +exp < Date.now()) return null;
    const want = await hmac(env.SESSION_KEY, `${site}|${sid}|${exp}|${human}`);
    return sameText(sig, want) ? { sid, human: human === "1" ? 1 : 0 } : null;
  }

  async function countToday(env, kind, w) {
    const r = await env.DB.prepare(
      "SELECT SUM(CASE WHEN sid = ?1 THEN n ELSE 0 END) AS s, SUM(CASE WHEN ip_h = ?2 THEN n ELSE 0 END) AS i " +
      "FROM events WHERE site = ?3 AND day = ?4 AND kind = ?5 AND (sid = ?1 OR ip_h = ?2)",
    ).bind(w.sid || "", w.ipH, site, today(), kind).first();
    return { s: (r && r.s) || 0, i: (r && r.i) || 0 };
  }

  // n = how many records the request returned; quotas add these up, so a request for 40 items counts 40
  function log(env, ctx, w, kind, item, q, status, n = 1) {
    const stmt = env.DB.prepare(
      "INSERT INTO events (site, ts, day, sid, ip_h, country, kind, item, q, status, n) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    ).bind(site, Date.now(), today(), w.sid, w.ipH, w.country, kind, item == null ? null : String(item).slice(0, 200),
      q == null ? null : JSON.stringify(q).slice(0, 1500), status, status < 400 ? Math.max(0, n | 0) : 0);
    const p = stmt.run().catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(p);
    return p;
  }

  // POST /api/session  {turnstile: token}  ->  {token, exp, human}
  async function session(request, env, ctx) {
    if (!env.SESSION_KEY) return { status: 503, body: { error: "not configured" } };  // never sign with a default key
    const w = await who(request, env);
    if ((await blockedKeys(env)).has(w.ipH)) return { status: 403, body: { error: "blocked" } };
    const made = await countToday(env, "session", w);
    if (made.i >= 60) return { status: 429, body: { error: "quota", kind: "session" } };
    let body = {};
    try { body = await request.json(); } catch { /* empty body */ }
    let human = 0;
    if (env.TURNSTILE_SECRET && body.turnstile) {
      const form = new FormData();
      form.append("secret", env.TURNSTILE_SECRET);
      form.append("response", String(body.turnstile).slice(0, 4096));
      form.append("remoteip", w.ip);
      try {
        const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
        human = (await r.json()).success ? 1 : 0;
      } catch { human = 0; }
    }
    const sid = randomId();
    const exp = Date.now() + SESSION_HOURS * 3_600_000;
    const sig = await hmac(env.SESSION_KEY, `${site}|${sid}|${exp}|${human}`);
    w.sid = sid;
    const ua = (request.headers.get("User-Agent") || "").slice(0, 200);
    const p = env.DB.prepare("INSERT OR REPLACE INTO sessions (site, sid, ts, ip_h, country, ua, human) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(site, sid, Date.now(), w.ipH, w.country, ua, human).run().catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(p);
    log(env, ctx, w, "session", null, { human }, 200);
    return { status: 200, body: { token: `${sid}.${exp}.${human}.${sig}`, exp, human } };
  }

  // Every data request: valid session, not blocked, under the per-minute rate and the daily quota.
  async function gate(request, env, kind) {
    const w = await who(request, env);
    if (!env.SESSION_KEY) return { ok: false, status: 503, body: { error: "not configured" }, w };
    const tok = await readToken(request, env);
    if (!tok) return { ok: false, status: 401, body: { error: "session" }, w };
    w.sid = tok.sid;
    w.human = tok.human;
    const bl = await blockedKeys(env);
    if (bl.has(w.sid) || bl.has(w.ipH)) return { ok: false, status: 403, body: { error: "blocked" }, w };
    const rl = rate[kind] && env[rate[kind]];
    if (rl && !(await rl.limit({ key: w.ipH })).success) return { ok: false, status: 429, body: { error: "slow" }, headers: { "Retry-After": "10" }, w };
    const q = quotas[kind];
    if (q) {
      const c = await countToday(env, kind, w);
      const perSession = w.human ? q.human : q.unverified;
      if (c.s >= perSession || c.i >= q.ip) return { ok: false, status: 429, body: { error: "quota", kind, limit: perSession }, w };
    }
    return { ok: true, w };
  }

  // ---------- admin
  function authed(request, env) {
    const h = request.headers.get("Authorization") || "";
    return !!env.ADMIN_TOKEN && sameText(h.replace(/^Bearer\s+/i, ""), env.ADMIN_TOKEN);
  }
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

  async function handleAdmin(request, env, url) {
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      return new Response(admin.html || "admin page missing", {
        headers: {
          "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }
    if (!url.pathname.startsWith("/api/admin/")) return null;
    if (!authed(request, env)) {
      await new Promise((r) => setTimeout(r, 400));
      return json({ error: "unauthorized" }, 401);
    }
    const route = url.pathname.slice("/api/admin/".length);
    const p = url.searchParams;
    const days = Math.min(Math.max(+p.get("days") || 14, 1), 180);
    const since = Date.now() - days * DAY_MS;
    const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
    switch (route) {
      case "info":
        return json({ site, title: admin.title || site, quotas });
      case "stats": {
        const [perDay, kinds, humans, countries] = await Promise.all([
          all("SELECT day, COUNT(*) AS n, COUNT(DISTINCT sid) AS s, COUNT(DISTINCT ip_h) AS i FROM events WHERE site = ?1 AND ts >= ?2 GROUP BY day ORDER BY day", site, since),
          all("SELECT kind, COUNT(*) AS n FROM events WHERE site = ?1 AND ts >= ?2 GROUP BY kind ORDER BY n DESC", site, since),
          all("SELECT human, COUNT(*) AS n FROM sessions WHERE site = ?1 AND ts >= ?2 GROUP BY human", site, since),
          all("SELECT country, COUNT(DISTINCT sid) AS s FROM events WHERE site = ?1 AND ts >= ?2 GROUP BY country ORDER BY s DESC LIMIT 12", site, since),
        ]);
        return json({ days, perDay, kinds, humans, countries });
      }
      case "top": {
        const kind = p.get("kind") || "detail";
        const rows = await all("SELECT item, COUNT(*) AS n, COUNT(DISTINCT sid) AS s FROM events WHERE site = ?1 AND kind = ?2 AND ts >= ?3 AND item IS NOT NULL GROUP BY item ORDER BY n DESC LIMIT 40", site, kind, since);
        return json({ kind, rows: rows.map((r) => ({ ...r, label: admin.label ? admin.label(r.item) : r.item })) });
      }
      case "searches": {
        const rows = await all("SELECT json_extract(q, '$.text') AS t, COUNT(*) AS n, COUNT(DISTINCT sid) AS s FROM events WHERE site = ?1 AND kind = 'search' AND ts >= ?2 GROUP BY t HAVING t IS NOT NULL AND t <> '' ORDER BY n DESC LIMIT 40", site, since);
        return json({ rows });
      }
      case "sessions": {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(p.get("day") || "") ? p.get("day") : today();
        const rows = await all(
          "SELECT e.sid, MIN(e.ts) AS first, MAX(e.ts) AS last, e.ip_h, e.country, COUNT(*) AS n, " +
          "SUM(CASE WHEN e.kind = 'detail' THEN e.n ELSE 0 END) AS details, SUM(CASE WHEN e.kind IN ('search', 'list') THEN 1 ELSE 0 END) AS searches, " +
          "SUM(CASE WHEN e.status >= 400 THEN 1 ELSE 0 END) AS refused, s.human, s.ua " +
          "FROM events e LEFT JOIN sessions s ON s.site = e.site AND s.sid = e.sid WHERE e.site = ?1 AND e.day = ?2 AND e.sid IS NOT NULL " +
          "GROUP BY e.sid ORDER BY details DESC, n DESC LIMIT 300", site, day);
        const bl = await blockedKeys(env);
        return json({ day, rows: rows.map((r) => ({ ...r, blocked: bl.has(r.sid) || bl.has(r.ip_h) })) });
      }
      case "events": {
        const lim = Math.min(+p.get("limit") || 200, 1000);
        const sid = p.get("sid"), ip = p.get("ip");
        const rows = sid ? await all("SELECT * FROM events WHERE site = ?1 AND sid = ?2 ORDER BY ts DESC LIMIT ?3", site, sid, lim)
          : ip ? await all("SELECT * FROM events WHERE site = ?1 AND ip_h = ?2 ORDER BY ts DESC LIMIT ?3", site, ip, lim)
            : await all("SELECT * FROM events WHERE site = ?1 ORDER BY ts DESC LIMIT ?2", site, lim);
        return json({ rows: rows.map((r) => ({ ...r, label: r.item && admin.label ? admin.label(r.item) : r.item })) });
      }
      case "blocked":
        return json({ rows: await all("SELECT * FROM blocked WHERE site = ?1 OR site = '*' ORDER BY ts DESC", site) });
      case "block":
      case "unblock": {
        if (request.method !== "POST") return json({ error: "POST only" }, 405);
        let b = {};
        try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
        if (!b.key || !/^(sid|ip)$/.test(b.kind || "sid")) return json({ error: "key and kind required" }, 400);
        if (route === "block") {
          await env.DB.prepare("INSERT OR REPLACE INTO blocked (site, key, kind, reason, ts) VALUES (?1, ?2, ?3, ?4, ?5)")
            .bind(b.all ? "*" : site, String(b.key), b.kind || "sid", String(b.reason || "").slice(0, 200), Date.now()).run();
        } else {
          await env.DB.prepare("DELETE FROM blocked WHERE key = ?1 AND (site = ?2 OR site = '*')").bind(String(b.key), site).run();
        }
        blockCache.t = 0;
        return json({ ok: true });
      }
      case "data":
        return json(admin.data ? admin.data(p.get("q") || "", Math.max(+p.get("offset") || 0, 0)) : { cols: [], rows: [], total: 0 });
      case "item": {
        const it = admin.item ? admin.item(p.get("id") || "") : null;
        return it ? json(it) : json({ error: "not found" }, 404);
      }
      default:
        return json({ error: "not found" }, 404);
    }
  }

  // Cron: keep 180 days of events and sessions
  async function prune(env) {
    const cut = Date.now() - 180 * DAY_MS;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM events WHERE site = ?1 AND ts < ?2").bind(site, cut),
      env.DB.prepare("DELETE FROM sessions WHERE site = ?1 AND ts < ?2").bind(site, cut),
    ]);
  }

  return { session, gate, log, handleAdmin, prune };
}

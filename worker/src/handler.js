// HTTP layer for the course API: routing, origin check, rate limits, headers.
import { buildIndex, query, detail, details, LIMITS } from "./engine.js";

const DEFAULT_ORIGINS = ["https://webgrs.github.io"];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const WINDOW_MS = 60_000;
const LIMIT = { list: 120, detail: 60 };  // per client per minute (in-memory fallback; the binding is per location)

export function createHandler(data, opts = {}) {
  const ix = buildIndex(data);
  const limit = { ...LIMIT, ...opts.limits };
  const hits = new Map();

  function overLimit(kind, ip) {
    const now = Date.now(), key = kind + ":" + ip;
    const rec = hits.get(key);
    if (!rec || now - rec.t > WINDOW_MS) {
      if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > WINDOW_MS) hits.delete(k);
      hits.set(key, { t: now, n: 1 });
      return false;
    }
    return ++rec.n > limit[kind];
  }

  return async function handle(request, env = {}) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOW_ORIGINS ? env.ALLOW_ORIGINS.split(",").map((s) => s.trim()) : DEFAULT_ORIGINS);
    const originOk = !!origin && (allowed.includes(origin) || LOCAL.test(origin));
    const sameOrigin = request.headers.get("Sec-Fetch-Site") === "same-origin";

    const base = {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Vary": "Origin",
    };
    if (originOk) base["Access-Control-Allow-Origin"] = origin;
    const send = (body, status = 200, cache = 60, extra = {}) =>
      new Response(body, { status, headers: { ...base, "Cache-Control": status === 200 ? `public, max-age=${cache}` : "no-store", ...extra } });
    const fail = (status, msg, extra) => send(JSON.stringify({ error: msg }), status, 0, extra);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...base, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "method not allowed");
    if (!url.pathname.startsWith("/api/")) return fail(404, "not found");
    if (url.pathname === "/api/health") return send(JSON.stringify({ ok: true, count: ix.n, built_at: ix.meta.built_at }), 200, 0);

    // The page is the only intended client: browsers always send Origin (cross-site) or Sec-Fetch-Site (same-site).
    if (!originOk && !sameOrigin) return fail(403, "forbidden");

    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const kind = url.pathname.startsWith("/api/course/") || url.pathname === "/api/compare" ? "detail" : "list";
    const limiter = kind === "detail" ? env.RL_DETAIL : env.RL_LIST;
    const limited = limiter ? !(await limiter.limit({ key: ip })).success : overLimit(kind, ip);
    if (limited) return fail(429, "slow down", { "Retry-After": "10" });

    const p = url.searchParams;
    switch (url.pathname) {
      case "/api/meta": return send(ix.metaJson, 200, 300);
      case "/api/insights": return send(ix.insightsJson, 200, 300);
      case "/api/courses": {
        const { total, rows } = query(ix, p);
        return send(`{"total":${total},"rows":[${rows.join(",")}]}`);
      }
      case "/api/compare": {
        const list = details(ix, (p.get("ids") || "").split(",").filter(Boolean));
        return send(`{"courses":[${list.join(",")}]}`);
      }
      default: {
        if (url.pathname.startsWith("/api/course/")) {
          let id;
          try { id = decodeURIComponent(url.pathname.slice("/api/course/".length)); } catch { return fail(400, "bad id"); }
          const d = detail(ix, id);
          return d ? send(d, 200, 300) : fail(404, "no such course");
        }
        return fail(404, "not found");
      }
    }
  };
}

export { LIMITS };

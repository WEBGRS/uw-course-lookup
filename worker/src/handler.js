// HTTP layer for the course API: routing, origin check, sessions, quotas, request log, admin.
import { buildIndex, query, detail, details, planData, LIMITS } from "./engine.js";
import { chatStep } from "./assistant.js";
import { createGuard } from "./guard.js";

const DEFAULT_ORIGINS = ["https://webgrs.github.io"];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const WINDOW_MS = 60_000;
const LIMIT = { list: 120, detail: 60, chat: 30 };  // per client per minute (in-memory fallback; the binding is per location)

// Course records per UTC day (list rows, full records, assistant steps), for a visitor who passed the human check,
// one who did not, and one network. Counted per record, so /api/plan with 40 ids costs 40.
export const QUOTAS = {
  list: { human: 6000, unverified: 1500, ip: 9000 },
  detail: { human: 2500, unverified: 400, ip: 2500 },
  chat: { human: 300, unverified: 60, ip: 500 },
};

export function createHandler(data, opts = {}) {
  const ix = buildIndex(data);
  const limit = { ...LIMIT, ...opts.limits };
  const hits = new Map();
  const C = ix.C;
  const guard = createGuard({
    site: "courses",
    quotas: opts.quotas || QUOTAS,
    rate: { list: "RL_LIST", detail: "RL_DETAIL", chat: "RL_CHAT" },
    admin: {
      title: "UW Course Lookup",
      html: opts.adminHtml,
      label: (id) => { const i = ix.ids.get(id); return i == null ? id : `${C[i].code} ${C[i].t}`; },
      item: (id) => { const d = detail(ix, id); return d ? JSON.parse(d) : null; },
      data: (q, offset) => {
        const t = q.trim().toLowerCase();
        const all = [];
        for (let i = 0; i < ix.n; i++) if (!t || (C[i].code + " " + C[i].t).toLowerCase().includes(t)) all.push(C[i]);
        const rows = all.slice(offset, offset + 100).map((c) => ({
          id: c.id, code: c.code, title: c.t, gpa: c.gpa == null ? "" : c.gpa.toFixed(2), graded: c.n || "", enrolled: c.en || "",
        }));
        return { cols: [["code", "Course"], ["title", "Title"], ["gpa", "GPA"], ["graded", "Graded"], ["enrolled", "Enrolled now"]], rows, total: all.length };
      },
    },
  });

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

  return async function handle(request, env = {}, ctx) {
    const url = new URL(request.url);
    // The admin page and its API (only where the request log exists)
    if (env.DB) {
      const adm = await guard.handleAdmin(request, env, url);
      if (adm) return adm;
    }
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
      new Response(body, { status, headers: { ...base, "Cache-Control": status === 200 && cache ? `${env.DB ? "private" : "public"}, max-age=${cache}` : "no-store", ...extra } });
    const fail = (status, msg, extra) => send(JSON.stringify({ error: msg }), status, 0, extra);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...base, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type, X-Session", "Access-Control-Max-Age": "86400" } });
    }
    const isChat = request.method === "POST" && url.pathname === "/api/chat";
    const isSession = request.method === "POST" && url.pathname === "/api/session";
    if (request.method !== "GET" && request.method !== "HEAD" && !isChat && !isSession) return fail(405, "method not allowed");
    if (!url.pathname.startsWith("/api/")) return fail(404, "not found");
    if (url.pathname === "/api/health") return send(JSON.stringify({ ok: true, count: ix.n, built_at: ix.meta.built_at }), 200, 0);

    // The page is the only intended client: browsers always send Origin (cross-site) or Sec-Fetch-Site (same-site).
    if (!originOk && !sameOrigin) return fail(403, "forbidden");

    // Aggregates the page draws first; no session needed
    if (url.pathname === "/api/meta") return send(ix.metaJson, 200, 300);
    if (url.pathname === "/api/insights") return send(ix.insightsJson, 200, 300);
    if (isSession) {
      if (!env.DB) return fail(404, "not found");
      const r = await guard.session(request, env, ctx);
      return send(JSON.stringify(r.body), r.status, 0);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const kind = isChat ? "chat" : url.pathname.startsWith("/api/course/") || url.pathname === "/api/compare" || url.pathname === "/api/plan" ? "detail" : "list";
    let g = null;
    if (env.DB) {
      // Public deployment: signed session, blocklist, per-minute rate and daily quota
      g = await guard.gate(request, env, kind);
      if (!g.ok) {
        guard.log(env, ctx, g.w, kind, null, null, g.status, 0);
        return send(JSON.stringify(g.body), g.status, 0, g.headers || {});
      }
    } else {
      const limiter = kind === "chat" ? env.RL_CHAT : kind === "detail" ? env.RL_DETAIL : env.RL_LIST;
      const limited = limiter ? !(await limiter.limit({ key: ip })).success : overLimit(kind, ip);
      if (limited) return fail(429, "slow down", { "Retry-After": "10" });
    }
    const note = (item, q, n, status = 200) => { if (g) guard.log(env, ctx, g.w, kind, item, q, status, n); };

    if (isChat) {
      const raw = await request.text();
      if (raw.length > 90_000) return fail(413, "too large");
      let body;
      try { body = JSON.parse(raw); } catch { return fail(400, "bad json"); }
      const r = await chatStep(env, ix, body);
      note("chat", null, 1, r.status);  // the conversation itself is never logged
      return send(JSON.stringify(r.body), r.status, 0, { "Cache-Control": "no-store" });
    }

    const p = url.searchParams;
    switch (url.pathname) {
      case "/api/courses": {
        const { total, rows } = query(ix, p);
        const q = {};
        for (const [k, v] of p) if (k !== "ids") q[k === "q" ? "text" : k] = v.slice(0, 60);
        note(p.get("ids") ? "ids: " + p.get("ids").slice(0, 120) : null, q, rows.length);
        return send(`{"total":${total},"rows":[${rows.join(",")}]}`);
      }
      case "/api/compare": {
        const list = details(ix, (p.get("ids") || "").split(",").filter(Boolean));
        note("compare: " + (p.get("ids") || "").slice(0, 120), null, list.length);
        return send(`{"courses":[${list.join(",")}]}`);
      }
      case "/api/plan": {
        const ids = (p.get("ids") || "").split(",").filter(Boolean).slice(0, LIMITS.plan);
        note("plan: " + ids.slice(0, 6).join(",") + (ids.length > 6 ? ",…" : ""), null, ids.length);
        return send(planData(ix, ids), 200, 120);
      }
      default: {
        if (url.pathname.startsWith("/api/course/")) {
          let id;
          try { id = decodeURIComponent(url.pathname.slice("/api/course/".length)); } catch { return fail(400, "bad id"); }
          const d = detail(ix, id);
          note(id, null, d ? 1 : 0, d ? 200 : 404);
          return d ? send(d, 200, 300) : fail(404, "no such course");
        }
        return fail(404, "not found");
      }
    }
  };
}

export { LIMITS };

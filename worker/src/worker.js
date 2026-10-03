// Cloudflare Worker entry. data.json is built locally by scripts/build_site.py and never committed.
import DATA from "../data.json";
import { createHandler } from "./handler.js";
import ADMIN_HTML from "./admin.html";

const handle = createHandler(DATA, { adminHtml: ADMIN_HTML });

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
  // Daily: drop request-log rows older than 180 days
  scheduled: async (event, env) => {
    if (env.DB) await env.DB.prepare("DELETE FROM events WHERE site = 'courses' AND ts < ?1").bind(Date.now() - 180 * 86_400_000).run();
  },
};

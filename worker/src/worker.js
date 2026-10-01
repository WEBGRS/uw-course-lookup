// Cloudflare Worker entry. data.json is built locally by scripts/build_site.py and never committed.
import DATA from "../data.json";
import { createHandler } from "./handler.js";

const handle = createHandler(DATA);

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
};

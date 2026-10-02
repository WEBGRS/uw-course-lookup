// Local server: the page at / and the API at /api/*, from worker/data.json.
//   node worker/dev-server.mjs [port]
// The assistant needs Workers AI, which only exists in the cloud: use `npx wrangler dev` for that.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { createHandler } from "./src/handler.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const port = +(process.argv[2] || process.env.PORT || 8787);
const unlimited = process.env.NO_LIMIT ? { list: 1e9, detail: 1e9, chat: 1e9 } : {};  // for browser test runs
const handle = createHandler(JSON.parse(await readFile(join(here, "data.json"), "utf8")), { limits: unlimited });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".md": "text/plain; charset=utf-8" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const body = req.method === "POST" ? await new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); }) : undefined;
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body }), process.env.FAKE_AI ? { AI: { run: async () => ({ choices: [{ message: { content: "(local stub: run `npx wrangler dev` for the real assistant)" } }] }) } } : {});
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const file = url.pathname === "/" ? "index.html" : normalize(decodeURIComponent(url.pathname)).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!/^(index\.html|(assets|docs)\/[\w./-]+)$/.test(file) || file.includes("..")) { res.writeHead(404); res.end("not found"); return; }
  try {
    let body = await readFile(join(root, file));
    if (file === "assets/config.js") body = body.toString("utf8").replace(/"api":\s*"[^"]*"/, '"api": ""');  // use this server's API
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));

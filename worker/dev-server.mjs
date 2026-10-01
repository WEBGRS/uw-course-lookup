// Local server: the page at / and the API at /api/*, from worker/data.json.
//   node worker/dev-server.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { createHandler } from "./src/handler.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const port = +(process.argv[2] || process.env.PORT || 8787);
const unlimited = process.env.NO_LIMIT ? { list: 1e9, detail: 1e9 } : {};  // for browser test runs
const handle = createHandler(JSON.parse(await readFile(join(here, "data.json"), "utf8")), { limits: unlimited });
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".md": "text/plain; charset=utf-8" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const r = await handle(new Request(url, { method: req.method, headers: req.headers }), {});
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^(index\.html|docs\/[\w.-]+)$/.test(file)) { res.writeHead(404); res.end("not found"); return; }
  try {
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(await readFile(join(root, file)));
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));

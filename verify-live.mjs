// Verify the deployed site actually works, not just that it returns 200.
//   node verify-live.mjs                              (deployed site)
//   URL=http://127.0.0.1:8787/ node verify-live.mjs   (local: node worker/dev-server.mjs)
import { chromium } from "playwright";

const URL = process.env.URL || "https://webgrs.github.io/uw-course-lookup/";
const ORIGIN = URL.split("#")[0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1340, height: 900 }, locale: "en-US" });
const problems = [];
const apiCalls = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
page.on("response", (r) => { if (r.url().includes("/api/")) apiCalls.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });

console.log("GET", URL);
await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector(".row[data-id]", { timeout: 30000 });

const s = await page.evaluate(() => ({
  rows: document.querySelectorAll(".row[data-id]").length,
  count: document.querySelector("#cnt")?.textContent,
  hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
console.log(JSON.stringify(s));
const total = +s.count.replace(/,/g, "").match(/of (\d+)/)[1];
if (total < 4000) problems.push(`API reports only ${total} courses`);
if (!s.rows) problems.push("no course rows rendered");
const shipped = (await (await fetch(ORIGIN)).text()).length;
if (shipped > 20000) problems.push(`index.html is ${shipped} bytes; is the dataset embedded again?`);
if (s.hscroll) problems.push("page scrolls horizontally");

const ids = async () => page.$$eval(".row[data-id]", (r) => r.map((x) => x.dataset.id));
const search = async (q) => { await page.fill("#q", q); await page.waitForTimeout(700); return ids(); };
if (!(await search("cs 300")).includes("COMP-SCI-300")) problems.push('"cs 300" did not find COMP SCI 300');
if ((await search("calculus 234")).join() !== "MATH-234") problems.push('"calculus 234" did not find MATH 234');
const af = await search("anne frank");
if (!af.length || af.length > 8) problems.push(`"anne frank" returned ${af.length} courses`);
await page.fill("#q", "");

// Every sort keeps the list non-empty
for (const v of ["gpa", "gpaL", "en", "code", "m"]) {
  await page.selectOption("#sort", v);
  await page.waitForTimeout(500);
  if (!(await ids()).length) problems.push(`sort ${v} emptied the list`);
}
await page.selectOption("#sort", "m");

// A filter narrows the list
await page.waitForTimeout(500);
const all = +(await page.textContent("#cnt")).replace(/,/g, "").match(/of (\d+)/)[1];
await page.selectOption("#fLvl", "5");
await page.waitForTimeout(600);
const upper = +(await page.textContent("#cnt")).replace(/,/g, "").match(/^(\d+)/)[1];
if (!upper || upper >= all) problems.push(`level filter did not narrow the list (${upper} of ${all})`);
await page.selectOption("#fLvl", "");

// The removed clutter stays removed
if (await page.$(".tagline, .lens, #lenses")) problems.push("tagline or lens chips are back");

// Chinese UI
await page.click("#langBtn");
const zh = await page.evaluate(() => ({ lang: document.documentElement.lang, tab: document.querySelector('[data-tab="courses"]').textContent }));
console.log("zh", JSON.stringify(zh));
if (zh.lang !== "zh-CN" || zh.tab !== "课程") problems.push("language toggle did not switch to Chinese");
await page.click("#langBtn");

// Course drawer: charts, links and this term's meeting times
await page.goto(ORIGIN + "#/c/MATH-234");
await page.waitForSelector("#drawer.on", { timeout: 10000 });
await page.waitForSelector("#dSections table", { timeout: 10000 });
await page.waitForTimeout(500);
const d = await page.evaluate(() => ({
  title: document.querySelector("#dTitle")?.textContent,
  charts: document.querySelectorAll("#drawer svg").length,
  instructors: document.querySelectorAll("#drawer .itable tbody tr").length,
  sections: document.querySelectorAll("#dSections tr").length,
  mg: document.querySelector('#drawer a[href*="madgrades.com"]')?.href,
  rmp: document.querySelector('#drawer a[href*="ratemyprofessors.com"]')?.href,
}));
console.log(JSON.stringify(d));
if (d.charts < 3) problems.push("drawer is missing charts");
if (!d.instructors) problems.push("drawer has no instructors");
if (!d.sections) problems.push("drawer shows no sections for a course offered this term");
if (!d.mg || !d.rmp) problems.push("drawer is missing MadGrades or RMP links");

// A catalog-tier course opens too
await page.goto(ORIGIN + "#/c/SPANISH-226");
await page.waitForSelector("#drawer.on", { timeout: 10000 });
await page.waitForTimeout(500);
if ((await page.$$("#drawer svg")).length < 1) problems.push("catalog-tier drawer has no chart");

// Planner: pick a program, import a transcript, add two courses, build timetables
await page.goto(ORIGIN + "#/plan");
await page.waitForSelector("#pgInput", { timeout: 10000 });
await page.fill("#pgInput", "Computer Sciences, BS");
await page.dispatchEvent("#pgInput", "change");
await page.waitForSelector(".prog-sum", { timeout: 10000 });
await page.click("#pgImport");
await page.fill("#impText", "MATH 221 Calculus 5.000 5.000 B\nCOMP SCI 300 Programming II 3.000 3.000 A\nCOMP SCI/MATH 240 Discrete 3.000 3.000 A");
await page.click("#impRead");
await page.click("#impApply");
const met = await page.textContent(".prog-sum");
console.log("program:", met.trim().slice(0, 60));
if (!/[1-9] of \d+ requirements met|0 of \d+/.test(met)) problems.push("program progress did not render");
for (const q of ["cs 577", "math 340"]) {
  await page.fill("#addQ", q);
  await page.waitForSelector("#addRes button", { timeout: 8000 });
  await page.click("#addRes button >> nth=0");
}
await page.click("#build");
await page.waitForSelector(".cal, .reasons", { timeout: 30000 });
const plan = await page.evaluate(() => ({ events: document.querySelectorAll(".cal .ev").length, picks: document.querySelectorAll(".pick").length, options: document.querySelectorAll(".var-btn").length }));
console.log("timetable", JSON.stringify(plan));
if (!plan.events || plan.picks < 2) problems.push("planner produced no timetable");

// The assistant panel opens (we do not spend model quota here)
await page.click("#askBtn");
await page.waitForSelector("#agIn", { timeout: 5000 });
await page.click("#agClose");

// Insights tab
await page.goto(ORIGIN + "#/insights");
await page.waitForSelector("#v-insights .panel", { timeout: 10000 });
const panels = await page.$$eval("#v-insights .panel", (p) => p.length);
console.log("insight panels", panels);
if (panels < 6) problems.push(`only ${panels} insight panels`);

// Phone width
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(URL, { waitUntil: "networkidle" });
await m.waitForSelector(".row[data-id]", { timeout: 30000 });
if (await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth))
  problems.push("phone layout scrolls horizontally");

// The API refuses callers that are not the page (no Origin, no same-site fetch)
const api = await page.evaluate(() => (window.UWCL && window.UWCL.api) || "");
if (api) {
  const r = await fetch(api + "/api/courses?limit=60");
  if (r.status !== 403) problems.push(`API answered an anonymous caller with ${r.status}, expected 403`);
  const c = await fetch(api + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (c.status !== 403) problems.push(`chat answered an anonymous caller with ${c.status}, expected 403`);
}

await browser.close();
const bad = apiCalls.filter((c) => !c.startsWith("200 "));
if (bad.length) console.log("non-200 API calls:\n  " + bad.join("\n  "));
console.log(problems.length ? "\nPROBLEMS:\n - " + problems.join("\n - ") : "\nsite OK");
process.exit(problems.length ? 1 : 0);

// Verify the deployed site actually works, not just that it returns 200.
//   node verify-live.mjs                          (deployed site)
//   URL=http://127.0.0.1:8787/ node verify-live.mjs   (local: node worker/dev-server.mjs)
import { chromium } from "playwright";

const URL = process.env.URL || "https://webgrs.github.io/uw-course-lookup/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1340, height: 900 } });
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
  html: document.documentElement.outerHTML.length,
  hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
console.log(JSON.stringify(s));
const total = +s.count.replace(/,/g, "").match(/of (\d+)/)[1];
if (total < 4000) problems.push(`API reports only ${total} courses`);
if (!s.rows) problems.push("no course rows rendered");
if (s.html > 400000) problems.push("page ships too much HTML; is the dataset embedded again?");
if (s.hscroll) problems.push("page scrolls horizontally");

const ids = async () => page.$$eval(".row[data-id]", (r) => r.map((x) => x.dataset.id));
const search = async (q) => { await page.fill("#q", q); await page.waitForTimeout(700); return ids(); };
if (!(await search("cs 300")).includes("COMP-SCI-300")) problems.push('"cs 300" did not find COMP SCI 300');
if ((await search("calculus 234")).join() !== "MATH-234") problems.push('"calculus 234" did not find MATH 234');
const af = await search("anne frank");
if (!af.length || af.length > 8) problems.push(`"anne frank" returned ${af.length} courses`);
await page.fill("#q", "");

// Every sort keeps the list non-empty
for (const v of ["gpa", "gpaL", "pa", "tr", "tl", "sp", "rd", "en", "code", "m"]) {
  await page.selectOption("#sort", v);
  await page.waitForTimeout(500);
  if (!(await ids()).length) problems.push(`sort ${v} emptied the list`);
}
await page.selectOption("#sort", "m");

// A lens narrows the list
const num = async () => (await page.textContent("#cnt")).replace(/,/g, "");
await page.waitForTimeout(500);
const all = +(await num()).match(/of (\d+)/)[1];
await page.click('[data-lens="easy"]');
await page.waitForTimeout(600);
const easy = +(await num()).match(/^(\d+)/)[1];
if (!easy || easy >= all) problems.push(`lens "easy" did not narrow the list (${easy} of ${all})`);
await page.click('[data-lens="easy"]');

// Chinese UI
await page.click("#langBtn");
const zh = await page.evaluate(() => ({ lang: document.documentElement.lang, tab: document.querySelector('[data-tab="courses"]').textContent }));
console.log("zh", JSON.stringify(zh));
if (zh.lang !== "zh-CN" || zh.tab !== "课程") problems.push("language toggle did not switch to Chinese");
await page.click("#langBtn");

// Course drawer renders charts and outbound links
await page.goto(URL.split("#")[0] + "#/c/MATH-234");
await page.waitForSelector("#drawer.on", { timeout: 10000 });
await page.waitForTimeout(500);
const d = await page.evaluate(() => ({
  title: document.querySelector("#dTitle")?.textContent,
  charts: document.querySelectorAll("#drawer svg").length,
  instructors: document.querySelectorAll("#drawer .itable tbody tr").length,
  mg: document.querySelector('#drawer a[href*="madgrades.com"]')?.href,
  rmp: document.querySelector('#drawer a[href*="ratemyprofessors.com"]')?.href,
}));
console.log(JSON.stringify(d));
if (d.charts < 3) problems.push("drawer is missing charts");
if (!d.instructors) problems.push("drawer has no instructors");
if (!d.mg || !d.rmp) problems.push("drawer is missing MadGrades or RMP links");

// A catalog-tier course opens too
await page.goto(URL.split("#")[0] + "#/c/SPANISH-226");
await page.waitForSelector("#drawer.on", { timeout: 10000 });
await page.waitForTimeout(500);
if ((await page.$$("#drawer svg")).length < 1) problems.push("catalog-tier drawer has no chart");

// Insights tab
await page.goto(URL.split("#")[0] + "#/insights");
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
const api = await page.evaluate(() => (window.UWCL_API || ""));
if (api) {
  const r = await fetch(api + "/api/courses?limit=60");
  if (r.status !== 403) problems.push(`API answered an anonymous caller with ${r.status}, expected 403`);
}

await browser.close();
const bad = apiCalls.filter((c) => !c.startsWith("200 "));
if (bad.length) console.log("non-200 API calls:\n  " + bad.join("\n  "));
console.log(problems.length ? "\nPROBLEMS:\n - " + problems.join("\n - ") : "\nsite OK");
process.exit(problems.length ? 1 : 0);

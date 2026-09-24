// Verify the site actually works, not just that it returns 200.
//   node verify-live.mjs                       (deployed site)
//   URL=file:///.../index.html node verify-live.mjs
import { chromium } from "playwright";

const URL = process.env.URL || "https://webgrs.github.io/uw-course-lookup/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1340, height: 900 } });
const problems = [];
const failedReqs = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
page.on("response", (r) => { if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`); });

console.log("GET", URL);
await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector(".row[data-id]", { timeout: 30000 });

const s = await page.evaluate(() => ({
  courses: window.UWCL?.courses?.length || 0,
  catalog: window.UWCL_CATALOG?.length || 0,
  rows: document.querySelectorAll(".row[data-id]").length,
  count: document.querySelector("#cnt")?.textContent,
  hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
console.log(JSON.stringify(s));
if (s.courses < 200) problems.push(`only ${s.courses} courses in data`);
if (s.catalog < 3000) problems.push(`catalog has ${s.catalog} rows`);
if (!s.rows) problems.push("no course rows rendered");
if (s.hscroll) problems.push("page scrolls horizontally");

// Search narrows, and code shorthand works
await page.fill("#q", "cs 300");
await page.waitForTimeout(300);
const hit = await page.$$eval(".row[data-id]", (r) => r.map((x) => x.dataset.id));
console.log('search "cs 300" ->', hit.slice(0, 3));
if (!hit.includes("COMP-SCI-300")) problems.push('"cs 300" did not find COMP SCI 300');

// Every sort keeps the list non-empty
await page.fill("#q", "");
for (const v of ["gpa", "gpaL", "pa", "tr", "sp", "rd", "en", "code", "m"]) {
  await page.selectOption("#sort", v);
  const n = await page.$$eval(".row[data-id]", (r) => r.length);
  if (!n) problems.push(`sort ${v} emptied the list`);
}

// Course drawer renders charts and outbound links
await page.goto(URL.split("#")[0] + "#/c/MATH-234");
await page.waitForSelector("#drawer.on", { timeout: 10000 });
const d = await page.evaluate(() => ({
  title: document.querySelector("#dTitle")?.textContent,
  charts: document.querySelectorAll("#drawer svg").length,
  instructors: document.querySelectorAll("#drawer .itable tbody tr").length,
  mg: document.querySelector('#drawer a[href*="madgrades.com"]')?.href,
  rmp: document.querySelector('#drawer a[href*="ratemyprofessors.com"]')?.href,
}));
console.log(JSON.stringify(d));
if (d.charts < 2) problems.push("drawer is missing charts");
if (!d.instructors) problems.push("drawer has no instructors");
if (!d.mg || !d.rmp) problems.push("drawer is missing MadGrades or RMP links");

// Insights tab
await page.goto(URL.split("#")[0] + "#/insights");
await page.waitForSelector("#v-insights .panel", { timeout: 10000 });
const panels = await page.$$eval("#v-insights .panel", (p) => p.length);
console.log("insight panels", panels);
if (panels < 6) problems.push(`only ${panels} insight panels`);

// Phone width
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(URL, { waitUntil: "networkidle" });
if (await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth))
  problems.push("phone layout scrolls horizontally");

await browser.close();
if (failedReqs.length) console.log("failed requests:\n  " + failedReqs.join("\n  "));
console.log(problems.length ? "\nPROBLEMS:\n - " + problems.join("\n - ") : "\nsite OK");
process.exit(problems.length || failedReqs.length ? 1 : 0);

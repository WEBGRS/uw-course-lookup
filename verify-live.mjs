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
  extra: window.UWCL?.courses?.filter((c) => c.src === "catalog").length || 0,
  rows: document.querySelectorAll(".row[data-id]").length,
  count: document.querySelector("#cnt")?.textContent,
  hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
console.log(JSON.stringify(s));
if (s.courses < 4000) problems.push(`only ${s.courses} courses in data`);
if (s.extra < 3000) problems.push(`only ${s.extra} catalog-tier courses`);
if (!s.rows) problems.push("no course rows rendered");
if (s.hscroll) problems.push("page scrolls horizontally");

// Search narrows, and code shorthand works
await page.fill("#q", "cs 300");
await page.waitForTimeout(300);
const hit = await page.$$eval(".row[data-id]", (r) => r.map((x) => x.dataset.id));
console.log('search "cs 300" ->', hit.slice(0, 3));
if (!hit.includes("COMP-SCI-300")) problems.push('"cs 300" did not find COMP SCI 300');

// Title words + number, and a catalog-tier course, are findable
await page.fill("#q", "calculus 234");
await page.waitForTimeout(300);
if (!(await page.$$eval(".row[data-id]", (r) => r.map((x) => x.dataset.id))).includes("MATH-234")) problems.push('"calculus 234" did not find MATH 234');
const extraId = await page.evaluate(() => window.UWCL.courses.find((c) => c.src === "catalog" && c.dist && c.now)?.id);
if (!extraId) problems.push("no catalog-tier course with grades and seats");

// Every sort keeps the list non-empty
await page.fill("#q", "");
for (const v of ["gpa", "gpaL", "pa", "tr", "tl", "sp", "rd", "en", "code", "m"]) {
  await page.selectOption("#sort", v);
  const n = await page.$$eval(".row[data-id]", (r) => r.length);
  if (!n) problems.push(`sort ${v} emptied the list`);
}

// Lenses narrow the list and the band follows the hovered row
const num = async () => (await page.textContent("#cnt")).replace(/,/g, "");
const total = +(await num()).match(/of (\d+)/)[1];
await page.click('[data-lens="easy"]');
const easy = +(await num()).match(/^(\d+)/)[1];
if (!easy || easy >= total) problems.push(`lens "easy" did not narrow the list (${easy} of ${total})`);
await page.click('[data-lens="easy"]');
const before = await page.textContent("#bandL");
await page.hover(".row[data-id]:nth-of-type(3)");
await page.waitForTimeout(200);
if ((await page.textContent("#bandL")) === before) problems.push("grade band did not follow the hovered row");

// Chinese UI
await page.click("#langBtn");
const zh = await page.evaluate(() => ({ lang: document.documentElement.lang, tab: document.querySelector('[data-tab="courses"]').textContent }));
console.log("zh", JSON.stringify(zh));
if (zh.lang !== "zh-CN" || zh.tab !== "课程") problems.push("language toggle did not switch to Chinese");
await page.click("#langBtn");

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
if (d.charts < 3) problems.push("drawer is missing charts");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(200);
if ((await page.evaluate(() => location.hash)) === "#/c/MATH-234") problems.push("ArrowRight did not move to the next course");
if (!d.instructors) problems.push("drawer has no instructors");
if (!d.mg || !d.rmp) problems.push("drawer is missing MadGrades or RMP links");

// A catalog-tier course opens a drawer with grades and no peer-signal charts
if (extraId) {
  await page.goto(URL.split("#")[0] + "#/c/" + extraId);
  await page.waitForSelector("#drawer.on", { timeout: 10000 });
  const e = await page.evaluate(() => ({ charts: document.querySelectorAll("#drawer svg").length, say: document.querySelector("#drawer .d-sec:last-child")?.textContent.length }));
  console.log("catalog-tier drawer", extraId, JSON.stringify(e));
  if (e.charts < 1) problems.push("catalog-tier drawer has no chart");
}

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

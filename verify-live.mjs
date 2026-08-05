// Verify the deployed site actually works, not just that it returns 200.
// Run before pointing anyone at it:  node verify-live.mjs
import { chromium } from "playwright";

const URL = process.env.URL || "https://webgrs.github.io/uw-course-lookup/";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1340, height: 900 } });
const problems = [];
const failedReqs = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
page.on("requestfailed", (r) => failedReqs.push(`${r.url()} - ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`); });

console.log("GET", URL);
const res = await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
console.log("http", res.status());

await page.waitForSelector("#tb tr", { timeout: 30000 });

const s = await page.evaluate(() => ({
  rows: document.querySelectorAll("#tb tr").length,
  count: document.querySelector("#cnt")?.textContent?.trim(),
  sorters: document.querySelectorAll("#s_n, #s_code, #s_rec").length,
  hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
console.log(JSON.stringify(s));

// The post claims 256 courses; if the deployed data ever drifts, the claim is wrong.
if (s.rows < 250) problems.push(`only ${s.rows} rows rendered, expected ~256`);
if (s.sorters !== 3) problems.push(`expected 3 sort buttons, found ${s.sorters}`);
if (s.hscroll) problems.push("page scrolls horizontally");

// Filtering is the thing every visitor does first.
await page.fill("#filter", "cs");
await page.waitForTimeout(400);
const csRows = await page.$$eval("#tb tr", (r) => r.length);
console.log(`filter "cs" -> ${csRows} rows`);
if (csRows === 0) problems.push('filtering by "cs" returned nothing');
if (csRows >= s.rows) problems.push('filtering by "cs" did not narrow the list');

// Sorting must not blank the table.
for (const id of ["s_code", "s_rec", "s_n"]) {
  await page.click("#" + id);
  await page.waitForTimeout(250);
  const n = await page.$$eval("#tb tr", (r) => r.length);
  if (n !== csRows) problems.push(`sort ${id} changed row count ${csRows} -> ${n}`);
}

await page.fill("#filter", "");
await page.waitForTimeout(400);

// The two outbound buttons are the whole point of the tool; check they target the right hosts.
await page.fill("#mgIn", "CS 300");
const mgUrl = await page.evaluate(() => {
  let captured = null;
  const open = window.open;
  window.open = (u) => { captured = u; return null; };
  document.querySelector("button.mg").click();
  window.open = open;
  return captured || location.href;
});
console.log("MadGrades ->", mgUrl);
if (!/madgrades\.com/i.test(mgUrl)) problems.push("MadGrades button did not target madgrades.com");

await page.fill("#rmpIn", "Beck Hasti");
const rmpUrl = await page.evaluate(() => {
  let captured = null;
  const open = window.open;
  window.open = (u) => { captured = u; return null; };
  document.querySelector("button.rmp").click();
  window.open = open;
  return captured || location.href;
});
console.log("RMP ->", rmpUrl);
if (!/ratemyprofessors\.com/i.test(rmpUrl)) problems.push("RMP button did not target ratemyprofessors.com");

await browser.close();

if (failedReqs.length) console.log("failed requests:\n  " + failedReqs.join("\n  "));
console.log(problems.length ? "\nPROBLEMS:\n - " + problems.join("\n - ") : "\nlive site OK");
process.exit(problems.length || failedReqs.length ? 1 : 0);

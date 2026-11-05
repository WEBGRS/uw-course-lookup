// Pure helpers for what the page says about a course. No DOM, so the Node tests import them too.

const r3 = (v) => Math.round(v * 1000) / 1000;

/** A share and D+F share; the export drops zero values, so they come from the distribution when missing. */
export function shares(c) {
  const d = c.dist, tot = d ? d.reduce((a, b) => a + b, 0) : 0;
  if (!tot) return { pa: c.pa ?? null, pdf: c.pdf ?? null };
  return { pa: c.pa ?? r3(d[0] / tot), pdf: c.pdf ?? r3((d[5] + d[6]) / tot) };
}

/** The number a list sort ranks by, as [string key, value], when the row does not show it already. */
export function sortValue(c, sort) {
  if (sort === "gpa" || sort === "gpaL") return c.gs != null && c.n >= 50 ? ["svGpa", c.gs] : null;
  if (sort === "en") return c.en ? ["svEn", c.en] : c.sz ? ["svSz", c.sz] : null;
  if (sort === "m") return c.m ? ["chat", c.m] : c.ms ? ["chatFew", 0] : c.rdn ? ["reddit", c.rdn] : null;
  return null;
}

// First names that are the same person (Tom = Thomas, Grzegorz = Gregory); a surname alone never matches
const NICK = [
  "thomas tom tommy", "james jim jimmy jamie", "matthew matt", "joshua josh", "katherine catherine kathryn katharine kate katie kathy cathy kat",
  "gregory grzegorz greg", "bernard bernie", "cassandra cassie", "william will bill billy liam", "robert rob bob bobby robbie",
  "richard rich rick ricky dick", "michael mike mikey mick", "christopher chris", "christine christina chris tina", "daniel dan danny",
  "david dave", "joseph joe joey", "jonathan jon", "john jack johnny", "nicholas nick nicky", "anthony tony", "andrew andy drew",
  "alexander alex", "alexandra alex sasha", "benjamin ben", "samuel sam", "samantha sam", "elizabeth liz beth betsy lizzie eliza",
  "margaret maggie meg peggy", "jennifer jen jenny", "jessica jess", "rebecca becky becca", "patricia pat patty trish", "patrick pat",
  "steven stephen steve", "timothy tim", "kenneth ken kenny", "edward ed eddie ted", "theodore ted theo", "charles charlie chuck",
  "jeffrey jeff", "gerald jerry gerry", "peter pete", "ronald ron", "donald don", "douglas doug", "frederick fred", "lawrence larry",
  "leonard len leo", "nathaniel nate nat", "nathan nate", "zachary zach zack", "abigail abby", "deborah deb debbie", "susan sue susie",
  "suzanne sue", "victoria vicky tori", "kimberly kim", "pamela pam", "jacob jake", "raymond ray", "eugene gene", "philip phillip phil",
  "gabriel gabe", "gabrielle gabby", "vincent vince", "albert al", "allen al", "alan al", "kristopher kris", "jeremy jerry", "jerome jerry",
  "randall randy", "stanley stan", "terrence terry", "teresa theresa terry tess", "walter walt", "harold hal harry", "henry hank harry",
  "mitchell mitch", "russell russ", "bradley brad", "cameron cam", "frances fran", "francis frank", "franklin frank", "jacqueline jackie",
  "judith judy", "kathleen kathy", "melissa missy", "nancy nan", "pauline paula", "sandra sandy", "valerie val", "virginia ginny",
].map((g) => new Set(g.split(" ")));
const sameFirst = (a, b) => a === b || NICK.some((g) => g.has(a) && g.has(b));

/** Enroll and MadGrades spell names differently: same surname and the same or a nickname first name. */
export function sameName(a, b) {
  const pa = String(a).toLowerCase().split(/\s+/), pb = String(b).toLowerCase().split(/\s+/);
  return pa[pa.length - 1] === pb[pb.length - 1] && sameFirst(pa[0], pb[0]);
}

/** The instructor record for someone teaching now: the one flagged as teaching, else any spelling match. */
export const historyOf = (ins, name) => ins.find((i) => i[5] && sameName(i[0], name)) || ins.find((i) => sameName(i[0], name)) || null;

/** Instructor rows with identical numbers taught the same students (TAs, co-teachers): one group per set of numbers. */
export function mergeInstructors(ins, teachingNow = []) {
  const now = new Set(teachingNow.map((n) => historyOf(ins, n)).filter(Boolean)), groups = new Map();
  for (const i of ins) {
    const k = [i[1], i[2], i[3], i[4]].join("|"), g = groups.get(k);
    const p = { name: i[0], now: !!i[5] || now.has(i) };
    if (g) g.people.push(p); else groups.set(k, { i, people: [p] });
  }
  return [...groups.values()];
}

/** This term's lectures: one group per lead section (LEC or SEM, else the first) with the packages that use it. */
export function lectureGroups(pk) {
  const groups = new Map();
  for (const p of pk || []) {
    const lead = p.s.find((s) => s.t === "LEC" || s.t === "SEM") || p.s[0];
    if (!lead) continue;
    const g = groups.get(lead.t + lead.n) || { lead, pkgs: [] };
    g.pkgs.push(p); groups.set(lead.t + lead.n, g);
  }
  return [...groups.values()];
}

/** A GPA trend this small rounds to ±0.00 a year: say "flat" instead. */
export const isFlat = (tr) => Math.abs(tr) < 0.005;

/** Compare picks: toggle one course, keeping between `min` and `max` picked. */
export function togglePick(picked, id, max = 8, min = 2) {
  if (picked.includes(id)) return picked.length > min ? picked.filter((x) => x !== id) : picked;
  return picked.length < max ? [...picked, id] : picked;
}

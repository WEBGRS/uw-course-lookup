// Query engine for the course API. Pure JS (no Workers APIs) so it runs in Node tests too.
// Everything expensive happens once in buildIndex(); a request only scans typed arrays.

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const toks = (s) => s.split(/[^a-z0-9]+/).filter(Boolean);
const SHORT = { cs: "compsci", compsci: "compsci", stats: "stat", ece: "ece", polisci: "polisci", psych: "psych", bio: "biology", nutrisci: "nutrsci", ee: "ece", me: "me" };

export const SORT_KEYS = ["m", "gpa", "gpaL", "pa", "tr", "tl", "sp", "rd", "en", "code"];
export const LENS_KEYS = ["easy", "intro", "instr", "harder", "easier", "open", "reddit"];
export const LIMITS = { rows: 60, offset: 4600, ids: 60, compare: 8 };

const nz = (v, d) => (v == null ? d : v);

// Records may omit empty fields (catalog tier); fill them so every course has one shape.
function fill(c) {
  c.al ||= []; c.br ||= []; c.ins ||= []; c.rd ||= []; c.terms ||= [];
  c.m ||= 0; c.pos ||= 0; c.neg ||= 0; c.rdn ||= 0; c.n ||= 0; c.es ||= 0; c.sn ??= ""; c.t ??= "";
  return c;
}

const LENSES = {
  easy: (c) => c.gs != null && c.gs >= 3.7 && c.n >= 500,
  intro: (c) => c.num < 300 && (c.en || 0) >= 250,
  instr: (c) => c.sp != null && c.sp >= 0.6,
  harder: (c) => c.tr != null && c.tr <= -0.03,
  easier: (c) => c.tr != null && c.tr >= 0.03,
  open: (c) => !!(c.now && c.now.open > 0),
  reddit: (c) => c.rdn >= 8,
};

const MIN_GRADED = 50;  // GPA sorts ignore courses with too few graded students
const gsr = (c) => (c.n >= MIN_GRADED ? c.gs : null);

const SORTS = {
  m: (a, b) => b.m - a.m || b.rdn - a.rdn || nz(b.en, 0) - nz(a.en, 0),
  gpa: (a, b) => nz(gsr(b), -1) - nz(gsr(a), -1),
  gpaL: (a, b) => nz(gsr(a), 9) - nz(gsr(b), 9),
  pa: (a, b) => nz(b.pa, -1) - nz(a.pa, -1),
  tr: (a, b) => nz(b.tr, -9) - nz(a.tr, -9),
  tl: (a, b) => nz(a.tr, 9) - nz(b.tr, 9),
  sp: (a, b) => nz(b.sp, -1) - nz(a.sp, -1),
  rd: (a, b) => b.rdn - a.rdn || b.m - a.m,
  en: (a, b) => nz(b.en, -1) - nz(a.en, -1),
  code: (a, b) => a.code.localeCompare(b.code, "en", { numeric: true }),
};

// The slim record the list needs; everything else is fetched per course.
function toRow(c) {
  const r = { id: c.id, code: c.code, t: c.t, num: c.num, src: c.src };
  if (c.al.length) r.al = c.al;
  if (c.sa) r.sa = c.sa;
  if (c.cr) r.cr = c.cr;
  if (c.br.length) r.br = c.br;
  if (c.n) r.n = c.n;
  for (const k of ["gpa", "gs", "pa", "tr", "sp", "en"]) if (c[k] != null) r[k] = c[k];
  if (c.dist) r.dist = c.dist;
  const sk = c.terms.filter((x) => x[2] >= 10 && x[0] % 10 !== 6).slice(-12).map((x) => x[1]);
  if (sk.length >= 3) r.sk = sk;
  if (c.m) r.m = c.m;
  if (c.ms) r.ms = 1;
  if (c.rdn) r.rdn = c.rdn;
  if (c.now) r.now = { open: c.now.open, wait: c.now.wait, who: c.now.who };
  return r;
}

export function buildIndex(data) {
  const detailJson = data.courses.map((c) => JSON.stringify(c));  // as exported, before defaults are filled
  const C = data.courses.map(fill);
  const n = C.length;
  const ix = { n, C, meta: data.meta, insights: data.insights, detailJson };

  ix.ids = new Map(C.map((c, i) => [c.id, i]));
  ix.rowJson = C.map((c) => JSON.stringify(toRow(c)));

  // numeric columns
  ix.num = Int32Array.from(C, (c) => c.num);
  ix.gpa = Float32Array.from(C, (c) => nz(c.gpa, NaN));
  ix.hasNow = Uint8Array.from(C, (c) => (c.now ? 1 : 0));
  ix.sa = C.map((c) => c.sa || "");
  ix.es = Uint8Array.from(C, (c) => (c.es ? 1 : 0));
  ix.ge = Uint8Array.from(C, (c) => (c.ge ? 1 : 0));
  ix.lens = {};
  for (const k of LENS_KEYS) ix.lens[k] = Uint8Array.from(C, (c) => (LENSES[k](c) ? 1 : 0));

  // text columns
  ix.codes = C.map((c) => [c.code, ...c.al].map(norm));
  ix.main = C.map((c) => " " + toks([c.code, ...c.al, c.t, c.sn].join(" ").toLowerCase()).join(" "));
  ix.people = C.map((c) => {
    const names = new Set([...c.ins.map((i) => i[0]), ...(c.now ? c.now.who : [])]);
    return [...names].map((nm) => " " + toks(nm.toLowerCase()).join(" "));
  });
  ix.subjKeys = [...new Set(C.flatMap((c) => [c.code, ...c.al]).map((x) => norm(x.replace(/\s*\d.*$/, ""))))];

  // one pre-sorted order per sort key (stable, so ties keep the export order)
  ix.order = {};
  const base = Array.from({ length: n }, (_, i) => i);
  for (const k of SORT_KEYS) ix.order[k] = Int32Array.from(base.slice().sort((a, b) => SORTS[k](C[a], C[b])));

  ix.metaJson = JSON.stringify(makeMeta(ix));
  ix.insightsJson = JSON.stringify(data.insights || {});
  return ix;
}

function makeMeta(ix) {
  const lens = { "": ix.n };
  for (const k of LENS_KEYS) lens[k] = ix.lens[k].reduce((a, b) => a + b, 0);
  const first = Math.min(...ix.C.filter((c) => c.terms.length).map((c) => c.terms[0][0]));
  return {
    built_at: ix.meta.built_at, term: ix.meta.term, campusDist: ix.meta.campusDist, campusGpa: ix.meta.campusGpa,
    count: ix.n, first, lens,
    subjects: [...new Set(ix.C.map((c) => c.sa).filter(Boolean))].sort(),
    breadths: [...new Set(ix.C.flatMap((c) => c.br))].sort(),
    featured: ix.C.filter((c) => c.src !== "catalog").length,
  };
}

// "cs 5", "math 23", "ece" read as a course-code prefix, not as title words
function codeLike(ix, nq) {
  const m = nq.match(/^([a-z]+)(\d{0,3})$/);
  return !!m && (!!m[2] || m[1].length <= 3) && ix.subjKeys.some((k) => k.startsWith(SHORT[m[1]] || m[1]));
}

function makeMatcher(ix, q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return null;
  const nq = norm(q);
  if (!nq) return null;
  const expanded = nq.replace(/^([a-z]+)/, (m) => SHORT[m] || m);
  if (codeLike(ix, nq)) return (i) => ix.codes[i].some((x) => x.startsWith(nq) || x.startsWith(expanded));
  const ws = q.split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  return (i) => {
    if (ix.codes[i].some((x) => x.includes(nq))) return true;
    const main = ix.main[i];
    const rest = ws.filter((w) => !main.includes(" " + w));
    if (!rest.length) return true;
    return ix.people[i].some((p) => rest.every((w) => p.includes(" " + w)));
  };
}

const int = (v, d, lo, hi) => {
  const x = Number.parseInt(v, 10);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
};

// params: URLSearchParams-like (get). Returns {total, rows: [json strings]}.
export function query(ix, params) {
  const g = (k) => params.get(k) || "";
  const sort = SORT_KEYS.includes(g("sort")) ? g("sort") : "m";
  const lens = LENS_KEYS.includes(g("lens")) ? ix.lens[g("lens")] : null;
  const subj = g("subj"), lvl = g("lvl"), br = g("br"), minGpa = g("gpa") ? parseFloat(g("gpa")) : null;
  const now = g("now") === "1";
  const idSet = g("ids") ? new Set(g("ids").split(",").slice(0, LIMITS.ids).map((s) => ix.ids.get(s)).filter((v) => v != null)) : null;
  const match = makeMatcher(ix, g("q"));
  const offset = int(g("offset"), 0, 0, LIMITS.offset);
  const limit = int(g("limit"), LIMITS.rows, 1, LIMITS.rows);

  const order = ix.order[sort], C = ix.C;
  let total = 0;
  const rows = [];
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (idSet && !idSet.has(i)) continue;
    if (lens && !lens[i]) continue;
    if (subj && ix.sa[i] !== subj) continue;
    if (lvl && !(lvl === "5" ? ix.num[i] >= 500 : Math.floor(ix.num[i] / 100) === +lvl)) continue;
    if (br && !(br === "__es" ? ix.es[i] : br === "__ge" ? ix.ge[i] : C[i].br.includes(br))) continue;
    if (minGpa != null && !(ix.gpa[i] >= minGpa)) continue;
    if (now && !ix.hasNow[i]) continue;
    if (match && !match(i)) continue;
    if (total >= offset && rows.length < limit) rows.push(ix.rowJson[i]);
    total++;
  }
  return { total, rows };
}

export function detail(ix, id) {
  const i = ix.ids.get(id);
  return i == null ? null : ix.detailJson[i];
}

export function details(ix, ids) {
  return ids.slice(0, LIMITS.compare).map((id) => detail(ix, id)).filter(Boolean);
}

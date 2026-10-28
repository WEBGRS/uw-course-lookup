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

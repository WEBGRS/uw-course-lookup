// Pure helpers for what the page says about a course. No DOM, so the Node tests import them too.

const r3 = (v) => Math.round(v * 1000) / 1000;

/** A share and D+F share; the export drops zero values, so they come from the distribution when missing. */
export function shares(c) {
  const d = c.dist, tot = d ? d.reduce((a, b) => a + b, 0) : 0;
  if (!tot) return { pa: c.pa ?? null, pdf: c.pdf ?? null };
  return { pa: c.pa ?? r3(d[0] / tot), pdf: c.pdf ?? r3((d[5] + d[6]) / tot) };
}

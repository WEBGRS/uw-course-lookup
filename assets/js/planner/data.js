// Per-course planner data (facts + sections with meeting times), fetched in batches and cached.
import { api } from "../core.js";

export const PLAN_DATA = {};   // primary id -> {code, t, cr, gpa, prq, br, ins, pk}
const ALIAS = {};              // any requested id -> primary id (or "" when the server has nothing)

export async function loadPlanData(ids) {
  const need = [...new Set(ids)].filter((id) => !(id in ALIAS));
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    const r = await api("/api/plan", { ids: chunk.join(",") });
    Object.assign(PLAN_DATA, r.courses);
    for (const id of chunk) ALIAS[id] = r.map[id] || (r.courses[id] ? id : "");
  }
  return ids.map(planOf);
}

/** Resolve an id the user or a program used (maybe a cross-listing) to loaded data, or null. */
export function planOf(id) {
  const pid = ALIAS[id];
  return pid && PLAN_DATA[pid] ? { id: pid, ...PLAN_DATA[pid] } : null;
}

// Saved courses and the plan follow the visitor's madisonstudents.com account (account.js) when signed in.
// Local storage stays the working copy; the account gets a copy after each change and is read on load and sign-in.
import { plan, store, emit } from "./core.js";

const SITE = "courses";
const acct = () => window.MSAccount;
let dirty = store.get("syncDirty", false);   // local changes the account has not seen
let seen = store.get("syncSeen", 0);         // server time of the copy last pulled or pushed
let owner = store.get("syncOwner", "");      // account this device's copy came from ("" = never synced)
let timer = 0, applying = false, lastPull = 0;

const snapshot = () => ({ must: [...plan.must], done: [...plan.done], ip: [...plan.ip], program: plan.program, crMin: plan.crMin, crMax: plan.crMax, mainMax: plan.mainMax, creditOf: plan.creditOf, grad: plan.grad, earned: plan.earned, fill: plan.fill, prefs: plan.prefs });
const setDirty = (v) => { dirty = v; store.set("syncDirty", v); };
const setSeen = (v) => { seen = v; store.set("syncSeen", v); };
const setOwner = (v) => { owner = v; store.set("syncOwner", v); };

const save = plan.save.bind(plan);
plan.save = function () {
  save();
  if (applying) return;
  setDirty(true);
  if (acct() && acct().user) { clearTimeout(timer); timer = setTimeout(push, 1200); }
};

function apply(d) {
  const program = plan.program;
  applying = true;
  for (const k of ["must", "done", "ip"]) { plan[k].clear(); (d[k] || []).forEach((id) => typeof id === "string" && plan[k].add(id)); }
  plan.program = typeof d.program === "string" ? d.program : "";
  plan.crMin = +d.crMin || +d.credits || 12;
  plan.crMax = Math.max(plan.crMin, +d.crMax || 16);
  plan.grad = +d.grad || 0;
  plan.mainMax = +d.mainMax || 0;
  plan.creditOf = d.creditOf && typeof d.creditOf === "object" ? d.creditOf : {};
  plan.earned = d.earned == null ? null : +d.earned;
  plan.fill = d.fill !== false;
  plan.prefs = d.prefs && typeof d.prefs === "object" ? d.prefs : {};
  plan.save();
  applying = false;
  emit("plan");
  emit("plan-sync", { programChanged: plan.program !== program });
}

// Both sides changed: keep every course from either, and this device's settings where it has them
function merge(server) {
  const local = snapshot();
  const u = (k) => [...new Set([...(server[k] || []), ...local[k]])];
  return {
    must: u("must"), done: u("done"), ip: u("ip"),
    program: local.program || server.program || "",
    crMin: local.crMin !== 12 ? local.crMin : +server.crMin || +server.credits || 12,
    crMax: local.crMax !== 16 ? local.crMax : +server.crMax || 16,
    mainMax: local.mainMax || +server.mainMax || 0, creditOf: { ...(server.creditOf || {}), ...local.creditOf }, grad: local.grad || +server.grad || 0, earned: local.earned ?? server.earned ?? null,
    fill: local.fill, prefs: { ...(server.prefs || {}), ...local.prefs },
  };
}
const isEmpty = (s) => !s.must.length && !s.done.length && !s.ip.length && !s.program;

async function push(beacon = false) {
  clearTimeout(timer);
  if (!acct() || !acct().user || !dirty) return;
  try {
    const r = await acct().save(SITE, snapshot(), { beacon });
    setSeen(r.updated); setDirty(false); setOwner(acct().user.email);
  } catch { /* stays dirty; the next change or visit retries */ }
}

async function pull(signin) {
  lastPull = Date.now();
  let r;
  try { r = await acct().load(SITE); } catch { return; }
  const email = acct().user && acct().user.email;
  if (!email) return;
  // Another account's copy on this device: replace it, never mix the two
  if (owner && owner !== email) {
    if (r.data) { apply(r.data); setSeen(r.updated); setDirty(false); setOwner(email); }
    else { apply({}); setSeen(0); setDirty(false); setOwner(email); }
    return;
  }
  if (!r.data) { if (!isEmpty(snapshot())) { setDirty(true); push(); } else setOwner(email); return; }
  const serverNew = r.updated > seen;
  if (signin && serverNew && !isEmpty(snapshot())) { apply(merge(r.data)); setDirty(true); push(); return; }
  if (serverNew && !dirty) { apply(r.data); setSeen(r.updated); setOwner(email); return; }
  if (serverNew && dirty) { apply(merge(r.data)); setDirty(true); push(); return; }
  if (dirty) push();
}

export function initSync() {
  const a = acct();
  if (!a) return;
  a.ready.then((u) => { if (u) pull(false); });
  a.on((u, why) => {
    if (why === "signin") { setSeen(0); pull(true); }
    else { clearTimeout(timer); setSeen(0); setDirty(false); if (why === "delete") setOwner(""); }
  });
  document.addEventListener("visibilitychange", () => {
    if (!a.user) return;
    if (document.visibilityState === "hidden") push(true);
    else if (Date.now() - lastPull > 60000) pull(false);
  });
}

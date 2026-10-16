// Find classmates in the course drawer: needs a madisonstudents.com account; opens next semester.
import { $, esc, plan } from "./core.js";
import { t } from "./i18n.js";

const acct = () => window.MSAccount;

/** Fill #dMates. The button opens the account panel with an optional WeChat ID, saved to the plan (and so the account). */
export function mount() {
  const el = $("#dMates");
  if (!el) return;
  el.innerHTML = `<div class="mt-row"><button class="btn" type="button" id="dMt">${esc(t("mtFind") + t("mtSoon"))}</button></div>`;
  const b = $("#dMt", el);
  if (!acct()) { b.disabled = true; return; }
  b.onclick = () => acct().open(b, {
    title: t("mtFind"),
    field: { label: t("mtWechat"), value: plan.wechat, maxlength: 40, onInput: (v) => { plan.wechat = v.trim().slice(0, 40); plan.save(); } },
  });
}

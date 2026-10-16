// Find classmates in the course drawer: needs a madisonstudents.com account; opens next semester.
import { $, esc } from "./core.js";
import { t } from "./i18n.js";

const acct = () => window.MSAccount;

/** Fill #dMates: signed out, the button opens sign-in (account.js handles [data-account]); signed in, it waits for next semester. */
export function mount() {
  const el = $("#dMates");
  if (!el) return;
  const user = acct() && acct().user;
  el.innerHTML = `<div class="mt-row"><button class="btn" type="button"${user ? " disabled" : " data-account"}>${esc(t("mtFind"))}</button>` +
    `<span class="mt-soon">${esc(t("mtSoon"))}</span></div>`;
}

if (acct()) { acct().ready.then(mount); acct().on(mount); }

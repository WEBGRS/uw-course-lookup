// Language: English / 中文. Dictionaries live in lang/*.js; keys missing in Chinese fall back to English.
import { store, app, emit } from "./core.js";
import EN from "./lang/en.js";
import ZH from "./lang/zh.js";

const DICT = { en: EN, zh: ZH };
export let LANG = store.get("lang", null) || ((navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en");

export function t(k, ...a) {
  const v = DICT[LANG][k] ?? EN[k];
  return typeof v === "function" ? v(...a) : (v ?? k);
}
export function setLang(l) {
  LANG = l; store.set("lang", l);
  document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  emit("lang", l);
}

export function termLabel(tc) {
  const y = 2000 + (Math.floor(tc / 10) % 100), s = tc % 10;
  if (LANG === "zh") return ({ 2: `${y - 1} 秋`, 4: `${y} 春`, 6: `${y} 夏` })[s] || String(tc);
  return ({ 2: `Fall ${y - 1}`, 4: `Spring ${y}`, 6: `Summer ${y}` })[s] || String(tc);
}
export const termShort = (tc) => { const y = 2000 + (Math.floor(tc / 10) % 100); return ({ 2: "F" + String(y - 1).slice(2), 4: "S" + String(y).slice(2), 6: "Su" + String(y).slice(2) })[tc % 10] || String(tc); };
export const termYear = (tc) => { const y = 2000 + (Math.floor(tc / 10) % 100); return ({ 2: y - 1 + 0.7, 4: y + 0.1, 6: y + 0.45 })[tc % 10] || y; };

const BRZ = { "Humanities": "人文", "Literature": "文学", "Social Science": "社会科学", "Natural Science": "自然科学", "Biological Science": "生物科学", "Physical Science": "物理科学", "Ethnic Studies": "族裔研究" };
const LVZ = { "Elementary": "初级", "Intermediate": "中级", "Advanced": "高级" };
export const brName = (b) => (LANG === "zh" ? BRZ[b] || b : b);
export const lvlName = (l) => (LANG === "zh" && l ? l.split(", ").map((x) => LVZ[x] || x).join("、") : l);
export const termNow = () => termLabel(app.term);

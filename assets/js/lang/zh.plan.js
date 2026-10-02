import { fmt } from "../core.js";

export default {
  // chrome
  tabCourses: "课程", tabPlan: "排课", tabInsights: "洞察", ask: "问问", about: "数据说明",
  langTip: "Switch to English", langBtn: "EN", themeTip: "深浅色", skip: "跳到正文",
  loading: "加载中…", apiError: "连不上课程服务器。", retry: "重试", close: "关闭",
  foot: (d) => `数据构建于 ${d}，来自 MadGrades、Course Search & Enroll 和 r/UWMadison。与 UW–Madison 官方无关。`, src: "源码",

  // course list
  searchPh: "搜课号、课名或老师", filters: (n) => (n ? `筛选 · ${n}` : "筛选"), sortBy: "排序",
  s_m: "讨论最多", s_gpa: "GPA 最高", s_gpaL: "GPA 最低", s_pa: "A 最多", s_tr: "给分变松", s_tl: "给分变严",
  s_sp: "最看老师", s_rd: "Reddit 最多", s_en: "本学期最大", s_code: "按课号",
  subject: "学科", level: "级别", breadth: "Breadth", minGpa: "最低 GPA", lens: "查看",
  allSubj: "全部学科", anyLvl: "全部级别", anyBr: "全部 breadth", anyGpa: "不限", inPlan: "我的计划", clear: "清除",
  offered: (t) => `${t} 开课`, esOpt: "族裔研究 (Ethnic Studies)", geOpt: "Comm A/B 或 QR",
  lens_: "全部课程", lens_easy: "高分大课", lens_intro: "大型入门课", lens_instr: "看老师的课",
  lens_harder: "越来越难", lens_easier: "越来越松", lens_open: "现在有空位", lens_reddit: "Reddit 热议",
  count: (n, all) => (n === all ? `${fmt(all)} 门课` : `${fmt(all)} 门中的 ${fmt(n)} 门`), more: "显示更多",
  open: "有空位", wait: "候补", full: "已满", notTerm: "本学期不开", enrolledN: (n) => `${fmt(n)} 人`,
  empty: "没有符合条件的课，减少筛选试试。", cr: (c) => `${c} 学分`,
  addPlan: "加入计划", inPlanBtn: "已在计划", removePlan: "移出",

  // drawer
  mg: "MadGrades", cse: "选课系统", guide: "课程目录", searchReddit: "Reddit", copy: "复制链接", copied: "已复制",
  prev: "上一门", next: "下一门", credits: (c) => `${c} 学分`, usually: (s) => `通常开课：${s.toLowerCase()}`, alsoAs: "同", req: "先修要求",
  kGpa: "GPA", kRecent: "近期 GPA", kA: "拿 A", kDF: "D 或 F", kNow: (t) => `${t} 人数`,
  thisTerm: "本学期", noSections: "本学期没有开课。", teaching: "授课", pastHere: (g) => `本课 GPA ${g}`, noHist: "首次开",
  lastTaught: (l) => (l ? `上次开课 ${l}。` : ""),
  grades: "成绩", studentsRange: (n, a, b) => `${fmt(n)} 名学生，${a} – ${b}`, thisCourse: "本课", allTracked: (n) => `全部 ${fmt(n)} 门课`,
  byTerm: "每学期 GPA", trackedAvg: (g) => `全校 ${g}`, noGrades: "没有字母成绩记录。",
  instructors: "老师", spread: (s) => `相差 ${s} 绩点`, instrLegend: (t) => `点越大学生越多 · 描边 = ${t} 在教`,
  thLinks: "链接",
  thName: "姓名", thGpa: "GPA", thA: "A 比例", thN: "学生数", thLast: "最近", thin: "不足 30 人的样本偏小。",
  showAll: (n) => `显示全部 ${n} 位`, showFewer: "收起",
  say: "同学怎么说", sayCatalog: "这门课没有群聊和 Reddit 数据。",
  sayEnroll: "本学期人数最多的课之一。", sayChatFew: "在学生群里被提到不到 3 次。",
  sayChat: (m, p, n) => `在学生群里被提到 <b>${m}</b> 次${p || n ? `（正面 ${p}，负面 ${n}）` : ""}`,
  sayReddit: (n, tone) => `${n ? `。r/UWMadison 上有 <b>${n}</b> 个帖子${tone ? `，${tone}` : ""}` : ""}。`,
  tonePos: "偏正面", toneNeg: "偏负面", toneMix: "褒贬不一",
  seatsOf: (o, c) => `${c} 个名额中 ${o} 个空位`,

  // compare
  compare: "对比", cmpTitle: "对比课程", cmpTrend: "每学期 GPA",
  rTitle: "课名", rCr: "学分", rGpa: "GPA", rA: "A 比例", rDF: "D 或 F", rTr: "趋势", rSp: "老师差距", rBr: "Breadth",

  // plan
  planTitle: (t) => `${t} 排课`,
  stepDegree: "学位", stepCourses: "课程", stepSchedule: "课表",
  program: "专业", programPh: "搜你的专业，如 Computer Sciences", noProgram: "选一个专业，看还差什么。",
  importBtn: "导入成绩单", importedN: (n) => `已导入 ${n} 门课`, importEdit: "编辑",
  importTitle: "导入已修课程",
  importHelp: "上传 unofficial transcript 或 DARS（PDF 或文本），也可以直接粘贴。内容不会离开你的浏览器。",
  importPaste: "…或把文字粘贴在这里", importChoose: "选择文件", importRead: "识别", importApply: "使用",
  importFound: (d, i) => `识别到 ${d} 门已修${i ? `、${i} 门在读` : ""}。`, importNone: "没找到课程。粘贴文字，或写成 “cs 300, math 221”。",
  importFailed: (n) => `${n} 门未通过（已忽略）`, importPdfError: "读不了这个 PDF，请粘贴它的文字。",
  taken: "已修", inProgress: "在读", add: "添加", added: "已添加", remove: "移除",
  reqDone: (a, b) => `${b} 项要求已满足 ${a} 项`, reqUnit: (u, h, n) => (u === "credits" ? `${h} / ${n} 学分` : `${h} / ${n}`),
  reqNote: "来自 UW Guide，仅供参考，请以 DARS 和导师为准。", reqInfo: "具体规则见 Guide",
  tookIt: "我修过", chooseN: (n) => (n === 1 ? "任选一门" : `任选 ${n} 门`),
  notOffered: "本学期不开", pickOne: "任选其一", viewGuide: "在 Guide 打开",
  fillLabel: "用剩余要求自动补满学分", targetCr: "学分", mustHave: "必修", mustEmpty: "在课程列表里点星标，或从要求里添加，或在下面搜索。",
  addCourse: "添加课程…", prefs: "偏好",
  noBefore: "不早于", noAfter: "不晚于", daysOff: "空出", seatsLbl: "名额", seatsOpen: "仅有空位", seatsWait: "空位或候补", seatsAny: "含已满",
  anyTime: "不限", freeDays: "多空几天", compact: "课集中", quality: "优先给分高的老师",
  build: "生成课表", building: "计算中…", variant: (i, n) => `方案 ${i} / ${n}`,
  schedCredits: (c) => `${c} 学分`, schedFree: (d) => (d.length ? `空 ${d.join(" ")}` : "每天有课"),
  schedSpan: (a, b) => `${a} – ${b}`, schedWait: (n) => `${n} 门候补`, schedFull: (n) => `${n} 门已满`,
  swap: "换班", classNo: "Class #", copyNums: "复制 class 号", icsBtn: "加入日历 (.ics)",
  online: "线上 / 无固定时间", consent: "需要同意",
  riskPrq: "留意先修", partTerm: "学期中段",
  why_none: (code, why) => ({
    full: `${code}：所有班都满了。可以允许已满，或换一门。`,
    waitlist: `${code}：只剩候补班。`,
    early: `${code}：所有班都早于你设的最早时间。`,
    late: `${code}：所有班都晚于你设的最晚时间。`,
    dayoff: `${code}：所有班都排在你想空出的日子。`,
    consent: `${code} 需要老师或系里同意，无法自动排。`,
    unscheduled: `${code} 本学期没有开课。`,
  }[why] || `${code} 没有可用的班。`),
  why_clash: (a, b) => `${a} 和 ${b} 的时间始终冲突。`,
  why_nofit: "没有能同时放下的组合。去掉一门，或放宽时间限制。",
  why_credits: (have, lo) => `最多只能排到 ${have} 学分，不到 ${lo}。降低目标或放宽限制。`,
  needTerm: "这个学期的上课时间还没公布。",
  planSummary: (n, c) => `${n} 门课 · ${c} 学分`,

  // agent
  agentTitle: "问问", agentHello: "问课程、老师、毕业要求或你的课表。",
  agentPh: "随便问…", agentSend: "发送", agentBusy: "思考中…", agentErr: "助手暂时不可用。",
  agentLimit: "助手今天的免费额度用完了，明天再试。", agentNew: "新对话",
  agentSug: ["哪些好过的课能排进 9 点到 5 点？", "和 COMP SCI 577 搭配上什么课？", "MATH 340 谁教得最好？"],
  tool_search: "搜索课程", tool_course: "查看课程", tool_plan: "查看你的计划", tool_build: "生成课表", tool_add: "更新计划",

  // insights
  insNote: (n, all) => `图表只覆盖 ${n} 门重点课，课程列表有全部 ${fmt(all)} 门。`,
  st_grades: "个字母成绩", st_instr: "位老师", st_reddit: "个 Reddit 帖", st_courses: "门重点课",
  p1: "热门不等于好过", p1l: (r) => `每个点是一门课。群聊热度几乎说明不了给分松紧（${r}）。`,
  xMent: "群聊提及次数（对数）", yGpa: "课程 GPA", chat: (n) => `群聊 ${n}`, chatFew: "群聊 <3",
  p2: "老师比课本身更关键", p2l: "同一门课，不同老师能差一个字母等级以上。",
  most: "给分最松", least: "给分最严",
  p3: "同学的评价靠谱吗？", p3l: "Spearman 秩相关。只有 Reddit 的语气和给分对得上。",
  c1: "群聊提及 vs GPA", c2: "群聊情绪 vs GPA", c3: "Reddit 语气 vs GPA", c4: "群聊 vs Reddit 热度", c5: "课号级别 vs GPA",
  thSignal: "信号", thResult: "结果", thReading: "解读",
  none: "无关", weak: "弱", moderate: "中等", strong: "强", positive: "正相关", negative: "负相关", ns: "，不显著", nodata: "数据不足",
  p4: "不同级别的给分", p4l: "200 和 300 级给分最严。", wStudents: "按学生数加权", medCourse: "中位数课程",
  lvlTip: (l, g, m, n) => `<b>${l}</b>：加权 ${g}，中位数 ${m}（${n} 门课）`,
  p5: "历年给分", p5l: "全校每学期 GPA，按学生数加权。", pandemic: "2020 春：疫情评分",
  p6: "给分变松", p6l: "2016 秋以来升得最快。", p7: "给分变严", p7l: "2016 秋以来降得最快。",
  p8: "热门但难", p8l: "提到 8 次以上，GPA 最低的在前。", p9: "高分但少有人提", p9l: "300+ 人、提及不超过 3 次。",
  p10: "按学科", p10l: "点一行筛选课程列表。",
  thCourse: "课程", thPerYr: "每年", thSubj: "学科", thCourses: "课程数", thMent: "提及",
  perYr: "/年",

  // about
  aboutHtml: `
    <h2 class="serif">数据从哪来</h2>
    <ul>
      <li><b>成绩</b>：<a href="https://madgrades.com" target="_blank" rel="noopener">MadGrades</a>，UW 按学期、班级和老师公开的成绩报告。GPA 只算字母成绩。</li>
      <li><b>开课和名额</b>：公开的 <a href="https://public.enroll.wisc.edu" target="_blank" rel="noopener">Course Search &amp; Enroll</a> 接口。名额是快照，选课前请以 Enroll 为准。</li>
      <li><b>毕业要求</b>：抄自 <a href="https://guide.wisc.edu" target="_blank" rel="noopener">UW Guide</a>，只做参考，最终以 DARS 为准。</li>
      <li><b>群聊和 Reddit</b>：学生群的汇总计数，以及 r/UWMadison 公开帖的标题。</li>
    </ul>
    <h2 class="serif">指标怎么看</h2>
    <ul>
      <li><b>调整后 GPA</b>：把小班课往学科平均拉，免得 12 人的研讨课压过 900 人的大课。</li>
      <li><b>趋势</b>：2016 秋以来 GPA 的年斜率。</li>
      <li><b>老师差距</b>：同一门课里给分最松和最严（各 30+ 人）的老师之差。</li>
    </ul>
    <p>代码、数据库结构和分析都在 <a href="https://github.com/WEBGRS/uw-course-lookup" target="_blank" rel="noopener">GitHub</a>。</p>`,
};

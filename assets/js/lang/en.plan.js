import { fmt } from "../core.js";

export default {
  // chrome
  tabCourses: "Courses", tabPlan: "Plan", tabInsights: "Insights", ask: "Ask", about: "About the data",
  langTip: "切换到中文", langBtn: "中文", themeTip: "Light or dark", skip: "Skip to content",
  loading: "Loading…", apiError: "Can't reach the course server.", retry: "Try again", close: "Close",
  foot: (d) => `Data built ${d} from MadGrades, Course Search & Enroll and r/UWMadison. Not affiliated with UW–Madison.`, src: "Source",

  // course list
  searchPh: "Search a course, title or instructor", filters: (n) => (n ? `Filters · ${n}` : "Filters"), sortBy: "Sort",
  s_m: "Most discussed", s_gpa: "Highest GPA", s_gpaL: "Lowest GPA", s_pa: "Most A's", s_tr: "Grades rising", s_tl: "Grades falling",
  s_sp: "Instructor matters", s_rd: "Most on Reddit", s_en: "Largest this term", s_code: "Course number",
  subject: "Subject", level: "Level", breadth: "Breadth", minGpa: "Minimum GPA", lens: "Show",
  allSubj: "All subjects", anyLvl: "Any level", anyBr: "Any breadth", anyGpa: "Any GPA", inPlan: "In my plan", clear: "Clear",
  offered: (t) => `Offered ${t}`, esOpt: "Ethnic Studies", geOpt: "Comm A/B or QR",
  lens_: "All courses", lens_easy: "High GPA, big class", lens_intro: "Big intro courses", lens_instr: "Instructor matters",
  lens_harder: "Getting harder", lens_easier: "Getting easier", lens_open: "Open seats now", lens_reddit: "Busy on Reddit",
  count: (n, all) => (n === all ? `${fmt(all)} courses` : `${fmt(n)} of ${fmt(all)} courses`), more: "Show more",
  open: "Open", wait: "Waitlist", full: "Full", notTerm: "Not offered", enrolledN: (n) => `${fmt(n)} enrolled`,
  empty: "No course matches. Try fewer filters.", cr: (c) => `${c} cr`,
  addPlan: "Add to plan", inPlanBtn: "In plan", removePlan: "Remove",

  // drawer
  mg: "MadGrades", cse: "Enroll", guide: "Guide", searchReddit: "Reddit", copy: "Copy link", copied: "Copied",
  prev: "Previous", next: "Next", credits: (c) => `${c} credits`, usually: (s) => `Usually ${s.toLowerCase()}`, alsoAs: "also", req: "Requisites",
  kGpa: "GPA", kRecent: "Recent GPA", kA: "Got an A", kDF: "D or F", kNow: (t) => `${t} size`,
  thisTerm: "This term", noSections: "No sections this term.", teaching: "Teaching", pastHere: (g) => `GPA ${g} here`, noHist: "new here",
  lastTaught: (l) => (l ? `Last taught ${l}.` : ""),
  grades: "Grades", studentsRange: (n, a, b) => `${fmt(n)} students, ${a} – ${b}`, thisCourse: "This course", allTracked: (n) => `All ${fmt(n)} courses`,
  byTerm: "GPA by term", trackedAvg: (g) => `campus ${g}`, noGrades: "No letter-grade history.",
  instructors: "Instructors", spread: (s) => `${s} points apart`, instrLegend: (t) => `Bigger dot = more students · outlined = teaching ${t}`,
  thLinks: "Links",
  thName: "Name", thGpa: "GPA", thA: "A's", thN: "Students", thLast: "Last", thin: "Under 30 students is a thin sample.",
  showAll: (n) => `Show all ${n}`, showFewer: "Show fewer",
  say: "What students say", sayCatalog: "No chat or Reddit data for this course.",
  sayEnroll: "One of the largest courses this term.", sayChatFew: "Mentioned fewer than three times in a student chat.",
  sayChat: (m, p, n) => `Mentioned <b>${m}</b> time${m === 1 ? "" : "s"} in a student chat${p || n ? ` (${p} positive, ${n} negative)` : ""}`,
  sayReddit: (n, tone) => `${n ? `. <b>${n}</b> r/UWMadison thread${n === 1 ? "" : "s"}${tone ? `, ${tone}` : ""}` : ""}.`,
  tonePos: "mostly positive", toneNeg: "mostly negative", toneMix: "mixed",
  seatsOf: (o, c) => `${o} of ${c} seats open`,

  // compare
  compare: "Compare", cmpTitle: "Compare courses", cmpTrend: "GPA by term",
  rTitle: "Title", rCr: "Credits", rGpa: "GPA", rA: "A's", rDF: "D or F", rTr: "Trend", rSp: "Instructor gap", rBr: "Breadth",

  // plan
  planTitle: (t) => `Plan ${t}`,
  stepDegree: "Degree", stepCourses: "Courses", stepSchedule: "Timetable",
  program: "Program", programPh: "Search your major, e.g. Computer Sciences", noProgram: "Choose a program to see what is left.",
  importBtn: "Import transcript", importedN: (n) => `${n} courses imported`, importEdit: "Edit",
  importTitle: "Import what you have taken",
  importHelp: "Upload your unofficial transcript or DARS (PDF or text), or paste it. Nothing leaves your browser.",
  importPaste: "…or paste the text here", importChoose: "Choose a file", importRead: "Read", importApply: "Use these",
  importFound: (d, i) => `Found ${d} completed${i ? ` and ${i} in progress` : ""}.`, importNone: "No courses found. Paste the text or a list like “cs 300, math 221”.",
  importFailed: (n) => `${n} not passed (ignored)`, importPdfError: "Couldn't read that PDF. Paste its text instead.",
  taken: "Taken", inProgress: "In progress", add: "Add", added: "Added", remove: "Remove",
  reqDone: (a, b) => `${a} of ${b} requirements met`, reqUnit: (u, h, n) => (u === "credits" ? `${h} of ${n} credits` : `${h} of ${n}`),
  reqNote: "Built from the UW Guide. Check DARS and your advisor before you rely on it.", reqInfo: "See the Guide for the exact rule",
  countedAbove: "(already counted in another requirement)",
  tookIt: "I took this", chooseN: (n) => (n === 1 ? "Choose one" : `Choose ${n}`),
  notOffered: "Not offered", pickOne: "Choose one", viewGuide: "Open in the Guide",
  fillLabel: "Fill the rest from my remaining requirements", targetCr: "Credits", mustHave: "Must take", mustEmpty: "Star courses in the list, add one from a requirement, or search below.",
  addCourse: "Add a course…", prefs: "Preferences",
  noBefore: "No class before", noAfter: "No class after", daysOff: "Keep free", seatsLbl: "Seats", seatsOpen: "Open only", seatsWait: "Open or waitlist", seatsAny: "Include full",
  anyTime: "Any time", freeDays: "Free days", compact: "Compact days", quality: "Easier instructors",
  build: "Build timetables", building: "Working…", variant: (i, n) => `Option ${i} of ${n}`,
  schedCredits: (c) => `${c} credits`, schedFree: (d) => (d.length ? `Free ${d.join(" ")}` : "Classes every day"),
  schedSpan: (a, b) => `${a} – ${b}`, schedWait: (n) => `${n} waitlisted`, schedFull: (n) => `${n} full`,
  swap: "Swap section", classNo: "Class #", copyNums: "Copy class numbers", icsBtn: "Add to calendar (.ics)",
  online: "Online / no set time", consent: "Needs consent",
  riskPrq: "Check prerequisites", partTerm: "Part of term",
  why_none: (code, why) => ({
    full: `${code}: every section is full. Allow full sections or pick another course.`,
    waitlist: `${code}: only waitlisted sections are left.`,
    early: `${code}: every section starts before your earliest time.`,
    late: `${code}: every section ends after your latest time.`,
    dayoff: `${code}: every section meets on a day you want free.`,
    seats: `${code}: no section has an open seat. Allow waitlisted or full sections.`,
    combo: `${code}: no section fits all your limits at once (seats and times together). Loosen one of them.`,
    consent: `${code} needs instructor or department consent, so it cannot be scheduled.`,
    unscheduled: `${code} has no sections this term.`,
  }[why] || `${code} has no usable section.`),
  why_clash: (a, b) => `${a} and ${b} always overlap.`,
  why_nofit: "No combination fits together. Drop a course or loosen the time limits.",
  why_credits: (have, lo) => `The most that fits is ${have} credits, short of ${lo}. Lower the target or loosen the limits.`,
  needTerm: "Section times are not published for this term yet.",
  planSummary: (n, c) => `${n} course${n === 1 ? "" : "s"} · ${c} credits`,

  // agent
  agentTitle: "Ask", agentHello: "Ask about courses, instructors, requirements or your timetable.",
  agentPh: "Ask anything…", agentSend: "Send", agentBusy: "Thinking…", agentErr: "The assistant is unavailable right now.",
  agentLimit: "The free daily quota for the assistant is used up. Try again tomorrow.", agentNew: "New chat",
  agentSug: ["Which easy courses fit a 9–5 timetable?", "What should I take with COMP SCI 577?", "Who teaches MATH 340 best?"],
  tool_search: "Searching courses", tool_course: "Reading a course", tool_plan: "Checking your plan", tool_build: "Building timetables", tool_add: "Updating your plan",

  // insights
  insNote: (n, all) => `Charts cover the ${n} featured courses. The course list has all ${fmt(all)}.`,
  st_grades: "letter grades", st_instr: "instructors", st_reddit: "Reddit threads", st_courses: "featured courses",
  p1: "Popular doesn't mean easy", p1l: (r) => `Each dot is a course. Chat volume says little about grading (${r}).`,
  xMent: "Chat mentions (log)", yGpa: "Course GPA", chat: (n) => `${n} chat`, chatFew: "chat <3",
  p2: "The instructor can matter more than the course", p2l: "Same course, over a letter grade apart between instructors.",
  most: "Most generous", least: "Least generous",
  p3: "Do peer signals track grades?", p3l: "Spearman rank correlation. Only Reddit tone tracks grades.",
  c1: "Chat mentions vs GPA", c2: "Chat sentiment vs GPA", c3: "Reddit tone vs GPA", c4: "Chat vs Reddit volume", c5: "Course number vs GPA",
  thSignal: "Signal", thResult: "Result", thReading: "Reading",
  none: "no relationship", weak: "weak", moderate: "moderate", strong: "strong", positive: " positive", negative: " negative", ns: ", not significant", nodata: "not enough data",
  p4: "GPA by level", p4l: "The 200s and 300s grade hardest.", wStudents: "Weighted by students", medCourse: "Median course",
  lvlTip: (l, g, m, n) => `<b>${l}</b>: weighted ${g}, median ${m} (${n} courses)`,
  p5: "Grades over time", p5l: "Campus GPA by term, weighted by students.", pandemic: "Spring 2020: pandemic grading",
  p6: "Grading got easier", p6l: "Steepest rise since fall 2016.", p7: "Grading got harder", p7l: "Steepest fall since fall 2016.",
  p8: "Popular and tough", p8l: "Mentioned 8+ times, lowest GPA first.", p9: "High GPA, rarely discussed", p9l: "300+ graded students, three or fewer mentions.",
  p10: "By subject", p10l: "Click a row to filter the list.",
  thCourse: "Course", thPerYr: "Per year", thSubj: "Subject", thCourses: "Courses", thMent: "Mentions",
  perYr: "/yr",

  // about
  aboutHtml: `
    <h2 class="serif">Where the numbers come from</h2>
    <ul>
      <li><b>Grades</b>: <a href="https://madgrades.com" target="_blank" rel="noopener">MadGrades</a>, UW's public grade reports by term, section and instructor. GPA counts letter grades only.</li>
      <li><b>Sections and seats</b>: the public <a href="https://public.enroll.wisc.edu" target="_blank" rel="noopener">Course Search &amp; Enroll</a> API. Seats are a snapshot, so check Enroll before you register.</li>
      <li><b>Degree requirements</b>: copied from the <a href="https://guide.wisc.edu" target="_blank" rel="noopener">UW Guide</a>. They are a guide, not an audit; DARS decides.</li>
      <li><b>Chat and Reddit</b>: aggregate counts from a student chat, and titles of public r/UWMadison threads.</li>
    </ul>
    <h2 class="serif">Reading the numbers</h2>
    <ul>
      <li><b>Adjusted GPA</b> pulls small courses toward their subject's mean, so a 12-student seminar doesn't beat a 900-student course.</li>
      <li><b>Trend</b> is the yearly GPA slope since fall 2016.</li>
      <li><b>Instructor gap</b> is the spread between the most and least generous instructor with 30+ students.</li>
    </ul>
    <p>Code, database schema and analysis are on <a href="https://github.com/WEBGRS/uw-course-lookup" target="_blank" rel="noopener">GitHub</a>.</p>`,
};

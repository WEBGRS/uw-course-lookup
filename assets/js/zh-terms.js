// Chinese search words -> English query words, a list lens or a breadth (ported from the mini program's shared/zh-terms.js).
// The search engine matches English word prefixes, so a Chinese query used to match nothing and list every course.
// listParams() at the bottom builds the course list's API query from the filters, Chinese or not.

const terms = {
  // Subjects
  '计算机科学': 'computer sciences', '计算机': 'computer sciences', '计科': 'computer sciences',
  '数学': 'math|mathematics', '统计': 'statistic|statistics', '精算': 'actuarial',
  '经济': 'econom|economics', '金融': 'finance', '会计': 'accounting', '市场营销': 'marketing', '营销': 'marketing',
  '商科': 'business', '商业': 'business', '管理': 'management', '房地产': 'real estate', '保险': 'insurance', '风险管理': 'risk management',
  '心理': 'psycholog|psychology', '化学': 'chemi|chemistry', '生化': 'biochem|biochemistry', '物理': 'physics', '生物': 'biolog|biology',
  '遗传': 'genetic|genetics', '微生物': 'microbio|microbiology', '神经': 'neuro|neuroscience', '营养': 'nutrition', '食品': 'food',
  '天文': 'astronom|astronomy', '大气': 'atmospheric', '气象': 'atmospheric', '地理': 'geograph|geography', '地质': 'geoscience', '地球科学': 'geoscience', '环境': 'environment',
  '历史': 'histor|history', '哲学': 'philosoph|philosophy', '政治': 'politic|politics', '社会学': 'sociolog|sociology', '人类学': 'anthropolog|anthropology', '语言学': 'linguistic|linguistics',
  '文学': 'literature', '宗教': 'religio|religion', '性别': 'gender',
  '英语': 'english', '英文': 'english', '中文': 'chinese', '汉语': 'chinese', '中国': 'chin|China',
  '日语': 'japan|Japanese', '日本': 'japan|Japanese', '韩语': 'korea|Korean', '韩国': 'korea|Korean', '西班牙语': 'spanish', '法语': 'french', '德语': 'german',
  '意大利语': 'italian', '俄语': 'russian', '拉丁语': 'latin', '希腊语': 'greek', '葡萄牙语': 'portug|Portuguese',
  '艺术史': 'art histor|art history', '艺术': 'art', '音乐': 'music', '舞蹈': 'dance', '戏剧': 'theatre', '电影': 'film', '摄影': 'photograph|photography',
  '设计': 'design', '建筑': 'architect|architecture', '新闻': 'journalism', '传播': 'communication', '传媒': 'communication',
  '教育': 'educat|education', '护理': 'nursing', '药学': 'pharm|pharmacy', '医学': 'medic|medicine', '公共卫生': 'public health', '法律': 'law', '社工': 'social work',
  '体育': 'kinesiology', '运动': 'kinesiology',
  '工程': 'engineering', '电子工程': 'electrical', '电气': 'electrical', '电子': 'electronic', '机械': 'mechanical', '土木': 'civil',
  '工业工程': 'industrial', '材料': 'materials', '化工': 'chemical engineering', '生物医学工程': 'biomedical engineering',
  '核工程': 'nuclear', '航空航天': 'aerospace', '航空': 'aerospace',
  // Topics
  '微积分': 'calculus', '线性代数': 'linear algebra', '线代': 'linear algebra', '离散数学': 'discrete', '离散': 'discrete',
  '概率论': 'probability', '概率': 'probability', '微分方程': 'differential equations', '数论': 'number theory', '拓扑': 'topology', '理论': 'theor|theory',
  '高等数学': 'calculus', '高数': 'calculus',
  '算法': 'algorithm|algorithms', '编程': 'programming', '程序设计': 'programming',
  '机器学习': 'machine learning', '人工智能': 'artificial intelligence', '数据库': 'database', '操作系统': 'operating system|operating systems',
  '计算机网络': 'computer network', '网络': 'network', '网络安全': 'security', '安全': 'security',
  '数据科学': 'data science', '数据分析': 'data analy|data analysis', '数据': 'data', '图形学': 'graphics', '编译': 'compiler',
  '有机化学': 'organic', '有机': 'organic', '普通化学': 'general chemistry', '普化': 'general chemistry',
  '普通物理': 'general physics', '普物': 'general physics',
  '宏观经济': 'macroeconomic|macroeconomics', '宏观': 'macroeconomic|macroeconomics', '微观经济': 'microeconomic|microeconomics', '微观': 'microeconomic|microeconomics',
  '计量经济': 'econometric|econometrics', '计量': 'econometric|econometrics', '博弈论': 'game theory',
  '写作': 'writing', '研讨': 'seminar', '入门': 'introduct|introduction', '导论': 'introduct|introduction', '概论': 'introduct|introduction',
  '实验': 'laborator|laboratory',
};

// Topics no title names: the courses whose descriptions cover them
const courses = {
  '数据结构': ['COMP-SCI-300', 'COMP-SCI-400'],
};

// Words that mean a list lens rather than a topic
const intents = {
  '大一': 'intro', '入门大课': 'intro',
  '水课': 'easy', '好过': 'easy', '容易': 'easy', '简单': 'easy', '给分高': 'easy', '给分好': 'easy', '好拿a': 'easy', '送分': 'easy',
  '有空位': 'open', '没满': 'open',
};
const LENS_LABEL = { easy: '好拿高分（本科课，调整后 GPA 3.7 以上、累计 500 人以上）', open: '本学期有空位', intro: '入门大课（300 级以下、人数多）' };

// Breadth words set the breadth filter (values as in the catalog)
const breadths = {
  '人文': 'Humanities', '人文学科': 'Humanities', '社科': 'Social Science', '社会科学': 'Social Science',
  '自然科学': 'Natural Science', '生物科学': 'Biological Science', '物理科学': 'Physical Science',
};
const BR_LABEL = { 'Humanities': '人文', 'Social Science': '社会科学', 'Natural Science': '自然科学', 'Biological Science': '生物科学', 'Physical Science': '物理科学' };

// Words the search cannot use, with where to go instead
const notes = { '通识': '通识领域可以在「筛选」里选。', '选修': '' };

// Filler that carries no meaning in a course search
const stop = ['课程', '课', '的', '学', '类', '相关', '有关', '方面', '专业', '系', '和', '与', '及', '还有', '推荐', '哪些', '什么', '好的', '最', '有', '门'];

const CJK = /[㐀-鿿]/;
const KEYS = Object.keys(terms).concat(Object.keys(courses), Object.keys(intents), Object.keys(breadths), Object.keys(notes), stop).sort((a, b) => b.length - a.length);

// "计算机 577" -> { q: "computer sciences 577", lens: "", ids: "", miss: "" }; null when the query has no Chinese
export function rewrite(q) {
  q = String(q || '').toLowerCase();
  if (!CJK.test(q)) return null;
  const words = [], shown = [], miss = [], ids = [];
  let lens = '', br = '', note = '';
  const add = (w, s) => { if (!words.includes(w)) { words.push(w); shown.push(s || w); } };
  for (const run of q.match(/[㐀-鿿]+|[^㐀-鿿]+/g)) {
    if (!CJK.test(run)) { if (run.trim()) add(run.trim()); continue; }
    let i = 0;
    while (i < run.length) {
      const k = KEYS.find((x) => run.startsWith(x, i));
      if (!k) {
        if (miss.length && miss[miss.length - 1].end === i) { miss[miss.length - 1].s += run[i]; miss[miss.length - 1].end = i + 1; }
        else miss.push({ s: run[i], end: i + 1 });
        i++;
        continue;
      }
      if (terms[k]) { const [w, s] = terms[k].split('|'); add(w, s); }
      else if (courses[k]) ids.push(...courses[k]);
      else if (intents[k]) lens = intents[k];
      else if (breadths[k]) br = breadths[k];
      else if (k in notes) note = notes[k];
      i += k.length;
    }
  }
  return {
    q: words.join(' '), shown: shown.join(' '), lens, lensLabel: LENS_LABEL[lens] || '', ids: ids.join(','),
    br, brLabel: br ? '通识：' + BR_LABEL[br] : '', note,
    idsLabel: ids.map((x) => x.replace(/-(?=\d)/, ' ').replace(/-/g, ' ')).join('、'),
    miss: miss.map((m) => m.s).join('、'),
  };
}

export { terms, courses, intents, breadths, notes, stop };

/** Search parameters for a rewritten query; `mine` (saved course ids) keeps a topic's courses within them. */
export function zhParams(zh, mine) {
  const p = {};
  if (zh.q) p.q = zh.q;
  if (zh.lens) p.lens = zh.lens;
  if (zh.br) p.br = zh.br;
  if (zh.ids) { const z = zh.ids.split(","); p.ids = (mine ? z.filter((id) => mine.includes(id)) : z).join(",") || "-"; }
  return p;
}

/**
 * The course list's API parameters for the filter state `st`; `mine` = saved course ids when "In schedule" is on.
 * "In schedule" lists every saved course, so the offered-this-term filter does not apply to it.
 */
export function listParams(st, mine) {
  const p = {}, zh = st.q ? rewrite(st.q) : null;
  if (zh) Object.assign(p, zhParams(zh, mine));   // a topic within the schedule, not instead of it
  else if (st.q) p.q = st.q;
  if (st.sort !== "m") p.sort = st.sort;
  for (const k of ["subj", "lvl", "br", "gpa"]) if (st[k]) p[k] = st[k];
  if (st.now && !mine) p.now = "1";
  if (mine && !(zh && zh.ids)) p.ids = mine.join(",") || "-";
  return { p, zh };
}

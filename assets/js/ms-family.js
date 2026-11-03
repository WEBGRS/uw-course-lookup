/* Madison Students top bar v2. <script src="ms-family.js" data-site="food"></script> in <head>, before the page's own scripts */
(function () {
  var me = document.currentScript;
  var SITE = (me && me.dataset.site) || "hub";
  var ORDER = ["courses", "housing", "food", "guide", "news"];
  var PROD = { hub: "https://madisonstudents.com/", courses: "https://courses.madisonstudents.com/", housing: "https://housing.madisonstudents.com/", food: "https://food.madisonstudents.com/", guide: "https://guide.madisonstudents.com/", news: "https://news.madisonstudents.com/" };
  // Local preview ports
  var PORT = { hub: 8891, courses: 8892, housing: 8893, food: 8894, guide: 8895, news: 8896 };
  var L = {
    en: { brand: "Madison Students", hub: "Home", courses: "Courses", housing: "Housing", food: "Food", guide: "Campus guide", news: "News" },
    zh: { brand: "麦屯工具站", hub: "首页", courses: "选课", housing: "租房", food: "吃饭", guide: "校园指南", news: "新闻" }
  };
  var local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && +location.port >= 8890 && +location.port <= 8899;
  function url(k) { return local ? "http://127.0.0.1:" + PORT[k] + "/" : PROD[k]; }
  function cur() { return /^zh/.test(document.documentElement.lang) ? "zh" : "en"; }

  var MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#d0312d"/><path d="M0 21 C8 18 14 23 20 20 S28 17 32 19 V32 H0Z" fill="#f6b4ad"/><text x="16" y="17" font-family="Arial,sans-serif" font-weight="800" font-size="13" fill="#fff" text-anchor="middle">MS</text></svg>';
  var lang = cur();
  var bar = document.createElement("header");
  bar.className = "ms-top";
  bar.innerHTML =
    '<div class="ms-wrap">' +
    '<a class="ms-brand" href="' + url("hub") + '">' + MARK + "<span></span></a>" +
    '<nav class="ms-nav" aria-label="Madison Students"></nav>' +
    '<div class="ms-menu"><button class="ms-pill" type="button" aria-expanded="false"></button></div>' +
    '<div class="ms-actions"></div>' +
    "</div>";
  var nav = bar.querySelector(".ms-nav"), menu = bar.querySelector(".ms-menu"), pick = menu.querySelector("button"), list = null;

  function close() { if (list) { list.remove(); list = null; pick.setAttribute("aria-expanded", "false"); } }
  function render() {
    var t = L[lang];
    bar.querySelector(".ms-brand span").textContent = t.brand;
    bar.querySelector(".ms-brand").setAttribute("aria-label", t.brand);
    nav.innerHTML = "";
    ORDER.forEach(function (k) {
      var a = document.createElement("a");
      a.href = url(k);
      a.textContent = t[k];
      if (k === SITE) a.setAttribute("aria-current", "page");
      nav.appendChild(a);
    });
    pick.innerHTML = t[SITE] + ' <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    close();
  }

  pick.addEventListener("click", function () {
    if (list) return close();
    list = document.createElement("div");
    list.className = "ms-menu-list";
    ["hub"].concat(ORDER).forEach(function (k) {
      var a = document.createElement("a");
      a.href = url(k);
      a.textContent = L[lang][k];
      if (k === SITE) a.setAttribute("aria-current", "page");
      list.appendChild(a);
    });
    menu.appendChild(list);
    pick.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("click", function (e) { if (list && !menu.contains(e.target)) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  function mount() {
    document.body.insertBefore(bar, document.body.firstChild);
    lang = cur();
    render();
    // Follow the page's own language switch
    new MutationObserver(function () { var n = cur(); if (n !== lang) { lang = n; render(); } })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  window.MSFamily = { site: SITE, bar: bar, actions: bar.querySelector(".ms-actions"), url: url, setLang: function (l) { lang = l === "zh" ? "zh" : "en"; render(); } };
})();

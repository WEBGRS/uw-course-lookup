/* Browser side of the WEBGRS data guard (canonical copy: C:\Users\ghs\webgrs-guard\guard-client.js).
   Gets a Turnstile-checked session token once and sends it with every API call. */
(function () {
  var TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  function create(opts) {
    var api = opts.api.replace(/\/$/, ''), sitekey = opts.sitekey, KEY = 'wg:sess:' + opts.site;
    var tok = null, pending = null;
    try { var s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s && s.exp > Date.now() + 60000) tok = s; } catch (e) { /* storage blocked */ }

    // Invisible Turnstile check; resolves '' when it cannot run (the session is then "unverified", with smaller quotas)
    function turnstileToken() {
      return new Promise(function (resolve) {
        if (!sitekey) return resolve('');
        var done = false;
        var fin = function (v) { if (!done) { done = true; resolve(v || ''); } };
        var run = function () {
          var el = document.createElement('div');
          el.style.display = 'none';
          document.body.appendChild(el);
          try {
            window.turnstile.render(el, { sitekey: sitekey, callback: fin, 'error-callback': function () { fin(''); }, 'timeout-callback': function () { fin(''); } });
          } catch (e) { fin(''); }
        };
        setTimeout(function () { fin(''); }, 6000);
        if (window.turnstile) return run();
        var sc = document.createElement('script');
        sc.src = TS_SRC;
        sc.async = true;
        sc.onload = run;
        sc.onerror = function () { fin(''); };
        document.head.appendChild(sc);
      });
    }

    function session() {
      if (tok && tok.exp > Date.now() + 60000) return Promise.resolve(tok.token);
      if (!pending) {
        pending = turnstileToken().then(function (ts) {
          return fetch(api + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstile: ts }) });
        }).then(function (r) {
          if (!r.ok) { var e = new Error('session'); e.status = r.status; throw e; }
          return r.json();
        }).then(function (j) {
          tok = j;
          try { sessionStorage.setItem(KEY, JSON.stringify(j)); } catch (e) { /* storage blocked */ }
          return j.token;
        }).finally(function () { pending = null; });
      }
      return pending;
    }

    // call('/api/x', {method, body}) -> parsed JSON; throws an Error with .status and .data on refusal
    async function call(path, o) {
      o = o || {};
      for (var attempt = 0; attempt < 2; attempt++) {
        var t = await session();
        var headers = { 'X-Session': t };
        if (o.body) headers['Content-Type'] = 'application/json';
        var r = await fetch(api + path, { method: o.method || 'GET', headers: headers, body: o.body ? JSON.stringify(o.body) : undefined });
        if (r.status === 401 && attempt === 0) {
          tok = null;
          try { sessionStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
          continue;
        }
        var data = await r.json().catch(function () { return {}; });
        if (!r.ok) { var err = new Error(data.error || 'error'); err.status = r.status; err.data = data; throw err; }
        return data;
      }
    }

    return { call: call, session: session, human: function () { return tok ? tok.human : 0; } };
  }

  window.WebgrsGuard = { create: create };
})();

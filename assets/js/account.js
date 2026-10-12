/* Sign-in for the madisonstudents.com tools (canonical copy: C:\Users\ghs\webgrs-guard\account.js; sync.py copies it).
   <script src="account.js" data-mount=".hbtns" data-class="btn" defer></script>
   data-api      accounts Worker (default https://accounts.madisonstudents.com); on localhost ?acct=<url> overrides it
   data-mount    container for the Sign in button; data-before: insert before this child; data-class: its classes
   data-compact  below this width (px) the button shows only its icon
   window.MSAccount: user, ready (Promise of user or null), on(fn(user, reason)), load(site), save(site, data, {beacon}), open()
   Sign-in is email + password, or a 6-digit code by email (also how an account is created and a password reset).
   The session is an HttpOnly cookie shared by every madisonstudents.com subdomain. */
(function () {
  if (window.MSAccount) return;
  var me = document.currentScript || {};
  var ds = me.dataset || {};
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var override = local && new URLSearchParams(location.search).get('acct');
  var API = (override || ds.api || 'https://accounts.madisonstudents.com').replace(/\/$/, '');
  var SITEKEY = ds.sitekey === undefined ? '0x4AAAAAAFNE9RK6Ss5QmXDp' : ds.sitekey;
  var TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var T = {
    signin: ['Sign in', '登录'],
    account: ['Account', '账号'],
    email: ['Email', '邮箱'],
    password: ['Password', '密码'],
    newPw: ['Password (8+ characters)', '密码（至少 8 位）'],
    sendCode: ['Email me a code', '发送验证码'],
    sending: ['Sending…', '发送中…'],
    codeLogin: ['Sign in with email code', '验证码登录'],
    pwLogin: ['Sign in with password', '密码登录'],
    signup: ['Create account', '注册'],
    codeSent: ['Code sent to', '验证码已发到'],
    code: ['6-digit code', '6 位验证码'],
    verify: ['Sign in', '登录'],
    checking: ['Checking…', '验证中…'],
    resend: ['Send again', '重新发送'],
    resendIn: ['Send again in {n}s', '{n} 秒后可重发'],
    other: ['Use another email', '换个邮箱'],
    setPw: ['Set password', '设置密码'],
    changePw: ['Change password', '修改密码'],
    save: ['Save', '保存'],
    pwSaved: ['Password saved.', '密码已保存。'],
    signout: ['Sign out', '退出登录'],
    del: ['Delete account', '删除账号'],
    delAsk: ['Delete this account and everything saved in it? What is on this device stays.', '删除这个账号和里面保存的所有内容？这台设备上的内容不受影响。'],
    badEmail: ['Enter a valid email address.', '请输入有效的邮箱地址。'],
    enterPw: ['Enter your password.', '请输入密码。'],
    pwshort: ['Use at least 8 characters.', '密码至少 8 位。'],
    badlogin: ['Wrong email or password.', '邮箱或密码不对。'],
    locked: ['Too many wrong tries. Wait 15 minutes, or sign in with an email code.', '错误次数太多，15 分钟后再试，或用验证码登录。'],
    wrong: ['That code is not right. {n} tries left.', '验证码不对，还能试 {n} 次。'],
    expired: ['That code has expired. Send a new one.', '验证码已失效，请重新发送。'],
    quota: ['Too many codes for now. Try again later.', '验证码发得太频繁了，稍后再试。'],
    human: ["Couldn't confirm you're not a bot. Try again.", '人机验证没通过，再试一次。'],
    fail: ["Couldn't reach the server. Check the connection and try again.", '连不上服务器，检查网络后再试。'],
    close: ['Close', '关闭'],
  };
  var USER = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><circle cx="8" cy="5.4" r="2.9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.6 14c.5-2.9 2.7-4.4 5.4-4.4s4.9 1.5 5.4 4.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  function lang() {
    var l = document.documentElement.lang || navigator.language || '';
    return /^zh/i.test(l) ? 'zh' : 'en';
  }
  function t(k, n) {
    var s = T[k][lang() === 'zh' ? 1 : 0];
    return n == null ? s : s.replace('{n}', n);
  }

  // ---------- server
  var user = null, listeners = [];
  function call(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'include', keepalive: !!opts.keepalive };
    if (opts.body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(opts.body); }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'http ' + r.status); e.status = r.status; e.data = j; throw e; }
        return j;
      });
    });
  }
  function setUser(u, reason) {
    user = u;
    relabel();
    listeners.slice().forEach(function (fn) { try { fn(user, reason); } catch (e) { console.error(e); } });
  }
  var ready = call('/api/me').then(function (j) { user = j.user || null; relabel(); return user; }, function () { return null; });

  // ---------- Turnstile (shares the page's copy when the data guard already loaded it)
  var tsLoading = null;
  function loadTs() {
    if (!SITEKEY) return Promise.reject(new Error('no sitekey'));
    if (window.turnstile) return Promise.resolve();
    if (!tsLoading) {
      tsLoading = new Promise(function (resolve, reject) {
        if (!document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) {
          var sc = document.createElement('script');
          sc.src = TS_SRC; sc.async = true; sc.onerror = reject;
          document.head.appendChild(sc);
        }
        var n = 0, iv = setInterval(function () {
          if (window.turnstile) { clearInterval(iv); resolve(); } else if (++n > 80) { clearInterval(iv); reject(new Error('timeout')); }
        }, 100);
      }).catch(function (e) { tsLoading = null; throw e; });
    }
    return tsLoading;
  }
  function tsToken() {
    return new Promise(function (resolve) {
      var done = false, box = null, wid = null;
      function fin(v) {
        if (done) return;
        done = true;
        resolve(v || '');
        setTimeout(function () {
          try { if (wid != null) window.turnstile.remove(wid); } catch (e) { /* already gone */ }
          if (box) box.remove();
        }, 0);
      }
      setTimeout(function () { fin(''); }, 8000);
      loadTs().then(function () {
        box = document.createElement('div');
        box.style.display = 'none';
        document.body.appendChild(box);
        try {
          wid = window.turnstile.render(box, { sitekey: SITEKEY, callback: fin, 'error-callback': function () { fin(''); }, 'timeout-callback': function () { fin(''); } });
        } catch (e) { fin(''); }
      }, function () { fin(''); });
    });
  }
  var pre = null;
  function freshToken() {
    if (pre && Date.now() - pre.at < 240000) { var p = pre.p; pre = null; return p; }
    pre = null;
    return tsToken();
  }

  // ---------- panel (shadow DOM keeps the page's CSS and ours apart)
  // step: pw (email + password) | codeEmail | signup | code (enter the emailed code) | in (signed in)
  var host, root, panel, btn = null, opener = null, isOpen = false, step = 'pw', flow = 'codeEmail', email = '', pendingPw = '', pwOpen = false, cool = 0, coolTimer = 0;
  var CSS = [
    ':host{all:initial}',
    '.panel{position:fixed;z-index:2147483001;width:284px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:12px 14px;border-radius:10px;',
    'background:var(--bg);color:var(--ink);border:1px solid var(--line);box-shadow:0 14px 44px rgba(0,0,0,.2),0 2px 6px rgba(0,0,0,.08);',
    'font-size:13px;line-height:1.4;font-weight:400;letter-spacing:normal;text-transform:none;text-align:left;',
    'opacity:0;transform:translateY(6px);transition:opacity .16s ease,transform .16s ease}',
    '.panel.on{opacity:1;transform:none}',
    '.panel.sheet{left:8px!important;right:8px!important;top:max(10px,env(safe-area-inset-top))!important;bottom:auto!important;width:auto;max-width:none}',
    '.light{--bg:#fff;--ink:#15181d;--sub:#3d434b;--line:rgba(21,24,29,.16);--field:#fff;--wash:rgba(21,24,29,.07);--ph:rgba(21,24,29,.52);--bad:#b3261e}',
    '.dark{--bg:#1c2026;--ink:#eef1f4;--sub:#c9ced4;--line:rgba(238,241,244,.2);--field:#14171b;--wash:rgba(255,255,255,.09);--ph:rgba(238,241,244,.55);--bad:#ff8a80}',
    '.hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 4px}',
    '.hd b{font-size:14.5px;font-weight:650}',
    '.x{width:26px;height:26px;margin:-4px -6px -4px 0;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:18px;line-height:1;cursor:pointer}',
    '.x:hover{background:var(--wash)}',
    'p{margin:0 0 8px;color:var(--sub)}',
    '.who{color:var(--ink);font-weight:600;word-break:break-all}',
    'input{display:block;width:100%;box-sizing:border-box;margin:0 0 8px;padding:6px 9px;font:inherit;font-size:14px;color:inherit;background:var(--field);border:1px solid var(--line);border-radius:8px}',
    'input.code{font-size:19px;letter-spacing:.35em;text-align:center;font-variant-numeric:tabular-nums}',
    'input:focus{outline:1.5px solid var(--ink);outline-offset:-1px;border-color:transparent}',
    '::placeholder{color:var(--ph);opacity:1;letter-spacing:normal}',
    '.go{display:block;width:100%;font:inherit;font-weight:600;border-radius:999px;padding:5px 12px;font-size:13px;cursor:pointer;background:var(--ink);color:var(--bg);border:1px solid var(--ink)}',
    '.go:disabled{opacity:.55;cursor:default}',
    '.ghost{background:transparent;color:inherit;border:1px solid var(--line)}',
    '.st{min-height:0;margin:6px 0 0;font-size:12.5px;color:var(--bad)}.st:empty{display:none}.st.ok{color:var(--sub)}',
    '.pwrow{margin:0 0 8px}',
    '.row2{display:flex;gap:6px}.row2 .go{flex:1;width:auto;padding-left:6px;padding-right:6px;white-space:nowrap}',
    '.links{display:flex;justify-content:space-between;gap:10px;margin:8px 0 0;font-size:12px}',
    '.link{border:0;padding:0;background:none;color:inherit;font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
    '.link:disabled{text-decoration:none;opacity:.6;cursor:default}',
    '.del{display:block;margin:8px auto 0;font-size:12px;color:var(--bad)}',
    'button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}',
    '@media (prefers-reduced-motion:reduce){.panel{transition:none}}',
  ].join('');

  function build() {
    host = document.createElement('div');
    host.id = 'ms-account';
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style><div class="panel" role="dialog" aria-modal="false" aria-labelledby="ac-t" hidden></div>';
    panel = root.querySelector('.panel');
    panel.addEventListener('submit', function (e) {
      e.preventDefault();
      if (step === 'pw') pwSignIn();
      else if (step === 'codeEmail' || step === 'signup') sendCode();
      else if (step === 'code') verify();
      else if (step === 'in') savePw();
    });
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var a = b.dataset.a;
      if (a === 'close') close();
      else if (a === 'resend') sendCode(true);
      else if (a === 'other') { step = flow; render(); }
      else if (a === 'topw' || a === 'tocode' || a === 'tosignup') { keepEmail(); step = { topw: 'pw', tocode: 'codeEmail', tosignup: 'signup' }[a]; render(); }
      else if (a === 'pw') { pwOpen = !pwOpen; render(); }
      else if (a === 'signout') signOut();
      else if (a === 'delete') deleteAccount();
    });
    panel.addEventListener('input', function (e) {
      if (e.target.name === 'code') {
        var v = e.target.value.replace(/\D/g, '').slice(0, 6);
        if (v !== e.target.value) e.target.value = v;
        if (v.length === 6) verify();
      }
    });
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function head(title) { return '<div class="hd"><b id="ac-t">' + esc(title) + '</b><button type="button" class="x" data-a="close" aria-label="' + esc(t('close')) + '">&times;</button></div>'; }
  function emailInput() {
    return '<input name="email" type="email" inputmode="email" autocomplete="username" placeholder="' + esc(t('email')) + '" aria-label="' + esc(t('email')) + '" value="' + esc(email) + '">';
  }
  function pwInput(fresh) {
    var ph = fresh ? t('newPw') : t('password');
    return '<input name="password" type="password" autocomplete="' + (fresh ? 'new-password' : 'current-password') + '" maxlength="200" placeholder="' + esc(ph) + '" aria-label="' + esc(ph) + '">';
  }
  function link(a, k) { return '<button type="button" class="link" data-a="' + a + '">' + esc(t(k)) + '</button>'; }
  var ST = '<p class="st" role="status" aria-live="polite"></p>';
  function render() {
    if (!panel) return;
    var h;
    if (user) {
      step = 'in';
      h = head(t('account')) + '<p class="who">' + esc(user.email) + '</p>' +
        (pwOpen
          ? '<form novalidate class="pwrow">' + pwInput(true) + '<button type="submit" class="go">' + esc(t('save')) + '</button>' + ST + '</form>'
          : '<div class="row2"><button type="button" class="go ghost" data-a="pw">' + esc(t(user.pw ? 'changePw' : 'setPw')) + '</button>' +
            '<button type="button" class="go ghost" data-a="signout">' + esc(t('signout')) + '</button></div>' + ST) +
        (pwOpen ? '<button type="button" class="go ghost" data-a="signout">' + esc(t('signout')) + '</button>' : '') +
        '<button type="button" class="link del" data-a="delete">' + esc(t('del')) + '</button>';
    } else if (step === 'code') {
      h = head(t(flow === 'signup' ? 'signup' : 'codeLogin')) + '<form novalidate><p>' + esc(t('codeSent')) + ' <span class="who">' + esc(email) + '</span></p>' +
        '<input name="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······" aria-label="' + esc(t('code')) + '">' +
        '<button type="submit" class="go">' + esc(t(flow === 'signup' ? 'signup' : 'verify')) + '</button>' + ST + '</form>' +
        '<div class="links"><button type="button" class="link" data-a="resend"></button>' + link('other', 'other') + '</div>';
    } else if (step === 'codeEmail') {
      h = head(t('codeLogin')) + '<form novalidate>' + emailInput() +
        '<button type="submit" class="go">' + esc(t('sendCode')) + '</button>' + ST + '</form>' +
        '<div class="links">' + link('topw', 'pwLogin') + link('tosignup', 'signup') + '</div>';
    } else if (step === 'signup') {
      h = head(t('signup')) + '<form novalidate>' + emailInput() + pwInput(true) +
        '<button type="submit" class="go">' + esc(t('signup')) + '</button>' + ST + '</form>' +
        '<div class="links">' + link('topw', 'pwLogin') + link('tocode', 'codeLogin') + '</div>';
    } else {
      step = 'pw';
      h = head(t('signin')) + '<form novalidate>' + emailInput() + pwInput(false) +
        '<button type="submit" class="go">' + esc(t('signin')) + '</button>' + ST + '</form>' +
        '<div class="links">' + link('tocode', 'codeLogin') + link('tosignup', 'signup') + '</div>';
    }
    panel.innerHTML = h;
    resendLabel();
    var f = panel.querySelector('input');
    if (isOpen && f) try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); }
  }
  function status(msg, ok) { var s = panel && panel.querySelector('.st'); if (s) { s.textContent = msg || ''; s.classList.toggle('ok', !!ok); } }
  function keepEmail() { var i = panel && panel.querySelector('input[name="email"]'); if (i) email = i.value.trim(); }
  function field(n) { var i = panel.querySelector('input[name="' + n + '"]'); return i ? i.value : ''; }
  function busy(on, label) {
    var b = panel.querySelector('.go');
    if (!b) return;
    if (on) { b.dataset.l = b.textContent; b.textContent = label; } else if (b.dataset.l) b.textContent = b.dataset.l;
    b.disabled = on;
  }
  function resendLabel() {
    var b = panel && panel.querySelector('[data-a="resend"]');
    if (!b) return;
    var left = Math.ceil((cool - Date.now()) / 1000);
    b.disabled = left > 0;
    b.textContent = left > 0 ? t('resendIn', left) : t('resend');
  }
  function errText(e) {
    var k = e && e.message;
    if (k === 'wrong') return t('wrong', e.data && e.data.left);
    return t({ email: 'badEmail', expired: 'expired', quota: 'quota', human: 'human', pwshort: 'pwshort', badlogin: 'badlogin', locked: 'locked' }[k] || 'fail');
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function pwSignIn() {
    keepEmail();
    var pw = field('password');
    if (!EMAIL_RE.test(email)) { status(t('badEmail')); return; }
    if (!pw) { status(t('enterPw')); panel.querySelector('input[name="password"]').focus(); return; }
    busy(true, t('checking'));
    status('');
    call('/api/login/password', { method: 'POST', body: { email: email, password: pw } }).then(function (j) {
      done(j.user);
    }).catch(function (e) {
      busy(false);
      status(errText(e));
      var i = panel.querySelector('input[name="password"]');
      if (i) { i.value = ''; i.focus(); }
    });
  }
  function done(u) {
    email = ''; pendingPw = ''; pwOpen = false;
    setUser(u, 'signin');
    render();
    setTimeout(close, 900);
  }
  function savePw() {
    var pw = field('password');
    if (pw.length < 8) { status(t('pwshort')); return; }
    busy(true, t('checking'));
    call('/api/password', { method: 'POST', body: { password: pw } }).then(function () {
      user.pw = true;
      pwOpen = false;
      render();
      status(t('pwSaved'), true);
    }).catch(function (e) { busy(false); status(errText(e)); });
  }

  function sendCode(again) {
    if (!again) {
      keepEmail();
      if (!EMAIL_RE.test(email)) { status(t('badEmail')); return; }
      flow = step;
      pendingPw = '';
      if (step === 'signup') {
        pendingPw = field('password');
        if (pendingPw.length < 8) { status(t('pwshort')); panel.querySelector('input[name="password"]').focus(); return; }
      }
      busy(true, t('sending'));
    }
    status('');
    var tok = SITEKEY ? freshToken() : Promise.resolve('');
    tok.then(function (ts) {
      return call('/api/login/start', { method: 'POST', body: { email: email, turnstile: ts, lang: lang() } });
    }).then(function (j) {
      cool = Date.now() + 30000;
      clearInterval(coolTimer);
      coolTimer = setInterval(function () { resendLabel(); if (Date.now() > cool) clearInterval(coolTimer); }, 1000);
      step = 'code';
      render();
      if (j.code) { var c = panel.querySelector('input[name="code"]'); if (c) c.placeholder = j.code; }  // local dev only
    }).catch(function (e) {
      if (!again) busy(false);
      status(errText(e));
    });
  }

  function verify() {
    var inp = panel.querySelector('input[name="code"]');
    var code = inp ? inp.value.replace(/\D/g, '') : '';
    var b = panel.querySelector('.go');
    if (code.length !== 6 || (b && b.disabled)) return;
    busy(true, t('checking'));
    status('');
    call('/api/login/verify', { method: 'POST', body: { email: email, code: code, password: pendingPw || undefined } }).then(function (j) {
      done(j.user);
    }).catch(function (e) {
      busy(false);
      status(errText(e));
      if (inp) { inp.value = ''; inp.focus(); }
    });
  }

  function signOut() {
    call('/api/logout', { method: 'POST', body: {} }).catch(function () { /* cookie may already be gone */ }).then(function () {
      setUser(null, 'signout');
      step = 'pw';
      close();
    });
  }
  function deleteAccount() {
    if (!window.confirm(t('delAsk'))) return;
    call('/api/account', { method: 'DELETE' }).then(function () {
      setUser(null, 'delete');
      step = 'pw';
      close();
    }).catch(function (e) { window.alert(errText(e)); });
  }

  // Light or dark, read from what is actually painted behind the button
  function dark(el) {
    for (el = el || document.body; el && el.nodeType === 1; el = el.parentElement) {
      var m = (getComputedStyle(el).backgroundColor || '').match(/[\d.]+/g);
      if (m && (m.length < 4 || +m[3] > 0.5)) return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255 < 0.5;
    }
    return false;
  }
  function place() {
    var narrow = window.innerWidth < 560;
    panel.classList.toggle('sheet', narrow);
    panel.style.top = panel.style.bottom = panel.style.left = panel.style.right = '';
    if (narrow) return;
    var r = opener && opener.isConnected ? opener.getBoundingClientRect() : null;
    if (!r || !r.width) { panel.style.right = '16px'; panel.style.top = '16px'; return; }
    var w = panel.offsetWidth, vw = window.innerWidth;
    panel.style.left = Math.min(Math.max(12, r.right - w), vw - w - 12) + 'px';
    panel.style.top = (r.bottom + 8) + 'px';
  }
  function open(from) {
    if (!host) build();
    opener = from && from.nodeType === 1 ? from : btn;
    panel.classList.remove('light', 'dark');
    panel.classList.add(dark(opener) ? 'dark' : 'light');
    panel.style.fontFamily = getComputedStyle(opener || document.body).fontFamily;
    isOpen = true;
    render();
    panel.hidden = false;
    place();
    requestAnimationFrame(function () { panel.classList.add('on'); });
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (!user && SITEKEY && !pre) pre = { at: Date.now(), p: tsToken() };
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('on');
    panel.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (opener && opener.isConnected) try { opener.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
  }

  // ---------- header button
  function relabel() {
    if (!btn) return;
    var l = btn.querySelector('.msac-l');
    if (user) {
      var i = (user.email || '?').charAt(0).toUpperCase();
      btn.classList.add('msac-in');
      btn.innerHTML = '<span class="msac-av" aria-hidden="true">' + esc(i) + '</span>';
      btn.setAttribute('aria-label', t('account') + ': ' + user.email);
      btn.title = user.email;
    } else {
      btn.classList.remove('msac-in');
      if (!l) { btn.innerHTML = USER + '<span class="msac-l"></span>'; l = btn.querySelector('.msac-l'); }
      l.textContent = t('signin');
      btn.setAttribute('aria-label', t('signin'));
      btn.title = t('signin');
    }
    if (isOpen && step !== 'code') render();
  }
  function init() {
    var css = '.msac-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4em}.msac-btn svg{flex:none}' +
      '.msac-btn.msac-in{padding-left:5px;padding-right:5px}' +
      '.msac-av{display:inline-grid;place-items:center;width:24px;height:24px;margin:-3px 0;border-radius:50%;background:var(--msac-av,#c5050c);color:#fff;font-size:12.5px;font-weight:700;line-height:1}';
    if (+ds.compact) css += '@media (max-width:' + (+ds.compact) + 'px){.msac-btn .msac-l{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}';
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
    var mount = ds.mount && document.querySelector(ds.mount);
    if (mount) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'msac-btn' + (ds.class ? ' ' + ds.class : '');
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () { if (isOpen) close(); else open(btn); });
      var before = ds.before && mount.querySelector(ds.before);
      mount.insertBefore(btn, before || null);
    }
    relabel();
    new MutationObserver(relabel).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-account]');
      if (el) { e.preventDefault(); if (isOpen) close(); else open(el); }
    });
    document.addEventListener('pointerdown', function (e) {
      if (!isOpen) return;
      var path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(host) >= 0 || (opener && path.indexOf(opener) >= 0)) return;
      close();
    }, true);
    document.addEventListener('keydown', function (e) { if (isOpen && e.key === 'Escape') { e.stopPropagation(); close(); } }, true);
    window.addEventListener('resize', function () { if (isOpen) place(); });
  }

  window.MSAccount = {
    get user() { return user; },
    ready: ready,
    on: function (fn) { listeners.push(fn); },
    open: function () { open(btn); },
    load: function (site) { return call('/api/data/' + site); },
    save: function (site, data, o) { return call('/api/data/' + site, { method: 'PUT', body: { data: data }, keepalive: !!(o && o.beacon) }); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

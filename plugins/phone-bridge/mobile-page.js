/**
 * The page a phone opens after scanning the pairing QR code.
 *
 * Self-contained (no third-party resources) and served with a nonce-based CSP.
 * The pairing token arrives in the URL fragment (#t=...), which browsers never
 * send to servers or put in Referer headers; the script strips it from the
 * address bar immediately. API calls use relative URLs so the page keeps
 * working when mounted behind a path-prefixing proxy.
 */

export function renderMobilePage({ nonce }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Send files to your computer</title>
<style nonce="${nonce}">
  :root { color-scheme: dark; --bg:#0B0B0B; --card:#151515; --line:#292929; --text:#F5F5F5; --muted:#A1A1A1; --dim:#666; --accent:#7C3AED; --accent2:#8B5CF6; --ok:#34d399; --err:#fca5a5; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-text-size-adjust:100%; }
  main { max-width:480px; margin:0 auto; padding:24px 16px calc(32px + env(safe-area-inset-bottom)); }
  h1 { font-size:20px; font-weight:600; margin:0 0 4px; }
  p { margin:0; }
  .sub { color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin-top:16px; }
  .code { font:600 26px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.18em; color:var(--accent2); margin:8px 0; }
  .status { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--muted); }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--dim); flex:none; }
  .dot.ok { background:var(--ok); }
  button, .pick { display:flex; align-items:center; justify-content:center; width:100%; min-height:48px; border-radius:12px; border:0; font:600 15px/1 inherit; font-family:inherit; cursor:pointer; margin-top:12px; }
  .primary { background:var(--accent); color:#fff; }
  .primary:disabled { background:var(--line); color:var(--dim); }
  .ghost { background:transparent; color:var(--muted); border:1px solid var(--line); }
  .pick { background:#0B0B0B; color:var(--text); border:1px dashed #444; }
  .pick input { position:absolute; width:1px; height:1px; opacity:0; }
  ul { list-style:none; margin:12px 0 0; padding:0; }
  li { border:1px solid var(--line); border-radius:12px; padding:10px 12px; margin-top:8px; }
  .row { display:flex; align-items:center; gap:10px; }
  .name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; }
  .meta { font-size:12px; color:var(--dim); margin-top:2px; }
  .meta.err { color:var(--err); }
  .meta.ok { color:var(--ok); }
  .x { width:36px; min-height:36px; margin:0; background:transparent; color:var(--muted); border:1px solid var(--line); border-radius:10px; font-size:16px; }
  .bar { height:4px; background:#222; border-radius:2px; margin-top:8px; overflow:hidden; }
  .bar > span { display:block; height:100%; width:0; background:var(--accent); transition:width .2s; }
  .msg { margin-top:12px; font-size:14px; padding:10px 12px; border-radius:10px; }
  .msg.err { background:rgba(127,29,29,.25); color:var(--err); border:1px solid rgba(127,29,29,.5); }
  .msg.ok { background:rgba(6,78,59,.25); color:var(--ok); border:1px solid rgba(6,78,59,.6); }
  .hint { font-size:12px; color:var(--dim); margin-top:10px; }
  .ask { margin-top:12px; padding:10px 12px; border-radius:10px; background:rgba(124,58,237,.12); border:1px solid rgba(124,58,237,.35); font-size:14px; }
  .ask b { display:block; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--accent2); margin-bottom:2px; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <h1>Send files to your computer</h1>
  <p class="sub">Files go only to the computer that showed you the QR code.</p>

  <section id="v-loading" class="card"><p class="sub">Checking pairing…</p></section>

  <section id="v-confirm" class="card" hidden>
    <p class="sub">Pair this phone with the computer showing code</p>
    <p class="code" id="c-code"></p>
    <p class="sub">Make sure this matches the code on your computer screen.</p>
    <p class="ask" id="c-purpose" hidden><b>Requested file</b><span></span></p>
    <button class="primary" id="b-pair" type="button">Pair this phone</button>
    <button class="ghost" id="b-cancel" type="button">Cancel</button>
  </section>

  <section id="v-upload" hidden>
    <div class="card">
      <div class="status"><span class="dot ok"></span><span>Connected · code <b id="u-code"></b></span></div>
      <p class="hint" id="u-expiry"></p>
      <p class="ask" id="u-purpose" hidden><b>Requested file</b><span></span></p>
      <label class="pick">
        <input id="i-files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp">
        Choose files
      </label>
      <p class="hint" id="u-limits"></p>
      <ul id="l-files"></ul>
      <button class="primary" id="b-send" type="button" disabled>Send files</button>
    </div>
    <button class="ghost" id="b-disconnect" type="button">Disconnect phone</button>
  </section>

  <section id="v-ended" class="card" hidden>
    <p id="e-text">This pairing has ended.</p>
    <p class="hint">To send more files, generate a new QR code on your computer.</p>
  </section>

  <div id="msg" class="msg" hidden role="status" aria-live="polite"></div>
</main>
<script nonce="${nonce}">
(function () {
  'use strict';
  var STORAGE_KEY = 'phone-bridge-token';
  var EXT = { pdf: 1, jpg: 1, jpeg: 1, png: 1, webp: 1 };
  var state = { pairingToken: null, phoneToken: null, limits: null, items: [], busy: false, poll: null };

  function $(id) { return document.getElementById(id); }
  function show(view) {
    ['v-loading', 'v-confirm', 'v-upload', 'v-ended'].forEach(function (v) { $(v).hidden = v !== view; });
  }
  function message(text, kind) {
    var el = $('msg');
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'msg ' + (kind || 'err');
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function store(token) {
    try { token ? sessionStorage.setItem(STORAGE_KEY, token) : sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }
  function stored() {
    try { return sessionStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.phoneToken) headers['X-Phone-Bridge-Token'] = state.phoneToken;
    return fetch(path, {
      method: opts.method || 'POST',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ('Request failed (' + res.status + ')'));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function setPurpose(id, text) {
    var el = $(id);
    el.hidden = !text;
    el.querySelector('span').textContent = text || '';
  }

  function ended(text) {
    state.phoneToken = null;
    store(null);
    if (state.poll) clearInterval(state.poll);
    $('e-text').textContent = text || 'This pairing has ended.';
    message('');
    show('v-ended');
  }

  function enterUpload(info) {
    state.limits = info.limits;
    $('u-code').textContent = info.code;
    setPurpose('u-purpose', info.purpose);
    $('u-expiry').textContent = 'Session ends at ' + fmtTime(info.expiresAt) + '. Files are deleted afterwards.';
    $('u-limits').textContent = 'PDF, JPEG, PNG or WebP · up to ' + fmtSize(info.limits.maxFileBytes) +
      ' each · ' + info.limits.remainingFiles + ' more file(s) this session';
    show('v-upload');
    if (state.poll) clearInterval(state.poll);
    state.poll = setInterval(checkStatus, 4000);
  }

  function checkStatus() {
    if (!state.phoneToken || state.busy) return;
    api('phone/status', { method: 'GET' }).then(function (info) {
      state.limits = info.limits;
      $('u-limits').textContent = 'PDF, JPEG, PNG or WebP · up to ' + fmtSize(info.limits.maxFileBytes) +
        ' each · ' + info.limits.remainingFiles + ' more file(s) this session';
    }).catch(function (err) {
      if (err.status === 401 || err.status === 410) {
        var sent = state.items.some(function (it) { return it.status === 'sent'; });
        ended(sent ? 'Done — your file was attached on your computer. You can close this page.' : 'The computer ended this session.');
      }
    });
  }

  function render() {
    var list = $('l-files');
    list.textContent = '';
    state.items.forEach(function (item, i) {
      var li = document.createElement('li');
      var row = document.createElement('div');
      row.className = 'row';
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = item.file.name;
      row.appendChild(name);
      if (item.status === 'ready' || item.status === 'invalid' || item.status === 'failed') {
        var x = document.createElement('button');
        x.className = 'x';
        x.type = 'button';
        x.setAttribute('aria-label', 'Remove ' + item.file.name);
        x.textContent = '×';
        x.disabled = state.busy;
        x.onclick = function () { state.items.splice(i, 1); render(); };
        row.appendChild(x);
      }
      li.appendChild(row);
      var meta = document.createElement('div');
      meta.className = 'meta' + (item.error ? ' err' : item.status === 'sent' ? ' ok' : '');
      meta.textContent = fmtSize(item.file.size) + ' · ' + (item.error || {
        ready: 'Ready to send', uploading: 'Uploading… ' + item.progress + '%', sent: 'Sent to computer ✓',
      }[item.status] || '');
      li.appendChild(meta);
      if (item.status === 'uploading') {
        var bar = document.createElement('div');
        bar.className = 'bar';
        var fill = document.createElement('span');
        fill.style.width = item.progress + '%';
        bar.appendChild(fill);
        li.appendChild(bar);
      }
      list.appendChild(li);
    });
    var sendable = state.items.some(function (it) { return it.status === 'ready' || it.status === 'failed'; });
    $('b-send').disabled = state.busy || !sendable;
    $('b-send').textContent = state.busy ? 'Sending…' : 'Send files';
    $('i-files').disabled = state.busy;
  }

  function precheck(file) {
    var m = /\\.([A-Za-z0-9]+)$/.exec(file.name || '');
    var ext = m ? m[1].toLowerCase() : '';
    if (ext === 'heic' || ext === 'heif') return 'HEIC photos are not supported — choose a JPEG or PDF';
    if (!EXT[ext]) return 'Unsupported type — use PDF, JPEG, PNG or WebP';
    if (state.limits && file.size > state.limits.maxFileBytes) return 'Too large (max ' + fmtSize(state.limits.maxFileBytes) + ')';
    if (file.size === 0) return 'File is empty';
    return null;
  }

  function uploadOne(item) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', 'phone/files');
      xhr.setRequestHeader('X-Phone-Bridge-Token', state.phoneToken);
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(item.file.name));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.timeout = 120000;
      item.status = 'uploading';
      item.progress = 0;
      item.error = null;
      render();
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) { item.progress = Math.round((e.loaded / e.total) * 100); render(); }
      };
      xhr.onload = function () {
        var data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300) {
          item.status = 'sent';
          if (data.limits) state.limits = data.limits;
        } else {
          item.status = 'failed';
          item.error = data.error || ('Upload failed (' + xhr.status + ')');
          if (xhr.status === 401 || xhr.status === 410) item.fatal = true;
        }
        resolve();
      };
      xhr.onerror = function () { item.status = 'failed'; item.error = 'Network error — check your connection and retry'; resolve(); };
      xhr.ontimeout = function () { item.status = 'failed'; item.error = 'Upload timed out — retry'; resolve(); };
      xhr.send(item.file);
    });
  }

  function sendAll() {
    if (state.busy) return;
    state.busy = true;
    message('');
    var queue = state.items.filter(function (it) { return it.status === 'ready' || it.status === 'failed'; });
    var chain = Promise.resolve();
    var fatal = false;
    queue.forEach(function (item) {
      chain = chain.then(function () { if (!fatal) return uploadOne(item).then(function () { if (item.fatal) fatal = true; }); });
    });
    chain.then(function () {
      state.busy = false;
      render();
      if (fatal) return ended('This session has ended. Generate a new QR code on your computer.');
      var sent = queue.filter(function (it) { return it.status === 'sent'; }).length;
      var failed = queue.length - sent;
      if (failed) message(failed + ' file(s) were not sent — see the errors above.', 'err');
      else if (sent) message(sent + ' file(s) sent. Check your computer to attach them.', 'ok');
      checkStatus();
    });
  }

  $('i-files').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    files.forEach(function (file) {
      var error = precheck(file);
      state.items.push({ file: file, status: error ? 'invalid' : 'ready', error: error, progress: 0 });
    });
    e.target.value = '';
    render();
  });
  $('b-send').addEventListener('click', sendAll);

  $('b-pair').addEventListener('click', function () {
    $('b-pair').disabled = true;
    api('phone/pair', { body: { pairingToken: state.pairingToken, confirm: true } }).then(function (info) {
      state.pairingToken = null;
      state.phoneToken = info.phoneToken;
      store(info.phoneToken);
      message('Phone paired.', 'ok');
      enterUpload(info);
    }).catch(function (err) {
      $('b-pair').disabled = false;
      if (err.status === 410 || err.status === 404) ended('This QR code has expired or was already used.');
      else message(err.message);
    });
  });
  $('b-cancel').addEventListener('click', function () { state.pairingToken = null; ended('Pairing cancelled.'); });

  $('b-disconnect').addEventListener('click', function () {
    api('phone/disconnect').catch(function () {}).then(function () { ended('Phone disconnected. Uploaded files were removed.'); });
  });

  // --- boot ---
  var hash = new URLSearchParams(location.hash.slice(1));
  var pairingToken = hash.get('t');
  if (location.hash) history.replaceState(null, '', location.pathname);

  if (pairingToken) {
    state.pairingToken = pairingToken;
    api('phone/preview', { body: { pairingToken: pairingToken } }).then(function (info) {
      $('c-code').textContent = info.code;
      setPurpose('c-purpose', info.purpose);
      show('v-confirm');
    }).catch(function (err) {
      if (err.status === 429) { show('v-ended'); message(err.message); return; }
      ended('This QR code has expired or was already used.');
    });
  } else if (stored()) {
    state.phoneToken = stored();
    api('phone/status', { method: 'GET' }).then(enterUpload).catch(function () { ended(); });
  } else {
    ended('Open this page by scanning the QR code shown on your computer.');
  }
})();
</script>
</body>
</html>`;
}

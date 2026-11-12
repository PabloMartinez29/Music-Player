(function () {
  'use strict';

  var IDLE_MS = 6000;
  var FIRST_HIDE_MS = 800;
  var quietUntil = 0;
  var KEYS = [
    '1234567890'.split(''),
    'qwertyuiop'.split(''),
    'asdfghjklñ'.split(''),
    'zxcvbnm'.split('').concat(['⌫']),
    ['Limpiar', 'Espacio', 'Buscar']
  ];
  var DEMO = [
    { id: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', channel: 'Rick Astley', thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' },
    { id: 'kJQP7kiw5Fk', title: 'Luis Fonsi - Despacito ft. Daddy Yankee', channel: 'Luis Fonsi', thumb: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg' },
    { id: 'JGwWNGJdvx8', title: 'Ed Sheeran - Shape of You', channel: 'Ed Sheeran', thumb: 'https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), fire = $('fire'), q = $('q'), searchEl = $('search'), kb = $('keyboard');
  var cardsEl = $('cards'), resultsEl = $('results'), nowEl = $('now'), toastEl = $('toast');
  var isTv = new URLSearchParams(location.search).has('tv');
  if (isTv) {
    document.body.classList.add('tv');
    q.readOnly = true;
  }

  var zone = 'search';
  var index = { cards: 0, controls: 1 };
  var kRow = 1, kCol = 0;
  var results = [], current = -1, history = [];
  var playedIds = {}, playedKeys = {};
  var query = '', nextToken = null, loadingMore = false;
  var audio = $('audio');
  var playToken = 0;
  var idleTimer = null;

  // ---------- layout ----------

  function fit() {
    var s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = 'scale(' + s + ')';
    stage.style.left = (innerWidth - 1920 * s) / 2 + 'px';
    stage.style.top = (innerHeight - 1080 * s) / 2 + 'px';
  }
  addEventListener('resize', fit);
  fit();

  function fireOn() { fire.classList.add('on'); }
  fire.addEventListener('playing', fireOn);
  fire.addEventListener('timeupdate', fireOn);
  if (!fire.paused && fire.readyState > 2) fireOn();
  fire.play().catch(function () {});

  (function embers() {
    var box = document.querySelector('.embers');
    for (var i = 0; i < 22; i++) {
      var e = document.createElement('i');
      e.style.left = (25 + Math.random() * 50) + '%';
      e.style.setProperty('--dx', (Math.random() * 240 - 120) + 'px');
      e.style.animationDuration = (6 + Math.random() * 7) + 's';
      e.style.animationDelay = (-Math.random() * 12) + 's';
      var size = 2 + Math.random() * 3;
      e.style.width = e.style.height = size + 'px';
      box.appendChild(e);
    }
  })();

  function tick() {
    var d = new Date();
    $('time').textContent = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
    var date = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    $('date').textContent = date.charAt(0).toUpperCase() + date.slice(1);
  }
  tick();
  setInterval(tick, 10000);

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { toastEl.classList.remove('on'); }, 3200);
  }

  // ---------- on-screen keyboard ----------

  var ICON_BACKSPACE = '<svg viewBox="0 0 24 24"><path d="M21 5H9l-6 7 6 7h12z"/><path d="m12 9 6 6m0-6-6 6"/></svg>';
  var ICON_SEARCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  KEYS.forEach(function (row, r) {
    var div = document.createElement('div');
    div.className = 'krow';
    row.forEach(function (key, c) {
      var b = document.createElement('button');
      b.className = 'k';
      if (key === '⌫') { b.className += ' w3'; b.innerHTML = ICON_BACKSPACE; }
      else if (key === 'Limpiar') { b.className += ' w2'; b.textContent = 'Limpiar'; }
      else if (key === 'Espacio') { b.className += ' w5'; b.textContent = 'Espacio'; }
      else if (key === 'Buscar') { b.className += ' w3 enter'; b.innerHTML = ICON_SEARCH + 'Buscar'; }
      else b.textContent = key;
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { kRow = r; kCol = c; press(key); paint(); });
      div.appendChild(b);
    });
    kb.appendChild(div);
  });

  function keyEl(r, c) { return kb.children[r].children[c]; }

  function press(key) {
    if (key === '⌫') q.value = q.value.slice(0, -1);
    else if (key === 'Limpiar') q.value = '';
    else if (key === 'Espacio') { if (q.value && !/ $/.test(q.value)) q.value += ' '; }
    else if (key === 'Buscar') search(q.value);
    else q.value += key;
  }

  function openKeyboard() {
    if (zone === 'keyboard') return;
    zone = 'keyboard';
    kb.classList.remove('hidden');
    searchEl.classList.add('typing');
    document.body.classList.add('typing');
    kRow = 1; kCol = 0;
    wake();
    paint();
  }

  function closeKeyboard(to) {
    kb.classList.add('hidden');
    searchEl.classList.remove('typing');
    document.body.classList.remove('typing');
    if (!isTv) q.blur();
    zone = to || 'search';
    paint();
    armIdle();
  }

  function moveKeyRow(dir) {
    var r = kRow + dir;
    if (r < 0) return;
    if (r >= KEYS.length) { if (results.length) closeKeyboard('cards'); return; }
    var cur = keyEl(kRow, kCol), cx = cur.offsetLeft + cur.offsetWidth / 2, best = 0, bestD = 1e9;
    for (var c = 0; c < KEYS[r].length; c++) {
      var el = keyEl(r, c), d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - cx);
      if (d < bestD) { bestD = d; best = c; }
    }
    kRow = r; kCol = best;
    paint();
  }

  // ---------- focus ----------

  function items(z) {
    if (z === 'search') return [searchEl];
    if (z === 'cards') return Array.prototype.slice.call(cardsEl.children);
    if (z === 'controls') return Array.prototype.slice.call(document.querySelectorAll('.ctl'));
    if (z === 'keyboard') return [keyEl(kRow, kCol)];
    return [];
  }

  function zones() {
    var z = ['search'];
    if (results.length) z.push('cards');
    if (current >= 0) z.push('controls');
    return z;
  }

  function paint() {
    document.querySelectorAll('.focus').forEach(function (el) { el.classList.remove('focus'); });
    var list = items(zone);
    if (!list.length) return;
    if (zone === 'keyboard') { list[0].classList.add('focus'); return; }
    var i = zone === 'search' ? 0 : (index[zone] = Math.max(0, Math.min(list.length - 1, index[zone])));
    list[i].classList.add('focus');
    if (zone === 'cards') {
      var step = 368, visible = 4;
      var max = Math.max(0, list.length - visible);
      var first = Math.max(0, Math.min(max, index.cards - 1));
      cardsEl.style.transform = 'translateX(' + (-first * step) + 'px)';
    }
  }

  function setZone(z) { zone = z; paint(); }

  function moveZone(dir) {
    var z = zones(), i = z.indexOf(zone) + dir;
    if (i >= 0 && i < z.length) setZone(z[i]);
  }

  // ---------- search and queue ----------

  function titleKey(t) {
    return String(t || '').toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\b(official|oficial|video|v[ií]deo|audio|lyrics?|letra|hd|4k|remaster(ed)?|en vivo|live)\b/g, ' ')
      .replace(/[^a-z0-9áéíóúñü ]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 48);
  }

  function fetchPage(text, token) {
    var url = '/api/search?q=' + encodeURIComponent(text) + (token ? '&page=' + encodeURIComponent(token) : '');
    return fetch(url)
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data && r.data.error || 'Error');
        return Array.isArray(r.data) ? { items: r.data, next: null } : r.data;
      })
      .catch(function (e) {
        if (/^(localhost|127\.)/.test(location.hostname)) return { items: token ? [] : DEMO, next: null };
        throw e;
      });
  }

  function search(text) {
    text = String(text || '').trim();
    q.value = '';
    closeKeyboard('search');
    if (!text) return;
    query = text;
    $('results-title').textContent = 'Resultados para “' + text + '”';
    $('results-count').textContent = 'Buscando…';
    resultsEl.classList.remove('hidden');
    document.body.classList.add('has-results');
    fetchPage(text).then(function (page) {
      results = [];
      current = -1;
      history = [];
      playedIds = {};
      playedKeys = {};
      cardsEl.innerHTML = '';
      cardsEl.style.transform = 'translateX(0)';
      nextToken = page.next;
      add(page.items);
      index.cards = 0;
      setZone(results.length ? 'cards' : 'search');
      if (nextToken && results.length < 20) prefetch();
    }).catch(function (e) {
      $('results-count').textContent = '';
      toast('No se pudo buscar: ' + e.message);
    });
  }

  function add(list) {
    var seenIds = {}, seenKeys = {};
    results.forEach(function (r) { seenIds[r.id] = 1; seenKeys[titleKey(r.title)] = 1; });
    var added = 0;
    (list || []).forEach(function (r) {
      var k = titleKey(r.title);
      if (seenIds[r.id] || seenKeys[k] || playedIds[r.id] || playedKeys[k]) return;
      seenIds[r.id] = seenKeys[k] = 1;
      var i = results.push(r) - 1;
      var c = document.createElement('div');
      c.className = 'card';
      c.style.animationDelay = Math.min(added, 8) * 60 + 'ms';
      c.innerHTML = '<div class="art"><img alt=""><div class="play"><svg viewBox="0 0 24 24"><path d="M7 4.5v15L19.5 12z"/></svg></div></div><div class="t"></div><div class="c"></div>';
      c.querySelector('img').src = r.thumb;
      c.querySelector('.t').textContent = r.title;
      c.querySelector('.c').textContent = r.channel;
      c.addEventListener('click', function () { index.cards = i; play(i); });
      cardsEl.appendChild(c);
      added++;
    });
    $('results-count').textContent = results.length ? results.length + ' canciones' : 'Sin resultados';
    return added;
  }

  function upcoming() {
    for (var i = current + 1; i < results.length; i++) {
      if (!playedIds[results[i].id] && !playedKeys[titleKey(results[i].title)]) return i;
    }
    return -1;
  }

  // Pull more pages into the rail without starting playback (used right after a thin first search).
  function prefetch() {
    if (loadingMore || !nextToken) return;
    loadingMore = true;
    fetchPage(query, nextToken).then(function (page) {
      nextToken = page.next;
      loadingMore = false;
      add(page.items);
      if (nextToken && results.length < 24) prefetch();
    }).catch(function () { loadingMore = false; });
  }

  // Like YouTube's autoplay: when the list runs out, keep going with more songs, never repeating one.
  function loadMore() {
    if (loadingMore) return;
    loadingMore = true;
    var base = results[current] || {};
    var text = nextToken ? query : (base.channel ? base.channel + ' canciones' : query);
    var token = nextToken;
    fetchPage(text, token).then(function (page) {
      nextToken = page.next;
      loadingMore = false;
      var before = results.length;
      if (add(page.items) > 0) play(before);
      else if (nextToken) loadMore();
      else toast('No hay más canciones nuevas para esta búsqueda');
    }).catch(function () { loadingMore = false; });
  }

  // ---------- player (audio only — keeps the fireplace video free on the TV) ----------

  audio.addEventListener('ended', function () { next(); });
  audio.addEventListener('playing', function () {
    document.body.classList.remove('paused');
    if (fire && fire.paused) fire.play().catch(function () {});
    quietUntil = Date.now() + 1200;
    armIdle(FIRST_HIDE_MS);
  });
  audio.addEventListener('pause', function () {
    if (!audio.ended) document.body.classList.add('paused');
  });
  audio.addEventListener('error', function () {
    toast('Esta canción no se pudo reproducir. Pasando a otra…');
    setTimeout(next, 1200);
  });

  function play(i, fromHistory) {
    if (i < 0 || i >= results.length) return;
    current = i;
    var r = results[i];
    playedIds[r.id] = 1;
    playedKeys[titleKey(r.title)] = 1;
    if (!fromHistory) history.push(i);
    $('now-title').textContent = r.title;
    $('now-channel').textContent = r.channel;
    $('now-art').src = r.thumb;
    $('bar-fill').style.width = '0';
    $('t-cur').textContent = '0:00';
    $('t-dur').textContent = r.seconds ? fmt(r.seconds) : '0:00';
    nowEl.classList.remove('hidden');
    document.body.classList.remove('paused');
    items('cards').forEach(function (c, k) { c.classList.toggle('playing', k === i); });
    quietUntil = Date.now() + 1500;
    armIdle(FIRST_HIDE_MS);
    // Keep the fireplace moving — music is audio-only, so it does not steal the TV video decoder.
    if (fire && fire.paused) fire.play().catch(function () {});

    var token = ++playToken;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    fetch('/api/stream?id=' + encodeURIComponent(r.id))
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
      .then(function (res) {
        if (token !== playToken) return;
        if (!res.ok || !res.data.url) throw new Error(res.data && res.data.error || 'Sin audio');
        audio.src = res.data.url;
        return audio.play();
      })
      .catch(function (e) {
        if (token !== playToken) return;
        toast('No se pudo reproducir: ' + (e.message || e));
        setTimeout(next, 1200);
      });
  }

  function next() {
    var i = upcoming();
    if (i >= 0) play(i); else loadMore();
  }

  function prev() {
    if (history.length < 2) return;
    history.pop();
    play(history[history.length - 1], true);
  }

  function toggle() {
    if (current < 0) return;
    if (audio.paused) audio.play().catch(function () {}); else audio.pause();
  }

  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
  }

  setInterval(function () {
    if (current < 0 || !audio.src) return;
    var d = audio.duration;
    if (!isFinite(d) || d <= 0) d = (results[current] && results[current].seconds) || 0;
    var t = audio.currentTime || 0;
    $('t-cur').textContent = fmt(t);
    $('t-dur').textContent = fmt(d);
    $('bar-fill').style.width = d ? (t / d * 100) + '%' : '0';
    if (fire && fire.paused && !audio.paused) fire.play().catch(function () {});
  }, 500);

  document.querySelectorAll('.ctl').forEach(function (b) {
    b.addEventListener('click', function () { act(b.getAttribute('data-act')); });
  });

  function act(a) {
    if (a === 'prev') prev();
    else if (a === 'next') next();
    else toggle();
  }

  // ---------- only the fire while music plays ----------

  function playing() { return current >= 0 && !document.body.classList.contains('paused'); }

  function goAmbient() {
    if (playing() && zone !== 'keyboard') document.body.classList.add('ambient');
  }

  function armIdle(ms) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(goAmbient, ms == null ? IDLE_MS : ms);
  }

  function wake() {
    if (Date.now() < quietUntil) return false;
    var was = document.body.classList.contains('ambient');
    document.body.classList.remove('ambient');
    if (playing()) armIdle(IDLE_MS);
    else clearTimeout(idleTimer);
    return was;
  }

  // ---------- keys and mouse ----------

  function exitApp() {
    if (window.parent !== window) window.parent.postMessage({ fogata: 'exit' }, '*');
  }

  searchEl.addEventListener('click', function (e) {
    if (e.target.closest('#go')) { search(q.value); return; }
    openKeyboard();
    if (!isTv) q.focus();
  });

  // On the TV the remote pointer spams mousemove/click and would keep the UI open forever.
  // Only real remote keys wake the interface; on desktop the mouse still does.
  if (!isTv) {
    ['mousemove', 'mousedown', 'wheel'].forEach(function (ev) {
      document.addEventListener(ev, function () { wake(); }, { passive: true });
    });
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;

    if (k === 10252 || k === 415 || k === 19) { e.preventDefault(); wake(); toggle(); return; }
    if (k === 10233 || k === 417) { e.preventDefault(); next(); return; }
    if (k === 10232 || k === 412) { e.preventDefault(); prev(); return; }

    if (wake()) { e.preventDefault(); return; }

    var back = k === 10009 || k === 27 || (k === 8 && zone !== 'keyboard');

    if (zone === 'keyboard') {
      var physical = !isTv && document.activeElement === q;
      if (k === 37) { e.preventDefault(); kCol = Math.max(0, kCol - 1); paint(); }
      else if (k === 39) { e.preventDefault(); kCol = Math.min(KEYS[kRow].length - 1, kCol + 1); paint(); }
      else if (k === 38) { e.preventDefault(); moveKeyRow(-1); }
      else if (k === 40) { e.preventDefault(); moveKeyRow(1); }
      else if (k === 13 || k === 65376) {
        e.preventDefault();
        if (physical) search(q.value); else press(KEYS[kRow][kCol]);
      }
      else if (back || k === 65385) { e.preventDefault(); closeKeyboard('search'); }
      return;
    }

    switch (k) {
      case 37: e.preventDefault(); if (zone !== 'search') { index[zone]--; paint(); } break;
      case 39: e.preventDefault(); if (zone !== 'search') { index[zone]++; paint(); } break;
      case 38: e.preventDefault(); moveZone(-1); break;
      case 40: e.preventDefault(); moveZone(1); break;
      case 13:
        e.preventDefault();
        if (zone === 'search') openKeyboard();
        else if (zone === 'cards') play(index.cards);
        else if (zone === 'controls') act(items('controls')[index.controls].getAttribute('data-act'));
        break;
      default:
        if (back) {
          e.preventDefault();
          if (zone !== 'search') setZone('search'); else exitApp();
        } else if (!isTv && e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          openKeyboard();
          q.focus();
        }
    }
  });

  paint();
  if (window.parent !== window) window.parent.postMessage({ fogata: 'ready' }, '*');
})();

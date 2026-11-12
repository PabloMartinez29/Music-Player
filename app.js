(function () {
  'use strict';

  var GENRES = [
    ['Rancheras', '#ff6a3d', 'rancheras mexicanas clásicas Vicente Fernández Pedro Infante'],
    ['Vallenato', '#ffc04d', 'vallenatos clásicos Diomedes Díaz Binomio de Oro'],
    ['Salsa', '#ff4d6d', 'salsa clásica Grupo Niche Joe Arroyo Héctor Lavoe'],
    ['Bachata', '#c86bff', 'bachata éxitos Romeo Santos Aventura'],
    ['Reggaetón', '#4dd2ff', 'reggaetón éxitos 2026'],
    ['Baladas', '#ff8fb1', 'baladas románticas en español éxitos'],
    ['Rock en español', '#9aa7ff', 'rock en español clásicos Soda Stereo Maná Héroes del Silencio'],
    ['Cumbia', '#7dff9a', 'cumbia colombiana clásica'],
    ['Merengue', '#ffd36b', 'merengue clásico Juan Luis Guerra Wilfrido Vargas'],
    ['Boleros', '#ffae7a', 'boleros clásicos Los Panchos Javier Solís'],
    ['Popular', '#ff7a45', 'música popular colombiana despecho éxitos'],
    ['Jazz', '#6be4ff', 'jazz clásico relajante'],
    ['Clásica', '#e8d7b0', 'música clásica Mozart Beethoven Chopin'],
    ['Lo-fi para relajarse', '#b49cff', 'lofi para relajarse']
  ];
  var AMBIENT_MS = 12000;
  var DEMO = [
    { id: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', channel: 'Rick Astley', thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' },
    { id: 'kJQP7kiw5Fk', title: 'Luis Fonsi - Despacito ft. Daddy Yankee', channel: 'Luis Fonsi', thumb: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg' },
    { id: 'JGwWNGJdvx8', title: 'Ed Sheeran - Shape of You', channel: 'Ed Sheeran', thumb: 'https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), fire = $('fire'), q = $('q'), searchEl = $('search');
  var chipsEl = $('chips'), cardsEl = $('cards'), resultsEl = $('results'), nowEl = $('now');
  var toastEl = $('toast');
  var params = new URLSearchParams(location.search);
  var isTv = params.has('tv');
  if (isTv) document.body.classList.add('tv');

  var zone = 'search';
  var index = { search: 0, chips: 0, cards: 0, controls: 1 };
  var results = [];
  var current = -1;
  var player = null, playerReady = false, pending = -1;
  var ambientTimer = null;

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

  GENRES.forEach(function (g) {
    var b = document.createElement('div');
    b.className = 'chip focusable';
    b.textContent = g[0];
    b.style.setProperty('--c', g[1]);
    b.addEventListener('click', function () { search(g[2], g[0]); });
    chipsEl.appendChild(b);
  });

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { toastEl.classList.remove('on'); }, 3200);
  }

  // ---------- focus ----------

  function items(z) {
    if (z === 'search') return [searchEl];
    if (z === 'chips') return Array.prototype.slice.call(chipsEl.children);
    if (z === 'cards') return Array.prototype.slice.call(cardsEl.children);
    if (z === 'controls') return Array.prototype.slice.call(document.querySelectorAll('.ctl'));
    return [];
  }

  function zones() {
    var z = ['search', 'chips'];
    if (results.length) z.push('cards');
    if (current >= 0) z.push('controls');
    return z;
  }

  function paint() {
    document.querySelectorAll('.focus').forEach(function (el) { el.classList.remove('focus'); });
    var list = items(zone);
    if (!list.length) return;
    index[zone] = Math.max(0, Math.min(list.length - 1, index[zone]));
    list[index[zone]].classList.add('focus');
    if (zone === 'cards') {
      var step = 368, visible = 4;
      var max = Math.max(0, list.length - visible);
      var first = Math.max(0, Math.min(max, index.cards - 1));
      cardsEl.style.transform = 'translateX(' + (-first * step) + 'px)';
    }
  }

  function setZone(z) {
    zone = z;
    paint();
  }

  function moveZone(dir) {
    var z = zones(), i = z.indexOf(zone) + dir;
    if (i >= 0 && i < z.length) setZone(z[i]);
  }

  function moveInZone(dir) {
    if (zone === 'chips') {
      var list = items('chips'), cur = list[index.chips];
      var row = list.filter(function (el) { return Math.abs(el.offsetTop - cur.offsetTop) < 10; });
      var pos = row.indexOf(cur) + dir;
      if (pos >= 0 && pos < row.length) index.chips = list.indexOf(row[pos]);
    } else {
      index[zone] += dir;
    }
    paint();
  }

  function moveChipsRow(dir) {
    var list = items('chips'), cur = list[index.chips];
    var tops = list.map(function (el) { return el.offsetTop; }).filter(function (t, i, a) { return a.indexOf(t) === i; });
    var r = tops.indexOf(cur.offsetTop) + dir;
    if (r < 0 || r >= tops.length) return false;
    var cx = cur.offsetLeft + cur.offsetWidth / 2, best = null, bestD = 1e9;
    list.forEach(function (el, i) {
      if (el.offsetTop !== tops[r]) return;
      var d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - cx);
      if (d < bestD) { bestD = d; best = i; }
    });
    index.chips = best;
    paint();
    return true;
  }

  // ---------- search ----------

  function search(text, label) {
    text = String(text || '').trim();
    if (!text) return;
    q.blur();
    $('results-title').textContent = 'Resultados para “' + (label || text) + '”';
    $('results-count').textContent = 'Buscando…';
    resultsEl.classList.remove('hidden');
    document.body.classList.add('has-results');
    fetch('/api/search?q=' + encodeURIComponent(text))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data && r.data.error || 'Error');
        show(r.data);
      })
      .catch(function (e) {
        if (/^(localhost|127\.)/.test(location.hostname)) {
          show(DEMO);
          toast('Modo de prueba local: resultados de ejemplo');
        } else {
          $('results-count').textContent = '';
          toast('No se pudo buscar: ' + e.message);
        }
      });
  }

  function show(list) {
    results = list || [];
    current = -1;
    $('results-count').textContent = results.length ? results.length + ' canciones' : 'Sin resultados';
    cardsEl.innerHTML = '';
    cardsEl.style.transform = 'translateX(0)';
    results.forEach(function (r, i) {
      var c = document.createElement('div');
      c.className = 'card';
      c.style.animationDelay = Math.min(i, 8) * 60 + 'ms';
      c.innerHTML = '<div class="art"><img alt=""><div class="play"><svg viewBox="0 0 24 24"><path d="M7 4.5v15L19.5 12z"/></svg></div></div><div class="t"></div><div class="c"></div>';
      c.querySelector('img').src = r.thumb;
      c.querySelector('.t').textContent = r.title;
      c.querySelector('.c').textContent = r.channel;
      c.addEventListener('click', function () { index.cards = i; play(i); });
      cardsEl.appendChild(c);
    });
    index.cards = 0;
    if (results.length) setZone('cards'); else setZone('search');
  }

  // ---------- player ----------

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
      width: 356, height: 200,
      playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, fs: 0, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: function () { playerReady = true; if (pending >= 0) play(pending); },
        onStateChange: function (e) {
          if (e.data === 1) document.body.classList.remove('paused');
          if (e.data === 2) document.body.classList.add('paused');
          if (e.data === 0) next(1);
        },
        onError: function () {
          toast('Esta canción no permite reproducirse aquí. Pasando a la siguiente…');
          setTimeout(function () { next(1); }, 1500);
        }
      }
    });
  };
  var api = document.createElement('script');
  api.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(api);

  function play(i) {
    if (i < 0 || i >= results.length) return;
    current = i;
    var r = results[i];
    $('now-title').textContent = r.title;
    $('now-channel').textContent = r.channel;
    $('bar-fill').style.width = '0';
    nowEl.classList.remove('hidden');
    document.body.classList.remove('paused');
    items('cards').forEach(function (c, k) { c.classList.toggle('playing', k === i); });
    fire.volume = 0;
    if (!playerReady) { pending = i; return; }
    pending = -1;
    player.loadVideoById(r.id);
    armAmbient();
  }

  function next(step) {
    var i = current + step;
    if (i >= 0 && i < results.length) play(i);
  }

  function toggle() {
    if (!playerReady || current < 0) return;
    if (player.getPlayerState() === 1) player.pauseVideo(); else player.playVideo();
  }

  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
  }

  setInterval(function () {
    if (!playerReady || current < 0 || !player.getDuration) return;
    var d = player.getDuration(), t = player.getCurrentTime();
    $('t-cur').textContent = fmt(t);
    $('t-dur').textContent = fmt(d);
    $('bar-fill').style.width = d ? (t / d * 100) + '%' : '0';
  }, 500);

  document.querySelectorAll('.ctl').forEach(function (b) {
    b.addEventListener('click', function () { act(b.getAttribute('data-act')); });
  });

  function act(a) {
    if (a === 'prev') next(-1);
    else if (a === 'next') next(1);
    else toggle();
  }

  // ---------- ambient mode ----------

  function armAmbient() {
    clearTimeout(ambientTimer);
    document.body.classList.remove('ambient');
    if (current >= 0) ambientTimer = setTimeout(function () {
      if (document.activeElement !== q) document.body.classList.add('ambient');
    }, AMBIENT_MS);
  }

  function wake() {
    var was = document.body.classList.contains('ambient');
    armAmbient();
    return was;
  }

  // ---------- keys ----------

  function exitApp() {
    if (window.parent !== window) window.parent.postMessage({ fogata: 'exit' }, '*');
  }

  q.addEventListener('focus', function () { zone = 'search'; paint(); });

  document.addEventListener('mousemove', function () { if (!isTv) wake(); });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    var typing = document.activeElement === q;

    if (k === 10252 || k === 415 || k === 19) { e.preventDefault(); wake(); toggle(); return; }
    if (k === 10233 || k === 417) { e.preventDefault(); next(1); return; }
    if (k === 10232 || k === 412) { e.preventDefault(); next(-1); return; }

    if (typing) {
      if (k === 13 || k === 65376) { e.preventDefault(); search(q.value); }
      else if (k === 10009 || k === 27 || k === 65385) { e.preventDefault(); q.blur(); setZone('search'); }
      else if (k === 40) { e.preventDefault(); q.blur(); moveZone(1); }
      wake();
      return;
    }

    if (wake()) { e.preventDefault(); return; }

    switch (k) {
      case 37: e.preventDefault(); moveInZone(-1); break;
      case 39: e.preventDefault(); moveInZone(1); break;
      case 38: e.preventDefault(); if (!(zone === 'chips' && moveChipsRow(-1))) moveZone(-1); break;
      case 40: e.preventDefault(); if (!(zone === 'chips' && moveChipsRow(1))) moveZone(1); break;
      case 13:
        e.preventDefault();
        if (zone === 'search') q.focus();
        else if (zone === 'chips') { var g = GENRES[index.chips]; search(g[2], g[0]); }
        else if (zone === 'cards') play(index.cards);
        else if (zone === 'controls') act(items('controls')[index.controls].getAttribute('data-act'));
        break;
      case 10009: case 27: case 8:
        e.preventDefault();
        if (zone !== 'search') setZone('search'); else exitApp();
        break;
    }
  });

  paint();
  if (window.parent !== window) window.parent.postMessage({ fogata: 'ready' }, '*');
})();

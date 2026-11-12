// GET /api/search?q=texto[&page=token]  ->  { items: [{ id, title, channel, thumb, seconds }], next }
// La clave vive en YOUTUBE_KEY de Vercel.

const MIN_SECONDS = 75;
const MAX_SECONDS = 12 * 60;
const TARGET = 30;
const MAX_PAGES = 4;

const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const seconds = (iso) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
};

const tokensOf = (q) =>
  String(q || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);

function musicQuery(q) {
  const t = q.trim().replace(/^["']|["']$/g, '');
  // Phrase search so "La Carta" does not become unrelated hits.
  if (t.split(/\s+/).length <= 8) return '"' + t + '"';
  return t;
}

function scoreItem(it, tokens) {
  const title = it.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const channel = it.channel.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let s = 0;
  let hit = 0;
  tokens.forEach((t) => {
    if (title.includes(t)) { s += 4; hit++; }
    if (channel.includes(t)) s += 1;
  });
  if (tokens.length && hit === tokens.length) s += 12;
  if (hit === 0) s -= 20;
  if (/topic|vevo|official|oficial/.test(channel)) s += 6;
  if (/- topic$/.test(channel) || channel.endsWith('topic')) s += 4;
  if (/\b(mix|compil|playlist|medley|hora|horas|album completo|álbum completo|full album)\b/.test(title)) s -= 14;
  if (/\b(live|en vivo|concert|concierto)\b/.test(title)) s -= 3;
  if (/\b(audio|lyric|letra|oficial|official)\b/.test(title)) s += 2;
  // Prefer typical song lengths.
  if (it.seconds >= 120 && it.seconds <= 360) s += 2;
  return s;
}

async function searchPage(key, q, pageToken) {
  // No videoEmbeddable filter: we play audio-only, not an iframe embed.
  const url =
    'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video' +
    '&videoCategoryId=10&maxResults=25&regionCode=CO&relevanceLanguage=es' +
    '&q=' + encodeURIComponent(q) +
    (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '') +
    '&key=' + key;

  const data = await (await fetch(url)).json();
  if (data.error) throw Object.assign(new Error(data.error.message), { yt: true });

  const found = (data.items || []).filter((it) => it.id && it.id.videoId);
  const ids = found.map((it) => it.id.videoId).join(',');
  const lengths = {};
  if (ids) {
    const info = await (await fetch(
      'https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=' + ids + '&key=' + key
    )).json();
    (info.items || []).forEach((v) => {
      lengths[v.id] = seconds(v.contentDetails && v.contentDetails.duration);
    });
  }

  const items = found
    .map((it) => ({
      id: it.id.videoId,
      title: decode(it.snippet.title),
      channel: decode(it.snippet.channelTitle),
      thumb: (it.snippet.thumbnails.high || it.snippet.thumbnails.medium || it.snippet.thumbnails.default).url,
      seconds: lengths[it.id.videoId] || 0,
    }))
    .filter((it) => it.seconds >= MIN_SECONDS && it.seconds <= MAX_SECONDS);

  return { items, next: data.nextPageToken || null };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = String((req.query && req.query.q) || '').trim().slice(0, 120);
  const page = String((req.query && req.query.page) || '').slice(0, 100);
  if (!q) return res.status(400).json({ error: 'Falta el texto de búsqueda' });
  const key = process.env.YOUTUBE_KEY;
  if (!key) return res.status(500).json({ error: 'Falta configurar YOUTUBE_KEY en Vercel' });

  const query = musicQuery(q);
  const tokens = tokensOf(q);

  try {
    const seen = {};
    const items = [];
    let token = page || '';
    let next = null;
    let pages = 0;

    do {
      const batch = await searchPage(key, query, token);
      batch.items.forEach((it) => {
        if (seen[it.id]) return;
        seen[it.id] = 1;
        items.push(it);
      });
      next = batch.next;
      token = next || '';
      pages++;
    } while (items.length < TARGET && next && pages < MAX_PAGES);

    items.sort((a, b) => scoreItem(b, tokens) - scoreItem(a, tokens));
    const filtered = items.filter((it) => scoreItem(it, tokens) > 0);

    res.setHeader('Cache-Control', 's-maxage=7200, stale-while-revalidate=86400');
    return res.status(200).json({ items: filtered.length ? filtered : items.slice(0, 12), next });
  } catch (e) {
    if (e.yt) return res.status(502).json({ error: e.message });
    return res.status(502).json({ error: 'No se pudo consultar YouTube' });
  }
};

// GET /api/search?q=texto[&page=token]  ->  { items: [{ id, title, channel, thumb, seconds }], next }
// La clave vive en la variable de entorno YOUTUBE_KEY de Vercel, nunca en el navegador.

const MIN_SECONDS = 60;
const MAX_SECONDS = 20 * 60;
const TARGET = 36;
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

function musicQuery(q) {
  const t = q.trim();
  if (/\b(cancion|canciones|m[uú]sica|album|álbum|official|oficial|live|en vivo)\b/i.test(t)) return t;
  return t + ' canciones';
}

async function searchPage(key, q, pageToken) {
  const url =
    'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true' +
    '&videoSyndicated=true&videoCategoryId=10&maxResults=25&regionCode=CO&relevanceLanguage=es' +
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

  try {
    const seen = {};
    const items = [];
    let token = page || '';
    let next = null;
    let pages = 0;

    // Keep pulling YouTube pages until we have a full rail of songs (artists often return mixes/shorts first).
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

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ items, next });
  } catch (e) {
    if (e.yt) return res.status(502).json({ error: e.message });
    return res.status(502).json({ error: 'No se pudo consultar YouTube' });
  }
};

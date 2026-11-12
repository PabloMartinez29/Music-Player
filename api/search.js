// GET /api/search?q=texto[&page=token]  ->  { items: [{ id, title, channel, thumb, seconds }], next }
// La clave vive en la variable de entorno YOUTUBE_KEY de Vercel, nunca en el navegador.

const MIN_SECONDS = 60;
const MAX_SECONDS = 15 * 60;

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = String((req.query && req.query.q) || '').trim().slice(0, 120);
  const page = String((req.query && req.query.page) || '').slice(0, 100);
  if (!q) return res.status(400).json({ error: 'Falta el texto de búsqueda' });
  const key = process.env.YOUTUBE_KEY;
  if (!key) return res.status(500).json({ error: 'Falta configurar YOUTUBE_KEY en Vercel' });

  const searchUrl =
    'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true' +
    '&videoSyndicated=true&maxResults=25&regionCode=CO&relevanceLanguage=es' +
    '&q=' + encodeURIComponent(q) + (page ? '&pageToken=' + encodeURIComponent(page) : '') + '&key=' + key;

  try {
    const data = await (await fetch(searchUrl)).json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    const found = (data.items || []).filter((it) => it.id && it.id.videoId);

    // Durations cost 1 quota unit for all 25 videos; used to drop hour-long mixes and shorts.
    const ids = found.map((it) => it.id.videoId).join(',');
    const lengths = {};
    if (ids) {
      const info = await (await fetch(
        'https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=' + ids + '&key=' + key)).json();
      (info.items || []).forEach((v) => { lengths[v.id] = seconds(v.contentDetails && v.contentDetails.duration); });
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

    // Same search within 6 h is served from Vercel's cache and doesn't spend YouTube quota.
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ items, next: data.nextPageToken || null });
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo consultar YouTube' });
  }
};

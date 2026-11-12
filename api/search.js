// GET /api/search?q=texto  ->  [{ id, title, channel, thumb }]
// La clave vive en la variable de entorno YOUTUBE_KEY de Vercel, nunca en el navegador.

const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = String((req.query && req.query.q) || '').trim().slice(0, 120);
  if (!q) return res.status(400).json({ error: 'Falta el texto de búsqueda' });
  if (!process.env.YOUTUBE_KEY) return res.status(500).json({ error: 'Falta configurar YOUTUBE_KEY en Vercel' });

  const url =
    'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true' +
    '&videoSyndicated=true&maxResults=25&regionCode=CO&relevanceLanguage=es' +
    '&q=' + encodeURIComponent(q) + '&key=' + process.env.YOUTUBE_KEY;

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    const items = (data.items || []).map((it) => ({
      id: it.id.videoId,
      title: decode(it.snippet.title),
      channel: decode(it.snippet.channelTitle),
      thumb: (it.snippet.thumbnails.high || it.snippet.thumbnails.medium || it.snippet.thumbnails.default).url,
    }));
    // Same search within 6 h is served from Vercel's cache and doesn't spend YouTube quota.
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json(items);
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo consultar YouTube' });
  }
};

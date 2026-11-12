// Fallback only. On the TV we use the LAN audio proxy (?audio=http://PC:8787)
// so the fireplace video keeps the hardware decoder.
const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.reallyaweso.me',
  'https://api.piped.yt',
];

async function piped(base, id) {
  const r = await fetch(base + '/streams/' + encodeURIComponent(id), {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) throw new Error('piped ' + r.status);
  const j = await r.json();
  const list = (j.audioStreams || [])
    .filter((s) => s && s.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (!list.length) throw new Error('piped sin audio');
  return { url: list[0].url, mime: list[0].mimeType || 'audio/mp4' };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const id = String((req.query && req.query.id) || '').trim();
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(id)) {
    return res.status(400).json({ error: 'id inválido' });
  }
  const errors = [];
  for (let i = 0; i < PIPED.length; i++) {
    try {
      const out = await piped(PIPED[i], id);
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
      return res.status(200).json(out);
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  return res.status(502).json({
    error: 'En el televisor usa el servidor de audio de la PC (puerto 8787)',
    detail: errors.slice(0, 4),
  });
};

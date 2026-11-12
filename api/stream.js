// GET /api/stream?id=VIDEO_ID  ->  { url, mime }
// Returns an audio-only URL so the TV can keep playing the fireplace video
// (Tizen typically has one video decoder; a YouTube <iframe> steals it and blacks out the fire).

const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.darkness.services',
  'https://api.piped.private.coffee',
];

const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.fdn.fr',
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
  const best = list[0];
  return { url: best.url, mime: best.mimeType || 'audio/mp4' };
}

async function invidious(base, id) {
  const r = await fetch(base + '/api/v1/videos/' + encodeURIComponent(id), {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) throw new Error('invidious ' + r.status);
  const j = await r.json();
  const list = (j.adaptiveFormats || [])
    .filter((s) => s && s.url && /^audio\//.test(s.type || s.mimeType || ''))
    .sort((a, b) => (parseInt(b.bitrate, 10) || 0) - (parseInt(a.bitrate, 10) || 0));
  if (!list.length) throw new Error('invidious sin audio');
  const best = list[0];
  return { url: best.url, mime: best.type || best.mimeType || 'audio/mp4' };
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
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json(out);
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  for (let i = 0; i < INVIDIOUS.length; i++) {
    try {
      const out = await invidious(INVIDIOUS[i], id);
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json(out);
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  return res.status(502).json({ error: 'No se pudo obtener el audio', detail: errors.slice(0, 4) });
};

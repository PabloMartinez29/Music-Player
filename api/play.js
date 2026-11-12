// GET /api/play?id=VIDEO_ID[&start=seconds&dur=seconds]
// Proxies YouTube audio through Vercel so the TV never talks to your PC,
// and the fireplace <video> can keep the only hardware decoder.

const { Readable } = require('stream');
const youtubedl = require('youtube-dl-exec');

const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

async function resolveUrl(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.url;

  const out = await youtubedl.exec(
    'https://www.youtube.com/watch?v=' + id,
    {
      f: 'bestaudio[ext=m4a]/bestaudio/ba/bestaudio',
      g: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      forceIpv4: true,
    },
    { buffer: true }
  );

  const url = String(out.stdout || '')
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => /^https?:\/\//.test(s));

  if (!url) throw new Error('Sin URL de audio');
  cache.set(id, { url, at: Date.now() });
  return url;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Range,Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const id = String((req.query && req.query.id) || '').trim();
  const start = Math.max(0, Number((req.query && req.query.start) || 0) || 0);
  const dur = Math.max(0, Number((req.query && req.query.dur) || 0) || 0);
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(id)) {
    return res.status(400).json({ error: 'id inválido' });
  }

  try {
    const audioUrl = await resolveUrl(id);
    const headers = {};
    if (req.headers.range) {
      headers.Range = req.headers.range;
    } else if (start > 1) {
      // Approximate seek so a cold Vercel timeout can resume mid-song.
      const head = await fetch(audioUrl, { method: 'HEAD' }).catch(() => null);
      const len = head && Number(head.headers.get('content-length') || 0);
      if (len && dur > 1) {
        const byte = Math.min(len - 1, Math.floor((start / dur) * len));
        headers.Range = 'bytes=' + byte + '-';
      }
    }

    const upstream = await fetch(audioUrl, { headers });
    res.status(upstream.status);
    ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((h) => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    if (!res.getHeader('content-type')) res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Cache-Control', 'no-store');

    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};

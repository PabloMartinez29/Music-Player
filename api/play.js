// GET /api/play?id=VIDEO_ID[&start=seconds&dur=seconds]
// Resolves audio via YouTube ANDROID client (no cookies) and proxies bytes
// so the TV does not need your PC. Fireplace video keeps the decoder free.

const { Readable } = require('stream');

const cache = new Map();
const CACHE_MS = 25 * 60 * 1000;

async function resolveUrl(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.url;

  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': '20.10.38',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '20.10.38',
          androidSdkVersion: 34,
          hl: 'es',
          gl: 'CO',
        },
      },
      videoId: id,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });

  const j = await r.json();
  const status = j.playabilityStatus && j.playabilityStatus.status;
  if (status && status !== 'OK') {
    throw new Error((j.playabilityStatus.reason || status || 'blocked').toString());
  }

  const formats = []
    .concat((j.streamingData && j.streamingData.adaptiveFormats) || [])
    .concat((j.streamingData && j.streamingData.formats) || []);

  const audio = formats
    .filter((f) => f && f.url && /audio/i.test(f.mimeType || ''))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  if (!audio.length) throw new Error('Sin audio reproducibile');
  const url = audio[0].url;
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
      const head = await fetch(audioUrl, { method: 'HEAD' }).catch(() => null);
      const len = head && Number(head.headers.get('content-length') || 0);
      if (len && dur > 1) {
        headers.Range = 'bytes=' + Math.min(len - 1, Math.floor((start / dur) * len)) + '-';
      }
    }

    const upstream = await fetch(audioUrl, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      throw new Error('Audio HTTP ' + upstream.status);
    }
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

// GET /api/play?id=VIDEO_ID[&start=seconds&dur=seconds]
// Proxies YouTube audio on Vercel (no PC). Fireplace video keeps the TV decoder.

const { Readable } = require('stream');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const YTDLP = '/tmp/yt-dlp';
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;
let installing = null;

async function ensureYtDlp() {
  if (fs.existsSync(YTDLP)) {
    try {
      fs.accessSync(YTDLP, fs.constants.X_OK);
      return YTDLP;
    } catch (e) {
      /* reinstall */
    }
  }
  if (!installing) {
    installing = (async () => {
      const res = await fetch(YTDLP_URL, {
        headers: { 'User-Agent': 'FogataAudio/1.0' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error('No se pudo bajar yt-dlp (' + res.status + ')');
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(YTDLP, buf, { mode: 0o755 });
      installing = null;
      return YTDLP;
    })().catch((e) => {
      installing = null;
      throw e;
    });
  }
  return installing;
}

async function resolveUrl(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.url;

  const bin = await ensureYtDlp();
  const { stdout } = await execFileAsync(
    bin,
    [
      '-f', 'bestaudio[ext=m4a]/bestaudio/ba/bestaudio',
      '-g',
      '--no-warnings',
      '--no-check-certificates',
      '--prefer-free-formats',
      '--force-ipv4',
      'https://www.youtube.com/watch?v=' + id,
    ],
    { timeout: 45000, maxBuffer: 2 * 1024 * 1024 }
  );

  const url = String(stdout || '')
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
      const head = await fetch(audioUrl, { method: 'HEAD' }).catch(() => null);
      const len = head && Number(head.headers.get('content-length') || 0);
      if (len && dur > 1) {
        const byte = Math.min(len - 1, Math.floor((start / dur) * len));
        headers.Range = 'bytes=' + byte + '-';
      }
    }

    const upstream = await fetch(audioUrl, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      throw new Error('YouTube audio HTTP ' + upstream.status);
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

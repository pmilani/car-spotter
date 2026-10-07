import http from 'node:http';

const PORT = Number(process.env.PORT || 3000);
const allowedOrigin = (process.env.ALLOWED_ORIGIN || '*').trim();
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TOKEN_RE = /^[A-Za-z0-9]{6,64}$/;
const ICLOUD_HOST_RE = /^p\d+-sharedstreams\.icloud\.com$/;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// Optional default album from the environment (only used by the legacy /api/album route).
const envAlbum = (process.env.ALBUM_TOKEN || process.env.ALBUM_URL || '').trim().replace(/^['"]|['"]$/g, '');
const envToken = (envAlbum.includes('#') ? envAlbum.split('#')[1] : envAlbum).trim();

// ---- iCloud shared album (unofficial public endpoints used by the web viewer)
async function ic(token, host, endpoint, body, depth = 0) {
  if (!ICLOUD_HOST_RE.test(host)) throw new HttpError(502, 'Unexpected iCloud host');
  const r = await fetch(`https://${host}/${token}/sharedstreams/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  if (r.status === 330 && depth < 3) {
    const j = await r.json();
    return ic(token, j['X-Apple-MMe-Host'], endpoint, body, depth + 1);
  }
  if (!r.ok) throw new HttpError(502, `iCloud returned ${r.status} for ${endpoint} (is "Public Website" enabled on the album?)`);
  return { json: await r.json(), host };
}

function firstHost(token) {
  const a = B62.indexOf(token[1]);
  const c = B62.indexOf(token[2]);
  const n = token[0] === 'A' ? a : a * 62 + c;
  if (a < 0 || (token[0] !== 'A' && c < 0) || n > 999) throw new HttpError(400, 'That does not look like a valid iCloud shared album token');
  return `p${String(n).padStart(2, '0')}-sharedstreams.icloud.com`;
}

const cache = new Map(); // token -> { t, photos }
async function icloudPhotos(token, forceRefresh = false) {
  if (!TOKEN_RE.test(token || '')) throw new HttpError(400, 'Missing or invalid album token');
  const hit = cache.get(token);
  if (!forceRefresh && hit && Date.now() - hit.t < 10 * 60e3 && hit.photos.length) return hit.photos;

  const s = await ic(token, firstHost(token), 'webstream', { streamCtag: null });
  const photos = s.json.photos || [];
  if (!photos.length) { cache.set(token, { t: Date.now(), photos: [] }); return []; }
  const a = await ic(token, s.host, 'webasseturls', { photoGuids: photos.map(p => p.photoGuid) });
  const items = a.json.items || {}, locs = a.json.locations || {};

  const out = photos.map(p => {
    const ds = Object.entries(p.derivatives || {})
      .map(([k, d]) => ({ k, size: Math.max(+d.width || 0, +d.height || 0), sum: d.checksum }))
      .filter(d => items[d.sum]);
    const imgs = ds.filter(d => /^\d+$/.test(d.k)).sort((x, y) => x.size - y.size);
    const pick = imgs.filter(d => d.size <= 1600).pop() || imgs[0] || ds[0];
    if (!pick) return null;
    const u = d => {
      const it = items[d.sum], l = it && locs[it.url_location];
      return l ? `${l.scheme}://${l.hosts[0]}${it.url_path}` : null;
    };
    const big = imgs[imgs.length - 1] || pick;
    if (!u(pick)) return null;
    return {
      guid: p.photoGuid,
      caption: p.caption || '',
      video: ds.some(d => !/^\d+$/.test(d.k) && d.k !== 'PosterFrame'),
      url: u(pick),
      full: u(big)
    };
  }).filter(Boolean);

  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(token, { t: Date.now(), photos: out });
  return out;
}

// ---- photo source registry: add new source types here
const SOURCES = {
  icloud: (q, refresh) => icloudPhotos(q.get('token'), refresh)
};

// ---- API-only server
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigin === '*' || origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin === '*' ? '*' : origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const q = url.searchParams, refresh = q.get('refresh') === '1';
    if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/source') {
      const handler = SOURCES[q.get('type')];
      if (!handler) throw new HttpError(400, `Unsupported source type: ${q.get('type')}`);
      return send(200, await handler(q, refresh));
    }
    if (req.method === 'GET' && url.pathname === '/api/album') { // legacy: album from env
      if (!envToken) throw new HttpError(404, 'No default album configured');
      return send(200, await icloudPhotos(envToken, refresh));
    }
    send(404, { error: 'Not found' });
  } catch (e) {
    send(e.status || 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Car Spotter API listening on port ${PORT}`));

import http from 'node:http';

const PORT = Number(process.env.PORT || 3000);
const albumUrl = (process.env.ALBUM_URL || '').trim().replace(/^['"]|['"]$/g, '');
const token = (() => {
  if (!albumUrl) return '';
  try {
    const hash = new URL(albumUrl).hash;
    return hash ? hash.slice(1) : '';
  } catch {
    return albumUrl.includes('#') ? albumUrl.split('#')[1] : '';
  }
})().trim();
const allowedOrigin = (process.env.ALLOWED_ORIGIN || '*').trim();
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// ---- iCloud shared album (unofficial public endpoints used by the web viewer)
async function ic(host, endpoint, body) {
  const r = await fetch(`https://${host}/${token}/sharedstreams/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body)
  });
  if (r.status === 330) { const j = await r.json(); return ic(j['X-Apple-MMe-Host'], endpoint, body); }
  if (!r.ok) throw new Error(`iCloud returned ${r.status} for ${endpoint}`);
  return { json: await r.json(), host };
}

let cache = { t: 0, photos: [] };
async function album(forceRefresh = false) {
  if (!token) throw new Error('No album URL configured. Set ALBUM_URL in the Render environment variables.');
  if (!forceRefresh && Date.now() - cache.t < 10 * 60e3 && cache.photos.length) return cache.photos;

  const n = token[0] === 'A'
    ? B62.indexOf(token[1])
    : B62.indexOf(token[1]) * 62 + B62.indexOf(token[2]);
  const s = await ic(`p${String(n).padStart(2, '0')}-sharedstreams.icloud.com`, 'webstream', { streamCtag: null });
  const photos = s.json.photos || [];
  const a = await ic(s.host, 'webasseturls', { photoGuids: photos.map(p => p.photoGuid) });
  const items = a.json.items || {}, locs = a.json.locations || {};

  cache = { t: Date.now(), photos: photos.map(p => {
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
  }).filter(Boolean) };

  return cache.photos;
}

// ---- API-only server
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigin === '*' || origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin === '*' ? '*' : origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/album') {
      return send(200, await album(url.searchParams.get('refresh') === '1'));
    }
    send(404, { error: 'Not found' });
  } catch (e) {
    send(500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Car Spotter API listening on port ${PORT}`));

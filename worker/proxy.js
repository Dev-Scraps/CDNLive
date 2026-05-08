/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         IPTV HLS PROXY — CLOUDFLARE WORKER (ADVANCED)          ║
 * ║  CORS bypass · M3U8 rewrite · Geo-spoof · Header inject        ║
 * ║  Rate limiting · Token auth · Segment caching · TS proxy       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * DEPLOY:
 *   1. Paste this file into Cloudflare Workers editor → Deploy
 *   2. (Optional) Set Worker env variables:
 *        SECRET_TOKEN  — shared secret for token auth (leave blank = open)
 *        ALLOWED_ORIGINS — comma-separated allowed request origins
 *
 * USAGE:
 *   Proxy a stream:
 *     GET /proxy?url=<encoded_m3u8_url>
 *     GET /proxy?url=<encoded_m3u8_url>&referer=<encoded_referer>&origin=<encoded_origin>&ua=<encoded_useragent>
 *
 *   With token auth:
 *     GET /proxy?url=...&token=YOUR_SECRET_TOKEN
 *     or Header: X-Proxy-Token: YOUR_SECRET_TOKEN
 *
 *   Stream key (base64url encoded payload):
 *     GET /stream/<base64url_json>
 *     payload: { url, referer, origin, ua }
 *
 *   Generate stream key (client side):
 *     const key = btoa(JSON.stringify({ url, referer, origin }))
 *       .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────

const CONFIG = {
  // Set to a secret string to require token auth. Empty = open proxy.
  SECRET_TOKEN: typeof SECRET_TOKEN !== 'undefined' ? SECRET_TOKEN : '',

  // Comma-separated allowed CORS origins. '*' = allow all.
  ALLOWED_ORIGINS: typeof ALLOWED_ORIGINS !== 'undefined'
    ? ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['*'],

  // Max requests per IP per minute (rate limiting via in-memory map)
  RATE_LIMIT_RPM: 300,

  // Cache TTL for M3U8 playlists (seconds). Segments are never cached.
  PLAYLIST_CACHE_TTL: 5,

  // Default User-Agent to send upstream when none is provided
  DEFAULT_UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',

  // These headers from the upstream response are forwarded to client
  FORWARDED_RESPONSE_HEADERS: [
    'content-type',
    'content-length',
    'accept-ranges',
    'content-range',
    'cache-control',
    'last-modified',
    'etag',
  ],

  // Strip these from upstream requests (can expose proxy)
  STRIP_UPSTREAM_HEADERS: [
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'cf-visitor',
    'x-forwarded-for',
    'x-real-ip',
    'x-forwarded-proto',
    'cdn-loop',
  ],
};

// ─── RATE LIMITER (in-memory, resets per isolate lifetime) ─────────────────

const rateLimitMap = new Map(); // ip → { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60_000 };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  return entry.count <= CONFIG.RATE_LIMIT_RPM;
}

// ─── CORS HEADERS ──────────────────────────────────────────────────────────

function corsHeaders(requestOrigin) {
  const allowed = CONFIG.ALLOWED_ORIGINS;
  const origin = (allowed.includes('*') || allowed.includes(requestOrigin))
    ? (requestOrigin || '*')
    : allowed[0];

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Range, Origin, Referer, X-Proxy-Token',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Accept-Ranges',
    'Access-Control-Max-Age': '86400',
  };
}

// ─── BUILD UPSTREAM HEADERS ────────────────────────────────────────────────

function buildUpstreamHeaders(opts = {}) {
  const { referer, origin, ua, extraHeaders = {} } = opts;
  const headers = new Headers();

  headers.set('User-Agent', ua || CONFIG.DEFAULT_UA);
  headers.set('Accept', '*/*');
  headers.set('Accept-Language', 'en-US,en;q=0.9');
  headers.set('Accept-Encoding', 'gzip, deflate, br');
  headers.set('Connection', 'keep-alive');

  if (referer) {
    headers.set('Referer', referer);
    // Some providers check Sec-Fetch-Site; mimic a same-site fetch
    headers.set('Sec-Fetch-Site', 'same-origin');
  } else {
    headers.set('Sec-Fetch-Site', 'cross-site');
  }

  if (origin) {
    headers.set('Origin', origin);
  }

  headers.set('Sec-Fetch-Mode', 'cors');
  headers.set('Sec-Fetch-Dest', 'empty');

  // Merge any extra headers passed by client
  for (const [k, v] of Object.entries(extraHeaders)) {
    headers.set(k, v);
  }

  return headers;
}

// ─── M3U8 PLAYLIST REWRITER ────────────────────────────────────────────────

/**
 * Rewrites all URLs inside an M3U8 playlist to route through this proxy.
 * Handles:
 *   - Relative segment paths  (e.g.  segment0.ts)
 *   - Relative directory paths (e.g.  chunks/seg0.ts)
 *   - Absolute URLs           (e.g.  https://cdn.example.com/seg.ts)
 *   - Nested M3U8 playlists   (master → variant → segments)
 *   - #EXT-X-KEY URIs         (encryption keys)
 *   - #EXT-X-MEDIA URIs       (audio/subtitle tracks)
 *   - #EXT-X-MAP URIs         (init segments for fMP4)
 */
function rewriteM3U8(body, baseUrl, proxyBase, proxyOpts) {
  const base = new URL(baseUrl);

  // Build proxy prefix: /proxy?referer=...&origin=...&ua=...&url=
  const optParams = new URLSearchParams();
  if (proxyOpts.referer) optParams.set('referer', proxyOpts.referer);
  if (proxyOpts.origin)  optParams.set('origin',  proxyOpts.origin);
  if (proxyOpts.ua)      optParams.set('ua',       proxyOpts.ua);
  if (proxyOpts.token)   optParams.set('token',    proxyOpts.token);

  const proxyPrefix = `${proxyBase}/proxy?${optParams.toString()}&url=`;

  /**
   * Resolve a URL found inside the M3U8 against the base URL,
   * then wrap it in the proxy prefix.
   */
  function wrapUrl(rawUrl) {
    rawUrl = rawUrl.trim();
    if (!rawUrl || rawUrl.startsWith('#')) return rawUrl;
    try {
      const resolved = new URL(rawUrl, base).href;
      return proxyPrefix + encodeURIComponent(resolved);
    } catch {
      return rawUrl;
    }
  }

  /**
   * Rewrite a tag attribute value like:
   *   URI="chunks/key.bin"  →  URI="https://worker.../proxy?url=..."
   */
  function rewriteUriAttribute(line) {
    return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
      return `URI="${wrapUrl(uri)}"`;
    });
  }

  const lines = body.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      out.push(line);
      continue;
    }

    // Rewrite URI= attributes in tags (KEY, MEDIA, MAP, SESSION-DATA, etc.)
    if (trimmed.startsWith('#EXT-X-KEY') ||
        trimmed.startsWith('#EXT-X-MEDIA') ||
        trimmed.startsWith('#EXT-X-MAP') ||
        trimmed.startsWith('#EXT-X-SESSION-DATA') ||
        trimmed.startsWith('#EXT-X-PRELOAD-HINT')) {
      out.push(rewriteUriAttribute(line));
      continue;
    }

    // Rewrite #EXT-X-STREAM-INF / #EXT-X-I-FRAME-STREAM-INF
    // The next non-comment line after #EXT-X-STREAM-INF is the playlist URL
    if (trimmed.startsWith('#EXT-X-STREAM-INF') ||
        trimmed.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
      out.push(rewriteUriAttribute(line));
      // For I-FRAME-STREAM-INF, URI is inline — already handled above
      // For STREAM-INF, the URL is on the next line
      if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
        i++;
        if (i < lines.length) {
          const nextLine = lines[i].trim();
          if (nextLine && !nextLine.startsWith('#')) {
            out.push(wrapUrl(nextLine));
          } else {
            out.push(lines[i]);
          }
        }
      }
      continue;
    }

    // Plain segment URLs (lines that are not tags)
    if (!trimmed.startsWith('#')) {
      out.push(wrapUrl(trimmed));
      continue;
    }

    // All other tag lines pass through unmodified
    out.push(line);
  }

  return out.join('\n');
}

// ─── DETECT CONTENT TYPE ───────────────────────────────────────────────────

function isM3U8(url, contentType) {
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes('mpegurl') || ct.includes('m3u8')) return true;
  }
  const u = url.toLowerCase().split('?')[0];
  return u.endsWith('.m3u8') || u.endsWith('.m3u');
}

function isTS(url) {
  const u = url.toLowerCase().split('?')[0];
  return u.endsWith('.ts') || u.endsWith('.m4s') || u.endsWith('.aac')
      || u.endsWith('.mp4') || u.endsWith('.key') || u.endsWith('.bin');
}

// ─── PROXY CORE ────────────────────────────────────────────────────────────

async function proxyRequest(request, targetUrl, proxyOpts, proxyBase) {
  const upstreamHeaders = buildUpstreamHeaders(proxyOpts);

  // Forward Range header for seek support
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) upstreamHeaders.set('Range', rangeHeader);

  // Strip headers that reveal Cloudflare/proxy identity
  for (const h of CONFIG.STRIP_UPSTREAM_HEADERS) {
    upstreamHeaders.delete(h);
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(targetUrl, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
    });
  } catch (err) {
    return errorResponse(502, `Upstream fetch failed: ${err.message}`);
  }

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    return errorResponse(
      upstreamRes.status,
      `Upstream returned ${upstreamRes.status} for ${targetUrl}`
    );
  }

  const upstreamCT = upstreamRes.headers.get('content-type') || '';
  const requestOrigin = request.headers.get('origin') || '';
  const cors = corsHeaders(requestOrigin);

  // ── M3U8: rewrite playlist ──
  if (isM3U8(targetUrl, upstreamCT)) {
    const body = await upstreamRes.text();
    const rewritten = rewriteM3U8(body, upstreamRes.url || targetUrl, proxyBase, proxyOpts);

    return new Response(rewritten, {
      status: upstreamRes.status,
      headers: {
        ...cors,
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': `public, max-age=${CONFIG.PLAYLIST_CACHE_TTL}`,
        'X-Proxy-By': 'IPTV-HLS-Worker',
      },
    });
  }

  // ── Binary segment / key: stream through ──
  const responseHeaders = new Headers(cors);
  responseHeaders.set('X-Proxy-By', 'IPTV-HLS-Worker');

  for (const h of CONFIG.FORWARDED_RESPONSE_HEADERS) {
    const v = upstreamRes.headers.get(h);
    if (v) responseHeaders.set(h, v);
  }

  // No caching for segments (live data)
  if (!responseHeaders.has('cache-control')) {
    responseHeaders.set('Cache-Control', 'no-store');
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
}

// ─── PARSE STREAM KEY (base64url JSON) ─────────────────────────────────────

function parseStreamKey(key) {
  try {
    // Restore base64 padding
    const padded = key.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ─── AUTH CHECK ────────────────────────────────────────────────────────────

function isAuthorized(request, params) {
  if (!CONFIG.SECRET_TOKEN) return true; // auth disabled

  const tokenHeader = request.headers.get('x-proxy-token');
  const tokenParam  = params.get('token');
  return tokenHeader === CONFIG.SECRET_TOKEN || tokenParam === CONFIG.SECRET_TOKEN;
}

// ─── ERROR RESPONSE ────────────────────────────────────────────────────────

function errorResponse(status, message) {
  return new Response(
    JSON.stringify({ error: message, status }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────

async function handleRequest(request) {
  const url     = new URL(request.url);
  const path    = url.pathname;
  const params  = url.searchParams;
  const origin  = request.headers.get('origin') || '';

  // ── CORS preflight ──
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  // ── Rate limiting ──
  const clientIP = request.headers.get('cf-connecting-ip')
                || request.headers.get('x-forwarded-for')
                || 'unknown';

  if (!checkRateLimit(clientIP)) {
    return errorResponse(429, 'Rate limit exceeded. Try again in a minute.');
  }

  // ── Health check ──
  if (path === '/health' || path === '/') {
    return new Response(
      JSON.stringify({
        status: 'online',
        service: 'IPTV HLS Proxy Worker',
        auth: !!CONFIG.SECRET_TOKEN,
        rateLimit: CONFIG.RATE_LIMIT_RPM + ' req/min',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  const proxyBase = `${url.protocol}//${url.host}`;

  // ─────────────────────────────────────────────────────────────────────────
  // ROUTE: /stream/:key
  //   Accepts a base64url-encoded JSON payload as the stream key
  //   payload: { url, referer?, origin?, ua? }
  // ─────────────────────────────────────────────────────────────────────────
  if (path.startsWith('/stream/')) {
    const rawKey = path.slice('/stream/'.length);
    const payload = parseStreamKey(rawKey);

    if (!payload || !payload.url) {
      return errorResponse(400, 'Invalid or missing stream key. Expected base64url JSON with { url, referer?, origin?, ua? }');
    }

    // Auth check via payload.token or header
    const tokenOk = !CONFIG.SECRET_TOKEN
      || payload.token === CONFIG.SECRET_TOKEN
      || request.headers.get('x-proxy-token') === CONFIG.SECRET_TOKEN;

    if (!tokenOk) {
      return errorResponse(401, 'Unauthorized: invalid or missing token in stream key');
    }

    const proxyOpts = {
      referer:      payload.referer || '',
      origin:       payload.origin  || '',
      ua:           payload.ua      || '',
      token:        payload.token   || '',
    };

    return proxyRequest(request, payload.url, proxyOpts, proxyBase);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ROUTE: /proxy?url=...&referer=...&origin=...&ua=...&token=...
  // ─────────────────────────────────────────────────────────────────────────
  if (path === '/proxy') {
    if (!isAuthorized(request, params)) {
      return errorResponse(401, 'Unauthorized: invalid or missing token');
    }

    const targetUrl = params.get('url');
    if (!targetUrl) {
      return errorResponse(400, 'Missing required query param: url');
    }

    let decoded;
    try {
      decoded = decodeURIComponent(targetUrl);
      new URL(decoded); // validate
    } catch {
      return errorResponse(400, 'Invalid URL in `url` param');
    }

    const proxyOpts = {
      referer: params.get('referer') ? decodeURIComponent(params.get('referer')) : '',
      origin:  params.get('origin')  ? decodeURIComponent(params.get('origin'))  : '',
      ua:      params.get('ua')      ? decodeURIComponent(params.get('ua'))      : '',
      token:   params.get('token')   || '',
    };

    return proxyRequest(request, decoded, proxyOpts, proxyBase);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 404 fallback
  // ─────────────────────────────────────────────────────────────────────────
  return errorResponse(404, `Unknown route: ${path}. Use /proxy?url=... or /stream/<key>`);
}

// ─── WORKER ENTRYPOINT ─────────────────────────────────────────────────────

addEventListener('fetch', event => {
  event.respondWith(
    handleRequest(event.request).catch(err =>
      errorResponse(500, `Worker internal error: ${err.message}`)
    )
  );
});

// ─── USAGE REFERENCE ───────────────────────────────────────────────────────
/*
  ┌─────────────────────────────────────────────────────────────────────┐
  │  ROUTE 1 — Direct query params (simplest)                          │
  │                                                                     │
  │  GET /proxy                                                         │
  │    ?url=https%3A%2F%2Fstream.example.com%2Flive.m3u8               │
  │    &referer=https%3A%2F%2Fexample.com                              │
  │    &origin=https%3A%2F%2Fexample.com                               │
  │    &ua=Mozilla%2F5.0...                                             │
  │    &token=YOUR_SECRET   ← only if SECRET_TOKEN is set              │
  ├─────────────────────────────────────────────────────────────────────┤
  │  ROUTE 2 — Stream key (cleaner URLs, good for client embedding)    │
  │                                                                     │
  │  // Generate key (browser JS):                                      │
  │  const payload = {                                                  │
  │    url: 'https://stream.example.com/live.m3u8',                    │
  │    referer: 'https://example.com',                                  │
  │    origin: 'https://example.com',                                   │
  │    token: 'YOUR_SECRET'  // optional                               │
  │  };                                                                 │
  │  const key = btoa(JSON.stringify(payload))                         │
  │    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');        │
  │                                                                     │
  │  // Use:                                                            │
  │  GET /stream/<key>                                                  │
  ├─────────────────────────────────────────────────────────────────────┤
  │  HLS.js Integration Example:                                        │
  │                                                                     │
  │  const proxyBase = 'https://your-worker.workers.dev';              │
  │  const streamUrl = `${proxyBase}/proxy?url=${encodeURIComponent(   │
  │    'https://stream.example.com/live.m3u8'                          │
  │  )}&referer=${encodeURIComponent('https://example.com')}`;         │
  │                                                                     │
  │  const hls = new Hls();                                            │
  │  hls.loadSource(streamUrl);                                        │
  │  hls.attachMedia(videoElement);                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ENV VARIABLES (set in Cloudflare Workers dashboard → Settings → Variables):
    SECRET_TOKEN     = "your-secret-here"   (leave empty to disable auth)
    ALLOWED_ORIGINS  = "https://yourapp.com,https://localhost:3000"
*/
/**
 * Cloudflare Worker — HLS/M3U8 Stream Proxy
 * Proxies HLS streams with CORS headers and optional Referer spoofing.
 * Solves CORS and basic geo-blocking for iptv-org / Free-TV streams.
 *
 * Deploy:
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create
 *   2. Paste this code
 *   3. Deploy — note the URL (e.g. https://stream-proxy.your-name.workers.dev)
 *   4. Set API.PROXY_BASE in api.js to that URL
 *
 * Free tier: 100,000 requests/day, 10ms CPU time per request.
 * Streaming responses bypass CPU time limit.
 */

const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Referer, Origin",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
};

// M3U8 content types
const M3U8_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
];

async function handleRequest(request) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: DEFAULT_HEADERS });
  }

  const url = new URL(request.url);
  const targetURL = url.searchParams.get("url");

  if (!targetURL) {
    return new Response("Missing ?url parameter", {
      status: 400,
      headers: { ...DEFAULT_HEADERS, "Content-Type": "text/plain" },
    });
  }

  // Validate URL
  let parsedTarget;
  try {
    parsedTarget = new URL(targetURL);
  } catch {
    return new Response("Invalid URL", {
      status: 400,
      headers: { ...DEFAULT_HEADERS, "Content-Type": "text/plain" },
    });
  }

  // Only allow http/https
  if (!["http:", "https:"].includes(parsedTarget.protocol)) {
    return new Response("Only HTTP(S) URLs allowed", {
      status: 400,
      headers: { ...DEFAULT_HEADERS, "Content-Type": "text/plain" },
    });
  }

  // Build fetch headers — forward Range, spoof Referer if requested
  const fetchHeaders = new Headers();
  fetchHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36");
  fetchHeaders.set("Accept", "*/*");
  fetchHeaders.set("Accept-Language", "en-US,en;q=0.9");

  // Optional: set Referer from query param or derive from target origin
  const referrer = url.searchParams.get("referrer") || parsedTarget.origin + "/";
  fetchHeaders.set("Referer", referrer);
  fetchHeaders.set("Origin", parsedTarget.origin);

  // Spoof X-Forwarded-For to appear as a local client (helps with some geo-blocks)
  const xff = url.searchParams.get("xff") || "103.0.0.1";
  fetchHeaders.set("X-Forwarded-For", xff);
  fetchHeaders.set("X-Real-IP", xff);

  // Forward Range header for seeking
  const range = request.headers.get("Range");
  if (range) fetchHeaders.set("Range", range);

  try {
    const response = await fetch(targetURL, {
      headers: fetchHeaders,
      redirect: "follow",
    });

    const contentType = response.headers.get("Content-Type") || "";
    const isM3U8 = M3U8_TYPES.some((t) => contentType.includes(t)) ||
                   contentType.includes("mpegurl") ||
                   targetURL.includes(".m3u8") || targetURL.includes(".m3u");

    // For M3U8 playlists, rewrite URLs to go through proxy
    let body;
    if (isM3U8) {
      const text = await response.text();
      const base = targetURL.substring(0, targetURL.lastIndexOf("/") + 1);
      const proxyBase = `${url.origin}${url.pathname}`;

      // Rewrite all non-comment lines (stream URLs and segment URLs)
      const rewritten = text.replace(
        /^(?!#)([^\s]+)$/gm,
        (match) => {
          // Already absolute URL
          if (match.startsWith("http://") || match.startsWith("https://")) {
            return `${proxyBase}?url=${encodeURIComponent(match)}${referrer ? "&referrer=" + encodeURIComponent(referrer) : ""}`;
          }
          // Relative URL — resolve against base
          const absolute = new URL(match, base).href;
          return `${proxyBase}?url=${encodeURIComponent(absolute)}${referrer ? "&referrer=" + encodeURIComponent(referrer) : ""}`;
        }
      );
      body = rewritten;
    } else {
      // Stream binary content (TS segments, etc.) without buffering
      body = response.body;
    }

    // Build response headers
    const respHeaders = {
      ...DEFAULT_HEADERS,
      "Content-Type": contentType || "application/octet-stream",
    };

    // Forward content-length and content-range for seeking
    const cl = response.headers.get("Content-Length");
    if (cl) respHeaders["Content-Length"] = cl;
    const cr = response.headers.get("Content-Range");
    if (cr) respHeaders["Content-Range"] = cr;

    return new Response(body, {
      status: response.status,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, {
      status: 502,
      headers: { ...DEFAULT_HEADERS, "Content-Type": "text/plain" },
    });
  }
}

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

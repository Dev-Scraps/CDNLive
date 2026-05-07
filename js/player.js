/**
 * player.js — Opens the full-page player in a new page
 * Supports CDN Live TV iframe embeds AND direct M3U8/HLS streams
 */

const Player = {
  /**
   * Open a CDN Live TV channel in the full-page player
   * @param {string} name - Channel display name
   * @param {string} code - Channel country code
   */
  open(name, code) {
    const url = `player.html?name=${encodeURIComponent(name)}&code=${encodeURIComponent(code)}`;
    window.location.href = url;
  },

  /**
   * Open a direct M3U8/HLS stream in the player
   * @param {string} name - Channel display name
   * @param {string} streamUrl - Direct M3U8/HLS stream URL
   * @param {object} opts - Optional: { source, quality, referrer, code }
   */
  openStream(name, streamUrl, opts = {}) {
    const params = new URLSearchParams({
      name: name,
      url: streamUrl,
      source: opts.source || "iptv",
    });
    if (opts.code) params.set("code", opts.code);
    if (opts.quality) params.set("quality", opts.quality);
    if (opts.referrer) params.set("referrer", opts.referrer);
    window.location.href = `player.html?${params.toString()}`;
  },

  /**
   * Open in a new tab instead (optional, for middle-click or ctrl+click)
   */
  openNewTab(name, code) {
    const url = `player.html?name=${encodeURIComponent(name)}&code=${encodeURIComponent(code)}`;
    window.open(url, "_blank");
  },

  /**
   * Open a direct stream in a new tab
   */
  openStreamNewTab(name, streamUrl, opts = {}) {
    const params = new URLSearchParams({
      name: name,
      url: streamUrl,
      source: opts.source || "iptv",
    });
    if (opts.code) params.set("code", opts.code);
    if (opts.quality) params.set("quality", opts.quality);
    if (opts.referrer) params.set("referrer", opts.referrer);
    window.open(`player.html?${params.toString()}`, "_blank");
  },

  /** No-op init since there's no modal to set up */
  init() {},
};

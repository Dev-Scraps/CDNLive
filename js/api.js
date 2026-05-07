/**
 * api.js — All API logic for CDN Live TV
 * Sources: CDN Live TV, iptv-org, Free-TV
 * Cache-first with localStorage + TTL
 * NO PROXY — direct API calls
 */

const API = {
  // ─── Config ───
  CDN_BASE: "https://api.cdnlivetv.tv/api/v1",
  CDN_PARAMS: "?user=cdnlivetv&plan=free",
  CDN_PLAYER_BASE: "https://cdnlivetv.tv/api/v1/channels/player/",

  IPTV_BASE: "https://iptv-org.github.io/api",
  FREETV_URL: "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",

  CACHE_KEY: "cdnlive_cache_v3",
  IPTV_CACHE_KEY: "iptvorg_cache_v2",
  FREETV_CACHE_KEY: "freetv_cache_v2",
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes

  // ─── URL Builders ───
  allSportsURL() { return `${this.CDN_BASE}/events/sports/${this.CDN_PARAMS}`; },
  channelsURL()  { return `${this.CDN_BASE}/channels/${this.CDN_PARAMS}`; },
  playerURL(name, code) {
    const n = encodeURIComponent(name.toLowerCase().replace(/\s+/g, "+"));
    return `${this.CDN_PLAYER_BASE}?name=${n}&code=${code}&user=cdnlivetv&plan=free`;
  },

  // ─── CDN Fetch ───
  async fetchAllSports() {
    try {
      const res = await fetch(this.allSportsURL());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const cdn = data["cdn-live-tv"];
      if (!cdn) return { sports: {}, totalEvents: 0 };
      const sports = {};
      let totalEvents = 0;
      for (const [sport, events] of Object.entries(cdn)) {
        if (Array.isArray(events)) {
          sports[sport] = events;
          totalEvents += events.length;
        }
      }
      return { sports, totalEvents };
    } catch (err) {
      console.error("[API] fetchAllSports failed:", err);
      return { sports: {}, totalEvents: 0 };
    }
  },

  async fetchAllChannels() {
    try {
      const res = await fetch(this.channelsURL());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.channels || [];
    } catch (err) {
      console.error("[API] fetchAllChannels failed:", err);
      return [];
    }
  },

  // ─── Fetch All (CDN) ───
  async fetchAll() {
    const [sportsResult, channels] = await Promise.all([
      this.fetchAllSports(),
      this.fetchAllChannels(),
    ]);

    const result = {
      sports: sportsResult.sports,
      totalEvents: sportsResult.totalEvents,
      channels,
      _fromCache: false,
    };

    this._saveCache(this.CACHE_KEY, result);
    return result;
  },

  // ─── iptv-org ───
  async loadIptvOrgWithCache() {
    const cached = this._loadCache(this.IPTV_CACHE_KEY);
    if (cached && cached.iptvChannels && cached.iptvChannels.length > 0) return cached.iptvChannels;

    try {
      const [chRes, stRes, coRes] = await Promise.all([
        fetch(`${this.IPTV_BASE}/channels.json`),
        fetch(`${this.IPTV_BASE}/streams.json`),
        fetch(`${this.IPTV_BASE}/countries.json`),
      ]);

      const channels = await chRes.json();
      const streams  = await stRes.json();
      const countries = await coRes.json();

      // Build stream lookup: channel id → [streams]
      // API uses "channel" field (was "channel_id" in older versions)
      const streamMap = {};
      for (const s of streams) {
        const chId = s.channel || s.channel_id;
        if (!chId) continue;
        if (!streamMap[chId]) streamMap[chId] = [];
        streamMap[chId].push(s);
      }

      // Build country name lookup
      const countryNames = {};
      for (const c of countries) {
        countryNames[c.code] = c.name;
      }

      // Merge channels with their streams
      const merged = channels.map((ch) => {
        const chStreams = streamMap[ch.id] || [];
        const primaryStream = chStreams[0];
        // quality is now a string like "720p" (was resolution.height before)
        const qualityStr = primaryStream
          ? (primaryStream.quality || (primaryStream.resolution ? `${primaryStream.resolution.height}p` : ""))
          : "";
        const labelStr = primaryStream
          ? (primaryStream.label || (primaryStream.status === "online" ? "LIVE" : ""))
          : "";
        return {
          name: ch.name,
          url: primaryStream ? primaryStream.url : null,
          logo: ch.logo || "",
          country: ch.country || "",
          countryName: countryNames[ch.country] || ch.country || "",
          categories: ch.categories || [],
          network: ch.network || "",
          quality: qualityStr,
          label: labelStr,
          referrer: primaryStream ? (primaryStream.referrer || "") : "",
          _source: "iptv",
        };
      }).filter((ch) => ch.url);

      this._saveCache(this.IPTV_CACHE_KEY, { iptvChannels: merged });
      return merged;
    } catch (err) {
      console.error("[API] loadIptvOrg failed:", err);
      return [];
    }
  },

  // ─── Free-TV ───
  async loadFreeTVWithCache() {
    const cached = this._loadCache(this.FREETV_CACHE_KEY);
    if (cached && cached.freetvChannels && cached.freetvChannels.length > 0) return cached.freetvChannels;

    try {
      const res = await fetch(this.FREETV_URL);
      const text = await res.text();
      const channels = this._parseM3U(text);
      this._saveCache(this.FREETV_CACHE_KEY, { freetvChannels: channels });
      return channels;
    } catch (err) {
      console.error("[API] loadFreeTV failed:", err);
      return [];
    }
  },

  _parseM3U(text) {
    const lines = text.split("\n");
    const channels = [];
    let current = null;

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("#EXTINF:")) {
        current = { name: "", url: "", logo: "", country: "", countryName: "", categories: [], network: "", quality: "", label: "", _source: "freetv" };
        // Parse tvg-name, tvg-logo, group-title
        const nameMatch = line.match(/tvg-name="([^"]*)"/);
        const logoMatch = line.match(/tvg-logo="([^"]*)"/);
        const groupMatch = line.match(/group-title="([^"]*)"/);
        const countryMatch = line.match(/tvg-country="([^"]*)"/);
        // Display name is after the last comma
        const commaIdx = line.lastIndexOf(",");
        current.name = commaIdx >= 0 ? line.substring(commaIdx + 1).trim() : (nameMatch ? nameMatch[1] : "Unknown");
        if (logoMatch) current.logo = logoMatch[1];
        if (groupMatch) current.categories = groupMatch[1].split(";").map((s) => s.trim()).filter(Boolean);
        if (countryMatch) {
          current.country = countryMatch[1];
          current.countryName = countryMatch[1];
        }
      } else if (line && !line.startsWith("#") && current) {
        current.url = line;
        channels.push(current);
        current = null;
      }
    }
    return channels;
  },

  // ─── Cache Helpers ───
  _saveCache(key, data) {
    try {
      const entry = { ...data, _timestamp: Date.now() };
      localStorage.setItem(key, JSON.stringify(entry));
    } catch (e) {
      // localStorage full or unavailable
    }
  },

  _loadCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const age = Date.now() - (data._timestamp || 0);
      data._cacheAge = Math.round(age / 1000);
      data._fromCache = true;
      // Return even if expired — caller decides whether to refresh
      return data;
    } catch (e) {
      return null;
    }
  },
};

/**
 * app.js — Application entry point
 * Multi-source: CDN Live TV + iptv-org
 * Cache-first: renders from localStorage instantly, refreshes in background.
 * Supports page modes: home, cricket, live, channels
 */

const App = {
  _refreshInterval: null,
  _countdownInterval: null,
  REFRESH_MS: 60000,
  _page: "home",
  _nextRefresh: 0,
  _iptvLoaded: false,
  _freetvLoaded: false,
  _samsungLoaded: false,

  async init() {
    Toast.init();
    UI.init();
    Player.init();

    this._page = document.body.dataset.page || "home";

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if ((e.key === "/" || (e.ctrlKey && e.key === "k")) && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
      }
      if (e.key === "r" && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== "INPUT") {
        this.refresh();
      }
      if (e.key === "c" && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== "INPUT") {
        Utils.copyURL();
      }
      if (e.key === "s" && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== "INPUT") {
        Utils.share();
      }
      if (e.key === "t" && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== "INPUT") {
        Utils.scrollToTop();
      }
    });

    // 1) Load CDN Live TV from cache instantly
    const cached = API._loadCache();
    if (cached) {
      const { sports, totalEvents, channels, _fromCache, _cacheAge } = cached;
      UI.setData(sports, totalEvents, channels, this._page);
      const sportCount = Object.keys(sports).length;
      const liveCount = Object.values(sports).flat().filter((e) => e.status === "live").length;
      const ageStr = _cacheAge < 60 ? `${_cacheAge}s ago` : `${Math.round(_cacheAge / 60)}m ago`;
      this._setStatus(
        `${sportCount} sports · ${totalEvents} events · ${channels.length} channels${liveCount > 0 ? ` · ${liveCount} live` : ""} · cached ${ageStr}`,
        true
      );
      this._setLastUpdate();
    }

    // 2) Load iptv-org from cache instantly
    const iptvCached = API._loadCache(API.IPTV_CACHE_KEY);
    if (iptvCached && iptvCached.iptvChannels) {
      UI.setIptvData(iptvCached.iptvChannels);
      this._iptvLoaded = true;
    }

    // 2b) Load Free-TV from cache instantly
    const freetvCached = API._loadCache(API.FREETV_CACHE_KEY);
    if (freetvCached && freetvCached.freetvChannels) {
      UI.setFreetvData(freetvCached.freetvChannels);
      this._freetvLoaded = true;
    }

    // 2c) Load Samsung TV Plus from cache instantly
    const samsungCached = API._loadCache(`${API.SAMSUNG_CACHE_KEY}_all`);
    if (samsungCached && samsungCached.samsungChannels) {
      UI.setSamsungData(samsungCached.samsungChannels);
      this._samsungLoaded = true;
    } else {
      // No cache: set loading state and load immediately
      UI.setSamsungLoading(true);
      this._loadSamsung();
    }

    // 3) Refresh CDN Live TV in background (always)
    await this.refresh();

    // 4) Load iptv-org in background (if not cached)
    this._loadIptvOrg();

    // 5) Load Free-TV in background (if not cached)
    this._loadFreeTV();

    // 6) Auto-refresh cycle
    this._startCountdown();
    this._refreshInterval = setInterval(() => this.refresh(), this.REFRESH_MS);
  },

  async refresh() {
    this._setRefreshSpin(true);

    try {
      const { sports, totalEvents, channels, _fromCache } = await API.fetchAll();
      UI.setData(sports, totalEvents, channels, this._page);

      const sportCount = Object.keys(sports).length;
      const liveCount = Object.values(sports).flat().filter((e) => e.status === "live").length;
      this._setStatus(
        `${sportCount} sports · ${totalEvents} events · ${channels.length} channels${liveCount > 0 ? ` · ${liveCount} live` : ""}`,
        true
      );
    } catch (err) {
      this._setStatus("Failed to load — click refresh", false);
      console.error("[App] Refresh failed:", err);
    }

    this._setLastUpdate();
    this._setRefreshSpin(false);
    this._nextRefresh = Date.now() + this.REFRESH_MS;
  },

  async _loadIptvOrg() {
    try {
      UI.setIptvLoading(true);
      const iptvChannels = await API.loadIptvOrgWithCache();
      UI.setIptvData(iptvChannels);
      this._iptvLoaded = true;
      const el = document.getElementById("iptv-status");
      if (el) el.textContent = `${iptvChannels.length} streams`;
    } catch (err) {
      console.error("[App] Failed to load iptv-org:", err);
      UI.setIptvLoading(false);
    }
  },

  async _loadFreeTV() {
    try {
      UI.setFreetvLoading(true);
      const freetvChannels = await API.loadFreeTVWithCache();
      UI.setFreetvData(freetvChannels);
      this._freetvLoaded = true;
    } catch (err) {
      console.error("[App] Failed to load Free-TV:", err);
      UI.setFreetvLoading(false);
    }
  },

  async _loadSamsung() {
    try {
      UI.setSamsungLoading(true);
      const samsungChannels = await API.loadSamsungWithCache('all');
      UI.setSamsungData(samsungChannels);
      this._samsungLoaded = true;
    } catch (err) {
      console.error("[App] Failed to load Samsung TV Plus:", err);
      UI.setSamsungLoading(false);
    }
  },

  _startCountdown() {
    this._nextRefresh = Date.now() + this.REFRESH_MS;
    if (this._countdownInterval) clearInterval(this._countdownInterval);
    this._countdownInterval = setInterval(() => {
      const remaining = Math.max(0, Math.round((this._nextRefresh - Date.now()) / 1000));
      const el = document.getElementById("refresh-countdown");
      if (el) el.textContent = `${remaining}s`;
    }, 1000);
  },

  _setStatus(text, online) {
    const dot = document.getElementById("status-dot");
    const txt = document.getElementById("status-text");
    if (dot) dot.classList.toggle("online", online);
    if (txt) txt.textContent = text;
  },

  _setLastUpdate() {
    const el = document.getElementById("last-update");
    if (el) el.textContent = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  },

  _setRefreshSpin(spinning) {
    const icon = document.getElementById("refresh-icon");
    if (icon) icon.style.animation = spinning ? "spin 0.6s linear infinite" : "none";
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());

/**
 * ui.js — Rendering & UI interaction logic
 * Supports all sports, all channels, search, filter, sort, favorites
 */

const UI = {
  _els: {},
  _allSports: {},
  _allChannels: [],
  _iptvChannels: [],
  _freetvChannels: [],
  _activeSport: "all",
  _channelCategory: "all",
  _sort: "name",
  _favorites: new Set(),
  _showFavoritesOnly: false,
  _searchQuery: "",
  _activeSource: "cdn", // "cdn", "iptv", or "freetv"
  _countryFilter: "all", // separate from category
  _iptvLoading: false,
  _freetvLoading: false,
  _iptvRenderLimit: 200, // Render max 200 iptv channels at a time
  _useStreamProxy: false,

  /** Sport emoji map */
  _sportIcons: {
    Cricket: "",
    Soccer: "",
    NFL: "",
    NBA: "",
    NHL: "",
    MLB: "",
    Tennis: "",
    "MMA/UFC": "",
    Motorsport: "",
    Golf: "",
    Boxing: "",
    Rugby: "",
    Basketball: "",
    Football: "",
    Hockey: "",
    Baseball: "",
    "WWE/Wrestling": "",
    "American Football": "",
    "Ice Hockey": "",
    default: "",
    Swimming: "",
    Athletics: "",
    Badminton: "",
    "Table Tennis": "",
    Snooker: "",
    Darts: "",
    Wrestling: "",
    Esports: "",
  },

  _playIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,

  init() {
    this._els = {
      sportsNav: document.getElementById("sports-nav"),
      eventsContainer: document.getElementById("events-container"),
      channelsContainer: document.getElementById("channels-container"),
      eventsCount: document.getElementById("events-count"),
      channelsCount: document.getElementById("channels-count"),
      statLive: document.getElementById("stat-live"),
      statSports: document.getElementById("stat-sports"),
      statChannels: document.getElementById("stat-channels"),
      statViewers: document.getElementById("stat-viewers"),
      searchInput: document.getElementById("search-input"),
      channelCatNav: document.getElementById("channel-categories"),
    };

    // Load favorites
    try {
      const saved = JSON.parse(localStorage.getItem("cdnlive_favorites") || "[]");
      this._favorites = new Set(saved);
    } catch (e) {}

    // Stream proxy toggle (iptv/freetv only)
    this._useStreamProxy = localStorage.getItem("cdnlive_use_stream_proxy") === "1";
    this._syncProxyToggleUI();

    // Search
    this._els.searchInput?.addEventListener("input", (e) => {
      this._searchQuery = e.target.value.toLowerCase();
      this._renderChannels();
    });
  },

  // ─── Set Data ───
  setData(sports, totalEvents, channels, page) {
    this._allSports = sports;
    this._allChannels = channels;
    this._page = page || "home";

    if (this._page === "home") {
      this._renderSportsNav();
      this._renderEvents();
      this._renderChannelCategories();
      this._renderChannels();
    } else if (this._page === "cricket") {
      this._activeSport = "Cricket";
      this._channelCategory = "cricket";
      this._renderEvents();
      this._renderChannelCategories();
      this._renderChannels();
    } else if (this._page === "live") {
      this._renderEvents();
    } else if (this._page === "upcoming") {
      this._renderEvents();
    } else if (this._page === "channels") {
      this._renderChannelCategories();
      this._renderChannels();
    }

    this._updateStats(sports, totalEvents, channels);
    this._updateCountryFilter();

    // In case the button exists only on some pages
    this._syncProxyToggleUI();
  },

  toggleStreamProxy() {
    this._useStreamProxy = !this._useStreamProxy;
    localStorage.setItem("cdnlive_use_stream_proxy", this._useStreamProxy ? "1" : "0");
    this._syncProxyToggleUI();
    this._renderChannels();
  },

  _syncProxyToggleUI() {
    const btn = document.getElementById("proxy-toggle-btn");
    if (!btn) return;
    btn.classList.toggle("active", !!this._useStreamProxy);
    btn.setAttribute("aria-pressed", this._useStreamProxy ? "true" : "false");
    btn.title = this._useStreamProxy ? "Proxy ON (streams via Worker)" : "Proxy OFF (direct streams)";
  },

  // ─── Set iptv-org Data ───
  setIptvData(channels) {
    this._iptvChannels = channels;
    this._iptvLoading = false;
    this._renderSourceTabs();
    // If currently viewing iptv source, re-render
    if (this._activeSource === "iptv") {
      this._renderChannelCategories();
      this._renderChannels();
    }
  },

  setIptvLoading(loading) {
    this._iptvLoading = loading;
    this._renderSourceTabs();
  },

  // ─── Source Tabs ───
  _renderSourceTabs() {
    const container = document.getElementById("source-tabs");
    if (!container) return;
    const cdnCount = this._allChannels.length;
    const iptvCount = this._iptvChannels.length;
    const freetvCount = this._freetvChannels.length;
    const iptvLabel = this._iptvLoading
      ? `iptv-org <span class="cat-count" style="color:var(--amber)">loading…</span>`
      : `iptv-org <span class="cat-count">${iptvCount}</span>`;
    const freetvLabel = this._freetvLoading
      ? `Free-TV <span class="cat-count" style="color:var(--amber)">loading…</span>`
      : `Free-TV <span class="cat-count">${freetvCount}</span>`;
    container.innerHTML = `
      <button class="source-tab ${this._activeSource === 'cdn' ? 'active' : ''}" data-source="cdn" onclick="UI.switchSource('cdn')">
        CDN Live TV <span class="cat-count">${cdnCount}</span>
      </button>
      <button class="source-tab ${this._activeSource === 'iptv' ? 'active' : ''}" data-source="iptv" onclick="UI.switchSource('iptv')">
        ${iptvLabel}
      </button>
      <button class="source-tab ${this._activeSource === 'freetv' ? 'active' : ''}" data-source="freetv" onclick="UI.switchSource('freetv')">
        ${freetvLabel}
      </button>`;
  },

  // ─── Set Free-TV Data ───
  setFreetvData(channels) {
    this._freetvChannels = channels;
    this._freetvLoading = false;
    this._renderSourceTabs();
    if (this._activeSource === "freetv") {
      this._renderChannelCategories();
      this._updateCountryFilter();
      this._renderChannels();
    }
  },

  setFreetvLoading(loading) {
    this._freetvLoading = loading;
    this._renderSourceTabs();
  },

  switchSource(source) {
    if (source === "iptv" && this._iptvLoading) {
      Toast.show("iptv-org channels still loading…");
      return;
    }
    if (source === "freetv" && this._freetvLoading) {
      Toast.show("Free-TV channels still loading…");
      return;
    }
    this._activeSource = source;
    this._channelCategory = "all";
    this._countryFilter = "all";
    this._iptvRenderLimit = 200;
    document.querySelectorAll(".source-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.source === source);
    });
    this._renderChannelCategories();
    this._updateCountryFilter();
    this._renderChannels();
  },

  // ─── Country Filter ───
  filterByCountry(country) {
    this._countryFilter = country;
    this._renderChannels();
  },

  _updateCountryFilter() {
    const select = document.getElementById("country-filter");
    if (!select) return;

    const isIptv = this._activeSource === "iptv";
    const isFreetv = this._activeSource === "freetv";
    const channels = isFreetv ? this._freetvChannels : (isIptv ? this._iptvChannels : this._allChannels);

    // Count channels per country
    const countryCounts = new Map();
    channels.forEach((ch) => {
      const code = isFreetv ? (ch.country || "") : (isIptv ? (ch.country || "") : ((ch.code || "").toUpperCase()));
      const name = isFreetv ? (ch.countryName || ch.country || "") : (isIptv ? (ch.countryName || ch.country || "") : code);
      if (!code) return;
      const key = code.toUpperCase();
      if (!countryCounts.has(key)) countryCounts.set(key, { code: key, name: name, count: 0 });
      countryCounts.get(key).count++;
    });

    // Sort by count descending
    const sorted = [...countryCounts.values()].sort((a, b) => b.count - a.count);

    // Build options
    const currentVal = select.value;
    select.innerHTML = `<option value="all">All Countries (${channels.length})</option>`;
    sorted.forEach((c) => {
      const flag = this._countryFlags[c.code] || "";
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = `${flag} ${c.name} (${c.count})`;
      select.appendChild(opt);
    });

    // Restore selection if still valid
    if (currentVal && sorted.some((c) => c.code === currentVal)) {
      select.value = currentVal;
    }
  },

  // ─── Stats ───
  _updateStats(sports, totalEvents, channels) {
    const sportNames = Object.keys(sports);
    const allEvents = Object.values(sports).flat();
    const liveCount = allEvents.filter((e) => e.status === "live").length;
    const totalViewers = channels.reduce((s, c) => s + (c.viewers || 0), 0);
    const onlineCount = channels.filter((c) => c.status === "online").length;

    if (this._page === "cricket") {
      const cricketEvents = (sports.Cricket || []).length;
      const cricketLive = (sports.Cricket || []).filter((e) => e.status === "live").length;
      const cricketChannels = channels.filter((ch) => this._classifyChannel(ch).includes("cricket")).length;
      this._animateNumber(this._els.statLive, cricketLive);
      this._animateNumber(this._els.statSports, cricketEvents);
      this._animateNumber(this._els.statChannels, cricketChannels);
      this._animateNumber(this._els.statViewers, totalViewers);
    } else if (this._page === "channels") {
      this._animateNumber(this._els.statChannels, channels.length);
      this._animateNumber(this._els.statLive, onlineCount);
      this._animateNumber(this._els.statSports, this._categoryDefs.filter((cat) => {
        return channels.some((ch) => this._classifyChannel(ch).includes(cat.id));
      }).length);
      this._animateNumber(this._els.statViewers, totalViewers);
    } else {
      this._animateNumber(this._els.statLive, liveCount);
      this._animateNumber(this._els.statSports, sportNames.length);
      this._animateNumber(this._els.statChannels, channels.length);
      this._animateNumber(this._els.statViewers, totalViewers);
    }
  },

  _animateNumber(el, target) {
    const start = parseInt(el.textContent.replace(/,/g, "")) || 0;
    if (start === target) return;
    const duration = 400;
    const startTime = performance.now();
    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (target - start) * eased);
      el.textContent = current.toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  // ─── Sports Navigation ───
  _renderSportsNav() {
    const sportNames = Object.keys(this._allSports);
    const allEventsCount = Object.values(this._allSports).flat().length;

    let html = `<button class="sport-tab active" data-sport="all" onclick="UI.filterSport('all')">
      <span class="sport-tab-icon"></span>
      <span class="sport-tab-label">All Sports</span>
      <span class="sport-tab-count">${allEventsCount}</span>
    </button>`;

    sportNames.sort().forEach((sport) => {
      const events = this._allSports[sport];
      const liveCount = events.filter((e) => e.status === "live").length;
      const icon = this._sportIcons[sport] || "🏅";
      html += `<button class="sport-tab" data-sport="${sport}" onclick="UI.filterSport('${sport}')">
        <span class="sport-tab-icon">${icon}</span>
        <span class="sport-tab-label">${sport}</span>
        <span class="sport-tab-count">${events.length}${liveCount > 0 ? ` <span class="sport-live-dot"></span>` : ""}</span>
      </button>`;
    });

    this._els.sportsNav.innerHTML = html;
  },

  filterSport(sport) {
    this._activeSport = sport;
    document.querySelectorAll(".sport-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sport === sport);
    });
    this._renderEvents();
  },

  // ─── Events Rendering ───
  _renderEvents() {
    let events = [];
    if (this._page === "live") {
      // Live page: only live events across all sports
      for (const [sport, evs] of Object.entries(this._allSports)) {
        evs.filter((ev) => ev.status === "live").forEach((ev) => events.push({ ...ev, _sport: sport }));
      }
    } else if (this._page === "upcoming") {
      // Upcoming page: only upcoming events across all sports
      for (const [sport, evs] of Object.entries(this._allSports)) {
        evs.filter((ev) => ev.status === "upcoming").forEach((ev) => events.push({ ...ev, _sport: sport }));
      }
    } else if (this._page === "home") {
      // Home page: only live events (upcoming/finished go on dedicated pages)
      for (const [sport, evs] of Object.entries(this._allSports)) {
        evs.filter((ev) => ev.status === "live").forEach((ev) => events.push({ ...ev, _sport: sport }));
      }
    } else if (this._activeSport === "all") {
      // Flatten all sports, add sport name to each
      for (const [sport, evs] of Object.entries(this._allSports)) {
        evs.forEach((ev) => events.push({ ...ev, _sport: sport }));
      }
    } else {
      events = (this._allSports[this._activeSport] || []).map((ev) => ({
        ...ev,
        _sport: this._activeSport,
      }));
    }

    // Filter out events with no stream providers
    events = events.filter((ev) => ev.channels && ev.channels.length > 0);

    // Sort: live first, then upcoming, then finished
    events.sort((a, b) => {
      const order = { live: 0, upcoming: 1 };
      const aO = order[a.status] ?? 2;
      const bO = order[b.status] ?? 2;
      return aO - bO;
    });

    this._els.eventsCount.textContent = events.length;

    if (events.length === 0) {
      this._els.eventsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"></div>
          <h3>No events right now</h3>
          <p>Check back later for live matches</p>
        </div>`;
      return;
    }

    // On home/cricket pages, show only first 8 events + "View All" link
    const isLimitedPage = this._page === "home" || this._page === "cricket";
    const maxShow = 8;
    const totalEvents = events.length;
    const shown = isLimitedPage ? events.slice(0, maxShow) : events;
    const hasMore = isLimitedPage && totalEvents > maxShow;

    let html = shown.map((ev, i) => this._eventCardHTML(ev, i)).join("");

    if (hasMore) {
      const viewAllHref = this._page === "cricket" ? "cricket.html" : "live.html";
      const viewAllLabel = this._page === "cricket" ? "View All Cricket" : "View All Live";
      html += `
        <a class="view-all-btn" href="${viewAllHref}">
          ${viewAllLabel} <span style="opacity:0.6">${totalEvents} events</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </a>`;
    }

    // On home page, also add "View Upcoming" link
    if (this._page === "home") {
      let upcomingCount = 0;
      for (const evs of Object.values(this._allSports)) {
        upcomingCount += evs.filter((ev) => ev.status === "upcoming" && ev.channels && ev.channels.length > 0).length;
      }
      if (upcomingCount > 0) {
        html += `
          <a class="view-all-btn" href="upcoming.html" style="border-color:var(--green-dim);color:var(--green)">
            View Upcoming <span style="opacity:0.6">${upcomingCount} events</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </a>`;
      }
    }

    this._els.eventsContainer.innerHTML = html;
  },

  _eventCardHTML(ev, index) {
    const isLive = ev.status === "live";
    const isFinished = ev.status === "finished";
    const badgeClass = isLive ? "is-live" : isFinished ? "is-finished" : "is-upcoming";
    const badgeLabel = isLive ? "Live" : isFinished ? "Ended" : "Upcoming";
    const sportIcon = this._sportIcons[ev._sport] || "🏅";
    const totalViewers = (ev.channels || []).reduce((s, c) => s + (c.viewers || 0), 0);

    // Build event title: use `event` field if present, otherwise homeTeam vs awayTeam
    const eventTitle = ev.event
      || ((ev.homeTeam || ev.awayTeam)
          ? `${ev.homeTeam || "TBD"} vs ${ev.awayTeam || "TBD"}`
          : ev._sport + " Event");

    const tournament = ev.tournament || ev.league || ev.competition || "";
    const country = ev.country || "";
    const time = ev.time || "";
    const start = ev.start || "";

    const channelButtons = (ev.channels || []).slice(0, 1).map((ch) => {
      const chName = ch.channel_name || ch.name || "Unknown";
      const chCode = ch.channel_code || ch.code || "";
      return `
      <a class="channel-btn" href="player.html?name=${encodeURIComponent(chName)}&code=${encodeURIComponent(chCode)}&source=cdn">
        <img src="${ch.image || ""}" alt="" loading="lazy" onerror="this.style.display='none'">
        <div class="ch-info">
          <div class="ch-name">${chName}</div>
          <div class="ch-meta">${chCode.toUpperCase()}${ch.viewers > 0 ? " · " + ch.viewers + " watching" : ""}</div>
        </div>
        <div class="ch-play">${this._playIcon}</div>
      </a>`;
    }).join("");

    const moreCount = (ev.channels || []).length - 1;
    const moreBtn = moreCount > 0
      ? `<button class="more-channels-btn" onclick="UI._expandEventChannels('${ev.gameID}', '${ev._sport}')">+${moreCount} more channel${moreCount > 1 ? 's' : ''}</button>`
      : "";

    return `
      <div class="event-card ${isLive ? 'event-live' : ''}" style="animation-delay:${index * 30}ms">
        <div class="event-card-head">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge-live ${badgeClass}"><span class="dot"></span> ${badgeLabel}</span>
            <span class="sport-badge">${sportIcon} ${ev._sport}</span>
          </div>
          <div class="event-card-time">${time}<br><span style="opacity:0.5">${start}</span></div>
        </div>
        <div class="event-card-title">${eventTitle}</div>
        <div class="event-card-meta">
          ${tournament ? `<span>${tournament}</span>` : ""}
          ${country ? `<span class="sep"></span><span>${country}</span>` : ""}
        </div>
        <div class="event-card-channels-header">
          <span>${(ev.channels || []).length} channels</span>
          ${totalViewers > 0 ? `<span>${totalViewers.toLocaleString()} viewers</span>` : ""}
        </div>
        <div class="event-card-channels" id="ev-ch-${ev.gameID}">
          ${channelButtons}
          ${moreBtn}
        </div>
      </div>`;
  },

  _expandEventChannels(gameID, sport) {
    const events = this._allSports[sport] || [];
    const ev = events.find((e) => e.gameID === gameID);
    if (!ev) return;
    const container = document.getElementById(`ev-ch-${gameID}`);
    if (!container) return;
    container.innerHTML = (ev.channels || []).map((ch) => {
      const chName = ch.channel_name || ch.name || "Unknown";
      const chCode = ch.channel_code || ch.code || "";
      return `
      <a class="channel-btn" href="player.html?name=${encodeURIComponent(chName)}&code=${encodeURIComponent(chCode)}&source=cdn">
        <img src="${ch.image || ""}" alt="" loading="lazy" onerror="this.style.display='none'">
        <div class="ch-info">
          <div class="ch-name">${chName}</div>
          <div class="ch-meta">${chCode.toUpperCase()}${ch.viewers > 0 ? " · " + ch.viewers + " watching" : ""}</div>
        </div>
        <div class="ch-play">${this._playIcon}</div>
      </a>`;
    }).join("");
  },

  // ─── Channel Categories ───
  _categoryDefs: [
    { id: "cricket",   icon: "", label: "Cricket",     keywords: ["cricket", "willow", "ipl", "bbl", "psl", "t20", "test match"] },
    { id: "football",  icon: "",  label: "Football",    keywords: ["football", "soccer", "futbol", "fut", "liga", "premier", "serie", "bundes", "ligue", "la liga", "champions", "europa", "fa cup", "mls"] },
    { id: "american",  icon: "",  label: "NFL / NCAA",  keywords: ["nfl", "ncaa", "super bowl", "college football", "touchdown"] },
    { id: "basketball",icon: "",  label: "Basketball",  keywords: ["nba", "basketball", "nbl", "euroleague", "wnba", "ncaa basketball"] },
    { id: "hockey",    icon: "",  label: "Hockey",      keywords: ["hockey", "nhl", "ice hockey", "khl", "shl"] },
    { id: "baseball",  icon: "",  label: "Baseball",    keywords: ["baseball", "mlb", "world series"] },
    { id: "fight",     icon: "",  label: "Fighting",    keywords: ["ufc", "mma", "boxing", "wwe", "wrestling", "fight", "bellator"] },
    { id: "tennis",    icon: "",  label: "Tennis",      keywords: ["tennis", "atp", "wta", "grand slam", "wimbledon", "roland"] },
    { id: "motorsport",icon: "", label: "Motorsport",  keywords: ["f1", "formula", "motorsport", "moto", "nascar", "racing", "gp"] },
    { id: "golf",      icon: "",  label: "Golf",        keywords: ["golf", "pga", "masters", "open championship"] },
    { id: "sports",    icon: "",  label: "More Sports", keywords: ["sports", "espn", "sky sport", "bt sport", "bein", "dazn", "supersport", "tsn", "fox sport", "sony ten", "sony six", "sony esp", "star sport", "ten sport", "diamond", "arena"] },
    { id: "news",      icon: "",  label: "News",        keywords: ["news", "cnn", "bbc", "al jazeera", "reuters", "bloomberg", "cnbc", "fox news", "msnbc", "sky news"] },
    { id: "entertain", icon: "",  label: "Entertainment", keywords: ["movie", "film", "comedy", "music", "mtv", "hbo", "showtime", "starz", "cinemax", "entertainment", "lifestyle", "reality", "discovery", "national geographic", "nat geo", "history", "cartoon", "nick", "disney", "kids"] },
  ],

  _countryFlags: {
    US: "🇺🇸", GB: "🇬🇧", UK: "🇬🇧", IN: "🇮🇳", AU: "🇦🇺", CA: "🇨🇦",
    DE: "🇩🇪", FR: "🇫🇷", ES: "🇪🇸", IT: "🇮🇹", BR: "🇧🇷", PT: "🇵🇹",
    NL: "🇳🇱", BE: "🇧🇪", TR: "🇹🇷", SA: "🇸🇦", AE: "🇦🇪", AR: "🇦🇷",
    MX: "🇲🇽", JP: "🇯🇵", KR: "🇰🇷", CN: "🇨🇳", NZ: "🇳🇿", ZA: "🇿🇦",
    PK: "🇵🇰", BD: "🇧🇩", LK: "🇱🇰", AF: "🇦🇫", IE: "🇮🇪", SE: "🇸🇪",
    NO: "🇳🇴", DK: "🇩🇰", FI: "🇫🇮", PL: "🇵🇱", RU: "🇷🇺", UA: "🇺🇦",
    CL: "🇨🇱", CO: "🇨🇴", PE: "🇵🇪", EC: "🇪🇨", VE: "🇻🇪", EG: "🇪🇬",
    NG: "🇳🇬", KE: "🇰🇪", GH: "🇬🇭", TH: "🇹🇭", VN: "🇻🇳", MY: "🇲🇾",
    ID: "🇮🇩", PH: "🇵🇭", SG: "🇸🇬", HK: "🇭🇰", TW: "🇹🇼", IL: "🇮🇱",
  },

  _classifyChannel(ch) {
    const name = (ch.name || "").toLowerCase();
    const categories = [];
    for (const cat of this._categoryDefs) {
      if (cat.keywords.some((kw) => name.includes(kw))) {
        categories.push(cat.id);
      }
    }
    return categories.length > 0 ? categories : ["other"];
  },

  _renderChannelCategories() {
    const isIptv = this._activeSource === "iptv";
    const isFreetv = this._activeSource === "freetv";
    const channels = isFreetv ? this._freetvChannels : (isIptv ? this._iptvChannels : this._allChannels);

    if (isIptv || isFreetv) {
      this._renderIptvCategories(channels);
      return;
    }

    // Count channels per content category
    const catCounts = new Map();
    catCounts.set("all", channels.length);
    channels.forEach((ch) => {
      const cats = this._classifyChannel(ch);
      cats.forEach((cat) => {
        catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
      });
    });

    // Count per country
    const countryCounts = new Map();
    channels.forEach((ch) => {
      const code = (ch.code || "").toUpperCase();
      if (code) countryCounts.set(code, (countryCounts.get(code) || 0) + 1);
    });

    let html = `<button class="cat-tab" data-cat="all" onclick="UI.filterChannelCategory('all')">All <span class="cat-count">${channels.length}</span></button>`;

    // Content categories
    html += `<span class="cat-divider"></span>`;
    for (const cat of this._categoryDefs) {
      const count = catCounts.get(cat.id) || 0;
      if (count > 0) {
        html += `<button class="cat-tab" data-cat="${cat.id}" onclick="UI.filterChannelCategory('${cat.id}')">${cat.icon} ${cat.label} <span class="cat-count">${count}</span></button>`;
      }
    }

    // Country categories (top 10)
    const topCountries = [...countryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (topCountries.length > 0) {
      html += `<span class="cat-divider"></span>`;
      topCountries.forEach(([code, count]) => {
        const flag = this._countryFlags[code] || "🌍";
        html += `<button class="cat-tab" data-cat="country:${code}" onclick="UI.filterChannelCategory('country:${code}')">${flag} ${code} <span class="cat-count">${count}</span></button>`;
      });
    }

    this._els.channelCatNav.innerHTML = html;
    this._syncChannelCategoryActiveUI();
  },

  _renderIptvCategories(channels) {
    // Count by iptv-org category
    const catCounts = new Map();
    const channelsWithUrl = channels.filter((ch) => ch.url);
    catCounts.set("all", channelsWithUrl.length);

    channelsWithUrl.forEach((ch) => {
      (ch.categories || []).forEach((cat) => {
        catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
      });
    });

    // Count by country
    const countryCounts = new Map();
    channelsWithUrl.forEach((ch) => {
      if (ch.country) countryCounts.set(ch.country, (countryCounts.get(ch.country) || 0) + 1);
    });

    let html = `<button class="cat-tab" data-cat="all" onclick="UI.filterChannelCategory('all')">All <span class="cat-count">${channelsWithUrl.length}</span></button>`;

    // iptv-org categories
    const sortedCats = [...catCounts.entries()].filter(([k]) => k !== "all").sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (sortedCats.length > 0) {
      html += `<span class="cat-divider"></span>`;
      sortedCats.forEach(([cat, count]) => {
        html += `<button class="cat-tab" data-cat="iptvcat:${cat}" onclick="UI.filterChannelCategory('iptvcat:${cat}')">${cat} <span class="cat-count">${count}</span></button>`;
      });
    }

    // Countries (top 15)
    const topCountries = [...countryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (topCountries.length > 0) {
      html += `<span class="cat-divider"></span>`;
      topCountries.forEach(([code, count]) => {
        const flag = this._countryFlags[code] || "";
        html += `<button class="cat-tab" data-cat="country:${code}" onclick="UI.filterChannelCategory('country:${code}')">${flag} ${code} <span class="cat-count">${count}</span></button>`;
      });
    }

    this._els.channelCatNav.innerHTML = html;
    this._syncChannelCategoryActiveUI();
  },

  filterChannelCategory(cat) {
    if (cat && cat.startsWith("country:")) {
      const code = cat.split(":")[1] || "";
      if (!code) return;
      this._countryFilter = (this._countryFilter || "all").toUpperCase() === code.toUpperCase() ? "all" : code.toUpperCase();
      if (this._channelCategory && this._channelCategory.startsWith("country:")) {
        this._channelCategory = "all";
      }
      this._updateCountryFilter();
      this._syncChannelCategoryActiveUI();
      this._renderChannels();
      return;
    }

    this._channelCategory = cat;
    this._syncChannelCategoryActiveUI();
    this._renderChannels();
  },

  _syncChannelCategoryActiveUI() {
    const activeCountry = (this._countryFilter || "all").toUpperCase();
    const activeCat = this._channelCategory || "all";

    document.querySelectorAll(".cat-tab").forEach((btn) => {
      const v = btn.dataset.cat;
      if (!v) return;
      if (v.startsWith("country:")) {
        const code = (v.split(":")[1] || "").toUpperCase();
        btn.classList.toggle("active", activeCountry !== "all" && code === activeCountry);
      } else {
        btn.classList.toggle("active", v === activeCat);
      }
    });
  },

  // ─── Category Navigation ───
  navigateCategories(direction) {
    const tabs = document.querySelectorAll(".cat-tab");
    const prevBtn = document.getElementById("cat-prev-btn");
    const nextBtn = document.getElementById("cat-next-btn");
    
    let currentIndex = -1;
    tabs.forEach((tab, index) => {
      if (tab.classList.contains("active")) {
        currentIndex = index;
      }
    });
    
    const newIndex = currentIndex + direction;
    
    // Update button states
    prevBtn.disabled = newIndex <= 0;
    nextBtn.disabled = newIndex >= tabs.length - 1;
    
    if (newIndex >= 0 && newIndex < tabs.length) {
      tabs[currentIndex].classList.remove("active");
      tabs[newIndex].classList.add("active");
      this._channelCategory = tabs[newIndex].dataset.cat;
      this._renderChannels();
    }
  },

  // ─── Sort Channels ───
  sortChannels(sort) {
    this._sort = sort;
    document.querySelectorAll("[data-sort]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sort === sort);
    });
    this._renderChannels();
  },

  // ─── Channels Rendering ───
  _renderChannels() {
    const isIptv = this._activeSource === "iptv";
    const isFreetv = this._activeSource === "freetv";
    const isStreamSource = isIptv || isFreetv;
    let list = isFreetv ? [...this._freetvChannels] : (isIptv ? [...this._iptvChannels] : [...this._allChannels]);

    // Country filter (independent of category)
    if (this._countryFilter !== "all") {
      const cc = this._countryFilter.toUpperCase();
      if (isStreamSource) {
        list = list.filter((ch) => (ch.country || "").toUpperCase() === cc);
      } else {
        list = list.filter((ch) => (ch.code || "").toUpperCase() === cc);
      }
    }

    // Category filter
    if (this._channelCategory !== "all") {
      if (this._channelCategory.startsWith("iptvcat:")) {
        const cat = this._channelCategory.replace("iptvcat:", "");
        list = list.filter((ch) => (ch.categories || []).includes(cat));
      } else {
        list = list.filter((ch) => {
          const cats = this._classifyChannel(ch);
          return cats.includes(this._channelCategory);
        });
      }
    }

    // Only show channels with streams for iptv-org / freetv
    if (isStreamSource) {
      list = list.filter((ch) => ch.url);
    }

    // Search
    if (this._searchQuery) {
      list = list.filter((ch) =>
        ch.name.toLowerCase().includes(this._searchQuery) ||
        (ch.code || "").toLowerCase().includes(this._searchQuery) ||
        (ch.countryName || "").toLowerCase().includes(this._searchQuery) ||
        (ch.network || "").toLowerCase().includes(this._searchQuery)
      );
    }

    // Favorites
    if (this._showFavoritesOnly) {
      list = list.filter((ch) => this._favorites.has(ch.name));
    }

    // Sort
    if (this._sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (this._sort === "viewers") list.sort((a, b) => (b.viewers || 0) - (a.viewers || 0));
    else if (this._sort === "status") {
      if (isStreamSource) {
        list.sort((a, b) => (b.url ? 1 : 0) - (a.url ? 1 : 0));
      } else {
        list.sort((a, b) => (b.status === "online" ? 1 : 0) - (a.status === "online" ? 1 : 0));
      }
    }

    this._els.channelsCount.textContent = list.length;

    if (list.length === 0) {
      this._els.channelsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📺</div>
          <h3>No channels found</h3>
          <p>Try a different search or filter</p>
        </div>`;
      return;
    }

    // On home page, show only 10 channels + "View All" link
    const isHomeLimited = this._page === "home";
    const maxChannels = 10;
    const totalChannels = list.length;

    // Limit iptv/freetv rendering to prevent DOM freeze
    const hasMoreIptv = isStreamSource && list.length > this._iptvRenderLimit;
    let renderList;
    if (isHomeLimited) {
      renderList = list.slice(0, maxChannels);
    } else if (isStreamSource) {
      renderList = list.slice(0, this._iptvRenderLimit);
    } else {
      renderList = list;
    }

    let html = renderList
      .map((ch, i) => isStreamSource ? this._iptvChannelCardHTML(ch, i) : this._channelCardHTML(ch, i))
      .join("");

    // "View All" link for home page
    if (isHomeLimited && totalChannels > maxChannels) {
      html += `
        <a class="view-all-btn" href="channels.html">
          View All Channels <span style="opacity:0.6">${totalChannels} channels</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </a>`;
    }

    this._els.channelsContainer.innerHTML = html;

    // Load More button for iptv/freetv
    if (hasMoreIptv) {
      const loadMoreBtn = document.createElement("button");
      loadMoreBtn.className = "btn load-more-btn";
      loadMoreBtn.textContent = `Load ${Math.min(200, list.length - this._iptvRenderLimit)} more channels (${list.length - this._iptvRenderLimit} remaining)`;
      loadMoreBtn.onclick = () => {
        this._iptvRenderLimit += 200;
        this._renderChannels();
      };
      this._els.channelsContainer.appendChild(loadMoreBtn);
    }
  },

  _channelCardHTML(ch, index) {
    const isOnline = ch.status === "online";
    const isFav = this._favorites.has(ch.name);
    const delay = Math.min(index * 15, 500);
    const cats = this._classifyChannel(ch);
    const primaryCat = cats[0] !== "other" ? this._categoryDefs.find((c) => c.id === cats[0]) : null;
    const catBadge = primaryCat ? `<span class="ch-card-cat">${primaryCat.icon}</span>` : "";
    const flag = this._countryFlags[(ch.code || "").toUpperCase()] || "";

    return `
      <a class="channel-card" href="player.html?name=${encodeURIComponent(ch.name)}&code=${encodeURIComponent(ch.code)}&source=cdn" style="animation-delay:${delay}ms">
        <div class="channel-card-head">
          <img src="${ch.image || ""}" alt="" loading="lazy" onerror="this.style.display='none'">
          <span class="online-dot ${isOnline ? "on" : "off"}" title="${ch.status}"></span>
          ${catBadge}
          <button class="fav-btn ${isFav ? "active" : ""}" onclick="event.preventDefault();event.stopPropagation();UI.toggleFavorite('${this._esc(ch.name)}')" title="Favorite">★</button>
        </div>
        <div class="ch-card-name">${ch.name}</div>
        <div class="ch-card-meta">${flag} ${(ch.code || "").toUpperCase()}${ch.viewers > 0 ? " · " + ch.viewers + " viewers" : ""}</div>
      </a>`;
  },

  _iptvChannelCardHTML(ch, index) {
    const isFav = this._favorites.has(ch.name);
    const delay = Math.min(index * 15, 500);
    const flag = ch.flag || this._countryFlags[(ch.country || "").toUpperCase()] || "";
    const qualityBadge = ch.quality ? `<span class="ch-card-cat" style="color:var(--green)">${ch.quality}</span>` : "";
    const labelBadge = ch.label ? `<span class="ch-card-cat">${ch.label}</span>` : "";
    const catBadges = (ch.categories || []).slice(0, 2).map((c) => `<span class="ch-card-cat">${c}</span>`).join("");
    const sourceTag = ch._source === "freetv" ? "freetv" : "iptv";

    const refParam = ch.referrer ? `&referrer=${encodeURIComponent(ch.referrer)}` : "";
    const directURL = ch.url;
    const finalURL = this._useStreamProxy && (typeof API !== "undefined" && API.proxiedStreamURL)
      ? API.proxiedStreamURL(directURL)
      : directURL;
    const playerURL = `player.html?name=${encodeURIComponent(ch.name)}&url=${encodeURIComponent(finalURL)}&source=${sourceTag}&code=${encodeURIComponent(ch.country || "")}${ch.quality ? "&quality=" + encodeURIComponent(ch.quality) : ""}${refParam}`;

    return `
      <a class="channel-card" href="${playerURL}" style="animation-delay:${delay}ms">
        <div class="channel-card-head">
          <img src="${ch.logo || ""}" alt="" loading="lazy" onerror="this.style.display='none'">
          <span class="online-dot on" title="Stream available"></span>
          ${catBadges}
          <button class="fav-btn ${isFav ? "active" : ""}" onclick="event.preventDefault();event.stopPropagation();UI.toggleFavorite('${this._esc(ch.name)}')" title="Favorite">★</button>
        </div>
        <div class="ch-card-name">${ch.name}</div>
        <div class="ch-card-meta">${flag} ${ch.countryName || ch.country || ""}${ch.network ? " · " + ch.network : ""}</div>
        <div class="ch-card-meta">${qualityBadge}${labelBadge}</div>
      </a>`;
  },

  // ─── Favorites ───
  toggleFavorite(name) {
    if (this._favorites.has(name)) {
      this._favorites.delete(name);
      Toast.show(`Removed from favorites`);
    } else {
      this._favorites.add(name);
      Toast.show(`Added to favorites`);
    }
    localStorage.setItem("cdnlive_favorites", JSON.stringify([...this._favorites]));
    this._renderChannels();
  },

  toggleFavoritesFilter() {
    this._showFavoritesOnly = !this._showFavoritesOnly;
    document.getElementById("fav-filter-btn")?.classList.toggle("active", this._showFavoritesOnly);
    this._renderChannels();
  },

  _esc(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, "&quot;");
  },
};

/** Toast Notifications */
const Toast = {
  _container: null,
  init() { this._container = document.getElementById("toast-container"); },
  show(msg) {
    if (!this._container) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    this._container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  },
};

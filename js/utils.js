/**
 * utils.js — Utility functions for CDN Live TV
 * Copy URL, Share, Back to Top, View Toggle
 */

const Utils = {
  init() {
    this._setupBackToTop();
  },

  // ─── Copy URL ───
  copyURL() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      Toast.show("URL copied to clipboard");
    }).catch(() => {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      Toast.show("URL copied to clipboard");
    });
  },

  // ─── Share ───
  async share() {
    const url = window.location.href;
    const title = document.title;
    
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch (err) {
        if (err.name !== "AbortError") {
          this.copyURL();
        }
      }
    } else {
      // Fallback: copy URL
      this.copyURL();
    }
  },

  // ─── Back to Top ───
  scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  },

  _setupBackToTop() {
    const btn = document.getElementById("back-to-top");
    if (!btn) return;

    const toggle = () => {
      btn.classList.toggle("visible", window.scrollY > 200);
    };

    window.addEventListener("scroll", toggle);
    toggle(); // Initial state
  },

  // ─── View Toggle (for future use) ───
  toggleView() {
    const container = document.querySelector(".events-grid, .channels-grid");
    if (!container) return;
    
    const isList = container.classList.contains("list-view");
    if (isList) {
      container.classList.remove("list-view");
      container.classList.add("grid-view");
      Toast.show("Switched to grid view");
    } else {
      container.classList.remove("grid-view");
      container.classList.add("list-view");
      Toast.show("Switched to list view");
    }
  },

  // ─── Keyboard Shortcuts Helper ───
  showShortcuts() {
    const shortcuts = [
      { key: "/", desc: "Search channels" },
      { key: "R", desc: "Refresh data" },
      { key: "C", desc: "Copy URL" },
      { key: "S", desc: "Share page" },
      { key: "T", desc: "Back to top" },
    ];
    
    const html = shortcuts.map(({ key, desc }) => 
      `<div style="display:flex;justify-content:space-between;padding:4px 0"><span class="kbd">${key}</span><span>${desc}</span></div>`
    ).join("");
    
    Toast.show(html, 5000);
  },
};

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => Utils.init());

/**
 * MobileSearch — Full-screen search overlay for small screens
 */
const MobileSearch = {
  open() {
    const overlay = document.getElementById("mobile-search-overlay");
    if (!overlay) return;
    overlay.classList.add("show");
    const input = document.getElementById("mobile-search-input");
    if (input) {
      input.value = document.getElementById("search-input")?.value || "";
      setTimeout(() => input.focus(), 100);
    }
  },

  close() {
    const overlay = document.getElementById("mobile-search-overlay");
    if (overlay) overlay.classList.remove("show");
  },
};

// Wire mobile search input to UI search
document.addEventListener("DOMContentLoaded", () => {
  const mobileInput = document.getElementById("mobile-search-input");
  if (mobileInput) {
    mobileInput.addEventListener("input", (e) => {
      const desktopInput = document.getElementById("search-input");
      if (desktopInput) {
        desktopInput.value = e.target.value;
        desktopInput.dispatchEvent(new Event("input"));
      }
    });
  }
});

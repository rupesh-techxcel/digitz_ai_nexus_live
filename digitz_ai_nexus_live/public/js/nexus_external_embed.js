(function() {
  "use strict";

  var currentScript = document.currentScript;
  var server = (currentScript && currentScript.dataset.server) || "";
  var widget = (currentScript && currentScript.dataset.widget) || "";
  var autoMount = !currentScript || currentScript.dataset.autoMount !== "false";

  if (!server) {
    var src = currentScript && currentScript.src;
    if (src) {
      server = new URL(src).origin;
    }
  }

  server = server.replace(/\/$/, "");

  var frame = null;
  var launcher = null;
  var pendingOpen = false;
  var frameLoaded = false;
  var providerOrigin = server;
  var stateKey = "nexus_external_chat_state:" + (server || "default") + ":" + (widget || "default");

  function loadTracker() {
    if (!server) return;
    // Tracker already present (host page included it manually) or already loading
    if (typeof window.getNexusVisitorContext === "function" || window.__nexusTrackerLoading) {
      return;
    }
    window.__nexusTrackerLoading = true;

    // The tracker reads window.NexusConfig at eval time — set it before injecting,
    // but never clobber a host page's own configuration.
    if (!window.NexusConfig) {
      window.NexusConfig = { server_url: server, channel: widget };
    }

    var script = document.createElement("script");
    script.async = true;
    script.src = server + "/assets/digitz_ai_nexus_live/js/nexus_visitor_tracker.js";
    (document.head || document.documentElement).appendChild(script);
  }

  function sendVisitorContext() {
    if (!frame || !frame.contentWindow || !frameLoaded) return;

    var ctx = (typeof window.getNexusVisitorContext === "function"
      ? window.getNexusVisitorContext()
      : window.NexusContext) || {};
    if (!ctx.visitor_id && !ctx.session_id) return;

    frame.contentWindow.postMessage({
      source: "nexus-external-site",
      action: "visitor-context",
      visitor_id: ctx.visitor_id || null,
      session_id: ctx.session_id || null,
      // Read live from the host window so SPA navigations stay accurate
      page_url: String(window.location.href || "").slice(0, 1024),
      page_title: String(document.title || "").slice(0, 512),
      referrer: String(document.referrer || "").slice(0, 1024)
    }, providerOrigin);
  }

  window.addEventListener("nexus:visitor-ready", sendVisitorContext);

  function saveState(state) {
    try {
      localStorage.setItem(stateKey, state);
    } catch (_) {}
  }

  function loadState() {
    try {
      return localStorage.getItem(stateKey);
    } catch (_) {
      return null;
    }
  }

  function createFrame() {
    if (frame) return frame;

    frame = document.createElement("iframe");
    frame.id = "nexusExternalChatFrame";
    frame.title = "Nexus AI Chat";
    frame.setAttribute("aria-label", "Nexus AI Chat");
    frame.setAttribute("allow", "clipboard-write");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";
    frame.style.background = "transparent";
    frame.style.zIndex = "99999";
    frame.style.colorScheme = "normal";
    frame.style.opacity = "0";
    frame.style.pointerEvents = "none";

    var params = new URLSearchParams();
    params.set("widget", widget);
    params.set("origin", window.location.origin);
    frame.src = server + "/nexus-chat-embed?" + params.toString();

    frame.addEventListener("load", function() {
      frameLoaded = true;
      sendVisitorContext();
      if (pendingOpen) open();
    });

    document.body.appendChild(frame);

    if (loadState() === "open") {
      open();
    }

    return frame;
  }

  function createLauncher() {
    if (launcher) return launcher;

    launcher = document.createElement("button");
    launcher.id = "nexusExternalChatLauncher";
    launcher.type = "button";
    launcher.setAttribute("aria-label", "Open chat");
    launcher.innerHTML =
      '<span class="nxc-launcher-icon">AI</span>' +
      '<span class="nxc-launcher-text">Chat</span>';

    launcher.style.position = "fixed";
    launcher.style.right = "24px";
    launcher.style.bottom = "24px";
    launcher.style.zIndex = "99998";
    launcher.style.display = "inline-flex";
    launcher.style.alignItems = "center";
    launcher.style.justifyContent = "center";
    launcher.style.gap = "9px";
    launcher.style.height = "58px";
    launcher.style.padding = "0 18px 0 12px";
    launcher.style.border = "0";
    launcher.style.borderRadius = "18px";
    launcher.style.background = "linear-gradient(135deg, #002ca8 0%, #063ed7 100%)";
    launcher.style.boxShadow = "0 16px 38px rgba(0, 44, 168, 0.28)";
    launcher.style.color = "#fff";
    launcher.style.font = "700 14px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    launcher.style.cursor = "pointer";
    launcher.style.letterSpacing = "0";

    var style = document.createElement("style");
    style.textContent =
      "#nexusExternalChatLauncher .nxc-launcher-icon{" +
      "width:36px;height:36px;border-radius:12px;display:grid;place-items:center;" +
      "background:linear-gradient(135deg,#f9a608 0%,#ffbe2e 100%);color:#201500;" +
      "font-weight:900;font-size:13px;box-shadow:inset 0 1px 0 rgba(255,255,255,.35);" +
      "}" +
      "#nexusExternalChatLauncher:hover{transform:translateY(-2px);box-shadow:0 20px 44px rgba(0,44,168,.34);}" +
      "@media (max-width: 640px){#nexusExternalChatLauncher{right:16px!important;bottom:16px!important;height:54px!important;padding-right:15px!important;}}";
    document.head.appendChild(style);

    launcher.addEventListener("click", open);
    document.body.appendChild(launcher);
    return launcher;
  }

  function setLauncherVisible(visible) {
    if (!launcher) return;
    launcher.style.display = visible ? "inline-flex" : "none";
  }

  function setFrameState(state) {
    if (!frame) return;

    if (state === "open") {
      frame.style.width = "min(460px, 100vw)";
      frame.style.height = "min(640px, 100vh)";
      frame.style.opacity = "1";
      frame.style.pointerEvents = "auto";
      setLauncherVisible(false);
      return;
    }

    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.opacity = "0";
    frame.style.pointerEvents = "none";
    setLauncherVisible(true);
  }

  function open() {
    pendingOpen = true;
    saveState("open");
    loadTracker();
    createFrame();
    setFrameState("open");
    sendVisitorContext();
    frame.contentWindow && frame.contentWindow.postMessage({
      source: "nexus-external-site",
      action: "open-chat"
    }, providerOrigin);
  }

  function mount() {
    loadTracker();
    if (document.body) {
      createLauncher();
      createFrame();
      return;
    }

    document.addEventListener("DOMContentLoaded", function() {
      createLauncher();
      createFrame();
    });
  }

  window.addEventListener("message", function(event) {
    var data = event.data || {};
    if (event.origin !== providerOrigin || data.source !== "nexus-chat-embed") {
      return;
    }

    if (data.state === "open") {
      pendingOpen = false;
    }

    if (data.state === "open" || data.state === "closed") {
      saveState(data.state);
    }

    setFrameState(data.state);
  });

  window.NexusExternalChat = {
    mount: mount,
    open: open
  };

  if (autoMount) {
    mount();
  }
})();

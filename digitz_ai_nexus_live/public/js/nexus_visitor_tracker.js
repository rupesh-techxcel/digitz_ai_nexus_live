/**
 * Nexus Visitor Tracker
 *
 * Privacy principles:
 * - Only first-party cookies/localStorage — no third-party tracking.
 * - No keystroke, mouse, form field, fingerprint, or GPS tracking.
 * - visitor_id is a long-term anonymous identifier (absent in Strict mode).
 * - session_id resets after inactivity or on new browser session.
 * - Active time is paused when the tab is hidden (visibilitychange).
 * - Page end is sent via navigator.sendBeacon for reliability.
 * - If the analytics API is disabled or fails, tracking stops silently.
 * - Chat widget works regardless of whether this tracker initialised.
 *
 * External website usage — set before loading this script:
 *   window.NexusConfig = {
 *     server_url: "https://your-nexus-server.com",  // Required for external sites
 *     channel:    "YOUR_CHANNEL_KEY",               // For chat widget
 *   };
 *
 * Exposes:
 *   window.NexusContext        — read-only visitor/session context
 *   window.getNexusVisitorContext() — safe accessor for chat widget
 */
(function (global) {
    'use strict';

    // ── Config — read NexusConfig set by the embedding page ───────────────────

    var _cfg         = global.NexusConfig || {};
    var _server_url  = (_cfg.server_url  || '').replace(/\/$/, '');
    var _channel     = (_cfg.channel     || '') + '';   // widget code — passed to server for tenant tagging
    var _cross_origin = !!_server_url && _server_url !== (global.location.origin || '');

    // ── Constants ─────────────────────────────────────────────────────────────

    const COOKIE_KEY     = 'nxv_vid';
    const STORAGE_KEY    = 'nxv_vid';
    const SESSION_KEY    = 'nxv_sid';
    const DEFAULT_HB_SEC = 30;
    // Build API base — absolute when cross-origin, relative when same-origin
    const API_BASE       = _server_url + '/api/method/digitz_ai_nexus_live.api.visitor_tracking.';

    // ── Internal state ────────────────────────────────────────────────────────

    const T = {
        visitor_id:        null,
        session_id:        null,
        page_visit_id:     null,
        page_start_ts:     null,   // Date.now() when page visit started
        active_ms:         0,      // cumulative active milliseconds
        active_start:      null,   // Date.now() when tab became visible
        hb_timer:          null,
        hb_interval_sec:   DEFAULT_HB_SEC,
        persistent:        true,
        cookie_expiry_days: 365,
        privacy_mode:      'Balanced',
        enabled:           false,
        initialised:       false,
        page_ended:        false,
    };

    // ── Cookie / storage helpers ───────────────────────────────────────────────

    function _set_cookie(name, value, days) {
        const exp = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = name + '=' + encodeURIComponent(value)
            + '; expires=' + exp + '; path=/; SameSite=Lax';
    }

    function _get_cookie(name) {
        const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
        return m ? decodeURIComponent(m[1]) : null;
    }

    function _del_cookie(name) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    }

    function _save_visitor_id(vid) {
        if (!vid) return;
        try { localStorage.setItem(STORAGE_KEY, vid); } catch (_) {}
        if (T.persistent) _set_cookie(COOKIE_KEY, vid, T.cookie_expiry_days);
    }

    function _read_stored_visitor_id() {
        // Cookie takes precedence (more reliable cross-tab)
        return _get_cookie(COOKIE_KEY) || (function () {
            try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
        })();
    }

    function _save_session_id(sid) {
        if (!sid) return;
        try { sessionStorage.setItem(SESSION_KEY, sid); } catch (_) {}
    }

    function _read_stored_session_id() {
        try { return sessionStorage.getItem(SESSION_KEY); } catch (_) { return null; }
    }

    function _clear_session_id() {
        try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    }

    // ── API helpers ───────────────────────────────────────────────────────────

    /**
     * Encode a plain object to application/x-www-form-urlencoded.
     * Using form-encoded body (not JSON) keeps cross-origin POSTs as "simple
     * requests" — no CORS preflight is triggered, so external sites work
     * without needing the server to handle OPTIONS separately.
     */
    function _encode_form(data) {
        return Object.keys(data).map(function (k) {
            var v = data[k];
            if (v === null || v === undefined) return null;
            return encodeURIComponent(k) + '=' + encodeURIComponent(
                typeof v === 'object' ? JSON.stringify(v) : v
            );
        }).filter(Boolean).join('&');
    }

    function _post(endpoint, data, beacon) {
        var url = API_BASE + endpoint;
        var body = _encode_form(data);

        if (beacon && navigator.sendBeacon) {
            // sendBeacon for page-end reliability — fire-and-forget
            try {
                navigator.sendBeacon(url, new Blob([body], {
                    type: 'application/x-www-form-urlencoded'
                }));
            } catch (_) {}
            return Promise.resolve(null);
        }

        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body,
            keepalive: true,
            // omit cookies for cross-origin; same-origin sessions handled by Frappe normally
            credentials: _cross_origin ? 'omit' : 'same-origin',
        })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (r) { return r && r.message ? r.message : r; })
        .catch(function () { return null; });
    }

    // ── Active time tracking ──────────────────────────────────────────────────

    function _resume_active() {
        if (!T.active_start) T.active_start = Date.now();
    }

    function _pause_active() {
        if (T.active_start) {
            T.active_ms += Date.now() - T.active_start;
            T.active_start = null;
        }
    }

    function _active_seconds() {
        var ms = T.active_ms;
        if (T.active_start) ms += Date.now() - T.active_start;
        return Math.round(ms / 1000);
    }

    function _total_seconds() {
        if (!T.page_start_ts) return 0;
        return Math.round((Date.now() - T.page_start_ts) / 1000);
    }

    // ── Page visit lifecycle ──────────────────────────────────────────────────

    function _start_page_visit() {
        if (!T.enabled || !T.visitor_id || !T.session_id) return;

        T.page_start_ts = Date.now();
        T.active_ms = 0;
        T.active_start = document.visibilityState !== 'hidden' ? Date.now() : null;

        var payload = {
            page_url:          _safe_url(location.href),
            page_path:         location.pathname,
            page_title:        document.title,
            previous_page_url: _safe_url(document.referrer),
            referrer:          _safe_url(document.referrer),
        };

        _post('track_page_start', {
            visitor_id: T.visitor_id,
            session_id: T.session_id,
            payload:    JSON.stringify(payload),
        }).then(function (r) {
            if (r && r.page_visit_id) {
                T.page_visit_id = r.page_visit_id;
                _start_heartbeat();
            }
        });
    }

    function _send_heartbeat() {
        if (!T.enabled || !T.page_visit_id || T.page_ended) return;
        _post('track_page_heartbeat', {
            page_visit_id:          T.page_visit_id,
            active_duration_seconds: _active_seconds(),
        });
    }

    function _start_heartbeat() {
        if (T.hb_timer) clearInterval(T.hb_timer);
        T.hb_timer = setInterval(_send_heartbeat, T.hb_interval_sec * 1000);
    }

    function _end_page_visit() {
        if (!T.enabled || !T.page_visit_id || T.page_ended) return;
        T.page_ended = true;
        if (T.hb_timer) { clearInterval(T.hb_timer); T.hb_timer = null; }
        _pause_active();

        // Use sendBeacon so the request survives page unload
        _post('track_page_end', {
            page_visit_id:           T.page_visit_id,
            duration_seconds:        _total_seconds(),
            active_duration_seconds: _active_seconds(),
        }, /* beacon = */ true);
    }

    function _safe_url(url) {
        if (!url || typeof url !== 'string') return '';
        return url.slice(0, 1024);
    }

    // ── Initialisation ────────────────────────────────────────────────────────

    function _init() {
        if (T.initialised) return;
        T.initialised = true;

        var stored_vid = _read_stored_visitor_id();
        var stored_sid = _read_stored_session_id();

        var page_payload = {
            page_url:  _safe_url(location.href),
            referrer:  _safe_url(document.referrer),
        };

        _post('start_visitor_session', {
            visitor_id: stored_vid || null,
            session_id: stored_sid || null,
            payload:    JSON.stringify(page_payload),
            channel:    _channel || null,
        }).then(function (r) {
            if (!r || r.enabled === false) {
                // Analytics disabled server-side — stop all tracking
                T.enabled = false;
                _expose_context();
                return;
            }

            T.enabled = true;
            T.visitor_id = r.visitor_id || null;
            T.session_id  = r.session_id  || null;

            var s = r.settings || {};
            T.hb_interval_sec   = parseInt(s.heartbeat_interval_seconds) || DEFAULT_HB_SEC;
            T.persistent        = s.enable_persistent_visitor_id !== false;
            T.cookie_expiry_days = parseInt(s.visitor_cookie_expiry_days) || 365;
            T.privacy_mode      = s.privacy_mode || 'Balanced';

            // Persist identifiers per settings
            if (T.visitor_id) {
                if (T.persistent && T.privacy_mode !== 'Strict') {
                    _save_visitor_id(T.visitor_id);
                }
                _save_session_id(T.session_id);
            }

            _expose_context();
            _start_page_visit();
        }).catch(function () {
            // Silently fail — chat must not depend on this
            T.enabled = false;
            _expose_context();
        });
    }

    function _expose_context() {
        var ctx = {
            visitor_id: T.visitor_id,
            session_id:  T.session_id,
            page_url:   location.href,
            page_title: document.title,
            referrer:   document.referrer,
            source:     'website',
        };
        global.NexusContext = ctx;
    }

    // ── Event listeners ───────────────────────────────────────────────────────

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            _pause_active();
        } else {
            _resume_active();
        }
    });

    window.addEventListener('beforeunload', function () {
        _end_page_visit();
    });

    // SPA navigation support (popstate)
    window.addEventListener('popstate', function () {
        _end_page_visit();
        T.page_visit_id = null;
        T.page_ended    = false;
        T.page_start_ts = null;
        T.active_ms     = 0;
        setTimeout(_start_page_visit, 100);
    });

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Returns the current visitor/session context.
     * Always safe to call — returns empty object if not yet initialised.
     */
    global.getNexusVisitorContext = function () {
        return global.NexusContext || {};
    };

    // Expose a minimal object immediately so the chat widget can read it
    // even if it loads before init completes.
    global.NexusContext = {
        visitor_id: null,
        session_id:  null,
        page_url:   location.href,
        page_title: document.title,
        referrer:   document.referrer,
        source:     'website',
    };

    // ── Bootstrap ─────────────────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        // DOMContentLoaded already fired (e.g. script loaded async)
        _init();
    }

}(window));

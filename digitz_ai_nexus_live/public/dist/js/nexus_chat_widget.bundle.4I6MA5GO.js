(() => {
  // ../digitz_ai_nexus_live/digitz_ai_nexus_live/public/js/nexus_chat_widget.bundle.js
  (function(global) {
    "use strict";
    const cfg = global.NexusChatConfig || {};
    const S = {
      ready: false,
      open: false,
      conversation_id: null,
      agent_instance: null,
      agent_name: null,
      locked: false,
      sending: false,
      close_requested: false,
      starting: false,
      unread_count: 0,
      title_before_unread: null,
      tenant: cfg.tenant || null,
      channel: cfg.channel || null,
      widget_code: cfg.widget_code || null,
      knowledge_delivery_enabled: cfg.knowledge_delivery_enabled !== 0 && cfg.knowledge_delivery_enabled !== false,
      show_correlated_on_desk: false,
      _realtime_bound: false,
      visitor_email: null,
      identity_verification_challenge: null
    };
    function is_desk() {
      return !!(global.frappe && frappe.boot && frappe.boot.user && frappe.boot.user.name && frappe.boot.user.name !== "Guest");
    }
    function _generate_conversation_id() {
      var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      var id = "";
      for (var i = 0; i < 12; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return id;
    }
    var _CONV_SCOPE = cfg.storage_key || cfg.widget_code || cfg.channel || cfg.tenant || "default";
    var _CONV_KEY = "ncw_session:" + _CONV_SCOPE;
    var _CONV_TTL = 60 * 60 * 1e3;
    function _conv_save(caller_token) {
      if (is_desk() || !S.conversation_id)
        return;
      try {
        var existing = {};
        try {
          existing = JSON.parse(localStorage.getItem(_CONV_KEY) || "{}");
        } catch (_) {
        }
        localStorage.setItem(_CONV_KEY, JSON.stringify({
          id: S.conversation_id,
          ts: Date.now(),
          status: "open",
          tenant: S.tenant || null,
          channel: S.channel || null,
          caller_token: caller_token || existing.caller_token || null
        }));
      } catch (_) {
      }
    }
    function _conv_touch() {
      if (is_desk() || !S.conversation_id)
        return;
      try {
        var raw = localStorage.getItem(_CONV_KEY);
        if (!raw)
          return;
        var stored = JSON.parse(raw);
        if (stored && stored.id === S.conversation_id) {
          stored.ts = Date.now();
          localStorage.setItem(_CONV_KEY, JSON.stringify(stored));
        }
      } catch (_) {
      }
    }
    function _conv_close() {
      try {
        localStorage.removeItem(_CONV_KEY);
      } catch (_) {
      }
    }
    function _conv_caller_token() {
      try {
        var stored = JSON.parse(localStorage.getItem(_CONV_KEY) || "null");
        return stored && stored.id === S.conversation_id ? stored.caller_token : null;
      } catch (_) {
        return null;
      }
    }
    function _conv_resume() {
      if (is_desk())
        return null;
      try {
        var stored = JSON.parse(localStorage.getItem(_CONV_KEY) || "null");
        if (!stored || !stored.id)
          return null;
        if (stored.status === "closed") {
          localStorage.removeItem(_CONV_KEY);
          return null;
        }
        if (Date.now() - stored.ts > _CONV_TTL) {
          localStorage.removeItem(_CONV_KEY);
          return null;
        }
        return stored;
      } catch (_) {
        return null;
      }
    }
    function _subscribe_to_conversation(conversation_id) {
      try {
        if (frappe && frappe.realtime) {
          if (typeof frappe.realtime.task_subscribe === "function") {
            frappe.realtime.task_subscribe(conversation_id);
          } else {
            frappe.realtime.emit("task_subscribe", conversation_id);
          }
        }
      } catch (_) {
      }
    }
    function el(id) {
      return document.getElementById(id);
    }
    function show(id) {
      const e = el(id);
      if (e)
        e.style.display = "";
    }
    function hide(id) {
      const e = el(id);
      if (e)
        e.style.display = "none";
    }
    function text(id, val) {
      const e = el(id);
      if (e)
        e.textContent = val;
    }
    function escape_html(s) {
      return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function format_message(raw, is_agent) {
      const safe = escape_html(raw || "");
      if (!is_agent)
        return safe;
      const paras = safe.split(/\n{2,}/);
      if (paras.length === 1)
        return safe.replace(/\n/g, "<br>");
      return paras.map((p) => "<p>" + p.replace(/\n/g, "<br>") + "</p>").join("");
    }
    function fmt_time(iso) {
      try {
        return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } catch (_) {
        return "";
      }
    }
    function api(method, args) {
      return new Promise(function(resolve, reject) {
        function reject_silently(error) {
          try {
            if (frappe.hide_msgprint)
              frappe.hide_msgprint(true);
            if (frappe.error_dialog && frappe.error_dialog.hide)
              frappe.error_dialog.hide();
          } catch (_) {
          }
          reject(error);
        }
        var call = frappe.call({
          method,
          args: args || {},
          silent: true,
          error_msg: "#__ncw_void__",
          callback: function(r) {
            resolve(r);
          },
          error: reject_silently
        });
        if (call && typeof call.fail === "function") {
          call.fail(reject_silently);
        }
      });
    }
    function build_dom() {
      if (el("ncw-root"))
        return;
      const desk_path = window.location.pathname === "/login" || window.location.pathname.startsWith("/app");
      if (desk_path && !is_desk())
        return;
      const root = document.createElement("div");
      root.id = "ncw-root";
      root.innerHTML = `
            <div id="ncw-tooltip" role="tooltip" aria-live="polite">
                <button id="ncw-tooltip-dismiss" aria-label="Dismiss">&#x2715;</button>
                <div id="ncw-tooltip-kicker">Powered by NEXUS ORBIT</div>
                <p id="ncw-tooltip-body">Every response here is drawn from a governed knowledge layer and delivered through agentic intelligence &mdash; precision at scale.</p>
                <button id="ncw-tooltip-cta">Experience it &rarr;</button>
            </div>

            <button id="ncw-bubble" aria-label="Open chat">
                <img src="/assets/digitz_ai_nexus/images/nexus-chat-agent-icon.svg" alt="Chat" width="52" height="52">
                <span id="ncw-badge" style="display:none;"></span>
            </button>

            <div id="ncw-panel" style="display:none;">
                <div id="ncw-header">
                    <div id="ncw-avatar">
                    <img src="/assets/digitz_ai_nexus/images/nexus-chat-agent-icon.svg" alt="AI" width="36" height="36">
                </div>
                    <div id="ncw-hinfo">
                        <div id="ncw-htitle">AI Assistant</div>
                        <div id="ncw-hsub"></div>
                    </div>
                    <button id="ncw-font-btn" aria-label="Increase font size" title="Text size">A</button>
                    <button id="ncw-max-btn" aria-label="Maximise">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                        </svg>
                    </button>
                    <button id="ncw-min-btn" aria-label="Minimise">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                    </button>
                    <button id="ncw-close-btn" aria-label="Close chat" title="Close chat">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="6" y1="6" x2="18" y2="18"/>
                            <line x1="18" y1="6" x2="6" y2="18"/>
                        </svg>
                    </button>
                </div>

                <div id="ncw-wa-strip">
                    <svg id="ncw-wa-icon" viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-hidden="true">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.118.554 4.107 1.523 5.834L.057 23.882l6.239-1.637A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.808 9.808 0 01-5.007-1.375l-.36-.214-3.702.971.988-3.61-.235-.372A9.794 9.794 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182c5.43 0 9.818 4.388 9.818 9.818 0 5.43-4.388 9.818-9.818 9.818z"/>
                    </svg>
                    <span id="ncw-wa-text">Continue this conversation on WhatsApp</span>
                    <span id="ncw-wa-arrow">\u2192</span>
                    <button id="ncw-wa-dismiss" aria-label="Dismiss WhatsApp prompt">\xD7</button>
                </div>

                <div id="ncw-wa-info" style="display:none;">
                    <svg viewBox="0 0 16 16" fill="none" width="14" height="14" style="flex-shrink:0;color:#25D366;" aria-hidden="true">
                        <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
                        <path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                    </svg>
                    <span><strong>Coming soon!</strong> WhatsApp sync is an upcoming feature \u2014 we're currently awaiting workflow approval from Meta to bring it live.</span>
                </div>

                <div id="ncw-messages"></div>

                <div id="ncw-typing" style="display:none;">
                    <div id="ncw-typing-dots">
                        <span></span><span></span><span></span>
                    </div>
                </div>

                <div id="ncw-nexy-sticky">
                    <button id="ncw-nexy-connect-btn" type="button" aria-label="Connect with Nexy, Companion, the Agentic AI with many roles">
                        <span id="ncw-nexy-mark" aria-hidden="true">N</span>
                        <span id="ncw-nexy-copy">
                            <strong>Connect with Nexy</strong>
                            <small>Companion - The Agentic AI with many roles</small>
                        </span>
                        <span id="ncw-nexy-arrow" aria-hidden="true">&#8594;</span>
                    </button>
                </div>

                <div id="ncw-footer">
                    <div id="ncw-input-bar">
                        <textarea
                            id="ncw-input"
                            placeholder="Type a message\u2026"
                            rows="1"
                            maxlength="500"
                            aria-label="Chat message"
                        ></textarea>
                        <button id="ncw-send-btn" aria-label="Send">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M2 21l21-9L2 3v7l15 2-15 2z"/>
                            </svg>
                        </button>
                    </div>
                    <div id="ncw-closed-bar" style="display:none;"></div>
                    <div id="ncw-brand">
                        <svg id="ncw-brand-spark" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 1l1.2 3.8H11L8 7l1.2 3.8L6 8.6 2.8 10.8 4 7 1 4.8h3.8z" fill="url(#ncw-spark-grad)"/><defs><linearGradient id="ncw-spark-grad" x1="1" y1="1" x2="11" y2="11" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#2158c7"/><stop offset="100%" stop-color="#818cf8"/></linearGradient></defs></svg>
                        Powered by <span id="ncw-brand-name">Nexus AI</span>
                    </div>
                </div>
            </div>
        `;
      document.body.appendChild(root);
      inject_styles();
      bind_ui_events();
      _ensure_realtime_bound();
    }
    function _ensure_realtime_bound() {
      if (S._realtime_bound)
        return;
      var _try_bind = function() {
        if (S._realtime_bound)
          return false;
        if (frappe && frappe.realtime && frappe.realtime.socket) {
          S._realtime_bound = true;
          bind_realtime();
          return true;
        }
        return false;
      };
      if (_try_bind())
        return;
      if (typeof $ !== "undefined") {
        $(document).on("app_ready", function() {
          _try_bind();
        });
      }
      var polls = 0;
      var poll_id = setInterval(function() {
        polls++;
        if (_try_bind() || polls >= 20) {
          clearInterval(poll_id);
        }
      }, 250);
    }
    function bind_ui_events() {
      el("ncw-bubble").addEventListener("click", function() {
        _dismiss_tooltip();
        toggle_panel();
      });
      el("ncw-font-btn").addEventListener("click", cycle_font_size);
      el("ncw-max-btn").addEventListener("click", toggle_maximise);
      el("ncw-min-btn").addEventListener("click", close_panel);
      el("ncw-close-btn").addEventListener("click", close_widget);
      if (is_desk()) {
        el("ncw-close-btn").style.display = "none";
        el("ncw-nexy-sticky").style.display = "none";
      }
      _apply_font_size(_load_font_size());
      if (is_desk() || sessionStorage.getItem("ncw_wa_dismissed")) {
        el("ncw-wa-strip").style.display = "none";
      }
      el("ncw-wa-dismiss").addEventListener("click", function(e) {
        e.stopPropagation();
        sessionStorage.setItem("ncw_wa_dismissed", "1");
        el("ncw-wa-strip").style.display = "none";
        el("ncw-wa-info").style.display = "none";
      });
      var _wa_info_timer = null;
      el("ncw-wa-strip").addEventListener("click", function(e) {
        if (e.target === el("ncw-wa-dismiss"))
          return;
        var info = el("ncw-wa-info");
        var visible = info.style.display !== "none";
        info.style.display = visible ? "none" : "flex";
        if (!visible) {
          clearTimeout(_wa_info_timer);
          _wa_info_timer = setTimeout(function() {
            el("ncw-wa-info").style.display = "none";
          }, 6e3);
        }
      });
      el("ncw-send-btn").addEventListener("click", send_message);
      document.addEventListener("visibilitychange", function() {
        if (!document.hidden && S.open)
          clear_unread();
      });
      global.addEventListener("focus", function() {
        if (S.open)
          clear_unread();
      });
      const input = el("ncw-input");
      input.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send_message();
        }
      });
      input.addEventListener("input", function() {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 100) + "px";
      });
      _init_tooltip();
    }
    function _dismiss_tooltip() {
      var tip = el("ncw-tooltip");
      if (!tip || tip.style.display === "none")
        return;
      tip.style.opacity = "0";
      tip.style.transform = "translateX(12px)";
      setTimeout(function() {
        if (tip)
          tip.style.display = "none";
      }, 280);
      try {
        sessionStorage.setItem("ncw_tooltip_dismissed", "1");
      } catch (_) {
      }
    }
    function _init_tooltip() {
      var tip = el("ncw-tooltip");
      if (!tip)
        return;
      if (is_desk()) {
        tip.style.display = "none";
        return;
      }
      try {
        if (sessionStorage.getItem("ncw_tooltip_dismissed")) {
          tip.style.display = "none";
          return;
        }
      } catch (_) {
      }
      var dismiss_btn = el("ncw-tooltip-dismiss");
      var cta_btn = el("ncw-tooltip-cta");
      if (dismiss_btn)
        dismiss_btn.addEventListener("click", function(e) {
          e.stopPropagation();
          _dismiss_tooltip();
        });
      if (cta_btn)
        cta_btn.addEventListener("click", function() {
          _dismiss_tooltip();
          open_panel();
        });
      setTimeout(function() {
        tip.style.display = "flex";
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            tip.style.opacity = "1";
            tip.style.transform = "translateX(0)";
          });
        });
        setTimeout(_dismiss_tooltip, 1e4);
      }, 3e3);
    }
    function bind_realtime() {
      frappe.realtime.on("nexus_chat_response", function(data) {
        if (!data || data.conversation_id !== S.conversation_id)
          return;
        if (data.response_type !== "visitor_message" && (data.message || data.answer) && (!S.open || document.hidden)) {
          mark_unread();
        }
        hide_typing();
        if (data.status === "error") {
          append_error(data.error || "An error occurred.");
          return;
        }
        var _rt_agent_lbl = data.agent_name || S.agent_name || null;
        if (data.response_type === "category_picker") {
          var _rt_cats = data.categories || [];
          typewrite_message("agent", data.message || data.answer, null, _rt_agent_lbl, function() {
            render_category_picker(_rt_cats);
          });
          return;
        }
        if (data.status === "closed" || data.response_type === "conversation_closed") {
          typewrite_message("agent", data.message || data.answer, null, _rt_agent_lbl, function() {
            lock_input("This conversation is closed. Start a new chat to continue.");
          });
          return;
        }
        if (data.response_type === "visitor_message")
          return;
        if (data.response_type === "agent_joined") {
          append_system_message(data.message || data.answer);
          return;
        }
        if (data.sender_type === "Human Agent") {
          var _nickname = data.sender_name || "Support Agent";
          typewrite_message("human-agent", data.message || data.answer, null, _nickname);
          return;
        }
        if (data.response_type === "message_held") {
          append_system_message(data.message || data.answer);
          return;
        }
        if (data.response_type === "escalation_resolved") {
          append_system_message(data.message || data.answer);
          unlock_input();
          return;
        }
        if (data.response_type === "faq_answer") {
          typewrite_message("agent", data.message || data.answer, null, _rt_agent_lbl, function() {
            var _rem = data.faq_questions || [];
            if (_rem.length)
              render_faq_chips(_rem);
          });
          return;
        }
        var _rt_offer = data.identity_verification_offer;
        var _rt_email_offer = data.email_followup_offer;
        var _rt_gap_name = data.gap_name || null;
        var _rt_faq = data.faq_questions || [];
        var _rt_related = data.correlated_questions || [];
        var _rt_debug = data.debug_info || null;
        typewrite_message("agent", data.message || data.answer, null, _rt_agent_lbl, function() {
          if (_rt_offer && !is_desk()) {
            render_identity_verification_prompt();
          }
          if (_rt_email_offer && _rt_gap_name && !is_desk()) {
            render_email_followup_prompt(_rt_gap_name);
          }
          if (_rt_faq.length) {
            render_faq_chips(_rt_faq);
          }
          if (_rt_related.length && (!is_desk() || S.show_correlated_on_desk)) {
            render_related_question_chips(_rt_related);
          }
          if (_rt_debug) {
            render_debug_panel(_rt_debug);
          }
        });
      });
      frappe.realtime.on("nexus_chat_typing", function(data) {
        if (data && data.conversation_id === S.conversation_id) {
          show_typing();
        }
      });
    }
    function toggle_panel() {
      if (S.open) {
        close_panel();
      } else {
        open_panel();
      }
    }
    function open_panel() {
      S.open = true;
      el("ncw-panel").style.display = "flex";
      el("ncw-bubble").style.display = "none";
      clear_unread();
      if (!S.conversation_id) {
        var session = _conv_resume();
        if (session) {
          if (!S.tenant && session.tenant)
            S.tenant = session.tenant;
          if (!S.channel && session.channel)
            S.channel = session.channel;
          S.conversation_id = session.id;
          _subscribe_to_conversation(session.id);
          resume_visitor_conversation(session.id);
        } else {
          start_new_chat();
        }
      } else {
        el("ncw-input").focus();
      }
    }
    function close_panel() {
      S.open = false;
      el("ncw-panel").classList.remove("ncw-maximised");
      el("ncw-panel").style.display = "none";
      el("ncw-bubble").style.display = "flex";
      _update_max_icon();
    }
    async function close_widget() {
      if (!global.confirm("Close this chat? The current conversation will end."))
        return;
      var close_btn = el("ncw-close-btn");
      close_btn.disabled = true;
      S.close_requested = true;
      try {
        var caller_token = _conv_caller_token();
        var waiting_for_start = S.starting;
        if (S.conversation_id && !S.locked && caller_token) {
          await api("digitz_ai_nexus_live.api.live.close_chat", {
            conversation_id: S.conversation_id,
            caller_token,
            widget_code: S.widget_code || ""
          });
        }
        reset_after_visitor_close();
        if (!waiting_for_start)
          S.close_requested = false;
      } catch (err) {
        S.close_requested = false;
        close_btn.disabled = false;
        append_error(err && err.message || "Could not close the chat. Please try again.");
      }
    }
    function reset_after_visitor_close() {
      _conv_close();
      hide_typing();
      reset_messages();
      S.open = false;
      S.sending = false;
      S.conversation_id = null;
      S.visitor_email = null;
      S.identity_verification_challenge = null;
      clear_unread();
      unlock_input();
      el("ncw-input").value = "";
      el("ncw-input").style.height = "auto";
      el("ncw-panel").classList.remove("ncw-maximised");
      el("ncw-panel").style.display = "none";
      el("ncw-bubble").style.display = "flex";
      el("ncw-close-btn").disabled = false;
      _update_max_icon();
    }
    function toggle_maximise() {
      el("ncw-panel").classList.toggle("ncw-maximised");
      _update_max_icon();
      scroll_bottom();
    }
    function mark_unread() {
      S.unread_count += 1;
      const badge = el("ncw-badge");
      const bubble = el("ncw-bubble");
      if (badge) {
        badge.textContent = S.unread_count > 9 ? "9+" : String(S.unread_count);
        badge.style.display = "flex";
      }
      if (bubble) {
        bubble.classList.add("ncw-has-unread");
        bubble.setAttribute(
          "aria-label",
          `Open chat, ${S.unread_count} unread message${S.unread_count === 1 ? "" : "s"}`
        );
      }
      if (S.unread_count === 1)
        S.title_before_unread = document.title;
      const base_title = S.title_before_unread || document.title;
      document.title = `(${S.unread_count}) New message - ${base_title}`;
    }
    function clear_unread() {
      S.unread_count = 0;
      const badge = el("ncw-badge");
      const bubble = el("ncw-bubble");
      if (badge) {
        badge.textContent = "";
        badge.style.display = "none";
      }
      if (bubble) {
        bubble.classList.remove("ncw-has-unread");
        bubble.setAttribute("aria-label", "Open chat");
      }
      if (S.title_before_unread !== null) {
        document.title = S.title_before_unread;
        S.title_before_unread = null;
      }
    }
    var NCW_FONT_STEPS = [13.5, 16, 18, 20];
    var NCW_FONT_LABELS = ["A", "A", "A", "A"];
    function _load_font_size() {
      try {
        return parseFloat(localStorage.getItem("ncw_fs2") || "13.5") || 13.5;
      } catch (_) {
        return 13.5;
      }
    }
    function _save_font_size(px) {
      try {
        localStorage.setItem("ncw_fs2", String(px));
      } catch (_) {
      }
    }
    function _apply_font_size(px) {
      var root = el("ncw-root");
      if (!root)
        return;
      var valid = NCW_FONT_STEPS.indexOf(px) !== -1 ? px : 13.5;
      root.style.setProperty("--ncw-fs", valid + "px");
      var btn = el("ncw-font-btn");
      if (btn) {
        btn.style.fontSize = Math.max(valid - 2, 10) + "px";
        btn.title = "Text size: " + valid + "px (click to increase)";
      }
    }
    function cycle_font_size() {
      var cur = _load_font_size();
      var idx = NCW_FONT_STEPS.indexOf(cur);
      var next = NCW_FONT_STEPS[(idx + 1) % NCW_FONT_STEPS.length];
      _save_font_size(next);
      _apply_font_size(next);
      scroll_bottom();
    }
    function _update_max_icon() {
      const is_max = el("ncw-panel").classList.contains("ncw-maximised");
      el("ncw-max-btn").setAttribute("aria-label", is_max ? "Restore" : "Maximise");
      el("ncw-max-btn").innerHTML = is_max ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
                <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
               </svg>` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
               </svg>`;
    }
    function public_open(conversation_id) {
      if (!S.ready) {
        init();
      }
      if (conversation_id && conversation_id !== S.conversation_id) {
        S.conversation_id = conversation_id;
        S.locked = false;
        reset_messages();
        set_header("Loading\u2026", "");
        _subscribe_to_conversation(conversation_id);
        load_conversation(conversation_id);
      }
      S.open = true;
      el("ncw-panel").style.display = "flex";
      el("ncw-bubble").style.display = "none";
      clear_unread();
    }
    function public_close() {
      close_panel();
    }
    async function start_new_chat() {
      S.starting = true;
      reset_messages();
      set_header("Connecting\u2026", "");
      set_input_placeholder("Please wait\u2026");
      S.visitor_email = null;
      S.identity_verification_challenge = null;
      if (!S.tenant) {
        await resolve_tenant();
      }
      const pending_id = _generate_conversation_id();
      S.conversation_id = pending_id;
      _subscribe_to_conversation(pending_id);
      show_typing();
      try {
        const base = { tenant: S.tenant, channel: S.channel, conversation_id: pending_id };
        if (is_desk()) {
          delete base.channel;
        } else {
          base.roles = ["Guest"];
          if (S.widget_code)
            base.widget_code = S.widget_code;
        }
        const r = await api("digitz_ai_nexus_live.api.live.start_chat", {
          payload: JSON.stringify(base)
        });
        S.starting = false;
        const data = r.message || {};
        if (data.status === "service_paused") {
          hide_typing();
          S.conversation_id = null;
          append_system_message(data.message || "This service is temporarily paused. Please try again later.");
          lock_input("Service temporarily paused.");
          return;
        }
        hide_typing();
        if (!data.conversation_id) {
          S.conversation_id = null;
          append_error("Could not start chat. Please try again.");
          return;
        }
        if (data.conversation_id !== pending_id) {
          S.conversation_id = data.conversation_id;
          _subscribe_to_conversation(data.conversation_id);
        }
        S.agent_instance = data.agent_instance || null;
        S.agent_name = data.agent_name || null;
        S.show_correlated_on_desk = !!data.show_correlated_on_desk;
        set_header(S.agent_name || "AI Assistant", "AI Assistant \xB7 Online");
        set_input_placeholder("Type a message\u2026");
        _conv_save(data.caller_token || null);
        if (S.close_requested) {
          try {
            await api("digitz_ai_nexus_live.api.live.close_chat", {
              conversation_id: data.conversation_id,
              caller_token: data.caller_token || _conv_caller_token(),
              widget_code: S.widget_code || ""
            });
          } catch (_) {
          }
          reset_after_visitor_close();
          S.close_requested = false;
          return;
        }
        const initial = data.initial_messages || [];
        initial.forEach(function(msg) {
          var _lbl = msg.agent_name || S.agent_name || null;
          if (msg.response_type === "category_picker") {
            var _i_cats = msg.categories || [];
            typewrite_message("agent", msg.message || msg.answer, null, _lbl, function() {
              render_category_picker(_i_cats);
            });
          } else if (msg.message || msg.answer) {
            var _i_offer = msg.identity_verification_offer;
            typewrite_message("agent", msg.message || msg.answer, null, _lbl, function() {
              if (_i_offer && !is_desk())
                render_identity_verification_prompt();
            });
          }
        });
      } catch (_) {
        S.starting = false;
        S.close_requested = false;
        hide_typing();
        S.conversation_id = null;
        set_header("Unavailable", "");
        append_error("Could not connect. Please refresh and try again.");
        lock_input("Could not connect.");
      }
    }
    async function load_conversation(conversation_id) {
      try {
        const r = await api("digitz_ai_nexus_live.api.live.get_conversation_detail", {
          conversation_id
        });
        const data = r.message || {};
        const conversation = data.conversation || {};
        const messages = data.messages || [];
        const visitor_label = conversation.visitor_name || conversation.visitor_email || conversation.resolved_identity_type || "Visitor";
        const sub = [conversation.chat_category, "#" + conversation_id].filter(Boolean).join(" \xB7 ");
        set_header(visitor_label, sub);
        reset_messages();
        messages.forEach(function(m) {
          const side = m.sender_type === "Visitor" || m.sender_type === "User" ? "visitor" : m.sender_type === "Human Agent" ? "human-agent" : m.sender_type === "System" ? "system" : "agent";
          append_message(side, m.message, m.message_time);
        });
        if (conversation.status === "Closed") {
          lock_input("This conversation is closed.");
        } else {
          unlock_input();
          el("ncw-input").focus();
        }
      } catch (_) {
        append_error("Could not load conversation.");
      }
    }
    async function resume_visitor_conversation(conversation_id) {
      reset_messages();
      set_header("Reconnecting\u2026", "");
      set_input_placeholder("Please wait\u2026");
      try {
        var _stored_token = null;
        try {
          var _raw = localStorage.getItem(_CONV_KEY);
          if (_raw)
            _stored_token = (JSON.parse(_raw) || {}).caller_token || null;
        } catch (_) {
        }
        const r = await api("digitz_ai_nexus_live.api.live.get_conversation_detail", {
          conversation_id,
          caller_token: _stored_token
        });
        const data = r.message || {};
        const conversation = data.conversation || {};
        const messages = data.messages || [];
        if (!conversation.name) {
          _conv_close();
          S.conversation_id = null;
          start_new_chat();
          return;
        }
        if (conversation.status === "Closed") {
          _conv_close();
          S.conversation_id = null;
          start_new_chat();
          return;
        }
        const agent_name = conversation.agent_name || S.agent_name || "AI Assistant";
        set_header(agent_name, "AI Assistant \xB7 Online");
        set_input_placeholder("Type a message\u2026");
        reset_messages();
        messages.forEach(function(m) {
          const side = m.sender_type === "Visitor" || m.sender_type === "User" ? "visitor" : m.sender_type === "Human Agent" ? "human-agent" : m.sender_type === "System" ? "system" : "agent";
          append_message(side, m.message, m.message_time);
        });
        unlock_input();
        el("ncw-input").focus();
        _conv_touch();
      } catch (_) {
        _conv_close();
        S.conversation_id = null;
        start_new_chat();
      }
    }
    async function resolve_tenant() {
      try {
        const r = await api(
          "digitz_ai_nexus_live.api.live.get_widget_tenant",
          {}
        );
        S.tenant = ((r.message || {}).tenant || {}).name || null;
      } catch (_) {
      }
    }
    async function send_message() {
      if (S.locked || S.sending)
        return;
      const input = el("ncw-input");
      const message = input.value.trim();
      if (!message || !S.conversation_id)
        return;
      input.value = "";
      input.style.height = "auto";
      el("ncw-messages").querySelectorAll(".ncw-related-strip, .ncw-faq-strip").forEach(function(s) {
        s.remove();
      });
      append_message("visitor", message);
      show_typing();
      S.sending = true;
      _subscribe_to_conversation(S.conversation_id);
      try {
        const msg_payload = { message, tenant: S.tenant };
        if (S.visitor_email)
          msg_payload.visitor_email = S.visitor_email;
        if (S.identity_verification_challenge)
          msg_payload.identity_verification_challenge = S.identity_verification_challenge;
        if (!is_desk() && S.widget_code)
          msg_payload.widget_code = S.widget_code;
        await api("digitz_ai_nexus_live.api.live.send_chat_message", {
          conversation_id: S.conversation_id,
          payload: JSON.stringify(msg_payload)
        });
        _conv_touch();
      } catch (_) {
        hide_typing();
        append_error("Failed to send. Please try again.");
      } finally {
        S.sending = false;
      }
    }
    function render_category_picker(categories) {
      const msgs = el("ncw-messages");
      const picker = document.createElement("div");
      picker.className = "ncw-category-picker";
      categories.forEach(function(c) {
        const btn = document.createElement("button");
        btn.className = "ncw-cat-btn";
        btn.dataset.code = c.category_code;
        btn.innerHTML = '<span class="ncw-cat-label">' + escape_html(c.category_label || c.category_code) + "</span>" + (c.description ? '<span class="ncw-cat-desc">' + escape_html(c.description) + "</span>" : "");
        btn.addEventListener("click", function() {
          select_category(c.category_code, c.category_label || c.category_code, c.faq_questions || []);
        });
        picker.appendChild(btn);
      });
      msgs.appendChild(picker);
      scroll_bottom();
    }
    async function select_category(code, label, faq_questions) {
      el("ncw-messages").querySelectorAll(".ncw-category-picker").forEach(function(p) {
        p.remove();
      });
      const chip = document.createElement("div");
      chip.className = "ncw-msg ncw-msg-visitor";
      chip.innerHTML = '<div class="ncw-bubble ncw-bubble-category">' + escape_html(label) + "</div>";
      el("ncw-messages").appendChild(chip);
      scroll_bottom();
      if (faq_questions && faq_questions.length) {
        render_faq_chips(faq_questions);
      }
      show_typing();
      S.sending = true;
      try {
        const cat_payload = { message: "__cat__:" + code, tenant: S.tenant };
        if (!is_desk() && S.widget_code)
          cat_payload.widget_code = S.widget_code;
        await api("digitz_ai_nexus_live.api.live.send_chat_message", {
          conversation_id: S.conversation_id,
          payload: JSON.stringify(cat_payload)
        });
        _conv_touch();
      } catch (_) {
        hide_typing();
        append_error("Could not select category. Please try again.");
      } finally {
        S.sending = false;
      }
    }
    function render_faq_chips(faqs) {
      if (!faqs || !faqs.length)
        return;
      const msgs = el("ncw-messages");
      msgs.querySelectorAll(".ncw-faq-strip:not(.ncw-related-strip)").forEach(function(s) {
        s.remove();
      });
      const strip = document.createElement("div");
      strip.className = "ncw-faq-strip";
      const lbl = document.createElement("div");
      lbl.className = "ncw-faq-label";
      lbl.textContent = "Quick questions:";
      strip.appendChild(lbl);
      const chips = document.createElement("div");
      chips.className = "ncw-faq-chips";
      faqs.forEach(function(faq) {
        const btn = document.createElement("button");
        btn.className = "ncw-faq-chip";
        btn.textContent = faq.question;
        btn.addEventListener("click", function() {
          strip.remove();
          select_faq(faq.name, faq.question);
        });
        chips.appendChild(btn);
      });
      strip.appendChild(chips);
      msgs.appendChild(strip);
      scroll_bottom();
    }
    async function select_faq(faq_name, question) {
      const bubble = document.createElement("div");
      bubble.className = "ncw-msg ncw-msg-visitor";
      bubble.innerHTML = '<div class="ncw-bubble">' + escape_html(question) + "</div>";
      el("ncw-messages").appendChild(bubble);
      scroll_bottom();
      show_typing();
      S.sending = true;
      try {
        const faq_payload = { message: "__faq__:" + faq_name, tenant: S.tenant };
        if (!is_desk() && S.widget_code)
          faq_payload.widget_code = S.widget_code;
        await api("digitz_ai_nexus_live.api.live.send_chat_message", {
          conversation_id: S.conversation_id,
          payload: JSON.stringify(faq_payload)
        });
      } catch (_) {
        hide_typing();
        append_error("Could not load answer. Please try again.");
      } finally {
        S.sending = false;
      }
    }
    function render_related_question_chips(questions) {
      if (!questions || !questions.length)
        return;
      const msgs = el("ncw-messages");
      msgs.querySelectorAll(".ncw-related-strip").forEach(function(s) {
        s.remove();
      });
      const strip = document.createElement("div");
      strip.className = "ncw-related-strip";
      const lbl = document.createElement("div");
      lbl.className = "ncw-related-label";
      lbl.textContent = "People also ask:";
      strip.appendChild(lbl);
      const chips = document.createElement("div");
      chips.className = "ncw-related-chips";
      questions.forEach(function(item) {
        const question = typeof item === "string" ? item : item.question;
        if (!question)
          return;
        const btn = document.createElement("button");
        btn.className = "ncw-related-chip";
        btn.textContent = question;
        btn.addEventListener("click", function() {
          strip.remove();
          send_suggested_question(question);
        });
        chips.appendChild(btn);
      });
      if (!chips.childNodes.length)
        return;
      strip.appendChild(chips);
      msgs.appendChild(strip);
      scroll_bottom();
    }
    function send_suggested_question(question) {
      if (!question || S.locked || S.sending)
        return;
      const input = el("ncw-input");
      input.value = question;
      input.style.height = "auto";
      send_message();
    }
    function render_identity_verification_prompt() {
      const msgs = el("ncw-messages");
      const prompt = document.createElement("div");
      prompt.className = "ncw-verify-prompt";
      prompt.innerHTML = '<div class="ncw-verify-label">Enter your email to verify your identity:</div><div class="ncw-verify-row"><input type="email" class="ncw-verify-input" id="ncw-verify-email" placeholder="your@email.com" autocomplete="email"><button class="ncw-verify-btn" id="ncw-verify-email-btn">Send Code</button></div><div class="ncw-verify-msg" id="ncw-verify-email-msg" style="display:none;"></div>';
      msgs.appendChild(prompt);
      scroll_bottom();
      document.getElementById("ncw-verify-email-btn").addEventListener("click", function() {
        submit_email_for_verification(prompt);
      });
      document.getElementById("ncw-verify-email").addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
          e.preventDefault();
          submit_email_for_verification(prompt);
        }
      });
      document.getElementById("ncw-verify-email").focus();
    }
    function render_email_followup_prompt(gap_name) {
      var uid = "ncw-efp-" + Date.now();
      var msgs = el("ncw-messages");
      var card = document.createElement("div");
      card.className = "ncw-verify-prompt";
      var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (S.visitor_email && EMAIL_RE.test(S.visitor_email)) {
        msgs.appendChild(card);
        show_known_email_step(S.visitor_email);
        return;
      }
      function show_known_email_step(email) {
        card.innerHTML = `<div class="ncw-verify-label">We'll notify you at <strong>` + escape_html(email) + '</strong> when we have this information. Would you like to proceed?</div><div style="margin-top:10px;display:flex;gap:8px;align-items:center;"><button class="ncw-verify-btn" id="' + uid + '-confirm">Yes, notify me</button><button class="ncw-verify-skip" id="' + uid + '-skip-k" style="background:none;border:none;color:#888;font-size:12px;cursor:pointer;padding:0;">No thanks</button></div><div class="ncw-verify-msg" id="' + uid + '-k-msg" style="display:none;"></div>';
        scroll_bottom();
        var confirm_btn = document.getElementById(uid + "-confirm");
        var k_msg = document.getElementById(uid + "-k-msg");
        confirm_btn.addEventListener("click", function() {
          confirm_btn.disabled = true;
          confirm_btn.textContent = "Saving\u2026";
          api("digitz_ai_nexus.api.knowledge_gap.submit_gap_visitor_email", {
            gap_name,
            email,
            conversation_id: S.conversation_id || ""
          }).then(function() {
            card.innerHTML = `<div class="ncw-verify-msg ncw-verify-success">&#10003; Noted. We'll notify <strong>` + escape_html(email) + "</strong> once we have this covered.</div>";
            scroll_bottom();
          }).catch(function(err) {
            confirm_btn.disabled = false;
            confirm_btn.textContent = "Yes, notify me";
            k_msg.className = "ncw-verify-msg ncw-verify-error";
            k_msg.textContent = err && err.message || "Something went wrong. Please try again.";
            k_msg.style.display = "";
          });
        });
        document.getElementById(uid + "-skip-k").addEventListener("click", function() {
          card.style.display = "none";
        });
      }
      function show_email_step() {
        card.innerHTML = '<div class="ncw-verify-label">Would you like to be notified by email when this information is available?</div><div class="ncw-verify-row"><input type="email" class="ncw-verify-input" id="' + uid + '-email" placeholder="your@email.com" autocomplete="email"><button class="ncw-verify-btn" id="' + uid + '-send" disabled>Send Code</button></div><div class="ncw-verify-msg" id="' + uid + '-email-msg" style="display:none;"></div><div style="margin-top:6px;"><button class="ncw-verify-skip" id="' + uid + '-skip1" style="background:none;border:none;color:#888;font-size:12px;cursor:pointer;padding:0;">No thanks</button></div>';
        scroll_bottom();
        var email_input = document.getElementById(uid + "-email");
        var send_btn = document.getElementById(uid + "-send");
        var email_msg = document.getElementById(uid + "-email-msg");
        email_input.addEventListener("input", function() {
          var val = email_input.value.trim();
          if (!val) {
            email_msg.style.display = "none";
            send_btn.disabled = true;
          } else if (!EMAIL_RE.test(val)) {
            email_msg.className = "ncw-verify-msg ncw-verify-error";
            email_msg.textContent = "Please enter a valid email address.";
            email_msg.style.display = "";
            send_btn.disabled = true;
          } else {
            email_msg.style.display = "none";
            send_btn.disabled = false;
          }
        });
        function do_send() {
          var email = email_input.value.trim();
          if (!EMAIL_RE.test(email))
            return;
          send_btn.disabled = true;
          send_btn.textContent = "Sending\u2026";
          email_msg.style.display = "none";
          api(
            "digitz_ai_nexus.api.knowledge_gap.request_gap_email_otp",
            {
              gap_name,
              email,
              conversation_id: S.conversation_id || ""
            }
          ).then(function(r) {
            var d = r.message || {};
            show_otp_step(email, d.challenge_token);
          }).catch(function(err) {
            send_btn.disabled = false;
            send_btn.textContent = "Send Code";
            email_msg.className = "ncw-verify-msg ncw-verify-error";
            email_msg.textContent = err && err.message || "Could not send code. Please try again.";
            email_msg.style.display = "";
          });
        }
        send_btn.addEventListener("click", do_send);
        email_input.addEventListener("keydown", function(e) {
          if (e.key === "Enter" && !send_btn.disabled) {
            e.preventDefault();
            do_send();
          }
        });
        document.getElementById(uid + "-skip1").addEventListener("click", function() {
          card.style.display = "none";
        });
        email_input.focus();
      }
      function show_otp_step(email, challenge_token) {
        card.innerHTML = '<div class="ncw-verify-label">A code was sent to <strong>' + escape_html(email) + `</strong>. Enter it below:</div><div class="ncw-verify-spam-note">Didn't receive it? Check your <strong>spam or junk</strong> folder.</div><div class="ncw-verify-row"><input type="text" class="ncw-verify-input" id="` + uid + '-otp" placeholder="6-digit code" maxlength="6" inputmode="numeric" autocomplete="one-time-code"><button class="ncw-verify-btn" id="' + uid + '-verify">Verify</button></div><div class="ncw-verify-msg" id="' + uid + '-otp-msg" style="display:none;"></div><div style="margin-top:6px;"><button class="ncw-verify-skip" id="' + uid + '-skip2" style="background:none;border:none;color:#888;font-size:12px;cursor:pointer;padding:0;">No thanks</button></div>';
        scroll_bottom();
        var otp_input = document.getElementById(uid + "-otp");
        var verify_btn = document.getElementById(uid + "-verify");
        var otp_msg = document.getElementById(uid + "-otp-msg");
        function do_verify() {
          var otp = otp_input.value.trim();
          if (!otp)
            return;
          verify_btn.disabled = true;
          verify_btn.textContent = "Verifying\u2026";
          otp_msg.style.display = "none";
          api(
            "digitz_ai_nexus.api.knowledge_gap.verify_gap_email_otp",
            {
              gap_name,
              challenge_token,
              otp,
              conversation_id: S.conversation_id || ""
            }
          ).then(function(r) {
            var verified_email = (r.message || {}).email || email;
            card.innerHTML = `<div class="ncw-verify-msg ncw-verify-success">&#10003; Email verified. We'll notify <strong>` + escape_html(verified_email) + "</strong> once we have this covered.</div>";
            scroll_bottom();
          }).catch(function(err) {
            verify_btn.disabled = false;
            verify_btn.textContent = "Verify";
            otp_msg.className = "ncw-verify-msg ncw-verify-error";
            otp_msg.textContent = err && err.message || "Invalid code. Please try again.";
            otp_msg.style.display = "";
          });
        }
        verify_btn.addEventListener("click", do_verify);
        otp_input.addEventListener("keydown", function(e) {
          if (e.key === "Enter") {
            e.preventDefault();
            do_verify();
          }
        });
        document.getElementById(uid + "-skip2").addEventListener("click", function() {
          card.style.display = "none";
        });
        otp_input.focus();
      }
      msgs.appendChild(card);
      show_email_step();
    }
    async function submit_email_for_verification(prompt_el) {
      const email_input = document.getElementById("ncw-verify-email");
      const email = (email_input ? email_input.value : "").trim();
      const msg_el = document.getElementById("ncw-verify-email-msg");
      const btn = document.getElementById("ncw-verify-email-btn");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg_el.className = "ncw-verify-msg ncw-verify-error";
        msg_el.textContent = "Please enter a valid email address.";
        msg_el.style.display = "";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Sending\u2026";
      msg_el.style.display = "none";
      try {
        const r = await api(
          "digitz_ai_nexus_live.api.identity_verification.request_identity_verification",
          { conversation_id: S.conversation_id, email }
        );
        const data = r.message || {};
        S.visitor_email = email;
        if (data.required === 0) {
          prompt_el.innerHTML = '<div class="ncw-verify-msg ncw-verify-success">\u2713 Email noted. You can continue the conversation.</div>';
          scroll_bottom();
          return;
        }
        const challenge_token = data.challenge_token;
        prompt_el.innerHTML = '<div class="ncw-verify-label">A code was sent to <strong>' + escape_html(email) + `</strong>. Enter it below:</div><div class="ncw-verify-spam-note">Didn't receive it? Check your <strong>spam or junk</strong> folder.</div><div class="ncw-verify-row"><input type="text" class="ncw-verify-input" id="ncw-verify-otp" placeholder="6-digit code" maxlength="6" inputmode="numeric" autocomplete="one-time-code"><button class="ncw-verify-btn" id="ncw-verify-otp-btn">Verify</button></div><div class="ncw-verify-msg" id="ncw-verify-otp-msg" style="display:none;"></div>`;
        scroll_bottom();
        document.getElementById("ncw-verify-otp-btn").addEventListener("click", function() {
          submit_otp_verification(prompt_el, challenge_token);
        });
        document.getElementById("ncw-verify-otp").addEventListener("keydown", function(e) {
          if (e.key === "Enter") {
            e.preventDefault();
            submit_otp_verification(prompt_el, challenge_token);
          }
        });
        document.getElementById("ncw-verify-otp").focus();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Send Code";
        msg_el.className = "ncw-verify-msg ncw-verify-error";
        msg_el.textContent = err && err.message || "Could not send code. Please try again.";
        msg_el.style.display = "";
      }
    }
    async function submit_otp_verification(prompt_el, challenge_token) {
      const otp_input = document.getElementById("ncw-verify-otp");
      const otp = (otp_input ? otp_input.value : "").trim();
      const msg_el = document.getElementById("ncw-verify-otp-msg");
      const btn = document.getElementById("ncw-verify-otp-btn");
      if (!otp) {
        msg_el.className = "ncw-verify-msg ncw-verify-error";
        msg_el.textContent = "Please enter the verification code.";
        msg_el.style.display = "";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Verifying\u2026";
      msg_el.style.display = "none";
      try {
        const r = await api(
          "digitz_ai_nexus_live.api.identity_verification.verify_identity_verification",
          { challenge_token, otp }
        );
        const data = r.message || {};
        if (data.status === "verified") {
          S.identity_verification_challenge = data.challenge_token;
          S.visitor_email = data.email || S.visitor_email;
          prompt_el.innerHTML = '<div class="ncw-verify-msg ncw-verify-success">\u2713 Identity verified as <strong>' + escape_html(data.identity_type || "Verified") + "</strong>. Your next message will use your verified access.</div>";
          scroll_bottom();
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Verify";
        msg_el.className = "ncw-verify-msg ncw-verify-error";
        msg_el.textContent = err && err.message || "Invalid code. Please try again.";
        msg_el.style.display = "";
      }
    }
    function append_message(side, text2, time, sender_label) {
      const msgs = el("ncw-messages");
      const div = document.createElement("div");
      div.className = "ncw-msg ncw-msg-" + side;
      const label_html = sender_label ? '<div class="ncw-sender-label">' + escape_html(sender_label) + "</div>" : "";
      const is_agent = side === "agent" || side === "human-agent";
      div.innerHTML = label_html + '<div class="ncw-bubble">' + format_message(text2, is_agent) + "</div>" + (time ? '<div class="ncw-time">' + fmt_time(time) + "</div>" : "");
      msgs.appendChild(div);
      scroll_bottom();
    }
    function append_system_message(text2) {
      const msgs = el("ncw-messages");
      const div = document.createElement("div");
      div.className = "ncw-msg ncw-msg-system";
      div.innerHTML = '<div class="ncw-bubble-system">' + escape_html(text2 || "") + "</div>";
      msgs.appendChild(div);
      scroll_bottom();
    }
    function append_error(text2) {
      const msgs = el("ncw-messages");
      const div = document.createElement("div");
      div.className = "ncw-msg ncw-msg-error";
      div.innerHTML = '<div class="ncw-bubble ncw-bubble-error">' + escape_html(text2) + "</div>";
      msgs.appendChild(div);
      scroll_bottom();
    }
    function render_debug_panel(dbg) {
      if (!dbg)
        return;
      const msgs = el("ncw-messages");
      const wrap = document.createElement("div");
      wrap.className = "ncw-msg ncw-debug-panel-wrap";
      var policies = (dbg.allowed_access_policies || []).join(", ") || "(none)";
      var features = dbg.features || {};
      var qf = dbg.question_first || {};
      var status_color = {
        "allowed": "#276749",
        "no_context": "#c05621",
        "low_confidence": "#744210",
        "restricted": "#c53030"
      }[dbg.access_status] || "#4a5568";
      var chunks_html = "";
      if (dbg.top_chunks && dbg.top_chunks.length) {
        chunks_html = '<table class="ncw-debug-table"><thead><tr><th>Chunk</th><th>Score</th><th>Vector</th><th>Keyword</th><th>Policy</th></tr></thead><tbody>';
        dbg.top_chunks.forEach(function(c) {
          chunks_html += '<tr><td title="' + escape_html(c.chunk || "") + '">' + escape_html((c.title || c.chunk || "").substring(0, 40)) + "</td><td>" + (c.score || 0).toFixed(4) + "</td><td>" + (c.vector_score || 0).toFixed(4) + "</td><td>" + (c.keyword_score || 0).toFixed(4) + "</td><td>" + escape_html(c.access_policy || "") + "</td></tr>";
        });
        chunks_html += "</tbody></table>";
      } else {
        chunks_html = "<em>No chunks retrieved.</em>";
      }
      var id = "ncw-dbg-" + Date.now();
      wrap.innerHTML = `<div class="ncw-debug-toggle" onclick="var b=document.getElementById('` + id + `');b.style.display=b.style.display==='none'?'block':'none'">&#x1F50D; Retrieval Debug <span style="font-size:10px;color:#888">(System Manager)</span></div><div id="` + id + '" class="ncw-debug-body" style="display:none"><div class="ncw-debug-row"><span class="ncw-debug-label">Access Status</span><span class="ncw-debug-val" style="color:' + status_color + ';font-weight:600">' + escape_html(dbg.access_status || "") + '</span></div><div class="ncw-debug-row"><span class="ncw-debug-label">Access Cap</span><span class="ncw-debug-val">' + escape_html(dbg.access_cap_applied || "") + '</span></div><div class="ncw-debug-row"><span class="ncw-debug-label">Allowed Policies</span><span class="ncw-debug-val ncw-debug-policies">' + escape_html(policies) + '</span></div><div class="ncw-debug-row"><span class="ncw-debug-label">Candidates</span><span class="ncw-debug-val">Total: ' + (dbg.original_candidate_count || 0) + " \u2192 Scored: " + (dbg.allowed_count || 0) + " \u2192 Final: " + (dbg.final_result_count || 0) + '</span></div><div class="ncw-debug-row"><span class="ncw-debug-label">Confidence</span><span class="ncw-debug-val">' + (dbg.confidence || 0).toFixed(4) + (dbg.fallback_used ? ' <em style="color:#c05621">(fallback)</em>' : "") + '</span></div><div class="ncw-debug-row"><span class="ncw-debug-label">Question-First</span><span class="ncw-debug-val">' + (qf.applied ? "Applied (" + (qf.match_count || 0) + " matches)" : "Not applied") + '</span></div><div class="ncw-debug-row"><span class="ncw-debug-label">Features</span><span class="ncw-debug-val">' + ["multi_query", "reranking", "semantic_index", "context_summary"].filter(function(k) {
        return features[k];
      }).join(", ") || '(none)</span></div><div class="ncw-debug-section-title">Top Retrieved Chunks</div>' + chunks_html + "</div>";
      msgs.appendChild(wrap);
      scroll_bottom();
    }
    function reset_messages() {
      _tw_generation++;
      _tw_queue = [];
      _tw_running = false;
      el("ncw-messages").innerHTML = "";
    }
    function show_typing() {
      el("ncw-typing").style.display = "flex";
      scroll_bottom();
    }
    function hide_typing() {
      el("ncw-typing").style.display = "none";
    }
    var _tw_queue = [];
    var _tw_running = false;
    var _tw_generation = 0;
    function typewrite_message(side, text2, time, sender_label, on_done) {
      var is_agent_side = side === "agent" || side === "human-agent";
      if (!is_agent_side) {
        append_message(side, text2, time, sender_label);
        if (on_done)
          on_done();
        return;
      }
      _tw_queue.push({ side, text: text2 || "", time, sender_label, on_done });
      if (!_tw_running)
        _tw_drain();
    }
    function _tw_drain() {
      if (!_tw_queue.length) {
        _tw_running = false;
        return;
      }
      _tw_running = true;
      var job = _tw_queue.shift();
      _tw_run(job, _tw_drain);
    }
    function _tw_run(job, next) {
      var generation = _tw_generation;
      var msgs = el("ncw-messages");
      var div = document.createElement("div");
      div.className = "ncw-msg ncw-msg-" + job.side;
      var label_html = job.sender_label ? '<div class="ncw-sender-label">' + escape_html(job.sender_label) + "</div>" : "";
      div.innerHTML = label_html + '<div class="ncw-bubble ncw-tw"></div>' + (job.time ? '<div class="ncw-time">' + fmt_time(job.time) + "</div>" : "");
      msgs.appendChild(div);
      scroll_bottom();
      var bubble = div.querySelector(".ncw-bubble");
      var raw = job.text.trim();
      var words = raw.split(/\s+/).filter(Boolean);
      var is_agent = job.side === "agent" || job.side === "human-agent";
      var base_ms = Math.max(80, Math.min(140, 3500 / Math.max(words.length, 1)));
      var idx = 0;
      var built = "";
      function tick() {
        if (generation !== _tw_generation)
          return;
        if (idx >= words.length) {
          bubble.classList.remove("ncw-tw");
          bubble.innerHTML = format_message(raw, is_agent);
          scroll_bottom();
          if (job.on_done)
            job.on_done();
          next();
          return;
        }
        built += (built ? " " : "") + words[idx];
        bubble.textContent = built;
        var word = words[idx];
        idx++;
        scroll_bottom();
        var jitter = Math.floor(Math.random() * 60) - 15;
        var pause = /[.!?]$/.test(word) ? 180 : /[,;:]$/.test(word) ? 80 : 0;
        setTimeout(tick, base_ms + jitter + pause);
      }
      tick();
    }
    function lock_input(reason) {
      S.locked = true;
      _conv_close();
      const input = el("ncw-input");
      input.disabled = true;
      input.placeholder = reason || "Conversation closed";
      el("ncw-send-btn").disabled = true;
      el("ncw-input-bar").classList.add("ncw-locked");
      const bar = el("ncw-closed-bar");
      bar.textContent = reason || "Conversation closed";
      bar.style.display = "block";
    }
    function unlock_input() {
      S.locked = false;
      const input = el("ncw-input");
      input.disabled = false;
      input.placeholder = "Type a message\u2026";
      el("ncw-send-btn").disabled = false;
      el("ncw-input-bar").classList.remove("ncw-locked");
      el("ncw-closed-bar").style.display = "none";
    }
    function set_input_placeholder(ph) {
      el("ncw-input").placeholder = ph;
    }
    function set_header(title, sub) {
      text("ncw-htitle", title || "AI Assistant");
      text("ncw-hsub", sub || "");
    }
    function scroll_bottom() {
      const msgs = el("ncw-messages");
      if (msgs)
        msgs.scrollTop = msgs.scrollHeight;
    }
    function inject_styles() {
      if (el("ncw-styles"))
        return;
      const s = document.createElement("style");
      s.id = "ncw-styles";
      s.textContent = `
/* \u2500\u2500 Root (fixed overlay) \u2500\u2500 */
#ncw-root {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --ncw-fs: 13.5px;
    font-size: var(--ncw-fs);
    line-height: 1.4;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
}

/* \u2500\u2500 Bubble \u2500\u2500 */
#ncw-bubble {
    width: 64px;
    height: 64px;
    border-radius: 18px;
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 4px 16px rgba(23, 67, 157, 0.50));
    transition: transform 0.2s ease, filter 0.2s ease;
    position: relative;
    flex-shrink: 0;
    padding: 0;
}
#ncw-bubble:hover {
    transform: scale(1.08);
    filter: drop-shadow(0 6px 22px rgba(23, 67, 157, 0.65));
}
#ncw-bubble.ncw-has-unread {
    animation: ncw-unread-pulse 1.4s ease-in-out infinite;
}
@keyframes ncw-unread-pulse {
    0%, 100% { transform: scale(1); filter: drop-shadow(0 4px 16px rgba(23, 67, 157, 0.50)); }
    50% { transform: scale(1.08); filter: drop-shadow(0 6px 24px rgba(229, 62, 62, 0.62)); }
}
#ncw-bubble img {
    width: 60px;
    height: 60px;
    border-radius: 14px;
    display: block;
}
#ncw-badge {
    position: absolute;
    top: 0;
    right: 0;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    background: #e53e3e;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* \u2500\u2500 Tooltip \u2500\u2500 */
#ncw-tooltip {
    display: none;
    opacity: 0;
    transform: translateX(12px);
    transition: opacity 0.28s ease, transform 0.28s ease;
    position: absolute;
    bottom: 76px;
    right: 0;
    width: 260px;
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 8px 32px rgba(23,67,157,0.18), 0 1px 4px rgba(0,0,0,0.08);
    border: 1px solid rgba(33,88,199,0.12);
    flex-direction: column;
    overflow: hidden;
}
#ncw-tooltip::after {
    content: '';
    position: absolute;
    bottom: -8px;
    right: 20px;
    width: 16px;
    height: 8px;
    background: #fff;
    clip-path: polygon(0 0, 100% 0, 50% 100%);
    filter: drop-shadow(0 2px 2px rgba(23,67,157,0.10));
}
#ncw-tooltip-kicker {
    background: linear-gradient(135deg, #0b2b72 0%, #2158c7 60%, #16A37F 100%);
    color: #fff;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    padding: 8px 14px 7px;
}
#ncw-tooltip-body {
    font-size: 12.5px;
    line-height: 1.55;
    color: #1a2540;
    padding: 10px 14px 4px;
    margin: 0;
}
#ncw-tooltip-cta {
    margin: 8px 14px 12px;
    padding: 7px 14px;
    background: linear-gradient(90deg, #2158c7, #16A37F);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    transition: opacity 0.15s;
    align-self: flex-start;
}
#ncw-tooltip-cta:hover { opacity: 0.88; }
#ncw-tooltip-dismiss {
    position: absolute;
    top: 6px;
    right: 8px;
    background: none;
    border: none;
    color: rgba(255,255,255,0.7);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 4px;
}
#ncw-tooltip-dismiss:hover { color: #fff; }

/* \u2500\u2500 Panel \u2500\u2500 */
#ncw-panel {
    width: 400px;
    height: 580px;
    background: #fff;
    border-radius: 18px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.18);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: ncw-pop 0.22s cubic-bezier(0.34,1.56,0.64,1);
}
@keyframes ncw-pop {
    from { opacity: 0; transform: scale(0.88) translateY(16px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);     }
}

/* \u2500\u2500 Header \u2500\u2500 */
#ncw-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    background: linear-gradient(135deg, #2158c7 0%, #1a47aa 100%);
    flex-shrink: 0;
}
#ncw-avatar {
    width: 38px;
    height: 38px;
    border-radius: 9px;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}
#ncw-avatar img {
    width: 38px;
    height: 38px;
    display: block;
    border-radius: 8px;
}
#ncw-hinfo {
    flex: 1;
    min-width: 0;
}
#ncw-htitle {
    color: #fff;
    font-weight: 700;
    font-size: var(--ncw-fs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
#ncw-hsub {
    color: rgba(255,255,255,0.75);
    font-size: calc(var(--ncw-fs) - 2.5px);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
}
#ncw-font-btn, #ncw-max-btn, #ncw-min-btn, #ncw-close-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    background: rgba(255,255,255,0.15);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;
}
#ncw-font-btn:hover, #ncw-max-btn:hover, #ncw-min-btn:hover, #ncw-close-btn:hover { background: rgba(255,255,255,0.28); }
#ncw-max-btn svg, #ncw-min-btn svg, #ncw-close-btn svg {
    width: 14px;
    height: 14px;
    stroke: #fff;
}
#ncw-font-btn {
    color: #fff;
    font-weight: 800;
    font-size: 12px;
    line-height: 1;
    letter-spacing: -0.5px;
    transition: background 0.15s, font-size 0.15s;
}

/* \u2500\u2500 WhatsApp connect strip \u2500\u2500 */
#ncw-wa-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    background: linear-gradient(90deg, #1a9e4a 0%, #22c35e 60%, #1db954 100%);
    flex-shrink: 0;
    cursor: pointer;
    border-bottom: 1px solid rgba(0,0,0,.10);
    transition: filter .15s;
}
#ncw-wa-strip:hover { filter: brightness(1.06); }
#ncw-wa-icon {
    flex-shrink: 0;
    color: #fff;
    opacity: .92;
}
#ncw-wa-text {
    flex: 1;
    font-size: 11.5px;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: .01em;
}
#ncw-wa-arrow {
    font-size: 13px;
    font-weight: 700;
    color: rgba(255,255,255,.80);
    flex-shrink: 0;
}
#ncw-wa-dismiss {
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 50%;
    background: rgba(0,0,0,.15);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 15px;
    line-height: 1;
    flex-shrink: 0;
    padding: 0;
    transition: background .15s;
}
#ncw-wa-dismiss:hover { background: rgba(0,0,0,.28); }
#ncw-wa-info {
    display: none;
    align-items: flex-start;
    gap: 9px;
    padding: 10px 14px;
    background: #f0fdf4;
    border-bottom: 1px solid #bbf7d0;
    font-size: 11.5px;
    line-height: 1.55;
    color: #166534;
    font-weight: 500;
    flex-shrink: 0;
}

/* \u2500\u2500 Maximised panel \u2500\u2500 */
#ncw-panel.ncw-maximised {
    width: 50vw;
    height: 80vh;
    bottom: 24px;
    right: 24px;
    border-radius: 14px;
    transition: width 0.22s ease, height 0.22s ease;
}
@media (max-width: 768px) {
    #ncw-panel.ncw-maximised {
        width: calc(100vw - 24px);
        height: 80vh;
    }
}

/* \u2500\u2500 Messages \u2500\u2500 */
#ncw-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px 14px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    scroll-behavior: smooth;
}
#ncw-messages::-webkit-scrollbar { width: 4px; }
#ncw-messages::-webkit-scrollbar-thumb {
    background: #d1dce8;
    border-radius: 4px;
}

/* \u2500\u2500 Message bubbles \u2500\u2500 */
.ncw-msg {
    display: flex;
    flex-direction: column;
    max-width: 80%;
}
.ncw-msg-agent        { align-self: flex-start; }
.ncw-msg-visitor      { align-self: flex-end; }
.ncw-msg-error        { align-self: center; }
.ncw-msg-human-agent  { align-self: flex-start; }
.ncw-msg-system       { align-self: center; max-width: 90%; }

.ncw-bubble {
    padding: 9px 13px;
    border-radius: 16px;
    font-size: var(--ncw-fs);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
}
.ncw-msg-agent .ncw-bubble,
.ncw-msg-human-agent .ncw-bubble {
    white-space: normal;
}
.ncw-bubble p {
    margin: 0 0 0.55em 0;
}
.ncw-bubble p:last-child {
    margin-bottom: 0;
}
.ncw-msg-agent .ncw-bubble {
    background: #f0f4ff;
    color: #1a2942;
    border-bottom-left-radius: 4px;
}
.ncw-msg-visitor .ncw-bubble {
    background: #2158c7;
    color: #fff;
    border-bottom-right-radius: 4px;
}
.ncw-msg-human-agent .ncw-bubble {
    background: #f0fff8;
    color: #1a2942;
    border-bottom-left-radius: 4px;
    border: 1px solid #c6f6d5;
}
.ncw-sender-label {
    font-size: 10px;
    font-weight: 700;
    color: #2158c7;
    margin-bottom: 2px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
}
.ncw-msg-human-agent .ncw-sender-label {
    color: #276749;
}
.ncw-bubble-system {
    background: #fefcbf;
    color: #744210;
    border-radius: 8px;
    padding: 7px 12px;
    font-size: calc(var(--ncw-fs) - 2px);
    font-style: italic;
    text-align: center;
}
.ncw-bubble-error {
    background: #fff5f5;
    color: #c53030;
    border: 1px solid #fed7d7;
    border-radius: 8px;
    font-size: calc(var(--ncw-fs) - 1.5px);
}
.ncw-bubble-category {
    background: rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.4);
    font-size: calc(var(--ncw-fs) - 1.5px);
    font-style: italic;
}
.ncw-time {
    font-size: 10px;
    color: #a0aec0;
    margin-top: 2px;
}
.ncw-msg-visitor .ncw-time { text-align: right; }

/* \u2500\u2500 Typing indicator \u2500\u2500 */
#ncw-typing {
    padding: 6px 14px 4px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
}
#ncw-typing-dots {
    display: flex;
    gap: 4px;
    align-items: center;
    background: #f0f4ff;
    padding: 8px 12px;
    border-radius: 16px;
    border-bottom-left-radius: 4px;
}
#ncw-typing-dots span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #2158c7;
    opacity: 0.45;
    animation: ncw-bounce 1.2s infinite ease-in-out;
}
#ncw-typing-dots span:nth-child(1) { animation-delay: 0s;    }
#ncw-typing-dots span:nth-child(2) { animation-delay: 0.18s; }
#ncw-typing-dots span:nth-child(3) { animation-delay: 0.36s; }
@keyframes ncw-bounce {
    0%, 60%, 100% { transform: translateY(0);    opacity: 0.45; }
    30%            { transform: translateY(-5px); opacity: 1;    }
}

/* \u2500\u2500 Typewriter cursor \u2500\u2500 */
.ncw-bubble.ncw-tw::after {
    content: '|';
    display: inline;
    animation: ncw-cursor-blink 0.65s step-end infinite;
}
@keyframes ncw-cursor-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
}

/* \u2500\u2500 Category picker \u2500\u2500 */
.ncw-category-picker {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin: 4px 0;
}
.ncw-cat-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 14px;
    border: 1.5px solid #c7d9f5;
    border-radius: 12px;
    background: #fff;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, background 0.15s;
}
.ncw-cat-btn:hover {
    border-color: #2158c7;
    background: #f0f4ff;
}
.ncw-cat-label {
    font-weight: 600;
    font-size: var(--ncw-fs);
    color: #1a2942;
}
.ncw-cat-desc {
    font-size: calc(var(--ncw-fs) - 2.5px);
    color: #718096;
    line-height: 1.35;
}

/* \u2500\u2500 FAQ quick-question chips \u2500\u2500 */
.ncw-faq-strip {
    padding: 4px 10px 8px;
}
.ncw-faq-label {
    font-size: calc(var(--ncw-fs) - 3px);
    color: #8fa3bf;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
}
.ncw-faq-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.ncw-faq-chip {
    background: #f0f4fa;
    border: 1px solid #c8d8ee;
    border-radius: 16px;
    padding: 5px 12px;
    font-size: calc(var(--ncw-fs) - 1.5px);
    color: #2a4a7f;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    text-align: left;
    line-height: 1.35;
}
.ncw-faq-chip:hover {
    background: #ddeaf8;
    border-color: #a0bcdf;
}

/* \u2500\u2500 Correlated question chips (People also ask) \u2500\u2500 */
.ncw-related-strip {
    padding: 4px 10px 8px;
}
.ncw-related-label {
    font-size: calc(var(--ncw-fs) - 3px);
    color: #8a7bbf;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
}
.ncw-related-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.ncw-related-chip {
    background: #f4f1fc;
    border: 1px solid #cbbfef;
    border-radius: 16px;
    padding: 5px 12px;
    font-size: calc(var(--ncw-fs) - 1.5px);
    color: #3d2d7f;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    text-align: left;
    line-height: 1.35;
}
.ncw-related-chip:hover {
    background: #e8e2f8;
    border-color: #a899df;
}

/* \u2500\u2500 Identity verification prompt \u2500\u2500 */
.ncw-verify-prompt {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 4px 0;
    padding: 12px 14px;
    background: #f0f4ff;
    border: 1.5px solid #c7d9f5;
    border-radius: 14px;
    max-width: 90%;
    align-self: flex-start;
}
.ncw-verify-label {
    font-size: calc(var(--ncw-fs) - 2px);
    color: #4a6085;
    font-weight: 500;
    line-height: 1.4;
}
.ncw-verify-label strong { color: #1a2942; }
.ncw-verify-spam-note {
    font-size: calc(var(--ncw-fs) - 3px);
    color: #7a8fa8;
    margin-top: 4px;
    margin-bottom: 6px;
    line-height: 1.4;
}
.ncw-verify-spam-note strong { color: #4a6085; }
.ncw-verify-row {
    display: flex;
    gap: 7px;
}
.ncw-verify-input {
    flex: 1;
    min-width: 0;
    border: 1.5px solid #c7d9f5;
    border-radius: 9px;
    padding: 6px 10px;
    font-size: calc(var(--ncw-fs) - 1px);
    outline: none;
    font-family: inherit;
    background: #fff;
    color: #1a2942;
    transition: border-color 0.15s;
}
.ncw-verify-input:focus { border-color: #2158c7; }
.ncw-verify-btn {
    padding: 6px 13px;
    background: #2158c7;
    color: #fff;
    border: none;
    border-radius: 9px;
    font-size: calc(var(--ncw-fs) - 1.5px);
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
}
.ncw-verify-btn:hover    { background: #1a47aa; }
.ncw-verify-btn:disabled { background: #c0cde0; cursor: not-allowed; }
.ncw-verify-msg {
    font-size: calc(var(--ncw-fs) - 2px);
    line-height: 1.35;
    margin-top: 2px;
}
.ncw-verify-error   { color: #c53030; }
.ncw-verify-success { color: #276749; font-weight: 500; }
.ncw-verify-success strong { color: #22543d; }

/* \u2500\u2500 Footer \u2500\u2500 */
#ncw-nexy-sticky {
    flex-shrink: 0;
    padding: 8px 12px 0;
    background: linear-gradient(180deg, rgba(255,255,255,0) 0%, #fff 35%);
}
#ncw-nexy-connect-btn {
    width: 100%;
    min-height: 52px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 11px;
    border: 1px solid #bfd0ff;
    border-radius: 14px;
    background: linear-gradient(135deg, #eef4ff 0%, #f4f0ff 100%);
    color: #173f94;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(33, 88, 199, 0.12);
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
#ncw-nexy-connect-btn:hover {
    transform: translateY(-1px);
    border-color: #8eabf5;
    box-shadow: 0 6px 18px rgba(33, 88, 199, 0.18);
}
#ncw-nexy-mark {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 10px;
    background: linear-gradient(135deg, #2158c7 0%, #6846c7 100%);
    color: #fff;
    font-size: 15px;
    font-weight: 800;
}
#ncw-nexy-copy {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
}
#ncw-nexy-copy strong {
    font-size: calc(var(--ncw-fs) - 0.5px);
    line-height: 1.25;
}
#ncw-nexy-copy small {
    color: #5d6f99;
    font-size: calc(var(--ncw-fs) - 3px);
    line-height: 1.25;
}
#ncw-nexy-arrow {
    flex-shrink: 0;
    color: #6846c7;
    font-size: 18px;
    font-weight: 700;
}
#ncw-footer {
    border-top: 1px solid #edf2ff;
    flex-shrink: 0;
    background: #fff;
}
#ncw-input-bar {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px;
}
#ncw-input {
    flex: 1;
    border: 1.5px solid #d1dce8;
    border-radius: 12px;
    padding: 8px 12px;
    font-size: var(--ncw-fs);
    resize: none;
    outline: none;
    font-family: inherit;
    line-height: 1.45;
    transition: border-color 0.15s;
    max-height: 100px;
    overflow-y: auto;
}
#ncw-input:focus { border-color: #2158c7; }
#ncw-input:disabled {
    background: #f7f9fc;
    color: #a0aec0;
    cursor: not-allowed;
}
#ncw-send-btn {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: #2158c7;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;
}
#ncw-send-btn:hover    { background: #1a47aa; }
#ncw-send-btn:disabled { background: #c0cde0; cursor: not-allowed; }
#ncw-send-btn svg { width: 17px; height: 17px; fill: #fff; }

.ncw-locked #ncw-input {
    background: #f7f9fc;
    border-color: #e2e8f0;
}

#ncw-closed-bar {
    font-size: calc(var(--ncw-fs) - 2.5px);
    color: #718096;
    text-align: center;
    padding: 6px 14px 10px;
    background: #f7f9fc;
    border-top: 1px solid #edf2ff;
}
#ncw-brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 12px 9px;
    font-size: 12px;
    font-weight: 600;
    color: #64748b;
    letter-spacing: 0.01em;
    background: #fff;
    border-top: 1px solid #f1f5f9;
    user-select: none;
}
#ncw-brand-spark {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    margin-top: -1px;
}
#ncw-brand-name {
    font-weight: 800;
    background: linear-gradient(90deg, #2158c7 0%, #818cf8 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    color: transparent;
}
/* \u2500\u2500 Retrieval Debug Panel \u2500\u2500 */
.ncw-debug-panel-wrap {
    align-self: stretch;
    width: 100%;
    margin: 4px 0;
}
.ncw-debug-toggle {
    font-size: 11px;
    font-weight: 600;
    color: #4a5568;
    background: #edf2f7;
    border: 1px solid #cbd5e0;
    border-radius: 6px 6px 0 0;
    padding: 5px 10px;
    cursor: pointer;
    user-select: none;
}
.ncw-debug-toggle:hover { background: #e2e8f0; }
.ncw-debug-body {
    background: #f7fafc;
    border: 1px solid #cbd5e0;
    border-top: none;
    border-radius: 0 0 6px 6px;
    padding: 8px 10px;
    font-size: 11px;
    color: #2d3748;
    font-family: monospace;
}
.ncw-debug-row {
    display: flex;
    gap: 6px;
    margin-bottom: 4px;
    align-items: flex-start;
    flex-wrap: wrap;
}
.ncw-debug-label {
    font-weight: 700;
    color: #718096;
    min-width: 120px;
    flex-shrink: 0;
}
.ncw-debug-val { color: #1a202c; word-break: break-all; }
.ncw-debug-policies { color: #2b6cb0; word-break: break-all; }
.ncw-debug-section-title {
    font-weight: 700;
    color: #4a5568;
    margin: 8px 0 4px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.ncw-debug-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
}
.ncw-debug-table th {
    background: #e2e8f0;
    padding: 3px 5px;
    text-align: left;
    font-weight: 700;
    color: #4a5568;
}
.ncw-debug-table td {
    padding: 3px 5px;
    border-bottom: 1px solid #edf2f7;
    color: #2d3748;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
        `;
      document.head.appendChild(s);
    }
    function init() {
      if (S.ready)
        return;
      S.ready = true;
      build_dom();
    }
    global.NexusChatWidget = {
      init,
      open: public_open,
      close: public_close
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })(window);
})();
//# sourceMappingURL=nexus_chat_widget.bundle.4I6MA5GO.js.map

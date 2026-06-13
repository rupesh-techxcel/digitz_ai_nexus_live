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
      locked: false,
      sending: false,
      tenant: cfg.tenant || null,
      channel: cfg.channel || null,
      _realtime_bound: false,
      visitor_email: null,
      identity_verification_challenge: null
    };
    function is_desk() {
      return !!(global.frappe && frappe.boot && frappe.boot.user && frappe.boot.user.name && frappe.boot.user.name !== "Guest");
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
        frappe.call({
          method,
          args: args || {},
          callback: function(r) {
            resolve(r);
          },
          error: function(e) {
            reject(e);
          }
        });
      });
    }
    function build_dom() {
      if (el("ncw-root"))
        return;
      const root = document.createElement("div");
      root.id = "ncw-root";
      root.innerHTML = `
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
                    <button id="ncw-min-btn" aria-label="Minimise">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                    </button>
                </div>

                <div id="ncw-messages"></div>

                <div id="ncw-typing" style="display:none;">
                    <div id="ncw-typing-dots">
                        <span></span><span></span><span></span>
                    </div>
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
      if (frappe && frappe.realtime && frappe.realtime.socket) {
        S._realtime_bound = true;
        bind_realtime();
        return;
      }
      var _on_app_ready = function() {
        if (S._realtime_bound)
          return;
        S._realtime_bound = true;
        bind_realtime();
        if (typeof $ !== "undefined") {
          $(document).off("app_ready", _on_app_ready);
        }
      };
      if (typeof $ !== "undefined") {
        $(document).on("app_ready", _on_app_ready);
      } else {
        setTimeout(function() {
          if (!S._realtime_bound && frappe && frappe.realtime && frappe.realtime.socket) {
            S._realtime_bound = true;
            bind_realtime();
          }
        }, 500);
      }
    }
    function bind_ui_events() {
      el("ncw-bubble").addEventListener("click", toggle_panel);
      el("ncw-min-btn").addEventListener("click", close_panel);
      el("ncw-send-btn").addEventListener("click", send_message);
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
    }
    function bind_realtime() {
      frappe.realtime.on("nexus_chat_response", function(data) {
        if (!data || data.conversation_id !== S.conversation_id)
          return;
        hide_typing();
        if (data.status === "error") {
          append_error(data.error || "An error occurred.");
          return;
        }
        if (data.response_type === "category_picker") {
          append_message("agent", data.message || data.answer);
          render_category_picker(data.categories || []);
          return;
        }
        if (data.status === "closed" || data.response_type === "conversation_closed") {
          append_message("agent", data.message || data.answer);
          lock_input("This conversation is closed. Start a new chat to continue.");
          return;
        }
        if (data.sender_type === "Human Agent") {
          const nickname = data.sender_name || "Support Agent";
          append_message("human-agent", data.message || data.answer, null, nickname);
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
        append_message("agent", data.message || data.answer);
        if (data.identity_verification_offer && !is_desk()) {
          render_identity_verification_prompt();
        }
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
      if (!S.conversation_id) {
        start_new_chat();
      } else {
        el("ncw-input").focus();
      }
    }
    function close_panel() {
      S.open = false;
      el("ncw-panel").style.display = "none";
      el("ncw-bubble").style.display = "flex";
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
        load_conversation(conversation_id);
      }
      S.open = true;
      el("ncw-panel").style.display = "flex";
      el("ncw-bubble").style.display = "none";
    }
    function public_close() {
      close_panel();
    }
    async function start_new_chat() {
      reset_messages();
      set_header("Connecting\u2026", "");
      set_input_placeholder("Please wait\u2026");
      S.visitor_email = null;
      S.identity_verification_challenge = null;
      if (!S.tenant) {
        await resolve_tenant();
      }
      try {
        const base = { tenant: S.tenant, channel: S.channel };
        if (is_desk()) {
          delete base.channel;
        } else {
          base.roles = ["Guest"];
        }
        const r = await api("digitz_ai_nexus_live.api.live.start_chat", {
          payload: JSON.stringify(base)
        });
        const data = r.message || {};
        if (!data.conversation_id) {
          append_error("Could not start chat. Please try again.");
          return;
        }
        S.conversation_id = data.conversation_id;
        S.agent_instance = data.agent_instance || null;
        set_header(data.agent_name || "AI Assistant", "");
        set_input_placeholder("Type a message\u2026");
        if (data.greeting) {
          append_message("agent", data.greeting);
        }
      } catch (_) {
        append_error("Could not connect. Please refresh and try again.");
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
    async function resolve_tenant() {
      try {
        const r = await api(
          "digitz_ai_nexus.api.nexus_administration.get_administration_snapshot",
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
      append_message("visitor", message);
      show_typing();
      S.sending = true;
      try {
        const msg_payload = { message, tenant: S.tenant };
        if (S.visitor_email)
          msg_payload.visitor_email = S.visitor_email;
        if (S.identity_verification_challenge)
          msg_payload.identity_verification_challenge = S.identity_verification_challenge;
        await api("digitz_ai_nexus_live.api.live.send_chat_message", {
          conversation_id: S.conversation_id,
          payload: JSON.stringify(msg_payload)
        });
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
          select_category(c.category_code, c.category_label || c.category_code);
        });
        picker.appendChild(btn);
      });
      msgs.appendChild(picker);
      scroll_bottom();
    }
    async function select_category(code, label) {
      el("ncw-messages").querySelectorAll(".ncw-category-picker").forEach(function(p) {
        p.remove();
      });
      const chip = document.createElement("div");
      chip.className = "ncw-msg ncw-msg-visitor";
      chip.innerHTML = '<div class="ncw-bubble ncw-bubble-category">' + escape_html(label) + "</div>";
      el("ncw-messages").appendChild(chip);
      scroll_bottom();
      show_typing();
      S.sending = true;
      try {
        await api("digitz_ai_nexus_live.api.live.send_chat_message", {
          conversation_id: S.conversation_id,
          payload: JSON.stringify({
            message: "__cat__:" + code,
            tenant: S.tenant
          })
        });
      } catch (_) {
        hide_typing();
        append_error("Could not select category. Please try again.");
      } finally {
        S.sending = false;
      }
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
        prompt_el.innerHTML = '<div class="ncw-verify-label">A code was sent to <strong>' + escape_html(email) + '</strong>. Enter it below:</div><div class="ncw-verify-row"><input type="text" class="ncw-verify-input" id="ncw-verify-otp" placeholder="6-digit code" maxlength="6" inputmode="numeric" autocomplete="one-time-code"><button class="ncw-verify-btn" id="ncw-verify-otp-btn">Verify</button></div><div class="ncw-verify-msg" id="ncw-verify-otp-msg" style="display:none;"></div>';
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
    function reset_messages() {
      el("ncw-messages").innerHTML = "";
    }
    function show_typing() {
      el("ncw-typing").style.display = "flex";
      scroll_bottom();
    }
    function hide_typing() {
      el("ncw-typing").style.display = "none";
    }
    function lock_input(reason) {
      S.locked = true;
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
    font-size: 14px;
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
    width: 18px;
    height: 18px;
    background: #e53e3e;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* \u2500\u2500 Panel \u2500\u2500 */
#ncw-panel {
    width: 360px;
    height: 520px;
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
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
#ncw-hsub {
    color: rgba(255,255,255,0.75);
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
}
#ncw-min-btn {
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
#ncw-min-btn:hover { background: rgba(255,255,255,0.28); }
#ncw-min-btn svg {
    width: 14px;
    height: 14px;
    stroke: #fff;
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
    font-size: 13.5px;
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
    color: #276749;
    margin-bottom: 2px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
}
.ncw-bubble-system {
    background: #fefcbf;
    color: #744210;
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 12px;
    font-style: italic;
    text-align: center;
}
.ncw-bubble-error {
    background: #fff5f5;
    color: #c53030;
    border: 1px solid #fed7d7;
    border-radius: 8px;
    font-size: 12.5px;
}
.ncw-bubble-category {
    background: rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.4);
    font-size: 12.5px;
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
    font-size: 13px;
    color: #1a2942;
}
.ncw-cat-desc {
    font-size: 11.5px;
    color: #718096;
    line-height: 1.35;
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
    font-size: 12px;
    color: #4a6085;
    font-weight: 500;
    line-height: 1.4;
}
.ncw-verify-label strong { color: #1a2942; }
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
    font-size: 13px;
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
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
}
.ncw-verify-btn:hover    { background: #1a47aa; }
.ncw-verify-btn:disabled { background: #c0cde0; cursor: not-allowed; }
.ncw-verify-msg {
    font-size: 12px;
    line-height: 1.35;
    margin-top: 2px;
}
.ncw-verify-error   { color: #c53030; }
.ncw-verify-success { color: #276749; font-weight: 500; }
.ncw-verify-success strong { color: #22543d; }

/* \u2500\u2500 Footer \u2500\u2500 */
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
    font-size: 13.5px;
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
    font-size: 11.5px;
    color: #718096;
    text-align: center;
    padding: 6px 14px 10px;
    background: #f7f9fc;
    border-top: 1px solid #edf2ff;
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
//# sourceMappingURL=nexus_chat_widget.bundle.HIGTFU2J.js.map

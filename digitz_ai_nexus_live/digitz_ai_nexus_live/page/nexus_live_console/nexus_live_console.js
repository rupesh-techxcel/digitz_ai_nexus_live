frappe.pages['nexus_live_console'].on_page_load = function(wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Nexus Live Console',
		single_column: true,
	});

	const console = new NexusLiveConsole(page, wrapper);
	console.init();
};


class NexusLiveConsole {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = $(wrapper);
		this.body = $(page.body);
		this.active_conversation_id = null;
		this.is_new_chat = false;
		this.refresh_interval = null;
		this.active_tenant = null;
	}

	async init() {
		this.inject_styles();
		this.render_layout();
		this.bind_realtime();
		await Promise.all([
			this.load_tenant_context(),
			this.load_conversations(),
		]);
		this.start_polling();
	}

	async load_tenant_context() {
		try {
			const r = await frappe.call({
				method: 'digitz_ai_nexus.api.nexus_administration.get_administration_snapshot',
			});
			const data = r.message || {};
			this.active_tenant = (data.tenant || {}).name || null;
		} catch(e) {
			console.warn('Could not load tenant context for chat', e);
		}
	}

	// ─── Layout ────────────────────────────────────────────────────────────────

	render_layout() {
		this.body.html(`
			<div class="nlc-root">
				<div class="nlc-sidebar">
					<div class="nlc-sidebar-header">
						<span class="nlc-sidebar-title">Active Conversations</span>
						<div class="nlc-sidebar-actions">
							<button class="nlc-new-chat-btn" title="Start New Chat">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>
									<line x1="12" y1="10" x2="12" y2="14"/>
									<line x1="10" y1="12" x2="14" y2="12"/>
								</svg>
							</button>
							<button class="nlc-refresh-btn" title="Refresh">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<polyline points="23 4 23 10 17 10"/>
									<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
								</svg>
							</button>
						</div>
					</div>
					<div class="nlc-conversation-list"></div>
				</div>

				<div class="nlc-main">
					<div class="nlc-empty-state">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>
						</svg>
						<p>Select a conversation to view messages</p>
					</div>

					<div class="nlc-chat-panel" style="display:none;">
						<div class="nlc-chat-header">
							<div class="nlc-chat-meta">
								<div class="nlc-chat-id"></div>
								<div class="nlc-chat-info"></div>
							</div>
							<div class="nlc-chat-status-badge"></div>
						</div>

						<div class="nlc-messages"></div>

						<div class="nlc-typing-indicator" style="display:none;">
							<span></span><span></span><span></span>
						</div>

						<div class="nlc-input-bar">
							<textarea
								class="nlc-input"
								placeholder="Type a message…"
								rows="1"
							></textarea>
							<button class="nlc-send-btn">
								<svg viewBox="0 0 24 24" fill="currentColor">
									<path d="M2 21l21-9L2 3v7l15 2-15 2z"/>
								</svg>
							</button>
						</div>
					</div>
				</div>
			</div>
		`);

		this.bind_events();
	}

	bind_events() {
		const me = this;

		this.body.on('click', '.nlc-refresh-btn', () => this.load_conversations());

		this.body.on('click', '.nlc-new-chat-btn', () => this.open_new_chat_panel());

		this.body.on('click', '.nlc-conversation-item', function() {
			const id = $(this).data('conversation-id');
			me.open_conversation(id);
		});

		this.body.on('click', '.nlc-send-btn', () => this.send_message());

		this.body.on('keydown', '.nlc-input', function(e) {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				me.send_message();
			}
		});

		this.body.on('input', '.nlc-input', function() {
			this.style.height = 'auto';
			this.style.height = Math.min(this.scrollHeight, 120) + 'px';
		});
	}

	// ─── Realtime ──────────────────────────────────────────────────────────────

	bind_realtime() {
		const me = this;

		frappe.realtime.on('nexus_chat_response', function(data) {
			if (!data || !data.conversation_id) return;

			me.hide_typing();

			if (data.conversation_id === me.active_conversation_id) {
				if (data.status === 'error') {
					me.append_error_message(data.error || 'An error occurred.');
				} else {
					me.append_message({
						sender_type: 'AI Agent',
						message: data.message || data.answer,
						confidence: data.confidence,
						message_time: new Date().toISOString(),
					});
				}
			}

			// Refresh sidebar to update last_message / status
			me.load_conversations();
		});

		frappe.realtime.on('nexus_chat_typing', function(data) {
			if (data && data.conversation_id === me.active_conversation_id) {
				me.show_typing();
			}
		});
	}

	// ─── Conversation List ─────────────────────────────────────────────────────

	async load_conversations() {
		try {
			const r = await frappe.call({
				method: 'digitz_ai_nexus_live.api.live.get_active_conversations',
			});

			const conversations = (r.message || {}).conversations || [];
			this.render_conversation_list(conversations);
		} catch(e) {
			console.error('Failed to load conversations', e);
		}
	}

	render_conversation_list(conversations) {
		const list = this.body.find('.nlc-conversation-list');

		if (!conversations.length) {
			list.html('<div class="nlc-list-empty">No active conversations</div>');
			return;
		}

		list.html(conversations.map(c => this.conversation_item_html(c)).join(''));

		if (this.active_conversation_id) {
			list.find(`[data-conversation-id="${this.active_conversation_id}"]`).addClass('active');
		}
	}

	conversation_item_html(c) {
		const status_class = (c.status || '').toLowerCase().replace(' ', '-');
		const label = c.visitor_name || c.visitor_email || c.resolved_identity_type || 'Visitor';
		const preview = c.last_message
			? c.last_message.substring(0, 60) + (c.last_message.length > 60 ? '…' : '')
			: 'No messages yet';
		const time = c.started_on
			? frappe.datetime.prettyDate(c.started_on)
			: '';

		return `
			<div class="nlc-conversation-item ${c.conversation_id === this.active_conversation_id ? 'active' : ''}"
				data-conversation-id="${c.conversation_id}">
				<div class="nlc-item-top">
					<span class="nlc-item-label">${frappe.utils.escape_html(label)}</span>
					<span class="nlc-item-time">${time}</span>
				</div>
				<div class="nlc-item-preview">${frappe.utils.escape_html(preview)}</div>
				<div class="nlc-item-footer">
					<span class="nlc-status-dot ${status_class}"></span>
					<span class="nlc-item-status">${c.status}</span>
					${c.escalation_status && c.escalation_status !== 'None'
						? `<span class="nlc-escalation-tag">${c.escalation_status}</span>`
						: ''}
				</div>
			</div>
		`;
	}

	// ─── Open Conversation ─────────────────────────────────────────────────────

	async open_conversation(conversation_id) {
		this.active_conversation_id = conversation_id;
		this.is_new_chat = false;

		this.body.find('.nlc-conversation-item').removeClass('active');
		this.body.find(`[data-conversation-id="${conversation_id}"]`).addClass('active');

		this.body.find('.nlc-empty-state').hide();
		this.body.find('.nlc-chat-panel').show();
		this.body.find('.nlc-messages').html('<div class="nlc-loading">Loading…</div>');

		try {
			const r = await frappe.call({
				method: 'digitz_ai_nexus_live.api.live.get_conversation_detail',
				args: { conversation_id },
			});

			const data = r.message || {};
			this.render_chat_panel(data.conversation || {}, data.messages || []);
		} catch(e) {
			this.body.find('.nlc-messages').html('<div class="nlc-error">Failed to load conversation.</div>');
		}
	}

	render_chat_panel(conversation, messages) {
		const status_class = (conversation.status || '').toLowerCase().replace(' ', '-');
		const visitor = conversation.visitor_name || conversation.visitor_email || 'Visitor';

		this.body.find('.nlc-chat-id').text(`#${conversation.conversation_id}`);
		this.body.find('.nlc-chat-info').text(
			[visitor, conversation.channel, conversation.chat_category]
				.filter(Boolean).join(' · ')
		);
		this.body.find('.nlc-chat-status-badge')
			.attr('class', `nlc-chat-status-badge nlc-badge-${status_class}`)
			.text(conversation.status);

		const msg_container = this.body.find('.nlc-messages');
		msg_container.empty();

		messages.forEach(m => this.append_message(m, false));
		this.scroll_to_bottom();
	}

	// ─── Messages ─────────────────────────────────────────────────────────────

	append_message(msg, scroll = true) {
		const is_agent = msg.sender_type === 'AI Agent' || msg.sender_type === 'Human Agent';
		const side = is_agent ? 'agent' : 'visitor';

		const confidence_html = (msg.confidence != null && is_agent)
			? `<span class="nlc-confidence">${Math.round(msg.confidence * 100)}%</span>`
			: '';

		const time = msg.message_time
			? frappe.datetime.str_to_user(msg.message_time, true)
			: '';

		const bubble = $(`
			<div class="nlc-msg nlc-msg-${side}">
				<div class="nlc-bubble">
					${frappe.utils.escape_html(msg.message || '')}
				</div>
				<div class="nlc-msg-meta">
					${is_agent ? `<span class="nlc-sender">${msg.sender_type}</span>` : ''}
					${confidence_html}
					<span class="nlc-time">${time}</span>
				</div>
			</div>
		`);

		this.body.find('.nlc-messages').append(bubble);

		if (scroll) this.scroll_to_bottom();
	}

	append_error_message(text) {
		const el = $(`
			<div class="nlc-msg nlc-msg-error">
				<div class="nlc-bubble nlc-bubble-error">${frappe.utils.escape_html(text)}</div>
			</div>
		`);
		this.body.find('.nlc-messages').append(el);
		this.scroll_to_bottom();
	}

	show_typing() {
		this.body.find('.nlc-typing-indicator').show();
		this.scroll_to_bottom();
	}

	hide_typing() {
		this.body.find('.nlc-typing-indicator').hide();
	}

	scroll_to_bottom() {
		const el = this.body.find('.nlc-messages')[0];
		if (el) el.scrollTop = el.scrollHeight;
	}

	// ─── Send Message ──────────────────────────────────────────────────────────

	async send_message() {
		const input = this.body.find('.nlc-input');
		const message = input.val().trim();

		if (!message) return;
		if (!this.active_conversation_id && !this.is_new_chat) return;

		input.val('').css('height', 'auto');

		this.append_message({
			sender_type: 'User',
			message,
			message_time: new Date().toISOString(),
		});

		this.show_typing();

		if (this.is_new_chat) {
			await this.call_start_chat(message);
		} else {
			try {
				await frappe.call({
					method: 'digitz_ai_nexus_live.api.live.send_chat_message',
					args: {
						conversation_id: this.active_conversation_id,
						payload: JSON.stringify({ message, tenant: this.active_tenant }),
					},
				});
				// Response arrives via nexus_chat_response realtime event
			} catch(e) {
				this.hide_typing();
				this.append_error_message('Failed to send message. Please try again.');
			}
		}
	}

	// ─── New Chat ─────────────────────────────────────────────────────────────

	open_new_chat_panel() {
		this.active_conversation_id = null;
		this.is_new_chat = true;

		this.body.find('.nlc-conversation-item').removeClass('active');
		this.body.find('.nlc-empty-state').hide();
		this.body.find('.nlc-chat-panel').show();
		this.body.find('.nlc-messages').empty();

		this.body.find('.nlc-chat-id').text('New Chat');
		this.body.find('.nlc-chat-info').text(frappe.session.user);
		this.body.find('.nlc-chat-status-badge')
			.attr('class', 'nlc-chat-status-badge nlc-badge-new')
			.text('Ready');

		this.body.find('.nlc-input').focus();
	}

	async call_start_chat(message) {
		if (!this.active_tenant) {
			this.hide_typing();
			this.append_error_message('No active tenant found. Please configure a tenant in Nexus Administration first.');
			this.is_new_chat = true;
			return;
		}

		try {
			const r = await frappe.call({
				method: 'digitz_ai_nexus_live.api.live.start_chat',
				args: { payload: JSON.stringify({ message, tenant: this.active_tenant }) },
			});

			const data = r.message || {};

			if (data.conversation_id) {
				this.active_conversation_id = data.conversation_id;
				this.is_new_chat = false;

				this.body.find('.nlc-chat-id').text('#' + data.conversation_id);
				this.body.find('.nlc-chat-info').text(
					[data.agent_name, frappe.session.user].filter(Boolean).join(' · ')
				);
				this.body.find('.nlc-chat-status-badge')
					.attr('class', 'nlc-chat-status-badge nlc-badge-responding')
					.text('Responding');

				// Conversation will appear in sidebar on next poll
				this.load_conversations();
			}
		} catch(e) {
			this.hide_typing();
			this.append_error_message('Failed to start chat. Please try again.');
			this.is_new_chat = true;
		}
	}

	// ─── Polling ──────────────────────────────────────────────────────────────

	start_polling() {
		this.refresh_interval = setInterval(() => {
			this.load_conversations();
		}, 15000);
	}

	// ─── Styles ───────────────────────────────────────────────────────────────

	inject_styles() {
		if ($('#nlc-styles').length) return;

		$('head').append(`<style id="nlc-styles">

		.nlc-root {
			display: flex;
			height: calc(100vh - 120px);
			min-height: 500px;
			background: #f5f7fb;
			border-radius: 16px;
			overflow: hidden;
			border: 1px solid #e2e8f0;
			margin: 12px;
		}

		/* ── Sidebar ── */

		.nlc-sidebar {
			width: 300px;
			min-width: 260px;
			background: #fff;
			border-right: 1px solid #e8edf4;
			display: flex;
			flex-direction: column;
		}

		.nlc-sidebar-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 16px 18px;
			border-bottom: 1px solid #edf2ff;
		}

		.nlc-sidebar-title {
			font-size: 13px;
			font-weight: 700;
			color: #1a2942;
			letter-spacing: 0.3px;
			text-transform: uppercase;
		}

		.nlc-sidebar-actions {
			display: flex;
			align-items: center;
			gap: 4px;
		}

		.nlc-refresh-btn, .nlc-new-chat-btn {
			background: none;
			border: none;
			cursor: pointer;
			color: #8192a8;
			padding: 4px;
			border-radius: 6px;
			display: flex;
		}

		.nlc-refresh-btn:hover { background: #f0f4ff; color: #2158c7; }

		.nlc-new-chat-btn:hover { background: #e8f0ff; color: #2158c7; }

		.nlc-refresh-btn svg, .nlc-new-chat-btn svg { width: 16px; height: 16px; }

		.nlc-conversation-list {
			flex: 1;
			overflow-y: auto;
			padding: 8px 0;
		}

		.nlc-list-empty {
			padding: 24px 18px;
			color: #96a4b8;
			font-size: 13px;
			text-align: center;
		}

		.nlc-conversation-item {
			padding: 12px 18px;
			cursor: pointer;
			border-left: 3px solid transparent;
			transition: background 0.15s;
		}

		.nlc-conversation-item:hover { background: #f5f8ff; }

		.nlc-conversation-item.active {
			background: #eef3ff;
			border-left-color: #2158c7;
		}

		.nlc-item-top {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 4px;
		}

		.nlc-item-label {
			font-size: 13px;
			font-weight: 600;
			color: #1a2942;
		}

		.nlc-item-time {
			font-size: 11px;
			color: #a0aec0;
		}

		.nlc-item-preview {
			font-size: 12px;
			color: #667085;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			margin-bottom: 6px;
		}

		.nlc-item-footer {
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.nlc-status-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: #cbd5e0;
			flex-shrink: 0;
		}

		.nlc-status-dot.open { background: #48bb78; }
		.nlc-status-dot.responding { background: #2158c7; }
		.nlc-status-dot.escalated { background: #f6ad55; }

		.nlc-item-status {
			font-size: 11px;
			color: #8192a8;
			font-weight: 500;
		}

		.nlc-escalation-tag {
			font-size: 10px;
			padding: 2px 6px;
			border-radius: 999px;
			background: #fff5e6;
			color: #c05621;
			font-weight: 600;
		}

		/* ── Main panel ── */

		.nlc-main {
			flex: 1;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		.nlc-empty-state {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			color: #a0aec0;
			gap: 14px;
		}

		.nlc-empty-state svg {
			width: 56px;
			height: 56px;
			stroke: #cbd5e0;
		}

		.nlc-empty-state p {
			font-size: 14px;
		}

		/* ── Chat panel ── */

		.nlc-chat-panel {
			flex: 1;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		.nlc-chat-header {
			padding: 14px 22px;
			background: #fff;
			border-bottom: 1px solid #e8edf4;
			display: flex;
			justify-content: space-between;
			align-items: center;
			flex-shrink: 0;
		}

		.nlc-chat-id {
			font-size: 13px;
			font-weight: 700;
			color: #2158c7;
			font-family: monospace;
		}

		.nlc-chat-info {
			font-size: 12px;
			color: #667085;
			margin-top: 2px;
		}

		.nlc-chat-status-badge {
			font-size: 12px;
			font-weight: 600;
			padding: 5px 12px;
			border-radius: 999px;
		}

		.nlc-badge-open { background: #e6f9f0; color: #0f8b4c; }
		.nlc-badge-responding { background: #dce9ff; color: #2158c7; }
		.nlc-badge-escalated { background: #fff5e6; color: #c05621; }
		.nlc-badge-closed { background: #f0f4f8; color: #718096; }
		.nlc-badge-new { background: #f0fdf4; color: #166534; }

		/* ── Messages ── */

		.nlc-messages {
			flex: 1;
			overflow-y: auto;
			padding: 20px 24px;
			display: flex;
			flex-direction: column;
			gap: 14px;
			background: #f5f7fb;
		}

		.nlc-loading, .nlc-error {
			text-align: center;
			color: #a0aec0;
			font-size: 13px;
			padding: 24px;
		}

		.nlc-msg {
			display: flex;
			flex-direction: column;
			max-width: 72%;
		}

		.nlc-msg-visitor { align-self: flex-end; }
		.nlc-msg-agent { align-self: flex-start; }
		.nlc-msg-error { align-self: center; }

		.nlc-bubble {
			padding: 10px 14px;
			border-radius: 14px;
			font-size: 13.5px;
			line-height: 1.6;
			white-space: pre-wrap;
			word-break: break-word;
		}

		.nlc-msg-visitor .nlc-bubble {
			background: #2158c7;
			color: #fff;
			border-bottom-right-radius: 4px;
		}

		.nlc-msg-agent .nlc-bubble {
			background: #fff;
			color: #1a2942;
			border-bottom-left-radius: 4px;
			box-shadow: 0 2px 8px rgba(0,0,0,0.06);
		}

		.nlc-bubble-error {
			background: #fff5f5;
			color: #c53030;
			border: 1px solid #fed7d7;
			font-size: 13px;
		}

		.nlc-msg-meta {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-top: 4px;
			font-size: 11px;
			color: #a0aec0;
		}

		.nlc-msg-visitor .nlc-msg-meta { justify-content: flex-end; }

		.nlc-confidence {
			background: #eef3ff;
			color: #2158c7;
			padding: 1px 6px;
			border-radius: 999px;
			font-weight: 600;
			font-size: 10px;
		}

		/* ── Typing indicator ── */

		.nlc-typing-indicator {
			padding: 10px 24px;
			display: flex;
			gap: 4px;
			align-items: center;
		}

		.nlc-typing-indicator span {
			width: 7px;
			height: 7px;
			border-radius: 50%;
			background: #2158c7;
			opacity: 0.4;
			animation: nlc-bounce 1.2s infinite ease-in-out;
		}

		.nlc-typing-indicator span:nth-child(1) { animation-delay: 0s; }
		.nlc-typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
		.nlc-typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

		@keyframes nlc-bounce {
			0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
			30% { transform: translateY(-5px); opacity: 1; }
		}

		/* ── Input bar ── */

		.nlc-input-bar {
			display: flex;
			align-items: flex-end;
			gap: 10px;
			padding: 14px 18px;
			background: #fff;
			border-top: 1px solid #e8edf4;
			flex-shrink: 0;
		}

		.nlc-input {
			flex: 1;
			border: 1px solid #d1dce8;
			border-radius: 12px;
			padding: 10px 14px;
			font-size: 13.5px;
			resize: none;
			line-height: 1.5;
			outline: none;
			font-family: inherit;
			transition: border-color 0.15s;
			overflow-y: auto;
			max-height: 120px;
		}

		.nlc-input:focus { border-color: #2158c7; }

		.nlc-send-btn {
			width: 40px;
			height: 40px;
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

		.nlc-send-btn:hover { background: #1a47aa; }

		.nlc-send-btn svg {
			width: 18px;
			height: 18px;
			fill: #fff;
		}

		</style>`);
	}
}

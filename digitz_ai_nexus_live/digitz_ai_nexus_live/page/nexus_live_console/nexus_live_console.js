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
		this.page    = page;
		this.wrapper = $(wrapper);
		this.body    = $(page.body);
		this.refresh_interval = null;
		this.active_conversation_id = null;
		this.conversations       = [];
		this.active_filter       = 'all';
		this.active_category     = 'all';
		this.search_query        = '';
		// Tenant
		this.tenant  = '';
		this.tenants = [];
		// Agent mode
		this.is_agent_mode   = false;
		this.agent_context   = null;  // { agent, nickname, categories[] }
		this.panel_open      = false;
		this.panel_conv_id   = null;
	}

	async init() {
		this.inject_styles();
		await this.detect_agent_mode();
		this.render_layout();
		await this.load_tenants();
		this.start_polling();
		this.subscribe_realtime();
	}

	async load_tenants() {
		try {
			const r = await frappe.call({
				method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.get_available_tenants',
			});
			if (!r.message) return;
			this.tenants = r.message.tenants || [];
			const def = r.message.default_tenant || '';
			this.tenant = def || (this.tenants[0] && this.tenants[0].name) || '';

			const $sel = this.body.find('#nlc-tenant-select');
			$sel.html(this.tenants.map(t =>
				`<option value="${frappe.utils.escape_html(t.name)}" ${t.name === this.tenant ? 'selected' : ''}>${frappe.utils.escape_html(t.tenant_name || t.name)}</option>`
			).join(''));

			await this.load_conversations();
		} catch(e) {
			await this.load_conversations();
		}
	}

	async detect_agent_mode() {
		try {
			const r = await frappe.call({
				method: 'digitz_ai_nexus_live.api.agent_console.get_agent_context',
			});
			const ctx = r.message || {};
			if (ctx.is_agent) {
				this.is_agent_mode  = true;
				this.agent_context  = ctx;
				this.active_filter  = 'escalated';
			}
		} catch(e) {
			// Non-agents get no context — silent
		}
	}

	subscribe_realtime() {
		const me = this;
		frappe.realtime.on('nexus_escalation_alert', function(data) {
			me.on_escalation_alert(data);
		});
		frappe.realtime.on('nexus_escalation_claimed', function(data) {
			me.on_escalation_claimed(data);
		});
	}

	on_escalation_alert(data) {
		// Refresh grid to pick up the new escalated card
		this.load_conversations();

		// Browser notification
		const title = `Escalation — ${data.visitor_name || 'Visitor'}`;
		const body  = data.chat_category
			? `Category: ${data.chat_category}`
			: 'A conversation needs your attention.';

		if (window.Notification && Notification.permission === 'granted') {
			new Notification(title, { body, icon: '/assets/digitz_ai_nexus/images/nexus-chat-agent-icon.svg' });
		} else if (window.Notification && Notification.permission !== 'denied') {
			Notification.requestPermission().then(perm => {
				if (perm === 'granted') new Notification(title, { body });
			});
		}

		frappe.show_alert({ message: `🔴 New escalation: ${data.visitor_name || 'Visitor'}`, indicator: 'red' }, 6);
	}

	on_escalation_claimed(data) {
		// If we have this panel open update the claim state
		if (this.panel_open && this.panel_conv_id === data.conversation_id) {
			this.body.find('#nep-claim-wrap').html(
				`<div class="nep-claimed-banner">
					Taken by <strong>${frappe.utils.escape_html(data.claimed_by_nickname)}</strong>
				</div>`
			);
			this.body.find('#nep-input').prop('disabled', true);
			this.body.find('#nep-send-btn').prop('disabled', true);
		}
		// Refresh grid card
		this.load_conversations();
	}

	// ─── Layout ────────────────────────────────────────────────────────────────

	render_layout() {
		const agent_banner = this.is_agent_mode && this.agent_context ? `
			<div class="nlc-agent-banner">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
					<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
					<circle cx="9" cy="7" r="4"/>
					<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
					<path d="M16 3.13a4 4 0 0 1 0 7.75"/>
				</svg>
				Agent mode — signed in as <strong>${frappe.utils.escape_html(this.agent_context.nickname)}</strong>
				&nbsp;·&nbsp; Showing escalated conversations
				${this.agent_context.categories.length
					? `for categories: <strong>${this.agent_context.categories.map(c => frappe.utils.escape_html(c)).join(', ')}</strong>`
					: ''}
			</div>` : '';

		this.body.html(`
			<div class="nlc-root">

				${agent_banner}

				<div class="nlc-brand-header">
					<div class="nlc-brand-left">
						<img class="nlc-brand-icon"
							src="/assets/digitz_ai_nexus/images/nexus-chat-agent-icon.svg"
							alt="Nexus AI">
						<div class="nlc-brand-text">
							<div class="nlc-brand-title">Nexus Live Console</div>
							<div class="nlc-brand-sub">Monitor and manage active AI conversations in real time</div>
						</div>
					</div>
					<div class="nlc-brand-actions">
							<button class="nlc-btn nlc-btn-ghost nlc-refresh-btn" title="Refresh">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polyline points="23 4 23 10 17 10"/>
								<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
							</svg>
							Refresh
						</button>
					</div>
				</div>

				<div class="nlc-tenant-bar">
					<span class="nlc-tenant-label">Tenant</span>
					<select id="nlc-tenant-select" class="nlc-tenant-select">
						<option value="">Loading…</option>
					</select>
				</div>

				<div class="nlc-stats-bar">
					<div class="nlc-stat" id="nlc-stat-open">
						<span class="nlc-stat-dot open"></span>
						<span class="nlc-stat-label">Open</span>
						<span class="nlc-stat-count" id="nlc-count-open">0</span>
					</div>
					<div class="nlc-stat-sep"></div>
					<div class="nlc-stat" id="nlc-stat-responding">
						<span class="nlc-stat-dot responding"></span>
						<span class="nlc-stat-label">Responding</span>
						<span class="nlc-stat-count" id="nlc-count-responding">0</span>
					</div>
					<div class="nlc-stat-sep"></div>
					<div class="nlc-stat" id="nlc-stat-escalated">
						<span class="nlc-stat-dot escalated"></span>
						<span class="nlc-stat-label">Escalated</span>
						<span class="nlc-stat-count" id="nlc-count-escalated">0</span>
					</div>
					<div class="nlc-stat-sep"></div>
					<div class="nlc-stat">
						<span class="nlc-stat-dot closed"></span>
						<span class="nlc-stat-label">Total</span>
						<span class="nlc-stat-count" id="nlc-count-total">0</span>
					</div>
				</div>

				<div class="nlc-filter-bar">
					<div class="nlc-filter-row nlc-filter-row-cat" id="nlc-category-filter-row">
						<div class="nlc-filter-chips" id="nlc-category-chips">
							<span class="nlc-filter-label">Category</span>
							<button class="nlc-cat-chip nlc-cat-chip-active" data-cat="all">All</button>
						</div>
					</div>
					<div class="nlc-filter-row">
						${this.is_agent_mode
							? `<div class="nlc-filter-chips">
								<span class="nlc-filter-label">Status</span>
								<span class="nlc-agent-status-lock">
									<span class="nlc-badge-dot" style="background:#e53e3e;width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px;"></span>
									Escalated (locked)
								</span>
							</div>`
							: `<div class="nlc-filter-chips">
								<span class="nlc-filter-label">Status</span>
								<div class="nlc-select-wrap">
									<select id="nlc-status-select" class="nlc-select">
										<option value="all">All Statuses</option>
										<option value="open">Open</option>
										<option value="responding">Responding</option>
										<option value="waiting">Waiting</option>
										<option value="escalated">Escalated</option>
										<option value="closed">Closed</option>
									</select>
									<svg class="nlc-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
										<polyline points="6 9 12 15 18 9"/>
									</svg>
								</div>
							</div>`}
						<div class="nlc-search-wrap">
							<svg class="nlc-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
							</svg>
							<input
								id="nlc-search"
								type="text"
								class="nlc-search"
								placeholder="Search visitor, message…"
								maxlength="80"
							>
						</div>
					</div>
				</div>

				<div class="nlc-grid-wrap">
					<div class="nlc-grid" id="nlc-grid"></div>
				</div>

			</div>
		`);

		this.bind_events();
	}

	bind_events() {
		this.body.on('click', '.nlc-refresh-btn', () => this.load_conversations());

		const me = this;

		this.body.on('change', '#nlc-tenant-select', function () {
			me.tenant = $(this).val();
			me.active_category = 'all';
			me.load_conversations();
		});

		this.body.on('change', '#nlc-status-select', function () {
			me.active_filter = $(this).val();
			me.render_grid(me.filtered_conversations());
			me.update_stats(me.filtered_conversations());
		});

		this.body.on('input', '#nlc-search', function () {
			me.search_query = $(this).val().trim().toLowerCase();
			me.render_grid(me.filtered_conversations());
			me.update_stats(me.filtered_conversations());
		});

		this.body.on('click', '.nlc-cat-chip', function () {
			me.body.find('.nlc-cat-chip').removeClass('nlc-cat-chip-active');
			$(this).addClass('nlc-cat-chip-active');
			me.active_category = $(this).data('cat');
			me.render_grid(me.filtered_conversations());
			me.update_stats(me.filtered_conversations());
		});

		this.body.on('click', '.nlc-card-open-btn', (e) => {
			e.stopPropagation();
			const id = $(e.currentTarget).closest('.nlc-card').data('id');
			this._open_conversation(id);
		});

		this.body.on('click', '.nlc-card', (e) => {
			if ($(e.target).closest('.nlc-card-open-btn').length) return;
			const id = $(e.currentTarget).data('id');
			this._open_conversation(id);
		});
	}

	// ─── Conversations ─────────────────────────────────────────────────────────

	async load_conversations() {
		try {
			const r = await frappe.call({
				method: 'digitz_ai_nexus_live.api.live.get_active_conversations',
				args: { tenant: this.tenant || '' },
			});
			this.conversations = (r.message || {}).conversations || [];
			this.rebuild_category_chips();
			this.render_grid(this.filtered_conversations());
			this.update_stats(this.filtered_conversations());
		} catch(e) {
			console.error('Failed to load conversations', e);
		}
	}

	rebuild_category_chips() {
		const cats = [...new Set(
			this.conversations
				.map(c => c.chat_category || '')
				.filter(Boolean)
		)].sort();

		const $chips = this.body.find('#nlc-category-chips');
		const row    = this.body.find('#nlc-category-filter-row');

		// Hide the row entirely when there are no named categories
		if (!cats.length) {
			row.hide();
			return;
		}
		row.show();

		// Preserve active selection if still valid, else reset to 'all'
		if (this.active_category !== 'all' && !cats.includes(this.active_category)) {
			this.active_category = 'all';
		}

		const chips_html = cats.map(cat => {
			const is_active = cat === this.active_category ? 'nlc-cat-chip-active' : '';
			return `<button class="nlc-cat-chip ${is_active}"
						data-cat="${frappe.utils.escape_html(cat)}">
						${frappe.utils.escape_html(cat)}
					</button>`;
		}).join('');

		const all_active = this.active_category === 'all' ? 'nlc-cat-chip-active' : '';
		$chips.html(`
			<span class="nlc-filter-label">Category</span>
			<button class="nlc-cat-chip ${all_active}" data-cat="all">All</button>
			${chips_html}
		`);
	}

	filtered_conversations() {
		return this.conversations.filter(c => {
			const status_match = this.active_filter === 'all' ||
				(c.status || '').toLowerCase() === this.active_filter;

			const cat_match = this.active_category === 'all' ||
				(c.chat_category || '') === this.active_category;

			const q = this.search_query;
			const search_match = !q || [
				c.visitor_name, c.visitor_email,
				c.last_message, c.chat_category,
				c.conversation_id,
			].some(v => v && v.toLowerCase().includes(q));

			return status_match && cat_match && search_match;
		});
	}

	update_stats(conversations) {
		const counts = { open: 0, responding: 0, escalated: 0 };
		conversations.forEach(c => {
			const s = (c.status || '').toLowerCase();
			if (s === 'open')        counts.open++;
			if (s === 'responding')  counts.responding++;
			if (s === 'escalated')   counts.escalated++;
		});
		$('#nlc-count-open').text(counts.open);
		$('#nlc-count-responding').text(counts.responding);
		$('#nlc-count-escalated').text(counts.escalated);
		$('#nlc-count-total').text(conversations.length);
	}

	render_grid(conversations) {
		const wrap = this.body.find('#nlc-grid');

		if (!conversations.length) {
			wrap.html(`
				<div class="nlc-empty-state">
					<img src="/assets/digitz_ai_nexus/images/nexus-chat-agent-icon.svg" alt="No conversations" width="72" height="72">
					<div class="nlc-empty-title">No active conversations</div>
					<div class="nlc-empty-sub">New conversations will appear here automatically</div>
				</div>
			`);
			return;
		}

		// Group by chat_category; uncategorised goes last
		const groups = {};
		conversations.forEach(c => {
			const key = c.chat_category || '__none__';
			if (!groups[key]) groups[key] = [];
			groups[key].push(c);
		});

		// Sort: named categories first (alphabetically), uncategorised last
		const sorted_keys = Object.keys(groups).sort((a, b) => {
			if (a === '__none__') return 1;
			if (b === '__none__') return -1;
			return a.localeCompare(b);
		});

		const html = sorted_keys.map(key => {
			const label = key === '__none__' ? 'Uncategorised' : key;
			const items = groups[key];
			return `
				<div class="nlc-group">
					<div class="nlc-group-header">
						<span class="nlc-group-label">${frappe.utils.escape_html(label)}</span>
						<span class="nlc-group-count">${items.length}</span>
					</div>
					<div class="nlc-group-grid">
						${items.map(c => this.card_html(c)).join('')}
					</div>
				</div>
			`;
		}).join('');

		wrap.html(html);

		if (this.active_conversation_id) {
			wrap.find(`.nlc-card[data-id="${this.active_conversation_id}"]`).addClass('active');
		}
	}

	card_html(c) {
		const status      = c.status || 'Open';
		const status_key  = status.toLowerCase().replace(' ', '-');
		const label       = frappe.utils.escape_html(
			c.visitor_name || c.visitor_email || c.resolved_identity_type || 'Visitor'
		);
		const preview     = frappe.utils.escape_html(
			c.last_message
				? c.last_message.substring(0, 90) + (c.last_message.length > 90 ? '…' : '')
				: 'No messages yet'
		);
		const time        = c.started_on ? frappe.datetime.prettyDate(c.started_on) : '';
		const category    = frappe.utils.escape_html(c.chat_category || '');
		const channel     = frappe.utils.escape_html(c.channel || '');
		const conv_id     = frappe.utils.escape_html(c.conversation_id || '');
		const is_active   = c.conversation_id === this.active_conversation_id;
		const initials    = label.substring(0, 2).toUpperCase();

		const esc_html = c.escalation_status && c.escalation_status !== 'None'
			? `<span class="nlc-card-esc">${frappe.utils.escape_html(c.escalation_status)}</span>`
			: '';

		const claimed_html = c.human_agent
			? `<span class="nlc-card-claimed" title="Claimed by agent">Claimed</span>`
			: (status === 'Escalated' ? `<span class="nlc-card-unclaimed">Awaiting agent</span>` : '');

		return `
			<div class="nlc-card ${is_active ? 'active' : ''} nlc-card-status-${status_key}"
				data-id="${conv_id}">
				<div class="nlc-card-header">
					<div class="nlc-card-avatar">${initials}</div>
					<div class="nlc-card-meta">
						<div class="nlc-card-name">${label}</div>
						<div class="nlc-card-id">#${conv_id}</div>
					</div>
					<div class="nlc-card-badges">
						<span class="nlc-badge nlc-badge-${status_key}">
							<span class="nlc-badge-dot"></span>${status}
						</span>
						${esc_html}
						${claimed_html}
					</div>
				</div>

				<div class="nlc-card-preview">${preview}</div>

				<div class="nlc-card-footer">
					<div class="nlc-card-tags">
						${category ? `<span class="nlc-tag">${category}</span>` : ''}
						${channel  ? `<span class="nlc-tag nlc-tag-channel">${channel}</span>` : ''}
					</div>
					<div class="nlc-card-foot-right">
						<span class="nlc-card-time">${time}</span>
						<button class="nlc-card-open-btn" title="Open chat">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
								<path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>
							</svg>
						</button>
					</div>
				</div>
			</div>
		`;
	}

	// ─── Routing ───────────────────────────────────────────────────────────────

	_open_conversation(conversation_id) {
		// Card clicks in the console always open the conversation panel.
		// The chat widget balloon is the sole entry point for personal knowledge-exploring chat.
		this.open_escalation_panel(conversation_id);
	}

	// ─── Escalation Panel ──────────────────────────────────────────────────────

	async open_escalation_panel(conversation_id) {
		this.panel_open   = true;
		this.panel_conv_id = conversation_id;

		// Show loading overlay
		this.body.append(`
			<div id="nep-overlay" class="nep-overlay">
				<div class="nep-panel">
					<div class="nep-loading">Loading conversation…</div>
				</div>
			</div>
		`);

		try {
			const r = await frappe.call({
				method: 'digitz_ai_nexus_live.api.live.get_conversation_detail',
				args: { conversation_id },
			});
			const detail = r.message || {};
			this.body.find('#nep-overlay').html(this._panel_html(detail));
			this._bind_panel_events(detail);
			this._subscribe_panel_realtime(conversation_id);
		} catch(e) {
			this.body.find('#nep-overlay').html(`
				<div class="nep-panel">
					<div class="nep-panel-header">
						<button class="nep-back-btn" id="nep-close">← Back</button>
					</div>
					<div class="nep-error">Failed to load conversation.</div>
				</div>
			`);
			this.body.on('click', '#nep-close', () => this.close_escalation_panel());
		}
	}

	_panel_html(detail) {
		const conv    = detail.conversation || {};
		const msgs    = detail.messages     || [];
		const visitor = conv.visitor_name || conv.visitor_email || 'Visitor';
		const cat     = conv.chat_category || '';
		const agent_name   = this.agent_context ? this.agent_context.agent : null;
		const my_nickname  = this.agent_context ? this.agent_context.nickname : null;
		const claimed_by   = conv.human_agent;
		const claimed_nick = conv.human_agent_nickname;
		const is_mine      = claimed_by && claimed_by === agent_name;
		const is_others    = claimed_by && !is_mine;

		const esc_time = conv.escalated_at
			? `Escalated ${frappe.datetime.prettyDate(conv.escalated_at)}`
			: '';

		const msgs_html = msgs.map(m => {
			const st   = m.sender_type || '';
			const cls  = st === 'Visitor' || st === 'User' ? 'nep-msg-visitor'
				: st === 'Human Agent' ? 'nep-msg-agent'
				: st === 'System' ? 'nep-msg-system'
				: 'nep-msg-ai';
			const sender = st === 'Human Agent'
				? (frappe.utils.escape_html(claimed_nick || st))
				: frappe.utils.escape_html(st);
			const time = m.message_time ? frappe.datetime.prettyDate(m.message_time) : '';
			return `
				<div class="nep-msg ${cls}">
					<div class="nep-msg-meta">
						<span class="nep-msg-sender">${sender}</span>
						<span class="nep-msg-time">${time}</span>
					</div>
					<div class="nep-msg-bubble">${frappe.utils.escape_html(m.message)}</div>
				</div>
			`;
		}).join('');

		const escalation_divider = `
			<div class="nep-escalation-divider">
				<span>⬆ Escalated to human agent ${esc_time}</span>
			</div>
		`;

		const last_ai_idx = [...msgs].reverse().findIndex(m => m.sender_type === 'AI Agent');
		let history_html = msgs_html;
		if (last_ai_idx >= 0) {
			const split = msgs.length - 1 - last_ai_idx;
			const before = msgs.slice(0, split + 1).map(m => {
				const st   = m.sender_type || '';
				const cls  = st === 'Visitor' || st === 'User' ? 'nep-msg-visitor'
					: st === 'Human Agent' ? 'nep-msg-agent'
					: st === 'System' ? 'nep-msg-system'
					: 'nep-msg-ai';
				const sender = st === 'Human Agent'
					? (frappe.utils.escape_html(claimed_nick || st))
					: frappe.utils.escape_html(st);
				const time = m.message_time ? frappe.datetime.prettyDate(m.message_time) : '';
				return `<div class="nep-msg ${cls}">
					<div class="nep-msg-meta">
						<span class="nep-msg-sender">${sender}</span>
						<span class="nep-msg-time">${time}</span>
					</div>
					<div class="nep-msg-bubble">${frappe.utils.escape_html(m.message)}</div>
				</div>`;
			}).join('');
			const after = msgs.slice(split + 1).map(m => {
				const st   = m.sender_type || '';
				const cls  = st === 'Visitor' || st === 'User' ? 'nep-msg-visitor'
					: st === 'Human Agent' ? 'nep-msg-agent'
					: st === 'System' ? 'nep-msg-system'
					: 'nep-msg-ai';
				const sender = st === 'Human Agent'
					? (frappe.utils.escape_html(claimed_nick || st))
					: frappe.utils.escape_html(st);
				const time = m.message_time ? frappe.datetime.prettyDate(m.message_time) : '';
				return `<div class="nep-msg ${cls}">
					<div class="nep-msg-meta">
						<span class="nep-msg-sender">${sender}</span>
						<span class="nep-msg-time">${time}</span>
					</div>
					<div class="nep-msg-bubble">${frappe.utils.escape_html(m.message)}</div>
				</div>`;
			}).join('');
			history_html = before + escalation_divider + after;
		}

		let claim_section = '';
		if (!claimed_by) {
			if (this.is_agent_mode) {
				claim_section = `
					<div id="nep-claim-wrap" class="nep-claim-wrap">
						<button class="nep-claim-btn" id="nep-claim-btn">
							Take this conversation
						</button>
					</div>`;
			}
		} else if (is_mine) {
			claim_section = `<div id="nep-claim-wrap" class="nep-claim-wrap">
				<span class="nep-claimed-mine">You are handling this conversation</span>
			</div>`;
		} else {
			claim_section = `<div id="nep-claim-wrap" class="nep-claim-wrap">
				<div class="nep-claimed-banner">
					Taken by <strong>${frappe.utils.escape_html(claimed_nick || claimed_by)}</strong>
				</div>
			</div>`;
		}

		const input_disabled = (!this.is_agent_mode && !frappe.user.has_role('System Manager'))
			|| (is_others) ? 'disabled' : '';

		return `
			<div class="nep-overlay" id="nep-overlay">
				<div class="nep-panel">
					<div class="nep-panel-header">
						<button class="nep-back-btn" id="nep-close">← Back to Console</button>
						<div class="nep-panel-title">
							<strong>${frappe.utils.escape_html(visitor)}</strong>
							${cat ? `<span class="nep-panel-cat">${frappe.utils.escape_html(cat)}</span>` : ''}
						</div>
						<div class="nep-panel-actions">
							${(this.is_agent_mode || frappe.user.has_role('System Manager'))
								? `<button class="nep-action-btn nep-resolve-btn" id="nep-resolve-btn">
										Resolve (AI resumes)
									</button>
									<button class="nep-action-btn nep-close-conv-btn" id="nep-close-conv-btn">
										Close conversation
									</button>`
								: ''}
						</div>
					</div>

					<div class="nep-history" id="nep-history">
						${history_html || '<div class="nep-empty-history">No messages yet.</div>'}
					</div>

					${claim_section}

					<div class="nep-input-wrap" id="nep-input-wrap">
						<textarea
							id="nep-input"
							class="nep-input"
							placeholder="${is_mine || (!claimed_by && this.is_agent_mode)
								? `Reply as ${frappe.utils.escape_html(my_nickname || 'Agent')}…`
								: 'Read-only — another agent is handling this'}"
							${input_disabled}
							rows="2"
						></textarea>
						<button class="nep-send-btn" id="nep-send-btn" ${input_disabled}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18">
								<line x1="22" y1="2" x2="11" y2="13"/>
								<polygon points="22 2 15 22 11 13 2 9 22 2"/>
							</svg>
						</button>
					</div>
				</div>
			</div>
		`;
	}

	_bind_panel_events(detail) {
		const conv = detail.conversation || {};
		const me   = this;

		this.body.on('click', '#nep-close', () => {
			me.close_escalation_panel();
		});

		this.body.on('click', '#nep-claim-btn', async () => {
			try {
				await frappe.call({
					method: 'digitz_ai_nexus_live.api.agent_console.claim_conversation',
					args: { conversation_id: me.panel_conv_id },
				});
				// Update UI
				const nick = me.agent_context ? me.agent_context.nickname : 'Agent';
				me.body.find('#nep-claim-wrap').html(
					`<span class="nep-claimed-mine">You are handling this conversation</span>`
				);
				me.body.find('#nep-input')
					.prop('disabled', false)
					.attr('placeholder', `Reply as ${nick}…`);
				me.body.find('#nep-send-btn').prop('disabled', false);
			} catch(e) {
				frappe.msgprint('Failed to claim conversation.');
			}
		});

		this.body.on('click', '#nep-send-btn', () => me._panel_send());
		this.body.on('keydown', '#nep-input', function(e) {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				me._panel_send();
			}
		});

		this.body.on('click', '#nep-resolve-btn', async () => {
			try {
				await frappe.call({
					method: 'digitz_ai_nexus_live.api.agent_console.resolve_escalation',
					args: { conversation_id: me.panel_conv_id },
				});
				frappe.show_alert({ message: 'Escalation resolved. AI will resume.', indicator: 'green' });
				me.close_escalation_panel();
				me.load_conversations();
			} catch(e) {
				frappe.msgprint('Failed to resolve escalation.');
			}
		});

		this.body.on('click', '#nep-close-conv-btn', async () => {
			const confirmed = await new Promise(res =>
				frappe.confirm('Close this conversation?', () => res(true), () => res(false))
			);
			if (!confirmed) return;
			try {
				await frappe.call({
					method: 'digitz_ai_nexus_live.api.agent_console.close_conversation_by_agent',
					args: { conversation_id: me.panel_conv_id },
				});
				frappe.show_alert({ message: 'Conversation closed.', indicator: 'green' });
				me.close_escalation_panel();
				me.load_conversations();
			} catch(e) {
				frappe.msgprint('Failed to close conversation.');
			}
		});
	}

	_subscribe_panel_realtime(conversation_id) {
		const me = this;
		frappe.realtime.on('nexus_chat_response', function(data) {
			if (!me.panel_open || data.conversation_id !== me.panel_conv_id) return;
			// Visitor sent a message while escalated — add to history
			if (data.response_type === 'visitor_message') {
				me._append_panel_message({
					sender_type: data.sender_type || 'Visitor',
					message: data.message,
				});
			} else if (data.response_type === 'message' && data.sender_type === 'Human Agent') {
				me._append_panel_message({
					sender_type: 'Human Agent',
					message: data.message,
					sender_name: data.sender_name,
				});
			}
		});
	}

	_append_panel_message(msg) {
		const st  = msg.sender_type || '';
		const cls = st === 'Visitor' || st === 'User' ? 'nep-msg-visitor'
			: st === 'Human Agent' ? 'nep-msg-agent'
			: st === 'System' ? 'nep-msg-system'
			: 'nep-msg-ai';
		const sender = frappe.utils.escape_html(msg.sender_name || st);
		const $hist  = this.body.find('#nep-history');
		$hist.append(`
			<div class="nep-msg ${cls}">
				<div class="nep-msg-meta">
					<span class="nep-msg-sender">${sender}</span>
					<span class="nep-msg-time">just now</span>
				</div>
				<div class="nep-msg-bubble">${frappe.utils.escape_html(msg.message)}</div>
			</div>
		`);
		$hist.scrollTop($hist[0].scrollHeight);
	}

	async _panel_send() {
		const $input = this.body.find('#nep-input');
		const message = $input.val().trim();
		if (!message) return;
		$input.val('').prop('disabled', true);
		this.body.find('#nep-send-btn').prop('disabled', true);
		try {
			await frappe.call({
				method: 'digitz_ai_nexus_live.api.agent_console.agent_send_message',
				args: { conversation_id: this.panel_conv_id, message },
			});
			const nick = this.agent_context ? this.agent_context.nickname : 'Agent';
			this._append_panel_message({ sender_type: 'Human Agent', message, sender_name: nick });
		} catch(e) {
			frappe.show_alert({ message: 'Failed to send message.', indicator: 'red' });
		} finally {
			$input.prop('disabled', false).focus();
			this.body.find('#nep-send-btn').prop('disabled', false);
		}
	}

	close_escalation_panel() {
		this.panel_open    = false;
		this.panel_conv_id = null;
		this.body.find('#nep-overlay').remove();
		// Unbind panel-specific handlers
		this.body.off('click', '#nep-close');
		this.body.off('click', '#nep-claim-btn');
		this.body.off('click', '#nep-send-btn');
		this.body.off('keydown', '#nep-input');
		this.body.off('click', '#nep-resolve-btn');
		this.body.off('click', '#nep-close-conv-btn');
	}

	// ─── Polling ───────────────────────────────────────────────────────────────

	start_polling() {
		this.refresh_interval = setInterval(() => this.load_conversations(), 15000);
	}

	// ─── Styles ────────────────────────────────────────────────────────────────

	inject_styles() {
		if ($('#nlc-styles').length) return;

		$('head').append(`<style id="nlc-styles">

		/* ── Root ── */

		.nlc-root {
			display: flex;
			flex-direction: column;
			min-height: calc(100vh - 120px);
			background: #f5f7fb;
			padding: 0 0 40px;
		}

		/* ── Brand header ── */

		.nlc-brand-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 28px 32px 24px;
			background: #fff;
			border-bottom: 1px solid #e8edf4;
		}

		.nlc-brand-left {
			display: flex;
			align-items: center;
			gap: 18px;
		}

		.nlc-brand-icon {
			width: 80px;
			height: 80px;
			border-radius: 20px;
			flex-shrink: 0;
			filter: drop-shadow(0 4px 16px rgba(23,67,157,0.25));
		}

		.nlc-brand-title {
			font-size: 26px;
			font-weight: 800;
			color: #1a2942;
			letter-spacing: -0.4px;
			line-height: 1.1;
		}

		.nlc-brand-sub {
			font-size: 13.5px;
			color: #718096;
			margin-top: 5px;
			font-weight: 400;
		}

		.nlc-brand-actions {
			display: flex;
			gap: 10px;
			align-items: center;
		}

		.nlc-btn {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 8px 16px;
			border-radius: 8px;
			font-size: 13px;
			font-weight: 600;
			cursor: pointer;
			border: none;
			transition: background 0.15s, color 0.15s;
			font-family: inherit;
		}
		.nlc-btn svg { width: 15px; height: 15px; flex-shrink: 0; }

		.nlc-btn-ghost {
			background: #f0f4ff;
			color: #2158c7;
			border: 1.5px solid #d4e0ff;
		}
		.nlc-btn-ghost:hover { background: #dce9ff; border-color: #2158c7; }

		/* ── Stats bar ── */

		.nlc-stats-bar {
			display: flex;
			align-items: center;
			gap: 0;
			padding: 0 32px;
			background: #fff;
			border-bottom: 1px solid #e8edf4;
		}

		.nlc-stat {
			display: flex;
			align-items: center;
			gap: 7px;
			padding: 14px 24px 14px 0;
			cursor: default;
		}

		.nlc-stat-sep {
			width: 1px;
			height: 20px;
			background: #e8edf4;
			margin: 0 24px 0 0;
		}

		.nlc-stat-dot {
			width: 9px;
			height: 9px;
			border-radius: 50%;
			background: #a0aec0;
			flex-shrink: 0;
		}
		.nlc-stat-dot.open       { background: #38a169; }
		.nlc-stat-dot.responding { background: #2158c7; }
		.nlc-stat-dot.escalated  { background: #e53e3e; }
		.nlc-stat-dot.closed     { background: #718096; }

		.nlc-stat-label {
			font-size: 12.5px;
			color: #718096;
			font-weight: 500;
		}

		.nlc-stat-count {
			font-size: 15px;
			font-weight: 800;
			color: #1a2942;
		}

		/* ── Grid wrap ── */

		.nlc-grid-wrap {
			flex: 1;
			padding: 4px 32px 28px;
		}

		.nlc-grid {
			display: flex;
			flex-direction: column;
		}

		/* ── Empty state ── */

		.nlc-empty-state {
			grid-column: 1 / -1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			padding: 80px 20px;
			gap: 14px;
		}
		.nlc-empty-state img { opacity: 0.5; }
		.nlc-empty-title {
			font-size: 17px;
			font-weight: 700;
			color: #4a5568;
		}
		.nlc-empty-sub {
			font-size: 13px;
			color: #a0aec0;
		}

		/* ── Conversation card ── */

		.nlc-card {
			background: #fff;
			border-radius: 14px;
			border: 1.5px solid #e8edf4;
			padding: 18px 18px 14px;
			cursor: pointer;
			transition: box-shadow 0.18s, border-color 0.18s, transform 0.12s;
			display: flex;
			flex-direction: column;
			gap: 12px;
			position: relative;
			overflow: hidden;
		}
		.nlc-card::before {
			content: '';
			position: absolute;
			top: 0; left: 0; right: 0;
			height: 3px;
			background: #e8edf4;
			border-radius: 14px 14px 0 0;
		}
		.nlc-card.nlc-card-status-open::before       { background: #38a169; }
		.nlc-card.nlc-card-status-responding::before { background: #2158c7; }
		.nlc-card.nlc-card-status-waiting::before    { background: #d69e2e; }
		.nlc-card.nlc-card-status-escalated::before  { background: #e53e3e; }
		.nlc-card.nlc-card-status-closed::before     { background: #cbd5e0; }

		.nlc-card:hover {
			box-shadow: 0 4px 24px rgba(33,88,199,0.12);
			border-color: #c7d9f5;
			transform: translateY(-2px);
		}
		.nlc-card.active {
			border-color: #2158c7;
			box-shadow: 0 4px 24px rgba(33,88,199,0.18);
		}

		/* Card header */
		.nlc-card-header {
			display: flex;
			align-items: center;
			gap: 12px;
		}

		.nlc-card-avatar {
			width: 40px;
			height: 40px;
			border-radius: 10px;
			background: linear-gradient(135deg, #dce9ff, #c7d9f5);
			color: #2158c7;
			font-size: 14px;
			font-weight: 800;
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
			letter-spacing: 0.5px;
		}

		.nlc-card-meta {
			flex: 1;
			min-width: 0;
		}

		.nlc-card-name {
			font-size: 14px;
			font-weight: 700;
			color: #1a2942;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.nlc-card-id {
			font-size: 11px;
			color: #a0aec0;
			margin-top: 1px;
			font-family: monospace;
		}

		.nlc-card-badges {
			display: flex;
			flex-direction: column;
			align-items: flex-end;
			gap: 4px;
			flex-shrink: 0;
		}

		/* Badge */
		.nlc-badge {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			font-size: 11px;
			font-weight: 600;
			padding: 3px 8px;
			border-radius: 999px;
			white-space: nowrap;
			background: #f0f4ff;
			color: #2158c7;
		}
		.nlc-badge-dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: currentColor;
			flex-shrink: 0;
		}
		.nlc-badge-open        { background: #f0fff4; color: #276749; }
		.nlc-badge-responding  { background: #ebf4ff; color: #2158c7; }
		.nlc-badge-waiting     { background: #fffaf0; color: #975a16; }
		.nlc-badge-escalated   { background: #fff5f5; color: #c53030; }
		.nlc-badge-closed      { background: #f7f9fc; color: #718096; }

		.nlc-card-esc {
			font-size: 10px;
			font-weight: 700;
			background: #fff5f5;
			color: #c53030;
			border: 1px solid #fed7d7;
			border-radius: 999px;
			padding: 2px 7px;
		}

		/* Preview */
		.nlc-card-preview {
			font-size: 13px;
			color: #4a5568;
			line-height: 1.5;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
		}

		/* Footer */
		.nlc-card-footer {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
		}

		.nlc-card-tags {
			display: flex;
			flex-wrap: wrap;
			gap: 5px;
			min-width: 0;
		}

		.nlc-tag {
			font-size: 11px;
			font-weight: 600;
			background: #f0f4ff;
			color: #2158c7;
			border-radius: 6px;
			padding: 2px 8px;
			white-space: nowrap;
		}
		.nlc-tag-channel {
			background: #f0fff8;
			color: #2d7d5e;
		}

		.nlc-card-foot-right {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-shrink: 0;
		}

		.nlc-card-time {
			font-size: 11px;
			color: #a0aec0;
			white-space: nowrap;
		}

		.nlc-card-open-btn {
			width: 30px;
			height: 30px;
			border-radius: 8px;
			background: #f0f4ff;
			border: none;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			color: #2158c7;
			transition: background 0.15s;
			flex-shrink: 0;
		}
		.nlc-card-open-btn:hover { background: #dce9ff; }
		.nlc-card-open-btn svg   { width: 14px; height: 14px; }

		/* ── Tenant bar ── */

		.nlc-tenant-bar {
			display: flex;
			align-items: center;
			gap: 12px;
			padding: 10px 16px;
			margin: 0 32px 14px;
			background: #f8fbff;
			border: 1px solid rgba(77,163,255,.2);
			border-radius: 14px;
		}
		.nlc-tenant-label {
			font-size: 12px;
			font-weight: 850;
			color: #173b8c;
			white-space: nowrap;
		}
		.nlc-tenant-select {
			border-radius: 999px;
			border: 1.5px solid rgba(33,77,187,.25);
			padding: 6px 14px;
			font-size: 13px;
			font-weight: 750;
			color: #173b8c;
			background: #fff;
			min-width: 200px;
			outline: none;
		}

		/* ── Filter bar ── */

		.nlc-filter-bar {
			display: flex;
			flex-direction: column;
			margin: 18px 32px;
			background: #fff;
			border: 1.5px solid #e2e8f0;
			border-radius: 14px;
			box-shadow: 0 2px 10px rgba(33,88,199,0.06);
			overflow: hidden;
		}

		.nlc-filter-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 16px;
			padding: 12px 20px;
			flex-wrap: wrap;
		}

		.nlc-filter-row-cat {
			background: #fafbff;
			border-bottom: 2px dashed #e8edf4;
		}

		.nlc-filter-chips {
			display: flex;
			align-items: center;
			gap: 7px;
			flex-wrap: wrap;
		}

		.nlc-filter-label {
			font-size: 10.5px;
			font-weight: 800;
			color: #a0aec0;
			text-transform: uppercase;
			letter-spacing: 0.8px;
			min-width: 72px;
			flex-shrink: 0;
		}

		/* Status dropdown */
		.nlc-select-wrap {
			position: relative;
			display: inline-flex;
			align-items: center;
		}
		.nlc-select {
			appearance: none;
			-webkit-appearance: none;
			padding: 6px 34px 6px 12px;
			border-radius: 8px;
			font-size: 12.5px;
			font-weight: 600;
			border: 1.5px solid #e2e8f0;
			background: #f7f9fc;
			color: #4a5568;
			cursor: pointer;
			font-family: inherit;
			transition: border-color 0.15s, box-shadow 0.15s;
			outline: none;
			min-width: 140px;
		}
		.nlc-select:hover {
			border-color: #2158c7;
			color: #2158c7;
		}
		.nlc-select:focus {
			border-color: #2158c7;
			box-shadow: 0 0 0 3px rgba(33,88,199,0.12);
		}
		.nlc-select-arrow {
			position: absolute;
			right: 9px;
			top: 50%;
			transform: translateY(-50%);
			width: 14px;
			height: 14px;
			stroke: #a0aec0;
			pointer-events: none;
		}

		/* Search */
		.nlc-search-wrap {
			position: relative;
			flex-shrink: 0;
		}
		.nlc-search-icon {
			position: absolute;
			left: 10px;
			top: 50%;
			transform: translateY(-50%);
			width: 14px;
			height: 14px;
			stroke: #a0aec0;
			pointer-events: none;
		}
		.nlc-search {
			border: 1.5px solid #e2e8f0;
			border-radius: 8px;
			padding: 6px 12px 6px 30px;
			font-size: 13px;
			color: #1a2942;
			background: #f7f9fc;
			width: 220px;
			outline: none;
			font-family: inherit;
			transition: border-color 0.15s, background 0.15s;
		}
		.nlc-search:focus {
			border-color: #2158c7;
			background: #fff;
		}
		.nlc-search::placeholder { color: #a0aec0; }

		/* Category filter chips — teal accent to distinguish from status chips */
		.nlc-cat-chip {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			padding: 4px 13px;
			border-radius: 999px;
			font-size: 12.5px;
			font-weight: 600;
			border: 1.5px solid #e2e8f0;
			background: #f7f9fc;
			color: #4a5568;
			cursor: pointer;
			transition: all 0.15s;
			font-family: inherit;
		}
		.nlc-cat-chip:hover {
			border-color: #16a37f;
			color: #16a37f;
			background: #f0fff8;
		}
		.nlc-cat-chip.nlc-cat-chip-active {
			background: #16a37f;
			border-color: #16a37f;
			color: #fff;
		}

		/* ── Category groups ── */

		.nlc-group {
			margin-bottom: 36px;
		}

		.nlc-group-header {
			display: flex;
			align-items: center;
			gap: 10px;
			margin-bottom: 14px;
			padding-bottom: 10px;
			border-bottom: 2px solid #e8edf4;
		}

		.nlc-group-label {
			font-size: 13px;
			font-weight: 700;
			color: #2158c7;
			text-transform: uppercase;
			letter-spacing: 0.6px;
		}

		.nlc-group-count {
			font-size: 11.5px;
			font-weight: 700;
			background: #dce9ff;
			color: #2158c7;
			border-radius: 999px;
			padding: 1px 9px;
			min-width: 22px;
			text-align: center;
		}

		.nlc-group-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
			gap: 18px;
		}

		/* ── Agent mode ── */

		.nlc-agent-banner {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 10px 32px;
			background: #fff5f5;
			border-bottom: 1.5px solid #fed7d7;
			font-size: 13px;
			color: #c53030;
			font-weight: 500;
		}

		.nlc-agent-status-lock {
			display: inline-flex;
			align-items: center;
			font-size: 12.5px;
			font-weight: 700;
			color: #c53030;
			background: #fff5f5;
			border: 1.5px solid #fed7d7;
			border-radius: 8px;
			padding: 5px 12px;
		}

		.nlc-card-claimed {
			font-size: 10px;
			font-weight: 700;
			background: #f0fff8;
			color: #276749;
			border: 1px solid #c6f6d5;
			border-radius: 999px;
			padding: 2px 7px;
		}
		.nlc-card-unclaimed {
			font-size: 10px;
			font-weight: 700;
			background: #fff5f5;
			color: #c53030;
			border: 1px solid #fed7d7;
			border-radius: 999px;
			padding: 2px 7px;
			animation: nep-pulse 2s infinite;
		}
		@keyframes nep-pulse {
			0%, 100% { opacity: 1; }
			50%       { opacity: 0.6; }
		}

		/* ── Escalation Panel Overlay ── */

		.nep-overlay {
			position: fixed;
			inset: 0;
			background: rgba(26,41,66,0.45);
			z-index: 9000;
			display: flex;
			align-items: stretch;
			justify-content: flex-end;
		}

		.nep-panel {
			width: min(780px, 100vw);
			background: #fff;
			display: flex;
			flex-direction: column;
			box-shadow: -8px 0 40px rgba(26,41,66,0.2);
			animation: nep-slide-in 0.22s ease;
		}
		@keyframes nep-slide-in {
			from { transform: translateX(40px); opacity: 0; }
			to   { transform: translateX(0);    opacity: 1; }
		}

		.nep-panel-header {
			display: flex;
			align-items: center;
			gap: 14px;
			padding: 16px 20px;
			background: #f8faff;
			border-bottom: 1.5px solid #e2e8f0;
			flex-shrink: 0;
		}

		.nep-back-btn {
			background: none;
			border: 1.5px solid #e2e8f0;
			border-radius: 8px;
			padding: 6px 12px;
			font-size: 13px;
			font-weight: 600;
			color: #4a5568;
			cursor: pointer;
			white-space: nowrap;
			font-family: inherit;
		}
		.nep-back-btn:hover { background: #f0f4ff; border-color: #2158c7; color: #2158c7; }

		.nep-panel-title {
			flex: 1;
			font-size: 15px;
			font-weight: 700;
			color: #1a2942;
			display: flex;
			align-items: center;
			gap: 10px;
		}

		.nep-panel-cat {
			font-size: 11px;
			font-weight: 600;
			background: #f0f4ff;
			color: #2158c7;
			padding: 2px 8px;
			border-radius: 6px;
		}

		.nep-panel-actions {
			display: flex;
			gap: 8px;
		}

		.nep-action-btn {
			padding: 6px 14px;
			border-radius: 8px;
			font-size: 12.5px;
			font-weight: 600;
			cursor: pointer;
			border: 1.5px solid;
			font-family: inherit;
			transition: all 0.15s;
		}
		.nep-resolve-btn {
			background: #f0fff8;
			color: #276749;
			border-color: #c6f6d5;
		}
		.nep-resolve-btn:hover { background: #c6f6d5; }

		.nep-close-conv-btn {
			background: #fff5f5;
			color: #c53030;
			border-color: #fed7d7;
		}
		.nep-close-conv-btn:hover { background: #fed7d7; }

		.nep-history {
			flex: 1;
			overflow-y: auto;
			padding: 20px;
			display: flex;
			flex-direction: column;
			gap: 12px;
			background: #f8faff;
		}

		.nep-msg {
			display: flex;
			flex-direction: column;
			gap: 4px;
			max-width: 75%;
		}
		.nep-msg-visitor { align-self: flex-start; }
		.nep-msg-ai      { align-self: flex-start; }
		.nep-msg-agent   { align-self: flex-end; }
		.nep-msg-system  { align-self: center; max-width: 90%; }

		.nep-msg-meta {
			display: flex;
			gap: 8px;
			align-items: center;
		}
		.nep-msg-sender {
			font-size: 11px;
			font-weight: 700;
			color: #718096;
			text-transform: uppercase;
			letter-spacing: 0.4px;
		}
		.nep-msg-time { font-size: 10.5px; color: #a0aec0; }

		.nep-msg-bubble {
			padding: 10px 14px;
			border-radius: 12px;
			font-size: 13.5px;
			line-height: 1.55;
			white-space: pre-wrap;
			word-break: break-word;
		}
		.nep-msg-visitor .nep-msg-bubble { background: #fff; border: 1px solid #e2e8f0; color: #1a2942; }
		.nep-msg-ai      .nep-msg-bubble { background: #ebf4ff; color: #1a2942; }
		.nep-msg-agent   .nep-msg-bubble { background: #2158c7; color: #fff; border-radius: 12px 12px 2px 12px; }
		.nep-msg-agent   .nep-msg-meta   { justify-content: flex-end; }
		.nep-msg-system  .nep-msg-bubble {
			background: #fefcbf;
			color: #744210;
			font-style: italic;
			font-size: 12.5px;
			text-align: center;
			border-radius: 8px;
		}

		.nep-escalation-divider {
			display: flex;
			align-items: center;
			gap: 10px;
			margin: 8px 0;
			font-size: 11.5px;
			font-weight: 600;
			color: #c53030;
		}
		.nep-escalation-divider::before,
		.nep-escalation-divider::after {
			content: '';
			flex: 1;
			height: 1.5px;
			background: #fed7d7;
		}

		.nep-claim-wrap {
			padding: 14px 20px;
			background: #fff;
			border-top: 1.5px solid #e2e8f0;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.nep-claim-btn {
			padding: 10px 28px;
			background: #e53e3e;
			color: #fff;
			border: none;
			border-radius: 8px;
			font-size: 14px;
			font-weight: 700;
			cursor: pointer;
			font-family: inherit;
			transition: background 0.15s;
		}
		.nep-claim-btn:hover { background: #c53030; }

		.nep-claimed-mine {
			font-size: 13px;
			font-weight: 600;
			color: #276749;
		}

		.nep-claimed-banner {
			font-size: 13px;
			color: #718096;
		}

		.nep-input-wrap {
			display: flex;
			align-items: flex-end;
			gap: 10px;
			padding: 14px 20px;
			background: #fff;
			border-top: 1.5px solid #e2e8f0;
			flex-shrink: 0;
		}

		.nep-input {
			flex: 1;
			border: 1.5px solid #e2e8f0;
			border-radius: 10px;
			padding: 10px 14px;
			font-size: 13.5px;
			font-family: inherit;
			resize: none;
			outline: none;
			color: #1a2942;
			transition: border-color 0.15s;
			line-height: 1.5;
		}
		.nep-input:focus   { border-color: #2158c7; }
		.nep-input:disabled { background: #f7f9fc; color: #a0aec0; }

		.nep-send-btn {
			width: 44px;
			height: 44px;
			border-radius: 10px;
			background: #2158c7;
			border: none;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			color: #fff;
			flex-shrink: 0;
			transition: background 0.15s;
		}
		.nep-send-btn:hover    { background: #1a46a3; }
		.nep-send-btn:disabled { background: #a0aec0; cursor: not-allowed; }

		.nep-loading, .nep-error, .nep-empty-history {
			padding: 40px;
			text-align: center;
			color: #718096;
			font-size: 14px;
		}

		</style>`);
	}
}

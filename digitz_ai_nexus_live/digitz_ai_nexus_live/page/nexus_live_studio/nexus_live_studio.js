frappe.pages['nexus_live_studio'].on_page_load = function(wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'DIGITZ AI Nexus Live Studio',
		single_column: true
	});

	const studio = new NexusLiveStudio(page, wrapper);
	studio.init();
};


class NexusLiveStudio {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = $(wrapper);
		this.body = $(page.body);
	}

	async init() {
		this.render_layout();
		await this.load_snapshot();
	}

	render_layout() {
		this.body.html(`
			<div class="nexus-live-studio">

				<div class="nls-hero">
					<div class="nls-hero-left">
						<div class="nls-badge">
							<span class="nls-pulse"></span>
							AI Workforce Infrastructure
						</div>

						<h1>DIGITZ AI Nexus Live Studio</h1>

						<p>
							Configure and activate designated AI workforce infrastructure
							for governed enterprise conversational experiences.
						</p>
					</div>

					<div class="nls-hero-actions">
						<button class="btn btn-primary nls-action-btn" id="nls-register-agent">
							Register AI Representative
						</button>

						<button class="btn btn-default nls-action-btn" id="nls-create-behaviour">
							Create Behaviour
						</button>
					</div>
				</div>

				<div class="nls-overview-grid"></div>

				<div class="nls-main-tabs">
					<div class="nls-tab-header">
						<div class="nls-tab active" data-tab="workforce">Workforce</div>
						<div class="nls-tab" data-tab="behaviours">Behaviours</div>
						<div class="nls-tab" data-tab="channels">Channels</div>
						<div class="nls-tab" data-tab="escalations">Escalations</div>
					</div>

					<div class="nls-tab-content">
						<div class="nls-panel active" data-panel="workforce">
							<div class="nls-section-header">
								<h3>AI Workforce</h3>
								<p>Operational AI and Human representatives available in the Live ecosystem.</p>
							</div>
							<div class="nls-workforce-grid"></div>
						</div>

						<div class="nls-panel" data-panel="behaviours">
							<div class="nls-section-header">
								<h3>Conversational Behaviours</h3>
								<p>Reusable conversational intelligence templates assignable to multiple AI representatives.</p>
							</div>
							<div class="nls-behaviour-grid"></div>
						</div>

						<div class="nls-panel" data-panel="channels">
							<div class="nls-section-header">
								<h3>Live Channels</h3>
								<p>Interaction channels connected to designated AI workforce runtime.</p>
							</div>
							<div class="nls-channel-grid"></div>
						</div>

						<div class="nls-panel" data-panel="escalations">
							<div class="nls-section-header">
								<h3>Escalation Governance</h3>
								<p>Governance and operational escalation configuration for AI runtime workflows.</p>
							</div>
							<div class="nls-escalation-grid"></div>
						</div>
					</div>
				</div>

			</div>
		`);

		this.bind_events();
		this.inject_styles();
	}

	bind_events() {
		const me = this;

		this.body.on('click', '.nls-tab', function() {
			const tab = $(this).data('tab');

			me.body.find('.nls-tab').removeClass('active');
			$(this).addClass('active');

			me.body.find('.nls-panel').removeClass('active');
			me.body.find(`.nls-panel[data-panel="${tab}"]`).addClass('active');
		});

		this.body.on('click', '#nls-register-agent', function() {
			frappe.set_route('List', 'Nexus Live Agent');
		});

		this.body.on('click', '#nls-create-behaviour', function() {
			frappe.set_route('List', 'Nexus AI Behaviour');
		});
	}

	async load_snapshot() {
		try {
			const response = await frappe.call({
				method: 'digitz_ai_nexus_live.api.live_studio.get_live_studio_snapshot'
			});

			const data = response.message || {};

			this.render_overview(data.overview || {});
			this.render_workforce(data.agents || []);
			this.render_behaviours(data.behaviours || []);
			this.render_channels(data.channels || []);
			this.render_escalations(data.escalations || []);

		} catch (e) {
			console.error(e);

			frappe.msgprint({
				title: 'Studio Load Failed',
				message: 'Unable to load Nexus Live Studio snapshot.',
				indicator: 'red'
			});
		}
	}

	get_icon(icon) {
		const icons = {
			users: `
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
					<circle cx="9" cy="7" r="4"/>
					<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
					<path d="M16 3.13a4 4 0 0 1 0 7.75"/>
				</svg>
			`,
			user: `
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
					<circle cx="12" cy="7" r="4"/>
				</svg>
			`,
			message: `
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>
					<path d="M8 9h8"/>
					<path d="M8 13h5"/>
				</svg>
			`,
			globe: `
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<circle cx="12" cy="12" r="10"/>
					<path d="M2 12h20"/>
					<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
				</svg>
			`,
			shield: `
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
				</svg>
			`,
			award: `
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<circle cx="12" cy="8" r="6"/>
					<path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/>
					<path d="m9.5 8 1.5 1.5L14.5 6"/>
				</svg>
			`
		};

		return icons[icon] || icons.message;
	}

	render_overview(overview) {
		const cards = [
			{
				label: 'AI Workforce',
				value: overview.ai_agents || 0,
				icon: 'users',
				color: '#2158c7',
				bg: '#eef3ff'
			},
			{
				label: 'Human Workforce',
				value: overview.human_agents || 0,
				icon: 'user',
				color: '#7c3aed',
				bg: '#f3edff'
			},
			{
				label: 'Behaviour Masters',
				value: overview.behaviours || 0,
				icon: 'message',
				color: '#2563eb',
				bg: '#eef4ff'
			},
			{
				label: 'Channels',
				value: overview.channels || 0,
				icon: 'globe',
				color: '#11a36a',
				bg: '#e9f9f2'
			},
			{
				label: 'Escalation Rules',
				value: overview.escalation_rules || 0,
				icon: 'shield',
				color: '#f59e0b',
				bg: '#fff4e5'
			},
			{
				label: 'Approved Workforce',
				value: overview.approved_agents || 0,
				icon: 'award',
				color: '#7c3aed',
				bg: '#f3edff'
			}
		];

		let html = '';

		cards.forEach(card => {
			html += `
				<div class="nls-overview-card">
					<div
						class="nls-overview-icon"
						style="background:${card.bg}; color:${card.color};"
					>
						${this.get_icon(card.icon)}
					</div>

					<div class="nls-overview-value" style="color:${card.color}">
						${card.value}
					</div>

					<div class="nls-overview-label">
						${card.label}
					</div>

					<div
						class="nls-overview-line"
						style="background:${card.color}"
					></div>
				</div>
			`;
		});

		this.body.find('.nls-overview-grid').html(html);
	}

	render_workforce(agents) {
		let html = '';

		agents.forEach(agent => {
			const statusClass = (agent.status || '').toLowerCase();

			html += `
				<div class="nls-agent-card">
					<div class="nls-agent-header">
						<div>
							<div class="nls-agent-name">
								${agent.display_name || agent.agent_name || agent.name}
							</div>

							<div class="nls-agent-role">
								${agent.agent_role || 'Representative'}
							</div>
						</div>

						<div class="nls-status ${statusClass}">
							${agent.status || 'Unknown'}
						</div>
					</div>

					<div class="nls-agent-meta">
						<div class="nls-meta-row">
							<span>Type</span>
							<strong>${agent.agent_type || '-'}</strong>
						</div>

						<div class="nls-meta-row">
							<span>Sessions</span>
							<strong>${agent.current_active_sessions || 0} / ${agent.max_active_sessions || 0}</strong>
						</div>

						<div class="nls-meta-row">
							<span>Visibility</span>
							<strong>${agent.visibility || '-'}</strong>
						</div>

						<div class="nls-meta-row">
							<span>Channel</span>
							<strong>${agent.default_channel || '-'}</strong>
						</div>
					</div>
				</div>
			`;
		});

		this.body.find('.nls-workforce-grid').html(html);
	}

	render_behaviours(behaviours) {
		let html = '';

		behaviours.forEach(row => {
			html += `
				<div class="nls-behaviour-card">
					<div class="nls-behaviour-title">
						${row.name}
					</div>

					<div class="nls-meta-row">
						<span>Tone</span>
						<strong>${row.tone || '-'}</strong>
					</div>

					<div class="nls-meta-row">
						<span>Style</span>
						<strong>${row.response_style || '-'}</strong>
					</div>

					<div class="nls-meta-row">
						<span>Memory</span>
						<strong>${row.memory_mode || '-'}</strong>
					</div>

					<div class="nls-meta-row">
						<span>Escalation</span>
						<strong>${row.escalation_enabled ? 'Enabled' : 'Disabled'}</strong>
					</div>

					<div class="nls-meta-row">
						<span>Confidence</span>
						<strong>${row.confidence_threshold || 0}</strong>
					</div>
				</div>
			`;
		});

		this.body.find('.nls-behaviour-grid').html(html);
	}

	render_channels(channels) {
		let html = '';

		channels.forEach(row => {
			html += `
				<div class="nls-channel-card">
					<div class="nls-channel-title">
						${row.channel_name || row.name}
					</div>

					<div class="nls-meta-row">
						<span>Code</span>
						<strong>${row.channel_code || '-'}</strong>
					</div>

					<div class="nls-meta-row">
						<span>Type</span>
						<strong>${row.channel_type || '-'}</strong>
					</div>

					<div class="nls-meta-row">
						<span>Agent Based</span>
						<strong>${row.agent_based ? 'Yes' : 'No'}</strong>
					</div>
				</div>
			`;
		});

		this.body.find('.nls-channel-grid').html(html);
	}

	render_escalations(rules) {
		let html = '';

		rules.forEach(rule => {
			html += `
				<div class="nls-escalation-card">
					<div class="nls-channel-title">
						${rule.name}
					</div>

					<div class="nls-meta-row">
						<span>Role</span>
						<strong>${rule.agent_role || '-'}</strong>
					</div>

					<div class="nls-meta-row">
						<span>Queue</span>
						<strong>${rule.target_queue || '-'}</strong>
					</div>

					<div class="nls-meta-row">
						<span>Target Agent</span>
						<strong>${rule.target_agent || '-'}</strong>
					</div>
				</div>
			`;
		});

		this.body.find('.nls-escalation-grid').html(html);
	}

	inject_styles() {
		if ($('#nexus-live-studio-styles').length) {
			return;
		}

		$('head').append(`
			<style id="nexus-live-studio-styles">

				.nexus-live-studio {
					padding: 20px;
					background: #f5f7fb;
					min-height: 100vh;
				}

				.nls-hero {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: 35px;
					border-radius: 24px;
					background:
						linear-gradient(
							135deg,
							#163d96 0%,
							#214dbb 38%,
							#3b63d1 72%,
							#5a54c7 100%
						);
					color: white;
					margin-bottom: 25px;
					box-shadow: 0 15px 40px rgba(33,77,187,0.18);
					position: relative;
					overflow: hidden;
				}

				.nls-hero::after {
					content: "";
					position: absolute;
					top: -120px;
					right: -80px;
					width: 320px;
					height: 320px;
					background:
						radial-gradient(
							rgba(255, 214, 102, 0.16),
							rgba(255,255,255,0)
						);
					pointer-events: none;
				}

				.nls-badge {
					display: inline-flex;
					align-items: center;
					gap: 8px;
					padding: 8px 14px;
					border-radius: 999px;
					background: rgba(255,255,255,0.12);
					font-size: 12px;
					font-weight: 600;
					margin-bottom: 18px;
				}

				.nls-pulse {
					width: 10px;
					height: 10px;
					border-radius: 50%;
					background: #f4c542;
				}

				.nls-hero h1 {
					font-size: 34px;
					font-weight: 700;
					margin-bottom: 12px;
					color: #f4f7ff;
					letter-spacing: -0.5px;
					text-shadow: 0 2px 10px rgba(0,0,0,0.12);
				}

				.nls-hero p {
					max-width: 700px;
					font-size: 15px;
					line-height: 1.8;
					color: #dbe6ff;
					opacity: 0.95;
					font-weight: 400;
				}

				.nls-action-btn {
					margin-left: 10px;
					border-radius: 12px;
					padding: 10px 18px;
					font-weight: 600;
				}

				.nls-overview-grid {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
					gap: 18px;
					margin-bottom: 25px;
				}

				.nls-overview-card {
					background: white;
					padding: 24px;
					border-radius: 24px;
					box-shadow: 0 8px 25px rgba(0,0,0,0.05);
					position: relative;
					overflow: hidden;
					min-height: 178px;
					display: flex;
					flex-direction: column;
					border: 1px solid #edf2ff;
					transition: all 0.25s ease;
				}

				.nls-overview-card:hover {
					transform: translateY(-4px);
					box-shadow: 0 16px 34px rgba(0,0,0,0.08);
				}

				.nls-overview-icon {
					width: 54px;
					height: 54px;
					border-radius: 50%;
					display: flex;
					align-items: center;
					justify-content: center;
					margin-bottom: 18px;
				}

				.nls-overview-icon svg {
					width: 25px;
					height: 25px;
					stroke-width: 2.2;
					stroke-linecap: round;
					stroke-linejoin: round;
				}

				.nls-overview-value {
					font-size: 36px;
					font-weight: 700;
					line-height: 1;
					margin-bottom: 12px;
					letter-spacing: -0.8px;
				}

				.nls-overview-label {
					font-size: 14px;
					font-weight: 600;
					color: #24324b;
					margin-bottom: 16px;
					line-height: 1.4;
				}

				.nls-overview-line {
					width: 48px;
					height: 5px;
					border-radius: 999px;
					margin-top: auto;
					opacity: 0.5;
				}

				.nls-main-tabs {
					background: white;
					border-radius: 24px;
					padding: 20px;
					box-shadow: 0 8px 30px rgba(0,0,0,0.05);
				}

				.nls-tab-header {
					display: flex;
					gap: 12px;
					margin-bottom: 25px;
				}

				.nls-tab {
					padding: 12px 18px;
					border-radius: 12px;
					cursor: pointer;
					font-weight: 600;
					color: #666;
					background: #f4f6fb;
				}

				.nls-tab.active {
					background: #214dbb;
					color: white;
					box-shadow: 0 8px 22px rgba(33,77,187,0.20);
				}

				.nls-panel {
					display: none;
				}

				.nls-panel.active {
					display: block;
				}

				.nls-section-header {
					margin-bottom: 20px;
				}

				.nls-section-header h3 {
					font-size: 24px;
					font-weight: 700;
					color: #214dbb;
					margin-bottom: 6px;
				}

				.nls-section-header p {
					color: #667085;
					font-size: 14px;
				}

				.nls-workforce-grid,
				.nls-behaviour-grid,
				.nls-channel-grid,
				.nls-escalation-grid {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
					gap: 18px;
				}

				.nls-agent-card,
				.nls-behaviour-card,
				.nls-channel-card,
				.nls-escalation-card {
					background: #fafcff;
					border: 1px solid #dbe5ff;
					border-radius: 20px;
					padding: 20px;
				}

				.nls-agent-header {
					display: flex;
					justify-content: space-between;
					align-items: start;
					margin-bottom: 18px;
				}

				.nls-agent-name {
					font-size: 18px;
					font-weight: 700;
					color: #214dbb;
				}

				.nls-agent-role {
					font-size: 13px;
					color: #667085;
					margin-top: 4px;
				}

				.nls-status {
					padding: 6px 12px;
					border-radius: 999px;
					font-size: 12px;
					font-weight: 600;
				}

				.nls-status.idle,
				.nls-status.waiting {
					background: #dff5e8;
					color: #0f8b4c;
				}

				.nls-status.responding {
					background: #dce9ff;
					color: #2158c7;
				}

				.nls-status.offline {
					background: #ffe2e2;
					color: #c0392b;
				}

				.nls-meta-row {
					display: flex;
					justify-content: space-between;
					margin-bottom: 10px;
					font-size: 13px;
				}

				.nls-meta-row span {
					color: #667085;
				}

				.nls-meta-row strong {
					color: #111827;
				}

				.nls-behaviour-title,
				.nls-channel-title {
					font-size: 18px;
					font-weight: 700;
					color: #214dbb;
					margin-bottom: 18px;
				}

			</style>
		`);
	}
}
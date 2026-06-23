frappe.pages["nexus_analytics_dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Nexus Analytics",
		single_column: true,
	});

	window._nad = new NexusAnalyticsDashboard(page, wrapper);
};

class NexusAnalyticsDashboard {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.$main = $(wrapper).find(".page-content");
		this.state = {
			trend_days: 30,
			status_filter: "",
			category_filter: "",
			date_from: "",
			date_to: "",
			search: "",
			page: 1,
			page_size: 25,
			topic_filter: "",
			detail_open: false,
			// Visitors tab state
			visitor_page: 1,
			visitor_page_size: 25,
			visitor_search: "",
			visitor_country_filter: "",
			// Page visit report state
			page_path_filter: "",
			// Journey panel
			journey_open: false,
		};
		this._build_skeleton();
		this._load_all();
	}

	// ── DOM skeleton ────────────────────────────────────────────────────────────
	_build_skeleton() {
		this.$main.html(`
<div class="nad-root">
  <style>${NAD_CSS}</style>

  <!-- header -->
  <div class="nad-header">
    <div class="nad-brand">
      <span class="nad-logo">◈</span>
      <span class="nad-title">Nexus Analytics</span>
    </div>
    <div class="nad-header-actions">
      <select class="nad-trend-range nad-select" title="Trend period">
        <option value="7">Last 7 days</option>
        <option value="30" selected>Last 30 days</option>
        <option value="60">Last 60 days</option>
        <option value="90">Last 90 days</option>
      </select>
      <button class="nad-btn nad-btn-ghost nad-refresh-btn">↻ Refresh</button>
    </div>
  </div>

  <!-- KPI row -->
  <div class="nad-kpi-row">
    <div class="nad-kpi" data-key="total_conversations">
      <div class="nad-kpi-value">—</div>
      <div class="nad-kpi-label">Total Sessions</div>
    </div>
    <div class="nad-kpi" data-key="today_conversations">
      <div class="nad-kpi-value">—</div>
      <div class="nad-kpi-label">Sessions Today</div>
    </div>
    <div class="nad-kpi" data-key="active_now">
      <div class="nad-kpi-value">—</div>
      <div class="nad-kpi-label">Active Now</div>
    </div>
    <div class="nad-kpi" data-key="unique_visitors">
      <div class="nad-kpi-value">—</div>
      <div class="nad-kpi-label">Unique Visitors</div>
    </div>
    <div class="nad-kpi" data-key="escalation_rate">
      <div class="nad-kpi-value">—</div>
      <div class="nad-kpi-label">Escalation Rate</div>
    </div>
    <div class="nad-kpi" data-key="messages_today">
      <div class="nad-kpi-value">—</div>
      <div class="nad-kpi-label">Messages Today</div>
    </div>
  </div>

  <!-- Charts row -->
  <div class="nad-charts-row">
    <div class="nad-card nad-chart-card nad-trend-card">
      <div class="nad-card-title">Conversations Over Time</div>
      <div class="nad-trend-chart"></div>
    </div>
    <div class="nad-card nad-chart-card nad-dist-card">
      <div class="nad-card-title">Distribution</div>
      <div class="nad-dist-tabs">
        <button class="nad-tab active" data-tab="status">By Status</button>
        <button class="nad-tab" data-tab="category">By Category</button>
        <button class="nad-tab" data-tab="channel">By Channel</button>
      </div>
      <div class="nad-dist-chart"></div>
    </div>
  </div>

  <!-- Knowledge topics -->
  <div class="nad-card nad-topics-card">
    <div class="nad-card-header">
      <div class="nad-card-title">Knowledge Topics</div>
      <input class="nad-topics-search nad-input" placeholder="Filter topics…" />
    </div>
    <div class="nad-topics-table-wrap">
      <table class="nad-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Topic / Knowledge Title</th>
            <th>Knowledge Unit</th>
            <th class="nad-num">Hits</th>
            <th class="nad-num">Unique Sessions</th>
            <th class="nad-num">Avg Score</th>
          </tr>
        </thead>
        <tbody class="nad-topics-body">
          <tr><td colspan="6" class="nad-empty">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Visitor engagement -->
  <div class="nad-card nad-engagement-card">
    <div class="nad-card-header">
      <div class="nad-card-title">Visitor Engagement</div>
      <div class="nad-engagement-filters">
        <input class="nad-search-input nad-input" placeholder="Search visitor / conversation…" />
        <select class="nad-status-filter nad-select"><option value="">All Statuses</option></select>
        <select class="nad-category-filter nad-select"><option value="">All Categories</option></select>
        <input class="nad-date-from nad-input" type="date" title="From date" />
        <input class="nad-date-to nad-input" type="date" title="To date" />
        <button class="nad-btn nad-btn-primary nad-apply-filter">Apply</button>
        <button class="nad-btn nad-btn-ghost nad-clear-filter">Clear</button>
      </div>
    </div>
    <div class="nad-engagement-table-wrap">
      <table class="nad-table">
        <thead>
          <tr>
            <th>Visitor</th>
            <th>Category</th>
            <th>Channel</th>
            <th class="nad-num">Messages</th>
            <th>Status</th>
            <th>Escalation</th>
            <th>Duration</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody class="nad-engagement-body">
          <tr><td colspan="8" class="nad-empty">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="nad-pagination"></div>
  </div>

  <!-- Country Insights -->
  <div class="nad-card nad-country-card">
    <div class="nad-card-header">
      <div class="nad-card-title">Country Insights</div>
    </div>
    <div class="nad-country-table-wrap">
      <table class="nad-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Country</th>
            <th class="nad-num">Sessions</th>
            <th class="nad-num">Visitors</th>
            <th class="nad-num">Conversations</th>
            <th class="nad-num">Avg Duration</th>
          </tr>
        </thead>
        <tbody class="nad-country-body">
          <tr><td colspan="6" class="nad-empty">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Page Visit Report -->
  <div class="nad-card nad-pages-card">
    <div class="nad-card-header">
      <div class="nad-card-title">Page Visit Report</div>
      <input class="nad-pages-search nad-input" placeholder="Filter by path…" />
    </div>
    <div class="nad-pages-table-wrap">
      <table class="nad-table">
        <thead>
          <tr>
            <th>Page Path</th>
            <th class="nad-num">Visits</th>
            <th class="nad-num">Unique Visitors</th>
            <th class="nad-num">Avg Duration</th>
            <th class="nad-num">Avg Active Time</th>
          </tr>
        </thead>
        <tbody class="nad-pages-body">
          <tr><td colspan="5" class="nad-empty">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Visitors (journey-centric) -->
  <div class="nad-card nad-visitors-card">
    <div class="nad-card-header">
      <div class="nad-card-title">Visitors</div>
      <div class="nad-engagement-filters">
        <input class="nad-visitor-search nad-input" placeholder="Search visitor ID…" />
        <select class="nad-visitor-country nad-select"><option value="">All Countries</option></select>
        <button class="nad-btn nad-btn-ghost nad-visitor-clear">Clear</button>
      </div>
    </div>
    <div class="nad-visitors-table-wrap">
      <table class="nad-table">
        <thead>
          <tr>
            <th>Visitor</th>
            <th>Country</th>
            <th>Device / Browser</th>
            <th class="nad-num">Sessions</th>
            <th class="nad-num">Pages</th>
            <th class="nad-num">Conversations</th>
            <th>First Seen</th>
            <th>Last Seen</th>
          </tr>
        </thead>
        <tbody class="nad-visitors-body">
          <tr><td colspan="8" class="nad-empty">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="nad-visitors-pagination"></div>
  </div>

  <!-- Visitor Journey overlay -->
  <div class="nad-journey-overlay" style="display:none;">
    <div class="nad-journey-panel">
      <div class="nad-detail-header">
        <button class="nad-journey-close">← Back</button>
        <div class="nad-journey-title">Visitor Journey</div>
      </div>
      <div class="nad-journey-meta"></div>
      <div class="nad-journey-body"></div>
    </div>
  </div>

  <!-- Detail side panel -->
  <div class="nad-detail-overlay" style="display:none;">
    <div class="nad-detail-panel">
      <div class="nad-detail-header">
        <button class="nad-detail-close">← Back</button>
        <div class="nad-detail-title"></div>
      </div>
      <div class="nad-detail-meta"></div>
      <div class="nad-detail-messages"></div>
    </div>
  </div>
</div>`);

		this._bind_events();
	}

	_bind_events() {
		const $r = this.$main;

		$r.find(".nad-refresh-btn").on("click", () => this._load_all());

		$r.find(".nad-trend-range").on("change", (e) => {
			this.state.trend_days = parseInt(e.target.value);
			this._load_trend();
		});

		$r.find(".nad-tab").on("click", (e) => {
			$r.find(".nad-tab").removeClass("active");
			$(e.target).addClass("active");
			this._render_dist_chart(this._dist_data, $(e.target).data("tab"));
		});

		$r.find(".nad-topics-search").on("input", frappe.utils.debounce(() => {
			this.state.topic_filter = $r.find(".nad-topics-search").val().trim();
			this._load_topics();
		}, 400));

		$r.find(".nad-apply-filter").on("click", () => {
			this.state.status_filter = $r.find(".nad-status-filter").val();
			this.state.category_filter = $r.find(".nad-category-filter").val();
			this.state.date_from = $r.find(".nad-date-from").val();
			this.state.date_to = $r.find(".nad-date-to").val();
			this.state.search = $r.find(".nad-search-input").val().trim();
			this.state.page = 1;
			this._load_engagement();
		});

		$r.find(".nad-clear-filter").on("click", () => {
			this.state.status_filter = "";
			this.state.category_filter = "";
			this.state.date_from = "";
			this.state.date_to = "";
			this.state.search = "";
			this.state.page = 1;
			$r.find(".nad-status-filter").val("");
			$r.find(".nad-category-filter").val("");
			$r.find(".nad-date-from").val("");
			$r.find(".nad-date-to").val("");
			$r.find(".nad-search-input").val("");
			this._load_engagement();
		});

		$r.find(".nad-detail-close").on("click", () => this._close_detail());

		$r.find(".nad-detail-overlay").on("click", (e) => {
			if ($(e.target).hasClass("nad-detail-overlay")) this._close_detail();
		});

		// Page visit report filter
		$r.find(".nad-pages-search").on("input", frappe.utils.debounce(() => {
			this.state.page_path_filter = $r.find(".nad-pages-search").val().trim();
			this._load_page_visits();
		}, 400));

		// Visitor list filters
		$r.find(".nad-visitor-search").on("input", frappe.utils.debounce(() => {
			this.state.visitor_search = $r.find(".nad-visitor-search").val().trim();
			this.state.visitor_page = 1;
			this._load_visitors();
		}, 400));

		$r.find(".nad-visitor-country").on("change", (e) => {
			this.state.visitor_country_filter = e.target.value;
			this.state.visitor_page = 1;
			this._load_visitors();
		});

		$r.find(".nad-visitor-clear").on("click", () => {
			this.state.visitor_search = "";
			this.state.visitor_country_filter = "";
			this.state.visitor_page = 1;
			$r.find(".nad-visitor-search").val("");
			$r.find(".nad-visitor-country").val("");
			this._load_visitors();
		});

		// Journey overlay close
		$r.find(".nad-journey-close").on("click", () => this._close_journey());

		$r.find(".nad-journey-overlay").on("click", (e) => {
			if ($(e.target).hasClass("nad-journey-overlay")) this._close_journey();
		});
	}

	// ── Data loaders ────────────────────────────────────────────────────────────
	_load_all() {
		this._load_kpis();
		this._load_trend();
		this._load_distribution();
		this._load_topics();
		this._load_filter_options();
		this._load_engagement();
		this._load_country_stats();
		this._load_page_visits();
		this._load_visitors();
	}

	_call(method, args) {
		return frappe.call({
			method: `digitz_ai_nexus_live.api.analytics.${method}`,
			args: args || {},
			freeze: false,
		});
	}

	_load_kpis() {
		this._call("get_overview_stats").then((r) => {
			const data = r.message || {};
			this.$main.find("[data-key]").each(function () {
				const key = $(this).data("key");
				const val = data[key];
				let display = val === undefined || val === null ? "0" : String(val);
				if (key === "escalation_rate") display = display + "%";
				$(this).find(".nad-kpi-value").text(display);
			});
		});
	}

	_load_trend() {
		this._call("get_conversation_trend", { days: this.state.trend_days }).then((r) => {
			this._render_trend_chart(r.message || []);
		});
	}

	_load_distribution() {
		this._call("get_category_distribution").then((r) => {
			this._dist_data = r.message || {};
			const active_tab = this.$main.find(".nad-tab.active").data("tab") || "status";
			this._render_dist_chart(this._dist_data, active_tab);
		});
	}

	_load_topics() {
		this.$main.find(".nad-topics-body").html('<tr><td colspan="6" class="nad-empty">Loading…</td></tr>');
		this._call("get_knowledge_topic_stats", {
			limit: 20,
			topic_filter: this.state.topic_filter || null,
		}).then((r) => {
			this._render_topics(r.message || []);
		});
	}

	_load_filter_options() {
		this._call("get_filter_options").then((r) => {
			const data = r.message || {};
			const $sc = this.$main.find(".nad-status-filter");
			const $cc = this.$main.find(".nad-category-filter");
			(data.statuses || []).forEach((s) => {
				$sc.append(`<option value="${s}">${s}</option>`);
			});
			(data.categories || []).forEach((c) => {
				$cc.append(`<option value="${c}">${c}</option>`);
			});
		});
	}

	_load_engagement() {
		this.$main.find(".nad-engagement-body").html('<tr><td colspan="8" class="nad-empty">Loading…</td></tr>');
		const s = this.state;
		this._call("get_visitor_engagement_list", {
			page: s.page,
			page_size: s.page_size,
			status_filter: s.status_filter || null,
			category_filter: s.category_filter || null,
			date_from: s.date_from || null,
			date_to: s.date_to || null,
			search: s.search || null,
		}).then((r) => {
			const data = r.message || {};
			this._render_engagement(data.rows || []);
			this._render_pagination(data);
		});
	}

	_load_detail(conversation_id) {
		this.$main.find(".nad-detail-messages").html('<div class="nad-empty">Loading…</div>');
		this._show_detail_panel(conversation_id, null);
		this._call("get_conversation_detail", { conversation_id }).then((r) => {
			const data = r.message || {};
			this._render_detail(data.conversation, data.messages || []);
		});
	}

	// ── Renderers ───────────────────────────────────────────────────────────────
	_render_trend_chart(rows) {
		const $wrap = this.$main.find(".nad-trend-chart");
		$wrap.empty();

		if (!rows.length) {
			$wrap.html('<div class="nad-empty">No data for selected period.</div>');
			return;
		}

		const max_val = Math.max(...rows.map((r) => r.total), 1);
		const bar_width = Math.max(4, Math.min(20, Math.floor(560 / rows.length) - 2));
		const height = 120;

		let bars = "";
		rows.forEach((r, i) => {
			const h = Math.round((r.total / max_val) * height);
			const hesc = Math.round((r.escalated / max_val) * height);
			const label = r.day.slice(5); // MM-DD
			bars += `
<div class="nad-bar-group" title="${r.day}: ${r.total} sessions, ${r.escalated} escalated">
  <div class="nad-bar-stack" style="height:${height}px">
    <div class="nad-bar-esc" style="height:${hesc}px"></div>
    <div class="nad-bar-total" style="height:${h - hesc}px"></div>
  </div>
  ${rows.length <= 30 ? `<div class="nad-bar-label">${i % 5 === 0 ? label : ""}</div>` : ""}
</div>`;
		});

		$wrap.html(`
<div class="nad-bar-chart">
  <div class="nad-bar-legend">
    <span class="nad-leg-dot nad-leg-total"></span> Sessions
    <span class="nad-leg-dot nad-leg-esc"></span> Escalated
  </div>
  <div class="nad-bars">${bars}</div>
</div>`);
	}

	_render_dist_chart(data, tab) {
		const $wrap = this.$main.find(".nad-dist-chart");
		$wrap.empty();
		if (!data) return;

		const rows = data[`by_${tab}`] || [];
		if (!rows.length) {
			$wrap.html('<div class="nad-empty">No data.</div>');
			return;
		}

		const total = rows.reduce((s, r) => s + (r.value || 0), 0) || 1;
		const colors = ["#5b7cf6","#38c4b8","#f5a623","#e45f5f","#a86dd4","#4db87a","#f06292","#26c6da"];

		let items = "";
		rows.forEach((r, i) => {
			const pct = Math.round((r.value / total) * 100);
			items += `
<div class="nad-dist-row">
  <div class="nad-dist-label" title="${r.label}">${_short(r.label, 22)}</div>
  <div class="nad-dist-bar-wrap">
    <div class="nad-dist-bar" style="width:${pct}%;background:${colors[i % colors.length]}"></div>
  </div>
  <div class="nad-dist-count">${r.value} <span class="nad-dist-pct">(${pct}%)</span></div>
</div>`;
		});

		$wrap.html(`<div class="nad-dist-list">${items}</div>`);
	}

	_render_topics(rows) {
		const $tbody = this.$main.find(".nad-topics-body");
		if (!rows.length) {
			$tbody.html('<tr><td colspan="6" class="nad-empty">No knowledge topics captured yet. Topics will appear as the AI answers questions using retrieved knowledge.</td></tr>');
			return;
		}
		let html = "";
		rows.forEach((r, i) => {
			html += `<tr>
  <td class="nad-num">${i + 1}</td>
  <td><strong>${_esc(r.topic_label || "—")}</strong></td>
  <td>${_esc(r.knowledge_unit || "—")}</td>
  <td class="nad-num"><span class="nad-badge">${r.hit_count}</span></td>
  <td class="nad-num">${r.unique_conversations}</td>
  <td class="nad-num">${r.avg_score ? parseFloat(r.avg_score).toFixed(3) : "—"}</td>
</tr>`;
		});
		$tbody.html(html);
	}

	_render_engagement(rows) {
		const $tbody = this.$main.find(".nad-engagement-body");
		if (!rows.length) {
			$tbody.html('<tr><td colspan="8" class="nad-empty">No conversations match the current filters.</td></tr>');
			return;
		}

		const STATUS_COLORS = {
			Open: "blue", Responding: "teal", Waiting: "yellow",
			Escalated: "red", Closed: "gray", "Handed Over": "purple",
		};

		let html = "";
		rows.forEach((r) => {
			const visitor = r.visitor_name || r.visitor_email || `${r.user_type || "Guest"}`;
			const email = r.visitor_email ? `<div class="nad-sub">${_esc(r.visitor_email)}</div>` : "";
			const status_color = STATUS_COLORS[r.status] || "gray";
			const esc = r.escalation_status && r.escalation_status !== "None"
				? `<span class="nad-pill nad-pill-red">${_esc(r.escalation_status)}</span>`
				: `<span class="nad-pill nad-pill-gray">—</span>`;
			const dur = _fmt_duration(r.duration_seconds);
			const started = r.started_on ? frappe.datetime.str_to_user(r.started_on) : "—";
			const cat = r.chat_category ? `<span class="nad-chip">${_short(r.chat_category, 18)}</span>` : "—";
			const ch = r.channel ? `<span class="nad-chip nad-chip-alt">${_short(r.channel, 16)}</span>` : "—";

			html += `<tr class="nad-engagement-row" data-conv="${_esc(r.conversation_id)}">
  <td>
    <div class="nad-visitor-name">${_esc(_short(visitor, 22))}</div>
    ${email}
  </td>
  <td>${cat}</td>
  <td>${ch}</td>
  <td class="nad-num">${r.message_count || 0}</td>
  <td><span class="nad-pill nad-pill-${status_color}">${_esc(r.status)}</span></td>
  <td>${esc}</td>
  <td class="nad-num">${dur}</td>
  <td class="nad-ts">${started}</td>
</tr>`;
		});

		$tbody.html(html);

		this.$main.find(".nad-engagement-row").on("click", (e) => {
			const conv_id = $(e.currentTarget).data("conv");
			if (conv_id) this._load_detail(conv_id);
		});
	}

	_render_pagination(data) {
		const $pag = this.$main.find(".nad-pagination");
		if (!data.total_pages || data.total_pages <= 1) {
			$pag.empty();
			return;
		}

		const cur = data.page || 1;
		const total = data.total_pages;
		const total_rows = data.total;

		let btns = `<span class="nad-pag-info">Showing ${((cur-1)*data.page_size)+1}–${Math.min(cur*data.page_size, total_rows)} of ${total_rows}</span>`;
		btns += `<button class="nad-pag-btn" data-page="${cur - 1}" ${cur <= 1 ? "disabled" : ""}>← Prev</button>`;
		for (let p = Math.max(1, cur - 2); p <= Math.min(total, cur + 2); p++) {
			btns += `<button class="nad-pag-btn ${p === cur ? "active" : ""}" data-page="${p}">${p}</button>`;
		}
		btns += `<button class="nad-pag-btn" data-page="${cur + 1}" ${cur >= total ? "disabled" : ""}>Next →</button>`;

		$pag.html(`<div class="nad-pag-row">${btns}</div>`);
		$pag.find(".nad-pag-btn:not([disabled])").on("click", (e) => {
			this.state.page = parseInt($(e.target).data("page"));
			this._load_engagement();
		});
	}

	_show_detail_panel(conversation_id, conv) {
		const $overlay = this.$main.find(".nad-detail-overlay");
		const title = conv
			? (conv.visitor_name || conv.visitor_email || `Conversation ${conversation_id}`)
			: `Conversation ${conversation_id}`;
		$overlay.find(".nad-detail-title").text(title);
		$overlay.show();
		this.state.detail_open = true;
	}

	_render_detail(conv, messages) {
		if (!conv) return;
		const $overlay = this.$main.find(".nad-detail-overlay");

		const title = conv.visitor_name || conv.visitor_email || `Conversation ${conv.conversation_id}`;
		$overlay.find(".nad-detail-title").text(title);

		const STATUS_COLORS = {
			Open: "blue", Responding: "teal", Waiting: "yellow",
			Escalated: "red", Closed: "gray", "Handed Over": "purple",
		};

		$overlay.find(".nad-detail-meta").html(`
<div class="nad-detail-meta-grid">
  <div><span class="nad-meta-label">Status</span><span class="nad-pill nad-pill-${STATUS_COLORS[conv.status] || "gray"}">${conv.status}</span></div>
  <div><span class="nad-meta-label">Category</span>${_esc(conv.chat_category || "—")}</div>
  <div><span class="nad-meta-label">Channel</span>${_esc(conv.channel || "—")}</div>
  <div><span class="nad-meta-label">Escalation</span>${_esc(conv.escalation_status || "—")}</div>
  <div><span class="nad-meta-label">Started</span>${conv.started_on ? frappe.datetime.str_to_user(conv.started_on) : "—"}</div>
  <div><span class="nad-meta-label">Email</span>${_esc(conv.visitor_email || "—")}</div>
</div>`);

		let msgs_html = "";
		messages.forEach((m) => {
			const cls = m.sender_type === "Visitor" ? "nad-msg-visitor"
				: m.sender_type === "Human Agent" ? "nad-msg-agent"
				: m.sender_type === "System" ? "nad-msg-system"
				: "nad-msg-ai";
			const label = m.sender_type === "Visitor" ? "Visitor"
				: m.sender_type === "Human Agent" ? "Agent"
				: m.sender_type === "System" ? "System"
				: "AI";
			const ts = m.message_time ? frappe.datetime.str_to_user(m.message_time) : "";
			const sources = (m.sources || []);
			let src_html = "";
			if (sources.length) {
				const src_items = sources.map((s) =>
					`<span class="nad-source-tag" title="${_esc(s.topic || s.knowledge_title || s.chunk)}">${_esc(_short(s.topic || s.knowledge_title || s.knowledge_unit || s.chunk, 28))}</span>`
				).join("");
				src_html = `<div class="nad-msg-sources">Sources: ${src_items}</div>`;
			}
			msgs_html += `
<div class="nad-msg-wrap ${cls}">
  <div class="nad-msg-label">${label}</div>
  <div class="nad-msg-bubble">${_esc(m.message || "")}</div>
  ${src_html}
  <div class="nad-msg-ts">${ts}</div>
</div>`;
		});

		$overlay.find(".nad-detail-messages").html(msgs_html || '<div class="nad-empty">No messages.</div>');
	}

	_close_detail() {
		this.$main.find(".nad-detail-overlay").hide();
		this.state.detail_open = false;
	}

	// ── Country / Page / Visitors loaders ───────────────────────────────────────
	_load_country_stats() {
		this.$main.find(".nad-country-body").html('<tr><td colspan="6" class="nad-empty">Loading…</td></tr>');
		this._call("get_country_stats").then((r) => {
			this._render_country_stats(r.message || []);
			// Populate visitor country filter with unique countries
			const countries = (r.message || []).map((row) => row.country).filter(Boolean);
			const $sel = this.$main.find(".nad-visitor-country");
			const existing = [...$sel.find("option")].map((o) => o.value);
			countries.forEach((c) => {
				if (!existing.includes(c)) $sel.append(`<option value="${c}">${c}</option>`);
			});
		});
	}

	_load_page_visits() {
		this.$main.find(".nad-pages-body").html('<tr><td colspan="5" class="nad-empty">Loading…</td></tr>');
		this._call("get_page_visit_stats", {
			limit: 25,
			path_filter: this.state.page_path_filter || null,
		}).then((r) => {
			this._render_page_visits(r.message || []);
		});
	}

	_load_visitors() {
		this.$main.find(".nad-visitors-body").html('<tr><td colspan="8" class="nad-empty">Loading…</td></tr>');
		const s = this.state;
		this._call("get_visitor_list", {
			page: s.visitor_page,
			page_size: s.visitor_page_size,
			country_filter: s.visitor_country_filter || null,
			search: s.visitor_search || null,
		}).then((r) => {
			const data = r.message || {};
			this._render_visitors(data.rows || []);
			this._render_visitor_pagination(data);
		});
	}

	_load_visitor_journey(visitor_id) {
		const $overlay = this.$main.find(".nad-journey-overlay");
		$overlay.find(".nad-journey-body").html('<div class="nad-empty">Loading journey…</div>');
		$overlay.show();
		this.state.journey_open = true;
		this._call("get_visitor_journey", { visitor_id }).then((r) => {
			const data = r.message || {};
			this._render_journey(data.visitor, data.sessions || []);
		});
	}

	// ── Country / Page / Visitors renderers ─────────────────────────────────────
	_render_country_stats(rows) {
		const $tbody = this.$main.find(".nad-country-body");
		if (!rows.length) {
			$tbody.html('<tr><td colspan="6" class="nad-empty">No country data yet. Visitor analytics must be enabled and country lookup configured.</td></tr>');
			return;
		}
		let html = "";
		rows.forEach((r, i) => {
			html += `<tr>
  <td class="nad-num">${i + 1}</td>
  <td><strong>${_esc(r.country)}</strong></td>
  <td class="nad-num">${r.session_count || 0}</td>
  <td class="nad-num">${r.visitor_count || 0}</td>
  <td class="nad-num">${r.conversation_count || 0}</td>
  <td class="nad-num">${_fmt_duration(r.avg_duration_seconds)}</td>
</tr>`;
		});
		$tbody.html(html);
	}

	_render_page_visits(rows) {
		const $tbody = this.$main.find(".nad-pages-body");
		if (!rows.length) {
			$tbody.html('<tr><td colspan="5" class="nad-empty">No page visit data yet. The visitor tracker must be enabled on your website.</td></tr>');
			return;
		}
		let html = "";
		rows.forEach((r) => {
			const title = r.page_title ? `<div class="nad-sub">${_esc(_short(r.page_title, 50))}</div>` : "";
			html += `<tr>
  <td>
    <div class="nad-visitor-name">${_esc(r.page_path)}</div>
    ${title}
  </td>
  <td class="nad-num"><span class="nad-badge">${r.visit_count}</span></td>
  <td class="nad-num">${r.unique_visitors || 0}</td>
  <td class="nad-num">${_fmt_duration(r.avg_duration_seconds)}</td>
  <td class="nad-num">${_fmt_duration(r.avg_active_seconds)}</td>
</tr>`;
		});
		$tbody.html(html);
	}

	_render_visitors(rows) {
		const $tbody = this.$main.find(".nad-visitors-body");
		if (!rows.length) {
			$tbody.html('<tr><td colspan="8" class="nad-empty">No visitors match the current filters.</td></tr>');
			return;
		}
		let html = "";
		rows.forEach((r) => {
			const short_id = r.visitor_id ? r.visitor_id.slice(0, 14) + "…" : "—";
			const device = [r.device_type, r.browser].filter(Boolean).join(" / ") || "—";
			html += `<tr class="nad-visitor-row" data-vid="${_esc(r.visitor_id)}">
  <td>
    <code class="nad-vid">${_esc(short_id)}</code>
    <div class="nad-sub">${_esc(r.visitor_type || "Anonymous")}</div>
  </td>
  <td>${_esc(r.country || "—")}</td>
  <td>${_esc(device)}</td>
  <td class="nad-num">${r.session_count || 0}</td>
  <td class="nad-num">${r.page_count || 0}</td>
  <td class="nad-num">${r.conversation_count || 0}</td>
  <td class="nad-ts">${r.first_seen ? frappe.datetime.str_to_user(r.first_seen) : "—"}</td>
  <td class="nad-ts">${r.last_seen ? frappe.datetime.str_to_user(r.last_seen) : "—"}</td>
</tr>`;
		});
		$tbody.html(html);

		this.$main.find(".nad-visitor-row").on("click", (e) => {
			const vid = $(e.currentTarget).data("vid");
			if (vid) this._load_visitor_journey(vid);
		});
	}

	_render_visitor_pagination(data) {
		const $pag = this.$main.find(".nad-visitors-pagination");
		if (!data.total_pages || data.total_pages <= 1) { $pag.empty(); return; }

		const cur = data.page || 1;
		const total = data.total_pages;
		const total_rows = data.total;

		let btns = `<span class="nad-pag-info">Showing ${((cur-1)*data.page_size)+1}–${Math.min(cur*data.page_size, total_rows)} of ${total_rows}</span>`;
		btns += `<button class="nad-pag-btn" data-page="${cur - 1}" ${cur <= 1 ? "disabled" : ""}>← Prev</button>`;
		for (let p = Math.max(1, cur - 2); p <= Math.min(total, cur + 2); p++) {
			btns += `<button class="nad-pag-btn ${p === cur ? "active" : ""}" data-page="${p}">${p}</button>`;
		}
		btns += `<button class="nad-pag-btn" data-page="${cur + 1}" ${cur >= total ? "disabled" : ""}>Next →</button>`;

		$pag.html(`<div class="nad-pag-row">${btns}</div>`);
		$pag.find(".nad-pag-btn:not([disabled])").on("click", (e) => {
			this.state.visitor_page = parseInt($(e.target).data("page"));
			this._load_visitors();
		});
	}

	_render_journey(visitor, sessions) {
		const $overlay = this.$main.find(".nad-journey-overlay");
		if (!visitor) {
			$overlay.find(".nad-journey-body").html('<div class="nad-empty">Visitor not found.</div>');
			return;
		}

		const short_id = visitor.visitor_id ? visitor.visitor_id.slice(0, 18) + "…" : "—";
		$overlay.find(".nad-journey-title").text(`Visitor: ${short_id}`);

		const device_str = [visitor.device_type, visitor.browser, visitor.os].filter(Boolean).join(" · ") || "Unknown";
		$overlay.find(".nad-journey-meta").html(`
<div class="nad-detail-meta-grid" style="padding:14px 20px;border-bottom:1px solid var(--border-color)">
  <div><span class="nad-meta-label">Type</span>${_esc(visitor.visitor_type || "Anonymous")}</div>
  <div><span class="nad-meta-label">Country</span>${_esc(visitor.country || "—")}</div>
  <div><span class="nad-meta-label">City</span>${_esc(visitor.city || "—")}</div>
  <div><span class="nad-meta-label">Device</span>${_esc(device_str)}</div>
  <div><span class="nad-meta-label">First Seen</span>${visitor.first_seen ? frappe.datetime.str_to_user(visitor.first_seen) : "—"}</div>
  <div><span class="nad-meta-label">Last Seen</span>${visitor.last_seen ? frappe.datetime.str_to_user(visitor.last_seen) : "—"}</div>
</div>`);

		if (!sessions.length) {
			$overlay.find(".nad-journey-body").html('<div class="nad-empty" style="padding:24px">No sessions recorded for this visitor.</div>');
			return;
		}

		let body_html = "";
		sessions.forEach((sess, si) => {
			const sess_label = `Session ${si + 1}`;
			const sess_start = sess.started_on ? frappe.datetime.str_to_user(sess.started_on) : "—";
			const sess_dur = _fmt_duration(sess.total_duration_seconds);
			const landing = sess.landing_page || "—";

			// Pages in this session
			let pages_html = "";
			(sess.pages || []).forEach((pg) => {
				pages_html += `
<div class="nad-journey-page">
  <span class="nad-journey-page-path" title="${_esc(pg.page_url || pg.page_path)}">${_esc(_short(pg.page_path, 50))}</span>
  <span class="nad-journey-page-dur">${_fmt_duration(pg.duration_seconds)}</span>
  <span class="nad-pill nad-pill-gray" style="font-size:10px">${_esc(pg.status || "")}</span>
</div>`;
			});
			if (!pages_html) pages_html = '<div class="nad-empty" style="font-size:12px;padding:6px 0">No page visits recorded.</div>';

			// Conversations in this session
			let convs_html = "";
			(sess.conversations || []).forEach((conv) => {
				let msgs_html = "";
				(conv.messages || []).forEach((msg) => {
					const cls = msg.sender_type === "Visitor" ? "nad-jmsg-visitor"
						: msg.sender_type === "Human Agent" ? "nad-jmsg-agent"
						: msg.sender_type === "System" ? "nad-jmsg-system"
						: "nad-jmsg-ai";
					msgs_html += `<div class="nad-jmsg ${cls}">
  <span class="nad-jmsg-label">${_esc(msg.sender_type || "")}</span>
  <span class="nad-jmsg-text">${_esc(_short(msg.message || "", 200))}</span>
</div>`;
				});

				convs_html += `
<div class="nad-journey-conv">
  <div class="nad-journey-conv-header">
    <span class="nad-chip">${_esc(conv.chat_category || "General")}</span>
    <span class="nad-pill nad-pill-${conv.status === "Closed" ? "gray" : conv.status === "Escalated" ? "red" : "blue"}">${_esc(conv.status || "")}</span>
    <span class="nad-ts">${conv.started_on ? frappe.datetime.str_to_user(conv.started_on) : "—"}</span>
  </div>
  <div class="nad-journey-messages">${msgs_html || '<span class="nad-empty" style="font-size:11px">No messages</span>'}</div>
</div>`;
			});
			if (!convs_html) convs_html = '<div class="nad-empty" style="font-size:12px;padding:6px 0">No conversations in this session.</div>';

			body_html += `
<details class="nad-journey-session" open>
  <summary class="nad-journey-session-header">
    <span class="nad-journey-session-label">${sess_label}</span>
    <span class="nad-ts">${sess_start}</span>
    <span class="nad-chip">${sess_dur}</span>
    <span class="nad-pill nad-pill-${sess.status === "Completed" ? "teal" : sess.status === "Abandoned" ? "gray" : "blue"}">${_esc(sess.status || "")}</span>
    <span class="nad-journey-session-pages">${(sess.pages || []).length} pages · ${(sess.conversations || []).length} chats</span>
  </summary>
  <div class="nad-journey-session-body">
    <div class="nad-journey-section-title">Pages Visited</div>
    <div class="nad-journey-pages">${pages_html}</div>
    <div class="nad-journey-section-title" style="margin-top:12px">Conversations</div>
    ${convs_html}
  </div>
</details>`;
		});

		$overlay.find(".nad-journey-body").html(body_html);
	}

	_close_journey() {
		this.$main.find(".nad-journey-overlay").hide();
		this.state.journey_open = false;
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function _esc(str) {
	if (!str) return "";
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function _short(str, len) {
	if (!str) return "";
	return str.length > len ? str.slice(0, len) + "…" : str;
}

function _fmt_duration(secs) {
	if (!secs || secs < 0) return "—";
	const m = Math.floor(secs / 60);
	const s = Math.floor(secs % 60);
	if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

// ── CSS ─────────────────────────────────────────────────────────────────────
const NAD_CSS = `
.nad-root { font-family: var(--font-stack); color: var(--text-color); padding: 0 0 60px; }

/* Header */
.nad-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 0 14px; border-bottom: 1px solid var(--border-color); margin-bottom: 20px;
}
.nad-brand { display: flex; align-items: center; gap: 10px; }
.nad-logo { font-size: 22px; color: #5b7cf6; }
.nad-title { font-size: 18px; font-weight: 700; color: var(--heading-color); }
.nad-header-actions { display: flex; gap: 10px; align-items: center; }

/* Controls */
.nad-select, .nad-input {
  height: 32px; padding: 0 10px; border: 1px solid var(--border-color);
  border-radius: 6px; font-size: 13px; background: var(--card-bg);
  color: var(--text-color); outline: none;
}
.nad-select:focus, .nad-input:focus { border-color: #5b7cf6; }
.nad-btn {
  height: 32px; padding: 0 14px; border-radius: 6px; border: none;
  cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.15s;
}
.nad-btn-primary { background: #5b7cf6; color: #fff; }
.nad-btn-primary:hover { background: #4a6be0; }
.nad-btn-ghost { background: var(--bg-color); border: 1px solid var(--border-color); color: var(--text-color); }
.nad-btn-ghost:hover { background: var(--border-color); }

/* KPI row */
.nad-kpi-row {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 14px; margin-bottom: 20px;
}
.nad-kpi {
  background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 10px; padding: 16px 18px; text-align: center;
}
.nad-kpi-value { font-size: 28px; font-weight: 700; color: #5b7cf6; line-height: 1; }
.nad-kpi-label { font-size: 11px; color: var(--text-muted); margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px; }

/* Charts row */
.nad-charts-row { display: grid; grid-template-columns: 3fr 2fr; gap: 14px; margin-bottom: 20px; }
.nad-card {
  background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 10px; padding: 18px 20px;
}
.nad-card-title { font-size: 13px; font-weight: 600; color: var(--heading-color); margin-bottom: 14px; }
.nad-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 8px; }
.nad-chart-card { min-height: 200px; }

/* Trend chart */
.nad-bar-chart { overflow-x: auto; }
.nad-bar-legend { font-size: 11px; color: var(--text-muted); margin-bottom: 8px; display: flex; gap: 14px; }
.nad-leg-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.nad-leg-total { background: #5b7cf6; }
.nad-leg-esc { background: #e45f5f; }
.nad-bars { display: flex; align-items: flex-end; gap: 2px; min-height: 120px; }
.nad-bar-group { display: flex; flex-direction: column; align-items: center; }
.nad-bar-stack { display: flex; flex-direction: column; justify-content: flex-end; width: 14px; }
.nad-bar-total { background: #5b7cf6; border-radius: 2px 2px 0 0; min-height: 2px; }
.nad-bar-esc { background: #e45f5f; min-height: 0; }
.nad-bar-label { font-size: 9px; color: var(--text-muted); margin-top: 3px; writing-mode: vertical-rl; transform: rotate(180deg); height: 28px; }

/* Distribution chart */
.nad-dist-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
.nad-tab {
  padding: 4px 12px; border-radius: 20px; border: 1px solid var(--border-color);
  background: transparent; font-size: 12px; cursor: pointer; color: var(--text-muted);
  transition: all 0.15s;
}
.nad-tab.active { background: #5b7cf6; color: #fff; border-color: #5b7cf6; }
.nad-dist-list { display: flex; flex-direction: column; gap: 8px; }
.nad-dist-row { display: grid; grid-template-columns: 120px 1fr 70px; gap: 8px; align-items: center; }
.nad-dist-label { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nad-dist-bar-wrap { height: 10px; background: var(--bg-color); border-radius: 5px; overflow: hidden; }
.nad-dist-bar { height: 100%; border-radius: 5px; transition: width 0.4s; }
.nad-dist-count { font-size: 12px; font-weight: 600; text-align: right; }
.nad-dist-pct { color: var(--text-muted); font-weight: 400; }

/* Topics table */
.nad-topics-card { margin-bottom: 20px; }
.nad-topics-search { width: 220px; }
.nad-topics-table-wrap { overflow-x: auto; }

/* Engagement table */
.nad-engagement-card { margin-bottom: 20px; }
.nad-engagement-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.nad-search-input { width: 200px; }
.nad-date-from, .nad-date-to { width: 140px; }
.nad-engagement-table-wrap { overflow-x: auto; margin-bottom: 14px; }
.nad-engagement-row { cursor: pointer; transition: background 0.12s; }
.nad-engagement-row:hover td { background: var(--bg-light-gray) !important; }

/* Shared table */
.nad-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.nad-table th {
  text-align: left; padding: 8px 10px; font-size: 11px; font-weight: 600;
  color: var(--text-muted); border-bottom: 2px solid var(--border-color);
  text-transform: uppercase; letter-spacing: 0.4px; white-space: nowrap;
}
.nad-table td { padding: 9px 10px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
.nad-table tr:last-child td { border-bottom: none; }
.nad-num { text-align: right; }
.nad-empty { color: var(--text-muted); font-size: 13px; padding: 24px; text-align: center; }

/* Badges & pills */
.nad-badge {
  display: inline-block; background: #5b7cf6; color: #fff;
  border-radius: 12px; padding: 2px 10px; font-size: 12px; font-weight: 600;
}
.nad-pill {
  display: inline-block; border-radius: 12px; padding: 2px 10px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.nad-pill-blue { background: #e8ecff; color: #3a5ad9; }
.nad-pill-teal { background: #e0f7f5; color: #1a8a80; }
.nad-pill-yellow { background: #fff8e0; color: #b38b00; }
.nad-pill-red { background: #fdecea; color: #c0392b; }
.nad-pill-gray { background: var(--bg-light-gray); color: var(--text-muted); }
.nad-pill-purple { background: #f3eaff; color: #7b3fa0; }
.nad-chip {
  display: inline-block; background: #eef0fd; color: #4a5fa3; border-radius: 4px;
  padding: 2px 7px; font-size: 11px; white-space: nowrap;
}
.nad-chip-alt { background: #e8f8f5; color: #1a7a70; }
.nad-visitor-name { font-weight: 500; font-size: 13px; }
.nad-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.nad-ts { font-size: 11px; color: var(--text-muted); white-space: nowrap; }

/* Pagination */
.nad-pag-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.nad-pag-info { font-size: 12px; color: var(--text-muted); margin-right: 8px; }
.nad-pag-btn {
  min-width: 34px; height: 30px; padding: 0 10px; border-radius: 6px;
  border: 1px solid var(--border-color); background: var(--card-bg);
  font-size: 12px; cursor: pointer; color: var(--text-color);
}
.nad-pag-btn.active { background: #5b7cf6; color: #fff; border-color: #5b7cf6; font-weight: 600; }
.nad-pag-btn[disabled] { opacity: 0.4; cursor: default; }
.nad-pag-btn:not([disabled]):not(.active):hover { background: var(--bg-light-gray); }

/* Detail panel overlay */
.nad-detail-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.35);
  z-index: 1000; display: flex; justify-content: flex-end;
}
.nad-detail-panel {
  width: 520px; max-width: 95vw; height: 100vh;
  background: var(--card-bg); display: flex; flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,0.15); overflow: hidden;
}
.nad-detail-header {
  display: flex; align-items: center; gap: 12px; padding: 16px 20px;
  border-bottom: 1px solid var(--border-color); flex-shrink: 0;
}
.nad-detail-close {
  background: none; border: none; cursor: pointer; font-size: 13px;
  color: var(--text-muted); padding: 4px 8px; border-radius: 4px;
}
.nad-detail-close:hover { background: var(--bg-light-gray); }
.nad-detail-title { font-weight: 600; font-size: 14px; color: var(--heading-color); }
.nad-detail-meta { padding: 14px 20px; border-bottom: 1px solid var(--border-color); flex-shrink: 0; }
.nad-detail-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px; }
.nad-meta-label { color: var(--text-muted); margin-right: 6px; }
.nad-detail-messages { flex: 1; overflow-y: auto; padding: 14px 20px; display: flex; flex-direction: column; gap: 12px; }

/* Messages in detail */
.nad-msg-wrap { max-width: 85%; }
.nad-msg-visitor { align-self: flex-end; }
.nad-msg-ai { align-self: flex-start; }
.nad-msg-agent { align-self: flex-start; }
.nad-msg-system { align-self: center; max-width: 95%; text-align: center; }
.nad-msg-label { font-size: 10px; color: var(--text-muted); margin-bottom: 3px; font-weight: 600; text-transform: uppercase; }
.nad-msg-visitor .nad-msg-label { text-align: right; }
.nad-msg-bubble {
  padding: 9px 13px; border-radius: 10px; font-size: 13px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word;
}
.nad-msg-visitor .nad-msg-bubble { background: #5b7cf6; color: #fff; border-radius: 10px 10px 2px 10px; }
.nad-msg-ai .nad-msg-bubble { background: var(--bg-light-gray); border-radius: 10px 10px 10px 2px; }
.nad-msg-agent .nad-msg-bubble { background: #e0f5eb; color: #1a6e3d; border-radius: 10px 10px 10px 2px; }
.nad-msg-system .nad-msg-bubble { background: #fff8e0; color: #7a6000; font-size: 12px; border-radius: 8px; }
.nad-msg-ts { font-size: 10px; color: var(--text-muted); margin-top: 3px; }
.nad-msg-visitor .nad-msg-ts { text-align: right; }
.nad-msg-sources { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.nad-source-tag {
  font-size: 10px; background: #eef0fd; color: #4a5fa3; border-radius: 4px;
  padding: 2px 7px; border: 1px solid #d0d8f8; cursor: default;
}

/* Country / Page / Visitors cards */
.nad-country-card, .nad-pages-card, .nad-visitors-card { margin-bottom: 20px; }
.nad-country-table-wrap, .nad-pages-table-wrap, .nad-visitors-table-wrap { overflow-x: auto; margin-bottom: 14px; }
.nad-pages-search { width: 200px; }
.nad-vid { font-family: monospace; font-size: 11px; background: var(--bg-light-gray); padding: 2px 5px; border-radius: 3px; }
.nad-visitor-row { cursor: pointer; transition: background 0.12s; }
.nad-visitor-row:hover td { background: var(--bg-light-gray) !important; }

/* Journey overlay */
.nad-journey-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.35);
  z-index: 1000; display: flex; justify-content: flex-end;
}
.nad-journey-panel {
  width: 620px; max-width: 95vw; height: 100vh;
  background: var(--card-bg); display: flex; flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,0.15); overflow: hidden;
}
.nad-journey-meta { flex-shrink: 0; }
.nad-journey-title { font-weight: 600; font-size: 14px; color: var(--heading-color); }
.nad-journey-body { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }

/* Session accordion */
.nad-journey-session { border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
.nad-journey-session-header {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 14px; cursor: pointer; list-style: none;
  background: var(--bg-light-gray); font-size: 13px;
}
.nad-journey-session-header::-webkit-details-marker { display: none; }
.nad-journey-session-label { font-weight: 600; color: var(--heading-color); margin-right: 4px; }
.nad-journey-session-pages { font-size: 11px; color: var(--text-muted); margin-left: auto; }
.nad-journey-session-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.nad-journey-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.4px; margin-bottom: 4px; }

/* Page rows within journey */
.nad-journey-page {
  display: flex; align-items: center; gap: 8px; font-size: 12px;
  padding: 4px 0; border-bottom: 1px dashed var(--border-color);
}
.nad-journey-page:last-child { border-bottom: none; }
.nad-journey-page-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nad-journey-page-dur { font-size: 11px; color: var(--text-muted); white-space: nowrap; }

/* Conversations within journey */
.nad-journey-conv { border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden; margin-top: 4px; }
.nad-journey-conv-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 6px 10px; background: var(--bg-light-gray); }
.nad-journey-messages { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; max-height: 300px; overflow-y: auto; }
.nad-jmsg { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; }
.nad-jmsg-label { font-weight: 600; min-width: 68px; font-size: 10px; text-transform: uppercase; color: var(--text-muted); padding-top: 2px; }
.nad-jmsg-text { flex: 1; word-break: break-word; line-height: 1.4; }
.nad-jmsg-visitor .nad-jmsg-label { color: #5b7cf6; }
.nad-jmsg-agent .nad-jmsg-label { color: #1a6e3d; }
.nad-jmsg-ai .nad-jmsg-label { color: #7b3fa0; }
.nad-jmsg-system { opacity: 0.6; font-size: 11px; }
`;

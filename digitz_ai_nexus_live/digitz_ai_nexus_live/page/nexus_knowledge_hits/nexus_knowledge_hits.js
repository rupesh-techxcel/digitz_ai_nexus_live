frappe.pages["nexus_knowledge_hits"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Knowledge Hits",
		single_column: true,
	});
	window._nkh = new NexusKnowledgeHits(page, wrapper);
};

class NexusKnowledgeHits {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.$main = $(wrapper).find(".page-content");
		this.state = {
			page: 1,
			page_size: 50,
			topic_filter: "",
			unit_filter: "",
			date_from: "",
			date_to: "",
			search: "",
			detail_name: null,
		};
		this._build();
		this._load_filter_options();
		this._load_all();
	}

	// ── Skeleton ────────────────────────────────────────────────────────────────
	_build() {
		this.$main.html(`
<div class="nkh-root">
  <style>${NKH_CSS}</style>

  <!-- Header bar -->
  <div class="nkh-header">
    <div class="nkh-brand">
      <span class="nkh-logo">◈</span>
      <div>
        <div class="nkh-title">Knowledge Hits</div>
        <div class="nkh-subtitle">Per-response knowledge access log — every chunk retrieved by the AI</div>
      </div>
    </div>
    <div class="nkh-header-actions">
      <a class="nkh-btn nkh-btn-ghost" href="/app/nexus_analytics_dashboard">← Analytics Dashboard</a>
      <button class="nkh-btn nkh-btn-ghost nkh-refresh-btn">↻ Refresh</button>
    </div>
  </div>

  <!-- KPI strip -->
  <div class="nkh-kpi-row">
    <div class="nkh-kpi" data-key="total_hits">
      <div class="nkh-kpi-value">—</div>
      <div class="nkh-kpi-label">Total Hits</div>
    </div>
    <div class="nkh-kpi" data-key="unique_topics">
      <div class="nkh-kpi-value">—</div>
      <div class="nkh-kpi-label">Unique Topics</div>
    </div>
    <div class="nkh-kpi" data-key="unique_units">
      <div class="nkh-kpi-value">—</div>
      <div class="nkh-kpi-label">Knowledge Units</div>
    </div>
    <div class="nkh-kpi" data-key="unique_conversations">
      <div class="nkh-kpi-value">—</div>
      <div class="nkh-kpi-label">Conversations</div>
    </div>
    <div class="nkh-kpi" data-key="avg_score">
      <div class="nkh-kpi-value">—</div>
      <div class="nkh-kpi-label">Avg Retrieval Score</div>
    </div>
    <div class="nkh-kpi" data-key="avg_final_score">
      <div class="nkh-kpi-value">—</div>
      <div class="nkh-kpi-label">Avg Final Score</div>
    </div>
  </div>

  <!-- Topic chart -->
  <div class="nkh-card nkh-chart-card">
    <div class="nkh-card-title">Top Topics by Hit Count</div>
    <div class="nkh-topic-chart"></div>
  </div>

  <!-- Filters + table -->
  <div class="nkh-card nkh-table-card">
    <div class="nkh-filters">
      <input class="nkh-search nkh-input" placeholder="Search topic, title, chunk, path…" />
      <select class="nkh-unit-filter nkh-select"><option value="">All Knowledge Units</option></select>
      <input class="nkh-topic-input nkh-input" placeholder="Filter by topic…" />
      <input class="nkh-date-from nkh-input" type="date" title="From date" />
      <input class="nkh-date-to nkh-input" type="date" title="To date" />
      <button class="nkh-btn nkh-btn-primary nkh-apply-btn">Apply</button>
      <button class="nkh-btn nkh-btn-ghost nkh-clear-btn">Clear</button>
    </div>

    <div class="nkh-table-wrap">
      <table class="nkh-table">
        <thead>
          <tr>
            <th>Hit Time</th>
            <th>Topic</th>
            <th>Knowledge Title</th>
            <th>Knowledge Unit</th>
            <th>Context Path</th>
            <th class="nkh-num">Score</th>
            <th class="nkh-num">Final Score</th>
            <th>Conversation</th>
          </tr>
        </thead>
        <tbody class="nkh-tbody">
          <tr><td colspan="8" class="nkh-empty">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="nkh-pagination"></div>
  </div>

  <!-- Detail side panel -->
  <div class="nkh-detail-overlay" style="display:none;">
    <div class="nkh-detail-panel">
      <div class="nkh-detail-header">
        <button class="nkh-detail-close">← Back</button>
        <div class="nkh-detail-title">Knowledge Hit Detail</div>
      </div>
      <div class="nkh-detail-body"></div>
    </div>
  </div>
</div>`);

		this._bind_events();
	}

	_bind_events() {
		const $r = this.$main;

		$r.find(".nkh-refresh-btn").on("click", () => this._load_all());

		$r.find(".nkh-apply-btn").on("click", () => {
			this.state.search      = $r.find(".nkh-search").val().trim();
			this.state.topic_filter = $r.find(".nkh-topic-input").val().trim();
			this.state.unit_filter  = $r.find(".nkh-unit-filter").val();
			this.state.date_from   = $r.find(".nkh-date-from").val();
			this.state.date_to     = $r.find(".nkh-date-to").val();
			this.state.page        = 1;
			this._load_all();
		});

		$r.find(".nkh-clear-btn").on("click", () => {
			this.state.search = this.state.topic_filter = this.state.unit_filter = "";
			this.state.date_from = this.state.date_to = "";
			this.state.page = 1;
			$r.find(".nkh-search, .nkh-topic-input, .nkh-date-from, .nkh-date-to").val("");
			$r.find(".nkh-unit-filter").val("");
			this._load_all();
		});

		$r.find(".nkh-search").on("keydown", (e) => { if (e.key === "Enter") $r.find(".nkh-apply-btn").trigger("click"); });

		$r.find(".nkh-detail-close").on("click", () => this._close_detail());
		$r.find(".nkh-detail-overlay").on("click", (e) => {
			if ($(e.target).hasClass("nkh-detail-overlay")) this._close_detail();
		});
	}

	// ── Loaders ─────────────────────────────────────────────────────────────────
	_call(method, args) {
		return frappe.call({
			method: `digitz_ai_nexus_live.api.analytics.${method}`,
			args: args || {},
			freeze: false,
		});
	}

	_load_all() {
		this._load_list();
		this._load_chart();
	}

	_load_filter_options() {
		this._call("get_knowledge_hit_filter_options").then((r) => {
			const $sel = this.$main.find(".nkh-unit-filter");
			(r.message || []).forEach((u) => {
				$sel.append(`<option value="${_esc(u)}">${_esc(u)}</option>`);
			});
		});
	}

	_load_list() {
		this.$main.find(".nkh-tbody").html('<tr><td colspan="8" class="nkh-empty">Loading…</td></tr>');
		const s = this.state;
		this._call("get_knowledge_hit_list", {
			page:         s.page,
			page_size:    s.page_size,
			topic_filter: s.topic_filter || null,
			unit_filter:  s.unit_filter  || null,
			date_from:    s.date_from    || null,
			date_to:      s.date_to      || null,
			search:       s.search       || null,
		}).then((r) => {
			const data = r.message || {};
			this._render_kpis(data.kpi || {});
			this._render_table(data.rows || []);
			this._render_pagination(data);
		});
	}

	_load_chart() {
		const s = this.state;
		this._call("get_knowledge_hit_topic_chart", {
			topic_filter: s.topic_filter || null,
			date_from:    s.date_from    || null,
			date_to:      s.date_to      || null,
			limit: 15,
		}).then((r) => {
			this._render_chart(r.message || []);
		});
	}

	// ── Renderers ───────────────────────────────────────────────────────────────
	_render_kpis(kpi) {
		this.$main.find("[data-key]").each(function () {
			const key = $(this).data("key");
			const val = kpi[key];
			let display = (val === undefined || val === null) ? "0" : String(val);
			if (key === "avg_score" || key === "avg_final_score") {
				display = val ? parseFloat(val).toFixed(4) : "—";
			}
			$(this).find(".nkh-kpi-value").text(display);
		});
	}

	_render_chart(rows) {
		const $wrap = this.$main.find(".nkh-topic-chart");
		$wrap.empty();

		if (!rows.length) {
			$wrap.html('<div class="nkh-empty">No knowledge hit data yet. Hits are recorded when the AI answers using retrieved knowledge.</div>');
			return;
		}

		const max_val = Math.max(...rows.map((r) => r.hit_count), 1);
		const colors = ["#5b7cf6","#38c4b8","#f5a623","#a86dd4","#e45f5f","#4db87a","#f06292","#26c6da","#ff8f00","#7e57c2"];

		let bars_html = "";
		rows.forEach((r, i) => {
			const pct = Math.round((r.hit_count / max_val) * 100);
			const color = colors[i % colors.length];
			bars_html += `
<div class="nkh-chart-row">
  <div class="nkh-chart-label" title="${_esc(r.label)}">${_esc(_short(r.label, 32))}</div>
  <div class="nkh-chart-bar-wrap">
    <div class="nkh-chart-bar" style="width:${pct}%;background:${color}"></div>
  </div>
  <div class="nkh-chart-meta">
    <span class="nkh-chart-count">${r.hit_count}</span>
    <span class="nkh-chart-sub">${r.conversations} conv · ${r.avg_score ? parseFloat(r.avg_score).toFixed(3) : "—"} score</span>
  </div>
</div>`;
		});

		$wrap.html(`<div class="nkh-chart-list">${bars_html}</div>`);
	}

	_render_table(rows) {
		const $tbody = this.$main.find(".nkh-tbody");
		if (!rows.length) {
			$tbody.html('<tr><td colspan="8" class="nkh-empty">No knowledge hits match the current filters.</td></tr>');
			return;
		}

		let html = "";
		rows.forEach((r) => {
			const ts = r.hit_time ? frappe.datetime.str_to_user(r.hit_time) : "—";
			const score_color = r.final_score >= 0.7 ? "nkh-score-high" : r.final_score >= 0.4 ? "nkh-score-mid" : "nkh-score-low";
			html += `<tr class="nkh-row" data-name="${_esc(r.name)}">
  <td class="nkh-ts">${ts}</td>
  <td><span class="nkh-topic-tag" title="${_esc(r.topic)}">${_esc(_short(r.topic || "—", 28))}</span></td>
  <td class="nkh-title-cell" title="${_esc(r.knowledge_title)}">${_esc(_short(r.knowledge_title || "—", 32))}</td>
  <td class="nkh-unit-cell"><span class="nkh-unit-chip" title="${_esc(r.knowledge_unit)}">${_esc(_short(r.knowledge_unit || "—", 22))}</span></td>
  <td class="nkh-path-cell" title="${_esc(r.context_path)}">${_esc(_short(r.context_path || "—", 28))}</td>
  <td class="nkh-num">${r.score ? parseFloat(r.score).toFixed(4) : "—"}</td>
  <td class="nkh-num"><span class="nkh-score-badge ${score_color}">${r.final_score ? parseFloat(r.final_score).toFixed(4) : "—"}</span></td>
  <td class="nkh-conv-cell">
    ${r.conversation ? `<a class="nkh-conv-link" href="/app/nexus-live-conversation/${_esc(r.conversation)}" target="_blank">${_esc(_short(r.conversation, 18))}</a>` : "—"}
  </td>
</tr>`;
		});

		$tbody.html(html);

		this.$main.find(".nkh-row").on("click", (e) => {
			if ($(e.target).hasClass("nkh-conv-link") || $(e.target).closest(".nkh-conv-link").length) return;
			const name = $(e.currentTarget).data("name");
			if (name) this._open_detail($(e.currentTarget), rows);
		});
	}

	_render_pagination(data) {
		const $pag = this.$main.find(".nkh-pagination");
		if (!data.total_pages || data.total_pages <= 1) { $pag.empty(); return; }

		const cur = data.page || 1;
		const total = data.total_pages;
		const total_rows = data.total;

		let btns = `<span class="nkh-pag-info">Showing ${((cur-1)*data.page_size)+1}–${Math.min(cur*data.page_size, total_rows)} of ${total_rows}</span>`;
		btns += `<button class="nkh-pag-btn" data-page="${cur - 1}" ${cur <= 1 ? "disabled" : ""}>← Prev</button>`;
		for (let p = Math.max(1, cur - 2); p <= Math.min(total, cur + 2); p++) {
			btns += `<button class="nkh-pag-btn ${p === cur ? "active" : ""}" data-page="${p}">${p}</button>`;
		}
		btns += `<button class="nkh-pag-btn" data-page="${cur + 1}" ${cur >= total ? "disabled" : ""}>Next →</button>`;

		$pag.html(`<div class="nkh-pag-row">${btns}</div>`);
		$pag.find(".nkh-pag-btn:not([disabled])").on("click", (e) => {
			this.state.page = parseInt($(e.target).data("page"));
			this._load_list();
		});
	}

	_open_detail($row, rows) {
		const name = $row.data("name");
		const hit = rows.find((r) => r.name === name);
		if (!hit) return;

		const $overlay = this.$main.find(".nkh-detail-overlay");
		$overlay.find(".nkh-detail-title").text(_short(hit.topic || hit.knowledge_title || "Hit Detail", 50));

		const score_color = hit.final_score >= 0.7 ? "nkh-score-high" : hit.final_score >= 0.4 ? "nkh-score-mid" : "nkh-score-low";

		$overlay.find(".nkh-detail-body").html(`
<div class="nkh-detail-meta-grid">
  <div><span class="nkh-meta-label">Topic</span><strong>${_esc(hit.topic || "—")}</strong></div>
  <div><span class="nkh-meta-label">Knowledge Title</span>${_esc(hit.knowledge_title || "—")}</div>
  <div><span class="nkh-meta-label">Knowledge Unit</span><span class="nkh-unit-chip">${_esc(hit.knowledge_unit || "—")}</span></div>
  <div><span class="nkh-meta-label">Context Path</span><code class="nkh-code">${_esc(hit.context_path || "—")}</code></div>
  <div><span class="nkh-meta-label">Hit Time</span>${hit.hit_time ? frappe.datetime.str_to_user(hit.hit_time) : "—"}</div>
  <div><span class="nkh-meta-label">Conversation</span>${hit.conversation ? `<a href="/app/nexus-live-conversation/${_esc(hit.conversation)}" target="_blank">${_esc(hit.conversation)}</a>` : "—"}</div>
  <div><span class="nkh-meta-label">Retrieval Score</span>${hit.score ? parseFloat(hit.score).toFixed(6) : "—"}</div>
  <div><span class="nkh-meta-label">Final Score</span><span class="nkh-score-badge ${score_color}">${hit.final_score ? parseFloat(hit.final_score).toFixed(6) : "—"}</span></div>
</div>

${hit.context ? `
<div class="nkh-detail-section">
  <div class="nkh-detail-section-title">Context</div>
  <div class="nkh-detail-text">${_esc(hit.context)}</div>
</div>` : ""}

${hit.sub_context ? `
<div class="nkh-detail-section">
  <div class="nkh-detail-section-title">Sub Context</div>
  <div class="nkh-detail-text nkh-detail-text-muted">${_esc(hit.sub_context)}</div>
</div>` : ""}

${hit.chunk ? `
<div class="nkh-detail-section">
  <div class="nkh-detail-section-title">Chunk ID</div>
  <code class="nkh-code nkh-code-block">${_esc(hit.chunk)}</code>
</div>` : ""}
`);

		$overlay.show();
	}

	_close_detail() {
		this.$main.find(".nkh-detail-overlay").hide();
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function _esc(str) {
	if (!str) return "";
	return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _short(str, len) {
	if (!str) return "";
	return str.length > len ? str.slice(0, len) + "…" : str;
}

// ── CSS ─────────────────────────────────────────────────────────────────────
const NKH_CSS = `
.nkh-root { font-family: var(--font-stack); color: var(--text-color); padding: 0 0 60px; }

/* Header */
.nkh-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 0 14px; border-bottom: 1px solid var(--border-color); margin-bottom: 20px;
  flex-wrap: wrap; gap: 10px;
}
.nkh-brand { display: flex; align-items: center; gap: 12px; }
.nkh-logo { font-size: 22px; color: #a86dd4; }
.nkh-title { font-size: 18px; font-weight: 700; color: var(--heading-color); }
.nkh-subtitle { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.nkh-header-actions { display: flex; gap: 10px; align-items: center; }

/* Buttons */
.nkh-btn {
  height: 32px; padding: 0 14px; border-radius: 6px; border: none;
  cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.15s;
  display: inline-flex; align-items: center; text-decoration: none;
}
.nkh-btn-primary { background: #a86dd4; color: #fff; }
.nkh-btn-primary:hover { background: #9258be; }
.nkh-btn-ghost { background: var(--bg-color); border: 1px solid var(--border-color); color: var(--text-color); }
.nkh-btn-ghost:hover { background: var(--border-color); color: var(--text-color); text-decoration: none; }

/* Controls */
.nkh-select, .nkh-input {
  height: 32px; padding: 0 10px; border: 1px solid var(--border-color);
  border-radius: 6px; font-size: 13px; background: var(--card-bg);
  color: var(--text-color); outline: none;
}
.nkh-select:focus, .nkh-input:focus { border-color: #a86dd4; }

/* KPI row */
.nkh-kpi-row {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px; margin-bottom: 20px;
}
.nkh-kpi {
  background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 10px; padding: 14px 16px; text-align: center;
}
.nkh-kpi-value { font-size: 26px; font-weight: 700; color: #a86dd4; line-height: 1; }
.nkh-kpi-label { font-size: 11px; color: var(--text-muted); margin-top: 5px; text-transform: uppercase; letter-spacing: 0.5px; }

/* Cards */
.nkh-card {
  background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 10px; padding: 18px 20px; margin-bottom: 20px;
}
.nkh-card-title { font-size: 13px; font-weight: 600; color: var(--heading-color); margin-bottom: 14px; }

/* Topic chart */
.nkh-chart-card { }
.nkh-chart-list { display: flex; flex-direction: column; gap: 7px; }
.nkh-chart-row { display: grid; grid-template-columns: 200px 1fr 160px; gap: 10px; align-items: center; }
.nkh-chart-label { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nkh-chart-bar-wrap { height: 12px; background: var(--bg-color); border-radius: 6px; overflow: hidden; }
.nkh-chart-bar { height: 100%; border-radius: 6px; transition: width 0.4s; min-width: 2px; }
.nkh-chart-meta { display: flex; align-items: center; gap: 8px; }
.nkh-chart-count { font-size: 13px; font-weight: 700; color: var(--heading-color); min-width: 32px; text-align: right; }
.nkh-chart-sub { font-size: 11px; color: var(--text-muted); }

/* Filters */
.nkh-filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.nkh-search { width: 220px; }
.nkh-topic-input { width: 160px; }
.nkh-unit-filter { width: 180px; }
.nkh-date-from, .nkh-date-to { width: 140px; }

/* Table */
.nkh-table-wrap { overflow-x: auto; margin-bottom: 14px; }
.nkh-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.nkh-table th {
  text-align: left; padding: 8px 10px; font-size: 11px; font-weight: 600;
  color: var(--text-muted); border-bottom: 2px solid var(--border-color);
  text-transform: uppercase; letter-spacing: 0.4px; white-space: nowrap;
}
.nkh-table td { padding: 9px 10px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
.nkh-table tr:last-child td { border-bottom: none; }
.nkh-row { cursor: pointer; transition: background 0.12s; }
.nkh-row:hover td { background: var(--bg-light-gray) !important; }
.nkh-num { text-align: right; }
.nkh-empty { color: var(--text-muted); padding: 28px; text-align: center; }
.nkh-ts { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.nkh-title-cell, .nkh-path-cell, .nkh-unit-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Chips / tags */
.nkh-topic-tag {
  display: inline-block; background: #f3eaff; color: #7b3fa0;
  border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600;
}
.nkh-unit-chip {
  display: inline-block; background: #e8ecff; color: #3a5ad9;
  border-radius: 4px; padding: 2px 7px; font-size: 11px;
}
.nkh-score-badge { display: inline-block; border-radius: 4px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
.nkh-score-high { background: #e0f8ee; color: #1a7a50; }
.nkh-score-mid  { background: #fff8e0; color: #8a6000; }
.nkh-score-low  { background: #fdecea; color: #b03030; }
.nkh-conv-link { font-size: 11px; color: #3a5ad9; text-decoration: none; font-family: monospace; }
.nkh-conv-link:hover { text-decoration: underline; }

/* Pagination */
.nkh-pag-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.nkh-pag-info { font-size: 12px; color: var(--text-muted); margin-right: 8px; }
.nkh-pag-btn {
  min-width: 34px; height: 30px; padding: 0 10px; border-radius: 6px;
  border: 1px solid var(--border-color); background: var(--card-bg);
  font-size: 12px; cursor: pointer; color: var(--text-color);
}
.nkh-pag-btn.active { background: #a86dd4; color: #fff; border-color: #a86dd4; font-weight: 600; }
.nkh-pag-btn[disabled] { opacity: 0.4; cursor: default; }
.nkh-pag-btn:not([disabled]):not(.active):hover { background: var(--bg-light-gray); }

/* Detail overlay */
.nkh-detail-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.35);
  z-index: 1000; display: flex; justify-content: flex-end;
}
.nkh-detail-panel {
  width: 520px; max-width: 95vw; height: 100vh;
  background: var(--card-bg); display: flex; flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,0.15); overflow: hidden;
}
.nkh-detail-header {
  display: flex; align-items: center; gap: 12px; padding: 16px 20px;
  border-bottom: 1px solid var(--border-color); flex-shrink: 0;
}
.nkh-detail-close {
  background: none; border: none; cursor: pointer; font-size: 13px;
  color: var(--text-muted); padding: 4px 8px; border-radius: 4px;
}
.nkh-detail-close:hover { background: var(--bg-light-gray); }
.nkh-detail-title { font-weight: 600; font-size: 14px; color: var(--heading-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nkh-detail-body { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; }
.nkh-detail-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px; }
.nkh-meta-label { display: block; color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px; }
.nkh-detail-section { }
.nkh-detail-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.4px; margin-bottom: 6px; }
.nkh-detail-text {
  font-size: 13px; line-height: 1.6; color: var(--text-color);
  background: var(--bg-light-gray); border-radius: 6px; padding: 10px 12px;
  white-space: pre-wrap; word-break: break-word;
}
.nkh-detail-text-muted { color: var(--text-muted); font-size: 12px; }
.nkh-code { font-family: monospace; font-size: 11px; background: var(--bg-light-gray); padding: 2px 5px; border-radius: 3px; color: var(--text-color); }
.nkh-code-block { display: block; padding: 8px 10px; word-break: break-all; }
`;

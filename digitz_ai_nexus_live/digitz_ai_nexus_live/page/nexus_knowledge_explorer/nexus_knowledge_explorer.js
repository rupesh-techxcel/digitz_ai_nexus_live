frappe.pages['nexus-knowledge-explorer'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Knowledge Explorer',
        single_column: true,
    });

    // ── State ─────────────────────────────────────────────────────────────────
    const S = {
        tenant: null,
        tenants: [],
        filters: {},          // { business_unit, context, sub_context, entity_type, topic, sensitivity, status }
        search: '',
        page: 1,
        page_size: 20,
        total: 0,
        units: [],
        facets: {},
        stats: {},
        selected_unit: null,
        loading: false,
        detail_loading: false,
    };

    // ── Root ──────────────────────────────────────────────────────────────────
    const $root = $(wrapper).find('.page-content');
    $root.empty().append(`
        <style>${NKE_CSS}</style>
        <div class="nke-shell" id="nke-shell">
            <div class="nke-topbar" id="nke-topbar"></div>
            <div class="nke-body">
                <aside class="nke-sidebar" id="nke-sidebar"></aside>
                <main  class="nke-main"    id="nke-main"></main>
                <aside class="nke-detail"  id="nke-detail" style="display:none;"></aside>
            </div>
        </div>
    `);

    // ── Init ──────────────────────────────────────────────────────────────────
    // Resolve default tenant from the same Administration snapshot used by Studio,
    // then load tenant list and fall back to snapshot tenant if it matches a real tenant.
    frappe.call({
        method: 'digitz_ai_nexus.api.nexus_administration.get_administration_snapshot',
        callback(snap_r) {
            const snap = snap_r.message || {};
            const resolved = snap.resolved_context || {};
            const admin_tenant = resolved.tenant || null;

            frappe.call({
                method: 'digitz_ai_nexus_live.api.nexus_knowledge_explorer.get_tenants',
                callback(r) {
                    S.tenants = (r.message || []);
                    const names = S.tenants.map(t => t.name);

                    // Prefer the admin-configured tenant; fall back to first in list
                    if (admin_tenant && names.includes(admin_tenant)) {
                        S.tenant = admin_tenant;
                    } else if (S.tenants.length) {
                        S.tenant = S.tenants[0].name;
                    }

                    render_topbar();
                    load_data();
                },
            });
        },
    });

    // ── Topbar ────────────────────────────────────────────────────────────────
    function render_topbar() {
        const tenant_options = S.tenants.map(t =>
            `<option value="${esc(t.name)}" ${t.name === S.tenant ? 'selected' : ''}>${esc(t.tenant_name || t.name)}</option>`
        ).join('');

        $('#nke-topbar').html(`
            <div class="nke-topbar-left">
                <div class="nke-logo-block">
                    <div class="nke-logo-icon">KX</div>
                    <div>
                        <div class="nke-logo-title">Knowledge Explorer</div>
                        <div class="nke-logo-sub" id="nke-stat-line">Loading…</div>
                    </div>
                </div>
            </div>
            <div class="nke-topbar-right">
                <div class="nke-search-wrap">
                    <input class="nke-search" id="nke-search" type="text" placeholder="Search by title, topic, entity…" value="${esc(S.search)}">
                    <svg class="nke-search-icon" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5" stroke="#8fa3bf" stroke-width="1.6"/><path d="M13 13l3.5 3.5" stroke="#8fa3bf" stroke-width="1.6" stroke-linecap="round"/></svg>
                </div>
                <div class="nke-tenant-wrap">
                    <label class="nke-tenant-label">Tenant</label>
                    <select class="nke-tenant-select" id="nke-tenant-select">
                        ${tenant_options}
                    </select>
                </div>
            </div>
        `);

        $('#nke-tenant-select').on('change', function () {
            S.tenant = this.value;
            S.filters = {};
            S.page = 1;
            S.selected_unit = null;
            $('#nke-detail').hide();
            load_data();
        });

        let search_timer;
        $('#nke-search').on('input', function () {
            clearTimeout(search_timer);
            search_timer = setTimeout(() => {
                S.search = this.value.trim();
                S.page = 1;
                load_data();
            }, 350);
        });
    }

    // ── Load data ─────────────────────────────────────────────────────────────
    function load_data() {
        if (S.loading) return;
        S.loading = true;
        render_main_skeleton();

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_knowledge_explorer.get_explorer_data',
            args: {
                tenant: S.tenant,
                search: S.search,
                page: S.page,
                page_size: S.page_size,
                ...S.filters,
            },
            callback(r) {
                S.loading = false;
                const d = r.message || {};
                S.units   = d.units   || [];
                S.facets  = d.facets  || {};
                S.stats   = d.stats   || {};
                S.total   = d.total   || 0;
                render_stats_line();
                render_sidebar();
                render_main();
            },
        });
    }

    // ── Stats line ────────────────────────────────────────────────────────────
    function render_stats_line() {
        const st = S.stats;
        const parts = [
            `<strong>${fmt_num(st.total_units)}</strong> units`,
            `<strong>${fmt_num(st.total_chunks)}</strong> chunks`,
            `<strong>${st.embedding_coverage || 0}%</strong> embedded`,
        ];
        if (st.pending_approval) parts.push(`<span class="nke-stat-warn">${st.pending_approval} pending approval</span>`);
        if (st.last_updated) parts.push(`updated ${frappe.datetime.prettyDate(st.last_updated)}`);
        $('#nke-stat-line').html(parts.join(' &nbsp;·&nbsp; '));
    }

    // ── Sidebar ───────────────────────────────────────────────────────────────
    function render_sidebar() {
        const st = S.stats;

        const coverage_pct = st.embedding_coverage || 0;
        const active_pct   = st.total_units ? Math.round(st.active_units / st.total_units * 100) : 0;

        let sidebar_html = `
            <div class="nke-sidebar-section">
                <div class="nke-sidebar-heading">Overview</div>
                <div class="nke-stat-row"><span>Sources</span><strong>${fmt_num(st.total_sources)}</strong></div>
                <div class="nke-stat-row"><span>Published</span><strong>${fmt_num(st.published_sources)}</strong></div>
                <div class="nke-stat-row"><span>Units</span><strong>${fmt_num(st.total_units)}</strong></div>
                <div class="nke-stat-row"><span>Active</span><strong>${fmt_num(st.active_units)}</strong></div>
                <div class="nke-stat-row"><span>Chunks</span><strong>${fmt_num(st.total_chunks)}</strong></div>
                <div class="nke-meter-wrap">
                    <div class="nke-meter-label">Embedding coverage <span>${coverage_pct}%</span></div>
                    <div class="nke-meter"><div class="nke-meter-fill" style="width:${coverage_pct}%"></div></div>
                </div>
                <div class="nke-meter-wrap">
                    <div class="nke-meter-label">Active rate <span>${active_pct}%</span></div>
                    <div class="nke-meter"><div class="nke-meter-fill nke-meter-fill-green" style="width:${active_pct}%"></div></div>
                </div>
            </div>
        `;

        const facet_defs = [
            { key: 'business_unit', label: 'Business Unit' },
            { key: 'context',       label: 'Context' },
            { key: 'sub_context',   label: 'Sub-Context' },
            { key: 'entity_type',   label: 'Entity Type' },
            { key: 'topic',         label: 'Topic' },
            { key: 'sensitivity',   label: 'Sensitivity' },
            { key: 'status',        label: 'Status' },
        ];

        facet_defs.forEach(fd => {
            const items = (S.facets[fd.key] || []).slice(0, 12);
            if (!items.length) return;
            const active = S.filters[fd.key];

            sidebar_html += `<div class="nke-sidebar-section nke-facet-section">
                <div class="nke-sidebar-heading nke-facet-heading" data-key="${fd.key}">
                    ${fd.label}
                    ${active ? `<span class="nke-facet-clear" data-key="${fd.key}">✕</span>` : ''}
                </div>
                <div class="nke-facet-items" id="nke-facet-${fd.key}">`;

            items.forEach(item => {
                const is_active = active === item.value;
                sidebar_html += `
                    <div class="nke-facet-item ${is_active ? 'nke-facet-item-active' : ''}"
                         data-key="${fd.key}" data-val="${esc(item.value)}">
                        <span class="nke-facet-val">${esc(item.value)}</span>
                        <span class="nke-facet-count">${item.count}</span>
                    </div>`;
            });

            sidebar_html += `</div></div>`;
        });

        if (Object.keys(S.filters).length) {
            sidebar_html += `<div class="nke-sidebar-section">
                <button class="nke-clear-all-btn" id="nke-clear-all">Clear all filters</button>
            </div>`;
        }

        $('#nke-sidebar').html(sidebar_html);

        // Filter click
        $('#nke-sidebar').on('click', '.nke-facet-item', function () {
            const key = $(this).data('key');
            const val = $(this).data('val');
            if (S.filters[key] === val) {
                delete S.filters[key];
            } else {
                S.filters[key] = val;
            }
            S.page = 1;
            load_data();
        });

        $('#nke-sidebar').on('click', '.nke-facet-clear', function (e) {
            e.stopPropagation();
            const key = $(this).data('key');
            delete S.filters[key];
            S.page = 1;
            load_data();
        });

        $('#nke-clear-all').on('click', function () {
            S.filters = {};
            S.page = 1;
            load_data();
        });
    }

    // ── Main panel ────────────────────────────────────────────────────────────
    function render_main_skeleton() {
        $('#nke-main').html(`
            <div class="nke-main-header">
                <div class="nke-skeleton nke-skeleton-line" style="width:180px;height:20px;"></div>
            </div>
            <div class="nke-unit-list">
                ${[1,2,3,4,5].map(() => `
                <div class="nke-unit-card nke-skeleton-card">
                    <div class="nke-skeleton nke-skeleton-line" style="width:60%;height:16px;margin-bottom:8px;"></div>
                    <div class="nke-skeleton nke-skeleton-line" style="width:40%;height:12px;margin-bottom:6px;"></div>
                    <div class="nke-skeleton nke-skeleton-line" style="width:90%;height:12px;"></div>
                </div>`).join('')}
            </div>
        `);
    }

    function render_main() {
        const active_filter_labels = Object.entries(S.filters).map(([k, v]) =>
            `<span class="nke-filter-chip">${k.replace(/_/g,' ')}: <strong>${esc(v)}</strong></span>`
        ).join('');

        let header_html = `
            <div class="nke-main-header">
                <div class="nke-result-count">
                    <strong>${fmt_num(S.total)}</strong> knowledge unit${S.total !== 1 ? 's' : ''}
                    ${S.search ? `matching <em>"${esc(S.search)}"</em>` : ''}
                </div>
                <div class="nke-active-filters">${active_filter_labels}</div>
            </div>
        `;

        if (!S.units.length) {
            $('#nke-main').html(header_html + `
                <div class="nke-empty">
                    <div class="nke-empty-icon">📄</div>
                    <div class="nke-empty-title">No knowledge units found</div>
                    <div class="nke-empty-sub">Try adjusting your filters or search term.</div>
                </div>
            `);
            return;
        }

        // Group by context
        const groups = {};
        S.units.forEach(u => {
            const g = u.context || 'Uncategorised';
            if (!groups[g]) groups[g] = [];
            groups[g].push(u);
        });

        let list_html = '';
        Object.entries(groups).forEach(([ctx, units]) => {
            list_html += `<div class="nke-group">
                <div class="nke-group-header">
                    <span class="nke-group-ctx">${esc(ctx)}</span>
                    <span class="nke-group-count">${units.length}</span>
                </div>`;

            units.forEach(u => {
                const is_sel = S.selected_unit && S.selected_unit.name === u.name;
                list_html += unit_card_html(u, is_sel);
            });

            list_html += `</div>`;
        });

        // Pagination
        const total_pages = Math.ceil(S.total / S.page_size);
        let pager = '';
        if (total_pages > 1) {
            pager = `<div class="nke-pager">
                <button class="nke-pager-btn" id="nke-prev" ${S.page <= 1 ? 'disabled' : ''}>← Prev</button>
                <span class="nke-pager-info">Page ${S.page} of ${total_pages}</span>
                <button class="nke-pager-btn" id="nke-next" ${S.page >= total_pages ? 'disabled' : ''}>Next →</button>
            </div>`;
        }

        $('#nke-main').html(header_html + `<div class="nke-unit-list">${list_html}</div>${pager}`);

        // Card click
        $('#nke-main').on('click', '.nke-unit-card', function () {
            const name = $(this).data('name');
            $('.nke-unit-card').removeClass('nke-unit-card-active');
            $(this).addClass('nke-unit-card-active');
            load_unit_detail(name);
        });

        $('#nke-prev').on('click', () => { S.page--; load_data(); });
        $('#nke-next').on('click', () => { S.page++; load_data(); });
    }

    function unit_card_html(u, is_active) {
        const path = build_path(u);
        const status_cls = status_class(u.status);
        const sens_cls   = sensitivity_class(u.sensitivity);
        const preview = (u.content_preview || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');

        return `
        <div class="nke-unit-card ${is_active ? 'nke-unit-card-active' : ''}" data-name="${esc(u.name)}">
            <div class="nke-card-top">
                <div class="nke-card-title">${esc(u.title || u.name)}</div>
                <div class="nke-card-badges">
                    <span class="nke-badge nke-badge-${status_cls}">${u.status || '—'}</span>
                    <span class="nke-badge nke-badge-${sens_cls}">${u.sensitivity || 'public'}</span>
                </div>
            </div>
            <div class="nke-card-path">${path}</div>
            ${preview ? `<div class="nke-card-preview">${preview.substring(0, 180)}${preview.length > 180 ? '…' : ''}</div>` : ''}
            <div class="nke-card-meta">
                ${u.chunk_count ? `<span>${u.chunk_count} chunks</span>` : ''}
                ${u.embedding_status ? `<span class="nke-emb-${u.embedding_status === 'Completed' ? 'ok' : 'pending'}">${u.embedding_status}</span>` : ''}
                ${u.topic ? `<span class="nke-card-topic">${esc(u.topic)}</span>` : ''}
                <span class="nke-card-date">${frappe.datetime.prettyDate(u.modified)}</span>
            </div>
        </div>`;
    }

    // ── Detail panel ──────────────────────────────────────────────────────────
    function load_unit_detail(name) {
        S.detail_loading = true;
        $('#nke-detail').show().html(`
            <div class="nke-detail-loading">
                <div class="nke-spinner"></div>
                <div>Loading…</div>
            </div>
        `);

        // Adjust layout for 3 panels
        $('#nke-main').addClass('nke-main-narrow');

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_knowledge_explorer.get_unit_detail',
            args: { unit_name: name },
            callback(r) {
                S.detail_loading = false;
                const u = r.message;
                if (!u) { $('#nke-detail').html('<div class="nke-detail-error">Not found.</div>'); return; }
                S.selected_unit = u;
                render_detail(u);
            },
        });
    }

    function render_detail(u) {
        const path = build_path(u);
        const content_html = (u.content || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/\n/g,'<br>');

        const src = u.source;

        $('#nke-detail').html(`
            <div class="nke-detail-inner">
                <div class="nke-detail-header">
                    <div class="nke-detail-title">${esc(u.title || u.name)}</div>
                    <button class="nke-detail-close" id="nke-detail-close">✕</button>
                </div>

                <div class="nke-detail-path">${path}</div>

                <div class="nke-detail-badges">
                    <span class="nke-badge nke-badge-${status_class(u.status)}">${u.status || '—'}</span>
                    <span class="nke-badge nke-badge-${sensitivity_class(u.sensitivity)}">${u.sensitivity || 'public'}</span>
                    ${u.access_policy ? `<span class="nke-badge nke-badge-policy">${esc(u.access_policy)}</span>` : ''}
                </div>

                <div class="nke-detail-grid">
                    ${detail_row('Tenant',       u.tenant)}
                    ${detail_row('Business Unit', u.business_unit)}
                    ${detail_row('Project',       u.project)}
                    ${detail_row('Context',       u.context)}
                    ${detail_row('Sub-Context',   u.sub_context)}
                    ${detail_row('Entity Type',   u.entity_type)}
                    ${detail_row('Entity',        u.entity)}
                    ${detail_row('Topic',         u.topic)}
                    ${detail_row('Chunks',        u.chunk_count ? `${u.active_chunk_count || u.chunk_count} active / ${u.chunk_count} total` : null)}
                    ${detail_row('Embedding',     u.embedding_status)}
                    ${detail_row('Approved By',   u.approved_by)}
                    ${detail_row('Approved On',   u.approved_on ? frappe.datetime.prettyDate(u.approved_on) : null)}
                    ${detail_row('Created',       frappe.datetime.prettyDate(u.creation))}
                    ${detail_row('Modified',      frappe.datetime.prettyDate(u.modified))}
                </div>

                ${src ? `
                <div class="nke-detail-section-label">Source Document</div>
                <div class="nke-source-card">
                    <div class="nke-source-title">${esc(src.title || src.name)}</div>
                    <div class="nke-source-meta">
                        <span>${src.source_type || '—'}</span>
                        <span class="nke-badge nke-badge-${status_class(src.status)}">${src.status || '—'}</span>
                    </div>
                </div>` : ''}

                <div class="nke-detail-section-label">Content</div>
                <div class="nke-detail-content">${content_html || '<em>No content stored.</em>'}</div>

                <div class="nke-detail-actions">
                    <a href="/app/nexus-knowledge-unit/${encodeURIComponent(u.name)}" class="nke-detail-link" target="_blank">
                        Open in Desk →
                    </a>
                </div>
            </div>
        `);

        $('#nke-detail-close').on('click', function () {
            $('#nke-detail').hide();
            $('#nke-main').removeClass('nke-main-narrow');
            S.selected_unit = null;
            $('.nke-unit-card').removeClass('nke-unit-card-active');
        });
    }

    function detail_row(label, val) {
        if (!val) return '';
        return `<div class="nke-detail-row">
            <span class="nke-detail-label">${esc(label)}</span>
            <span class="nke-detail-val">${esc(String(val))}</span>
        </div>`;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function build_path(u) {
        if (u.context_path) return `<span class="nke-path">${esc(u.context_path)}</span>`;
        const parts = [u.business_unit, u.context, u.sub_context, u.entity_type, u.entity].filter(Boolean);
        return parts.length
            ? `<span class="nke-path">${parts.map(p => esc(p)).join(' <span class="nke-path-sep">›</span> ')}</span>`
            : '';
    }

    function status_class(s) {
        return { Active: 'green', Approved: 'green', Published: 'teal',
                 Review: 'amber', Draft: 'grey', Archived: 'dim', Disabled: 'dim' }[s] || 'grey';
    }

    function sensitivity_class(s) {
        return { public: 'teal', customer: 'blue', operational: 'blue',
                 internal: 'amber', financial: 'red', hr: 'red', confidential: 'red' }[s] || 'grey';
    }

    function fmt_num(n) { return (n || 0).toLocaleString(); }
    function esc(s)     { return frappe.utils.escape_html(String(s || '')); }
};

// ── CSS ───────────────────────────────────────────────────────────────────────
const NKE_CSS = `
/* Shell */
.nke-shell { display:flex; flex-direction:column; height:calc(100vh - 60px); overflow:hidden; background:#f4f6fa; }
.nke-body  { display:flex; flex:1; overflow:hidden; gap:0; }

/* Topbar */
.nke-topbar {
    display:flex; align-items:center; justify-content:space-between;
    padding:10px 20px; background:#fff;
    border-bottom:1px solid #e2e8f0; flex-shrink:0;
    box-shadow:0 1px 4px rgba(0,0,0,.05);
}
.nke-topbar-left  { display:flex; align-items:center; gap:16px; }
.nke-topbar-right { display:flex; align-items:center; gap:12px; }
.nke-logo-block   { display:flex; align-items:center; gap:12px; }
.nke-logo-icon    {
    width:38px; height:38px; border-radius:10px;
    background:linear-gradient(135deg,#1a3a6b,#2a6db5);
    color:#fff; font-size:13px; font-weight:700;
    display:flex; align-items:center; justify-content:center; letter-spacing:.05em;
}
.nke-logo-title { font-size:15px; font-weight:700; color:#1a2942; line-height:1.2; }
.nke-logo-sub   { font-size:11.5px; color:#8fa3bf; line-height:1.4; }
.nke-stat-warn  { color:#d97706; }

/* Search */
.nke-search-wrap { position:relative; }
.nke-search {
    border:1.5px solid #dde3ee; border-radius:20px; padding:6px 14px 6px 34px;
    font-size:13px; color:#1a2942; width:280px; outline:none;
    transition:border-color .15s;
}
.nke-search:focus { border-color:#2a6db5; }
.nke-search-icon { position:absolute; left:10px; top:50%; transform:translateY(-50%); width:16px; height:16px; }

/* Tenant select */
.nke-tenant-wrap  { display:flex; align-items:center; gap:6px; }
.nke-tenant-label { font-size:11.5px; color:#8fa3bf; font-weight:600; text-transform:uppercase; letter-spacing:.05em; }
.nke-tenant-select {
    border:1.5px solid #dde3ee; border-radius:8px; padding:6px 28px 6px 10px;
    font-size:13px; color:#1a2942; background:#f8fafd; cursor:pointer; outline:none;
    appearance:none; -webkit-appearance:none;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238fa3bf' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat:no-repeat; background-position:right 9px center;
}

/* Sidebar */
.nke-sidebar {
    width:220px; flex-shrink:0; overflow-y:auto;
    background:#fff; border-right:1px solid #e2e8f0; padding:12px 0;
}
.nke-sidebar-section { padding:8px 14px 12px; border-bottom:1px solid #f0f2f8; }
.nke-sidebar-section:last-child { border-bottom:none; }
.nke-sidebar-heading {
    font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
    color:#8fa3bf; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;
}
.nke-facet-clear { cursor:pointer; color:#c0ccdc; font-size:11px; }
.nke-facet-clear:hover { color:#e05252; }

/* Stats rows */
.nke-stat-row { display:flex; justify-content:space-between; font-size:12px; color:#4a6085; padding:3px 0; }
.nke-stat-row strong { color:#1a2942; font-weight:600; }

/* Meters */
.nke-meter-wrap { margin-top:8px; }
.nke-meter-label { font-size:11px; color:#8fa3bf; display:flex; justify-content:space-between; margin-bottom:4px; }
.nke-meter { height:5px; background:#e8edf5; border-radius:3px; overflow:hidden; }
.nke-meter-fill { height:100%; background:linear-gradient(90deg,#2a6db5,#3b9ede); border-radius:3px; transition:width .4s; }
.nke-meter-fill-green { background:linear-gradient(90deg,#0d9488,#34d399); }

/* Facet items */
.nke-facet-items { display:flex; flex-direction:column; gap:2px; }
.nke-facet-item {
    display:flex; justify-content:space-between; align-items:center;
    padding:4px 8px; border-radius:6px; cursor:pointer; font-size:12px; color:#4a6085;
    transition:background .12s;
}
.nke-facet-item:hover { background:#f0f4fa; }
.nke-facet-item-active { background:#dbeafe; color:#1a3a6b; font-weight:600; }
.nke-facet-val   { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:130px; }
.nke-facet-count { font-size:10.5px; color:#a0b4cc; background:#f0f4fa; padding:1px 5px; border-radius:10px; flex-shrink:0; }
.nke-facet-item-active .nke-facet-count { background:#bfdbfe; color:#1e40af; }

/* Clear all */
.nke-clear-all-btn {
    width:100%; padding:7px; border:1.5px dashed #c0ccdc; border-radius:8px;
    background:none; color:#8fa3bf; font-size:12px; cursor:pointer; text-align:center;
}
.nke-clear-all-btn:hover { border-color:#2a6db5; color:#2a6db5; }

/* Main panel */
.nke-main {
    flex:1; overflow-y:auto; padding:16px 20px; transition:max-width .2s;
}
.nke-main-narrow { max-width:calc(100% - 460px); }

/* Main header */
.nke-main-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:8px; }
.nke-result-count { font-size:13px; color:#4a6085; }
.nke-result-count strong { color:#1a2942; }
.nke-active-filters { display:flex; flex-wrap:wrap; gap:5px; }
.nke-filter-chip {
    background:#dbeafe; color:#1a3a6b; font-size:11px; padding:3px 9px;
    border-radius:12px;
}

/* Group */
.nke-group { margin-bottom:20px; }
.nke-group-header {
    display:flex; align-items:center; gap:8px; margin-bottom:8px;
    padding-bottom:6px; border-bottom:2px solid #e2e8f0;
}
.nke-group-ctx   { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#5a7499; }
.nke-group-count { font-size:11px; color:#a0b4cc; background:#f0f4fa; padding:1px 7px; border-radius:10px; }

/* Unit cards */
.nke-unit-card {
    background:#fff; border:1.5px solid #e2e8f0; border-radius:10px;
    padding:14px 16px; margin-bottom:8px; cursor:pointer;
    transition:border-color .15s, box-shadow .15s;
}
.nke-unit-card:hover { border-color:#a0bcdf; box-shadow:0 2px 8px rgba(42,109,181,.08); }
.nke-unit-card-active { border-color:#2a6db5; box-shadow:0 0 0 3px rgba(42,109,181,.12); }

.nke-card-top    { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:4px; }
.nke-card-title  { font-size:13.5px; font-weight:600; color:#1a2942; line-height:1.3; }
.nke-card-badges { display:flex; gap:5px; flex-shrink:0; }
.nke-card-path   { font-size:11.5px; color:#8fa3bf; margin-bottom:5px; }
.nke-card-preview{ font-size:12px; color:#64748b; line-height:1.5; margin-bottom:6px; }
.nke-card-meta   { display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:11px; color:#a0b4cc; }
.nke-card-topic  { background:#f0fdf4; color:#065f46; padding:1px 7px; border-radius:10px; }
.nke-card-date   { margin-left:auto; }
.nke-emb-ok      { color:#0d9488; }
.nke-emb-pending { color:#d97706; }

/* Path */
.nke-path     { font-size:11.5px; color:#8fa3bf; }
.nke-path-sep { color:#c0ccdc; margin:0 2px; }

/* Badges */
.nke-badge { font-size:10.5px; font-weight:600; padding:2px 7px; border-radius:10px; }
.nke-badge-green  { background:#dcfce7; color:#14532d; }
.nke-badge-teal   { background:#ccfbf1; color:#065f46; }
.nke-badge-blue   { background:#dbeafe; color:#1e3a8a; }
.nke-badge-amber  { background:#fef3c7; color:#92400e; }
.nke-badge-red    { background:#fee2e2; color:#7f1d1d; }
.nke-badge-grey   { background:#f1f5f9; color:#475569; }
.nke-badge-dim    { background:#f8fafc; color:#94a3b8; }
.nke-badge-policy { background:#ede9fe; color:#4c1d95; }

/* Pagination */
.nke-pager { display:flex; align-items:center; justify-content:center; gap:12px; padding:16px 0; }
.nke-pager-btn {
    border:1.5px solid #dde3ee; border-radius:8px; background:#fff; padding:6px 16px;
    font-size:12.5px; color:#4a6085; cursor:pointer; transition:border-color .12s;
}
.nke-pager-btn:hover:not([disabled]) { border-color:#2a6db5; color:#2a6db5; }
.nke-pager-btn[disabled] { opacity:.4; cursor:default; }
.nke-pager-info { font-size:12px; color:#8fa3bf; }

/* Empty */
.nke-empty { text-align:center; padding:60px 20px; }
.nke-empty-icon  { font-size:40px; margin-bottom:12px; }
.nke-empty-title { font-size:15px; font-weight:600; color:#1a2942; margin-bottom:6px; }
.nke-empty-sub   { font-size:13px; color:#8fa3bf; }

/* Detail panel */
.nke-detail {
    width:340px; flex-shrink:0; overflow-y:auto;
    background:#fff; border-left:1px solid #e2e8f0; padding:0;
}
.nke-detail-inner { padding:16px 18px; }
.nke-detail-header { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:6px; }
.nke-detail-title  { font-size:14px; font-weight:700; color:#1a2942; line-height:1.3; }
.nke-detail-close  { background:none; border:none; cursor:pointer; color:#a0b4cc; font-size:15px; flex-shrink:0; padding:0 2px; }
.nke-detail-close:hover { color:#e05252; }
.nke-detail-path   { font-size:11px; color:#8fa3bf; margin-bottom:8px; }
.nke-detail-badges { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:14px; }

.nke-detail-grid { display:flex; flex-direction:column; gap:1px; margin-bottom:16px; }
.nke-detail-row  { display:flex; padding:5px 0; border-bottom:1px solid #f0f4fa; }
.nke-detail-label{ font-size:11px; color:#8fa3bf; font-weight:600; text-transform:uppercase; letter-spacing:.04em; min-width:100px; }
.nke-detail-val  { font-size:12px; color:#1a2942; word-break:break-word; }

.nke-detail-section-label {
    font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
    color:#8fa3bf; margin-bottom:8px; margin-top:14px;
}

.nke-source-card { background:#f8fafd; border:1.5px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin-bottom:12px; }
.nke-source-title{ font-size:12.5px; font-weight:600; color:#1a2942; margin-bottom:5px; }
.nke-source-meta { display:flex; align-items:center; gap:8px; font-size:11px; color:#8fa3bf; }

.nke-detail-content {
    font-size:12.5px; color:#334155; line-height:1.7;
    background:#f8fafd; border-radius:8px; padding:12px 14px;
    border:1px solid #e2e8f0; max-height:320px; overflow-y:auto;
    word-break:break-word; margin-bottom:14px;
}

.nke-detail-actions { padding-top:8px; }
.nke-detail-link {
    font-size:12px; color:#2a6db5; font-weight:600;
    text-decoration:none; padding:6px 12px; border:1.5px solid #a0bcdf;
    border-radius:8px; display:inline-block; transition:background .12s;
}
.nke-detail-link:hover { background:#dbeafe; }

/* Loading */
.nke-detail-loading { display:flex; flex-direction:column; align-items:center; justify-content:center; height:200px; gap:12px; color:#8fa3bf; font-size:13px; }
.nke-detail-error   { padding:20px; text-align:center; color:#e05252; font-size:13px; }
.nke-spinner {
    width:28px; height:28px; border:3px solid #e2e8f0;
    border-top-color:#2a6db5; border-radius:50%; animation:nke-spin .7s linear infinite;
}
@keyframes nke-spin { to { transform:rotate(360deg); } }

/* Skeleton */
.nke-skeleton-card { pointer-events:none; }
.nke-skeleton      { background:linear-gradient(90deg,#f0f4fa 25%,#e2e8f2 50%,#f0f4fa 75%); background-size:400% 100%; animation:nke-shimmer 1.3s ease infinite; border-radius:6px; }
@keyframes nke-shimmer { 0%{background-position:100% 0} 100%{background-position:-100% 0} }
.nke-skeleton-line { display:block; }
`;

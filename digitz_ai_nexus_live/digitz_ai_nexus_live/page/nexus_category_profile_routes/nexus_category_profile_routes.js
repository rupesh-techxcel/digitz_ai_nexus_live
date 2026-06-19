frappe.pages['nexus-category-profile-routes'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus Category Profile Routes',
        single_column: true,
    });

    const state = {
        tenant: '',
        tenants: [],
        channels: [],
        profiles: [],
        identityProfiles: [],
        categories: [],
        routes: [],
        selectedChannel: null,
        selectedCategory: null,
    };

    inject_ncpr_css();
    $(page.body).html(buildHTML());
    bindEvents();
    loadTenants();

    // -------------------------------------------------------------------------
    // HTML
    // -------------------------------------------------------------------------
    function buildHTML() {
        return `
<div class="ncpr-wrap">

    <div class="nexus-admin-hero">
        <div>
            <div class="nexus-admin-badge">DIGITZ AI Nexus</div>
            <h2>Category Profile Routes</h2>
            <p>
                For each chat category, define which <b>AI Agent Profile</b> handles the conversation
                and which <b>Identity Profiles</b> are permitted. A route is either public (open to all)
                or restricted to visitors whose registry includes a permitted Identity Profile.
            </p>
            <div class="nexus-admin-flow-pill">
                Chat Category &nbsp;→&nbsp; Route &nbsp;→&nbsp; Identity Profiles &nbsp;→&nbsp; Knowledge Profiles &nbsp;→&nbsp; Policies
            </div>
        </div>
        <div class="nexus-admin-hero-actions">
            <button class="btn btn-default" data-route-list="Nexus Category Identity Route">All Routes</button>
            <button class="btn btn-default" data-route-list="Nexus Chat Category">Categories</button>
            <button class="btn btn-default" data-route-list="Nexus AI Agent Profile">Profiles</button>
            <button class="btn btn-default" data-route-page="nexus-chat-category-manager">Category Manager</button>
        </div>
    </div>

    <!-- Tenant filter -->
    <div class="ncpr-tenant-bar">
        <span class="ncpr-tenant-label">Tenant</span>
        <select id="ncpr_tenant_select" class="ncpr-tenant-select">
            <option value="">Loading…</option>
        </select>
    </div>

    <div class="ncpr-layout">

        <!-- Col 1: Channels -->
        <div class="nexus-admin-card ncpr-col-panel">
            <div class="nexus-admin-card-title">Channel</div>
            <div class="ncpr-scroll-inner">
                <div id="ncpr_channels_loading" class="nexus-empty-state">Loading…</div>
                <div id="ncpr_channel_list"></div>
            </div>
        </div>

        <!-- Col 2: Categories -->
        <div class="nexus-admin-card ncpr-col-panel">
            <div class="nexus-admin-card-title">Category</div>
            <div class="ncpr-scroll-inner">
                <div id="ncpr_cat_placeholder" class="nexus-empty-state">Select a channel</div>
                <div id="ncpr_cat_list" style="display:none;"></div>
            </div>
        </div>

        <!-- Col 3: Routes -->
        <div>
            <div id="ncpr_routes_placeholder" class="nexus-admin-card" style="text-align:center; padding:40px 20px;">
                <div style="font-size:28px; color:#b0c4de; margin-bottom:12px;">←</div>
                <div style="color:#53688f; font-size:14px; font-weight:700;">Select a channel and category to manage routes</div>
            </div>

            <div id="ncpr_routes_content" style="display:none;">

                <!-- Routes header -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div class="nexus-admin-section-head" style="margin-bottom:0;">
                        <div>
                            <div class="nexus-admin-card-title">Routes</div>
                            <div id="ncpr_routes_subtitle" class="nexus-admin-muted" style="margin-top:6px;"></div>
                        </div>
                        <button id="ncpr_add_route_btn" class="btn btn-primary btn-sm">+ Add Route</button>
                    </div>
                </div>

                <!-- Routes table -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div id="ncpr_routes_loading" class="nexus-empty-state" style="display:none;">Loading routes…</div>
                    <div id="ncpr_routes_table"></div>
                    <div id="ncpr_no_routes" class="nexus-empty-state" style="display:none;">
                        No routes configured for this category. Click <b>+ Add Route</b> to create one.
                    </div>
                </div>

                <!-- Chain detail -->
                <div id="ncpr_chain_card" class="nexus-admin-card" style="display:none; margin-bottom:18px;">
                    <div class="nexus-admin-section-head">
                        <div>
                            <div class="nexus-admin-card-title">Chain Detail</div>
                            <div id="ncpr_chain_subtitle" class="nexus-admin-muted" style="margin-top:4px;"></div>
                        </div>
                        <button id="ncpr_chain_close" class="btn btn-xs btn-default">Close</button>
                    </div>
                    <div id="ncpr_chain_body" style="margin-top:16px;"></div>
                </div>

            </div>
        </div>
    </div>

</div>`;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    function bindEvents() {
        $(page.body).on('click', '[data-route-list]', function () {
            frappe.set_route('List', $(this).data('route-list'));
        });
        $(page.body).on('click', '[data-route-page]', function () {
            frappe.set_route($(this).data('route-page'));
        });
        $(page.body).on('click', '#ncpr_add_route_btn', addRoute);
        $(page.body).on('click', '#ncpr_chain_close', () => $('#ncpr_chain_card').hide());
        $(page.body).on('change', '#ncpr_tenant_select', function () {
            state.tenant = $(this).val();
            resetToChannels();
            loadChannels();
        });
    }

    // -------------------------------------------------------------------------
    // Data loading
    // -------------------------------------------------------------------------
    function loadTenants() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.get_available_tenants',
            callback(r) {
                if (!r.message) return;
                state.tenants = r.message.tenants || [];
                const defaultTenant = r.message.default_tenant || '';
                state.tenant = defaultTenant || (state.tenants[0] && state.tenants[0].name) || '';

                const $sel = $('#ncpr_tenant_select');
                $sel.html(state.tenants.map(t =>
                    `<option value="${esc(t.name)}" ${t.name === state.tenant ? 'selected' : ''}>${esc(t.tenant_name || t.name)}</option>`
                ).join(''));

                loadChannels();
            },
        });
    }

    function loadChannels() {
        $('#ncpr_channels_loading').show().text('Loading…');
        $('#ncpr_channel_list').empty();
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.get_page_data',
            args: { tenant: state.tenant },
            callback(r) {
                $('#ncpr_channels_loading').hide();
                if (!r.message) return;
                state.channels = r.message.channels || [];
                state.profiles = r.message.profiles || [];
                state.identityProfiles = r.message.identity_profiles || [];
                renderChannelList();
            },
        });
    }

    function loadCategories(channel) {
        $('#ncpr_cat_placeholder').hide();
        $('#ncpr_cat_list').show().html('<div class="nexus-empty-state">Loading…</div>');
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.get_channel_categories',
            args: { channel },
            callback(r) {
                state.categories = (r.message && r.message.categories) || [];
                renderCategoryList();
            },
        });
    }

    function loadRoutes(channel, categoryCode) {
        $('#ncpr_routes_loading').show();
        $('#ncpr_routes_table').empty();
        $('#ncpr_no_routes').hide();
        $('#ncpr_chain_card').hide();

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.get_category_routes',
            args: { channel, category_code: categoryCode },
            callback(r) {
                $('#ncpr_routes_loading').hide();
                if (!r.message) return;
                state.routes = r.message.routes || [];
                renderRoutes();
            },
        });
    }

    function resetToChannels() {
        state.selectedChannel = null;
        state.selectedCategory = null;
        state.categories = [];
        state.routes = [];
        $('#ncpr_cat_placeholder').show();
        $('#ncpr_cat_list').hide().empty();
        $('#ncpr_routes_placeholder').show();
        $('#ncpr_routes_content').hide();
        $('#ncpr_chain_card').hide();
    }

    // -------------------------------------------------------------------------
    // Channel list
    // -------------------------------------------------------------------------
    function renderChannelList() {
        const $list = $('#ncpr_channel_list');
        if (!state.channels.length) {
            $list.html('<div class="nexus-empty-state">No enabled channels.</div>');
            return;
        }
        $list.html(state.channels.map(ch => `
            <div class="nexus-kv-row ncpr-item" data-key="${esc(ch.name)}" style="margin-bottom:5px; cursor:pointer;">
                <div>
                    <div style="font-size:12px; font-weight:850; color:#173b8c;">${esc(ch.channel_name || ch.name)}</div>
                    <div class="nexus-admin-muted">${esc(ch.channel_type || '')}</div>
                </div>
                <b style="color:#214dbb;">›</b>
            </div>`).join(''));

        $list.off('click', '.ncpr-item').on('click', '.ncpr-item', function () {
            selectChannel($(this).data('key'));
        });
    }

    function selectChannel(channel) {
        state.selectedChannel = channel;
        state.selectedCategory = null;
        $('#ncpr_channel_list .ncpr-item').removeClass('ncpr-item-active');
        $(`#ncpr_channel_list .ncpr-item[data-key="${CSS.escape(channel)}"]`).addClass('ncpr-item-active');
        $('#ncpr_routes_placeholder').show();
        $('#ncpr_routes_content').hide();
        loadCategories(channel);
    }

    // -------------------------------------------------------------------------
    // Category list
    // -------------------------------------------------------------------------
    function renderCategoryList() {
        const $list = $('#ncpr_cat_list');
        if (!state.categories.length) {
            $list.html('<div class="nexus-empty-state">No categories on this channel.</div>');
            return;
        }
        $list.html(state.categories.map(cat => `
            <div class="nexus-kv-row ncpr-item" data-key="${esc(cat.name)}" style="margin-bottom:5px; cursor:pointer;">
                <div style="overflow:hidden;">
                    <div style="font-size:12px; font-weight:850; color:#173b8c; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${esc(cat.category_label)}
                    </div>
                    <div style="display:flex; gap:5px; margin-top:3px;">
                        <span class="nexus-status-pill ${cat.enabled ? 'enabled' : 'disabled'}" style="font-size:9px; padding:2px 7px;">
                            ${cat.enabled ? 'On' : 'Off'}
                        </span>
                        ${cat.visibility === 'Internal'
                            ? `<span class="nexus-status-pill" style="font-size:9px; padding:2px 7px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;">Internal</span>`
                            : cat.visibility === 'Both'
                            ? `<span class="nexus-status-pill" style="font-size:9px; padding:2px 7px; background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe;">Both</span>`
                            : ''}
                    </div>
                </div>
                <b style="color:#214dbb; flex-shrink:0;">›</b>
            </div>`).join(''));

        $list.off('click', '.ncpr-item').on('click', '.ncpr-item', function () {
            selectCategory($(this).data('key'));
        });
    }

    function selectCategory(categoryCode) {
        state.selectedCategory = categoryCode;
        $('#ncpr_cat_list .ncpr-item').removeClass('ncpr-item-active');
        $(`#ncpr_cat_list .ncpr-item[data-key="${CSS.escape(categoryCode)}"]`).addClass('ncpr-item-active');

        const cat = state.categories.find(c => c.name === categoryCode);
        $('#ncpr_routes_subtitle').text(cat ? cat.category_label : categoryCode);
        $('#ncpr_routes_placeholder').hide();
        $('#ncpr_routes_content').show();
        loadRoutes(state.selectedChannel, categoryCode);
    }

    // -------------------------------------------------------------------------
    // Routes table
    // -------------------------------------------------------------------------
    function renderRoutes() {
        const $table = $('#ncpr_routes_table');

        if (!state.routes.length) {
            $('#ncpr_no_routes').show();
            $table.empty();
            return;
        }
        $('#ncpr_no_routes').hide();

        const rows = state.routes.map(r => {
            const profilesHtml = r.identity_profiles && r.identity_profiles.length
                ? r.identity_profiles.map(p => `<span class="ncpr-ip-chip">${esc(p)}</span>`).join('')
                : '<span class="nexus-admin-muted">Open to all</span>';

            return `
                <tr>
                    <td>
                        <b style="color:#173b8c; font-size:12px;">${esc(r.ai_agent_profile)}</b>
                        ${r.description ? `<div class="nexus-admin-muted">${esc(r.description)}</div>` : ''}
                    </td>
                    <td><div style="display:flex; flex-wrap:wrap; gap:4px;">${profilesHtml}</div></td>
                    <td style="text-align:center; color:#6b7c9b; font-size:12px;">${r.priority}</td>
                    <td style="text-align:center;">
                        <span class="nexus-status-pill ${r.enabled ? 'enabled' : 'disabled'}">${r.enabled ? 'Active' : 'Disabled'}</span>
                    </td>
                    <td style="text-align:right;">
                        <button class="btn btn-xs btn-info ncpr-chain-btn" data-name="${esc(r.name)}" style="margin-right:3px;">Chain</button>
                        <button class="btn btn-xs ${r.enabled ? 'btn-warning' : 'btn-success'} ncpr-toggle-btn"
                            data-name="${esc(r.name)}" data-enabled="${r.enabled ? 0 : 1}">
                            ${r.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button class="btn btn-xs btn-default ncpr-edit-btn" data-name="${esc(r.name)}" style="margin-left:3px;">Edit</button>
                        <button class="btn btn-xs btn-danger ncpr-delete-btn" data-name="${esc(r.name)}" style="margin-left:3px;">✕</button>
                    </td>
                </tr>`;
        }).join('');

        $table.html(`
            <table class="table table-bordered nexus-admin-table" style="margin-bottom:0;">
                <thead><tr>
                    <th style="width:180px;">AI Agent Profile</th>
                    <th>Identity Profiles</th>
                    <th style="width:70px; text-align:center;">Priority</th>
                    <th style="width:90px; text-align:center;">Status</th>
                    <th style="width:240px; text-align:right;">Actions</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`);

        $table.off('click', '.ncpr-chain-btn').on('click', '.ncpr-chain-btn', function () {
            loadChain($(this).data('name'));
        });
        $table.off('click', '.ncpr-edit-btn').on('click', '.ncpr-edit-btn', function () {
            frappe._ncre_context = { route: $(this).data('name') };
            frappe.set_route('nexus-category-route-editor');
        });
        $table.off('click', '.ncpr-toggle-btn').on('click', '.ncpr-toggle-btn', function () {
            toggleRoute($(this).data('name'), $(this).data('enabled'));
        });
        $table.off('click', '.ncpr-delete-btn').on('click', '.ncpr-delete-btn', function () {
            deleteRoute($(this).data('name'));
        });
    }

    // -------------------------------------------------------------------------
    // Add route — opens custom editor page with channel + category pre-filled
    // -------------------------------------------------------------------------
    function addRoute() {
        const cat = state.categories.find(c => c.name === state.selectedCategory);
        const ch = state.channels.find(c => c.name === state.selectedChannel);
        frappe._ncre_context = {
            channel: state.selectedChannel,
            channel_label: ch ? (ch.channel_name || ch.name) : state.selectedChannel,
            category: state.selectedCategory,
            category_label: cat ? cat.category_label : state.selectedCategory,
            tenant: state.tenant || '',
        };
        frappe.set_route('nexus-category-route-editor');
    }

    function toggleRoute(name, enabled) {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.toggle_route',
            args: { name, enabled },
            callback(r) {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert({ message: enabled ? 'Route enabled.' : 'Route disabled.', indicator: enabled ? 'green' : 'orange' });
                    loadRoutes(state.selectedChannel, state.selectedCategory);
                }
            },
        });
    }

    function deleteRoute(name) {
        frappe.confirm('Delete this route?', () => {
            frappe.call({
                method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.delete_route',
                args: { name },
                callback(r) {
                    if (r.message && r.message.status === 'success') {
                        frappe.show_alert({ message: 'Route deleted.', indicator: 'green' });
                        loadRoutes(state.selectedChannel, state.selectedCategory);
                    }
                },
            });
        });
    }

    // -------------------------------------------------------------------------
    // Chain detail
    // -------------------------------------------------------------------------
    function loadChain(routeName) {
        $('#ncpr_chain_card').show();
        $('#ncpr_chain_subtitle').text(`Route: ${routeName}`);
        $('#ncpr_chain_body').html('<div class="nexus-empty-state">Resolving chain…</div>');
        $('html,body').animate({ scrollTop: $('#ncpr_chain_card').offset().top - 80 }, 250);

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.get_route_chain',
            args: {
                channel: state.selectedChannel,
                category_code: state.selectedCategory,
                route_name: routeName,
            },
            callback(r) {
                if (!r.message) return;
                renderChain(r.message);
            },
        });
    }

    function renderChain(chain) {
        let html = '';

        if (chain.warnings && chain.warnings.length) {
            html += chain.warnings.map(w => `
                <div class="ncpr-chain-warning"><span style="font-size:16px;">⚠️</span><span>${esc(w)}</span></div>
            `).join('');
        }

        html += `<div class="ncpr-chain-flow">`;

        // AI Agent Profile node
        if (chain.profile) {
            html += `
                <div class="ncpr-chain-node">
                    <div class="ncpr-chain-node-label">AI Agent Profile</div>
                    <div class="ncpr-chain-node-card">
                        <div class="ncpr-chain-node-title">${esc(chain.profile.name)}</div>
                        <div class="nexus-admin-muted" style="margin-top:6px; line-height:1.6;">
                            ${chain.profile.agent ? `Agent: <b>${esc(chain.profile.agent)}</b><br>` : ''}
                            ${chain.profile.tone ? `Tone: ${esc(chain.profile.tone)}<br>` : ''}
                            Threshold: ${chain.profile.confidence_threshold || 0.65} · Escalation: ${chain.profile.escalation_enabled ? 'On' : 'Off'}
                        </div>
                    </div>
                </div>`;
        } else {
            html += `<div class="ncpr-chain-node"><div class="ncpr-chain-node-label">AI Agent Profile</div><div class="ncpr-chain-node-card ncpr-chain-missing">Not configured</div></div>`;
        }

        html += `<div class="ncpr-chain-arrow">→</div>`;

        // Identity Profiles node
        html += `<div class="ncpr-chain-node"><div class="ncpr-chain-node-label">Identity Profiles</div><div class="ncpr-chain-node-card">`;
        if (chain.identity_profiles && chain.identity_profiles.length) {
            html += chain.identity_profiles.map(ip =>
                `<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <span style="color:#16a34a;">✓</span>
                    <span style="font-size:12px; font-weight:850; color:#173b8c;">${esc(ip)}</span>
                </div>`
            ).join('');
        } else if (chain.route && !chain.warnings.some(w => w.includes('public route'))) {
            html += `<span class="ncpr-chain-missing">None assigned</span>`;
        } else {
            html += `<span class="nexus-admin-muted">Public route — no profile filter</span>`;
        }
        html += `</div></div>`;

        if (chain.knowledge_profiles && chain.knowledge_profiles.length) {
            html += `<div class="ncpr-chain-arrow">→</div>`;
            html += `<div class="ncpr-chain-node"><div class="ncpr-chain-node-label">Knowledge Profiles</div><div class="ncpr-chain-node-card">`;
            html += chain.knowledge_profiles.map(kp =>
                `<div style="font-size:12px; font-weight:850; color:#173b8c; margin-bottom:4px;">${esc(kp)}</div>`
            ).join('');
            html += `</div></div>`;
        }

        html += `<div class="ncpr-chain-arrow">→</div>`;

        // Access Categories node
        html += `<div class="ncpr-chain-node"><div class="ncpr-chain-node-label">Access Categories</div><div class="ncpr-chain-node-card">`;
        if (chain.access_categories && chain.access_categories.length) {
            html += chain.access_categories.map(c =>
                `<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <span style="color:#16a34a;">✓</span>
                    <span style="font-size:12px; font-weight:850; color:#173b8c;">${esc(c)}</span>
                </div>`
            ).join('');
        } else {
            html += `<span class="ncpr-chain-missing">None resolved</span>`;
        }
        html += `</div></div>`;

        html += `<div class="ncpr-chain-arrow">→</div>`;

        // Policies node
        html += `<div class="ncpr-chain-node"><div class="ncpr-chain-node-label">Effective Policies</div><div class="ncpr-chain-node-card">`;
        if (chain.policies && chain.policies.length) {
            html += `<div style="display:flex; flex-wrap:wrap; gap:5px;">`;
            html += chain.policies.map(p =>
                `<span class="${p.is_primitive ? 'ncpr-chip-primitive' : 'ncpr-chip'}">${esc(p.policy_name || p.name)}${p.is_primitive ? ' ★' : ''}</span>`
            ).join('');
            html += `</div>`;
            html += `<div class="nexus-admin-muted" style="margin-top:8px;">${chain.policies.length} polic${chain.policies.length !== 1 ? 'ies' : 'y'} will filter knowledge chunks.</div>`;
        } else {
            html += `<span class="ncpr-chain-missing">No policies — retrieval denied.</span>`;
        }
        html += `</div></div>`;

        html += `</div>`;

        if (!chain.knowledge_profiles || !chain.knowledge_profiles.length) {
            html += `<div class="ncpr-chain-warning" style="margin-top:14px;"><span style="font-size:16px;">ℹ️</span><span>Pass an <b>identity_type</b> to see Knowledge Profiles and effective policies for a specific visitor class.</span></div>`;
        }

        $('#ncpr_chain_body').html(html);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    function esc(s) { return frappe.utils.escape_html(String(s || '')); }
};


function inject_ncpr_css() {
    if ($('#ncpr_css').length) return;
    $('head').append(`<style id="ncpr_css">
        .ncpr-wrap { padding:12px; }

        .nexus-admin-hero { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; border-radius:26px; padding:30px 34px; margin-bottom:18px; background:radial-gradient(circle at 8% 20%,rgba(77,163,255,.28),transparent 30%),radial-gradient(circle at 92% 10%,rgba(224,166,47,.22),transparent 28%),linear-gradient(135deg,#fff 0%,#eef6ff 48%,#f8fbff 100%); border:1px solid rgba(77,163,255,.38); box-shadow:0 18px 45px rgba(33,77,187,.12); }
        .nexus-admin-badge { display:inline-flex; align-items:center; padding:8px 14px; border-radius:999px; background:rgba(33,77,187,.09); border:1px solid rgba(33,77,187,.16); color:#214dbb; font-weight:800; font-size:12px; letter-spacing:.04em; text-transform:uppercase; margin-bottom:12px; }
        .nexus-admin-hero h2 { margin:0; font-size:30px; font-weight:900; color:#102b67; letter-spacing:-0.03em; }
        .nexus-admin-hero p { margin:12px 0 0; max-width:880px; font-size:15px; line-height:1.7; color:#27416f; font-weight:500; }
        .nexus-admin-hero-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .nexus-admin-hero-actions .btn { border-radius:999px; font-weight:850; }
        .nexus-admin-flow-pill { display:inline-block; margin-top:12px; padding:7px 14px; border-radius:999px; background:rgba(33,77,187,.08); border:1px solid rgba(33,77,187,.18); color:#214dbb; font-size:11px; font-weight:800; font-family:monospace; }
        .nexus-admin-card { border:1px solid rgba(77,163,255,.28); border-radius:22px; background:#fff; padding:20px; box-shadow:0 12px 30px rgba(33,77,187,.07); }
        .nexus-admin-card-title { display:inline-flex; align-items:center; gap:12px; color:#173b8c; font-size:16px; font-weight:900; padding:10px 16px; margin-bottom:16px; border-radius:999px; background:#eef6ff; border:1px solid rgba(33,77,187,.14); }
        .nexus-admin-card-title:after { content:""; width:36px; height:4px; border-radius:999px; background:linear-gradient(90deg,#e0a62f,#f4ca64); }
        .nexus-admin-section-head { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:16px; }
        .nexus-admin-section-head .nexus-admin-card-title { margin-bottom:8px; }
        .nexus-kv-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 12px; border-radius:14px; background:#f8fbff; border:1px solid rgba(77,163,255,.18); }
        .nexus-empty-state { padding:16px; border-radius:16px; background:#fff7e6; border:1px solid #f2d49b; color:#8a5d00; font-weight:800; line-height:1.6; }
        .nexus-status-pill { display:inline-flex; padding:5px 9px; border-radius:999px; font-size:10px; font-weight:900; white-space:nowrap; }
        .nexus-status-pill.enabled { background:#ecfdf3; color:#16794c; border:1px solid #bdebd2; }
        .nexus-status-pill.disabled { background:#fff0f0; color:#b42318; border:1px solid #ffd1d1; }
        .nexus-admin-table { margin-bottom:0; background:#fff; }
        .nexus-admin-table th { color:#173b8c; font-size:12px; font-weight:900; background:#eef6ff; white-space:nowrap; }
        .nexus-admin-table td { color:#27416f; font-size:12px; font-weight:650; vertical-align:middle; }
        .nexus-admin-muted { margin-top:4px; color:#6b7c9b; font-size:11px; font-weight:650; line-height:1.4; }

        .ncpr-tenant-bar { display:flex; align-items:center; gap:12px; padding:12px 16px; margin-bottom:18px; background:#f8fbff; border:1px solid rgba(77,163,255,.2); border-radius:16px; }
        .ncpr-tenant-label { font-size:12px; font-weight:850; color:#173b8c; white-space:nowrap; }
        .ncpr-tenant-select { border-radius:999px; border:1.5px solid rgba(33,77,187,.25); padding:6px 14px; font-size:13px; font-weight:750; color:#173b8c; background:#fff; min-width:200px; }

        .ncpr-layout { display:grid; grid-template-columns:200px 200px 1fr; gap:18px; align-items:start; }
        .ncpr-col-panel { position:sticky; top:64px; }
        .ncpr-scroll-inner { max-height:520px; overflow-y:auto; padding-right:2px; }
        .ncpr-item:hover { background:#eef6ff !important; border-color:rgba(33,77,187,.35) !important; cursor:pointer; }
        .ncpr-item-active { background:#eef6ff !important; border-color:rgba(33,77,187,.55) !important; }
        .ncpr-item-active div { color:#173b8c !important; font-weight:950 !important; }

        .ncpr-route-pill { display:inline-flex; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:900; white-space:nowrap; }
        .ncpr-public { background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; }
        .ncpr-registered { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; }
        .ncpr-ip-chip { display:inline-flex; padding:3px 8px; border-radius:999px; font-size:11px; font-weight:900; background:#eef6ff; color:#173b8c; border:1px solid rgba(33,77,187,.22); margin:2px; }

        .ncpr-chain-warning { display:flex; align-items:flex-start; gap:10px; padding:12px 16px; border-radius:14px; background:#fff7e6; border:1px solid #f2d49b; color:#8a5d00; font-size:12px; font-weight:800; margin-bottom:14px; line-height:1.5; }
        .ncpr-chain-flow { display:flex; align-items:flex-start; gap:0; flex-wrap:wrap; overflow-x:auto; }
        .ncpr-chain-arrow { display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:900; color:#214dbb; padding:0 10px; margin-top:28px; flex-shrink:0; }
        .ncpr-chain-node { display:flex; flex-direction:column; min-width:160px; max-width:200px; }
        .ncpr-chain-node-label { font-size:10px; font-weight:900; color:#6b7c9b; text-transform:uppercase; letter-spacing:.06em; margin-bottom:8px; padding-left:2px; }
        .ncpr-chain-node-card { border:1px solid rgba(77,163,255,.28); border-radius:16px; background:#f8fbff; padding:14px 16px; min-height:64px; box-shadow:0 4px 12px rgba(33,77,187,.06); }
        .ncpr-chain-node-title { font-size:13px; font-weight:950; color:#102b67; }
        .ncpr-chain-missing { color:#b42318; font-weight:800; font-size:12px; }
        .ncpr-chip { display:inline-flex; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:900; background:#eef6ff; color:#173b8c; border:1px solid rgba(33,77,187,.22); }
        .ncpr-chip-primitive { display:inline-flex; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:900; background:#fff7e6; color:#8a5d00; border:1px solid #f2d49b; }

        @media (max-width:1100px) { .ncpr-layout { grid-template-columns:180px 180px 1fr; } }
        @media (max-width:820px) { .ncpr-layout { grid-template-columns:1fr 1fr; } .ncpr-col-panel { position:static; } }
        @media (max-width:600px) { .ncpr-layout { grid-template-columns:1fr; } .nexus-admin-hero { flex-direction:column; } .ncpr-chain-flow { flex-direction:column; } .ncpr-chain-arrow { margin-top:0; padding:4px 0; transform:rotate(90deg); align-self:center; } .ncpr-chain-node { max-width:100%; } }
    </style>`);
}

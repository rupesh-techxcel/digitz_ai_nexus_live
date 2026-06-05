frappe.pages['nexus-category-profile-routes'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus Category Profile Routes',
        single_column: true,
    });

    const state = {
        channels: [],
        profiles: [],
        identityTypes: [],
        categories: [],
        routes: [],
        availableIdentityTypes: [],
        selectedChannel: null,
        selectedCategory: null,
        expandedIdentity: null,
    };

    inject_ncpr_css();
    $(page.body).html(buildHTML());
    bindEvents();
    loadInitialData();

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
                For each chat category, define which <b>AI Agent Profile</b> is used for each
                <b>Identity Type</b>. The same category can serve different visitors with
                different profiles. Access safeguards are configured on the verified
                identity registry, then intersected with profile access at runtime.
            </p>
            <div class="nexus-admin-flow-pill">
                Chat Category &nbsp;+&nbsp; Identity Type &nbsp;→&nbsp; AI Agent Profile
            </div>
        </div>
        <div class="nexus-admin-hero-actions">
            <button class="btn btn-default" data-route-list="Nexus Category Identity Route">All Routes</button>
            <button class="btn btn-default" data-route-list="Nexus Chat Category">Categories</button>
            <button class="btn btn-default" data-route-list="Nexus AI Agent Profile">Profiles</button>
            <button class="btn btn-default" data-route-page="nexus-chat-category-manager">Category Manager</button>
        </div>
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
                            <div class="nexus-admin-card-title">Identity → Profile Routes</div>
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
                        No routes configured. Every identity type that could access this category
                        needs a route. Click <b>+ Add Route</b> to begin.
                    </div>
                </div>

                <!-- Coverage summary -->
                <div id="ncpr_coverage_card" class="nexus-admin-card" style="margin-bottom:18px; display:none;">
                    <div class="nexus-admin-card-title">Coverage</div>
                    <div id="ncpr_coverage_body"></div>
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

    <!-- Add route modal -->
    <div id="ncpr_modal_overlay" class="ncpr-modal-overlay" style="display:none;">
        <div class="ncpr-modal">
            <div class="ncpr-modal-header">
                <span id="ncpr_modal_title" style="font-size:17px; font-weight:900; color:#102b67;">Add Route</span>
                <button id="ncpr_modal_close" class="btn btn-xs btn-default">✕</button>
            </div>
            <div class="ncpr-modal-body">
                <div class="ncpr-field-group">
                    <label>Identity Type <span style="color:#b42318;">*</span></label>
                    <select id="ncpr_f_identity" class="form-control">
                        <option value="">— Select identity type —</option>
                    </select>
                </div>
                <div class="ncpr-field-group">
                    <label>AI Agent Profile <span style="color:#b42318;">*</span></label>
                    <select id="ncpr_f_profile" class="form-control">
                        <option value="">— Select profile —</option>
                    </select>
                </div>
                <div class="ncpr-field-group">
                    <label>Priority</label>
                    <input id="ncpr_f_priority" type="number" class="form-control" value="10" min="1">
                    <div class="nexus-admin-muted">Lower = higher priority when multiple routes match.</div>
                </div>
                <div class="ncpr-field-group">
                    <label>Description</label>
                    <input id="ncpr_f_description" type="text" class="form-control" placeholder="Optional notes">
                </div>
                <div id="ncpr_modal_error" class="nexus-empty-state" style="display:none; background:#fff0f0; border-color:#ffd1d1; color:#b42318;"></div>
            </div>
            <div class="ncpr-modal-footer">
                <button id="ncpr_modal_cancel" class="btn btn-default">Cancel</button>
                <button id="ncpr_modal_save" class="btn btn-primary">Save Route</button>
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
        $(page.body).on('click', '#ncpr_add_route_btn', () => openModal());
        $(page.body).on('click', '#ncpr_modal_close, #ncpr_modal_cancel', closeModal);
        $(page.body).on('click', '#ncpr_modal_overlay', e => {
            if ($(e.target).is('#ncpr_modal_overlay')) closeModal();
        });
        $(page.body).on('click', '#ncpr_modal_save', saveRoute);
        $(page.body).on('click', '#ncpr_chain_close', () => $('#ncpr_chain_card').hide());
    }

    // -------------------------------------------------------------------------
    // Data loading
    // -------------------------------------------------------------------------
    function loadInitialData() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.get_page_data',
            callback(r) {
                $('#ncpr_channels_loading').hide();
                if (!r.message) return;
                state.channels = r.message.channels || [];
                state.profiles = r.message.profiles || [];
                state.identityTypes = r.message.identity_types || [];
                renderChannelList();
                populateProfileSelect();
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
                state.availableIdentityTypes = r.message.available_identity_types || [];
                renderRoutes();
                renderCoverage();
            },
        });
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

        $list.on('click', '.ncpr-item', function () {
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
            <div class="nexus-kv-row ncpr-item" data-key="${esc(cat.category_code)}" style="margin-bottom:5px; cursor:pointer;">
                <div style="overflow:hidden;">
                    <div style="font-size:12px; font-weight:850; color:#173b8c; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${esc(cat.category_label)}
                    </div>
                    <div style="display:flex; gap:5px; margin-top:3px;">
                        <span class="nexus-status-pill ${cat.enabled ? 'enabled' : 'disabled'}" style="font-size:9px; padding:2px 7px;">
                            ${cat.enabled ? 'On' : 'Off'}
                        </span>
                        ${cat.requires_authentication ? `<span class="nexus-status-pill" style="font-size:9px; padding:2px 7px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;">Auth</span>` : ''}
                    </div>
                </div>
                <b style="color:#214dbb; flex-shrink:0;">›</b>
            </div>`).join(''));

        $list.on('click', '.ncpr-item', function () {
            selectCategory($(this).data('key'));
        });
    }

    function selectCategory(categoryCode) {
        state.selectedCategory = categoryCode;
        $('#ncpr_cat_list .ncpr-item').removeClass('ncpr-item-active');
        $(`#ncpr_cat_list .ncpr-item[data-key="${CSS.escape(categoryCode)}"]`).addClass('ncpr-item-active');

        const cat = state.categories.find(c => c.category_code === categoryCode);
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

        const rows = state.routes.map(r => `
            <tr>
                <td>
                    <span class="ncpr-identity-pill ncpr-id-${esc((r.identity_type||'').toLowerCase())}">${esc(r.identity_type)}</span>
                </td>
                <td>
                    <b style="color:#173b8c; font-size:12px;">${esc(r.ai_agent_profile)}</b>
                    ${r.description ? `<div class="nexus-admin-muted">${esc(r.description)}</div>` : ''}
                </td>
                <td style="text-align:center; color:#6b7c9b; font-size:12px;">${r.priority}</td>
                <td style="text-align:center;">
                    <span class="nexus-status-pill ${r.enabled ? 'enabled' : 'disabled'}">${r.enabled ? 'Active' : 'Disabled'}</span>
                </td>
                <td style="text-align:right;">
                    <button class="btn btn-xs btn-info ncpr-chain-btn" data-identity="${esc(r.identity_type)}" style="margin-right:3px;">Chain</button>
                    <button class="btn btn-xs ${r.enabled ? 'btn-warning' : 'btn-success'} ncpr-toggle-btn"
                        data-name="${esc(r.name)}" data-enabled="${r.enabled ? 0 : 1}">
                        ${r.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button class="btn btn-xs btn-danger ncpr-delete-btn" data-name="${esc(r.name)}" style="margin-left:3px;">✕</button>
                </td>
            </tr>`).join('');

        $table.html(`
            <table class="table table-bordered nexus-admin-table" style="margin-bottom:0;">
                <thead><tr>
                    <th style="width:130px;">Identity Type</th>
                    <th>AI Agent Profile</th>
                    <th style="width:70px; text-align:center;">Priority</th>
                    <th style="width:90px; text-align:center;">Status</th>
                    <th style="width:210px; text-align:right;">Actions</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`);

        $table.off('click', '.ncpr-chain-btn').on('click', '.ncpr-chain-btn', function () {
            loadChain($(this).data('identity'));
        });
        $table.off('click', '.ncpr-toggle-btn').on('click', '.ncpr-toggle-btn', function () {
            toggleRoute($(this).data('name'), $(this).data('enabled'));
        });
        $table.off('click', '.ncpr-delete-btn').on('click', '.ncpr-delete-btn', function () {
            deleteRoute($(this).data('name'));
        });
    }

    // -------------------------------------------------------------------------
    // Coverage summary
    // -------------------------------------------------------------------------
    function renderCoverage() {
        const $card = $('#ncpr_coverage_card');
        const $body = $('#ncpr_coverage_body');

        const configured = new Set(state.routes.filter(r => r.enabled).map(r => r.identity_type));
        const missing = state.identityTypes.filter(t => !configured.has(t));

        const configuredChips = [...configured].map(t =>
            `<span class="ncpr-identity-pill ncpr-id-${t.toLowerCase()} ncpr-coverage-ok">${t} ✓</span>`
        ).join('');

        const missingChips = missing.map(t =>
            `<span class="ncpr-identity-pill ncpr-coverage-missing">${t} —</span>`
        ).join('');

        $body.html(`
            <div style="margin-bottom:10px;">
                <div class="nexus-admin-muted" style="margin-bottom:6px; font-weight:900; color:#173b8c;">Configured (${configured.size})</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${configuredChips || '<span class="nexus-admin-muted">None</span>'}
                </div>
            </div>
            <div>
                <div class="nexus-admin-muted" style="margin-bottom:6px; font-weight:900; color:#b42318;">Not Configured (${missing.length})</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${missingChips || '<span style="color:#16794c; font-size:12px; font-weight:850;">All identity types covered ✓</span>'}
                </div>
                ${missing.length ? `<div class="nexus-admin-muted" style="margin-top:8px;">Visitors with these identity types selecting this category will receive an error.</div>` : ''}
            </div>`);

        $card.show();
    }

    // -------------------------------------------------------------------------
    // Modal
    // -------------------------------------------------------------------------
    function populateProfileSelect() {
        const $sel = $('#ncpr_f_profile');
        $sel.find('option:not(:first)').remove();
        state.profiles.forEach(p => {
            $sel.append(`<option value="${esc(p.name)}">${esc(p.name)}${p.agent ? ` (${esc(p.agent)})` : ''}</option>`);
        });
    }

    function openModal() {
        const $sel = $('#ncpr_f_identity');
        $sel.find('option:not(:first)').remove();
        state.availableIdentityTypes.forEach(t => {
            $sel.append(`<option value="${t}">${t}</option>`);
        });
        if (!state.availableIdentityTypes.length) {
            frappe.show_alert({ message: 'All identity types are already configured for this category.', indicator: 'blue' });
            return;
        }

        $('#ncpr_f_priority').val(10);
        $('#ncpr_f_description').val('');
        $('#ncpr_f_profile').val('');
        $('#ncpr_modal_error').hide();
        $('#ncpr_modal_title').text('Add Route');
        $('#ncpr_modal_overlay').show();
        $('#ncpr_f_identity').focus();
    }

    function closeModal() {
        $('#ncpr_modal_overlay').hide();
    }

    function saveRoute() {
        const identity = $('#ncpr_f_identity').val();
        const profile = $('#ncpr_f_profile').val();

        if (!identity || !profile) {
            $('#ncpr_modal_error').show().text('Identity Type and AI Agent Profile are required.');
            return;
        }

        $('#ncpr_modal_error').hide();
        $('#ncpr_modal_save').prop('disabled', true).text('Saving…');

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.save_route',
            args: {
                channel: state.selectedChannel,
                category_code: state.selectedCategory,
                identity_type: identity,
                ai_agent_profile: profile,
                priority: $('#ncpr_f_priority').val() || 10,
                description: $('#ncpr_f_description').val().trim(),
            },
            callback(r) {
                $('#ncpr_modal_save').prop('disabled', false).text('Save Route');
                if (r.message && r.message.status === 'success') {
                    closeModal();
                    frappe.show_alert({ message: 'Route saved.', indicator: 'green' });
                    loadRoutes(state.selectedChannel, state.selectedCategory);
                }
            },
            error() {
                $('#ncpr_modal_save').prop('disabled', false).text('Save Route');
            },
        });
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
    function loadChain(identityType) {
        $('#ncpr_chain_card').show();
        $('#ncpr_chain_subtitle').text(`Identity: ${identityType}`);
        $('#ncpr_chain_body').html('<div class="nexus-empty-state">Resolving chain…</div>');
        $('html,body').animate({ scrollTop: $('#ncpr_chain_card').offset().top - 80 }, 250);

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.get_route_chain',
            args: {
                channel: state.selectedChannel,
                category_code: state.selectedCategory,
                identity_type: identityType,
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

        // Identity node
        html += `
            <div class="ncpr-chain-node">
                <div class="ncpr-chain-node-label">Identity Type</div>
                <div class="ncpr-chain-node-card" style="display:flex; align-items:center; justify-content:center; min-height:60px;">
                    <span class="ncpr-identity-pill ncpr-id-${esc((chain.identity_type||'').toLowerCase())}" style="font-size:14px; padding:8px 18px;">
                        ${esc(chain.identity_type)}
                    </span>
                </div>
            </div>
            <div class="ncpr-chain-arrow">→</div>`;

        // Profile node
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

        // Profile access categories node
        html += `<div class="ncpr-chain-node"><div class="ncpr-chain-node-label">Profile Access</div><div class="ncpr-chain-node-card">`;
        if (chain.profile_access_categories && chain.profile_access_categories.length) {
            html += chain.profile_access_categories.map(c =>
                `<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <span style="color:#16a34a;">✓</span>
                    <span style="font-size:12px; font-weight:850; color:#173b8c;">${esc(c)}</span>
                </div>`
            ).join('');
        } else {
            html += `<span class="ncpr-chain-missing">None assigned</span>`;
        }
        html += `</div></div>`;

        html += `<div class="ncpr-chain-arrow">→</div>`;

        // Policies node
        html += `<div class="ncpr-chain-node"><div class="ncpr-chain-node-label">Effective Policies</div><div class="ncpr-chain-node-card">`;
        if (chain.policies && chain.policies.length) {
            html += `<div style="display:flex; flex-wrap:wrap; gap:5px;">`;
            html += chain.policies.map(p =>
                `<span class="${p.is_primitive ? 'ncpr-chip-primitive' : 'ncpr-chip'}">${esc(p.policy_name)}${p.is_primitive ? ' ★' : ''}</span>`
            ).join('');
            html += `</div>`;
            html += `<div class="nexus-admin-muted" style="margin-top:8px;">${chain.policies.length} polic${chain.policies.length !== 1 ? 'ies' : 'y'} will filter knowledge chunks.</div>`;
        } else {
            html += `<span class="ncpr-chain-missing">No policies — retrieval denied.</span>`;
        }
        html += `</div></div>`;

        html += `</div>`;
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

        .ncpr-layout { display:grid; grid-template-columns:200px 200px 1fr; gap:18px; align-items:start; }
        .ncpr-col-panel { position:sticky; top:64px; }
        .ncpr-scroll-inner { max-height:520px; overflow-y:auto; padding-right:2px; }
        .ncpr-item:hover { background:#eef6ff !important; border-color:rgba(33,77,187,.35) !important; cursor:pointer; }
        .ncpr-item-active { background:#eef6ff !important; border-color:rgba(33,77,187,.55) !important; }
        .ncpr-item-active div { color:#173b8c !important; font-weight:950 !important; }

        .ncpr-identity-pill { display:inline-flex; padding:5px 12px; border-radius:999px; font-size:11px; font-weight:900; white-space:nowrap; background:#eef6ff; color:#173b8c; border:1px solid rgba(33,77,187,.22); }
        .ncpr-id-public    { background:#f0fdf4; color:#15803d; border-color:#bbf7d0; }
        .ncpr-id-customer  { background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; }
        .ncpr-id-prospect  { background:#fefce8; color:#a16207; border-color:#fde68a; }
        .ncpr-id-partner   { background:#fdf4ff; color:#7e22ce; border-color:#e9d5ff; }
        .ncpr-id-internal  { background:#fff7ed; color:#c2410c; border-color:#fed7aa; }
        .ncpr-id-admin     { background:#fff0f0; color:#b42318; border-color:#ffd1d1; }

        .ncpr-coverage-ok     { opacity:1; }
        .ncpr-coverage-missing { background:#f9fafb; color:#9ca3af; border-color:#e5e7eb; text-decoration:line-through; }

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

        .ncpr-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:9999; display:flex; align-items:center; justify-content:center; }
        .ncpr-modal { background:#fff; border-radius:22px; width:480px; max-width:95vw; box-shadow:0 24px 60px rgba(0,0,0,.22); overflow:hidden; }
        .ncpr-modal-header { display:flex; justify-content:space-between; align-items:center; padding:20px 24px 16px; border-bottom:1px solid #e8eef7; }
        .ncpr-modal-body { padding:20px 24px; display:flex; flex-direction:column; gap:14px; }
        .ncpr-modal-footer { display:flex; justify-content:flex-end; gap:10px; padding:16px 24px 20px; border-top:1px solid #e8eef7; }
        .ncpr-modal-footer .btn { border-radius:999px; font-weight:850; }
        .ncpr-field-group { display:flex; flex-direction:column; gap:5px; }
        .ncpr-field-group label { font-size:12px; font-weight:900; color:#173b8c; }

        @media (max-width:1100px) { .ncpr-layout { grid-template-columns:180px 180px 1fr; } }
        @media (max-width:820px) { .ncpr-layout { grid-template-columns:1fr 1fr; } .ncpr-col-panel { position:static; } }
        @media (max-width:600px) { .ncpr-layout { grid-template-columns:1fr; } .nexus-admin-hero { flex-direction:column; } .ncpr-chain-flow { flex-direction:column; } .ncpr-chain-arrow { margin-top:0; padding:4px 0; transform:rotate(90deg); align-self:center; } .ncpr-chain-node { max-width:100%; } }
    </style>`);
}

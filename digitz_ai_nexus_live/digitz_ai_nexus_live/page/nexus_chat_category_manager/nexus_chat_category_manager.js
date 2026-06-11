frappe.pages['nexus-chat-category-manager'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus Chat Category Manager',
        single_column: true,
    });

    const state = {
        channels: [],
        categories: [],
        selectedChannel: null,
        editingName: null,
    };

    inject_nccm_css();
    $(page.body).html(buildHTML());
    bindEvents();
    loadInitialData();

    // -------------------------------------------------------------------------
    // HTML
    // -------------------------------------------------------------------------
    function buildHTML() {
        return `
<div class="nccm-wrap">

    <div class="nexus-admin-hero">
        <div>
            <div class="nexus-admin-badge">DIGITZ AI Nexus</div>
            <h2>Chat Category Manager</h2>
            <p>
                Define the options shown in the chat window for each channel.
                Each category is an <b>intent label</b> — profile assignment per
                identity type is managed separately in <b>Category Profile Routes</b>.
            </p>
            <div class="nexus-admin-flow-pill">
                Category &nbsp;+&nbsp; Identity Type &nbsp;→&nbsp; Profile &nbsp;→&nbsp; Knowledge Access
            </div>
        </div>
        <div class="nexus-admin-hero-actions">
            <button class="btn btn-primary" data-route-page="nexus-category-profile-routes">Manage Routes →</button>
            <button class="btn btn-default" data-route-list="Nexus Chat Category">All Categories</button>
            <button class="btn btn-default" data-route-list="Nexus Live Channel">Channels</button>
            <button id="nccm_test_chat_btn" class="btn nccm-test-btn">⚡ Test Chat Connectivity</button>
        </div>
    </div>

    <div class="nccm-layout">

        <!-- Left: Channel list -->
        <div class="nexus-admin-card nccm-channel-panel">
            <div class="nexus-admin-card-title">Channels</div>
            <div class="nccm-channel-inner">
                <div id="nccm_channels_loading" class="nexus-empty-state">Loading…</div>
                <div id="nccm_channel_list"></div>
            </div>
        </div>

        <!-- Right -->
        <div>
            <div id="nccm_placeholder" class="nexus-admin-card nccm-placeholder">
                <div class="nccm-placeholder-icon">←</div>
                <div>Select a channel to manage its chat categories</div>
            </div>

            <div id="nccm_channel_content" style="display:none;">

                <!-- Header -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div class="nexus-admin-section-head" style="margin-bottom:0;">
                        <div>
                            <div class="nexus-admin-card-title">Chat Categories</div>
                            <div id="nccm_channel_title" class="nccm-channel-title"></div>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button id="nccm_routes_btn" class="btn btn-default btn-sm">Manage Routes →</button>
                            <button id="nccm_add_btn" class="btn btn-primary btn-sm">+ Add Category</button>
                        </div>
                    </div>
                </div>

                <!-- Category list -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div id="nccm_cat_loading" class="nexus-empty-state" style="display:none;">Loading categories…</div>
                    <div id="nccm_cat_list"></div>
                    <div id="nccm_no_cats" class="nexus-empty-state" style="display:none;">
                        No categories configured. Click <b>+ Add Category</b> to create one.
                        Then go to <b>Manage Routes</b> to assign profiles per identity type.
                    </div>
                </div>

                <!-- Chain preview -->
                <div id="nccm_chain_card" class="nexus-admin-card" style="display:none; margin-bottom:18px;">
                    <div class="nexus-admin-section-head" style="margin-bottom:0;">
                        <div>
                            <div class="nexus-admin-card-title">Governance Chain</div>
                            <div id="nccm_chain_subtitle" class="nexus-admin-muted" style="margin-top:4px;"></div>
                        </div>
                        <button id="nccm_chain_close" class="btn btn-xs btn-default">Close</button>
                    </div>
                    <div id="nccm_chain_body" style="margin-top:18px;"></div>
                </div>

            </div>
        </div>
    </div>

    <!-- Test Chat Connectivity modal -->
    <div id="nccm_test_overlay" class="nccm-modal-overlay" style="display:none;">
        <div class="nccm-modal nccm-test-modal">
            <div class="nccm-modal-header">
                <div>
                    <div style="font-size:18px; font-weight:900; color:#102b67;">⚡ Chat Connectivity Test</div>
                    <div class="nexus-admin-muted" style="margin-top:3px;">Tracing desk-user start_chat path step by step</div>
                </div>
                <button id="nccm_test_close" class="btn btn-xs btn-default">✕</button>
            </div>
            <div id="nccm_test_body" class="nccm-modal-body nccm-test-body">
                <div class="nccm-test-running">
                    <div class="nccm-spinner"></div>
                    <div>Running connectivity test…</div>
                </div>
            </div>
            <div class="nccm-modal-footer">
                <button id="nccm_test_rerun" class="btn btn-default" style="display:none;">↺ Re-run</button>
                <button id="nccm_test_close2" class="btn btn-primary">Close</button>
            </div>
        </div>
    </div>

    <!-- Add / Edit modal — category label only, no profile/identity -->
    <div id="nccm_modal_overlay" class="nccm-modal-overlay" style="display:none;">
        <div class="nccm-modal">
            <div class="nccm-modal-header">
                <span id="nccm_modal_title" style="font-size:18px; font-weight:900; color:#102b67;">Add Category</span>
                <button id="nccm_modal_close" class="btn btn-xs btn-default">✕</button>
            </div>
            <div class="nccm-modal-body">
                <div class="nccm-field-group">
                    <label>Category Label <span class="nccm-req">*</span></label>
                    <input id="nccm_f_label" type="text" class="form-control" placeholder="e.g. Customer Support">
                    <div class="nexus-admin-muted">What the visitor sees in the chat window.</div>
                </div>
                <div class="nccm-field-row">
                    <div class="nccm-field-group">
                        <label>Display Order</label>
                        <input id="nccm_f_order" type="number" class="form-control" value="10" min="1">
                    </div>
                    <div class="nccm-field-group" style="justify-content:flex-end; padding-top:20px;">
                        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                            <input id="nccm_f_auth" type="checkbox" style="width:14px; height:14px;">
                            Requires Authentication
                        </label>
                    </div>
                </div>
                <div class="nccm-field-row">
                    <div class="nccm-field-group">
                        <label>Identity Verification</label>
                        <select id="nccm_f_identity_verification_mode" class="form-control">
                            <option>None</option>
                            <option>Email OTP</option>
                            <option>Registered Email OTP</option>
                        </select>
                        <div class="nexus-admin-muted">Email OTP is not login. Registered Email OTP requires a verified registry match unless public fallback is enabled.</div>
                    </div>
                    <div class="nccm-field-group" style="justify-content:flex-end; padding-top:20px;">
                        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                            <input id="nccm_f_public_fallback" type="checkbox" style="width:14px; height:14px;">
                            Allow Public Fallback
                        </label>
                    </div>
                </div>
                <div class="nccm-field-group">
                    <label>Description</label>
                    <textarea id="nccm_f_description" class="form-control" rows="2" placeholder="Optional admin notes"></textarea>
                </div>
                <div class="nccm-field-group">
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                        <input id="nccm_f_enabled" type="checkbox" checked style="width:14px; height:14px;">
                        Enabled (visible in chat window)
                    </label>
                </div>
                <div class="nccm-info-box">
                    Profile assignment per identity type is managed in the
                    <b>Category Profile Routes</b> page after saving this category.
                </div>
                <div id="nccm_modal_error" style="display:none; padding:12px; border-radius:12px; background:#fff0f0; border:1px solid #ffd1d1; color:#b42318; font-size:12px; font-weight:800;"></div>
            </div>
            <div class="nccm-modal-footer">
                <button id="nccm_modal_cancel" class="btn btn-default">Cancel</button>
                <button id="nccm_modal_save" class="btn btn-primary">Save Category</button>
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
        $(page.body).on('click', '#nccm_add_btn', () => openModal(null));
        $(page.body).on('click', '#nccm_routes_btn', () => frappe.set_route('nexus-category-profile-routes'));
        $(page.body).on('click', '#nccm_modal_close, #nccm_modal_cancel', closeModal);
        $(page.body).on('click', '#nccm_modal_overlay', function (e) {
            if ($(e.target).is('#nccm_modal_overlay')) closeModal();
        });
        $(page.body).on('click', '#nccm_modal_save', saveCategory);
        $(page.body).on('click', '#nccm_chain_close', () => $('#nccm_chain_card').hide());

        // Test Chat Connectivity
        $(page.body).on('click', '#nccm_test_chat_btn', openTestModal);
        $(page.body).on('click', '#nccm_test_close, #nccm_test_close2', closeTestModal);
        $(page.body).on('click', '#nccm_test_overlay', function (e) {
            if ($(e.target).is('#nccm_test_overlay')) closeTestModal();
        });
        $(page.body).on('click', '#nccm_test_rerun', runConnectivityTest);
    }

    // -------------------------------------------------------------------------
    // Data loading
    // -------------------------------------------------------------------------
    function loadInitialData() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_chat_category_manager.get_page_data',
            callback(r) {
                $('#nccm_channels_loading').hide();
                if (!r.message) return;
                state.channels = r.message.channels || [];
                renderChannelList();
            },
        });
    }

    function loadChannelCategories(channel) {
        $('#nccm_cat_loading').show();
        $('#nccm_cat_list').empty();
        $('#nccm_no_cats').hide();

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_chat_category_manager.get_channel_categories',
            args: { channel },
            callback(r) {
                $('#nccm_cat_loading').hide();
                state.categories = (r.message && r.message.categories) || [];
                renderCategories();
            },
        });
    }

    // -------------------------------------------------------------------------
    // Channel list
    // -------------------------------------------------------------------------
    function renderChannelList() {
        const $list = $('#nccm_channel_list');
        if (!state.channels.length) {
            $list.html('<div class="nexus-empty-state">No enabled channels found.</div>');
            return;
        }
        $list.html(state.channels.map(ch => `
            <div class="nexus-kv-row nccm-channel-item" data-channel="${esc(ch.name)}" style="margin-bottom:6px; cursor:pointer;">
                <div>
                    <span>${esc(ch.channel_name || ch.name)}</span>
                    <div class="nexus-admin-muted">${esc(ch.channel_type || '')}</div>
                </div>
                <b style="color:#214dbb; font-size:16px;">›</b>
            </div>`).join(''));

        $list.on('click', '.nccm-channel-item', function () {
            selectChannel($(this).data('channel'));
        });
    }

    function selectChannel(channel) {
        state.selectedChannel = channel;
        $('#nccm_channel_list .nccm-channel-item').removeClass('nccm-channel-active');
        $(`#nccm_channel_list .nccm-channel-item[data-channel="${CSS.escape(channel)}"]`).addClass('nccm-channel-active');

        const ch = state.channels.find(c => c.name === channel);
        $('#nccm_channel_title').text(ch ? (ch.channel_name || channel) : channel);
        $('#nccm_placeholder').hide();
        $('#nccm_channel_content').show();
        loadChannelCategories(channel);
    }

    // -------------------------------------------------------------------------
    // Category list
    // -------------------------------------------------------------------------
    function renderCategories() {
        const $list = $('#nccm_cat_list');
        if (!state.categories.length) {
            $('#nccm_no_cats').show();
            $list.empty();
            return;
        }
        $('#nccm_no_cats').hide();

        const rows = state.categories.map(cat => {
            const identities = (cat.configured_identities || []);
            const identityPills = identities.length
                ? identities.map(i => `<span class="nccm-identity-pill nccm-id-${esc(i.toLowerCase())}">${esc(i)}</span>`).join('')
                : `<span style="color:#b42318; font-size:11px; font-weight:800;">⚠ No routes</span>`;

            return `
                <tr>
                    <td style="vertical-align:middle;">
                        <b style="color:#173b8c; font-size:13px;">${esc(cat.category_label)}</b>
                        ${cat.description ? `<div class="nexus-admin-muted">${esc(cat.description)}</div>` : ''}
                    </td>
                    <td style="vertical-align:middle;">
                        <div style="display:flex; flex-wrap:wrap; gap:4px;">${identityPills}</div>
                    </td>
                    <td style="text-align:center; vertical-align:middle;">
                        ${cat.requires_authentication
                            ? `<span class="nexus-status-pill" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-size:9px;">Auth</span>`
                            : `<span class="nexus-status-pill" style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; font-size:9px;">Public</span>`}
                        ${cat.identity_verification_mode && cat.identity_verification_mode !== 'None'
                            ? `<div style="margin-top:4px;"><span class="nexus-status-pill" style="background:#fff7ed; color:#c2410c; border:1px solid #fed7aa; font-size:9px;">${esc(cat.identity_verification_mode)}</span></div>`
                            : ''}
                    </td>
                    <td style="text-align:center; vertical-align:middle;">
                        <span class="nexus-status-pill ${cat.enabled ? 'enabled' : 'disabled'}">${cat.enabled ? 'On' : 'Off'}</span>
                    </td>
                    <td style="text-align:right; vertical-align:middle; white-space:nowrap;">
                        <button class="btn btn-xs btn-info nccm-chain-btn" data-code="${esc(cat.category_code)}" data-label="${esc(cat.category_label)}" style="margin-right:3px;">Chain</button>
                        <button class="btn btn-xs btn-default nccm-edit-btn" data-name="${esc(cat.name)}" style="margin-right:3px;">Edit</button>
                        <button class="btn btn-xs ${cat.enabled ? 'btn-warning' : 'btn-success'} nccm-toggle-btn"
                            data-name="${esc(cat.name)}" data-enabled="${cat.enabled ? 0 : 1}">
                            ${cat.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button class="btn btn-xs btn-danger nccm-delete-btn" data-name="${esc(cat.name)}" style="margin-left:3px;">✕</button>
                    </td>
                </tr>`;
        }).join('');

        $list.html(`
            <table class="table table-bordered nexus-admin-table" style="margin-bottom:0;">
                <thead><tr>
                    <th>Label</th>
                    <th>Configured Identities</th>
                    <th style="width:70px; text-align:center;">Visibility</th>
                    <th style="width:60px; text-align:center;">Status</th>
                    <th style="width:240px; text-align:right;">Actions</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`);

        $list.off('click', '.nccm-chain-btn').on('click', '.nccm-chain-btn', function () {
            loadChain($(this).data('code'), $(this).data('label'));
        });
        $list.off('click', '.nccm-edit-btn').on('click', '.nccm-edit-btn', function () {
            openModal($(this).data('name'));
        });
        $list.off('click', '.nccm-toggle-btn').on('click', '.nccm-toggle-btn', function () {
            toggleCategory($(this).data('name'), $(this).data('enabled'));
        });
        $list.off('click', '.nccm-delete-btn').on('click', '.nccm-delete-btn', function () {
            deleteCategory($(this).data('name'));
        });
    }

    // -------------------------------------------------------------------------
    // Modal — label, order, auth, description only
    // -------------------------------------------------------------------------
    function openModal(name) {
        state.editingName = name || null;
        $('#nccm_modal_error').hide();

        if (name) {
            const cat = state.categories.find(c => c.name === name);
            if (!cat) return;
            $('#nccm_modal_title').text('Edit Category');
            $('#nccm_f_label').val(cat.category_label);
            $('#nccm_f_order').val(cat.display_order);
            $('#nccm_f_auth').prop('checked', !!cat.requires_authentication);
            $('#nccm_f_identity_verification_mode').val(cat.identity_verification_mode || 'None');
            $('#nccm_f_public_fallback').prop('checked', !!cat.allow_public_fallback);
            $('#nccm_f_description').val(cat.description || '');
            $('#nccm_f_enabled').prop('checked', !!cat.enabled);
        } else {
            $('#nccm_modal_title').text('Add Category');
            $('#nccm_f_label').val('');
            $('#nccm_f_order').val(10);
            $('#nccm_f_auth').prop('checked', false);
            $('#nccm_f_identity_verification_mode').val('None');
            $('#nccm_f_public_fallback').prop('checked', false);
            $('#nccm_f_description').val('');
            $('#nccm_f_enabled').prop('checked', true);
        }

        $('#nccm_modal_overlay').show();
        $('#nccm_f_label').focus();
    }

    function closeModal() {
        $('#nccm_modal_overlay').hide();
        state.editingName = null;
    }

    function saveCategory() {
        const label = $('#nccm_f_label').val().trim();
        if (!label) {
            $('#nccm_modal_error').show().text('Category Label is required.');
            return;
        }

        $('#nccm_modal_error').hide();
        $('#nccm_modal_save').prop('disabled', true).text('Saving…');

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_chat_category_manager.save_category',
            args: {
                channel: state.selectedChannel,
                category_label: label,
                display_order: $('#nccm_f_order').val() || 10,
                description: $('#nccm_f_description').val().trim(),
                enabled: $('#nccm_f_enabled').is(':checked') ? 1 : 0,
                requires_authentication: $('#nccm_f_auth').is(':checked') ? 1 : 0,
                identity_verification_mode: $('#nccm_f_identity_verification_mode').val() || 'None',
                allow_public_fallback: $('#nccm_f_public_fallback').is(':checked') ? 1 : 0,
                name: state.editingName || null,
            },
            callback(r) {
                $('#nccm_modal_save').prop('disabled', false).text('Save Category');
                if (r.message && r.message.status === 'success') {
                    closeModal();
                    frappe.show_alert({ message: 'Category saved. Go to Manage Routes to assign profiles per identity type.', indicator: 'green' }, 6);
                    loadChannelCategories(state.selectedChannel);
                }
            },
            error() {
                $('#nccm_modal_save').prop('disabled', false).text('Save Category');
            },
        });
    }

    function toggleCategory(name, enabled) {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_chat_category_manager.toggle_category',
            args: { name, enabled },
            callback(r) {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert({ message: enabled ? 'Enabled.' : 'Disabled.', indicator: enabled ? 'green' : 'orange' });
                    loadChannelCategories(state.selectedChannel);
                }
            },
        });
    }

    function deleteCategory(name) {
        frappe.confirm(
            'Delete this category and all its identity routes? This cannot be undone.',
            () => {
                frappe.call({
                    method: 'digitz_ai_nexus_live.api.nexus_chat_category_manager.delete_category',
                    args: { name },
                    callback(r) {
                        if (r.message && r.message.status === 'success') {
                            frappe.show_alert({ message: 'Category and routes deleted.', indicator: 'green' });
                            loadChannelCategories(state.selectedChannel);
                        }
                    },
                });
            }
        );
    }

    // -------------------------------------------------------------------------
    // Chain preview — multiple routes per category
    // -------------------------------------------------------------------------
    function loadChain(categoryCode, categoryLabel) {
        $('#nccm_chain_card').show();
        $('#nccm_chain_subtitle').text(categoryLabel);
        $('#nccm_chain_body').html('<div class="nexus-empty-state">Resolving chains…</div>');
        $('html, body').animate({ scrollTop: $('#nccm_chain_card').offset().top - 80 }, 300);

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_chat_category_manager.get_category_chain',
            args: { category_code: categoryCode },
            callback(r) {
                if (!r.message) return;
                renderChain(r.message);
            },
        });
    }

    function renderChain(data) {
        const cat = data.category || {};
        const routes = data.routes || [];
        const warnings = data.warnings || [];
        let html = '';

        if (warnings.length) {
            html += warnings.map(w => `
                <div class="nccm-chain-warning"><span style="font-size:16px;">⚠️</span><span>${esc(w)}</span></div>`
            ).join('');
        }

        if (!routes.length) {
            html += `<div class="nexus-empty-state">No identity routes configured for this category.
                <a class="nccm-link" onclick="frappe.set_route('nexus-category-profile-routes')">
                    Add routes →
                </a></div>`;
            $('#nccm_chain_body').html(html);
            return;
        }

        // One horizontal chain per identity route
        routes.forEach(route => {
            html += `
                <div class="nccm-route-chain-wrap">
                    <div class="nccm-chain-flow">

                        <!-- Identity -->
                        <div class="nccm-chain-node">
                            <div class="nccm-chain-node-label">Identity</div>
                            <div class="nccm-chain-node-card" style="display:flex; align-items:center; justify-content:center; min-height:56px;">
                                <span class="nccm-identity-pill nccm-id-${esc((route.identity_type||'').toLowerCase())}" style="font-size:13px; padding:7px 16px;">
                                    ${esc(route.identity_type)}
                                </span>
                            </div>
                        </div>

                        <div class="nccm-chain-arrow">→</div>

                        <!-- Profile -->
                        <div class="nccm-chain-node">
                            <div class="nccm-chain-node-label">AI Agent Profile</div>
                            <div class="nccm-chain-node-card">`;

            if (route.profile) {
                html += `
                    <div class="nccm-chain-node-title">${esc(route.profile.name)}</div>
                    <div class="nexus-admin-muted" style="margin-top:5px; line-height:1.6;">
                        ${route.profile.agent ? `${esc(route.profile.agent)}<br>` : ''}
                        ${route.profile.tone ? `Tone: ${esc(route.profile.tone)}<br>` : ''}
                        Threshold: ${route.profile.confidence_threshold || 0.65}
                    </div>`;
            } else {
                html += `<span style="color:#b42318; font-size:12px; font-weight:800;">Not configured</span>`;
            }

            html += `</div></div><div class="nccm-chain-arrow">→</div>`;

            // Access categories
            html += `<div class="nccm-chain-node"><div class="nccm-chain-node-label">Access Categories</div><div class="nccm-chain-node-card">`;
            if (route.access_categories && route.access_categories.length) {
                html += route.access_categories.map(c =>
                    `<div style="display:flex; align-items:center; gap:5px; margin-bottom:3px;">
                        <span style="color:#16a34a; font-size:11px;">✓</span>
                        <span style="font-size:11px; font-weight:850; color:#173b8c;">${esc(c)}</span>
                    </div>`
                ).join('');
            } else {
                html += `<span style="color:#b42318; font-size:11px; font-weight:800;">None</span>`;
            }
            html += `</div></div><div class="nccm-chain-arrow">→</div>`;

            // Policies
            html += `<div class="nccm-chain-node"><div class="nccm-chain-node-label">Policies</div><div class="nccm-chain-node-card">`;
            if (route.policies && route.policies.length) {
                html += `<div style="display:flex; flex-wrap:wrap; gap:4px;">`;
                html += route.policies.map(p =>
                    `<span class="${p.is_primitive ? 'nccm-policy-primitive' : 'nccm-policy-chip'}">${esc(p.policy_name)}${p.is_primitive ? ' ★' : ''}</span>`
                ).join('');
                html += `</div><div class="nexus-admin-muted" style="margin-top:6px;">${route.policies.length} polic${route.policies.length !== 1 ? 'ies' : 'y'}</div>`;
            } else {
                html += `<span style="color:#b42318; font-size:11px; font-weight:800;">None — denied</span>`;
            }
            html += `</div></div>`;

            html += `</div>`; // .nccm-chain-flow

            if (route.warnings && route.warnings.length) {
                html += route.warnings.map(w => `<div class="nccm-chain-warning" style="margin-top:8px;"><span>⚠️</span><span>${esc(w)}</span></div>`).join('');
            }

            html += `</div>`; // .nccm-route-chain-wrap
        });

        $('#nccm_chain_body').html(html);
    }

    // -------------------------------------------------------------------------
    // Test Chat Connectivity
    // -------------------------------------------------------------------------
    function openTestModal() {
        $('#nccm_test_overlay').show();
        $('#nccm_test_rerun').hide();
        $('#nccm_test_body').html(`
            <div class="nccm-test-running">
                <div class="nccm-spinner"></div>
                <div>Running connectivity test…</div>
            </div>`);
        runConnectivityTest();
    }

    function closeTestModal() {
        $('#nccm_test_overlay').hide();
    }

    function runConnectivityTest() {
        $('#nccm_test_rerun').hide();
        $('#nccm_test_body').html(`
            <div class="nccm-test-running">
                <div class="nccm-spinner"></div>
                <div>Running connectivity test…</div>
            </div>`);

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_chat_category_manager.test_chat_connectivity',
            callback(r) {
                $('#nccm_test_rerun').show();
                if (!r.message) {
                    $('#nccm_test_body').html(
                        `<div class="nccm-test-step nccm-step-fail">
                            <div class="nccm-test-step-icon">✗</div>
                            <div class="nccm-test-step-content">
                                <div class="nccm-test-step-label">No response from server</div>
                                <div class="nccm-test-step-detail">The API returned an empty response. Check the server error log.</div>
                            </div>
                        </div>`
                    );
                    return;
                }
                renderTestResults(r.message);
            },
            error(r) {
                $('#nccm_test_rerun').show();
                const msg = (r && r.responseJSON && r.responseJSON.exception) || 'Server error — check the error log.';
                $('#nccm_test_body').html(
                    `<div class="nccm-test-step nccm-step-fail" style="margin-top:0;">
                        <div class="nccm-test-step-icon">✗</div>
                        <div class="nccm-test-step-content">
                            <div class="nccm-test-step-label">API call failed</div>
                            <div class="nccm-test-step-detail">${esc(msg)}</div>
                        </div>
                    </div>`
                );
            },
        });
    }

    function renderTestResults(data) {
        const steps = data.steps || [];
        const overall = data.overall;
        const passed = steps.filter(s => s.status === 'pass').length;
        const checked = steps.filter(s => s.status !== 'skip').length;

        const overallBg   = overall === 'pass' ? '#ecfdf3' : '#fff0f0';
        const overallBdr  = overall === 'pass' ? '#bdebd2' : '#ffd1d1';
        const overallClr  = overall === 'pass' ? '#16794c' : '#b42318';
        const overallIcon = overall === 'pass' ? '✓' : '✗';
        const overallMsg  = overall === 'pass'
            ? 'All checks passed — desk user chat is operational.'
            : 'Chat connectivity issue detected. See the failed step below.';

        let html = `
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;
                        padding:14px 18px; border-radius:14px;
                        background:${overallBg}; border:1px solid ${overallBdr};">
                <span style="font-size:24px; font-weight:900; color:${overallClr};">${overallIcon}</span>
                <div>
                    <div style="font-size:13px; font-weight:900; color:${overallClr};">${esc(overallMsg)}</div>
                    <div class="nexus-admin-muted" style="margin-top:2px;">${passed} / ${checked} checks passed</div>
                </div>
            </div>
            <div class="nccm-test-steps">`;

        steps.forEach(s => {
            const isFail = s.status === 'fail';
            const isSkip = s.status === 'skip';
            const cls    = isFail ? 'nccm-step-fail' : (isSkip ? 'nccm-step-skip' : 'nccm-step-pass');
            const icon   = isFail ? '✗' : (isSkip ? '—' : '✓');

            html += `
                <div class="nccm-test-step ${cls}">
                    <div class="nccm-test-step-num">${s.step}</div>
                    <div class="nccm-test-step-icon">${icon}</div>
                    <div class="nccm-test-step-content">
                        <div class="nccm-test-step-label">${esc(s.label)}</div>
                        ${s.detail ? `<div class="nccm-test-step-detail">${esc(s.detail)}</div>` : ''}
                        ${s.error ? `<div class="nccm-test-step-error"><pre class="nccm-traceback">${esc(s.error)}</pre></div>` : ''}
                    </div>
                </div>`;
        });

        html += '</div>';
        $('#nccm_test_body').html(html);
    }

    // -------------------------------------------------------------------------
    function esc(s) { return frappe.utils.escape_html(String(s || '')); }
};


function inject_nccm_css() {
    if ($('#nccm_css').length) return;
    $('head').append(`<style id="nccm_css">
        .nccm-wrap { padding:12px; }
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

        .nccm-layout { display:grid; grid-template-columns:220px 1fr; gap:18px; align-items:start; }
        .nccm-channel-panel { position:sticky; top:64px; }
        .nccm-channel-inner { max-height:540px; overflow-y:auto; }
        .nccm-channel-item:hover { background:#eef6ff !important; border-color:rgba(33,77,187,.35) !important; cursor:pointer; }
        .nccm-channel-active { background:#eef6ff !important; border-color:rgba(33,77,187,.55) !important; }
        .nccm-channel-title { font-size:20px; font-weight:950; color:#102b67; margin-top:4px; }
        .nccm-placeholder { text-align:center; padding:48px 20px; }
        .nccm-placeholder-icon { font-size:28px; margin-bottom:12px; color:#b0c4de; }
        .nccm-placeholder > div:last-child { color:#53688f; font-size:14px; font-weight:700; }

        .nccm-identity-pill { display:inline-flex; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:900; white-space:nowrap; background:#eef6ff; color:#173b8c; border:1px solid rgba(33,77,187,.22); }
        .nccm-id-public    { background:#f0fdf4; color:#15803d; border-color:#bbf7d0; }
        .nccm-id-customer  { background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; }
        .nccm-id-prospect  { background:#fefce8; color:#a16207; border-color:#fde68a; }
        .nccm-id-partner   { background:#fdf4ff; color:#7e22ce; border-color:#e9d5ff; }
        .nccm-id-internal  { background:#fff7ed; color:#c2410c; border-color:#fed7aa; }
        .nccm-id-admin     { background:#fff0f0; color:#b42318; border-color:#ffd1d1; }

        .nccm-route-chain-wrap { margin-bottom:18px; padding-bottom:18px; border-bottom:1px dashed rgba(77,163,255,.25); }
        .nccm-route-chain-wrap:last-child { border-bottom:none; margin-bottom:0; padding-bottom:0; }
        .nccm-chain-warning { display:flex; align-items:flex-start; gap:10px; padding:12px 16px; border-radius:14px; background:#fff7e6; border:1px solid #f2d49b; color:#8a5d00; font-size:12px; font-weight:800; margin-bottom:14px; line-height:1.5; }
        .nccm-chain-flow { display:flex; align-items:flex-start; gap:0; flex-wrap:wrap; overflow-x:auto; }
        .nccm-chain-arrow { display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:900; color:#214dbb; padding:0 8px; margin-top:26px; flex-shrink:0; }
        .nccm-chain-node { display:flex; flex-direction:column; min-width:150px; max-width:200px; }
        .nccm-chain-node-label { font-size:10px; font-weight:900; color:#6b7c9b; text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
        .nccm-chain-node-card { border:1px solid rgba(77,163,255,.28); border-radius:14px; background:#f8fbff; padding:12px 14px; min-height:56px; }
        .nccm-chain-node-title { font-size:13px; font-weight:950; color:#102b67; }
        .nccm-policy-chip { display:inline-flex; padding:3px 9px; border-radius:999px; font-size:10px; font-weight:900; background:#eef6ff; color:#173b8c; border:1px solid rgba(33,77,187,.22); }
        .nccm-policy-primitive { display:inline-flex; padding:3px 9px; border-radius:999px; font-size:10px; font-weight:900; background:#fff7e6; color:#8a5d00; border:1px solid #f2d49b; }
        .nccm-link { color:#214dbb; cursor:pointer; font-weight:850; }

        .nccm-info-box { padding:10px 14px; border-radius:12px; background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8; font-size:11px; font-weight:700; line-height:1.5; }

        .nccm-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:9999; display:flex; align-items:center; justify-content:center; }
        .nccm-modal { background:#fff; border-radius:22px; width:460px; max-width:95vw; box-shadow:0 24px 60px rgba(0,0,0,.22); overflow:hidden; }
        .nccm-modal-header { display:flex; justify-content:space-between; align-items:center; padding:20px 24px 16px; border-bottom:1px solid #e8eef7; }
        .nccm-modal-body { padding:20px 24px; display:flex; flex-direction:column; gap:14px; }
        .nccm-modal-footer { display:flex; justify-content:flex-end; gap:10px; padding:16px 24px 20px; border-top:1px solid #e8eef7; }
        .nccm-modal-footer .btn { border-radius:999px; font-weight:850; }
        .nccm-field-group { display:flex; flex-direction:column; gap:5px; }
        .nccm-field-group label { font-size:12px; font-weight:900; color:#173b8c; }
        .nccm-field-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .nccm-req { color:#b42318; }

        /* ── Test Chat button ──────────────────────────────────────────────────── */
        .nccm-test-btn { border-radius:999px; font-weight:850; background:linear-gradient(135deg,#1e3a8a,#2563eb); color:#fff; border:none; padding:7px 18px; transition:opacity .15s; }
        .nccm-test-btn:hover { opacity:.88; color:#fff; }

        /* ── Test modal ────────────────────────────────────────────────────────── */
        .nccm-test-modal { width:620px; max-width:96vw; }
        .nccm-test-body { max-height:72vh; overflow-y:auto; padding:20px 24px; display:flex; flex-direction:column; gap:0; }
        .nccm-test-running { display:flex; align-items:center; gap:14px; padding:24px; color:#53688f; font-weight:800; font-size:13px; }
        .nccm-spinner { width:22px; height:22px; border:3px solid #bfdbfe; border-top-color:#2563eb; border-radius:50%; animation:nccm-spin .7s linear infinite; flex-shrink:0; }
        @keyframes nccm-spin { to { transform:rotate(360deg); } }

        /* ── Step rows ─────────────────────────────────────────────────────────── */
        .nccm-test-steps { display:flex; flex-direction:column; gap:8px; }
        .nccm-test-step { display:grid; grid-template-columns:28px 22px 1fr; gap:10px; align-items:flex-start; padding:12px 14px; border-radius:14px; border:1px solid; }
        .nccm-step-pass { background:#f0fdf4; border-color:#bbf7d0; }
        .nccm-step-fail { background:#fff0f0; border-color:#ffd1d1; }
        .nccm-step-skip { background:#f9fafb; border-color:#e5e7eb; }

        .nccm-test-step-num { font-size:10px; font-weight:900; color:#9ca3af; padding-top:2px; text-align:center; }
        .nccm-test-step-icon { font-size:15px; font-weight:900; padding-top:1px; }
        .nccm-step-pass .nccm-test-step-icon { color:#16a34a; }
        .nccm-step-fail .nccm-test-step-icon { color:#b42318; }
        .nccm-step-skip .nccm-test-step-icon { color:#9ca3af; }

        .nccm-test-step-content { display:flex; flex-direction:column; gap:3px; min-width:0; }
        .nccm-test-step-label { font-size:12px; font-weight:900; color:#173b8c; }
        .nccm-step-fail .nccm-test-step-label { color:#b42318; }
        .nccm-step-skip .nccm-test-step-label { color:#6b7c9b; }
        .nccm-test-step-detail { font-size:11px; font-weight:650; color:#27416f; line-height:1.5; }
        .nccm-step-skip .nccm-test-step-detail { color:#9ca3af; }

        .nccm-test-step-error { margin-top:8px; }
        .nccm-traceback { font-family:monospace; font-size:10px; white-space:pre-wrap; word-break:break-all; line-height:1.55; color:#7f1d1d; background:#fff5f5; border:1px solid #fecaca; border-radius:10px; padding:10px 12px; max-height:220px; overflow-y:auto; margin:0; }

        @media (max-width:820px) { .nccm-layout { grid-template-columns:1fr; } .nccm-channel-panel { position:static; } }
        @media (max-width:760px) { .nexus-admin-hero { flex-direction:column; } .nccm-chain-flow { flex-direction:column; } .nccm-chain-arrow { margin-top:0; padding:4px 0; transform:rotate(90deg); align-self:center; } .nccm-chain-node { max-width:100%; } .nccm-test-modal { width:95vw; } }
    </style>`);
}

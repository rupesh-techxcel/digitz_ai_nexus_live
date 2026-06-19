frappe.pages['nexus-category-route-editor'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Category Route Editor',
        single_column: true,
    });

    const state = {
        mode: 'create',   // 'create' | 'edit'
        routeName: null,
        tenant: '',
        channel: null,
        channelLabel: null,
        category: null,
        categoryLabel: null,
        profiles: [],
        identityProfiles: [],
        // form values
        ai_agent_profile: '',
        enabled: true,
        published: true,
        priority: 10,
        description: '',
        identity_profiles: [],   // array of name strings
    };

    inject_ncre_css();

    // on_page_show fires every time the page becomes visible (on_page_load fires only once).
    // We re-read frappe._ncre_context here so navigating back and then opening a different
    // route/category picks up the new context correctly.
    frappe.pages['nexus-category-route-editor'].on_page_show = function () {
        const ctx = frappe._ncre_context;
        if (ctx) {
            delete frappe._ncre_context;
            resetState();
            if (ctx.route) {
                state.mode = 'edit';
                state.routeName = ctx.route;
            } else {
                state.mode = 'create';
                state.tenant = ctx.tenant || '';
                state.channel = ctx.channel || '';
                state.channelLabel = ctx.channel_label || ctx.channel || '';
                state.category = ctx.category || '';
                state.categoryLabel = ctx.category_label || ctx.category || '';
            }
            loadPageData();
        } else if (!state.channel && !state.routeName) {
            // Page opened without context (direct URL / refresh) — redirect back
            frappe.show_alert({ message: 'Please open this page from the Category Routes manager.', indicator: 'orange' }, 5);
            frappe.set_route('nexus-category-profile-routes');
        }
        // else: page already has valid state (e.g. user navigated away and came back mid-edit)
    };

    function resetState() {
        Object.assign(state, {
            mode: 'create',
            routeName: null,
            tenant: '',
            channel: null,
            channelLabel: null,
            category: null,
            categoryLabel: null,
            profiles: [],
            identityProfiles: [],
            ai_agent_profile: '',
            enabled: true,
            published: true,
            priority: 10,
            description: '',
            identity_profiles: [],
        });
    }

    function loadPageData() {
        if (state.mode === 'edit' && state.routeName && !state.channel) {
            // For edit mode: fetch the route first to get tenant, then fetch page data filtered by it
            frappe.call({
                method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.get_route',
                args: { name: state.routeName },
                callback(r) {
                    if (!r.message) { frappe.msgprint('Route not found.'); return; }
                    const d = r.message;
                    state.tenant = d.tenant || '';
                    state.channel = d.channel;
                    state.channelLabel = d.channel;
                    state.category = d.chat_category;
                    state.categoryLabel = d.chat_category;
                    state.ai_agent_profile = d.ai_agent_profile || '';
                    state.enabled = !!d.enabled;
                    state.published = !!d.published;
                    state.priority = d.priority || 10;
                    state.description = d.description || '';
                    state.identity_profiles = d.identity_profiles || [];
                    fetchProfilesAndRender();
                },
            });
        } else {
            fetchProfilesAndRender();
        }
    }

    function fetchProfilesAndRender() {
        const args = {};
        if (state.tenant) args.tenant = state.tenant;
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.get_page_data',
            args,
            callback(r) {
                if (!r.message) return;
                state.profiles = r.message.profiles || [];
                state.identityProfiles = r.message.identity_profiles || [];
                renderPage();
            },
        });
    }

    // -------------------------------------------------------------------------
    // HTML
    // -------------------------------------------------------------------------
    function buildHTML() {
        const profileOptions = state.profiles.map(p =>
            `<option value="${esc(p.name)}" ${p.name === state.ai_agent_profile ? 'selected' : ''}>${esc(p.agent_name || p.name)}</option>`
        ).join('');

        const ipOptions = state.identityProfiles.map(ip =>
            `<option value="${esc(ip.name)}">${esc(ip.profile_name || ip.name)}</option>`
        ).join('');

        const assignedIPs = state.identity_profiles.map(ip => `
            <div class="ncre-ip-row" data-ip="${esc(ip)}">
                <span class="ncre-ip-chip">${esc(ip)}</span>
                <button class="ncre-ip-remove btn btn-xs btn-danger" data-ip="${esc(ip)}">✕</button>
            </div>`).join('');

        const title = state.mode === 'edit' ? 'Edit Route' : 'New Route';
        const contextLine = `${esc(state.channelLabel)} → ${esc(state.categoryLabel)}`;

        return `
<div class="ncre-wrap">

    <div class="nexus-admin-hero">
        <div>
            <div class="nexus-admin-badge">DIGITZ AI Nexus</div>
            <h2>${title}</h2>
            <p>Configure the AI Agent Profile and access rules for this channel-category route.</p>
            <div class="nexus-admin-flow-pill">${contextLine}</div>
        </div>
        <div class="nexus-admin-hero-actions">
            <button id="ncre_back_btn" class="btn btn-default">← Back to Routes</button>
        </div>
    </div>

    <div class="ncre-layout">

        <!-- Left: Core configuration -->
        <div class="nexus-admin-card">
            <div class="nexus-admin-card-title">Route Configuration</div>

            <div class="ncre-field-group">
                <label class="ncre-label">AI Agent Profile <span class="ncre-required">*</span></label>
                <select id="ncre_agent_profile" class="ncre-select">
                    <option value="">— Select Profile —</option>
                    ${profileOptions}
                </select>
                <div class="ncre-hint">AI behavior configuration — tone, fallback message, escalation settings.</div>
            </div>

            <div class="ncre-field-group">
                <label class="ncre-label">Priority</label>
                <input id="ncre_priority" type="number" class="ncre-input" value="${esc(state.priority)}" min="1" max="999" style="width:100px;" />
                <div class="ncre-hint">Lower number = higher priority when multiple routes match.</div>
            </div>

            <div class="ncre-field-group">
                <label class="ncre-label">Description</label>
                <textarea id="ncre_description" class="ncre-textarea" rows="3" placeholder="Optional notes about this route…">${esc(state.description)}</textarea>
            </div>

            <div class="ncre-divider"></div>

            <div class="ncre-checks">
                <label class="ncre-check-row">
                    <input type="checkbox" id="ncre_enabled" ${state.enabled ? 'checked' : ''} />
                    <div>
                        <div class="ncre-check-label">Enabled</div>
                        <div class="ncre-hint">Route is active and eligible for matching.</div>
                    </div>
                </label>
                <label class="ncre-check-row">
                    <input type="checkbox" id="ncre_published" ${state.published ? 'checked' : ''} />
                    <div>
                        <div class="ncre-check-label">Published</div>
                        <div class="ncre-hint">When checked, this route is active for identity-based routing. Uncheck to draft or suspend without deleting.</div>
                    </div>
                </label>
            </div>

            <div class="ncre-divider"></div>

            <div style="display:flex; gap:10px; justify-content:flex-end;">
                <button id="ncre_back_btn2" class="btn btn-default">Cancel</button>
                <button id="ncre_save_btn" class="btn btn-primary">Save Route</button>
            </div>
        </div>

        <!-- Right: Identity Profiles -->
        <div id="ncre_ip_panel" class="nexus-admin-card">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
                <div class="nexus-admin-card-title" style="margin-bottom:0;">Permitted Identity Profiles</div>
                <button id="ncre_ip_new_btn" class="btn btn-xs btn-default" style="border-radius:999px; font-weight:850;">+ New Profile</button>
            </div>
            <div class="ncre-hint" style="margin-bottom:16px;">
                Identity Profiles permitted to use this route. At runtime the visitor's assigned profiles are intersected against this list.
                Leave empty to allow any visitor — knowledge access is still governed by the access policy system.
            </div>

            <div id="ncre_ip_list" style="margin-bottom:14px; display:flex; flex-direction:column; gap:6px;">
                ${assignedIPs || '<div class="nexus-empty-state" id="ncre_ip_empty">No Identity Profiles assigned.</div>'}
            </div>

            <div style="display:flex; gap:8px; align-items:center;">
                <select id="ncre_ip_picker" class="ncre-select" style="flex:1;">
                    <option value="">— Add Identity Profile —</option>
                    ${ipOptions}
                </select>
                <button id="ncre_ip_add_btn" class="btn btn-sm btn-default">Add</button>
            </div>

            <!-- Inline new profile form (hidden by default) -->
            <div id="ncre_new_ip_form" class="ncre-new-ip-form" style="display:none;">
                <div class="ncre-divider"></div>
                <div style="font-size:12px; font-weight:900; color:#173b8c; margin-bottom:12px;">Create New Identity Profile</div>
                <div class="ncre-field-group" style="margin-bottom:12px;">
                    <label class="ncre-label">Profile Name <span class="ncre-required">*</span></label>
                    <input id="ncre_new_ip_name" type="text" class="ncre-input" style="width:100%;" placeholder="e.g. Premium Member" />
                </div>
                <div class="ncre-field-group" style="margin-bottom:12px;">
                    <label class="ncre-label">Display Title</label>
                    <input id="ncre_new_ip_title" type="text" class="ncre-input" style="width:100%;" placeholder="Optional friendly title" />
                </div>
                <label class="ncre-check-row" style="margin-bottom:12px;">
                    <input type="checkbox" id="ncre_new_ip_enabled" checked />
                    <div><div class="ncre-check-label">Enabled</div></div>
                </label>
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button id="ncre_new_ip_cancel" class="btn btn-xs btn-default">Cancel</button>
                    <button id="ncre_new_ip_save" class="btn btn-xs btn-primary">Create &amp; Assign</button>
                </div>
            </div>
        </div>

    </div>
</div>`;
    }

    function renderPage() {
        $(page.body).html(buildHTML());
        bindPageEvents();
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    function bindPageEvents() {
        $(page.body).on('click', '#ncre_back_btn, #ncre_back_btn2', () => {
            frappe.set_route('nexus-category-profile-routes');
        });

        $(page.body).on('click', '#ncre_save_btn', saveRoute);

        $(page.body).on('click', '#ncre_ip_add_btn', function () {
            const $picker = $('#ncre_ip_picker');
            const val = $picker.val();
            if (!val) return;
            if (state.identity_profiles.includes(val)) {
                frappe.show_alert({ message: 'Already added.', indicator: 'orange' });
                return;
            }
            state.identity_profiles.push(val);
            renderIPList();
            $picker.val('');
        });

        $(page.body).on('click', '.ncre-ip-remove', function () {
            const ip = $(this).data('ip');
            state.identity_profiles = state.identity_profiles.filter(x => x !== ip);
            renderIPList();
        });

        $(page.body).on('click', '#ncre_ip_new_btn', function () {
            $('#ncre_new_ip_form').slideDown(160);
            $('#ncre_new_ip_name').focus();
            $(this).hide();
        });

        $(page.body).on('click', '#ncre_new_ip_cancel', function () {
            $('#ncre_new_ip_form').slideUp(160);
            $('#ncre_new_ip_name').val('');
            $('#ncre_new_ip_title').val('');
            $('#ncre_new_ip_enabled').prop('checked', true);
            $('#ncre_ip_new_btn').show();
        });

        $(page.body).on('click', '#ncre_new_ip_save', createAndAssignProfile);
    }

    function createAndAssignProfile() {
        const profileName = $('#ncre_new_ip_name').val().trim();
        if (!profileName) {
            frappe.show_alert({ message: 'Profile Name is required.', indicator: 'red' });
            $('#ncre_new_ip_name').focus();
            return;
        }

        const $btn = $('#ncre_new_ip_save').prop('disabled', true).text('Creating…');

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.create_identity_profile',
            args: {
                profile_name: profileName,
                title: $('#ncre_new_ip_title').val().trim() || profileName,
                enabled: $('#ncre_new_ip_enabled').prop('checked') ? 1 : 0,
            },
            callback(r) {
                $btn.prop('disabled', false).text('Create & Assign');
                if (!r.message || r.message.status !== 'success') return;

                const newName = r.message.name;
                const newLabel = r.message.profile_name;

                // Add to picker dropdown
                $('#ncre_ip_picker').append(
                    `<option value="${frappe.utils.escape_html(newName)}">${frappe.utils.escape_html(newLabel)}</option>`
                );

                // Add to assigned list if not already there
                if (!state.identity_profiles.includes(newName)) {
                    state.identity_profiles.push(newName);
                    renderIPList();
                }

                // Reset form
                $('#ncre_new_ip_form').slideUp(160);
                $('#ncre_new_ip_name').val('');
                $('#ncre_new_ip_title').val('');
                $('#ncre_new_ip_enabled').prop('checked', true);
                $('#ncre_ip_new_btn').show();

                frappe.show_alert({ message: `Profile '${newLabel}' created and assigned.`, indicator: 'green' });
            },
            error() {
                $btn.prop('disabled', false).text('Create & Assign');
            },
        });
    }

    function renderIPList() {
        const $list = $('#ncre_ip_list');
        if (!state.identity_profiles.length) {
            $list.html('<div class="nexus-empty-state" id="ncre_ip_empty">No Identity Profiles assigned.</div>');
            return;
        }
        $list.html(state.identity_profiles.map(ip => `
            <div class="ncre-ip-row" data-ip="${esc(ip)}">
                <span class="ncre-ip-chip">${esc(ip)}</span>
                <button class="ncre-ip-remove btn btn-xs btn-danger" data-ip="${esc(ip)}">✕</button>
            </div>`).join(''));
    }

    // -------------------------------------------------------------------------
    // Save
    // -------------------------------------------------------------------------
    function saveRoute() {
        const agentProfile = $('#ncre_agent_profile').val();
        if (!agentProfile) {
            frappe.msgprint({ title: 'Missing Field', message: 'Please select an AI Agent Profile.', indicator: 'red' });
            return;
        }

        const data = {
            name: state.routeName || null,
            channel: state.channel,
            chat_category: state.category,
            ai_agent_profile: agentProfile,
            enabled: $('#ncre_enabled').prop('checked') ? 1 : 0,
            published: $('#ncre_published').prop('checked') ? 1 : 0,
            priority: parseInt($('#ncre_priority').val()) || 10,
            description: $('#ncre_description').val().trim(),
            identity_profiles: state.identity_profiles,
        };

        $('#ncre_save_btn').prop('disabled', true).text('Saving…');

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_category_profile_router.save_route',
            args: { data: JSON.stringify(data) },
            callback(r) {
                $('#ncre_save_btn').prop('disabled', false).text('Save Route');
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert({ message: 'Route saved.', indicator: 'green' });
                    frappe.set_route('nexus-category-profile-routes');
                }
            },
            error() {
                $('#ncre_save_btn').prop('disabled', false).text('Save Route');
            },
        });
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    function esc(s) { return frappe.utils.escape_html(String(s || '')); }
};


function inject_ncre_css() {
    if ($('#ncre_css').length) return;
    $('head').append(`<style id="ncre_css">
        .ncre-wrap { padding:12px; }

        .nexus-admin-hero { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; border-radius:26px; padding:30px 34px; margin-bottom:18px; background:radial-gradient(circle at 8% 20%,rgba(77,163,255,.28),transparent 30%),radial-gradient(circle at 92% 10%,rgba(224,166,47,.22),transparent 28%),linear-gradient(135deg,#fff 0%,#eef6ff 48%,#f8fbff 100%); border:1px solid rgba(77,163,255,.38); box-shadow:0 18px 45px rgba(33,77,187,.12); }
        .nexus-admin-badge { display:inline-flex; align-items:center; padding:8px 14px; border-radius:999px; background:rgba(33,77,187,.09); border:1px solid rgba(33,77,187,.16); color:#214dbb; font-weight:800; font-size:12px; letter-spacing:.04em; text-transform:uppercase; margin-bottom:12px; }
        .nexus-admin-hero h2 { margin:0; font-size:30px; font-weight:900; color:#102b67; letter-spacing:-0.03em; }
        .nexus-admin-hero p { margin:12px 0 0; max-width:880px; font-size:15px; line-height:1.7; color:#27416f; font-weight:500; }
        .nexus-admin-hero-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .nexus-admin-hero-actions .btn { border-radius:999px; font-weight:850; }
        .nexus-admin-flow-pill { display:inline-block; margin-top:12px; padding:7px 14px; border-radius:999px; background:rgba(33,77,187,.08); border:1px solid rgba(33,77,187,.18); color:#214dbb; font-size:11px; font-weight:800; font-family:monospace; }
        .nexus-admin-card { border:1px solid rgba(77,163,255,.28); border-radius:22px; background:#fff; padding:24px; box-shadow:0 12px 30px rgba(33,77,187,.07); }
        .nexus-admin-card-title { display:inline-flex; align-items:center; gap:12px; color:#173b8c; font-size:16px; font-weight:900; padding:10px 16px; margin-bottom:20px; border-radius:999px; background:#eef6ff; border:1px solid rgba(33,77,187,.14); }
        .nexus-admin-card-title:after { content:""; width:36px; height:4px; border-radius:999px; background:linear-gradient(90deg,#e0a62f,#f4ca64); }
        .nexus-empty-state { padding:12px 16px; border-radius:14px; background:#fff7e6; border:1px solid #f2d49b; color:#8a5d00; font-weight:800; font-size:12px; }

        .ncre-layout { display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start; }

        .ncre-field-group { margin-bottom:20px; }
        .ncre-label { display:block; font-size:12px; font-weight:850; color:#173b8c; margin-bottom:6px; }
        .ncre-required { color:#b42318; }
        .ncre-hint { font-size:11px; color:#6b7c9b; font-weight:650; margin-top:5px; line-height:1.5; }
        .ncre-select { width:100%; border:1.5px solid rgba(33,77,187,.25); border-radius:12px; padding:9px 14px; font-size:13px; font-weight:750; color:#173b8c; background:#fff; outline:none; }
        .ncre-select:focus { border-color:#214dbb; box-shadow:0 0 0 3px rgba(33,77,187,.1); }
        .ncre-input { border:1.5px solid rgba(33,77,187,.25); border-radius:12px; padding:9px 14px; font-size:13px; font-weight:750; color:#173b8c; background:#fff; outline:none; }
        .ncre-input:focus { border-color:#214dbb; box-shadow:0 0 0 3px rgba(33,77,187,.1); }
        .ncre-textarea { width:100%; border:1.5px solid rgba(33,77,187,.25); border-radius:12px; padding:9px 14px; font-size:13px; font-weight:650; color:#173b8c; background:#fff; outline:none; resize:vertical; }
        .ncre-textarea:focus { border-color:#214dbb; box-shadow:0 0 0 3px rgba(33,77,187,.1); }

        .ncre-divider { height:1px; background:rgba(33,77,187,.1); margin:20px 0; }

        .ncre-checks { display:flex; flex-direction:column; gap:14px; }
        .ncre-check-row { display:flex; align-items:flex-start; gap:12px; cursor:pointer; padding:12px 14px; border-radius:14px; border:1.5px solid rgba(33,77,187,.12); background:#f8fbff; }
        .ncre-check-row:hover { border-color:rgba(33,77,187,.3); background:#eef6ff; }
        .ncre-check-row input[type="checkbox"] { margin-top:2px; flex-shrink:0; width:16px; height:16px; cursor:pointer; accent-color:#214dbb; }
        .ncre-check-label { font-size:13px; font-weight:850; color:#173b8c; }

        .ncre-ip-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; border-radius:12px; background:#f8fbff; border:1px solid rgba(33,77,187,.18); }
        .ncre-ip-chip { font-size:12px; font-weight:850; color:#173b8c; }
        .ncre-ip-remove { flex-shrink:0; }
        .ncre-new-ip-form { margin-top:14px; padding:16px; border-radius:14px; background:#f0f4ff; border:1.5px solid rgba(33,77,187,.2); }

        @media (max-width:900px) { .ncre-layout { grid-template-columns:1fr; } .nexus-admin-hero { flex-direction:column; } }
    </style>`);
}

frappe.pages['nexus-profile-access-allocation'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus Profile Access Allocation',
        single_column: true,
    });

    const state = {
        profiles: [],
        categories: [],
        assignments: [],
        selectedProfile: null,
        pendingAssign: new Set(),
        pendingDisable: new Set(),
    };

    inject_npaa_css();
    $(page.body).html(buildHTML());
    bindEvents();
    loadInitialData();

    // -------------------------------------------------------------------------
    // HTML
    // -------------------------------------------------------------------------
    function buildHTML() {
        return `
<div class="npaa-wrap">

    <div class="nexus-admin-hero">
        <div>
            <div class="nexus-admin-badge">DIGITZ AI Nexus</div>
            <h2>Profile Access Allocation</h2>
            <p>
                Assign <b>Access Categories</b> to AI Agent Profiles.
                The profile is the single access authority — channel and role
                mappings do not affect runtime knowledge retrieval.
            </p>
            <div class="nexus-admin-flow-pill">
                AI Agent Profile &nbsp;→&nbsp; Access Category &nbsp;→&nbsp; Access Policy &nbsp;→&nbsp; Knowledge
            </div>
        </div>
        <div class="nexus-admin-hero-actions">
            <button class="btn btn-default" data-route-list="Nexus AI Agent Profile">Agent Profiles</button>
            <button class="btn btn-default" data-route-list="Nexus Access Category">Access Categories</button>
            <button class="btn btn-default" data-route-list="Nexus Access Policy">Access Policies</button>
            <button class="btn btn-default" data-route-list="Nexus AI Agent Profile Access Category">All Assignments</button>
        </div>
    </div>

    <div class="npaa-layout">

        <!-- Left: Profile list -->
        <div class="nexus-admin-card npaa-profile-panel">
            <div class="nexus-admin-card-title">AI Agent Profiles</div>
            <div class="npaa-profile-inner">
                <div id="npaa_profiles_loading" class="nexus-empty-state">Loading profiles…</div>
                <div id="npaa_profile_list"></div>
            </div>
        </div>

        <!-- Right: Content -->
        <div>

            <div id="npaa_placeholder" class="nexus-admin-card npaa-placeholder">
                <div class="npaa-placeholder-icon">←</div>
                <div>Select a profile to manage its Access Categories</div>
            </div>

            <div id="npaa_profile_content" style="display:none;">

                <!-- Profile header -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div class="nexus-admin-section-head" style="margin-bottom:0;">
                        <div>
                            <div class="nexus-admin-card-title">Selected Profile</div>
                            <div id="npaa_profile_title" class="npaa-profile-title"></div>
                            <div id="npaa_profile_meta" class="nexus-admin-muted" style="margin-top:6px;"></div>
                        </div>
                        <div>
                            <button class="btn btn-xs btn-default" data-open-profile>Open Profile</button>
                        </div>
                    </div>
                </div>

                <!-- Category assignment -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div class="nexus-admin-section-head">
                        <div>
                            <div class="nexus-admin-card-title">Access Category Assignment</div>
                            <p>Check to enable, uncheck to disable. Changes are not saved until you click Save.</p>
                        </div>
                        <div class="nexus-admin-action-row">
                            <span id="npaa_pending_note" class="npaa-pending-note" style="display:none;"></span>
                            <button id="npaa_discard_btn" class="btn btn-default btn-sm">Discard</button>
                            <button id="npaa_save_btn" class="btn btn-primary btn-sm">Save</button>
                        </div>
                    </div>
                    <div id="npaa_cat_loading" class="nexus-empty-state" style="display:none;">Loading…</div>
                    <div id="npaa_cat_list"></div>
                    <div id="npaa_no_cats" class="nexus-empty-state" style="display:none;">
                        No Access Categories found.
                        <a class="npaa-link" data-route-new="Nexus Access Category">Create one</a>.
                    </div>
                </div>

                <!-- Effective policies -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div class="nexus-admin-section-head">
                        <div>
                            <div class="nexus-admin-card-title">Effective Access Policies</div>
                            <p>All policies accessible through the assigned categories. This is what gets applied to knowledge retrieval.</p>
                        </div>
                        <div class="nexus-admin-action-row">
                            <button id="npaa_refresh_btn" class="btn btn-default btn-sm">Refresh</button>
                        </div>
                    </div>
                    <div id="npaa_policies_loading" class="nexus-empty-state" style="display:none;">Computing…</div>
                    <div id="npaa_policies_area"></div>
                    <div id="npaa_no_policies" class="nexus-empty-state" style="display:none;">
                        No policies accessible. Assign an Access Category above.
                    </div>
                </div>

                <!-- Category detail -->
                <div id="npaa_detail_card" class="nexus-admin-card" style="display:none; margin-bottom:18px;">
                    <div class="nexus-admin-section-head">
                        <div>
                            <div class="nexus-admin-card-title">Category Detail</div>
                            <div id="npaa_detail_name" style="font-size:16px; font-weight:900; color:#102b67; margin-top:4px;"></div>
                        </div>
                        <button id="npaa_close_detail" class="btn btn-default btn-sm">Close</button>
                    </div>
                    <div id="npaa_detail_area"></div>
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
        $(page.body).on('click', '[data-route-new]', function () {
            frappe.set_route('Form', $(this).data('route-new'), 'new');
        });
        $(page.body).on('click', '[data-open-profile]', function () {
            if (state.selectedProfile) {
                frappe.set_route('Form', 'Nexus AI Agent Profile', state.selectedProfile);
            }
        });
        $(page.body).on('click', '#npaa_save_btn', saveAssignments);
        $(page.body).on('click', '#npaa_discard_btn', discardChanges);
        $(page.body).on('click', '#npaa_refresh_btn', () => { if (state.selectedProfile) refreshPolicies(); });
        $(page.body).on('click', '#npaa_close_detail', () => $('#npaa_detail_card').hide());
    }

    // -------------------------------------------------------------------------
    // Data loading
    // -------------------------------------------------------------------------
    function loadInitialData() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.get_page_data',
            callback(r) {
                $('#npaa_profiles_loading').hide();
                if (!r.message) return;
                state.profiles = r.message.profiles || [];
                state.categories = r.message.categories || [];
                renderProfileList();
            },
        });
    }

    function loadProfileData(profile) {
        $('#npaa_cat_loading').show();
        $('#npaa_cat_list').empty();
        $('#npaa_no_cats').hide();
        $('#npaa_policies_area').empty();
        $('#npaa_no_policies').hide();
        $('#npaa_detail_card').hide();

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.get_profile_data',
            args: { profile },
            callback(r) {
                $('#npaa_cat_loading').hide();
                if (!r.message) return;
                state.assignments = r.message.assignments || [];
                renderCategories();
                renderPolicies(r.message.effective_policies || []);
            },
        });
    }

    // -------------------------------------------------------------------------
    // Profile list
    // -------------------------------------------------------------------------
    function renderProfileList() {
        const $list = $('#npaa_profile_list');
        if (!state.profiles.length) {
            $list.html('<div class="nexus-empty-state">No profiles found.</div>');
            return;
        }
        $list.html(state.profiles.map(p => `
            <div class="nexus-kv-row npaa-profile-item" data-profile="${esc(p.name)}" style="margin-bottom:6px; cursor:pointer;">
                <span>${esc(p.name)}</span>
                <b class="npaa-caret">›</b>
            </div>
        `).join(''));

        $list.on('click', '.npaa-profile-item', function () {
            selectProfile($(this).data('profile'));
        });
    }

    function selectProfile(profile) {
        if (state.selectedProfile === profile) return;

        if (state.pendingAssign.size > 0 || state.pendingDisable.size > 0) {
            frappe.confirm('You have unsaved changes. Discard them and switch profile?', () => doSelectProfile(profile));
            return;
        }
        doSelectProfile(profile);
    }

    function doSelectProfile(profile) {
        state.selectedProfile = profile;
        state.pendingAssign.clear();
        state.pendingDisable.clear();

        $('#npaa_profile_list .npaa-profile-item').removeClass('npaa-profile-active');
        $('#npaa_profile_list .npaa-profile-item').filter(function () {
            return $(this).data('profile') === profile;
        }).addClass('npaa-profile-active');

        $('#npaa_placeholder').hide();
        $('#npaa_profile_content').show();
        $('#npaa_profile_title').text(profile);

        const meta = state.profiles.find(p => p.name === profile);
        if (meta) {
            const parts = [];
            if (meta.agent) parts.push(`Agent: ${meta.agent}`);
            if (meta.tone) parts.push(`Tone: ${meta.tone}`);
            if (meta.memory_mode) parts.push(`Memory: ${meta.memory_mode}`);
            $('#npaa_profile_meta').text(parts.join('  ·  '));
        }

        updatePendingNote();
        loadProfileData(profile);
    }

    // -------------------------------------------------------------------------
    // Categories
    // -------------------------------------------------------------------------
    function renderCategories() {
        const $list = $('#npaa_cat_list');
        if (!state.categories.length) {
            $('#npaa_no_cats').show();
            return;
        }

        const assignedMap = {};
        state.assignments.forEach(a => { assignedMap[a.access_category] = a; });

        const rows = state.categories.map((cat, idx) => {
            const rec = assignedMap[cat.name];
            const isEnabled = rec && rec.enabled;
            const cbId = `npaa_cb_${idx}`;
            const label = cat.title || cat.category_name || cat.name;

            return `
                <tr>
                    <td style="width:34px; text-align:center; vertical-align:middle;">
                        <input type="checkbox" class="npaa-cat-cb" id="${cbId}"
                            data-category="${esc(cat.name)}"
                            data-recname="${esc(rec ? rec.name : '')}"
                            ${isEnabled ? 'checked' : ''}
                            style="width:15px; height:15px; cursor:pointer;">
                    </td>
                    <td style="vertical-align:middle;">
                        <label for="${cbId}" style="cursor:pointer; font-weight:850; color:#173b8c; font-size:13px; margin:0;">${esc(label)}</label>
                        ${cat.description ? `<div class="nexus-admin-muted">${esc(cat.description)}</div>` : ''}
                    </td>
                    <td style="width:110px; text-align:right; vertical-align:middle;">
                        <span class="nexus-status-pill ${isEnabled ? 'enabled' : 'disabled'} npaa-cat-status">
                            ${isEnabled ? 'Enabled' : 'Not Set'}
                        </span>
                    </td>
                    <td style="width:80px; text-align:right; vertical-align:middle;">
                        <button class="btn btn-xs btn-default npaa-detail-btn" data-category="${esc(cat.name)}">Details</button>
                    </td>
                </tr>`;
        });

        $list.html(`
            <table class="table table-bordered nexus-admin-table" style="margin-bottom:0;">
                <thead><tr>
                    <th style="width:34px;"></th>
                    <th>Access Category</th>
                    <th style="width:110px; text-align:right;">Status</th>
                    <th style="width:80px;"></th>
                </tr></thead>
                <tbody>${rows.join('')}</tbody>
            </table>`);

        $list.off('change', '.npaa-cat-cb').on('change', '.npaa-cat-cb', function () {
            const cat = $(this).data('category');
            const recName = $(this).data('recname');
            const checked = $(this).is(':checked');

            if (checked) {
                state.pendingAssign.add(cat);
                state.pendingDisable.delete(recName);
            } else {
                state.pendingAssign.delete(cat);
                if (recName) state.pendingDisable.add(recName);
            }

            const $pill = $(this).closest('tr').find('.npaa-cat-status');
            if (state.pendingAssign.has(cat)) {
                $pill.attr('class', 'nexus-status-pill npaa-pill-pending npaa-cat-status').text('Pending +');
            } else if (recName && state.pendingDisable.has(recName)) {
                $pill.attr('class', 'nexus-status-pill npaa-pill-removing npaa-cat-status').text('Pending −');
            } else {
                $pill.attr('class', `nexus-status-pill ${checked ? 'enabled' : 'disabled'} npaa-cat-status`).text(checked ? 'Enabled' : 'Not Set');
            }
            updatePendingNote();
        });

        $list.off('click', '.npaa-detail-btn').on('click', '.npaa-detail-btn', function (e) {
            e.stopPropagation();
            loadCategoryDetail($(this).data('category'));
        });
    }

    // -------------------------------------------------------------------------
    // Save / discard
    // -------------------------------------------------------------------------
    function saveAssignments() {
        if (!state.selectedProfile) return;

        const toAssign = Array.from(state.pendingAssign);
        const toDisable = Array.from(state.pendingDisable);

        if (!toAssign.length && !toDisable.length) {
            frappe.show_alert({ message: 'No changes to save.', indicator: 'blue' });
            return;
        }

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.save_profile_access_categories',
            args: {
                profile: state.selectedProfile,
                categories_to_assign: JSON.stringify(toAssign),
                assignments_to_disable: JSON.stringify(toDisable),
            },
            callback(r) {
                if (r.message && r.message.status === 'success') {
                    state.assignments = r.message.assignments || [];
                    state.pendingAssign.clear();
                    state.pendingDisable.clear();
                    frappe.show_alert({ message: 'Access categories saved.', indicator: 'green' });
                    updatePendingNote();
                    renderCategories();
                    renderPolicies(r.message.effective_policies || []);
                }
            },
        });
    }

    function discardChanges() {
        state.pendingAssign.clear();
        state.pendingDisable.clear();
        updatePendingNote();
        renderCategories();
        frappe.show_alert({ message: 'Changes discarded.', indicator: 'orange' });
    }

    function updatePendingNote() {
        const total = state.pendingAssign.size + state.pendingDisable.size;
        const $note = $('#npaa_pending_note');
        total > 0 ? $note.show().text(`${total} unsaved change${total !== 1 ? 's' : ''}`) : $note.hide();
    }

    // -------------------------------------------------------------------------
    // Effective policies
    // -------------------------------------------------------------------------
    function refreshPolicies() {
        $('#npaa_policies_loading').show();
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.get_effective_policies',
            args: { profile: state.selectedProfile },
            callback(r) {
                $('#npaa_policies_loading').hide();
                renderPolicies((r.message && r.message.policies) || []);
            },
        });
    }

    function renderPolicies(policies) {
        const $area = $('#npaa_policies_area');
        if (!policies.length) {
            $('#npaa_no_policies').show();
            $area.empty();
            return;
        }
        $('#npaa_no_policies').hide();

        const chips = policies.map(p => {
            const cls = p.is_primitive ? 'npaa-chip-primitive' : 'npaa-chip';
            return `<span class="${cls}" title="${esc(p.description || '')}">${esc(p.policy_name)}${p.is_primitive ? ' ★' : ''}</span>`;
        }).join('');

        $area.html(`
            <div style="display:flex; flex-wrap:wrap; gap:6px; padding:8px 0 4px;">${chips}</div>
            <div class="nexus-admin-muted" style="padding:4px 0 8px;">
                ${policies.length} polic${policies.length !== 1 ? 'ies' : 'y'} accessible through assigned categories.
            </div>`);
    }

    // -------------------------------------------------------------------------
    // Category detail
    // -------------------------------------------------------------------------
    function loadCategoryDetail(category) {
        $('#npaa_detail_card').show();
        $('#npaa_detail_name').text(category);
        $('#npaa_detail_area').html('<div class="nexus-empty-state">Loading…</div>');

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.get_category_policies',
            args: { category },
            callback(r) {
                const policies = (r.message && r.message.policies) || [];
                if (!policies.length) {
                    $('#npaa_detail_area').html('<div class="nexus-empty-state">No policies in this category.</div>');
                    return;
                }
                const rows = policies.map(p => `
                    <tr>
                        <td><b style="color:#173b8c;">${esc(p.policy_name)}</b>
                            ${p.description ? `<div class="nexus-admin-muted">${esc(p.description)}</div>` : ''}</td>
                        <td>${esc(p.access_level || '—')}</td>
                        <td>${esc(p.sensitivity || '—')}</td>
                        <td>${p.is_primitive ? '<span class="nexus-status-pill npaa-chip-primitive">Primitive ★</span>' : `<span class="nexus-status-pill ${p.disabled ? 'disabled' : 'enabled'}">${p.disabled ? 'Disabled' : 'Active'}</span>`}</td>
                    </tr>`).join('');

                $('#npaa_detail_area').html(`
                    <table class="table table-bordered nexus-admin-table" style="margin-bottom:0;">
                        <thead><tr><th>Policy</th><th>Level</th><th>Sensitivity</th><th style="width:110px;">Status</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>`);
            },
        });
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    function esc(s) { return frappe.utils.escape_html(String(s || '')); }
};


function inject_npaa_css() {
    if ($('#npaa_css').length) return;
    $('head').append(`<style id="npaa_css">
        .npaa-wrap { padding: 12px; }

        .nexus-admin-hero {
            display:flex; justify-content:space-between; gap:20px; align-items:flex-start;
            border-radius:26px; padding:30px 34px; margin-bottom:18px;
            background: radial-gradient(circle at 8% 20%,rgba(77,163,255,.28),transparent 30%),
                        radial-gradient(circle at 92% 10%,rgba(224,166,47,.22),transparent 28%),
                        linear-gradient(135deg,#fff 0%,#eef6ff 48%,#f8fbff 100%);
            border:1px solid rgba(77,163,255,.38);
            box-shadow:0 18px 45px rgba(33,77,187,.12);
        }
        .nexus-admin-badge {
            display:inline-flex; align-items:center; padding:8px 14px; border-radius:999px;
            background:rgba(33,77,187,.09); border:1px solid rgba(33,77,187,.16);
            color:#214dbb; font-weight:800; font-size:12px; letter-spacing:.04em;
            text-transform:uppercase; margin-bottom:12px;
        }
        .nexus-admin-hero h2 { margin:0; font-size:30px; font-weight:900; color:#102b67; letter-spacing:-0.03em; }
        .nexus-admin-hero p  { margin:12px 0 0; max-width:880px; font-size:15px; line-height:1.7; color:#27416f; font-weight:500; }
        .nexus-admin-hero-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .nexus-admin-hero-actions .btn { border-radius:999px; font-weight:850; }

        .nexus-admin-flow-pill {
            display:inline-block; margin-top:12px; padding:7px 14px; border-radius:999px;
            background:rgba(33,77,187,.08); border:1px solid rgba(33,77,187,.18);
            color:#214dbb; font-size:11px; font-weight:800; font-family:monospace;
        }

        .nexus-admin-card {
            border:1px solid rgba(77,163,255,.28); border-radius:22px; background:#fff;
            padding:20px; box-shadow:0 12px 30px rgba(33,77,187,.07);
        }
        .nexus-admin-card-title {
            display:inline-flex; align-items:center; gap:12px; color:#173b8c;
            font-size:16px; font-weight:900; padding:10px 16px; margin-bottom:16px;
            border-radius:999px; background:#eef6ff; border:1px solid rgba(33,77,187,.14);
        }
        .nexus-admin-card-title:after { content:""; width:36px; height:4px; border-radius:999px; background:linear-gradient(90deg,#e0a62f,#f4ca64); }
        .nexus-admin-section-head { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:16px; }
        .nexus-admin-section-head .nexus-admin-card-title { margin-bottom:8px; }
        .nexus-admin-section-head p { margin:0; color:#53688f; font-size:13px; line-height:1.6; font-weight:650; }
        .nexus-admin-action-row { display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; align-items:center; }
        .nexus-admin-action-row .btn { border-radius:999px; font-weight:850; }
        .nexus-kv-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 12px; border-radius:14px; background:#f8fbff; border:1px solid rgba(77,163,255,.18); }
        .nexus-kv-row span { color:#53688f; font-size:12px; font-weight:800; }
        .nexus-kv-row b { color:#173b8c; font-size:12px; font-weight:900; text-align:right; }
        .nexus-empty-state { padding:16px; border-radius:16px; background:#fff7e6; border:1px solid #f2d49b; color:#8a5d00; font-weight:800; line-height:1.6; }
        .nexus-status-pill { display:inline-flex; padding:5px 9px; border-radius:999px; font-size:10px; font-weight:900; white-space:nowrap; }
        .nexus-status-pill.enabled { background:#ecfdf3; color:#16794c; border:1px solid #bdebd2; }
        .nexus-status-pill.disabled { background:#fff0f0; color:#b42318; border:1px solid #ffd1d1; }
        .nexus-admin-table { margin-bottom:0; background:#fff; }
        .nexus-admin-table th { color:#173b8c; font-size:12px; font-weight:900; background:#eef6ff; white-space:nowrap; }
        .nexus-admin-table td { color:#27416f; font-size:12px; font-weight:650; vertical-align:middle; }
        .nexus-admin-muted { margin-top:4px; color:#6b7c9b; font-size:11px; font-weight:650; line-height:1.4; }

        .npaa-layout { display:grid; grid-template-columns:260px 1fr; gap:18px; align-items:start; }
        .npaa-profile-panel { position:sticky; top:64px; }
        .npaa-profile-inner { max-height:540px; overflow-y:auto; padding-right:2px; }
        .npaa-profile-item:hover { background:#eef6ff !important; border-color:rgba(33,77,187,.35) !important; }
        .npaa-profile-active { background:#eef6ff !important; border-color:rgba(33,77,187,.55) !important; }
        .npaa-profile-active span { color:#173b8c !important; font-weight:950 !important; }
        .npaa-caret { color:#214dbb; font-size:16px; font-weight:900; }
        .npaa-profile-title { font-size:22px; font-weight:950; color:#102b67; margin-top:4px; }
        .npaa-placeholder { text-align:center; padding:48px 20px; }
        .npaa-placeholder-icon { font-size:28px; margin-bottom:12px; color:#b0c4de; }
        .npaa-placeholder > div:last-child { color:#53688f; font-size:14px; font-weight:700; }
        .npaa-pending-note { display:inline-flex; align-items:center; padding:5px 12px; border-radius:999px; background:#fff7e6; border:1px solid #f2d49b; color:#8a5d00; font-size:11px; font-weight:900; white-space:nowrap; }
        .npaa-chip, .npaa-chip-primitive { display:inline-flex; align-items:center; padding:5px 12px; border-radius:999px; font-size:12px; font-weight:900; white-space:nowrap; }
        .npaa-chip { background:#eef6ff; color:#173b8c; border:1px solid rgba(33,77,187,.22); }
        .npaa-chip-primitive { background:#fff7e6; color:#8a5d00; border:1px solid #f2d49b; }
        .npaa-pill-pending { background:#ecfdf3; color:#16794c; border:1px solid #bdebd2; }
        .npaa-pill-removing { background:#fff0f0; color:#b42318; border:1px solid #ffd1d1; }
        .npaa-link { color:#214dbb; cursor:pointer; font-weight:850; text-decoration:none; }
        .npaa-link:hover { text-decoration:underline; }

        @media (max-width:820px) { .npaa-layout { grid-template-columns:1fr; } .npaa-profile-panel { position:static; } }
        @media (max-width:760px) { .nexus-admin-hero { flex-direction:column; } .nexus-admin-section-head { flex-direction:column; } }
    </style>`);
}

frappe.pages['nexus-user-profile-manager'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus User Profile Manager',
        single_column: true,
    });

    const state = {
        users: [],
        profiles: [],
        assignmentMap: {},
        selectedUser: null,
        filterText: '',
    };

    inject_nupm_css();
    $(page.body).html(buildHTML());
    bindEvents();
    loadInitialData();

    // -------------------------------------------------------------------------
    // HTML
    // -------------------------------------------------------------------------
    function buildHTML() {
        return `
<div class="nupm-wrap">

    <div class="nexus-admin-hero">
        <div>
            <div class="nexus-admin-badge">DIGITZ AI Nexus</div>
            <h2>User Profile Manager</h2>
            <p>
                Assign a <b>Knowledge Profile</b> to each internal desk user.
                The profile governs which Access Categories (and their policies) the user can reach.
                One active profile per user at any time.
            </p>
            <div class="nexus-admin-flow-pill">
                User &nbsp;→&nbsp; Knowledge Profile &nbsp;→&nbsp; Access Category &nbsp;→&nbsp; Knowledge
            </div>
        </div>
        <div class="nexus-admin-hero-actions">
            <button class="btn btn-default" data-route-list="Nexus User Profile Assignment">All Assignments</button>
            <button class="btn btn-default" data-route-list="Knowledge Profile">Knowledge Profiles</button>
        </div>
    </div>

    <div class="nupm-layout">

        <!-- Left: User list -->
        <div class="nexus-admin-card nupm-user-panel">
            <div class="nexus-admin-card-title">Desk Users</div>
            <input id="nupm_search" type="text" class="form-control" placeholder="Search users…" style="margin-bottom:10px; border-radius:999px; font-size:12px;">
            <div class="nupm-user-inner">
                <div id="nupm_users_loading" class="nexus-empty-state">Loading…</div>
                <div id="nupm_user_list"></div>
            </div>
        </div>

        <!-- Right -->
        <div>
            <div id="nupm_placeholder" class="nexus-admin-card nupm-placeholder">
                <div class="nupm-placeholder-icon">←</div>
                <div>Select a user to manage their profile assignment</div>
            </div>

            <div id="nupm_user_content" style="display:none;">

                <!-- User header -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div class="nexus-admin-section-head" style="margin-bottom:0;">
                        <div>
                            <div class="nexus-admin-card-title">Selected User</div>
                            <div id="nupm_user_title" class="nupm-user-title"></div>
                            <div id="nupm_user_email" class="nexus-admin-muted" style="margin-top:4px;"></div>
                        </div>
                        <div id="nupm_active_badge"></div>
                    </div>
                </div>

                <!-- Assign profile -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div class="nexus-admin-section-head">
                        <div>
                            <div class="nexus-admin-card-title">Knowledge Profile Assignment</div>
                            <p>Select a Knowledge Profile and click Assign. Any existing active assignment is deactivated first.</p>
                        </div>
                    </div>
                    <div class="nupm-assign-row">
                        <select id="nupm_profile_select" class="form-control">
                            <option value="">— Select profile —</option>
                        </select>
                        <input id="nupm_notes" type="text" class="form-control" placeholder="Optional notes…" style="flex:1;">
                        <button id="nupm_assign_btn" class="btn btn-primary">Assign</button>
                    </div>
                </div>

                <!-- Effective policies -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div class="nexus-admin-section-head">
                        <div>
                            <div class="nexus-admin-card-title">Effective Access Policies</div>
                            <p>Knowledge policies granted to this user through their active Knowledge Profile.</p>
                        </div>
                    </div>
                    <div id="nupm_policies_area"></div>
                    <div id="nupm_no_policies" class="nexus-empty-state" style="display:none;">
                        No policies accessible. Assign a profile with a configured Access Category.
                    </div>
                </div>

                <!-- Assignment history -->
                <div class="nexus-admin-card">
                    <div class="nexus-admin-card-title">Assignment History</div>
                    <div id="nupm_history_area"></div>
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
        $(page.body).on('input', '#nupm_search', function () {
            state.filterText = $(this).val().toLowerCase();
            renderUserList();
        });
        $(page.body).on('click', '#nupm_assign_btn', assignProfile);
    }

    // -------------------------------------------------------------------------
    // Data loading
    // -------------------------------------------------------------------------
    function loadInitialData() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_user_profile_manager.get_page_data',
            callback(r) {
                $('#nupm_users_loading').hide();
                if (!r.message) return;
                state.users = r.message.users || [];
                state.profiles = r.message.profiles || [];
                state.assignmentMap = r.message.assignment_map || {};
                renderUserList();
                populateProfileSelect();
            },
        });
    }

    function loadUserData(user) {
        $('#nupm_policies_area').empty();
        $('#nupm_no_policies').hide();
        $('#nupm_history_area').html('<div class="nexus-empty-state">Loading…</div>');

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_user_profile_manager.get_user_data',
            args: { user },
            callback(r) {
                if (!r.message) return;
                renderPolicies(r.message.effective_policies || []);
                renderHistory(r.message.assignments || []);

                const activeProfile = r.message.active_profile;
                if (activeProfile) {
                    $('#nupm_active_badge').html(`<span class="nexus-status-pill enabled">Active: ${esc(activeProfile)}</span>`);
                    $('#nupm_profile_select').val(activeProfile);
                } else {
                    $('#nupm_active_badge').html(`<span class="nexus-status-pill disabled">No Active Profile</span>`);
                }
            },
        });
    }

    // -------------------------------------------------------------------------
    // User list
    // -------------------------------------------------------------------------
    function renderUserList() {
        const $list = $('#nupm_user_list');
        const filtered = state.filterText
            ? state.users.filter(u =>
                (u.full_name || '').toLowerCase().includes(state.filterText) ||
                (u.name || '').toLowerCase().includes(state.filterText)
            )
            : state.users;

        if (!filtered.length) {
            $list.html('<div class="nexus-admin-muted" style="padding:8px;">No users found.</div>');
            return;
        }

        $list.html(filtered.map(u => {
            const assigned = state.assignmentMap[u.name];
            const dot = assigned
                ? '<span class="nupm-dot nupm-dot-active" title="Has active profile"></span>'
                : '<span class="nupm-dot nupm-dot-none" title="No profile assigned"></span>';

            return `
                <div class="nexus-kv-row nupm-user-item" data-user="${esc(u.name)}" style="margin-bottom:5px; cursor:pointer;">
                    <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                        ${dot}
                        <div style="overflow:hidden;">
                            <div style="font-size:12px; font-weight:850; color:#173b8c; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                ${esc(u.full_name || u.name)}
                            </div>
                            <div class="nexus-admin-muted">${esc(u.name)}</div>
                        </div>
                    </div>
                    <b style="color:#214dbb; font-size:16px; flex-shrink:0;">›</b>
                </div>`;
        }).join(''));

        $list.off('click', '.nupm-user-item').on('click', '.nupm-user-item', function () {
            selectUser($(this).data('user'));
        });
    }

    function selectUser(user) {
        state.selectedUser = user;
        $('#nupm_user_list .nupm-user-item').removeClass('nupm-user-active');
        $('#nupm_user_list .nupm-user-item').filter(function () {
            return $(this).data('user') === user;
        }).addClass('nupm-user-active');

        const u = state.users.find(x => x.name === user);
        $('#nupm_user_title').text(u ? (u.full_name || u.name) : user);
        $('#nupm_user_email').text(u ? u.name : '');
        $('#nupm_placeholder').hide();
        $('#nupm_user_content').show();
        loadUserData(user);
    }

    // -------------------------------------------------------------------------
    // Assign
    // -------------------------------------------------------------------------
    function populateProfileSelect() {
        const $sel = $('#nupm_profile_select');
        $sel.find('option:not(:first)').remove();
        state.profiles.forEach(p => {
            const label = p.title ? `${esc(p.name)} — ${esc(p.title)}` : esc(p.name);
            $sel.append(`<option value="${esc(p.name)}">${label}</option>`);
        });
    }

    function assignProfile() {
        const profile = $('#nupm_profile_select').val();
        if (!profile) {
            frappe.show_alert({ message: 'Please select a Knowledge Profile.', indicator: 'orange' });
            return;
        }

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_user_profile_manager.assign_profile',
            args: {
                user: state.selectedUser,
                knowledge_profile: profile,
                notes: $('#nupm_notes').val().trim(),
            },
            callback(r) {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert({ message: 'Knowledge Profile assigned.', indicator: 'green' });
                    state.assignmentMap[state.selectedUser] = { knowledge_profile: profile, active: 1 };
                    $('#nupm_notes').val('');
                    renderUserList();
                    loadUserData(state.selectedUser);
                }
            },
        });
    }

    // -------------------------------------------------------------------------
    // Policies
    // -------------------------------------------------------------------------
    function renderPolicies(policies) {
        if (!policies.length) {
            $('#nupm_no_policies').show();
            return;
        }
        const chips = policies.map(p => {
            const cls = p.is_primitive ? 'nupm-chip-primitive' : 'nupm-chip';
            return `<span class="${cls}">${esc(p.policy_name)}${p.is_primitive ? ' ★' : ''}</span>`;
        }).join('');
        $('#nupm_policies_area').html(`
            <div style="display:flex; flex-wrap:wrap; gap:6px; padding:8px 0 4px;">${chips}</div>
            <div class="nexus-admin-muted" style="padding:4px 0 8px;">${policies.length} polic${policies.length !== 1 ? 'ies' : 'y'} accessible.</div>`);
    }

    // -------------------------------------------------------------------------
    // History
    // -------------------------------------------------------------------------
    function renderHistory(assignments) {
        if (!assignments.length) {
            $('#nupm_history_area').html('<div class="nexus-admin-muted" style="padding:8px;">No assignment history.</div>');
            return;
        }

        const rows = assignments.map(a => `
            <tr>
                <td><b style="color:#173b8c;">${esc(a.knowledge_profile)}</b></td>
                <td style="text-align:center;">
                    <span class="nexus-status-pill ${a.active ? 'enabled' : 'disabled'}">${a.active ? 'Active' : 'Inactive'}</span>
                </td>
                <td>${esc(a.assigned_by || '—')}</td>
                <td>${a.assigned_on ? frappe.datetime.str_to_user(a.assigned_on) : '—'}</td>
                <td>${esc(a.notes || '—')}</td>
                <td style="text-align:right;">
                    ${a.active
                        ? `<button class="btn btn-xs btn-danger nupm-deactivate-btn" data-name="${esc(a.name)}">Deactivate</button>`
                        : ''}
                </td>
            </tr>`).join('');

        $('#nupm_history_area').html(`
            <table class="table table-bordered nexus-admin-table" style="margin-bottom:0;">
                <thead><tr>
                    <th>Knowledge Profile</th>
                    <th style="width:80px; text-align:center;">Status</th>
                    <th>Assigned By</th>
                    <th>Assigned On</th>
                    <th>Notes</th>
                    <th style="width:100px;"></th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`);

        $('#nupm_history_area').off('click', '.nupm-deactivate-btn').on('click', '.nupm-deactivate-btn', function () {
            const name = $(this).data('name');
            frappe.confirm('Deactivate this profile assignment?', () => {
                frappe.call({
                    method: 'digitz_ai_nexus_live.api.nexus_user_profile_manager.deactivate_assignment',
                    args: { name },
                    callback(r) {
                        if (r.message && r.message.status === 'success') {
                            frappe.show_alert({ message: 'Assignment deactivated.', indicator: 'orange' });
                            if (state.assignmentMap[state.selectedUser]) {
                                delete state.assignmentMap[state.selectedUser];
                            }
                            renderUserList();
                            loadUserData(state.selectedUser);
                        }
                    },
                });
            });
        });
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    function esc(s) { return frappe.utils.escape_html(String(s || '')); }
};


function inject_nupm_css() {
    if ($('#nupm_css').length) return;
    $('head').append(`<style id="nupm_css">
        .nupm-wrap { padding:12px; }
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
        .nexus-admin-section-head p { margin:0; color:#53688f; font-size:13px; line-height:1.6; font-weight:650; }
        .nexus-kv-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 12px; border-radius:14px; background:#f8fbff; border:1px solid rgba(77,163,255,.18); }
        .nexus-empty-state { padding:16px; border-radius:16px; background:#fff7e6; border:1px solid #f2d49b; color:#8a5d00; font-weight:800; line-height:1.6; }
        .nexus-status-pill { display:inline-flex; padding:5px 9px; border-radius:999px; font-size:10px; font-weight:900; white-space:nowrap; }
        .nexus-status-pill.enabled { background:#ecfdf3; color:#16794c; border:1px solid #bdebd2; }
        .nexus-status-pill.disabled { background:#fff0f0; color:#b42318; border:1px solid #ffd1d1; }
        .nexus-admin-table { margin-bottom:0; background:#fff; }
        .nexus-admin-table th { color:#173b8c; font-size:12px; font-weight:900; background:#eef6ff; white-space:nowrap; }
        .nexus-admin-table td { color:#27416f; font-size:12px; font-weight:650; vertical-align:middle; }
        .nexus-admin-muted { margin-top:4px; color:#6b7c9b; font-size:11px; font-weight:650; line-height:1.4; }

        .nupm-layout { display:grid; grid-template-columns:280px 1fr; gap:18px; align-items:start; }
        .nupm-user-panel { position:sticky; top:64px; }
        .nupm-user-inner { max-height:480px; overflow-y:auto; padding-right:2px; }
        .nupm-user-item:hover { background:#eef6ff !important; border-color:rgba(33,77,187,.35) !important; }
        .nupm-user-active { background:#eef6ff !important; border-color:rgba(33,77,187,.55) !important; }
        .nupm-user-title { font-size:20px; font-weight:950; color:#102b67; margin-top:4px; }
        .nupm-placeholder { text-align:center; padding:48px 20px; }
        .nupm-placeholder-icon { font-size:28px; margin-bottom:12px; color:#b0c4de; }
        .nupm-placeholder > div:last-child { color:#53688f; font-size:14px; font-weight:700; }

        .nupm-dot { display:inline-block; width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .nupm-dot-active { background:#16a34a; }
        .nupm-dot-none { background:#d1d5db; }

        .nupm-assign-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .nupm-assign-row .form-control { flex:1; min-width:160px; }
        .nupm-assign-row .btn { border-radius:999px; font-weight:850; flex-shrink:0; }

        .nupm-chip, .nupm-chip-primitive { display:inline-flex; align-items:center; padding:5px 12px; border-radius:999px; font-size:12px; font-weight:900; white-space:nowrap; }
        .nupm-chip { background:#eef6ff; color:#173b8c; border:1px solid rgba(33,77,187,.22); }
        .nupm-chip-primitive { background:#fff7e6; color:#8a5d00; border:1px solid #f2d49b; }

        @media (max-width:900px) { .nupm-layout { grid-template-columns:1fr; } .nupm-user-panel { position:static; } }
        @media (max-width:760px) { .nexus-admin-hero { flex-direction:column; } .nupm-assign-row { flex-direction:column; align-items:stretch; } }
    </style>`);
}

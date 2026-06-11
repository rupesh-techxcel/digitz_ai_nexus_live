frappe.pages['nexus-user-profile-manager'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus User Profile Manager',
        single_column: true,
    });

    const state = {
        users: [],
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
                Configure which internal desk users can handle <b>human escalations</b>.
                Knowledge access for desk users is governed by their <b>Nexus Identity Registry</b>
                entry — assign Identity Profiles there, not here.
            </p>
            <div class="nexus-admin-flow-pill">
                User &nbsp;→&nbsp; Nexus Identity Registry &nbsp;→&nbsp; Identity Profile &nbsp;→&nbsp; Knowledge
            </div>
        </div>
        <div class="nexus-admin-hero-actions">
            <button class="btn btn-default" data-route-list="Nexus User Profile Assignment">All Assignments</button>
            <button class="btn btn-default" data-route-page="nexus-identity-registry-manager">Identity Registry</button>
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
                <div>Select a user to view their escalation assignment</div>
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

                <!-- Escalation info -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div class="nexus-admin-section-head">
                        <div>
                            <div class="nexus-admin-card-title">Escalation Assignment</div>
                            <p>Escalation settings are managed via the standard Frappe form. Click <b>New Assignment</b> to create one.</p>
                        </div>
                        <button id="nupm_new_assignment_btn" class="btn btn-primary btn-sm">New Assignment</button>
                    </div>
                    <div id="nupm_escalation_area"></div>
                </div>

                <!-- Assignment history -->
                <div class="nexus-admin-card" style="margin-bottom:18px;">
                    <div class="nexus-admin-card-title">Assignment History</div>
                    <div id="nupm_history_area"></div>
                </div>

                <!-- Identity registry link -->
                <div class="nexus-admin-card">
                    <div class="nexus-admin-section-head">
                        <div>
                            <div class="nexus-admin-card-title">Knowledge Access</div>
                            <p>
                                Knowledge access is not configured here. Open the <b>Identity Registry Manager</b>
                                to find this user's registry entry and assign Identity Profiles.
                            </p>
                        </div>
                        <button id="nupm_registry_btn" class="btn btn-default btn-sm">Open Identity Registry</button>
                    </div>
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
        $(page.body).on('input', '#nupm_search', function () {
            state.filterText = $(this).val().toLowerCase();
            renderUserList();
        });
        $(page.body).on('click', '#nupm_new_assignment_btn', () => {
            if (state.selectedUser) {
                frappe.new_doc('Nexus User Profile Assignment', { user: state.selectedUser });
            }
        });
        $(page.body).on('click', '#nupm_registry_btn', () => {
            frappe.set_route('nexus-identity-registry-manager');
        });
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
                state.assignmentMap = r.message.assignment_map || {};
                renderUserList();
            },
        });
    }

    function loadUserData(user) {
        $('#nupm_escalation_area').html('<div class="nexus-empty-state">Loading…</div>');
        $('#nupm_history_area').html('<div class="nexus-empty-state">Loading…</div>');

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_user_profile_manager.get_user_data',
            args: { user },
            callback(r) {
                if (!r.message) return;
                renderEscalation(r.message.assignments || []);
                renderHistory(r.message.assignments || []);
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
                ? '<span class="nupm-dot nupm-dot-active" title="Has active assignment"></span>'
                : '<span class="nupm-dot nupm-dot-none" title="No assignment"></span>';

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

        const a = state.assignmentMap[user];
        if (a) {
            $('#nupm_active_badge').html(`<span class="nexus-status-pill enabled">Active Assignment</span>`);
        } else {
            $('#nupm_active_badge').html(`<span class="nexus-status-pill disabled">No Assignment</span>`);
        }

        loadUserData(user);
    }

    // -------------------------------------------------------------------------
    // Escalation summary
    // -------------------------------------------------------------------------
    function renderEscalation(assignments) {
        const active = assignments.find(a => a.active);
        if (!active) {
            $('#nupm_escalation_area').html(
                '<div class="nexus-admin-muted" style="padding:8px;">No active escalation assignment. Click <b>New Assignment</b> to configure.</div>'
            );
            return;
        }

        $('#nupm_escalation_area').html(`
            <div style="display:flex; flex-wrap:wrap; gap:10px; padding:8px 0;">
                <div class="nexus-kv-row" style="flex:1; min-width:200px;">
                    <span style="font-size:12px; font-weight:900; color:#173b8c;">Can Handle Escalations</span>
                    <span class="nexus-status-pill ${active.can_handle_escalations ? 'enabled' : 'disabled'}">${active.can_handle_escalations ? 'Yes' : 'No'}</span>
                </div>
                <div class="nexus-kv-row" style="flex:1; min-width:200px;">
                    <span style="font-size:12px; font-weight:900; color:#173b8c;">Max Sessions</span>
                    <b style="color:#214dbb;">${active.max_escalation_sessions || '—'}</b>
                </div>
            </div>
            <div class="nexus-admin-muted" style="margin-top:4px; padding:0 0 4px;">
                Assigned ${active.assigned_on ? frappe.datetime.str_to_user(active.assigned_on) : '—'}
                &nbsp;·&nbsp;
                <a href="#Form/Nexus User Profile Assignment/${esc(active.name)}" onclick="frappe.set_route('Form','Nexus User Profile Assignment','${esc(active.name)}'); return false;">Open Doc</a>
            </div>
        `);
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
                <td style="text-align:center;">
                    <span class="nexus-status-pill ${a.active ? 'enabled' : 'disabled'}">${a.active ? 'Active' : 'Inactive'}</span>
                </td>
                <td style="text-align:center;">
                    <span class="nexus-status-pill ${a.can_handle_escalations ? 'enabled' : 'disabled'}">${a.can_handle_escalations ? 'Yes' : 'No'}</span>
                </td>
                <td style="text-align:center; color:#214dbb; font-weight:900;">${a.max_escalation_sessions || '—'}</td>
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
                    <th style="width:80px; text-align:center;">Status</th>
                    <th style="width:100px; text-align:center;">Escalations</th>
                    <th style="width:80px; text-align:center;">Max Sessions</th>
                    <th>Assigned By</th>
                    <th>Assigned On</th>
                    <th>Notes</th>
                    <th style="width:100px;"></th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`);

        $('#nupm_history_area').off('click', '.nupm-deactivate-btn').on('click', '.nupm-deactivate-btn', function () {
            const name = $(this).data('name');
            frappe.confirm('Deactivate this assignment?', () => {
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

        @media (max-width:900px) { .nupm-layout { grid-template-columns:1fr; } .nupm-user-panel { position:static; } }
        @media (max-width:760px) { .nexus-admin-hero { flex-direction:column; } }
    </style>`);
}

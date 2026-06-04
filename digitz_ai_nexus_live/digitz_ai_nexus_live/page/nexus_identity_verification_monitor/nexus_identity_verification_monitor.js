frappe.pages['nexus-identity-verification-monitor'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus Identity Verification Monitor',
        single_column: true,
    });

    const state = { challenges: [] };

    inject_css();
    $(page.body).html(buildHTML());
    bindEvents();
    loadChallenges();

    function buildHTML() {
        return `
<div class="nivm-wrap">
    <div class="nivm-head">
        <div>
            <div class="nivm-title">Identity Verification Monitor</div>
            <div class="nivm-muted">Inspect recent email OTP challenges and their resolved identities.</div>
        </div>
        <div class="nivm-actions">
            <button class="btn btn-default" data-list="Nexus Identity Verification Challenge">Open List</button>
            <button class="btn btn-default" data-page="nexus-chat-workflow-tester">Workflow Tester</button>
        </div>
    </div>

    <div class="nivm-panel">
        <div class="nivm-filters">
            <select id="nivm_status" class="form-control">
                <option>All</option>
                <option>Pending</option>
                <option>Verified</option>
                <option>Expired</option>
                <option>Failed</option>
            </select>
            <input id="nivm_email" class="form-control" placeholder="Filter email">
            <button id="nivm_refresh" class="btn btn-primary">Refresh</button>
        </div>
        <div id="nivm_table"></div>
    </div>
</div>`;
    }

    function bindEvents() {
        $(page.body).on('click', '[data-list]', function () {
            frappe.set_route('List', $(this).data('list'));
        });
        $(page.body).on('click', '[data-page]', function () {
            frappe.set_route($(this).data('page'));
        });
        $(page.body).on('click', '#nivm_refresh', loadChallenges);
    }

    function loadChallenges() {
        $('#nivm_table').html('<div class="nivm-empty">Loading...</div>');
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_identity_verification_monitor.get_challenges',
            args: {
                status: $('#nivm_status').val() || 'All',
                email: $('#nivm_email').val(),
            },
            callback(r) {
                state.challenges = (r.message && r.message.challenges) || [];
                renderTable();
            },
        });
    }

    function renderTable() {
        if (!state.challenges.length) {
            $('#nivm_table').html('<div class="nivm-empty">No challenges found.</div>');
            return;
        }

        $('#nivm_table').html(`
            <table class="table table-bordered nivm-table">
                <thead>
                    <tr>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Mode</th>
                        <th>Category</th>
                        <th>Identity</th>
                        <th>Attempts</th>
                        <th>Expires</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${state.challenges.map(row => `
                        <tr>
                            <td>${esc(row.email)}</td>
                            <td>${statusPill(row)}</td>
                            <td>${esc(row.verification_mode)}</td>
                            <td>${esc(row.chat_category || '')}</td>
                            <td>${esc(row.resolved_identity_type || '')}</td>
                            <td>${esc(row.attempts || 0)} / ${esc(row.max_attempts || 0)}</td>
                            <td>${esc(row.expires_on || '')}</td>
                            <td style="text-align:right;"><button class="btn btn-xs btn-default" data-open="${esc(row.name)}">Open</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `);

        $('#nivm_table [data-open]').on('click', function () {
            frappe.set_route('Form', 'Nexus Identity Verification Challenge', $(this).data('open'));
        });
    }

    function statusPill(row) {
        const status = row.is_expired ? 'Expired' : row.status;
        const cls = {
            Pending: 'pending',
            Verified: 'verified',
            Expired: 'expired',
            Failed: 'failed',
        }[status] || 'pending';
        return `<span class="nivm-pill ${cls}">${esc(status)}</span>`;
    }

    function esc(value) {
        return frappe.utils.escape_html(value == null ? '' : String(value));
    }

    function inject_css() {
        if ($('#nivm_css').length) return;
        $('<style id="nivm_css">').text(`
            .nivm-wrap { padding:18px; }
            .nivm-head { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; border:1px solid #d9e2f2; border-radius:8px; background:#fff; padding:16px; margin-bottom:16px; }
            .nivm-title { color:#102b67; font-size:22px; font-weight:900; }
            .nivm-muted { color:#667085; font-size:12px; margin-top:4px; }
            .nivm-actions, .nivm-filters { display:flex; gap:8px; flex-wrap:wrap; }
            .nivm-panel { border:1px solid #d9e2f2; border-radius:8px; background:#fff; padding:14px; }
            .nivm-filters { margin-bottom:12px; }
            .nivm-filters select { max-width:160px; }
            .nivm-filters input { max-width:280px; }
            .nivm-empty { color:#667085; text-align:center; padding:20px; }
            .nivm-table { margin-bottom:0; }
            .nivm-pill { border-radius:999px; padding:3px 8px; font-size:11px; font-weight:800; }
            .nivm-pill.pending { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; }
            .nivm-pill.verified { background:#ecfdf3; color:#027a48; border:1px solid #abefc6; }
            .nivm-pill.expired { background:#fffaeb; color:#b54708; border:1px solid #fedf89; }
            .nivm-pill.failed { background:#fff1f3; color:#c01048; border:1px solid #fecdd6; }
            @media (max-width: 900px) { .nivm-head { flex-direction:column; } }
        `).appendTo('head');
    }
};

frappe.pages['nexus-chat-workflow-tester'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus Chat Workflow Tester',
        single_column: true,
    });

    const state = {
        tenant: null,
        tenants: [],
        channels: [],
        categories: [],
        result: null,
    };

    inject_css();
    $(page.body).html(buildHTML());
    bindEvents();
    loadInitialData();

    function buildHTML() {
        return `
<div class="ncwt-wrap">
    <div class="ncwt-hero">
        <div>
            <div class="ncwt-badge">Nexus AI</div>
            <h2>Chat Workflow Tester</h2>
            <p>Preview how channel, category, email verification, identity registry, profile routing, and access policies resolve before a chat starts.</p>
        </div>
        <div class="ncwt-hero-right">
            <div class="ncwt-tenant-wrap">
                <span class="ncwt-tenant-label">Tenant</span>
                <select id="ncwt_tenant" class="ncwt-tenant-select"></select>
            </div>
            <div class="ncwt-actions">
                <button class="btn btn-default" data-page="nexus-chat-category-manager">Categories</button>
                <button class="btn btn-default" data-page="nexus-identity-registry-manager">Identity Registry</button>
                <button class="btn btn-default" data-page="nexus-category-profile-routes">Routes</button>
            </div>
        </div>
    </div>

    <div class="ncwt-grid">
        <div class="ncwt-panel">
            <div class="ncwt-panel-title">Scenario</div>
            <div class="ncwt-form">
                <label>Channel</label>
                <select id="ncwt_channel" class="form-control"></select>

                <label>Chat Category</label>
                <select id="ncwt_category" class="form-control"></select>

                <label>Visitor Email</label>
                <input id="ncwt_email" class="form-control" placeholder="customer@example.com">

                <label class="ncwt-check">
                    <input id="ncwt_auth" type="checkbox">
                    Assume authenticated session
                </label>

                <label class="ncwt-check">
                    <input id="ncwt_email_verified" type="checkbox">
                    Assume email OTP verified
                </label>

                <button id="ncwt_run" class="btn btn-primary">Run Test</button>
            </div>
        </div>

        <div class="ncwt-panel">
            <div class="ncwt-panel-title">Result</div>
            <div id="ncwt_result" class="ncwt-empty">Select a scenario and run the test.</div>
        </div>
    </div>
</div>`;
    }

    function bindEvents() {
        $(page.body).on('click', '[data-page]', function () {
            frappe.set_route($(this).data('page'));
        });
        $(page.body).on('change', '#ncwt_tenant', function () {
            state.tenant = $(this).val();
            loadChannels();
        });
        $(page.body).on('change', '#ncwt_channel', function () {
            loadCategories($(this).val());
        });
        $(page.body).on('click', '#ncwt_run', runTest);
    }

    function loadInitialData() {
        // Resolve default tenant from the same admin snapshot used by Studio
        frappe.call({
            method: 'digitz_ai_nexus.api.nexus_administration.get_administration_snapshot',
            callback(snap_r) {
                const snap = snap_r.message || {};
                const admin_tenant = (snap.resolved_context || {}).tenant || null;

                frappe.call({
                    method: 'digitz_ai_nexus_live.api.nexus_chat_workflow_tester.get_page_data',
                    callback(r) {
                        if (!r.message) return;
                        state.tenants = r.message.tenants || [];
                        const names = state.tenants.map(t => t.name);

                        if (admin_tenant && names.includes(admin_tenant)) {
                            state.tenant = admin_tenant;
                        } else if (state.tenants.length) {
                            state.tenant = state.tenants[0].name;
                        }

                        renderTenantSelect();
                        // Load channels for the resolved tenant
                        loadChannels();
                    },
                });
            },
        });
    }

    function renderTenantSelect() {
        const options = state.tenants.map(t =>
            `<option value="${esc(t.name)}" ${t.name === state.tenant ? 'selected' : ''}>${esc(t.tenant_name || t.name)}</option>`
        ).join('');
        $('#ncwt_tenant').html(options);
    }

    function loadChannels() {
        $('#ncwt_channel').html('<option value=""></option>');
        $('#ncwt_category').html('<option value=""></option>');
        state.result = null;
        $('#ncwt_result').html('<div class="ncwt-empty">Select a scenario and run the test.</div>');

        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_chat_workflow_tester.get_page_data',
            args: { tenant: state.tenant },
            callback(r) {
                if (!r.message) return;
                state.channels = r.message.channels || [];
                renderChannels();
            },
        });
    }

    function renderChannels() {
        const options = ['<option value=""></option>'].concat(
            state.channels.map(ch => `<option value="${esc(ch.name)}">${esc(ch.channel_name || ch.name)}</option>`)
        ).join('');
        $('#ncwt_channel').html(options);
    }

    function loadCategories(channel) {
        $('#ncwt_category').html('<option value=""></option>');
        if (!channel) return;
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_chat_workflow_tester.get_channel_categories',
            args: { channel },
            callback(r) {
                state.categories = (r.message && r.message.categories) || [];
                $('#ncwt_category').html(['<option value=""></option>'].concat(
                    state.categories.map(cat => `<option value="${esc(cat.name)}">${esc(cat.category_label)}</option>`)
                ).join(''));
            },
        });
    }

    function runTest() {
        $('#ncwt_run').prop('disabled', true).text('Testing...');
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_chat_workflow_tester.simulate_workflow',
            args: {
                channel: $('#ncwt_channel').val(),
                chat_category: $('#ncwt_category').val(),
                visitor_email: $('#ncwt_email').val(),
                assume_authenticated: $('#ncwt_auth').is(':checked') ? 1 : 0,
                assume_email_verified: $('#ncwt_email_verified').is(':checked') ? 1 : 0,
            },
            callback(r) {
                $('#ncwt_run').prop('disabled', false).text('Run Test');
                state.result = r.message;
                renderResult();
            },
            error() {
                $('#ncwt_run').prop('disabled', false).text('Run Test');
            },
        });
    }

    function renderResult() {
        const r = state.result;
        if (!r) {
            $('#ncwt_result').html('<div class="ncwt-empty">No result.</div>');
            return;
        }

        const chain = r.route_chain || {};
        const profile = chain.profile || null;
        const registry = r.identity_registry || null;

        $('#ncwt_result').html(`
            ${r.blocked ? '<div class="ncwt-alert danger">Blocked</div>' : '<div class="ncwt-alert success">Route Resolved</div>'}
            ${renderWarnings(r.warnings || [])}
            <div class="ncwt-flow">
                ${node('Category', r.category ? r.category.category_label : '')}
                ${node('Verification', r.category ? r.category.identity_verification_mode : '')}
                ${node('Identity', r.resolved_identity_type || 'Not resolved')}
                ${node('Profile', profile ? profile.name : 'No profile')}
                ${node('Access Categories', (chain.access_categories || []).join(', ') || 'None')}
            </div>
            <div class="ncwt-columns">
                <div>
                    <h4>Registry</h4>
                    ${registry ? `
                        <div class="ncwt-kv"><b>Email</b><span>${esc(registry.email)}</span></div>
                        <div class="ncwt-kv"><b>Status</b><span>${esc(registry.verification_status)}</span></div>
                        <div class="ncwt-kv"><b>Reference</b><span>${esc(formatReference(registry))}</span></div>
                        <div class="ncwt-tags">${(r.registered_identities || []).map(i => `<span>${esc(i.identity_profile)}${i.is_primary ? ' ★' : ''}</span>`).join('')}</div>
                    ` : '<div class="ncwt-empty">No registry match.</div>'}
                </div>
                <div>
                    <h4>Policies</h4>
                    ${(chain.policies || []).length ? `<div class="ncwt-tags">${chain.policies.map(p => `<span>${esc(p.policy_name || p.name)}</span>`).join('')}</div>` : '<div class="ncwt-empty">No policies resolved.</div>'}
                </div>
            </div>
        `);
    }

    function renderWarnings(warnings) {
        if (!warnings.length) return '';
        return `<div class="ncwt-warnings">${warnings.map(w => `<div>${esc(w)}</div>`).join('')}</div>`;
    }

    function node(label, value) {
        return `<div class="ncwt-node"><b>${esc(label)}</b><span>${esc(value || '')}</span></div>`;
    }

    function formatReference(registry) {
        if (!registry) return '';
        if (registry.reference_label) return registry.reference_label;
        if (registry.reference_doctype && registry.reference_name) {
            return `${registry.reference_doctype}: ${registry.reference_name}`;
        }
        return registry.reference_name || '';
    }

    function esc(value) {
        return frappe.utils.escape_html(value == null ? '' : String(value));
    }

    function inject_css() {
        if ($('#ncwt_css').length) return;
        $('<style id="ncwt_css">').text(`
            .ncwt-wrap { padding:18px; }
            .ncwt-hero { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; padding:18px; border:1px solid #d9e2f2; border-radius:8px; background:#fff; margin-bottom:16px; }
            .ncwt-badge { color:#214dbb; font-size:11px; font-weight:800; letter-spacing:.04em; }
            .ncwt-hero h2 { margin:4px 0 6px; font-weight:900; color:#102b67; }
            .ncwt-hero p { max-width:760px; color:#53688f; margin:0; }
            .ncwt-hero-right { display:flex; flex-direction:column; align-items:flex-end; gap:10px; flex-shrink:0; }
            .ncwt-tenant-wrap { display:flex; align-items:center; gap:7px; }
            .ncwt-tenant-label { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#8fa3bf; white-space:nowrap; }
            .ncwt-tenant-select { border:1.5px solid #d9e2f2; border-radius:8px; padding:5px 28px 5px 10px; font-size:13px; font-weight:600; color:#102b67; background:#f8fafd; cursor:pointer; outline:none; appearance:none; -webkit-appearance:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238fa3bf' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 9px center; }
            .ncwt-tenant-select:focus { border-color:#214dbb; }
            .ncwt-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
            .ncwt-grid { display:grid; grid-template-columns:320px minmax(0,1fr); gap:16px; }
            .ncwt-panel { border:1px solid #d9e2f2; border-radius:8px; background:#fff; padding:14px; }
            .ncwt-panel-title { font-size:16px; font-weight:900; color:#102b67; margin-bottom:12px; }
            .ncwt-form { display:flex; flex-direction:column; gap:10px; }
            .ncwt-form label { font-size:12px; font-weight:800; color:#344054; margin:0; }
            .ncwt-check { display:flex; gap:8px; align-items:center; }
            .ncwt-empty { color:#667085; padding:12px; text-align:center; }
            .ncwt-alert { padding:10px 12px; border-radius:8px; font-weight:900; margin-bottom:12px; }
            .ncwt-alert.success { background:#ecfdf3; color:#027a48; border:1px solid #abefc6; }
            .ncwt-alert.danger { background:#fff1f3; color:#c01048; border:1px solid #fecdd6; }
            .ncwt-warnings { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; }
            .ncwt-warnings div { background:#fffaeb; border:1px solid #fedf89; color:#b54708; border-radius:8px; padding:8px 10px; font-size:12px; font-weight:700; }
            .ncwt-flow { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:8px; margin-bottom:16px; }
            .ncwt-node { border:1px solid #edf1f7; border-radius:8px; padding:10px; min-height:74px; }
            .ncwt-node b { display:block; color:#102b67; font-size:12px; margin-bottom:6px; }
            .ncwt-node span { color:#344054; font-size:12px; overflow-wrap:anywhere; }
            .ncwt-columns { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
            .ncwt-columns h4 { font-size:14px; font-weight:900; color:#102b67; margin:0 0 10px; }
            .ncwt-kv { display:flex; justify-content:space-between; gap:10px; border-bottom:1px solid #edf1f7; padding:6px 0; font-size:12px; }
            .ncwt-tags { display:flex; flex-wrap:wrap; gap:6px; }
            .ncwt-tags span { border:1px solid #d9e2f2; border-radius:999px; padding:3px 8px; font-size:11px; color:#344054; }
            @media (max-width: 1000px) { .ncwt-grid, .ncwt-flow, .ncwt-columns { grid-template-columns:1fr; } .ncwt-hero { flex-direction:column; } }
        `).appendTo('head');
    }
};

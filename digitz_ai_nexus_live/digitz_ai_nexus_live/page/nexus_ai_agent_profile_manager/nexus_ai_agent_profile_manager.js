frappe.pages['nexus-ai-agent-profile-manager'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'AI Agent Profile Manager',
        single_column: true,
    });

    const state = {
        profiles: [],
        tenants: [],
        selectedTenant: '',
        channels: [],
        escalationPolicies: [],
        agentRoles: [],
        visibilityOptions: [],
        statusOptions: [],
        responseModes: [],
        memoryModes: [],
        selectedProfile: null,
    };

    inject_css();
    $(page.body).html(buildShell());
    bindEvents();
    loadPageData();

    // ── Shell ──────────────────────────────────────────────────────────────────

    function buildShell() {
        return `
<div class="naapm-wrap">

    <!-- Hero -->
    <div class="naapm-hero">
        <div>
            <div class="naapm-badge">AI Agent Profile Manager</div>
            <h2 class="naapm-hero-title">AI Agent Profiles</h2>
            <p class="naapm-hero-desc">
                Configure <b>AI Agent Profiles</b> that define how the AI behaves during chat —
                persona, behavior prompt, knowledge scope, escalation policy, and session limits.
                Profiles are assigned to chat category routes to govern which agent responds to
                each type of visitor interaction.
            </p>
            <div class="naapm-flow-pill">
                Chat Category &nbsp;→&nbsp; Route &nbsp;→&nbsp; <b>AI Agent Profile</b> &nbsp;→&nbsp; Knowledge &amp; Escalation
            </div>
        </div>
        <div class="naapm-hero-actions">
            <button class="btn btn-default btn-sm" data-list="Nexus AI Agent Profile">Open List</button>
            <button class="btn btn-primary" id="naapm_new">+ New Profile</button>
        </div>
    </div>

    <!-- Layout -->
    <div class="naapm-layout">

        <!-- Left: profile list -->
        <div class="naapm-card naapm-list-panel">
            <div class="naapm-tenant-wrap">
                <label class="naapm-tenant-label">Tenant</label>
                <select id="naapm_tenant" class="form-control form-control-sm"></select>
            </div>
            <div id="naapm_profile_list" class="naapm-profile-list">
                <div class="naapm-empty">Loading…</div>
            </div>
        </div>

        <!-- Right: form -->
        <div class="naapm-card naapm-form-panel">

            <div class="naapm-form-header">
                <div>
                    <div class="naapm-section-label">Profile Record</div>
                    <div class="naapm-form-title" id="naapm_form_title">New Profile</div>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                    <button class="btn btn-default btn-sm" id="naapm_open_doc" style="display:none;">Open Doc ↗</button>
                    <button class="btn btn-default btn-sm" id="naapm_toggle_btn" style="display:none;"></button>
                    <button class="btn btn-danger btn-sm" id="naapm_delete_btn" style="display:none;">Delete</button>
                    <button class="btn btn-primary" id="naapm_save">Save Profile</button>
                </div>
            </div>

            <!-- Identity -->
            <div class="naapm-field-section">
                <div class="naapm-section-badge">Identity</div>
                <div class="naapm-three">
                    <div class="naapm-field">
                        <label>Agent Code <span class="naapm-req">*</span></label>
                        <input class="form-control" id="naapm_agent_code" placeholder="e.g. SUPPORT-AI">
                        <div class="naapm-hint">Short uppercase code. Auto-formatted on save.</div>
                    </div>
                    <div class="naapm-field">
                        <label>Agent Name <span class="naapm-req">*</span></label>
                        <input class="form-control" id="naapm_agent_name" placeholder="e.g. Support Assistant">
                    </div>
                    <div class="naapm-field">
                        <label>Display Name</label>
                        <input class="form-control" id="naapm_display_name" placeholder="Shown to visitors">
                    </div>
                </div>
                <div class="naapm-three">
                    <div class="naapm-field">
                        <label>Tenant</label>
                        <select class="form-control" id="naapm_tenant_field">
                            <option value="">— None —</option>
                        </select>
                    </div>
                    <div class="naapm-field">
                        <label>Agent Role <span class="naapm-req">*</span></label>
                        <select class="form-control" id="naapm_agent_role">
                            <option value="">— Select Role —</option>
                        </select>
                    </div>
                    <div class="naapm-field">
                        <label>Visibility</label>
                        <select class="form-control" id="naapm_visibility">
                            <option value="">— Select —</option>
                        </select>
                    </div>
                </div>
                <div class="naapm-three">
                    <div class="naapm-field">
                        <label>Status</label>
                        <select class="form-control" id="naapm_status">
                            <option value="">— Select —</option>
                        </select>
                    </div>
                    <div class="naapm-field">
                        <label>Priority</label>
                        <input class="form-control" type="number" id="naapm_priority" placeholder="0" min="0">
                    </div>
                    <div class="naapm-field">
                        <label>Max Active Sessions</label>
                        <input class="form-control" type="number" id="naapm_max_sessions" placeholder="0" min="0">
                    </div>
                </div>
                <div class="naapm-two">
                    <div class="naapm-field">
                        <label>Default Channel</label>
                        <select class="form-control" id="naapm_default_channel">
                            <option value="">— None —</option>
                        </select>
                    </div>
                    <div class="naapm-field naapm-check-field">
                        <label class="naapm-check-label">
                            <input type="checkbox" id="naapm_enabled" checked>
                            <span>Enabled</span>
                        </label>
                    </div>
                </div>
                <div class="naapm-field">
                    <label>Description</label>
                    <textarea class="form-control" id="naapm_description" rows="2"
                        placeholder="What is this agent's purpose and audience?"></textarea>
                </div>
                <div class="naapm-field">
                    <label>Nickname Pool</label>
                    <input class="form-control" id="naapm_nickname_pool" placeholder="Comma-separated names the agent may use">
                </div>
            </div>

            <!-- Behaviour -->
            <div class="naapm-field-section">
                <div class="naapm-section-badge">Behaviour &amp; Persona</div>
                <div class="naapm-field">
                    <label>Behavior Prompt <span class="naapm-req">*</span></label>
                    <textarea class="form-control" id="naapm_behavior_prompt" rows="5"
                        placeholder="Describe the agent's personality, tone, constraints, and how it should respond…"></textarea>
                </div>
                <div class="naapm-three">
                    <div class="naapm-field">
                        <label>Tone</label>
                        <input class="form-control" id="naapm_tone" placeholder="e.g. Professional, Friendly">
                    </div>
                    <div class="naapm-field">
                        <label>Response Style</label>
                        <input class="form-control" id="naapm_response_style" placeholder="e.g. Concise, Detailed">
                    </div>
                    <div class="naapm-field">
                        <label>Default Response Mode</label>
                        <select class="form-control" id="naapm_response_mode">
                            <option value="">— Select —</option>
                        </select>
                    </div>
                </div>
                <div class="naapm-two">
                    <div class="naapm-field">
                        <label>Welcome Message</label>
                        <textarea class="form-control" id="naapm_welcome" rows="2"
                            placeholder="Greeting sent when a visitor opens chat"></textarea>
                    </div>
                    <div class="naapm-field">
                        <label>Fallback Message</label>
                        <textarea class="form-control" id="naapm_fallback" rows="2"
                            placeholder="Message sent when the agent cannot answer"></textarea>
                    </div>
                </div>
                <div class="naapm-field">
                    <label>Do Not Answer Rules</label>
                    <textarea class="form-control" id="naapm_dna_rules" rows="3"
                        placeholder="Topics or question types this agent must refuse to answer"></textarea>
                </div>
            </div>

            <!-- Escalation & Memory -->
            <div class="naapm-field-section">
                <div class="naapm-section-badge">Escalation &amp; Memory</div>
                <div class="naapm-two">
                    <div class="naapm-field">
                        <label class="naapm-check-label">
                            <input type="checkbox" id="naapm_esc_enabled">
                            <span>Escalation Enabled</span>
                        </label>
                        <div class="naapm-hint">Allow this agent to hand off conversations to human agents.</div>
                    </div>
                    <div class="naapm-field" id="naapm_esc_policy_wrap">
                        <label>Escalation Policy</label>
                        <select class="form-control" id="naapm_esc_policy">
                            <option value="">— None —</option>
                        </select>
                    </div>
                </div>
                <div class="naapm-field">
                    <label>Memory Mode</label>
                    <select class="form-control" id="naapm_memory_mode">
                        <option value="">— Select —</option>
                    </select>
                </div>
                <div class="naapm-field">
                    <label>Confidence Threshold</label>
                    <input class="form-control" type="number" id="naapm_confidence" placeholder="0.0" min="0" max="1" step="0.05">
                    <div class="naapm-hint">Minimum confidence score (0–1) before the agent escalates instead of answering.</div>
                </div>
            </div>

        </div>
    </div>
</div>`;
    }

    // ── Events ─────────────────────────────────────────────────────────────────

    function bindEvents() {
        $(page.body).on('click', '[data-list]', function () {
            frappe.set_route('List', $(this).data('list'));
        });
        $(page.body).on('click', '#naapm_new', newProfile);
        $(page.body).on('click', '#naapm_save', saveProfile);
        $(page.body).on('click', '#naapm_open_doc', () => {
            if (state.selectedProfile) frappe.set_route('Form', 'Nexus AI Agent Profile', state.selectedProfile);
        });
        $(page.body).on('click', '#naapm_toggle_btn', toggleProfile);
        $(page.body).on('click', '#naapm_delete_btn', deleteProfile);
        $(page.body).on('click', '.naapm-profile-item', function () {
            loadProfile($(this).data('name'));
        });
        $(page.body).on('change', '#naapm_tenant', function () {
            state.selectedTenant = $(this).val();
            state.selectedProfile = null;
            loadProfiles();
        });
        $(page.body).on('change', '#naapm_esc_enabled', function () {
            $('#naapm_esc_policy_wrap').toggle($(this).is(':checked'));
        });
    }

    // ── Data ───────────────────────────────────────────────────────────────────

    function loadPageData() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_ai_agent_profile_manager.get_page_data',
            callback(r) {
                if (!r.message) return;
                const d = r.message;
                state.tenants = d.tenants || [];
                state.channels = d.channels || [];
                state.escalationPolicies = d.escalation_policies || [];
                state.agentRoles = d.agent_roles || [];
                state.visibilityOptions = d.visibility_options || [];
                state.statusOptions = d.status_options || [];
                state.responseModes = d.response_modes || [];
                state.memoryModes = d.memory_modes || [];
                state.selectedTenant = d.default_tenant || '';

                const tenantOpts = state.tenants.map(t =>
                    `<option value="${esc(t.name)}">${esc(t.tenant_name || t.name)}</option>`
                ).join('');
                $('#naapm_tenant').html('<option value="">All Tenants</option>' + tenantOpts);
                $('#naapm_tenant_field').html('<option value="">— None —</option>' + tenantOpts);
                if (state.selectedTenant) {
                    $('#naapm_tenant').val(state.selectedTenant);
                    $('#naapm_tenant_field').val(state.selectedTenant);
                }

                $('#naapm_agent_role').append(state.agentRoles.map(r =>
                    `<option value="${esc(r)}">${esc(r)}</option>`).join(''));
                $('#naapm_visibility').append(state.visibilityOptions.map(v =>
                    `<option value="${esc(v)}">${esc(v)}</option>`).join(''));
                $('#naapm_status').append(state.statusOptions.map(s =>
                    `<option value="${esc(s)}">${esc(s)}</option>`).join(''));
                $('#naapm_response_mode').append(state.responseModes.map(m =>
                    `<option value="${esc(m)}">${esc(m)}</option>`).join(''));
                $('#naapm_memory_mode').append(state.memoryModes.map(m =>
                    `<option value="${esc(m)}">${esc(m)}</option>`).join(''));
                $('#naapm_default_channel').append(state.channels.map(c =>
                    `<option value="${esc(c.name)}">${esc(c.channel_name || c.name)}</option>`).join(''));
                $('#naapm_esc_policy').append(state.escalationPolicies.map(p =>
                    `<option value="${esc(p)}">${esc(p)}</option>`).join(''));

                loadProfiles();
            },
        });
    }

    function loadProfiles() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_ai_agent_profile_manager.get_profiles',
            args: { tenant: state.selectedTenant || null },
            callback(r) {
                state.profiles = (r.message && r.message.profiles) || [];
                renderProfileList();
                if (!state.selectedProfile) newProfile();
            },
        });
    }

    function loadProfile(name) {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_ai_agent_profile_manager.get_profile',
            args: { name },
            callback(r) {
                if (!r.message) return;
                fillForm(r.message.profile);
            },
        });
    }

    function saveProfile() {
        const data = collectForm();
        if (!data.agent_code) {
            frappe.show_alert({ message: 'Agent Code is required.', indicator: 'red' });
            $('#naapm_agent_code').focus();
            return;
        }
        if (!data.agent_name) {
            frappe.show_alert({ message: 'Agent Name is required.', indicator: 'red' });
            $('#naapm_agent_name').focus();
            return;
        }
        if (!data.agent_role) {
            frappe.show_alert({ message: 'Agent Role is required.', indicator: 'red' });
            $('#naapm_agent_role').focus();
            return;
        }
        if (!data.behavior_prompt) {
            frappe.show_alert({ message: 'Behavior Prompt is required.', indicator: 'red' });
            $('#naapm_behavior_prompt').focus();
            return;
        }

        $('#naapm_save').prop('disabled', true).text('Saving…');
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_ai_agent_profile_manager.save_profile',
            args: { profile: JSON.stringify(data) },
            callback(r) {
                $('#naapm_save').prop('disabled', false).text('Save Profile');
                if (!r.message) return;
                frappe.show_alert({ message: 'Profile saved.', indicator: 'green' });
                state.selectedProfile = r.message.name;
                loadProfiles();
                loadProfile(r.message.name);
            },
            error() {
                $('#naapm_save').prop('disabled', false).text('Save Profile');
            },
        });
    }

    function toggleProfile() {
        if (!state.selectedProfile) return;
        const current = $('#naapm_enabled').is(':checked') ? 1 : 0;
        const newVal = current ? 0 : 1;
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_ai_agent_profile_manager.toggle_profile',
            args: { name: state.selectedProfile, enabled: newVal },
            callback(r) {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert({ message: newVal ? 'Enabled.' : 'Disabled.', indicator: newVal ? 'green' : 'orange' });
                    loadProfiles();
                    loadProfile(state.selectedProfile);
                }
            },
        });
    }

    function deleteProfile() {
        if (!state.selectedProfile) return;
        frappe.confirm('Delete this AI Agent Profile? Routes referencing it will need to be updated.', () => {
            frappe.call({
                method: 'digitz_ai_nexus_live.api.nexus_ai_agent_profile_manager.delete_profile',
                args: { name: state.selectedProfile },
                callback(r) {
                    if (r.message && r.message.status === 'success') {
                        frappe.show_alert({ message: 'Profile deleted.', indicator: 'green' });
                        state.selectedProfile = null;
                        loadProfiles();
                    }
                },
            });
        });
    }

    // ── List ───────────────────────────────────────────────────────────────────

    function renderProfileList() {
        const $list = $('#naapm_profile_list');
        if (!state.profiles.length) {
            $list.html('<div class="naapm-empty">No profiles found. Click <b>+ New Profile</b> to create one.</div>');
            return;
        }

        const roleColors = {
            'Public Responder': 'naapm-role-public',
            'Sales': 'naapm-role-sales',
            'Support': 'naapm-role-support',
            'Consultant': 'naapm-role-consultant',
            'Internal Assistant': 'naapm-role-internal',
            'Admin Reviewer': 'naapm-role-admin',
        };

        $list.html(state.profiles.map(p => `
            <div class="naapm-profile-item ${p.name === state.selectedProfile ? 'naapm-item-active' : ''}" data-name="${esc(p.name)}">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
                    <div>
                        <div class="naapm-item-code">${esc(p.agent_code)}</div>
                        <div class="naapm-muted">${esc(p.agent_name)}</div>
                    </div>
                    <span class="naapm-status-pill ${p.enabled ? 'naapm-pill-on' : 'naapm-pill-off'}">${p.enabled ? 'On' : 'Off'}</span>
                </div>
                ${p.agent_role ? `<span class="naapm-role-pill ${roleColors[p.agent_role] || ''}">${esc(p.agent_role)}</span>` : ''}
            </div>
        `).join(''));
    }

    // ── Form ───────────────────────────────────────────────────────────────────

    function newProfile() {
        state.selectedProfile = null;
        fillForm({ enabled: 1, status: 'Idle', visibility: 'Public', memory_mode: 'None' });
        renderProfileList();
    }

    function fillForm(p) {
        state.selectedProfile = p.name || null;
        $('#naapm_form_title').text(state.selectedProfile ? (p.agent_name || p.agent_code || p.name) : 'New Profile');
        $('#naapm_open_doc').toggle(Boolean(state.selectedProfile));
        $('#naapm_delete_btn').toggle(Boolean(state.selectedProfile));
        if (state.selectedProfile) {
            const enabled = Number(p.enabled) === 1;
            $('#naapm_toggle_btn').show().text(enabled ? 'Disable' : 'Enable')
                .removeClass('btn-warning btn-success')
                .addClass(enabled ? 'btn-warning' : 'btn-success');
        } else {
            $('#naapm_toggle_btn').hide();
        }

        $('#naapm_agent_code').val(p.agent_code || '');
        $('#naapm_agent_name').val(p.agent_name || '');
        $('#naapm_display_name').val(p.display_name || '');
        $('#naapm_nickname_pool').val(p.nickname_pool || '');
        $('#naapm_tenant_field').val(p.tenant || state.selectedTenant || '');
        $('#naapm_agent_role').val(p.agent_role || '');
        $('#naapm_visibility').val(p.visibility || 'Public');
        $('#naapm_enabled').prop('checked', Number(p.enabled) === 1);
        $('#naapm_status').val(p.status || 'Idle');
        $('#naapm_priority').val(p.priority || 0);
        $('#naapm_max_sessions').val(p.max_active_sessions || 0);
        $('#naapm_default_channel').val(p.default_channel || '');
        $('#naapm_description').val(p.description || '');
        $('#naapm_behavior_prompt').val(p.behavior_prompt || '');
        $('#naapm_tone').val(p.tone || '');
        $('#naapm_response_style').val(p.response_style || '');
        $('#naapm_response_mode').val(p.default_response_mode || '');
        $('#naapm_welcome').val(p.welcome_message || '');
        $('#naapm_fallback').val(p.fallback_message || '');
        $('#naapm_dna_rules').val(p.do_not_answer_rules || '');
        const escEnabled = Number(p.escalation_enabled) === 1;
        $('#naapm_esc_enabled').prop('checked', escEnabled);
        $('#naapm_esc_policy_wrap').toggle(escEnabled);
        $('#naapm_esc_policy').val(p.escalation_policy || '');
        $('#naapm_memory_mode').val(p.memory_mode || 'None');
        $('#naapm_confidence').val(p.confidence_threshold || 0);

        renderProfileList();
    }

    function collectForm() {
        return {
            name: state.selectedProfile,
            agent_code: $('#naapm_agent_code').val().trim().toUpperCase().replace(/\s+/g, '-'),
            agent_name: $('#naapm_agent_name').val().trim(),
            display_name: $('#naapm_display_name').val().trim(),
            nickname_pool: $('#naapm_nickname_pool').val().trim(),
            tenant: $('#naapm_tenant_field').val(),
            agent_role: $('#naapm_agent_role').val(),
            visibility: $('#naapm_visibility').val(),
            enabled: $('#naapm_enabled').is(':checked') ? 1 : 0,
            status: $('#naapm_status').val(),
            priority: parseInt($('#naapm_priority').val()) || 0,
            max_active_sessions: parseInt($('#naapm_max_sessions').val()) || 0,
            default_channel: $('#naapm_default_channel').val(),
            description: $('#naapm_description').val().trim(),
            behavior_prompt: $('#naapm_behavior_prompt').val().trim(),
            tone: $('#naapm_tone').val().trim(),
            response_style: $('#naapm_response_style').val().trim(),
            default_response_mode: $('#naapm_response_mode').val(),
            welcome_message: $('#naapm_welcome').val().trim(),
            fallback_message: $('#naapm_fallback').val().trim(),
            do_not_answer_rules: $('#naapm_dna_rules').val().trim(),
            escalation_enabled: $('#naapm_esc_enabled').is(':checked') ? 1 : 0,
            escalation_policy: $('#naapm_esc_policy').val(),
            memory_mode: $('#naapm_memory_mode').val(),
            confidence_threshold: parseFloat($('#naapm_confidence').val()) || 0,
        };
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    function esc(v) { return frappe.utils.escape_html(v == null ? '' : String(v)); }

    // ── CSS ────────────────────────────────────────────────────────────────────

    function inject_css() {
        if ($('#naapm_css').length) return;
        $('head').append(`<style id="naapm_css">

.naapm-wrap { padding:14px; }

/* Hero */
.naapm-hero { display:flex; justify-content:space-between; align-items:flex-start; gap:20px;
    border-radius:22px; padding:28px 32px; margin-bottom:18px;
    background:radial-gradient(circle at 8% 20%,rgba(99,102,241,.2),transparent 30%),
               radial-gradient(circle at 92% 10%,rgba(249,115,22,.15),transparent 28%),
               linear-gradient(135deg,#fff 0%,#f5f3ff 48%,#fff7ed 100%);
    border:1px solid rgba(99,102,241,.28); box-shadow:0 14px 36px rgba(67,56,202,.09); }
.naapm-badge { display:inline-flex; padding:6px 12px; border-radius:999px;
    background:rgba(67,56,202,.08); border:1px solid rgba(67,56,202,.18);
    color:#4338ca; font-weight:800; font-size:11px; letter-spacing:.04em;
    text-transform:uppercase; margin-bottom:10px; }
.naapm-hero-title { margin:0; font-size:26px; font-weight:900; color:#1e1b4b; letter-spacing:-.03em; }
.naapm-hero-desc { margin:10px 0 0; font-size:14px; line-height:1.65; color:#3730a3;
    font-weight:500; max-width:680px; }
.naapm-flow-pill { display:inline-block; margin-top:12px; padding:7px 14px; border-radius:999px;
    background:rgba(67,56,202,.08); border:1px solid rgba(67,56,202,.18); color:#4338ca;
    font-size:11px; font-weight:800; font-family:monospace; }
.naapm-hero-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; flex-shrink:0; }
.naapm-hero-actions .btn { border-radius:999px; font-weight:850; }

/* Layout */
.naapm-layout { display:grid; grid-template-columns:260px minmax(0,1fr); gap:16px; align-items:start; }
.naapm-card { border:1px solid rgba(99,102,241,.22); border-radius:18px; background:#fff;
    padding:18px; box-shadow:0 8px 24px rgba(67,56,202,.06); }

/* List panel */
.naapm-list-panel { position:sticky; top:64px; }
.naapm-tenant-wrap { margin-bottom:12px; }
.naapm-tenant-label { font-size:11px; font-weight:900; color:#6b7c9b;
    text-transform:uppercase; letter-spacing:.05em; display:block; margin-bottom:4px; }
.naapm-profile-list { display:flex; flex-direction:column; gap:8px; max-height:560px; overflow-y:auto; }
.naapm-profile-item { border:1px solid #e8eef7; border-radius:12px; padding:12px 14px;
    cursor:pointer; transition:border-color .15s, background .15s; }
.naapm-profile-item:hover { border-color:rgba(67,56,202,.35); background:#f5f3ff; }
.naapm-item-active { border-color:#4338ca !important; background:#eef2ff !important; }
.naapm-item-code { font-weight:900; color:#1e1b4b; font-size:13px; font-family:monospace; }
.naapm-muted { color:#6b7c9b; font-size:12px; font-weight:600; margin-top:2px; }
.naapm-empty { color:#8a9bb8; padding:16px; text-align:center; font-size:13px;
    font-weight:600; line-height:1.6; }

/* Role pills */
.naapm-role-pill { display:inline-flex; margin-top:7px; padding:3px 9px; border-radius:999px;
    font-size:10px; font-weight:900; }
.naapm-role-public   { background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; }
.naapm-role-sales    { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; }
.naapm-role-support  { background:#fefce8; color:#a16207; border:1px solid #fde68a; }
.naapm-role-consultant { background:#fdf4ff; color:#7e22ce; border:1px solid #e9d5ff; }
.naapm-role-internal { background:#fff7ed; color:#c2410c; border:1px solid #fed7aa; }
.naapm-role-admin    { background:#fff0f0; color:#b42318; border:1px solid #ffd1d1; }

/* Status pills */
.naapm-status-pill { display:inline-flex; padding:3px 9px; border-radius:999px;
    font-size:10px; font-weight:900; white-space:nowrap; }
.naapm-pill-on  { background:#ecfdf3; color:#16794c; border:1px solid #bdebd2; }
.naapm-pill-off { background:#f3f4f6; color:#6b7280; border:1px solid #d1d5db; }

/* Form */
.naapm-form-panel { display:flex; flex-direction:column; gap:0; }
.naapm-form-header { display:flex; justify-content:space-between; align-items:flex-start;
    gap:12px; padding-bottom:16px; border-bottom:2px solid rgba(99,102,241,.12);
    margin-bottom:16px; }
.naapm-form-title { font-size:20px; font-weight:900; color:#1e1b4b; margin-top:4px; font-family:monospace; }
.naapm-section-label { font-size:10px; font-weight:900; color:#8a9bb8;
    text-transform:uppercase; letter-spacing:.05em; }
.naapm-field-section { padding:16px 0; border-top:1px solid rgba(99,102,241,.12); }
.naapm-field-section:first-of-type { border-top:none; padding-top:0; }
.naapm-section-badge { display:inline-flex; padding:4px 12px; border-radius:999px;
    background:rgba(67,56,202,.07); border:1px solid rgba(67,56,202,.15);
    color:#4338ca; font-size:10px; font-weight:900; letter-spacing:.05em;
    text-transform:uppercase; margin-bottom:12px; }
.naapm-three { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-bottom:14px; }
.naapm-two   { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-bottom:14px; }
.naapm-field { display:flex; flex-direction:column; gap:5px; }
.naapm-field label { font-size:12px; font-weight:850; color:#1e1b4b; }
.naapm-hint { font-size:11px; color:#8a9bb8; line-height:1.4; }
.naapm-req { color:#b42318; }
.naapm-check-field { justify-content:center; }
.naapm-check-label { display:flex; align-items:center; gap:7px; cursor:pointer;
    font-size:13px; font-weight:800; color:#1e1b4b; }

@media (max-width:960px) {
    .naapm-layout { grid-template-columns:1fr; }
    .naapm-list-panel { position:static; }
    .naapm-three, .naapm-two { grid-template-columns:1fr; }
    .naapm-hero { flex-direction:column; }
}
        </style>`);
    }
};

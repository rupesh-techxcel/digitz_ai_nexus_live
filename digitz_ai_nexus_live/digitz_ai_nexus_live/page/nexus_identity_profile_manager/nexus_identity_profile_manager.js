frappe.pages['nexus-identity-profile-manager'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus Identity Profile Manager',
        single_column: true,
    });

    const state = {
        profiles: [],
        tenants: [],
        selectedTenant: '',
        identityTypes: [],
        knowledgeProfiles: [],
        selectedProfile: null,
        mappings: [],
    };

    inject_css();
    $(page.body).html(buildShell());
    bindEvents();
    loadPageData();

    // ── Shell ──────────────────────────────────────────────────────────────────

    function buildShell() {
        return `
<div class="nipm-wrap">

    <!-- Hero -->
    <div class="nipm-hero">
        <div>
            <div class="nipm-badge">Identity Profile Manager</div>
            <h2 class="nipm-hero-title">Identity Profiles</h2>
            <p class="nipm-hero-desc">
                An <b>Identity Profile</b> maps each visitor identity type (Public, Customer, Partner, etc.)
                to one or more <b>Knowledge Profiles</b>. During chat, the resolved identity type is
                matched against these mappings to determine what knowledge the person can access.
            </p>
            <div class="nipm-flow-pill">
                Identity Type &nbsp;→&nbsp; <b>Identity Profile</b> &nbsp;→&nbsp; Knowledge Profile &nbsp;→&nbsp; Access &amp; Policy
            </div>
        </div>
        <div class="nipm-hero-actions">
            <button class="btn btn-default btn-sm" data-list="Nexus Identity Profile">Open List</button>
            <button class="btn btn-default btn-sm" id="nipm_go_kp">Knowledge Profiles ↗</button>
            <button class="btn btn-primary" id="nipm_new">+ New Profile</button>
        </div>
    </div>

    <!-- Layout -->
    <div class="nipm-layout">

        <!-- Left: profile list -->
        <div class="nipm-card nipm-list-panel">
            <div class="nipm-tenant-wrap">
                <label class="nipm-tenant-label">Tenant</label>
                <select id="nipm_tenant" class="form-control form-control-sm nipm-tenant-select">
                    <option value="">All Tenants</option>
                </select>
            </div>
            <div id="nipm_profile_list" class="nipm-profile-list">
                <div class="nipm-empty">Loading…</div>
            </div>
        </div>

        <!-- Right: form -->
        <div class="nipm-card nipm-form-panel">

            <!-- Form header -->
            <div class="nipm-form-header">
                <div>
                    <div class="nipm-section-label">Profile Record</div>
                    <div class="nipm-form-title" id="nipm_form_title">New Profile</div>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                    <button class="btn btn-default btn-sm" id="nipm_open_doc" style="display:none;">Open Doc ↗</button>
                    <button class="btn btn-default btn-sm" id="nipm_toggle_btn" style="display:none;"></button>
                    <button class="btn btn-danger btn-sm" id="nipm_delete_btn" style="display:none;">Delete</button>
                    <button class="btn btn-primary" id="nipm_save">Save Profile</button>
                </div>
            </div>

            <!-- Core fields -->
            <div class="nipm-field-section">
                <div class="nipm-section-badge">Profile Details</div>
                <div class="nipm-two">
                    <div class="nipm-field">
                        <label>Profile Name <span class="nipm-req">*</span></label>
                        <input class="form-control" id="nipm_profile_name" placeholder="e.g. Customer Identity Profile">
                        <div class="nipm-hint">Short internal code. Used in routes and registries.</div>
                    </div>
                    <div class="nipm-field">
                        <label>Title</label>
                        <input class="form-control" id="nipm_title" placeholder="e.g. Customer Knowledge Access">
                        <div class="nipm-hint">Human-readable label shown in pickers.</div>
                    </div>
                </div>
                <div class="nipm-two">
                    <div class="nipm-field">
                        <label>Tenant</label>
                        <select class="form-control" id="nipm_tenant_field">
                            <option value="">— None —</option>
                        </select>
                    </div>
                    <div class="nipm-field nipm-check-field">
                        <label class="nipm-check-label">
                            <input type="checkbox" id="nipm_enabled" checked>
                            <span>Enabled</span>
                        </label>
                        <div class="nipm-hint">Disabled profiles are ignored by the routing engine.</div>
                    </div>
                </div>
                <div class="nipm-field">
                    <label>Description</label>
                    <textarea class="form-control" id="nipm_description" rows="2"
                        placeholder="What visitor segment does this profile serve? What knowledge does it unlock?"></textarea>
                </div>
            </div>

            <!-- Identity Mappings -->
            <div class="nipm-field-section nipm-mappings-section">
                <div class="nipm-mappings-header">
                    <div>
                        <div class="nipm-section-badge">Knowledge Access Rules</div>
                        <p class="nipm-mappings-desc">
                            Each row is a <b>runtime access rule</b>: when a visitor's resolved Identity Type matches,
                            they are granted access to the mapped <b>Knowledge Profile</b>.
                            Add multiple rows if this profile serves several identity types
                            or unlocks several knowledge profiles.
                        </p>
                    </div>
                    <button class="btn btn-default btn-sm" id="nipm_add_mapping">+ Add Rule</button>
                </div>

                <div id="nipm_mapping_rows"></div>

                <div id="nipm_no_mappings" class="nipm-empty-mappings" style="display:none;">
                    No rules yet. Click <b>+ Add Rule</b> to grant an identity type access to a knowledge profile.
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
        $(page.body).on('click', '#nipm_go_kp', () => frappe.set_route('nexus-profile-access-allocation'));
        $(page.body).on('click', '.nipm-kp-pill', () => frappe.set_route('nexus-profile-access-allocation'));
        $(page.body).on('click', '#nipm_new', newProfile);
        $(page.body).on('click', '#nipm_save', saveProfile);
        $(page.body).on('click', '#nipm_open_doc', () => {
            if (state.selectedProfile) frappe.set_route('Form', 'Nexus Identity Profile', state.selectedProfile);
        });
        $(page.body).on('click', '#nipm_toggle_btn', toggleProfile);
        $(page.body).on('click', '#nipm_delete_btn', deleteProfile);
        $(page.body).on('click', '.nipm-profile-item', function () {
            loadProfile($(this).data('name'));
        });
        $(page.body).on('change', '#nipm_tenant', function () {
            state.selectedTenant = $(this).val();
            state.selectedProfile = null;
            loadProfiles();
        });
        $(page.body).on('click', '#nipm_add_mapping', addMappingRow);
        $(page.body).on('click', '.nipm-remove-row', function () {
            const idx = Number($(this).data('idx'));
            state.mappings.splice(idx, 1);
            renderMappingRows();
        });
        $(page.body).on('change', '.nipm-row-type, .nipm-row-kp', function () {
            const $row = $(this).closest('.nipm-mapping-row');
            const idx = Number($row.data('idx'));
            const type = $row.find('.nipm-row-type').val();
            const kp   = $row.find('.nipm-row-kp').val();
            state.mappings[idx] = { identity_type: type, knowledge_profile: kp };
            updateRowCard(idx, type, kp);
        });
    }

    // ── Data loading ───────────────────────────────────────────────────────────

    function loadPageData() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_identity_profile_manager.get_page_data',
            callback(r) {
                if (!r.message) return;
                state.tenants = r.message.tenants || [];
                state.identityTypes = r.message.identity_types || [];
                state.knowledgeProfiles = r.message.knowledge_profiles || [];
                state.selectedTenant = r.message.default_tenant || '';

                // Populate both tenant selects
                const opts = state.tenants.map(t =>
                    `<option value="${esc(t.name)}">${esc(t.tenant_name || t.name)}</option>`
                ).join('');
                $('#nipm_tenant').html('<option value="">All Tenants</option>' + opts);
                $('#nipm_tenant_field').html('<option value="">— None —</option>' + opts);

                if (state.selectedTenant) {
                    $('#nipm_tenant').val(state.selectedTenant);
                    $('#nipm_tenant_field').val(state.selectedTenant);
                }

                loadProfiles();
            },
        });
    }

    function loadProfiles() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_identity_profile_manager.get_profiles',
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
            method: 'digitz_ai_nexus_live.api.nexus_identity_profile_manager.get_profile',
            args: { name },
            callback(r) {
                if (!r.message) return;
                fillForm(r.message.profile);
                state.mappings = r.message.mappings || [];
                renderMappingRows();
            },
        });
    }

    function saveProfile() {
        const profile = collectForm();
        if (!profile.profile_name) {
            frappe.show_alert({ message: 'Profile Name is required.', indicator: 'red' });
            $('#nipm_profile_name').focus();
            return;
        }

        $('#nipm_save').prop('disabled', true).text('Saving…');
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_identity_profile_manager.save_profile',
            args: {
                profile: JSON.stringify(profile),
                mappings: JSON.stringify(state.mappings),
            },
            callback(r) {
                $('#nipm_save').prop('disabled', false).text('Save Profile');
                if (!r.message) return;
                frappe.show_alert({ message: 'Profile saved.', indicator: 'green' });
                state.selectedProfile = r.message.name;
                loadProfiles();
                loadProfile(r.message.name);
            },
            error() {
                $('#nipm_save').prop('disabled', false).text('Save Profile');
            },
        });
    }

    function toggleProfile() {
        if (!state.selectedProfile) return;
        const current = $('#nipm_enabled').is(':checked') ? 1 : 0;
        const newVal = current ? 0 : 1;
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_identity_profile_manager.toggle_profile',
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
        frappe.confirm('Delete this Identity Profile? This removes the profile from all registries that reference it.', () => {
            frappe.call({
                method: 'digitz_ai_nexus_live.api.nexus_identity_profile_manager.delete_profile',
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

    // ── Profile list ───────────────────────────────────────────────────────────

    function renderProfileList() {
        const $list = $('#nipm_profile_list');
        if (!state.profiles.length) {
            $list.html('<div class="nipm-empty">No profiles found. Click <b>+ New Profile</b> to create one.</div>');
            return;
        }

        $list.html(state.profiles.map(p => `
            <div class="nipm-profile-item ${p.name === state.selectedProfile ? 'nipm-item-active' : ''}" data-name="${esc(p.name)}">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
                    <div>
                        <div class="nipm-item-name">${esc(p.profile_name)}</div>
                        ${p.title ? `<div class="nipm-muted">${esc(p.title)}</div>` : ''}
                    </div>
                    <span class="nipm-status-pill ${p.enabled ? 'nipm-pill-on' : 'nipm-pill-off'}">${p.enabled ? 'On' : 'Off'}</span>
                </div>
                ${p.mapping_count > 0
                    ? `<div class="nipm-item-count">${p.mapping_count} mapping${p.mapping_count !== 1 ? 's' : ''}</div>`
                    : `<div class="nipm-item-count nipm-warn">No access rules configured</div>`
                }
            </div>
        `).join(''));
    }

    // ── Form ───────────────────────────────────────────────────────────────────

    function newProfile() {
        state.selectedProfile = null;
        state.mappings = [];
        fillForm({ enabled: 1 });
        renderMappingRows();
        renderProfileList();
    }

    function fillForm(profile) {
        state.selectedProfile = profile.name || null;
        $('#nipm_form_title').text(state.selectedProfile ? (profile.profile_name || profile.name) : 'New Profile');
        $('#nipm_open_doc').toggle(Boolean(state.selectedProfile));
        $('#nipm_delete_btn').toggle(Boolean(state.selectedProfile));
        if (state.selectedProfile) {
            const enabled = Number(profile.enabled) === 1;
            $('#nipm_toggle_btn').show().text(enabled ? 'Disable' : 'Enable')
                .removeClass('btn-warning btn-success')
                .addClass(enabled ? 'btn-warning' : 'btn-success');
        } else {
            $('#nipm_toggle_btn').hide();
        }

        $('#nipm_profile_name').val(profile.profile_name || '');
        $('#nipm_title').val(profile.title || '');
        $('#nipm_tenant_field').val(profile.tenant || state.selectedTenant || '');
        $('#nipm_enabled').prop('checked', Number(profile.enabled) === 1);
        $('#nipm_description').val(profile.description || '');
        renderProfileList();
    }

    function collectForm() {
        return {
            name: state.selectedProfile,
            profile_name: $('#nipm_profile_name').val().trim().toUpperCase().replace(/\s+/g, '-'),
            title: $('#nipm_title').val().trim(),
            tenant: $('#nipm_tenant_field').val(),
            enabled: $('#nipm_enabled').is(':checked') ? 1 : 0,
            description: $('#nipm_description').val().trim(),
        };
    }

    // ── Mapping rows ───────────────────────────────────────────────────────────

    function addMappingRow() {
        state.mappings.push({ identity_type: '', knowledge_profile: '' });
        renderMappingRows();
        // Focus the new row's identity type select
        const last = $('#nipm_mapping_rows .nipm-mapping-row').last();
        last.find('.nipm-row-type').focus();
    }

    function renderMappingRows() {
        const $wrap = $('#nipm_mapping_rows');
        $('#nipm_no_mappings').toggle(state.mappings.length === 0);

        if (!state.mappings.length) {
            $wrap.empty();
            return;
        }

        const typeOpts = ['<option value="">— Select Identity Type —</option>']
            .concat(state.identityTypes.map(t => `<option value="${esc(t)}">${esc(t)}</option>`))
            .join('');

        const kpOpts = ['<option value="">— Select Knowledge Profile —</option>']
            .concat(state.knowledgeProfiles.map(p => {
                const label = p.profile_name ? `${esc(p.profile_name)}` : esc(p.name);
                return `<option value="${esc(p.name)}">${label}</option>`;
            }))
            .join('');

        $wrap.html(state.mappings.map((row, idx) => {
            const typeClass = typeColorClass(row.identity_type);
            return `
<div class="nipm-mapping-row" data-idx="${idx}">
    <div class="nipm-mapping-row-inner">
        <div class="nipm-mapping-field">
            <label style="font-size:11px; font-weight:900; color:#6b7c9b; text-transform:uppercase;">Identity Type</label>
            <select class="form-control form-control-sm nipm-row-type" data-idx="${idx}">
                ${typeOpts}
            </select>
        </div>
        <div class="nipm-mapping-arrow">→</div>
        <div class="nipm-mapping-field" style="flex:2;">
            <label style="font-size:11px; font-weight:900; color:#6b7c9b; text-transform:uppercase;">Knowledge Profile</label>
            <select class="form-control form-control-sm nipm-row-kp" data-idx="${idx}">
                ${kpOpts}
            </select>
        </div>
        <button class="btn btn-xs btn-danger nipm-remove-row" data-idx="${idx}" style="margin-top:18px; flex-shrink:0;">✕</button>
    </div>
    <div class="nipm-mapping-preview" id="nipm_prev_${idx}"></div>
</div>`;
        }).join(''));

        // Set values and preview after rendering
        state.mappings.forEach((row, idx) => {
            $(`.nipm-mapping-row[data-idx="${idx}"] .nipm-row-type`).val(row.identity_type || '');
            $(`.nipm-mapping-row[data-idx="${idx}"] .nipm-row-kp`).val(row.knowledge_profile || '');
            updateRowCard(idx, row.identity_type, row.knowledge_profile);
        });
    }

    function updateRowCard(idx, identityType, knowledgeProfile) {
        const $prev = $(`#nipm_prev_${idx}`);
        if (!identityType && !knowledgeProfile) {
            $prev.empty();
            return;
        }

        const kp = state.knowledgeProfiles.find(p => p.name === knowledgeProfile);
        const kpLabel = kp ? (kp.profile_name || kp.name) : (knowledgeProfile || '—');
        const typeClass = typeColorClass(identityType);

        $prev.html(`
            <div class="nipm-row-preview">
                ${identityType
                    ? `<span class="nipm-id-pill nipm-id-${esc(identityType.toLowerCase())}">${esc(identityType)}</span>`
                    : '<span class="nipm-muted">No type</span>'
                }
                <span class="nipm-prev-arrow">→</span>
                ${knowledgeProfile
                    ? `<span class="nipm-kp-pill">${esc(kpLabel)}</span>`
                    : '<span class="nipm-muted">No knowledge profile</span>'
                }
            </div>`);
    }

    function typeColorClass(type) {
        const map = {
            'public': 'nipm-id-public', 'customer': 'nipm-id-customer',
            'prospect': 'nipm-id-prospect', 'partner': 'nipm-id-partner',
            'internal': 'nipm-id-internal', 'admin': 'nipm-id-admin',
        };
        return map[(type || '').toLowerCase()] || '';
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    function esc(v) { return frappe.utils.escape_html(v == null ? '' : String(v)); }

    // ── CSS ────────────────────────────────────────────────────────────────────

    function inject_css() {
        if ($('#nipm_css').length) return;
        $('head').append(`<style id="nipm_css">

.nipm-wrap { padding:14px; }

/* Hero */
.nipm-hero { display:flex; justify-content:space-between; align-items:flex-start; gap:20px;
    border-radius:22px; padding:28px 32px; margin-bottom:18px;
    background:radial-gradient(circle at 8% 20%,rgba(77,163,255,.24),transparent 30%),
               radial-gradient(circle at 92% 10%,rgba(224,166,47,.18),transparent 28%),
               linear-gradient(135deg,#fff 0%,#eef6ff 48%,#f8fbff 100%);
    border:1px solid rgba(77,163,255,.32); box-shadow:0 14px 36px rgba(33,77,187,.1); }
.nipm-badge { display:inline-flex; padding:6px 12px; border-radius:999px;
    background:rgba(33,77,187,.08); border:1px solid rgba(33,77,187,.16);
    color:#214dbb; font-weight:800; font-size:11px; letter-spacing:.04em;
    text-transform:uppercase; margin-bottom:10px; }
.nipm-hero-title { margin:0; font-size:26px; font-weight:900; color:#102b67; letter-spacing:-.03em; }
.nipm-hero-desc { margin:10px 0 0; font-size:14px; line-height:1.65; color:#27416f;
    font-weight:500; max-width:680px; }
.nipm-flow-pill { display:inline-block; margin-top:12px; padding:7px 14px; border-radius:999px;
    background:rgba(33,77,187,.08); border:1px solid rgba(33,77,187,.18); color:#214dbb;
    font-size:11px; font-weight:800; font-family:monospace; }
.nipm-hero-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; flex-shrink:0; }
.nipm-hero-actions .btn { border-radius:999px; font-weight:850; }

/* Layout */
.nipm-layout { display:grid; grid-template-columns:260px minmax(0,1fr); gap:16px; align-items:start; }
.nipm-card { border:1px solid rgba(77,163,255,.25); border-radius:18px; background:#fff;
    padding:18px; box-shadow:0 8px 24px rgba(33,77,187,.07); }

/* List panel */
.nipm-list-panel { position:sticky; top:64px; }
.nipm-tenant-wrap { margin-bottom:12px; }
.nipm-tenant-label { font-size:11px; font-weight:900; color:#6b7c9b;
    text-transform:uppercase; letter-spacing:.05em; display:block; margin-bottom:4px; }
.nipm-tenant-select { border-radius:8px; }
.nipm-profile-list { display:flex; flex-direction:column; gap:8px; max-height:520px; overflow-y:auto; }
.nipm-profile-item { border:1px solid #e8eef7; border-radius:12px; padding:12px 14px;
    cursor:pointer; transition:border-color .15s, background .15s; }
.nipm-profile-item:hover { border-color:rgba(33,77,187,.4); background:#f5f8ff; }
.nipm-item-active { border-color:#214dbb !important; background:#eef6ff !important; }
.nipm-item-name { font-weight:900; color:#173b8c; font-size:13px; font-family:monospace; }
.nipm-item-count { font-size:11px; color:#6b7c9b; font-weight:700; margin-top:6px; }
.nipm-warn { color:#d97706 !important; }
.nipm-empty { color:#8a9bb8; padding:16px; text-align:center; font-size:13px;
    font-weight:600; line-height:1.6; }

/* Status pills */
.nipm-status-pill { display:inline-flex; padding:3px 9px; border-radius:999px;
    font-size:10px; font-weight:900; white-space:nowrap; }
.nipm-pill-on  { background:#ecfdf3; color:#16794c; border:1px solid #bdebd2; }
.nipm-pill-off { background:#f3f4f6; color:#6b7280; border:1px solid #d1d5db; }

/* Form panel */
.nipm-form-panel { display:flex; flex-direction:column; gap:0; }
.nipm-form-header { display:flex; justify-content:space-between; align-items:flex-start;
    gap:12px; padding-bottom:16px; border-bottom:2px solid rgba(33,77,187,.1);
    margin-bottom:16px; }
.nipm-form-title { font-size:20px; font-weight:900; color:#102b67; margin-top:4px;
    font-family:monospace; }
.nipm-section-label { font-size:10px; font-weight:900; color:#8a9bb8;
    text-transform:uppercase; letter-spacing:.05em; }

/* Field sections */
.nipm-field-section { padding:16px 0; border-top:1px solid rgba(77,163,255,.15); }
.nipm-field-section:first-of-type { border-top:none; padding-top:0; }
.nipm-section-badge { display:inline-flex; padding:4px 12px; border-radius:999px;
    background:rgba(33,77,187,.07); border:1px solid rgba(33,77,187,.15);
    color:#214dbb; font-size:10px; font-weight:900; letter-spacing:.05em;
    text-transform:uppercase; margin-bottom:12px; }
.nipm-two { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-bottom:14px; }
.nipm-field { display:flex; flex-direction:column; gap:5px; }
.nipm-field label { font-size:12px; font-weight:850; color:#173b8c; }
.nipm-hint { font-size:11px; color:#8a9bb8; line-height:1.4; }
.nipm-req { color:#b42318; }
.nipm-muted { color:#6b7c9b; font-size:12px; font-weight:600; }
.nipm-check-field { justify-content:center; }
.nipm-check-label { display:flex; align-items:center; gap:7px; cursor:pointer;
    font-size:13px; font-weight:800; color:#173b8c; }

/* Mappings section */
.nipm-mappings-section { border-top:2px solid rgba(33,77,187,.15) !important; }
.nipm-mappings-header { display:flex; justify-content:space-between;
    align-items:flex-start; gap:12px; margin-bottom:14px; }
.nipm-mappings-desc { margin:6px 0 0; font-size:12px; color:#27416f;
    line-height:1.6; font-weight:500; max-width:600px; }
.nipm-empty-mappings { padding:20px; text-align:center; border-radius:12px;
    background:#f8fbff; border:1px dashed rgba(33,77,187,.25);
    color:#6b7c9b; font-size:13px; font-weight:600; line-height:1.6; }

/* Mapping rows */
.nipm-mapping-row { border:1px solid rgba(77,163,255,.22); border-radius:14px;
    background:#f8fbff; padding:14px 16px; margin-bottom:10px; }
.nipm-mapping-row:last-child { margin-bottom:0; }
.nipm-mapping-row-inner { display:flex; align-items:flex-end; gap:10px; flex-wrap:wrap; }
.nipm-mapping-field { display:flex; flex-direction:column; gap:5px; flex:1; min-width:140px; }
.nipm-mapping-arrow { font-size:20px; font-weight:900; color:#214dbb;
    padding-bottom:6px; flex-shrink:0; }

/* Row preview */
.nipm-row-preview { display:flex; align-items:center; gap:8px;
    margin-top:10px; padding-top:10px; border-top:1px solid rgba(77,163,255,.15); flex-wrap:wrap; }
.nipm-prev-arrow { font-size:14px; color:#214dbb; font-weight:900; }
.nipm-kp-pill { display:inline-flex; padding:4px 12px; border-radius:999px;
    font-size:11px; font-weight:900; background:#fff7e6; color:#8a5d00;
    border:1px solid #f2d49b; cursor:pointer; }
.nipm-kp-pill:hover { background:#fef3c7; border-color:#f59e0b; }

/* Identity type pills */
.nipm-id-pill { display:inline-flex; padding:4px 12px; border-radius:999px;
    font-size:11px; font-weight:900;
    background:#eef6ff; color:#173b8c; border:1px solid rgba(33,77,187,.22); }
.nipm-id-public   { background:#f0fdf4; color:#15803d; border-color:#bbf7d0; }
.nipm-id-customer { background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; }
.nipm-id-prospect { background:#fefce8; color:#a16207; border-color:#fde68a; }
.nipm-id-partner  { background:#fdf4ff; color:#7e22ce; border-color:#e9d5ff; }
.nipm-id-internal { background:#fff7ed; color:#c2410c; border-color:#fed7aa; }
.nipm-id-admin    { background:#fff0f0; color:#b42318; border-color:#ffd1d1; }
.nipm-id-registered { background:#f0f9ff; color:#0369a1; border-color:#bae6fd; }

@media (max-width:900px) {
    .nipm-layout { grid-template-columns:1fr; }
    .nipm-list-panel { position:static; }
    .nipm-two { grid-template-columns:1fr; }
    .nipm-hero { flex-direction:column; }
    .nipm-mapping-row-inner { flex-direction:column; }
    .nipm-mapping-arrow { padding-bottom:0; align-self:center; }
}
        </style>`);
    }
};

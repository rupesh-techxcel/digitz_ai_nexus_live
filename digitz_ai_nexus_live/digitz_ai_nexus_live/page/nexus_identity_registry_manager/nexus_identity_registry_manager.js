frappe.pages['nexus-identity-registry-manager'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus Identity Registry Manager',
        single_column: true,
    });

    const state = {
        registries: [],
        availableProfiles: [],   // {name, profile_name, title, description, identity_types[]}
        selected: null,          // registry name
        assignedProfiles: [],    // [{identity_profile, is_primary, valid_from, valid_until}]
    };

    inject_css();
    $(page.body).html(buildShell());
    bindEvents();
    loadData();

    // ── Shell ──────────────────────────────────────────────────────────────────

    function buildShell() {
        return `
<div class="nir-wrap">

    <!-- Hero -->
    <div class="nir-hero">
        <div>
            <div class="nir-hero-badge">Identity Registry Manager</div>
            <h2 class="nir-hero-title">Identity Registry</h2>
            <p class="nir-hero-desc">
                Register a person and assign the <b>Identity Profiles</b> that govern their
                knowledge access. Each profile maps the person's identity type to the
                Knowledge Profiles they can reach during chat.
            </p>
        </div>
        <div class="nir-hero-actions">
            <button class="btn btn-default btn-sm" data-list="Nexus Identity Registry">Open List</button>
            <button class="btn btn-default btn-sm" id="nir_manage_profiles">Manage Profiles →</button>
            <button class="btn btn-primary" id="nir_new">+ New Registry</button>
        </div>
    </div>

    <!-- Layout -->
    <div class="nir-layout">

        <!-- Left: registry list -->
        <div class="nir-card nir-list-panel">
            <div class="nir-list-search">
                <input class="form-control form-control-sm" id="nir_search" placeholder="Search by email…">
                <button class="btn btn-default btn-sm" id="nir_search_btn">Search</button>
            </div>
            <div id="nir_registry_list" class="nir-registry-list"></div>
        </div>

        <!-- Right: form -->
        <div id="nir_form_panel" class="nir-card nir-form-panel">

            <!-- Form header -->
            <div class="nir-form-header">
                <div>
                    <div class="nir-section-label">Registry Record</div>
                    <div class="nir-form-title" id="nir_form_title">New Registry</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <button class="btn btn-default btn-sm" id="nir_open_doc" style="display:none;">Open Doc ↗</button>
                    <button class="btn btn-primary" id="nir_save">Save Registry</button>
                </div>
            </div>

            <!-- Core identity fields -->
            <div class="nir-field-section">
                <div class="nir-section-badge">Person</div>
                <div class="nir-two">
                    <div class="nir-field">
                        <label>Email <span class="nir-req">*</span></label>
                        <input class="form-control" id="nir_email" placeholder="person@example.com">
                    </div>
                    <div class="nir-field">
                        <label>Full Name</label>
                        <input class="form-control" id="nir_full_name" placeholder="Display name">
                    </div>
                </div>
                <div class="nir-two">
                    <div class="nir-field">
                        <label>Verification Status</label>
                        <select class="form-control" id="nir_verification_status">
                            <option value="Unverified">Unverified</option>
                            <option value="Verified">Verified</option>
                            <option value="Blocked">Blocked</option>
                        </select>
                    </div>
                    <div class="nir-field nir-check-field">
                        <label class="nir-check-label">
                            <input type="checkbox" id="nir_enabled" checked>
                            <span>Enabled</span>
                        </label>
                        <div class="nir-field-hint">Disabled registries are ignored during chat routing.</div>
                    </div>
                </div>
                <div class="nir-field">
                    <label>Frappe User</label>
                    <input class="form-control" id="nir_user" placeholder="Frappe username — for desk users only">
                    <div class="nir-field-hint">Link to a Frappe desk account when the person is also an internal user.</div>
                </div>
            </div>

            <!-- Reference / contact (secondary) -->
            <div class="nir-field-section nir-section-secondary">
                <div class="nir-section-toggle" id="nir_ref_toggle">
                    <span class="nir-section-badge">Reference &amp; Contact</span>
                    <span class="nir-toggle-icon" id="nir_ref_icon">▸</span>
                </div>
                <div id="nir_ref_body" style="display:none;">
                    <div class="nir-two" style="margin-top:12px;">
                        <div class="nir-field">
                            <label>Reference DocType</label>
                            <input class="form-control" id="nir_reference_doctype" placeholder="e.g. Contact, Lead, Member">
                        </div>
                        <div class="nir-field">
                            <label>Reference Name</label>
                            <input class="form-control" id="nir_reference_name">
                        </div>
                    </div>
                    <div class="nir-two">
                        <div class="nir-field">
                            <label>Reference Label</label>
                            <input class="form-control" id="nir_reference_label">
                        </div>
                        <div class="nir-field">
                            <label>Contact</label>
                            <input class="form-control" id="nir_contact">
                        </div>
                    </div>
                    <div class="nir-field">
                        <label>Mobile No</label>
                        <input class="form-control" id="nir_mobile_no">
                    </div>
                </div>
            </div>

            <!-- Notes -->
            <div class="nir-field-section">
                <div class="nir-section-badge">Notes</div>
                <textarea class="form-control" id="nir_notes" rows="2" placeholder="Internal admin notes about this person…"></textarea>
            </div>

            <!-- Identity Profiles section -->
            <div class="nir-field-section nir-profiles-section">
                <div class="nir-profiles-header">
                    <div>
                        <div class="nir-section-badge">Identity Profiles</div>
                        <p class="nir-profiles-desc">
                            Assign one or more <b>Nexus Identity Profile</b> records to this person.
                            Each profile controls which Knowledge Profiles they can access
                            based on their resolved identity type during chat.
                            Mark one as <b>Primary</b> when multiple profiles are assigned.
                        </p>
                    </div>
                    <button class="btn btn-default btn-sm" id="nir_add_profile">+ Assign Profile</button>
                </div>
                <div id="nir_profile_tiles"></div>
            </div>

        </div>
    </div>

    <!-- Profile picker modal -->
    <div id="nir_picker_overlay" class="nir-overlay" style="display:none;">
        <div class="nir-picker-modal">
            <div class="nir-picker-header">
                <div>
                    <div style="font-size:17px; font-weight:900; color:#102b67;">Assign Identity Profile</div>
                    <div class="nir-muted" style="margin-top:3px;">Select the profile that governs this person's knowledge access.</div>
                </div>
                <button class="btn btn-xs btn-default" id="nir_picker_close">✕</button>
            </div>
            <input class="form-control" id="nir_picker_search" placeholder="Filter profiles…" style="margin-bottom:14px;">
            <div id="nir_picker_grid" class="nir-picker-grid"></div>
        </div>
    </div>

</div>`;
    }

    // ── Events ─────────────────────────────────────────────────────────────────

    function bindEvents() {
        $(page.body).on('click', '[data-list]', function () {
            frappe.set_route('List', $(this).data('list'));
        });
        $(page.body).on('click', '#nir_manage_profiles', () => frappe.set_route('nexus-identity-profile-manager'));
        $(page.body).on('click', '#nir_new', newRegistry);
        $(page.body).on('click', '#nir_search_btn', () => loadData($('#nir_search').val()));
        $(page.body).on('keydown', '#nir_search', function (e) { if (e.key === 'Enter') loadData($(this).val()); });
        $(page.body).on('click', '#nir_save', saveRegistry);
        $(page.body).on('click', '#nir_open_doc', () => {
            if (state.selected) frappe.set_route('Form', 'Nexus Identity Registry', state.selected);
        });
        $(page.body).on('click', '.nir-registry-item', function () {
            loadRegistry($(this).data('name'));
        });

        // Reference section toggle
        $(page.body).on('click', '#nir_ref_toggle', function () {
            const open = $('#nir_ref_body').is(':visible');
            $('#nir_ref_body').toggle(!open);
            $('#nir_ref_icon').text(open ? '▸' : '▾');
        });

        // Profile picker
        $(page.body).on('click', '#nir_add_profile', openPicker);
        $(page.body).on('click', '#nir_picker_close', closePicker);
        $(page.body).on('click', '#nir_picker_overlay', function (e) {
            if ($(e.target).is('#nir_picker_overlay')) closePicker();
        });
        $(page.body).on('input', '#nir_picker_search', function () {
            renderPickerGrid($(this).val().toLowerCase());
        });

        // Profile tile actions (delegated)
        $(page.body).on('click', '.nir-tile-remove', function () {
            const idx = Number($(this).closest('.nir-profile-tile').data('idx'));
            state.assignedProfiles.splice(idx, 1);
            renderProfileTiles();
        });
        $(page.body).on('change', '.nir-tile-primary', function () {
            const idx = Number($(this).closest('.nir-profile-tile').data('idx'));
            state.assignedProfiles.forEach((r, i) => { r.is_primary = (i === idx) ? 1 : 0; });
            renderProfileTiles();
        });
        $(page.body).on('change', '.nir-tile-date', function () {
            const $el = $(this);
            const idx = Number($el.closest('.nir-profile-tile').data('idx'));
            const field = $el.data('field');
            state.assignedProfiles[idx][field] = $el.val();
        });
    }

    // ── Data loading ───────────────────────────────────────────────────────────

    function loadData(search) {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_identity_registry.get_page_data',
            args: { search },
            callback(r) {
                if (!r.message) return;
                state.registries = r.message.registries || [];
                state.availableProfiles = r.message.identity_profiles || [];
                renderRegistryList();
                if (!state.selected) newRegistry();
            },
        });
    }

    function loadRegistry(name) {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_identity_registry.get_registry',
            args: { name },
            callback(r) {
                if (!r.message) return;
                fillForm(r.message.registry);
                state.assignedProfiles = (r.message.identity_profiles || []).map(row => ({
                    identity_profile: row.identity_profile,
                    is_primary: row.is_primary,
                    valid_from: row.valid_from || '',
                    valid_until: row.valid_until || '',
                }));
                renderProfileTiles();
            },
        });
    }

    function saveRegistry() {
        const registry = collectForm();
        if (!registry.email) {
            frappe.show_alert({ message: 'Email is required.', indicator: 'red' });
            $('#nir_email').focus();
            return;
        }

        $('#nir_save').prop('disabled', true).text('Saving…');
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_identity_registry.save_registry',
            args: {
                registry: JSON.stringify(registry),
                identity_profiles: JSON.stringify(state.assignedProfiles),
            },
            callback(r) {
                $('#nir_save').prop('disabled', false).text('Save Registry');
                if (!r.message) return;
                frappe.show_alert({ message: 'Registry saved.', indicator: 'green' });
                state.selected = r.message.name;
                loadData($('#nir_search').val());
                loadRegistry(r.message.name);
            },
            error() {
                $('#nir_save').prop('disabled', false).text('Save Registry');
            },
        });
    }

    // ── Registry list ──────────────────────────────────────────────────────────

    function renderRegistryList() {
        const $list = $('#nir_registry_list');
        if (!state.registries.length) {
            $list.html('<div class="nir-empty">No registries found.</div>');
            return;
        }

        const statusClass = { Verified: 'nir-pill-verified', Unverified: 'nir-pill-unverified', Blocked: 'nir-pill-blocked' };

        $list.html(state.registries.map(r => `
            <div class="nir-registry-item ${r.name === state.selected ? 'nir-registry-item-active' : ''}" data-name="${esc(r.name)}">
                <div class="nir-registry-email">${esc(r.email)}</div>
                ${r.full_name ? `<div class="nir-muted">${esc(r.full_name)}</div>` : ''}
                <div class="nir-registry-pills">
                    <span class="nir-pill ${statusClass[r.verification_status] || ''}">${esc(r.verification_status || 'Unverified')}</span>
                    ${!r.enabled ? '<span class="nir-pill nir-pill-off">Disabled</span>' : ''}
                </div>
            </div>
        `).join(''));
    }

    // ── Form fill / collect ────────────────────────────────────────────────────

    function newRegistry() {
        state.selected = null;
        state.assignedProfiles = [];
        fillForm({ enabled: 1, verification_status: 'Unverified' });
        renderProfileTiles();
        renderRegistryList();
    }

    function fillForm(registry) {
        state.selected = registry.name || null;
        $('#nir_form_title').text(state.selected ? (registry.email || registry.name) : 'New Registry');
        $('#nir_open_doc').toggle(Boolean(state.selected));
        $('#nir_email').val(registry.email || '');
        $('#nir_full_name').val(registry.full_name || '');
        $('#nir_user').val(registry.user || '');
        $('#nir_reference_doctype').val(registry.reference_doctype || '');
        $('#nir_reference_name').val(registry.reference_name || '');
        $('#nir_reference_label').val(registry.reference_label || '');
        $('#nir_contact').val(registry.contact || '');
        $('#nir_mobile_no').val(registry.mobile_no || '');
        $('#nir_enabled').prop('checked', Number(registry.enabled) === 1);
        $('#nir_verification_status').val(registry.verification_status || 'Unverified');
        $('#nir_notes').val(registry.notes || '');
        renderRegistryList();
    }

    function collectForm() {
        return {
            name: state.selected,
            email: $('#nir_email').val().trim().toLowerCase(),
            full_name: $('#nir_full_name').val().trim(),
            user: $('#nir_user').val().trim(),
            reference_doctype: $('#nir_reference_doctype').val().trim(),
            reference_name: $('#nir_reference_name').val().trim(),
            reference_label: $('#nir_reference_label').val().trim(),
            contact: $('#nir_contact').val().trim(),
            mobile_no: $('#nir_mobile_no').val().trim(),
            enabled: $('#nir_enabled').is(':checked') ? 1 : 0,
            verification_status: $('#nir_verification_status').val(),
            notes: $('#nir_notes').val().trim(),
        };
    }

    // ── Profile tiles ──────────────────────────────────────────────────────────

    function renderProfileTiles() {
        const $wrap = $('#nir_profile_tiles');

        if (!state.assignedProfiles.length) {
            $wrap.html(`<div class="nir-profiles-empty">
                No Identity Profiles assigned yet.
                Click <b>+ Assign Profile</b> to add one.
            </div>`);
            return;
        }

        const alreadyAssigned = new Set(state.assignedProfiles.map(r => r.identity_profile));

        $wrap.html(state.assignedProfiles.map((row, idx) => {
            const profile = state.availableProfiles.find(p => p.name === row.identity_profile) || {};
            const types = (profile.identity_types || []);
            const typePills = types.length
                ? types.map(t => `<span class="nir-id-pill nir-id-${esc(t.toLowerCase())}">${esc(t)}</span>`).join('')
                : `<span class="nir-muted" style="font-size:11px;">No identity types configured</span>`;

            return `
<div class="nir-profile-tile ${row.is_primary ? 'nir-tile-primary-active' : ''}" data-idx="${idx}">
    <div class="nir-tile-top">
        <div class="nir-tile-info">
            <div class="nir-tile-name">${esc(profile.profile_name || row.identity_profile || '—')}</div>
            ${profile.title ? `<div class="nir-tile-title">${esc(profile.title)}</div>` : ''}
            ${profile.description ? `<div class="nir-muted" style="margin-top:4px; font-size:11px;">${esc(profile.description)}</div>` : ''}
            <div class="nir-tile-types" style="margin-top:8px;">${typePills}</div>
        </div>
        <div class="nir-tile-actions">
            ${row.is_primary ? '<span class="nir-primary-badge">Primary</span>' : ''}
            <button class="btn btn-xs btn-danger nir-tile-remove">Remove</button>
        </div>
    </div>
    <div class="nir-tile-meta">
        <label class="nir-check-label" style="font-size:12px;">
            <input type="checkbox" class="nir-tile-primary" ${row.is_primary ? 'checked' : ''}>
            <span>Set as Primary</span>
        </label>
        <div class="nir-tile-dates">
            <div class="nir-field" style="flex:1;">
                <label style="font-size:11px;">Valid From</label>
                <input type="date" class="form-control form-control-sm nir-tile-date" data-field="valid_from" value="${esc(row.valid_from || '')}">
            </div>
            <div class="nir-field" style="flex:1;">
                <label style="font-size:11px;">Valid Until</label>
                <input type="date" class="form-control form-control-sm nir-tile-date" data-field="valid_until" value="${esc(row.valid_until || '')}">
            </div>
        </div>
    </div>
</div>`;
        }).join(''));
    }

    // ── Profile picker modal ───────────────────────────────────────────────────

    function openPicker() {
        $('#nir_picker_search').val('');
        renderPickerGrid('');
        $('#nir_picker_overlay').show();
        $('#nir_picker_search').focus();
    }

    function closePicker() {
        $('#nir_picker_overlay').hide();
    }

    function renderPickerGrid(filter) {
        const alreadyAssigned = new Set(state.assignedProfiles.map(r => r.identity_profile));

        const filtered = state.availableProfiles.filter(p =>
            !filter ||
            (p.profile_name || '').toLowerCase().includes(filter) ||
            (p.title || '').toLowerCase().includes(filter) ||
            (p.description || '').toLowerCase().includes(filter)
        );

        if (!filtered.length) {
            $('#nir_picker_grid').html('<div class="nir-empty">No profiles match your search.</div>');
            return;
        }

        $('#nir_picker_grid').html(filtered.map(p => {
            const assigned = alreadyAssigned.has(p.name);
            const types = (p.identity_types || []);
            const typePills = types.length
                ? types.map(t => `<span class="nir-id-pill nir-id-${esc(t.toLowerCase())}">${esc(t)}</span>`).join('')
                : `<span class="nir-muted" style="font-size:11px;">No identity types configured</span>`;

            return `
<div class="nir-picker-card ${assigned ? 'nir-picker-card-assigned' : ''}" data-name="${esc(p.name)}">
    <div class="nir-picker-card-head">
        <div>
            <div class="nir-picker-profile-name">${esc(p.profile_name || p.name)}</div>
            ${p.title ? `<div class="nir-picker-profile-title">${esc(p.title)}</div>` : ''}
        </div>
        ${assigned
            ? '<span class="nir-picker-assigned-badge">Assigned</span>'
            : '<button class="btn btn-primary btn-xs nir-picker-select">+ Assign</button>'
        }
    </div>
    ${p.description ? `<div class="nir-muted" style="margin:6px 0; font-size:11px;">${esc(p.description)}</div>` : ''}
    <div class="nir-tile-types" style="margin-top:6px;">${typePills}</div>
</div>`;
        }).join(''));

        $('#nir_picker_grid').off('click', '.nir-picker-select').on('click', '.nir-picker-select', function () {
            const name = $(this).closest('.nir-picker-card').data('name');
            assignProfile(name);
        });
    }

    function assignProfile(profileName) {
        const alreadyAssigned = state.assignedProfiles.some(r => r.identity_profile === profileName);
        if (alreadyAssigned) return;

        const isFirst = state.assignedProfiles.length === 0;
        state.assignedProfiles.push({
            identity_profile: profileName,
            is_primary: isFirst ? 1 : 0,
            valid_from: '',
            valid_until: '',
        });
        renderProfileTiles();
        // Re-render picker to mark newly assigned
        renderPickerGrid($('#nir_picker_search').val().toLowerCase());
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    function esc(value) {
        return frappe.utils.escape_html(value == null ? '' : String(value));
    }

    // ── CSS ────────────────────────────────────────────────────────────────────

    function inject_css() {
        if ($('#nir_css').length) return;
        $('head').append(`<style id="nir_css">

/* ── Wrap & hero ──────────────────────────────────────────────────────────── */
.nir-wrap { padding: 14px; }
.nir-hero { display:flex; justify-content:space-between; align-items:flex-start; gap:20px;
    border-radius:22px; padding:28px 32px; margin-bottom:18px;
    background:radial-gradient(circle at 8% 20%,rgba(77,163,255,.24),transparent 30%),
               radial-gradient(circle at 92% 10%,rgba(224,166,47,.18),transparent 28%),
               linear-gradient(135deg,#fff 0%,#eef6ff 48%,#f8fbff 100%);
    border:1px solid rgba(77,163,255,.32); box-shadow:0 14px 36px rgba(33,77,187,.1); }
.nir-hero-badge { display:inline-flex; padding:6px 12px; border-radius:999px;
    background:rgba(33,77,187,.08); border:1px solid rgba(33,77,187,.16);
    color:#214dbb; font-weight:800; font-size:11px; letter-spacing:.04em;
    text-transform:uppercase; margin-bottom:10px; }
.nir-hero-title { margin:0; font-size:26px; font-weight:900; color:#102b67; letter-spacing:-.03em; }
.nir-hero-desc { margin:10px 0 0; font-size:14px; line-height:1.65; color:#27416f; font-weight:500; max-width:700px; }
.nir-hero-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; flex-shrink:0; }
.nir-hero-actions .btn { border-radius:999px; font-weight:850; }

/* ── Layout ───────────────────────────────────────────────────────────────── */
.nir-layout { display:grid; grid-template-columns: 280px minmax(0,1fr); gap:16px; align-items:start; }
.nir-card { border:1px solid rgba(77,163,255,.25); border-radius:18px; background:#fff;
    padding:18px; box-shadow:0 8px 24px rgba(33,77,187,.07); }

/* ── Registry list panel ──────────────────────────────────────────────────── */
.nir-list-panel { position:sticky; top:64px; }
.nir-list-search { display:flex; gap:8px; margin-bottom:14px; }
.nir-registry-list { display:flex; flex-direction:column; gap:8px; max-height:540px; overflow-y:auto; }
.nir-registry-item { border:1px solid #e8eef7; border-radius:12px; padding:12px 14px;
    cursor:pointer; transition:border-color .15s, background .15s; }
.nir-registry-item:hover { border-color:rgba(33,77,187,.4); background:#f5f8ff; }
.nir-registry-item-active { border-color:#214dbb !important; background:#eef6ff !important; }
.nir-registry-email { font-weight:800; color:#173b8c; font-size:13px; }
.nir-registry-pills { display:flex; gap:6px; margin-top:7px; flex-wrap:wrap; }
.nir-empty { color:#8a9bb8; padding:16px; text-align:center; font-size:13px; font-weight:600; }

/* ── Pills ────────────────────────────────────────────────────────────────── */
.nir-pill { display:inline-flex; padding:3px 9px; border-radius:999px;
    font-size:10px; font-weight:900; white-space:nowrap; }
.nir-pill-verified  { background:#ecfdf3; color:#16794c; border:1px solid #bdebd2; }
.nir-pill-unverified{ background:#fefce8; color:#a16207; border:1px solid #fde68a; }
.nir-pill-blocked   { background:#fff0f0; color:#b42318; border:1px solid #ffd1d1; }
.nir-pill-off       { background:#f3f4f6; color:#6b7280; border:1px solid #d1d5db; }

/* ── Identity type pills ──────────────────────────────────────────────────── */
.nir-id-pill { display:inline-flex; padding:3px 9px; border-radius:999px; font-size:10px; font-weight:900;
    background:#eef6ff; color:#173b8c; border:1px solid rgba(33,77,187,.22); }
.nir-id-public   { background:#f0fdf4; color:#15803d; border-color:#bbf7d0; }
.nir-id-customer { background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; }
.nir-id-prospect { background:#fefce8; color:#a16207; border-color:#fde68a; }
.nir-id-partner  { background:#fdf4ff; color:#7e22ce; border-color:#e9d5ff; }
.nir-id-internal { background:#fff7ed; color:#c2410c; border-color:#fed7aa; }
.nir-id-admin    { background:#fff0f0; color:#b42318; border-color:#ffd1d1; }
.nir-id-registered { background:#f0f9ff; color:#0369a1; border-color:#bae6fd; }

/* ── Form panel ───────────────────────────────────────────────────────────── */
.nir-form-panel { display:flex; flex-direction:column; gap:18px; }
.nir-form-header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px;
    padding-bottom:14px; border-bottom:2px solid rgba(33,77,187,.1); }
.nir-form-title { font-size:20px; font-weight:900; color:#102b67; margin-top:4px; }

/* ── Field sections ───────────────────────────────────────────────────────── */
.nir-field-section { padding:16px 0; border-top:1px solid rgba(77,163,255,.15); }
.nir-field-section:first-of-type { border-top:none; padding-top:0; }
.nir-section-badge { display:inline-flex; padding:4px 12px; border-radius:999px;
    background:rgba(33,77,187,.07); border:1px solid rgba(33,77,187,.15);
    color:#214dbb; font-size:10px; font-weight:900; letter-spacing:.05em;
    text-transform:uppercase; margin-bottom:12px; }
.nir-section-label { font-size:10px; font-weight:900; color:#8a9bb8;
    text-transform:uppercase; letter-spacing:.05em; }

.nir-section-secondary .nir-section-toggle { display:flex; align-items:center;
    gap:10px; cursor:pointer; user-select:none; }
.nir-toggle-icon { color:#214dbb; font-size:12px; }

.nir-two { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
.nir-field { display:flex; flex-direction:column; gap:5px; }
.nir-field label { font-size:12px; font-weight:850; color:#173b8c; }
.nir-field-hint { font-size:11px; color:#8a9bb8; line-height:1.4; margin-top:2px; }
.nir-req { color:#b42318; }

.nir-check-field { justify-content:center; }
.nir-check-label { display:flex; align-items:center; gap:7px; cursor:pointer; font-size:13px;
    font-weight:800; color:#173b8c; }
.nir-muted { color:#6b7c9b; font-size:12px; font-weight:600; }

/* ── Identity profiles section ────────────────────────────────────────────── */
.nir-profiles-section { border-top:2px solid rgba(33,77,187,.15) !important; }
.nir-profiles-header { display:flex; justify-content:space-between; align-items:flex-start;
    gap:12px; margin-bottom:16px; }
.nir-profiles-desc { margin:6px 0 0; font-size:12px; color:#27416f; line-height:1.6;
    font-weight:500; max-width:680px; }
.nir-profiles-empty { padding:20px; text-align:center; border-radius:12px;
    background:#f8fbff; border:1px dashed rgba(33,77,187,.25);
    color:#6b7c9b; font-size:13px; font-weight:600; line-height:1.6; }

/* ── Profile tile ─────────────────────────────────────────────────────────── */
.nir-profile-tile { border:1px solid rgba(77,163,255,.28); border-radius:14px;
    background:#f8fbff; padding:16px 18px; margin-bottom:12px;
    transition:border-color .15s; }
.nir-profile-tile:last-child { margin-bottom:0; }
.nir-tile-primary-active { border-color:#214dbb; background:#eef6ff; }
.nir-tile-top { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
.nir-tile-info { flex:1; min-width:0; }
.nir-tile-name { font-size:15px; font-weight:900; color:#102b67; }
.nir-tile-title { font-size:12px; color:#53688f; font-weight:700; margin-top:2px; }
.nir-tile-types { display:flex; flex-wrap:wrap; gap:5px; }
.nir-tile-actions { display:flex; gap:8px; align-items:center; flex-shrink:0; }
.nir-primary-badge { display:inline-flex; padding:4px 10px; border-radius:999px;
    background:#214dbb; color:#fff; font-size:10px; font-weight:900; }
.nir-tile-meta { display:flex; align-items:center; gap:18px; margin-top:14px;
    padding-top:12px; border-top:1px solid rgba(77,163,255,.18); flex-wrap:wrap; }
.nir-tile-dates { display:flex; gap:12px; flex:1; min-width:200px; }

/* ── Profile picker modal ─────────────────────────────────────────────────── */
.nir-overlay { position:fixed; inset:0; background:rgba(0,0,0,.42); z-index:9999;
    display:flex; align-items:center; justify-content:center; }
.nir-picker-modal { background:#fff; border-radius:20px; width:680px; max-width:95vw;
    max-height:85vh; display:flex; flex-direction:column;
    box-shadow:0 24px 60px rgba(0,0,0,.22); padding:24px; overflow:hidden; }
.nir-picker-header { display:flex; justify-content:space-between; align-items:flex-start;
    gap:12px; margin-bottom:16px; }
.nir-picker-grid { display:flex; flex-direction:column; gap:10px; overflow-y:auto; flex:1; }
.nir-picker-card { border:1px solid rgba(77,163,255,.25); border-radius:12px;
    background:#f8fbff; padding:14px 16px; transition:border-color .15s; }
.nir-picker-card:hover { border-color:rgba(33,77,187,.45); }
.nir-picker-card-assigned { border-color:rgba(33,77,187,.35); background:#eef6ff; }
.nir-picker-card-head { display:flex; justify-content:space-between;
    align-items:flex-start; gap:12px; }
.nir-picker-profile-name { font-size:14px; font-weight:900; color:#102b67; }
.nir-picker-profile-title { font-size:12px; color:#53688f; font-weight:700; margin-top:2px; }
.nir-picker-assigned-badge { display:inline-flex; padding:4px 10px; border-radius:999px;
    background:#eef6ff; color:#214dbb; font-size:10px; font-weight:900;
    border:1px solid rgba(33,77,187,.3); white-space:nowrap; }

@media (max-width: 900px) {
    .nir-layout { grid-template-columns:1fr; }
    .nir-list-panel { position:static; }
    .nir-two { grid-template-columns:1fr; }
    .nir-hero { flex-direction:column; }
    .nir-tile-dates { flex-direction:column; }
}
        </style>`);
    }
};

frappe.pages['nexus-identity-registry-manager'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus Identity Registry Manager',
        single_column: true,
    });

    const state = {
        registries: [],
        identityTypes: [],
        selected: null,
        identities: [],
    };

    inject_css();
    $(page.body).html(buildHTML());
    bindEvents();
    loadData();

    function buildHTML() {
        return `
<div class="nir-wrap">
    <div class="nir-toolbar">
        <div>
            <div class="nir-title">Identity Registry Manager</div>
            <div class="nir-muted">Register the real person behind a chat and assign one or more identity types.</div>
        </div>
        <div class="nir-actions">
            <button class="btn btn-default" data-list="Nexus Identity Registry">Open List</button>
            <button class="btn btn-primary" id="nir_new">New Registry</button>
        </div>
    </div>

    <div class="nir-grid">
        <div class="nir-panel">
            <div class="nir-panel-head">
                <input class="form-control" id="nir_search" placeholder="Search email">
                <button class="btn btn-default" id="nir_search_btn">Search</button>
            </div>
            <div id="nir_registry_list" class="nir-list"></div>
        </div>

        <div class="nir-panel">
            <div class="nir-panel-head">
                <div class="nir-panel-title" id="nir_form_title">New Registry</div>
                <div>
                    <button class="btn btn-default" id="nir_open_doc" style="display:none;">Open Doc</button>
                    <button class="btn btn-primary" id="nir_save">Save</button>
                </div>
            </div>

            <div class="nir-form">
                <div class="nir-two">
                    <div><label>Email</label><input class="form-control" id="nir_email"></div>
                    <div><label>Full Name</label><input class="form-control" id="nir_full_name"></div>
                </div>
                <div class="nir-two">
                    <div><label>User</label><input class="form-control" id="nir_user"></div>
                    <div><label>Reference DocType</label><input class="form-control" id="nir_reference_doctype" placeholder="e.g. Contact, Lead, Member"></div>
                </div>
                <div class="nir-two">
                    <div><label>Reference Name</label><input class="form-control" id="nir_reference_name"></div>
                    <div><label>Reference Label</label><input class="form-control" id="nir_reference_label"></div>
                </div>
                <div class="nir-two">
                    <div><label>Contact</label><input class="form-control" id="nir_contact"></div>
                    <div><label>Mobile No</label><input class="form-control" id="nir_mobile_no"></div>
                </div>
                <div class="nir-two">
                    <div>
                        <label>Verification Status</label>
                        <select class="form-control" id="nir_verification_status">
                            <option>Unverified</option>
                            <option>Verified</option>
                            <option>Blocked</option>
                        </select>
                    </div>
                    <label class="nir-check"><input type="checkbox" id="nir_enabled" checked> Enabled</label>
                </div>
                <div><label>Notes</label><textarea class="form-control" id="nir_notes" rows="2"></textarea></div>
            </div>

            <div class="nir-section-head">
                <div>
                    <div class="nir-panel-title">Registered Identities</div>
                    <div class="nir-muted">Add every identity this person may resolve as. Mark one primary identity for fallback routing.</div>
                </div>
                <button class="btn btn-default" id="nir_add_identity">Add Identity</button>
            </div>
            <div id="nir_identity_rows"></div>
        </div>
    </div>
</div>`;
    }

    function bindEvents() {
        $(page.body).on('click', '[data-list]', function () {
            frappe.set_route('List', $(this).data('list'));
        });
        $(page.body).on('click', '#nir_new', newRegistry);
        $(page.body).on('click', '#nir_search_btn', () => loadData($('#nir_search').val()));
        $(page.body).on('click', '#nir_save', saveRegistry);
        $(page.body).on('click', '#nir_add_identity', () => {
            state.identities.push({ identity_type: '', enabled: 1, is_primary: 0 });
            renderIdentityRows();
        });
        $(page.body).on('click', '#nir_open_doc', () => {
            if (state.selected) frappe.set_route('Form', 'Nexus Identity Registry', state.selected);
        });
        $(page.body).on('click', '.nir-registry-item', function () {
            loadRegistry($(this).data('name'));
        });
        $(page.body).on('click', '.nir-remove-row', function () {
            state.identities.splice(Number($(this).data('idx')), 1);
            renderIdentityRows();
        });
        $(page.body).on('change input', '.nir-identity-input', syncIdentityRows);
    }

    function loadData(search) {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_identity_registry.get_page_data',
            args: { search },
            callback(r) {
                if (!r.message) return;
                state.registries = r.message.registries || [];
                state.identityTypes = r.message.identity_types || [];
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
                state.identities = r.message.identities || [];
                renderIdentityRows();
            },
        });
    }

    function saveRegistry() {
        syncIdentityRows();
        const registry = collectForm();
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_identity_registry.save_registry',
            args: {
                registry: JSON.stringify(registry),
                identities: JSON.stringify(state.identities),
            },
            callback(r) {
                if (!r.message) return;
                frappe.show_alert({ message: 'Identity registry saved', indicator: 'green' });
                state.selected = r.message.name;
                loadData($('#nir_search').val());
                loadRegistry(r.message.name);
            },
        });
    }

    function renderRegistryList() {
        const $list = $('#nir_registry_list');
        if (!state.registries.length) {
            $list.html('<div class="nir-empty">No identity registries found.</div>');
            return;
        }
        $list.html(state.registries.map(r => `
            <div class="nir-registry-item ${r.name === state.selected ? 'active' : ''}" data-name="${esc(r.name)}">
                <div><b>${esc(r.email)}</b></div>
                <div class="nir-muted">${esc(r.full_name || '')}</div>
                <div class="nir-tags">
                    <span>${esc(r.verification_status || 'Unverified')}</span>
                    <span>${r.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
            </div>
        `).join(''));
    }

    function renderIdentityRows() {
        syncIdentityRows(false);
        const noIdentityTypes = !state.identityTypes.length;
        const options = ['<option value=""></option>'].concat(
            state.identityTypes.map(t => `<option value="${esc(t)}">${esc(t)}</option>`)
        ).join('');

        $('#nir_identity_rows').html(state.identities.map((row, idx) => `
            <div class="nir-identity-row" data-idx="${idx}">
                <select class="form-control nir-identity-input" data-field="identity_type" data-idx="${idx}" ${noIdentityTypes ? 'disabled' : ''}>
                    ${options}
                </select>
                <label><input type="checkbox" class="nir-identity-input" data-field="enabled" data-idx="${idx}" ${Number(row.enabled) ? 'checked' : ''}> Enabled</label>
                <label><input type="checkbox" class="nir-identity-input" data-field="is_primary" data-idx="${idx}" ${Number(row.is_primary) ? 'checked' : ''}> Primary</label>
                <button class="btn btn-default nir-remove-row" data-idx="${idx}">Remove</button>
            </div>
        `).join('') || `<div class="nir-empty">${noIdentityTypes ? 'No enabled Identity Types found. Configure Nexus Identity Type first.' : 'No identities assigned yet.'}</div>`);

        state.identities.forEach((row, idx) => {
            $(`.nir-identity-row[data-idx="${idx}"] [data-field="identity_type"]`).val(row.identity_type || '');
        });
    }

    function syncIdentityRows(readDom = true) {
        if (!readDom) return;
        $('.nir-identity-row').each(function () {
            const idx = Number($(this).data('idx'));
            const row = state.identities[idx] || {};
            $(this).find('.nir-identity-input').each(function () {
                const field = $(this).data('field');
                if ($(this).attr('type') === 'checkbox') {
                    row[field] = $(this).is(':checked') ? 1 : 0;
                } else {
                    row[field] = $(this).val();
                }
            });
            state.identities[idx] = row;
        });
    }

    function newRegistry() {
        state.selected = null;
        state.identities = [];
        fillForm({ enabled: 1, verification_status: 'Unverified' });
        renderIdentityRows();
        renderRegistryList();
    }

    function fillForm(registry) {
        state.selected = registry.name || null;
        $('#nir_form_title').text(state.selected ? registry.email : 'New Registry');
        $('#nir_open_doc').toggle(Boolean(state.selected));
        $('#nir_email').val(registry.email || '');
        $('#nir_full_name').val(registry.full_name || '');
        $('#nir_user').val(registry.user || '');
        $('#nir_reference_doctype').val(registry.reference_doctype || '');
        $('#nir_reference_name').val(registry.reference_name || '');
        $('#nir_reference_label').val(registry.reference_label || '');
        $('#nir_contact').val(registry.contact || '');
        $('#nir_mobile_no').val(registry.mobile_no || '');
        $('#nir_enabled').prop('checked', Number(registry.enabled || 0) === 1);
        $('#nir_verification_status').val(registry.verification_status || 'Unverified');
        $('#nir_notes').val(registry.notes || '');
        renderRegistryList();
    }

    function collectForm() {
        return {
            name: state.selected,
            email: $('#nir_email').val(),
            full_name: $('#nir_full_name').val(),
            user: $('#nir_user').val(),
            reference_doctype: $('#nir_reference_doctype').val(),
            reference_name: $('#nir_reference_name').val(),
            reference_label: $('#nir_reference_label').val(),
            contact: $('#nir_contact').val(),
            mobile_no: $('#nir_mobile_no').val(),
            enabled: $('#nir_enabled').is(':checked') ? 1 : 0,
            verification_status: $('#nir_verification_status').val(),
            notes: $('#nir_notes').val(),
        };
    }

    function esc(value) {
        return frappe.utils.escape_html(value == null ? '' : String(value));
    }

    function inject_css() {
        if ($('#nir_css').length) return;
        $('<style id="nir_css">').text(`
            .nir-wrap { padding: 18px; }
            .nir-toolbar, .nir-panel-head, .nir-section-head { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:14px; }
            .nir-title { font-size:22px; font-weight:800; color:#102b67; }
            .nir-muted { color:#667085; font-size:12px; }
            .nir-grid { display:grid; grid-template-columns: 320px minmax(0,1fr); gap:16px; }
            .nir-panel { border:1px solid #d9e2f2; border-radius:8px; background:#fff; padding:14px; }
            .nir-panel-title { font-size:16px; font-weight:800; color:#102b67; }
            .nir-list { display:flex; flex-direction:column; gap:8px; }
            .nir-registry-item { border:1px solid #edf1f7; border-radius:8px; padding:10px; cursor:pointer; }
            .nir-registry-item.active { border-color:#2f63d6; background:#f5f8ff; }
            .nir-tags { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
            .nir-tags span { font-size:11px; border:1px solid #d9e2f2; border-radius:999px; padding:2px 8px; color:#344054; }
            .nir-form { display:flex; flex-direction:column; gap:12px; margin-bottom:18px; }
            .nir-two { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:12px; }
            .nir-check { display:flex; gap:8px; align-items:center; margin-top:28px; }
            .nir-identity-row { display:grid; grid-template-columns: minmax(160px,1fr) 110px 100px 90px; gap:10px; align-items:center; border-top:1px solid #edf1f7; padding:10px 0; }
            .nir-empty { color:#667085; padding:12px; text-align:center; }
            @media (max-width: 900px) { .nir-grid, .nir-two, .nir-identity-row { grid-template-columns:1fr; } }
        `).appendTo('head');
    }
};

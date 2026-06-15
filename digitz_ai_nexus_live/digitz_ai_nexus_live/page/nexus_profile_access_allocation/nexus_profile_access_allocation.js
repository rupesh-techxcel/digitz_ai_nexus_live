frappe.pages['nexus-profile-access-allocation'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Knowledge Access Manager',
        single_column: true,
    });

    const S = {
        tenants:       [],
        tenant:        '',
        profiles:      [],
        categories:    [],
        selected:      null,
        detail:        null,
        pendingAssign: new Set(),
        pendingRemove: new Set(),
        saving:        false,
    };

    inject_kam_css();
    $(page.body).html(shell());
    bind();
    loadTenants();

    // ── Shell ──────────────────────────────────────────────────────────────────

    function shell() {
        return `
<div class="kam-wrap">

  <div class="nexus-admin-hero">
    <div>
      <span class="nexus-admin-badge">Knowledge Access Manager</span>
      <h2>Knowledge Access Manager</h2>
      <p>
        Knowledge sources with a <b>Public</b> access policy are automatically
        available to every visitor — no profile configuration required.
        This page is only for <b>secured knowledge</b>: use it to control which
        Access Categories (and the restricted policies inside them) each
        Knowledge Profile can reach. Identity Profiles then map visitor types
        to those Knowledge Profiles, completing the access chain.
      </p>
      <div class="nexus-admin-flow-pill">
        Identity Profile &nbsp;→&nbsp; <b>Knowledge Profile</b> &nbsp;→&nbsp; Access Category &nbsp;→&nbsp; Policy &nbsp;→&nbsp; Knowledge
      </div>
    </div>
    <div class="nexus-admin-hero-actions">
      <button class="btn btn-primary" id="kam-new-btn">+ New Knowledge Profile</button>
      <button class="btn btn-default" data-list="Knowledge Profile">All Profiles</button>
      <button class="btn btn-default" data-list="Nexus Access Category">Access Categories</button>
      <button class="btn btn-default" data-list="Nexus Access Policy">Access Policies</button>
      <button class="btn btn-default" data-list="Nexus Identity Profile">Identity Profiles</button>
    </div>
  </div>

  <div class="kam-layout">

    <!-- Left: profile list -->
    <div class="nexus-admin-card kam-list-panel">
      <!-- Tenant filter bar -->
      <div class="kam-tenant-filter-bar">
        <label class="kam-tenant-filter-label" for="kam-tenant-select">Tenant</label>
        <select class="kam-tenant-select" id="kam-tenant-select" title="Switch tenant">
        </select>
      </div>
      <div class="kam-list-divider"></div>
      <div class="nexus-admin-card-title">
        Knowledge Profiles
        <span id="kam-profile-count" class="kam-count"></span>
      </div>
      <div id="kam-profile-list"><div class="nexus-empty-state">Loading…</div></div>
    </div>

    <!-- Right: detail -->
    <div class="kam-detail-panel">
      <div id="kam-placeholder" class="nexus-admin-card kam-placeholder">
        <div class="kam-placeholder-icon">←</div>
        <div>Select a Knowledge Profile to manage its Access Categories</div>
      </div>
      <div id="kam-detail" style="display:none;"></div>
    </div>

  </div>
</div>`;
    }

    // ── Load ───────────────────────────────────────────────────────────────────

    function loadTenants() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.get_available_tenants',
            callback(r) {
                const data          = r.message || {};
                S.tenants           = data.tenants || (Array.isArray(r.message) ? r.message : []);
                const defaultTenant = data.default_tenant || '';

                const sel = document.getElementById('kam-tenant-select');
                // Remove the placeholder "All Tenants" option — a tenant must always be selected
                sel.innerHTML = '';
                S.tenants.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.name;
                    opt.textContent = t.tenant_name || t.name;
                    sel.appendChild(opt);
                });

                // Priority: 1) nexus-admin localStorage selection
                //           2) Nexus Settings default_tenant
                //           3) first available tenant
                const adminTenant = localStorage.getItem('nexus_admin_active_tenant') || '';
                if (adminTenant && S.tenants.some(t => t.name === adminTenant)) {
                    S.tenant = adminTenant;
                } else if (defaultTenant && S.tenants.some(t => t.name === defaultTenant)) {
                    S.tenant = defaultTenant;
                } else if (S.tenants.length > 0) {
                    S.tenant = S.tenants[0].name;
                }
                sel.value = S.tenant;
                updateTenantBadge();
                load();
            },
        });
    }

    function load() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.get_page_data',
            args: { tenant: S.tenant || '' },
            callback(r) {
                S.profiles   = r.message.profiles   || [];
                S.categories = r.message.categories || [];
                S.selected   = null;
                S.detail     = null;
                document.getElementById('kam-placeholder').style.display = '';
                document.getElementById('kam-detail').style.display = 'none';
                renderList();
            },
        });
    }

    function loadDetail(profileName) {
        S.pendingAssign.clear();
        S.pendingRemove.clear();
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.get_profile_detail',
            args: { profile: profileName },
            callback(r) {
                S.detail   = r.message;
                S.selected = profileName;
                renderDetail();
            },
        });
    }

    function updateTenantBadge() {
        // Label inside the select reflects the current value — nothing extra needed.
        // Left for call-site compatibility.
    }

    // ── Render ─────────────────────────────────────────────────────────────────

    function renderList() {
        const el = document.getElementById('kam-profile-list');
        const cntEl = document.getElementById('kam-profile-count');
        if (cntEl) cntEl.textContent = S.profiles.length;

        if (!S.profiles.length) {
            el.innerHTML = `<div class="nexus-empty-state">No Knowledge Profiles found${S.tenant ? ' for this tenant' : ''}.<br>
                <a class="kam-link" id="kam-create-first">Create one</a></div>`;
            document.getElementById('kam-create-first')?.addEventListener('click', showNewDialog);
            return;
        }

        el.innerHTML = S.profiles.map(p => `
<div class="kam-profile-row ${S.selected === p.name ? 'kam-profile-row-active' : ''} ${!p.enabled ? 'kam-profile-row-disabled' : ''}"
     data-name="${esc(p.name)}">
  <div class="kam-profile-row-name">${esc(p.title)}</div>
  <div class="nexus-admin-muted">
    ${p.cat_count} categor${p.cat_count === 1 ? 'y' : 'ies'}
    ${!p.enabled ? '<span class="nexus-status-pill disabled" style="margin-left:6px;">Disabled</span>' : ''}
  </div>
</div>`).join('');
    }

    function renderDetail() {
        const d = S.detail;
        if (!d) return;

        document.getElementById('kam-placeholder').style.display = 'none';
        const el = document.getElementById('kam-detail');
        el.style.display = '';

        const assignedSet = new Set(
            d.assignments.filter(a => a.enabled).map(a => a.access_category)
        );
        S.pendingAssign.forEach(c => assignedSet.add(c));
        S.pendingRemove.forEach(c => assignedSet.delete(c));

        const hasPending = S.pendingAssign.size || S.pendingRemove.size;

        // Filter categories to this profile's tenant
        const profileTenant = d.tenant || S.tenant;
        const visibleCats = profileTenant
            ? S.categories.filter(c => !c.tenant || c.tenant === profileTenant)
            : S.categories;

        el.innerHTML = `

<!-- Profile header -->
<div class="nexus-admin-card" style="margin-bottom:14px;">
  <div class="nexus-admin-section-head">
    <div>
      <div class="nexus-admin-card-title">${esc(d.title)}</div>
      <div class="nexus-admin-muted">
        ${esc(d.name)} &nbsp;·&nbsp;
        ${d.enabled
          ? '<span class="nexus-status-pill enabled">Enabled</span>'
          : '<span class="nexus-status-pill disabled">Disabled</span>'}
        ${d.tenant ? `&nbsp;·&nbsp; <span class="kam-tenant-pill">${esc(d.tenant)}</span>` : ''}
      </div>
      ${d.description ? `<div class="nexus-admin-muted" style="margin-top:6px;">${esc(d.description)}</div>` : ''}
    </div>
    <div>
      <button class="btn btn-xs btn-default" style="border-radius:999px;" data-open-kp="${esc(d.name)}">Open Profile</button>
    </div>
  </div>
</div>

<!-- Access Category assignment -->
<div class="nexus-admin-card" style="margin-bottom:14px;">
  <div class="nexus-admin-section-head">
    <div class="nexus-admin-card-title">Access Categories</div>
    <div class="nexus-admin-muted">Toggle to assign or remove. Save when done.</div>
  </div>
  <div class="kam-public-note">
    <span class="kam-public-note-icon">ℹ</span>
    Access Categories whose policies are entirely <b>Public</b> are not listed here — those knowledge sources are served to all visitors automatically and need no profile assignment. Only categories with restricted or internal policies appear below and require explicit allocation.
  </div>
  ${visibleCats.length ? `
  <div class="kam-cat-grid">
    ${visibleCats.map(cat => {
        const active = assignedSet.has(cat.name);
        return `
    <div class="kam-cat-tile ${active ? 'kam-cat-tile-on' : ''}" data-cat="${esc(cat.name)}">
      <div class="kam-cat-tile-name">${esc(cat.title || cat.category_name)}</div>
      ${cat.description ? `<div class="nexus-admin-muted" style="margin-top:4px;">${esc(cat.description)}</div>` : ''}
      <div class="kam-cat-tile-status">${active ? '✓ Assigned' : '+ Assign'}</div>
    </div>`;
    }).join('')}
  </div>
  ${hasPending ? `<div class="kam-save-bar">
    <span>${S.pendingAssign.size ? `+${S.pendingAssign.size} to assign ` : ''}`
         + `${S.pendingRemove.size ? `−${S.pendingRemove.size} to remove` : ''}</span>
    <button class="btn btn-primary btn-sm" id="kam-save-btn" style="border-radius:999px;">Save changes</button>
    <button class="btn btn-default btn-sm" id="kam-discard-btn" style="border-radius:999px;">Discard</button>
  </div>` : ''}` : `<div class="nexus-empty-state">No assignable Access Categories found for this tenant.
    <a class="kam-link" onclick="frappe.set_route('Form','Nexus Access Category','new')">Create one</a></div>`}
</div>

<!-- Effective Access Policies -->
<div class="nexus-admin-card" style="margin-bottom:14px;">
  <div class="nexus-admin-section-head">
    <div class="nexus-admin-card-title">Effective Access Policies</div>
    <div class="nexus-admin-muted">Policies unlocked by the assigned categories</div>
  </div>
  ${d.effective_policies && d.effective_policies.length ? `
  <div class="kam-policy-list">
    ${d.effective_policies.map(p => `
    <div class="kam-policy-row">
      <div class="kam-policy-name">${esc(p.policy_name)}
        ${p.is_primitive ? '<span class="nexus-status-pill" style="background:#fff7e6;color:#8a5d00;border:1px solid #f2d49b;margin-left:6px;">Primitive</span>' : ''}
      </div>
      <div class="nexus-admin-muted">${esc(p.access_level || '')}${p.access_level && p.sensitivity ? ' · ' : ''}${esc(p.sensitivity || '')}</div>
      ${p.description ? `<div class="nexus-admin-muted" style="margin-top:3px;">${esc(p.description)}</div>` : ''}
    </div>`).join('')}
  </div>` : `<div class="nexus-empty-state">No policies resolved — assign at least one Access Category.</div>`}
</div>

<!-- Identity Allocation -->
<div class="nexus-admin-card" style="margin-bottom:14px;">
  <div class="nexus-admin-section-head">
    <div class="nexus-admin-card-title">Identity Allocation <span style="font-size:10px; font-weight:700; color:#6b7c9b; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:999px; padding:2px 8px; margin-left:6px; vertical-align:middle;">via Nexus Identity Knowledge Rule</span></div>
    <div class="nexus-admin-muted">Reference mapping — identity types associated with this Knowledge Profile</div>
  </div>
  <div id="kam-identity-rules-list">
  ${d.identity_rules && d.identity_rules.length ? `
  <div class="kam-id-rule-list">
    ${d.identity_rules.map(r => `
    <div class="kam-id-rule-row">
      <div class="kam-id-rule-main">
        <div class="kam-id-rule-type">${esc(r.it_label || r.identity_type)}</div>
        <div class="nexus-admin-muted">${esc(r.rule_label)}</div>
        ${r.description ? `<div class="nexus-admin-muted" style="margin-top:2px;">${esc(r.description)}</div>` : ''}
      </div>
      <button class="btn btn-xs btn-default kam-delete-rule-btn" style="border-radius:999px;color:#b42318;"
              data-rule="${esc(r.name)}" title="Remove allocation">Remove</button>
    </div>`).join('')}
  </div>` : `<div class="nexus-admin-muted" style="padding:4px 0 10px;">No identity types allocated yet.</div>`}
  </div>
  <button class="btn btn-xs btn-default kam-add-rule-btn" style="border-radius:999px;margin-top:8px;"
          data-profile="${esc(d.name)}">+ Allocate Identity Type</button>
</div>

<!-- Chat Category Routing -->
<div class="nexus-admin-card" style="margin-bottom:14px;">
  <div class="nexus-admin-section-head">
    <div class="nexus-admin-card-title">Chat Category Routing</div>
    <a class="kam-nav-link" onclick="frappe.set_route('nexus-category-profile-routes')">
      Manage Routes ↗
    </a>
  </div>
  ${d.chat_routes && d.chat_routes.length ? `
  <div class="kam-chat-route-list">
    ${d.chat_routes.map(r => `
    <div class="kam-chat-route-row">
      <div class="kam-chat-route-main">
        <div class="kam-chat-cat-name">
          ${esc(r.category_label)}
          ${!r.enabled ? '<span class="nexus-status-pill disabled" style="margin-left:6px;">Disabled</span>' : ''}
        </div>
        <div class="nexus-admin-muted" style="margin-top:2px;">${esc(r.channel)}</div>
      </div>
      <div class="kam-chat-route-chain">
        <div class="kam-route-chain-label">via</div>
        ${r.via.map(v => `
        <div class="kam-route-chip">
          <span class="kam-route-chip-type">${esc(v.identity_type)}</span>
          <span class="kam-route-chip-name">${esc(v.label)}</span>
        </div>`).join('')}
        ${r.ai_agent_profile ? `
        <div class="kam-route-chip kam-route-chip-agent">
          <span class="kam-route-chip-type">Agent</span>
          <span class="kam-route-chip-name">${esc(r.ai_agent_profile)}</span>
        </div>` : ''}
      </div>
    </div>`).join('')}
  </div>` : `
  <div class="nexus-empty-state">
    No chat categories route to this Knowledge Profile yet.<br>
    Configure routing via <a class="kam-link" onclick="frappe.set_route('nexus-category-profile-routes')">Category Profile Routes</a>
    and assign this Knowledge Profile in the relevant <a class="kam-link" onclick="frappe.set_route('List','Nexus Identity Profile')">Identity Profiles</a>.
  </div>`}
</div>

<!-- Used by Identity Profiles -->
<div class="nexus-admin-card">
  <div class="nexus-admin-section-head">
    <div class="nexus-admin-card-title">Referenced by Identity Profiles</div>
    <a class="kam-nav-link" onclick="frappe.set_route('nexus-identity-profile-manager')">Manage Identity Profiles ↗</a>
  </div>
  <div class="nexus-admin-muted" style="margin-bottom:12px;">Identity Profiles that map to this Knowledge Profile</div>
  ${d.used_by && d.used_by.length ? `
  <table class="table table-bordered nexus-admin-table">
    <thead><tr><th>Identity Profile</th><th>Identity Type</th><th></th></tr></thead>
    <tbody>
    ${d.used_by.map(r => `
    <tr>
      <td>${esc(r.identity_profile_title)}</td>
      <td><span class="nexus-status-pill enabled">${esc(r.identity_type)}</span></td>
      <td><a class="kam-link" onclick="frappe.set_route('Form','Nexus Identity Profile','${esc(r.identity_profile)}')">Open</a></td>
    </tr>`).join('')}
    </tbody>
  </table>` : `<div class="nexus-empty-state">No Identity Profiles reference this Knowledge Profile yet.
    <a class="kam-link" onclick="frappe.set_route('nexus-identity-profile-manager')">Manage Identity Profiles</a></div>`}
</div>`;
    }

    // ── Events ─────────────────────────────────────────────────────────────────

    function bind() {
        // Tenant selector change
        $(page.body).on('change', '#kam-tenant-select', function () {
            S.tenant = this.value;
            updateTenantBadge();
            load();
        });

        $(page.body).on('click', '.kam-profile-row', function () {
            const name = $(this).data('name');
            loadDetail(name);
            document.querySelectorAll('.kam-profile-row').forEach(r => r.classList.remove('kam-profile-row-active'));
            this.classList.add('kam-profile-row-active');
        });

        $(page.body).on('click', '.kam-cat-tile', function () {
            const cat        = $(this).data('cat');
            const on         = this.classList.contains('kam-cat-tile-on');
            const wasAssigned = S.detail.assignments.some(a => a.access_category === cat && a.enabled);

            if (on) {
                this.classList.remove('kam-cat-tile-on');
                this.querySelector('.kam-cat-tile-status').textContent = '+ Assign';
                S.pendingAssign.delete(cat);
                if (wasAssigned) S.pendingRemove.add(cat);
            } else {
                this.classList.add('kam-cat-tile-on');
                this.querySelector('.kam-cat-tile-status').textContent = '✓ Assigned';
                S.pendingRemove.delete(cat);
                if (!wasAssigned) S.pendingAssign.add(cat);
            }

            const hasPending = S.pendingAssign.size || S.pendingRemove.size;
            const existingBar = document.querySelector('.kam-save-bar');
            if (hasPending && !existingBar) {
                const catGrid = document.querySelector('.kam-cat-grid');
                if (catGrid) {
                    const bar = document.createElement('div');
                    bar.className = 'kam-save-bar';
                    bar.innerHTML = `
                        <span id="kam-pending-txt"></span>
                        <button class="btn btn-primary btn-sm" id="kam-save-btn" style="border-radius:999px;">Save changes</button>
                        <button class="btn btn-default btn-sm" id="kam-discard-btn" style="border-radius:999px;">Discard</button>`;
                    catGrid.after(bar);
                }
            }
            const txt = document.getElementById('kam-pending-txt');
            if (txt) {
                txt.textContent = (S.pendingAssign.size ? `+${S.pendingAssign.size} to assign ` : '')
                                + (S.pendingRemove.size ? `−${S.pendingRemove.size} to remove` : '');
            }
            if (!hasPending) document.querySelector('.kam-save-bar')?.remove();
        });

        $(page.body).on('click', '#kam-save-btn', function () {
            if (S.saving) return;
            S.saving = true;
            $(this).text('Saving…').prop('disabled', true);
            frappe.call({
                method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.save_knowledge_profile_categories',
                args: {
                    profile:              S.selected,
                    categories_to_assign: JSON.stringify([...S.pendingAssign]),
                    categories_to_remove: JSON.stringify([...S.pendingRemove]),
                },
                callback(r) {
                    S.saving = false;
                    S.detail = r.message;
                    S.pendingAssign.clear();
                    S.pendingRemove.clear();
                    const p = S.profiles.find(x => x.name === S.selected);
                    if (p) p.cat_count = (S.detail.assignments || []).filter(a => a.enabled).length;
                    renderList();
                    renderDetail();
                    frappe.show_alert({ message: 'Saved', indicator: 'green' });
                },
            });
        });

        $(page.body).on('click', '#kam-discard-btn', function () {
            S.pendingAssign.clear();
            S.pendingRemove.clear();
            renderDetail();
        });

        // Allocate a new identity type → Knowledge Profile rule
        $(page.body).on('click', '.kam-add-rule-btn', function () {
            const profile = $(this).data('profile');
            frappe.call({
                method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.get_available_identity_types',
                args: { knowledge_profile: profile },
                callback(r) {
                    const types = r.message || [];
                    if (!types.length) {
                        frappe.show_alert({ message: 'All identity types are already allocated to this profile.', indicator: 'orange' });
                        return;
                    }
                    const d = new frappe.ui.Dialog({
                        title: 'Allocate Identity Type',
                        fields: [
                            {
                                fieldtype: 'Select',
                                fieldname: 'identity_type',
                                label: 'Identity Type',
                                options: types.map(t => t.name).join('\n'),
                                reqd: 1,
                            },
                            {
                                fieldtype: 'Data',
                                fieldname: 'rule_label',
                                label: 'Rule Label',
                                description: 'Auto-generated if left blank',
                            },
                            {
                                fieldtype: 'Small Text',
                                fieldname: 'description',
                                label: 'Description',
                            },
                        ],
                        primary_action_label: 'Allocate',
                        primary_action(vals) {
                            frappe.call({
                                method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.create_identity_knowledge_rule',
                                args: {
                                    identity_type:     vals.identity_type,
                                    knowledge_profile: profile,
                                    rule_label:        vals.rule_label || '',
                                    description:       vals.description || '',
                                },
                                callback(res) {
                                    d.hide();
                                    if (S.detail) {
                                        S.detail.identity_rules = S.detail.identity_rules || [];
                                        S.detail.identity_rules.push(res.message);
                                    }
                                    frappe.show_alert({ message: 'Identity type allocated', indicator: 'green' });
                                    loadDetail(profile);
                                },
                            });
                        },
                    });
                    d.show();
                },
            });
        });

        // Remove an identity knowledge rule
        $(page.body).on('click', '.kam-delete-rule-btn', function () {
            const rule = $(this).data('rule');
            frappe.confirm('Remove this identity allocation?', () => {
                frappe.call({
                    method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.delete_identity_knowledge_rule',
                    args: { rule_name: rule },
                    callback() {
                        frappe.show_alert({ message: 'Allocation removed', indicator: 'green' });
                        loadDetail(S.selected);
                    },
                });
            });
        });

        $(page.body).on('click', '[data-open-kp]', function () {
            frappe.set_route('Form', 'Knowledge Profile', $(this).data('open-kp'));
        });

        $(page.body).on('click', '[data-list]', function () {
            frappe.set_route('List', $(this).data('list'));
        });

        document.getElementById('kam-new-btn').addEventListener('click', showNewDialog);
    }

    function showNewDialog() {
        const tenantOptions = S.tenants.map(t => t.name);
        const d = new frappe.ui.Dialog({
            title: 'New Knowledge Profile',
            fields: [
                {
                    fieldtype: 'Select',
                    fieldname: 'tenant',
                    label: 'Tenant',
                    options: tenantOptions.join('\n'),
                    default: S.tenant || (tenantOptions[0] || ''),
                    reqd: 1,
                },
                {
                    fieldtype: 'Data',
                    fieldname: 'profile_name',
                    label: 'Profile Name (slug)',
                    description: 'Uppercase, hyphens only. e.g. CUSTOMER-KP',
                    reqd: 1,
                },
                { fieldtype: 'Data',       fieldname: 'title',        label: 'Title', reqd: 1 },
                { fieldtype: 'Small Text', fieldname: 'description',  label: 'Description' },
            ],
            primary_action_label: 'Create',
            primary_action(vals) {
                frappe.call({
                    method: 'digitz_ai_nexus_live.api.nexus_profile_access_allocation.create_knowledge_profile',
                    args: {
                        profile_name: vals.profile_name,
                        title:        vals.title,
                        tenant:       vals.tenant,
                        description:  vals.description || '',
                    },
                    callback(r) {
                        d.hide();
                        S.profiles.push({
                            name: r.message.name,
                            title: r.message.title,
                            tenant: r.message.tenant,
                            enabled: true,
                            cat_count: 0,
                        });
                        renderList();
                        loadDetail(r.message.name);
                        document.querySelectorAll('.kam-profile-row').forEach(row => {
                            if (row.dataset.name === r.message.name) row.classList.add('kam-profile-row-active');
                        });
                        frappe.show_alert({ message: 'Knowledge Profile created', indicator: 'green' });
                    },
                });
            },
        });
        d.show();
    }

    function esc(s) { return frappe.utils.escape_html(String(s || '')); }

    // ── CSS ────────────────────────────────────────────────────────────────────

    function inject_kam_css() {
        if ($('#kam-css').length) return;
        $('head').append(`<style id="kam-css">
        .kam-wrap { padding: 12px; }

        /* shared nexus-admin-* classes (in case not already injected) */
        .nexus-admin-hero { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; border-radius:26px; padding:30px 34px; margin-bottom:18px; background:radial-gradient(circle at 8% 20%,rgba(77,163,255,.28),transparent 30%),radial-gradient(circle at 92% 10%,rgba(224,166,47,.22),transparent 28%),linear-gradient(135deg,#fff 0%,#eef6ff 48%,#f8fbff 100%); border:1px solid rgba(77,163,255,.38); box-shadow:0 18px 45px rgba(33,77,187,.12); }
        .nexus-admin-badge { display:inline-flex; align-items:center; padding:8px 14px; border-radius:999px; background:rgba(33,77,187,.09); border:1px solid rgba(33,77,187,.16); color:#214dbb; font-weight:800; font-size:12px; letter-spacing:.04em; text-transform:uppercase; margin-bottom:12px; }
        .nexus-admin-hero h2 { margin:0; font-size:30px; font-weight:900; color:#102b67; letter-spacing:-0.03em; }
        .nexus-admin-hero p { margin:12px 0 0; max-width:860px; font-size:15px; line-height:1.7; color:#27416f; font-weight:500; }
        .nexus-admin-hero-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .nexus-admin-hero-actions .btn { border-radius:999px; font-weight:850; }
        .nexus-admin-flow-pill { display:inline-block; margin-top:12px; padding:7px 14px; border-radius:999px; background:rgba(33,77,187,.08); border:1px solid rgba(33,77,187,.18); color:#214dbb; font-size:11px; font-weight:800; font-family:monospace; }
        .nexus-admin-card { border:1px solid rgba(77,163,255,.28); border-radius:22px; background:#fff; padding:20px; box-shadow:0 12px 30px rgba(33,77,187,.07); }
        .nexus-admin-card-title { display:inline-flex; align-items:center; gap:12px; color:#173b8c; font-size:16px; font-weight:900; padding:10px 16px; margin-bottom:16px; border-radius:999px; background:#eef6ff; border:1px solid rgba(33,77,187,.14); }
        .nexus-admin-card-title:after { content:""; width:36px; height:4px; border-radius:999px; background:linear-gradient(90deg,#e0a62f,#f4ca64); }
        .nexus-admin-section-head { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:16px; }
        .nexus-admin-section-head .nexus-admin-card-title { margin-bottom:8px; }
        .nexus-admin-muted { color:#6b7c9b; font-size:11px; font-weight:650; line-height:1.4; }
        .nexus-admin-table { margin-bottom:0; background:#fff; }
        .nexus-admin-table th { color:#173b8c; font-size:12px; font-weight:900; background:#eef6ff; white-space:nowrap; }
        .nexus-admin-table td { color:#27416f; font-size:12px; font-weight:650; vertical-align:middle; }
        .nexus-empty-state { padding:16px; border-radius:16px; background:#fff7e6; border:1px solid #f2d49b; color:#8a5d00; font-weight:800; line-height:1.6; }
        .nexus-status-pill { display:inline-flex; padding:5px 9px; border-radius:999px; font-size:10px; font-weight:900; white-space:nowrap; }
        .nexus-status-pill.enabled { background:#ecfdf3; color:#16794c; border:1px solid #bdebd2; }
        .nexus-status-pill.disabled { background:#fff0f0; color:#b42318; border:1px solid #ffd1d1; }

        /* tenant filter bar — sits at the top of the profiles panel */
        .kam-tenant-filter-bar { display:flex; align-items:center; gap:8px; padding:12px 14px 10px; background:#f5f8ff; border-bottom:1px solid rgba(33,77,187,.1); }
        .kam-tenant-filter-label { font-size:11px; font-weight:800; color:#214dbb; text-transform:uppercase; letter-spacing:.05em; white-space:nowrap; flex-shrink:0; }
        .kam-tenant-select { flex:1; min-width:0; height:30px; padding:0 10px; border-radius:8px; border:1px solid rgba(33,77,187,.28); background:#fff; color:#102b67; font-size:12px; font-weight:700; cursor:pointer; outline:none; appearance:auto; }
        .kam-tenant-select:focus { border-color:#214dbb; box-shadow:0 0 0 2px rgba(33,77,187,.15); }
        .kam-list-divider { height:1px; background:rgba(77,163,255,.12); }
        .kam-tenant-pill { display:inline-flex; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:800; background:#eef6ff; border:1px solid rgba(33,77,187,.2); color:#214dbb; margin-left:4px; }

        /* layout */
        .kam-layout { display:grid; grid-template-columns:260px 1fr; gap:18px; align-items:start; }

        /* profile list */
        .kam-list-panel { position:sticky; top:64px; padding:0; overflow:hidden; }
        .kam-list-panel .nexus-admin-card-title { margin:14px 16px 0; }
        #kam-profile-list { max-height:540px; overflow-y:auto; padding-bottom:8px; }
        .kam-count { font-size:11px; font-weight:700; background:#fff; border:1px solid rgba(33,77,187,.2); border-radius:999px; padding:2px 8px; color:#214dbb; margin-left:4px; }
        .kam-profile-row { padding:11px 16px; cursor:pointer; border-bottom:1px solid #f1f5f9; transition:background .12s; }
        .kam-profile-row:last-child { border-bottom:none; }
        .kam-profile-row:hover { background:#f8fbff; }
        .kam-profile-row-active { background:#eef6ff !important; border-left:3px solid #214dbb; }
        .kam-profile-row-disabled { opacity:.55; }
        .kam-profile-row-name { font-size:13px; font-weight:700; color:#102b67; }

        /* detail placeholder */
        .kam-placeholder { text-align:center; padding:52px 20px; }
        .kam-placeholder-icon { font-size:30px; margin-bottom:12px; color:#b0c4de; }
        .kam-placeholder > div:last-child { color:#53688f; font-size:14px; font-weight:700; }

        /* category grid */
        .kam-cat-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:10px; margin-bottom:6px; }
        .kam-cat-tile { border:1.5px solid rgba(77,163,255,.28); border-radius:16px; padding:14px; cursor:pointer; transition:all .13s; background:#f8fbff; }
        .kam-cat-tile:hover { border-color:rgba(33,77,187,.45); background:#eef6ff; }
        .kam-cat-tile-on { border-color:#214dbb !important; background:#eef6ff !important; }
        .kam-cat-tile-name { font-size:13px; font-weight:800; color:#102b67; }
        .kam-cat-tile-status { font-size:11px; color:#6b7c9b; margin-top:8px; font-weight:700; }
        .kam-cat-tile-on .kam-cat-tile-status { color:#214dbb; font-weight:900; }

        /* public-only info note */
        .kam-public-note { display:flex; align-items:flex-start; gap:8px; padding:8px 12px; margin-bottom:12px; background:#f0f4ff; border:1px solid rgba(33,77,187,.18); border-radius:10px; font-size:11.5px; color:#4a6085; font-weight:600; line-height:1.5; }
        .kam-public-note-icon { font-size:14px; color:#214dbb; flex-shrink:0; margin-top:1px; }

        /* save bar */
        .kam-save-bar { display:flex; align-items:center; gap:10px; margin-top:14px; padding:10px 14px; background:#fff7e6; border:1px solid #f2d49b; border-radius:12px; font-size:13px; color:#8a5d00; font-weight:700; }
        .kam-save-bar .btn { margin-left:auto; }

        /* policy rows */
        .kam-policy-list { display:flex; flex-direction:column; gap:8px; }
        .kam-policy-row { background:#f8fbff; border:1px solid rgba(77,163,255,.22); border-radius:14px; padding:12px 14px; }
        .kam-policy-name { font-size:13px; font-weight:800; color:#102b67; display:flex; align-items:center; gap:8px; }

        .kam-link { color:#214dbb; text-decoration:none; cursor:pointer; font-weight:800; }
        .kam-link:hover { text-decoration:underline; }

        /* identity allocation */
        .kam-id-rule-list { display:flex; flex-direction:column; gap:8px; margin-bottom:4px; }
        .kam-id-rule-row { display:flex; align-items:center; justify-content:space-between; gap:12px; background:#f8fbff; border:1px solid rgba(77,163,255,.22); border-radius:12px; padding:10px 14px; }
        .kam-id-rule-main { flex:1; }
        .kam-id-rule-type { font-size:13px; font-weight:800; color:#102b67; }

        .kam-nav-link { font-size:11px; font-weight:800; color:#214dbb; text-decoration:none; cursor:pointer; white-space:nowrap; padding:5px 12px; border-radius:999px; border:1px solid rgba(33,77,187,.22); background:#f0f5ff; transition:background .12s; }
        .kam-nav-link:hover { background:#deeaff; }

        /* chat category routing chain */
        .kam-chat-route-list { display:flex; flex-direction:column; gap:10px; }
        .kam-chat-route-row { background:#f8fbff; border:1px solid rgba(77,163,255,.22); border-radius:14px; padding:12px 14px; display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; }
        .kam-chat-route-main { min-width:160px; }
        .kam-chat-cat-name { font-size:13px; font-weight:800; color:#102b67; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .kam-chat-route-chain { display:flex; align-items:center; gap:6px; flex-wrap:wrap; flex:1; }
        .kam-route-chain-label { font-size:10px; font-weight:900; color:#6b7c9b; text-transform:uppercase; letter-spacing:.05em; margin-right:2px; }
        .kam-route-chip { display:inline-flex; align-items:center; gap:4px; background:#eef6ff; border:1px solid rgba(33,77,187,.18); border-radius:999px; padding:3px 10px; font-size:11px; }
        .kam-route-chip-type { font-weight:900; color:#6b7c9b; font-size:10px; text-transform:uppercase; }
        .kam-route-chip-name { font-weight:700; color:#102b67; }
        .kam-route-chip-agent { background:#fff7e6; border-color:#f2d49b; }
        .kam-route-chip-agent .kam-route-chip-name { color:#8a5d00; }

        @media (max-width:760px) {
          .nexus-admin-hero { flex-direction:column; }
          .kam-layout { grid-template-columns:1fr; }
        }
        </style>`);
    }
};

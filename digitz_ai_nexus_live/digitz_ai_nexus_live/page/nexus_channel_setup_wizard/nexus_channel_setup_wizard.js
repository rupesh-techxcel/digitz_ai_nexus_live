frappe.pages['nexus-channel-setup-wizard'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Channel Setup Wizard',
        single_column: true,
    });

    // ── Wizard State ─────────────────────────────────────────────────────────
    const W = {
        step: 1,
        totalSteps: 5,
        // step 1
        tenant: '',
        channel: '',
        channel_name: '',
        tenants: [],
        channels: [],
        // step 2
        category_mode: 'existing',   // 'existing' | 'new'
        category: '',
        category_label: '',
        category_code: '',
        category_visibility: 'External',
        category_verification: 'None',
        category_allow_fallback: false,
        category_escalation: false,
        category_description: '',
        category_display_order: 10,
        categories: [],
        // step 3
        profile_mode: 'existing',    // 'existing' | 'new'
        profile: '',
        profile_name: '',
        profile_display_name: '',
        profile_role: 'Public Responder',
        profile_tone: 'Professional',
        profile_response_style: 'Concise',
        profile_behavior: '',
        profile_welcome: '',
        profile_fallback: '',
        profile_confidence: 0.65,
        profile_escalation: false,
        profile_memory: 'None',
        profiles: [],
        // step 4 — identity profiles for the route
        // Empty list = Open to All (public access)
        route_identity_profiles: [],   // [{name, profile_name, title}]
        identity_profiles: [],         // all Nexus Identity Profile records
        existing_route: null,
        existing_routes: [],
    };

    inject_wizard_css();
    $(page.body).html(buildShell());
    loadInitialData();

    // ── Shell ─────────────────────────────────────────────────────────────────
    function buildShell() {
        return `
<div class="ncsw-wrap">
    <div class="ncsw-header">
        <div class="ncsw-badge">Nexus AI</div>
        <h2>Channel Setup Wizard</h2>
        <p>Configure the complete AI delivery chain — from channel to identity routing — in one guided flow. You can re-run this wizard anytime to reconfigure.</p>
    </div>
    <div class="ncsw-progress-bar" id="ncsw_progress_bar"></div>
    <div class="ncsw-body">
        <div class="ncsw-steps-panel" id="ncsw_steps_panel"></div>
        <div class="ncsw-content-panel" id="ncsw_content_panel">
            <div class="ncsw-loading">Loading…</div>
        </div>
    </div>
    <div class="ncsw-footer" id="ncsw_footer"></div>
</div>`;
    }

    // ── Step meta ─────────────────────────────────────────────────────────────
    const STEP_META = [
        { num: 1, label: 'Channel',       icon: '📡' },
        { num: 2, label: 'Category',      icon: '🏷️' },
        { num: 3, label: 'Agent Profile', icon: '🤖' },
        { num: 4, label: 'Access Route',  icon: '🔑' },
        { num: 5, label: 'Review',        icon: '✅' },
    ];

    // ── Progress ──────────────────────────────────────────────────────────────
    function renderProgress() {
        $('#ncsw_steps_panel').html(STEP_META.map(s => `
            <div class="ncsw-step-item ${s.num === W.step ? 'active' : ''} ${s.num < W.step ? 'done' : ''}"
                 data-step="${s.num}">
                <div class="ncsw-step-dot">
                    ${s.num < W.step
                        ? '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>'
                        : s.icon}
                </div>
                <div class="ncsw-step-label">${s.label}</div>
            </div>
        `).join('<div class="ncsw-step-connector"></div>'));

        $('#ncsw_steps_panel').find('.ncsw-step-item.done').on('click', function () {
            goToStep(+$(this).data('step'));
        });

        $('#ncsw_progress_bar').html(`
            <div class="ncsw-bar-track">
                <div class="ncsw-bar-fill" style="width:${((W.step - 1) / (W.totalSteps - 1)) * 100}%"></div>
            </div>
        `);
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    function renderFooter() {
        const isFirst = W.step === 1;
        const isLast  = W.step === W.totalSteps;
        $('#ncsw_footer').html(`
            <div class="ncsw-footer-inner">
                <button class="btn btn-default ncsw-back-btn" id="ncsw_back" ${isFirst ? 'disabled' : ''}>← Back</button>
                <div class="ncsw-step-indicator">Step ${W.step} of ${W.totalSteps}</div>
                ${isLast
                    ? `<button class="btn btn-primary ncsw-finish-btn" id="ncsw_finish">✓ Finish &amp; Save</button>`
                    : `<button class="btn btn-primary ncsw-next-btn" id="ncsw_next">Next →</button>`
                }
            </div>
        `);

        $('#ncsw_back').on('click', () => goToStep(W.step - 1));
        $('#ncsw_next').on('click', () => validateAndAdvance());
        $('#ncsw_finish').on('click', () => finishWizard());
    }

    // ── Navigation ────────────────────────────────────────────────────────────
    function goToStep(n) {
        W.step = n;
        renderProgress();
        renderCurrentStep();
        renderFooter();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function validateAndAdvance() {
        const err = validateStep(W.step);
        if (err) { showStepError(err); return; }
        clearStepError();

        if (W.step === 2 && W.category_mode === 'new') {
            const $btn = $('#ncsw_next').prop('disabled', true).text('Creating…');
            createCategory()
                .then(() => { $btn.prop('disabled', false).text('Next →'); goToStep(W.step + 1); })
                .fail(() => { $btn.prop('disabled', false).text('Next →'); showStepError('Failed to create category.'); });
        } else if (W.step === 3 && W.profile_mode === 'new') {
            const $btn = $('#ncsw_next').prop('disabled', true).text('Creating…');
            createProfile()
                .then(() => { $btn.prop('disabled', false).text('Next →'); goToStep(W.step + 1); })
                .fail(() => { $btn.prop('disabled', false).text('Next →'); showStepError('Failed to create agent profile.'); });
        } else {
            goToStep(W.step + 1);
        }
    }

    function validateStep(step) {
        if (step === 1) {
            if (!W.tenant) return 'Please select a Tenant.';
            if (!W.channel) return 'Please select a Channel.';
        }
        if (step === 2) {
            if (W.category_mode === 'existing' && !W.category) return 'Please select a Category.';
            if (W.category_mode === 'new' && !W.category_label.trim()) return 'Category Label is required.';
        }
        if (step === 3) {
            if (W.profile_mode === 'existing' && !W.profile) return 'Please select an Agent Profile.';
            if (W.profile_mode === 'new' && !W.profile_name.trim()) return 'Agent Profile Name is required.';
        }
        // Step 4 always valid — empty profiles = open to all
        return null;
    }

    function showStepError(msg) {
        let $e = $('#ncsw_step_error');
        if (!$e.length) {
            $('#ncsw_content_panel').append('<div id="ncsw_step_error" class="ncsw-error"></div>');
            $e = $('#ncsw_step_error');
        }
        $e.text(msg).show();
    }
    function clearStepError() { $('#ncsw_step_error').hide(); }

    // ── Data loading ──────────────────────────────────────────────────────────
    function loadInitialData() {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_channel_setup_wizard.get_wizard_data',
            callback(r) {
                if (!r.message) return;
                W.tenants           = r.message.tenants || [];
                W.channels          = r.message.channels || [];
                W.profiles          = r.message.profiles || [];
                W.identity_profiles = r.message.identity_profiles || [];
                W.existing_routes   = r.message.existing_routes || [];

                if (W.tenants.length === 1) W.tenant = W.tenants[0].name;
                goToStep(1);
            },
        });
    }

    function loadCategoriesForChannel(channel, cb) {
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_channel_setup_wizard.get_categories_for_channel',
            args: { channel },
            callback(r) {
                W.categories = (r.message && r.message.categories) || [];
                if (cb) cb();
            },
        });
    }

    // ── Step renderers ────────────────────────────────────────────────────────
    function renderCurrentStep() {
        ({ 1: renderStep1, 2: renderStep2, 3: renderStep3, 4: renderStep4, 5: renderStep5 })[W.step]();
    }

    // ── Step 1: Channel & Tenant ──────────────────────────────────────────────
    function renderStep1() {
        const tenantOptions = W.tenants.map(t =>
            `<option value="${esc(t.name)}" ${W.tenant === t.name ? 'selected' : ''}>${esc(t.tenant_name || t.name)}</option>`
        ).join('');

        const filteredChannels = W.tenant ? W.channels.filter(c => c.tenant === W.tenant) : W.channels;
        const channelOptions = filteredChannels.map(c =>
            `<option value="${esc(c.name)}" ${W.channel === c.name ? 'selected' : ''}>${esc(c.channel_name || c.name)} (${esc(c.channel_type || '')})</option>`
        ).join('');

        // Existing routes list
        let existingRoutesHtml = '';
        if (W.existing_routes.length) {
            const routeCards = W.existing_routes.map(r => {
                const ips = r.identity_profiles || [];
                const accessLabel = ips.length === 0
                    ? '<span class="ncsw-exists-badge">🌐 Open to All</span>'
                    : ips.map(ip => {
                        const found = W.identity_profiles.find(p => p.name === ip);
                        return `<span class="ncsw-ac-chip-small">${esc((found && (found.profile_name || found.name)) || ip)}</span>`;
                    }).join(' ');
                return `
                <div class="ncsw-route-card">
                    <div class="ncsw-route-card-meta">
                        <div class="ncsw-route-card-chain">
                            <span class="ncsw-route-part">${esc(r.channel_name || r.channel)}</span>
                            <span class="ncsw-route-arrow">→</span>
                            <span class="ncsw-route-part">${esc(r.category_label || r.chat_category)}</span>
                            <span class="ncsw-route-arrow">→</span>
                            <span class="ncsw-route-part ncsw-route-part-profile">🤖 ${esc(r.agent_name || r.ai_agent_profile)}</span>
                        </div>
                        <div class="ncsw-route-card-access">${accessLabel}</div>
                    </div>
                    <button class="btn btn-default btn-sm ncsw-edit-route-btn" data-route="${esc(r.name)}">
                        Edit →
                    </button>
                </div>`;
            }).join('');

            existingRoutesHtml = `
                <div class="ncsw-existing-routes-panel">
                    <div class="ncsw-existing-routes-header">
                        <span class="ncsw-existing-routes-title">Existing Routes</span>
                        <span class="ncsw-hint" style="margin-top:0;">Click a route to load it for reconfiguration</span>
                    </div>
                    <div class="ncsw-route-cards">${routeCards}</div>
                </div>
                <div class="ncsw-divider-label">— or configure a new route below —</div>
            `;
        }

        $('#ncsw_content_panel').html(`
            <div class="ncsw-step-content">
                <div class="ncsw-step-heading">
                    <div class="ncsw-step-num">Step 1</div>
                    <h3>Select Tenant &amp; Channel</h3>
                    <p>Start by choosing the tenant and the live channel you want to configure. Each channel can have multiple categories and routing rules.</p>
                </div>
                ${existingRoutesHtml}
                <div class="ncsw-field-group">
                    <label>Tenant <span class="ncsw-req">*</span></label>
                    <select id="ncsw_tenant" class="form-control">
                        <option value="">— Select Tenant —</option>
                        ${tenantOptions}
                    </select>
                </div>
                <div class="ncsw-field-group" style="margin-top:16px;">
                    <label>Channel <span class="ncsw-req">*</span></label>
                    <select id="ncsw_channel" class="form-control">
                        <option value="">— Select Channel —</option>
                        ${channelOptions}
                    </select>
                    <div class="ncsw-hint">The channel is the entry point (e.g. Website Chat, Internal Chat).</div>
                </div>
                <div class="ncsw-info-box" style="margin-top:28px;">
                    <strong>What this step does:</strong><br>
                    Scopes all subsequent configuration to this specific tenant and channel.
                </div>
            </div>
        `);

        $('#ncsw_tenant').on('change', function () { W.tenant = $(this).val(); renderStep1(); });
        $('#ncsw_channel').on('change', function () {
            W.channel = $(this).val();
            W.channel_name = $(this).find('option:selected').text().trim();
        });

        // Edit existing route
        $('#ncsw_content_panel').on('click', '.ncsw-edit-route-btn', function () {
            loadRouteForEdit($(this).data('route'));
        });
    }

    // ── Load existing route into wizard ────────────────────────────────────────
    function loadRouteForEdit(routeName) {
        const route = W.existing_routes.find(r => r.name === routeName);
        if (!route) return;

        // Find channel info
        const ch = W.channels.find(c => c.name === route.channel) || {};

        W.tenant            = route.tenant || ch.tenant || '';
        W.channel           = route.channel;
        W.channel_name      = route.channel_name || route.channel;
        W.category          = route.chat_category;
        W.category_label    = route.category_label || route.chat_category;
        W.category_mode     = 'existing';
        W.profile           = route.ai_agent_profile;
        W.profile_name      = route.agent_name || route.ai_agent_profile;
        W.profile_mode      = 'existing';
        W.existing_route    = route.name;

        // Resolve identity profiles with full records
        W.route_identity_profiles = (route.identity_profiles || []).map(ipName => {
            const found = W.identity_profiles.find(p => p.name === ipName);
            return found || { name: ipName, profile_name: ipName, title: '' };
        });

        // Load categories for the channel (needed if user navigates back to step 2)
        loadCategoriesForChannel(W.channel, () => {
            // Jump to step 5 (Review) so they can see the full config and edit any step
            goToStep(5);
        });
    }

    // ── Step 2: Chat Category ─────────────────────────────────────────────────
    function renderStep2() {
        const doRender = () => {
            const catOptions = W.categories.map(c =>
                `<option value="${esc(c.name)}" ${W.category === c.name ? 'selected' : ''}>${esc(c.category_label)} (${esc(c.category_code)})</option>`
            ).join('');

            $('#ncsw_content_panel').html(`
                <div class="ncsw-step-content">
                    <div class="ncsw-step-heading">
                        <div class="ncsw-step-num">Step 2</div>
                        <h3>Chat Category</h3>
                        <p>A category is the topic a visitor selects in the chat widget. It scopes the conversation to the right agent and routing rules.</p>
                    </div>
                    <div class="ncsw-toggle-group">
                        <button class="ncsw-toggle-btn ${W.category_mode === 'existing' ? 'active' : ''}" data-mode="existing">Use Existing</button>
                        <button class="ncsw-toggle-btn ${W.category_mode === 'new' ? 'active' : ''}" data-mode="new">Create New</button>
                    </div>
                    ${W.category_mode === 'existing' ? `
                        <div class="ncsw-field-group">
                            <label>Select Category <span class="ncsw-req">*</span></label>
                            ${W.categories.length
                                ? `<select id="ncsw_cat_select" class="form-control">
                                        <option value="">— Select —</option>${catOptions}
                                   </select>`
                                : `<div class="ncsw-empty-note">No categories for this channel yet. Switch to <b>Create New</b>.</div>`}
                        </div>
                    ` : `
                        <div class="ncsw-form-grid">
                            <div class="ncsw-field-group">
                                <label>Category Label <span class="ncsw-req">*</span></label>
                                <input id="ncsw_cat_label" class="form-control" type="text" placeholder="e.g. Customer Support" value="${esc(W.category_label)}">
                                <div class="ncsw-hint">What the visitor sees in the widget.</div>
                            </div>
                            <div class="ncsw-field-group">
                                <label>Display Order</label>
                                <input id="ncsw_cat_order" class="form-control" type="number" value="${W.category_display_order}" min="1">
                            </div>
                            <div class="ncsw-field-group">
                                <label>Visibility</label>
                                <select id="ncsw_cat_vis" class="form-control">
                                    ${['External','Internal','Both'].map(v => `<option ${W.category_visibility===v?'selected':''}>${v}</option>`).join('')}
                                </select>
                            </div>
                            <div class="ncsw-field-group">
                                <label>Identity Verification</label>
                                <select id="ncsw_cat_verif" class="form-control">
                                    ${['None','Email OTP','Registered Email OTP'].map(v => `<option ${W.category_verification===v?'selected':''}>${v}</option>`).join('')}
                                </select>
                            </div>
                            <div class="ncsw-field-group ncsw-checkbox-group">
                                <label><input type="checkbox" id="ncsw_cat_fallback" ${W.category_allow_fallback?'checked':''}> Allow Public Fallback</label>
                                <label><input type="checkbox" id="ncsw_cat_esc" ${W.category_escalation?'checked':''}> Enable Human Escalation</label>
                            </div>
                            <div class="ncsw-field-group" style="grid-column:1/-1;">
                                <label>Description</label>
                                <textarea id="ncsw_cat_desc" class="form-control" rows="2" placeholder="Optional admin note">${esc(W.category_description)}</textarea>
                            </div>
                        </div>
                    `}
                    <div class="ncsw-info-box" style="margin-top:20px;">
                        <strong>Chain so far:</strong><br>
                        <span class="ncsw-chain">${esc(W.channel_name || W.channel)} → <em>Category (this step)</em></span>
                    </div>
                </div>
            `);

            $('.ncsw-toggle-btn').on('click', function () { W.category_mode = $(this).data('mode'); renderStep2(); });
            $('#ncsw_cat_select').on('change', function () {
                W.category = $(this).val();
                const cat = W.categories.find(c => c.name === W.category);
                if (cat) { W.category_label = cat.category_label; W.category_code = cat.category_code; }
            });
            $('#ncsw_cat_label').on('input',    function () { W.category_label          = $(this).val(); });
            $('#ncsw_cat_order').on('change',   function () { W.category_display_order  = +$(this).val(); });
            $('#ncsw_cat_vis').on('change',     function () { W.category_visibility     = $(this).val(); });
            $('#ncsw_cat_verif').on('change',   function () { W.category_verification   = $(this).val(); });
            $('#ncsw_cat_fallback').on('change',function () { W.category_allow_fallback = $(this).is(':checked'); });
            $('#ncsw_cat_esc').on('change',     function () { W.category_escalation     = $(this).is(':checked'); });
            $('#ncsw_cat_desc').on('input',     function () { W.category_description    = $(this).val(); });
        };

        loadCategoriesForChannel(W.channel, doRender);
    }

    // ── Step 3: AI Agent Profile ──────────────────────────────────────────────
    function renderStep3() {
        const profileOptions = W.profiles.map(p =>
            `<option value="${esc(p.name)}" ${W.profile === p.name ? 'selected' : ''}>${esc(p.agent_name || p.name)}</option>`
        ).join('');

        $('#ncsw_content_panel').html(`
            <div class="ncsw-step-content">
                <div class="ncsw-step-heading">
                    <div class="ncsw-step-num">Step 3</div>
                    <h3>AI Agent Profile</h3>
                    <p>The Agent Profile defines the AI's name, personality, and behaviour. Knowledge access is controlled separately through Identity Profiles and Knowledge Profiles.</p>
                </div>
                <div class="ncsw-toggle-group">
                    <button class="ncsw-toggle-btn ${W.profile_mode === 'existing' ? 'active' : ''}" data-mode="existing">Use Existing</button>
                    <button class="ncsw-toggle-btn ${W.profile_mode === 'new' ? 'active' : ''}" data-mode="new">Create New</button>
                </div>
                ${W.profile_mode === 'existing' ? `
                    <div class="ncsw-field-group">
                        <label>Select Agent Profile <span class="ncsw-req">*</span></label>
                        ${W.profiles.length
                            ? `<select id="ncsw_prof_select" class="form-control">
                                    <option value="">— Select —</option>${profileOptions}
                               </select>`
                            : `<div class="ncsw-empty-note">No profiles yet. Switch to <b>Create New</b>.</div>`}
                    </div>
                ` : `
                    <div class="ncsw-form-grid">
                        <div class="ncsw-field-group">
                            <label>Profile Name <span class="ncsw-req">*</span></label>
                            <input id="ncsw_prof_name" class="form-control" type="text" placeholder="e.g. Nexus Support Bot" value="${esc(W.profile_name)}">
                        </div>
                        <div class="ncsw-field-group">
                            <label>Display Name</label>
                            <input id="ncsw_prof_display" class="form-control" type="text" placeholder="e.g. Nexus" value="${esc(W.profile_display_name)}">
                            <div class="ncsw-hint">Shown to visitors in the chat header.</div>
                        </div>
                        <div class="ncsw-field-group">
                            <label>Agent Role</label>
                            <select id="ncsw_prof_role" class="form-control">
                                ${['Public Responder','Sales','Support','Consultant','Internal Assistant','Admin Reviewer'].map(r =>
                                    `<option ${W.profile_role===r?'selected':''}>${r}</option>`).join('')}
                            </select>
                        </div>
                        <div class="ncsw-field-group">
                            <label>Tone</label>
                            <input id="ncsw_prof_tone" class="form-control" type="text" placeholder="e.g. Professional, Friendly" value="${esc(W.profile_tone)}">
                        </div>
                        <div class="ncsw-field-group">
                            <label>Response Style</label>
                            <input id="ncsw_prof_style" class="form-control" type="text" placeholder="e.g. Concise, Detailed" value="${esc(W.profile_response_style)}">
                        </div>
                        <div class="ncsw-field-group">
                            <label>Confidence Threshold</label>
                            <input id="ncsw_prof_conf" class="form-control" type="number" step="0.05" min="0" max="1" value="${W.profile_confidence}">
                            <div class="ncsw-hint">Below this score the AI escalates or uses fallback (0–1). Default: 0.65.</div>
                        </div>
                        <div class="ncsw-field-group ncsw-checkbox-group">
                            <label><input type="checkbox" id="ncsw_prof_esc" ${W.profile_escalation?'checked':''}> Enable Escalation to Human Agent</label>
                        </div>
                        <div class="ncsw-field-group">
                            <label>Memory Mode</label>
                            <select id="ncsw_prof_memory" class="form-control">
                                ${['None','Session','Conversation Summary','Long Term'].map(m =>
                                    `<option ${W.profile_memory===m?'selected':''}>${m}</option>`).join('')}
                            </select>
                        </div>
                        <div class="ncsw-field-group" style="grid-column:1/-1;">
                            <label>Behavior Prompt</label>
                            <textarea id="ncsw_prof_behavior" class="form-control" rows="3" placeholder="Describe the agent's purpose, what it should and should not discuss…">${esc(W.profile_behavior)}</textarea>
                        </div>
                        <div class="ncsw-field-group">
                            <label>Welcome Message</label>
                            <textarea id="ncsw_prof_welcome" class="form-control" rows="2" placeholder="Hi! How can I help you today?">${esc(W.profile_welcome)}</textarea>
                        </div>
                        <div class="ncsw-field-group">
                            <label>Fallback Message</label>
                            <textarea id="ncsw_prof_fallback" class="form-control" rows="2" placeholder="I don't have enough information to answer that.">${esc(W.profile_fallback)}</textarea>
                        </div>
                    </div>
                    <div class="ncsw-knowledge-note">
                        <strong>ℹ Knowledge access</strong> is governed by Identity Profiles and Knowledge Profiles — not by the agent profile directly. Configure those in <b>Nexus Identity Profile</b> after completing this wizard.
                    </div>
                `}
                <div class="ncsw-info-box" style="margin-top:20px;">
                    <strong>Chain so far:</strong><br>
                    <span class="ncsw-chain">${esc(W.channel_name || W.channel)} → ${esc(W.category_label || W.category)} → <em>Agent Profile (this step)</em></span>
                </div>
            </div>
        `);

        $('.ncsw-toggle-btn').on('click', function () { W.profile_mode = $(this).data('mode'); renderStep3(); });
        $('#ncsw_prof_select').on('change', function () {
            W.profile = $(this).val();
            const p = W.profiles.find(x => x.name === W.profile);
            if (p) W.profile_name = p.agent_name || p.name;
        });
        $('#ncsw_prof_name').on('input',    function () { W.profile_name           = $(this).val(); });
        $('#ncsw_prof_display').on('input', function () { W.profile_display_name   = $(this).val(); });
        $('#ncsw_prof_role').on('change',   function () { W.profile_role           = $(this).val(); });
        $('#ncsw_prof_tone').on('input',    function () { W.profile_tone           = $(this).val(); });
        $('#ncsw_prof_style').on('input',   function () { W.profile_response_style = $(this).val(); });
        $('#ncsw_prof_conf').on('change',   function () { W.profile_confidence     = parseFloat($(this).val()) || 0.65; });
        $('#ncsw_prof_esc').on('change',    function () { W.profile_escalation     = $(this).is(':checked'); });
        $('#ncsw_prof_memory').on('change', function () { W.profile_memory         = $(this).val(); });
        $('#ncsw_prof_behavior').on('input',function () { W.profile_behavior       = $(this).val(); });
        $('#ncsw_prof_welcome').on('input', function () { W.profile_welcome        = $(this).val(); });
        $('#ncsw_prof_fallback').on('input',function () { W.profile_fallback       = $(this).val(); });
    }

    // ── Step 4: Identity Route ────────────────────────────────────────────────
    function renderStep4() {
        // Pre-fill existing route state
        if (!W.existing_route) {
            const match = W.existing_routes.find(r =>
                r.channel === W.channel && r.chat_category === W.category
            );
            if (match) {
                W.existing_route = match.name;
                if (!W.route_identity_profiles.length) {
                    W.route_identity_profiles = (match.identity_profiles || []).map(name => {
                        const ip = W.identity_profiles.find(p => p.name === name);
                        return ip || { name, profile_name: name, title: '' };
                    });
                }
            }
        }

        const isOpenToAll = W.route_identity_profiles.length === 0;

        const ipOptions = W.identity_profiles
            .filter(ip => !W.route_identity_profiles.find(s => s.name === ip.name))
            .map(ip =>
                `<option value="${esc(ip.name)}">${esc(ip.profile_name || ip.name)}${ip.title ? ' — ' + esc(ip.title) : ''}</option>`
            ).join('');

        const selectedChips = W.route_identity_profiles.map(ip => {
            // Resolve mappings from full identity_profiles list (has the enriched mappings)
            const full = W.identity_profiles.find(p => p.name === ip.name) || ip;
            const mappings = full.mappings || [];
            const mappingRows = mappings.length
                ? mappings.map(m => `
                    <div class="ncsw-ip-mapping-row">
                        <span class="ncsw-ip-mapping-type">${esc(m.identity_type_label || m.identity_type)}</span>
                        <span class="ncsw-ip-mapping-arrow">→</span>
                        <span class="ncsw-ip-mapping-kp">${esc(m.knowledge_profile_label || m.knowledge_profile)}</span>
                    </div>`).join('')
                : `<div class="ncsw-ip-mapping-none">No knowledge mappings configured</div>`;
            return `
            <div class="ncsw-ip-card" data-name="${esc(ip.name)}">
                <div class="ncsw-ip-card-header">
                    <div>
                        <span class="ncsw-ip-chip-name">${esc(ip.profile_name || ip.name)}</span>
                        ${ip.title ? `<span class="ncsw-ip-chip-title">${esc(ip.title)}</span>` : ''}
                    </div>
                    <button class="ncsw-ip-remove" data-name="${esc(ip.name)}">✕ Remove</button>
                </div>
                <div class="ncsw-ip-mappings">
                    <div class="ncsw-ip-mappings-label">Knowledge Profiles via Identity Type</div>
                    ${mappingRows}
                </div>
            </div>`;
        }).join('');

        $('#ncsw_content_panel').html(`
            <div class="ncsw-step-content">
                <div class="ncsw-step-heading">
                    <div class="ncsw-step-num">Step 4</div>
                    <h3>Access Route</h3>
                    <p>A route connects the category to the agent profile. Optionally restrict access by selecting permitted Identity Profiles — or leave it open to all visitors.</p>
                </div>

                <div class="ncsw-profile-summary">
                    <div>
                        <div class="ncsw-profile-summary-label">Agent Profile</div>
                        <div class="ncsw-profile-summary-name">🤖 ${esc(W.profile_name || W.profile || '—')}</div>
                    </div>
                    ${W.existing_route
                        ? `<span class="ncsw-exists-badge" style="margin-left:auto;">Existing route will be updated</span>`
                        : `<span class="ncsw-new-badge" style="margin-left:auto;">New route will be created</span>`}
                </div>

                <div class="ncsw-route-access-section">
                    <div class="ncsw-route-access-header">
                        <div class="ncsw-field-group" style="margin-bottom:0; flex:1;">
                            <label style="margin-bottom:4px;">Permitted Identity Profiles</label>
                            <div class="ncsw-hint">
                                Visitors whose assigned Identity Profiles match the list below can use this route.<br>
                                Leave the list empty to allow <b>any visitor</b> (open / public access).
                            </div>
                        </div>
                        <div class="ncsw-open-all-badge ${isOpenToAll ? 'active' : ''}">
                            ${isOpenToAll ? '🌐 Open to All' : '🔒 Restricted'}
                        </div>
                    </div>

                    <div class="ncsw-ip-cards" id="ncsw_ip_chips" style="margin-top:12px;">
                        ${selectedChips || '<div class="ncsw-ip-placeholder">No profiles selected — route will be open to all visitors.</div>'}
                    </div>

                    ${W.identity_profiles.length ? `
                        <div style="display:flex; gap:8px; margin-top:10px;">
                            <select id="ncsw_ip_picker" class="form-control" style="flex:1;">
                                <option value="">— Add Identity Profile —</option>${ipOptions}
                            </select>
                            <button class="btn btn-default btn-sm" id="ncsw_ip_add">Add</button>
                        </div>
                    ` : `
                        <div class="ncsw-empty-note" style="margin-top:10px;">
                            No Identity Profiles exist yet. The route will be open to all visitors.<br>
                            Create profiles in <b>Nexus Identity Profile</b> to restrict access.
                        </div>
                    `}
                </div>

                <div class="ncsw-info-box" style="margin-top:24px;">
                    <strong>Chain so far:</strong><br>
                    <span class="ncsw-chain">${esc(W.channel_name || W.channel)} → ${esc(W.category_label || W.category)} → ${esc(W.profile_name || W.profile)} → <em>Route (this step)</em></span>
                </div>
            </div>
        `);

        $('#ncsw_ip_add').on('click', function () {
            const sel = $('#ncsw_ip_picker');
            const name = sel.val();
            if (!name) return;
            const ip = W.identity_profiles.find(p => p.name === name);
            if (!ip) return;
            W.route_identity_profiles.push(ip);
            renderStep4();
        });
        $('#ncsw_content_panel').off('click', '.ncsw-ip-remove').on('click', '.ncsw-ip-remove', function () {
            const name = $(this).data('name');
            W.route_identity_profiles = W.route_identity_profiles.filter(p => p.name !== name);
            renderStep4();
        });
    }

    // ── Step 5: Review ────────────────────────────────────────────────────────
    function renderStep5() {
        const isOpenToAll = W.route_identity_profiles.length === 0;

        const profileChips = W.route_identity_profiles.map(ip =>
            `<span class="ncsw-ac-chip-small">${esc(ip.profile_name || ip.name)}</span>`
        ).join('') || '<em style="color:#6b7c9b;">Open to all visitors</em>';

        const categoryInfo = W.category_mode === 'new'
            ? `<b>${esc(W.category_label)}</b> <span class="ncsw-new-badge">new</span>`
            : `<b>${esc(W.category_label || W.category)}</b> <span class="ncsw-exists-badge">existing</span>`;

        const profileInfo = W.profile_mode === 'new'
            ? `<b>${esc(W.profile_name)}</b> <span class="ncsw-new-badge">new</span>`
            : `<b>${esc(W.profile_name || W.profile)}</b> <span class="ncsw-exists-badge">existing</span>`;

        $('#ncsw_content_panel').html(`
            <div class="ncsw-step-content">
                <div class="ncsw-step-heading">
                    <div class="ncsw-step-num">Step 5</div>
                    <h3>Review &amp; Save</h3>
                    <p>Review the complete configuration below. Click <b>Finish &amp; Save</b> to apply. You can go back to any step to make changes.</p>
                </div>

                <div class="ncsw-review-card">
                    <div class="ncsw-review-section ncsw-review-editable" data-goto="1" title="Edit channel">
                        <div class="ncsw-review-label">Channel</div>
                        <div class="ncsw-review-val"><b>${esc(W.channel_name || W.channel)}</b></div>
                        <div class="ncsw-review-edit-hint">Edit →</div>
                    </div>
                    <div class="ncsw-review-section ncsw-review-editable" data-goto="2" title="Edit category">
                        <div class="ncsw-review-label">Category</div>
                        <div class="ncsw-review-val">${categoryInfo}</div>
                        <div class="ncsw-review-edit-hint">Edit →</div>
                    </div>
                    <div class="ncsw-review-section ncsw-review-editable" data-goto="3" title="Edit agent profile">
                        <div class="ncsw-review-label">Agent Profile</div>
                        <div class="ncsw-review-val">${profileInfo}</div>
                        <div class="ncsw-review-edit-hint">Edit →</div>
                    </div>
                    <div class="ncsw-review-section ncsw-review-editable" data-goto="4" title="Edit access route">
                        <div class="ncsw-review-label">Route Access</div>
                        <div class="ncsw-review-val">
                            ${isOpenToAll
                                ? '<span class="ncsw-exists-badge">🌐 Open to all visitors</span>'
                                : profileChips}
                        </div>
                        <div class="ncsw-review-edit-hint">Edit →</div>
                    </div>
                    <div class="ncsw-review-section">
                        <div class="ncsw-review-label">Route Action</div>
                        <div class="ncsw-review-val">
                            ${W.existing_route
                                ? `<span class="ncsw-exists-badge">Update existing route</span>`
                                : `<span class="ncsw-new-badge">Create new route</span>`}
                        </div>
                    </div>
                </div>

                <div id="ncsw_save_result"></div>
            </div>
        `);

        $('#ncsw_content_panel').on('click', '.ncsw-review-editable', function () {
            goToStep(+$(this).data('goto'));
        });
    }

    // ── Save Actions ──────────────────────────────────────────────────────────
    function createCategory() {
        return frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_channel_setup_wizard.save_category',
            args: {
                channel:                    W.channel,
                tenant:                     W.tenant,
                category_label:             W.category_label,
                visibility:                 W.category_visibility,
                identity_verification_mode: W.category_verification,
                allow_public_fallback:      W.category_allow_fallback ? 1 : 0,
                enable_escalation:          W.category_escalation ? 1 : 0,
                description:                W.category_description,
                display_order:              W.category_display_order,
            },
            callback(r) {
                if (r.message && r.message.name) {
                    W.category      = r.message.name;
                    W.category_code = r.message.category_code || '';
                }
            },
        });
    }

    function createProfile() {
        return frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_channel_setup_wizard.save_agent_profile',
            args: {
                tenant:               W.tenant,
                channel:              W.channel,
                agent_name:           W.profile_name,
                display_name:         W.profile_display_name || W.profile_name,
                agent_role:           W.profile_role,
                tone:                 W.profile_tone,
                response_style:       W.profile_response_style,
                confidence_threshold: W.profile_confidence,
                escalation_enabled:   W.profile_escalation ? 1 : 0,
                memory_mode:          W.profile_memory,
                behavior_prompt:      W.profile_behavior,
                welcome_message:      W.profile_welcome,
                fallback_message:     W.profile_fallback,
            },
            callback(r) {
                if (r.message && r.message.name) {
                    W.profile      = r.message.name;
                    W.profile_name = r.message.agent_name || W.profile_name;
                }
            },
        });
    }

    function finishWizard() {
        $('#ncsw_finish').prop('disabled', true).text('Saving…');
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_channel_setup_wizard.save_route',
            args: {
                channel:           W.channel,
                chat_category:     W.category,
                ai_agent_profile:  W.profile,
                identity_profiles: JSON.stringify(W.route_identity_profiles.map(p => p.name)),
                existing_route:    W.existing_route || null,
            },
            callback(r) {
                $('#ncsw_finish').prop('disabled', false).text('✓ Finish & Save');
                if (r.message && r.message.status === 'success') {
                    W.existing_route = r.message.route_name;
                    const action = r.message.created ? 'created' : 'updated';
                    $('#ncsw_save_result').html(`
                        <div class="ncsw-success-box">
                            <div class="ncsw-success-icon">✓</div>
                            <div>
                                <div class="ncsw-success-title">Configuration saved successfully!</div>
                                <div class="ncsw-success-body">
                                    Route ${action}: <b>${esc(r.message.route_name)}</b><br>
                                    Access: ${r.message.open_to_all ? '🌐 Open to all visitors' : '🔒 Restricted to selected identity profiles'}<br><br>
                                    <a href="#" onclick="frappe.set_route('nexus-category-profile-routes'); return false;" style="color:#2158c7; font-weight:700;">→ View in Category Profile Routes</a>
                                    &nbsp;&nbsp;
                                    <a href="#" id="ncsw_start_over" style="color:#6b7c9b; font-weight:700;">Configure another route →</a>
                                </div>
                            </div>
                        </div>
                    `);
                    $('#ncsw_start_over').on('click', function (e) {
                        e.preventDefault();
                        W.category_mode = 'existing'; W.category = ''; W.category_label = '';
                        W.profile_mode = 'existing'; W.profile = ''; W.profile_name = '';
                        W.route_identity_profiles = []; W.existing_route = null;
                        goToStep(2);
                    });
                } else {
                    $('#ncsw_save_result').html(`<div class="ncsw-error-box">Failed to save route. Check the error log for details.</div>`);
                }
            },
            error() {
                $('#ncsw_finish').prop('disabled', false).text('✓ Finish & Save');
                $('#ncsw_save_result').html(`<div class="ncsw-error-box">An error occurred. Check the error log.</div>`);
            },
        });
    }

    // ── Utilities ─────────────────────────────────────────────────────────────
    function esc(s) { return frappe.utils.escape_html(String(s || '')); }

    // ── CSS ───────────────────────────────────────────────────────────────────
    function inject_wizard_css() {
        if ($('#ncsw_css').length) return;
        $('head').append(`<style id="ncsw_css">
.ncsw-wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 60px; }

/* Header */
.ncsw-header { padding: 32px 36px; border-radius: 22px; margin-bottom: 28px;
    background: radial-gradient(circle at 8% 20%, rgba(77,163,255,.26), transparent 30%),
                radial-gradient(circle at 92% 10%, rgba(224,166,47,.18), transparent 28%),
                linear-gradient(135deg, #fff 0%, #eef6ff 50%, #f8fbff 100%);
    border: 1px solid rgba(77,163,255,.35); box-shadow: 0 16px 40px rgba(33,77,187,.1); }
.ncsw-badge { display: inline-flex; padding: 6px 14px; border-radius: 999px;
    background: rgba(33,77,187,.08); border: 1px solid rgba(33,77,187,.15);
    color: #214dbb; font-weight: 800; font-size: 11px; letter-spacing: .05em;
    text-transform: uppercase; margin-bottom: 10px; }
.ncsw-header h2 { margin: 0 0 8px; font-size: 26px; font-weight: 900; color: #102b67; }
.ncsw-header p  { margin: 0; color: #3d5280; font-size: 14px; line-height: 1.65; max-width: 700px; }

/* Progress bar */
.ncsw-bar-track { height: 4px; background: #e8eef7; border-radius: 999px; margin-bottom: 28px; }
.ncsw-bar-fill  { height: 100%; border-radius: 999px;
    background: linear-gradient(90deg, #2158c7, #818cf8); transition: width .4s ease; }

/* Layout */
.ncsw-body { display: grid; grid-template-columns: 220px 1fr; gap: 24px; align-items: start; }

/* Steps panel */
.ncsw-steps-panel { display: flex; flex-direction: column; gap: 0;
    background: #fff; border: 1px solid rgba(77,163,255,.22); border-radius: 18px;
    padding: 16px 0; box-shadow: 0 8px 24px rgba(33,77,187,.07); position: sticky; top: 68px; }
.ncsw-step-item { display: flex; align-items: center; gap: 12px; padding: 12px 18px;
    border-radius: 10px; margin: 2px 8px; transition: background .15s; }
.ncsw-step-item.done { cursor: pointer; }
.ncsw-step-item.done:hover { background: #f0f6ff; }
.ncsw-step-item.active { background: #eef6ff; }
.ncsw-step-connector { height: 1px; background: #e8eef7; margin: 0 18px; }
.ncsw-step-dot { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; font-size: 15px;
    background: #f0f4fb; border: 2px solid #d4deee; transition: all .2s; }
.ncsw-step-item.active .ncsw-step-dot { background: #2158c7; border-color: #2158c7;
    color: #fff; font-size: 13px; box-shadow: 0 4px 12px rgba(33,88,199,.35); }
.ncsw-step-item.done .ncsw-step-dot { background: #16a37f; border-color: #16a37f; }
.ncsw-step-item.done .ncsw-step-dot svg { width: 16px; height: 16px; }
.ncsw-step-label { font-size: 13px; font-weight: 700; color: #53688f; }
.ncsw-step-item.active .ncsw-step-label { color: #102b67; font-weight: 900; }
.ncsw-step-item.done .ncsw-step-label { color: #16a37f; }

/* Content panel */
.ncsw-content-panel { background: #fff; border: 1px solid rgba(77,163,255,.22);
    border-radius: 22px; padding: 32px 36px; box-shadow: 0 8px 24px rgba(33,77,187,.07); min-height: 420px; }
.ncsw-step-heading { margin-bottom: 28px; }
.ncsw-step-num { font-size: 11px; font-weight: 900; color: #6b7c9b;
    text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
.ncsw-step-heading h3 { margin: 0 0 8px; font-size: 20px; font-weight: 900; color: #102b67; }
.ncsw-step-heading p  { margin: 0; color: #53688f; font-size: 13.5px; line-height: 1.65; }

/* Forms */
.ncsw-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.ncsw-field-group { display: flex; flex-direction: column; gap: 5px; }
.ncsw-field-group label { font-size: 12px; font-weight: 900; color: #173b8c; }
.ncsw-req { color: #b42318; }
.ncsw-hint { font-size: 11px; color: #6b7c9b; margin-top: 2px; line-height: 1.4; }
.ncsw-checkbox-group { flex-direction: row; flex-wrap: wrap; gap: 16px; padding-top: 20px; }
.ncsw-checkbox-group label { font-weight: 600; color: #27416f; cursor: pointer;
    display: flex; align-items: center; gap: 6px; }

/* Toggle buttons */
.ncsw-toggle-group { display: flex; gap: 8px; margin-bottom: 24px; }
.ncsw-toggle-btn { padding: 8px 20px; border-radius: 999px; border: 1.5px solid #c7d7f0;
    background: #f8fbff; color: #53688f; font-weight: 700; font-size: 13px; cursor: pointer; transition: all .15s; }
.ncsw-toggle-btn.active { background: #2158c7; color: #fff; border-color: #2158c7; }

/* Info boxes */
.ncsw-info-box { padding: 12px 16px; border-radius: 12px; background: #eff6ff;
    border: 1px solid #bfdbfe; color: #1d4ed8; font-size: 12px; font-weight: 600; line-height: 1.65; }
.ncsw-knowledge-note { padding: 12px 16px; border-radius: 12px; background: #fefce8;
    border: 1px solid #fde68a; color: #854d0e; font-size: 12px; font-weight: 600;
    line-height: 1.65; margin-top: 16px; }
.ncsw-chain { font-family: monospace; font-size: 12px; color: #214dbb; }
.ncsw-empty-note { padding: 12px 16px; border-radius: 10px; background: #fff7e6;
    border: 1px solid #f2d49b; color: #8a5d00; font-size: 12px; font-weight: 700; }
.ncsw-error { color: #b42318; font-size: 12px; font-weight: 800; padding: 10px 14px;
    background: #fff0f0; border: 1px solid #ffd1d1; border-radius: 10px; margin-top: 16px; }

/* Chips */
.ncsw-ac-chip-small { display: inline-flex; padding: 3px 9px; border-radius: 999px;
    background: #eef6ff; color: #173b8c; border: 1px solid rgba(33,77,187,.2);
    font-size: 11px; font-weight: 800; margin: 2px; }

/* Profile summary */
.ncsw-profile-summary { display: flex; align-items: center; gap: 12px; padding: 14px 18px;
    border-radius: 14px; background: #f0f6ff; border: 1px solid #bfdbfe; margin-bottom: 20px; flex-wrap:wrap; }
.ncsw-profile-summary-label { font-size: 11px; font-weight: 900; color: #6b7c9b;
    text-transform: uppercase; letter-spacing: .05em; }
.ncsw-profile-summary-name { font-size: 14px; font-weight: 800; color: #102b67; }

/* Route access section */
.ncsw-route-access-section { border: 1px solid #e2eaf8; border-radius: 18px;
    padding: 20px; background: #fafcff; }
.ncsw-route-access-header { display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; }
.ncsw-open-all-badge { padding: 6px 14px; border-radius: 999px; font-size: 11px; font-weight: 800;
    background: #f8f9fa; color: #6b7c9b; border: 1px solid #d4deee; flex-shrink: 0; white-space:nowrap; }
.ncsw-open-all-badge.active { background: #ecfdf3; color: #15803d; border-color: #bdebd2; }

/* Identity profile cards (expanded with knowledge mappings) */
.ncsw-ip-cards { display: flex; flex-direction: column; gap: 10px; }
.ncsw-ip-placeholder { padding: 12px; color: #6b7c9b; font-size: 12px; font-weight: 600;
    font-style: italic; border: 1px dashed #d4deee; border-radius: 12px; text-align: center; }
.ncsw-ip-card { border: 1px solid rgba(33,77,187,.20); border-radius: 14px;
    background: #fafcff; overflow: hidden; }
.ncsw-ip-card-header { display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 10px 14px; background: #f0f6ff;
    border-bottom: 1px solid rgba(33,77,187,.12); }
.ncsw-ip-chip-name { font-size: 13px; font-weight: 900; color: #173b8c; }
.ncsw-ip-chip-title { font-size: 11px; color: #53688f; margin-left: 6px; }
.ncsw-ip-remove { border: 1px solid rgba(180,35,24,.25); background: #fff0f0;
    color: #b42318; cursor: pointer; font-size: 11px; font-weight: 800;
    padding: 4px 10px; border-radius: 999px; line-height: 1; }
.ncsw-ip-remove:hover { background: #ffe0e0; }
.ncsw-ip-mappings { padding: 10px 14px; display: flex; flex-direction: column; gap: 5px; }
.ncsw-ip-mappings-label { font-size: 10.5px; font-weight: 900; color: #6b7c9b;
    text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
.ncsw-ip-mapping-row { display: flex; align-items: center; gap: 8px; }
.ncsw-ip-mapping-type { font-size: 12px; font-weight: 700; color: #173b8c;
    background: #eef6ff; padding: 3px 9px; border-radius: 999px;
    border: 1px solid rgba(33,77,187,.18); white-space: nowrap; }
.ncsw-ip-mapping-arrow { font-size: 11px; color: #6b7c9b; flex-shrink: 0; }
.ncsw-ip-mapping-kp { font-size: 12px; font-weight: 800; color: #0e6655;
    background: #ecfffb; padding: 3px 9px; border-radius: 999px;
    border: 1px solid rgba(14,102,85,.18); white-space: nowrap; }
.ncsw-ip-mapping-none { font-size: 11px; color: #8a9bb5; font-style: italic; }

/* Badges */
.ncsw-exists-badge { display: inline-flex; padding: 3px 9px; border-radius: 999px;
    background: #ecfdf3; color: #15803d; border: 1px solid #bdebd2; font-size: 11px; font-weight: 800; }
.ncsw-new-badge    { display: inline-flex; padding: 3px 9px; border-radius: 999px;
    background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 11px; font-weight: 800; }

/* Review card */
.ncsw-review-card { border: 1px solid #e2eaf8; border-radius: 18px; overflow: hidden; margin-bottom: 20px; }
.ncsw-review-section { display: flex; align-items: flex-start; gap: 16px;
    padding: 16px 20px; border-bottom: 1px solid #f0f4fb; }
.ncsw-review-section:last-child { border-bottom: none; }
.ncsw-review-label { min-width: 130px; font-size: 11px; font-weight: 900; color: #6b7c9b;
    text-transform: uppercase; letter-spacing: .05em; padding-top: 3px; }
.ncsw-review-val { font-size: 13.5px; color: #173b8c; font-weight: 600; flex: 1; }

/* Result boxes */
.ncsw-success-box { display: flex; gap: 16px; padding: 18px 20px; border-radius: 16px;
    background: #ecfdf3; border: 1px solid #bdebd2; margin-top: 20px; }
.ncsw-success-icon { font-size: 24px; font-weight: 900; color: #16794c; flex-shrink: 0; }
.ncsw-success-title { font-size: 14px; font-weight: 900; color: #16794c; margin-bottom: 4px; }
.ncsw-success-body { font-size: 12.5px; color: #27416f; line-height: 1.6; }
.ncsw-error-box { padding: 14px 18px; border-radius: 12px; background: #fff0f0;
    border: 1px solid #ffd1d1; color: #b42318; font-weight: 800; font-size: 13px; margin-top: 16px; }

/* Footer */
.ncsw-footer { margin-top: 24px; }
.ncsw-footer-inner { display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; background: #fff; border: 1px solid #e2eaf8; border-radius: 16px;
    box-shadow: 0 4px 12px rgba(33,77,187,.06); }
.ncsw-back-btn, .ncsw-next-btn, .ncsw-finish-btn { border-radius: 999px; font-weight: 800; padding: 8px 24px; }
.ncsw-finish-btn { background: #16a37f; border-color: #16a37f; }
.ncsw-finish-btn:hover { background: #0e8c6b; border-color: #0e8c6b; }
.ncsw-step-indicator { font-size: 12px; font-weight: 700; color: #6b7c9b; }
.ncsw-loading { text-align: center; padding: 60px; color: #6b7c9b; font-weight: 700; }

/* Editable review rows */
.ncsw-review-editable { cursor: pointer; }
.ncsw-review-editable:hover { background: #f0f6ff; }
.ncsw-review-editable:hover .ncsw-review-label { color: #2158c7; }
.ncsw-review-edit-hint { font-size: 11px; font-weight: 800; color: #a0b0cc;
    margin-left: auto; flex-shrink: 0; white-space: nowrap; }
.ncsw-review-editable:hover .ncsw-review-edit-hint { color: #2158c7; }

/* Existing routes panel */
.ncsw-existing-routes-panel { margin-bottom: 20px; border: 1px solid rgba(33,77,187,.18);
    border-radius: 16px; overflow: hidden; }
.ncsw-existing-routes-header { display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; background: #f0f5ff; border-bottom: 1px solid rgba(33,77,187,.12); gap: 12px; }
.ncsw-existing-routes-title { font-size: 12px; font-weight: 900; color: #173b8c;
    text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
.ncsw-route-cards { display: flex; flex-direction: column; }
.ncsw-route-card { display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 12px 16px; border-bottom: 1px solid #f0f4fb; background: #fff;
    transition: background .15s; flex-wrap: wrap; }
.ncsw-route-card:last-child { border-bottom: none; }
.ncsw-route-card:hover { background: #f8fbff; }
.ncsw-route-card-meta { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 0; }
.ncsw-route-card-chain { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.ncsw-route-part { font-size: 12.5px; font-weight: 800; color: #173b8c;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
.ncsw-route-part-profile { color: #0e6655; }
.ncsw-route-arrow { font-size: 11px; color: #6b7c9b; flex-shrink: 0; }
.ncsw-route-card-access { display: flex; flex-wrap: wrap; gap: 4px; }
.ncsw-edit-route-btn { border-radius: 999px; font-weight: 800; white-space: nowrap; flex-shrink: 0; }
.ncsw-divider-label { text-align: center; font-size: 11px; font-weight: 700; color: #6b7c9b;
    margin: 16px 0; letter-spacing: .03em; }

/* Responsive */
@media (max-width: 820px) {
    .ncsw-body { grid-template-columns: 1fr; }
    .ncsw-steps-panel { position: static; flex-direction: row; flex-wrap: wrap; padding: 12px; gap: 6px; }
    .ncsw-step-connector { display: none; }
    .ncsw-step-item { padding: 8px 12px; }
    .ncsw-form-grid { grid-template-columns: 1fr; }
    .ncsw-content-panel { padding: 20px 18px; }
}
        </style>`);
    }
};

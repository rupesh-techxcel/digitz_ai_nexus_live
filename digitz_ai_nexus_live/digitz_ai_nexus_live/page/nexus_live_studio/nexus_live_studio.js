frappe.pages['nexus_live_studio'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Nexus Live Configuration',
        single_column: true,
    });

    const state = { data: null, activeSection: 'channels' };

    inject_css();
    $(page.body).html(buildShell());
    bindEvents();
    loadData();

    // ── Shell ──────────────────────────────────────────────────────────────────

    function buildShell() {
        return `
<div class="nlc-wrap">
    <div class="nlc-hero">
        <div class="nlc-hero-left">
            <div class="nlc-badge"><span class="nlc-pulse"></span>DIGITZ AI Nexus</div>
            <h1>Live Chat Configuration</h1>
            <p>Review readiness across every workflow layer — channels, agents, routes, identity access, and escalation.</p>
        </div>
        <div class="nlc-hero-right">
            <div class="nlc-score-ring">
                <svg viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="32" class="nlc-ring-bg"/>
                    <circle cx="40" cy="40" r="32" class="nlc-ring-fill" id="nlc-ring-fill"/>
                </svg>
                <div class="nlc-score-inner"><span id="nlc-score-pct">—</span><small>ready</small></div>
            </div>
            <div class="nlc-hero-actions">
                <button class="btn btn-primary" id="nlc-run-test">Run Workflow Test</button>
                <button class="btn btn-default" id="nlc-refresh">↺ Refresh</button>
            </div>
        </div>
    </div>

    <div class="nlc-nav">
        <div class="nlc-nav-item active" data-section="channels"><span class="nlc-nav-dot" id="dot-channels"></span>Channels</div>
        <div class="nlc-nav-item" data-section="agents"><span class="nlc-nav-dot" id="dot-agents"></span>AI Agents</div>
        <div class="nlc-nav-item" data-section="routes"><span class="nlc-nav-dot" id="dot-routes"></span>Routes & Access</div>
        <div class="nlc-nav-item" data-section="identity"><span class="nlc-nav-dot" id="dot-identity"></span>Identity</div>
        <div class="nlc-nav-item" data-section="escalation"><span class="nlc-nav-dot" id="dot-escalation"></span>Escalation</div>
    </div>

    <div id="nlc-loading" class="nlc-loading">Loading configuration…</div>
    <div id="nlc-body" style="display:none;"></div>
</div>`;
    }

    // ── Data ───────────────────────────────────────────────────────────────────

    function loadData() {
        $('#nlc-loading').show();
        $('#nlc-body').hide();
        frappe.call({
            method: 'digitz_ai_nexus_live.api.nexus_live_config.get_config_readiness',
            callback(r) {
                $('#nlc-loading').hide();
                if (!r.message) return;
                state.data = r.message;
                renderScore(state.data.score);
                renderNavDots(state.data);
                renderSection(state.activeSection);
                $('#nlc-body').show();
            },
        });
    }

    // ── Score ring ─────────────────────────────────────────────────────────────

    function renderScore(score) {
        $('#nlc-score-pct').text(score + '%');
        const circ = 2 * Math.PI * 32;
        const fill = circ * score / 100;
        const color = score >= 90 ? '#12b76a' : score >= 60 ? '#f79009' : '#f04438';
        $('#nlc-ring-fill').attr({ 'stroke-dasharray': `${fill} ${circ}`, stroke: color });
    }

    function renderNavDots(data) {
        ['channels', 'agents', 'routes', 'identity', 'escalation'].forEach(k => {
            const s = (data[k] || {}).status || 'incomplete';
            $('#dot-' + k).attr('class', 'nlc-nav-dot nlc-dot-' + s);
        });
    }

    // ── Section router ─────────────────────────────────────────────────────────

    function renderSection(key) {
        state.activeSection = key;
        if (!state.data) return;
        const d = state.data;
        const map = {
            channels:  () => buildChannelsSection(d.channels),
            agents:    () => buildAgentsSection(d.agents),
            routes:    () => buildRoutesSection(d.routes),
            identity:  () => buildIdentitySection(d.identity),
            escalation:() => buildEscalationSection(d.escalation),
        };
        $('#nlc-body').html((map[key] || (() => ''))());
    }

    // ── Channels & Categories ──────────────────────────────────────────────────

    function buildChannelsSection(d) {
        if (!d) return '';
        return `
<div class="nlc-section">
    ${secHead(d,
        [{ label:'Channels', value: d.counts.channels },
         { label:'Categories', value: d.counts.categories },
         { label:'Ready', value: `${d.counts.ready}/${d.counts.channels}` }],
        [{ label:'Manage Channels', route:'List/Nexus Live Channel' },
         { label:'Categories', page:'nexus-chat-category-manager' }]
    )}
    ${issues(d.issues)}
    <div class="nlc-cards">
        ${(d.items||[]).map(ch => `
        <div class="nlc-card ${ch.ready?'':'nlc-card-warn'}">
            <div class="nlc-card-head">
                <div>
                    <div class="nlc-card-title">${esc(ch.label)}</div>
                    <div class="nlc-card-sub">${esc(ch.type)}${ch.public?' · Public':''}</div>
                </div>
                ${chip(ch.ready?'ready':'incomplete')}
            </div>
            <div class="nlc-cat-rows">
                ${(ch.categories||[]).map(cat=>`
                <div class="nlc-cat-row">
                    <span class="nlc-dot-sm ${cat.ready?'nlc-dot-ready':'nlc-dot-incomplete'}"></span>
                    <span class="nlc-cat-label">${esc(cat.label)}</span>
                    <span class="nlc-muted">${cat.route_count} route${cat.route_count!==1?'s':''}</span>
                    <span class="nlc-verify-badge">${esc(cat.verify_mode)}</span>
                </div>`).join('')}
                ${!ch.categories.length?`<div class="nlc-empty-row">No enabled categories</div>`:''}
            </div>
            <div class="nlc-card-foot">
                <a class="nlc-link" onclick="frappe.set_route('Form','Nexus Live Channel','${esc(ch.name)}')">Channel</a>
                <a class="nlc-link" onclick="frappe.set_route('nexus-category-profile-routes')">Routes</a>
                <a class="nlc-link" onclick="frappe.set_route('nexus-chat-category-manager')">Categories</a>
            </div>
        </div>`).join('')}
        ${!d.items.length?emptyCard('No enabled channels found.',`List/Nexus Live Channel`):''}
    </div>
</div>`;
    }

    // ── AI Agents ──────────────────────────────────────────────────────────────

    function buildAgentsSection(d) {
        if (!d) return '';
        return `
<div class="nlc-section">
    ${secHead(d,
        [{ label:'Profiles', value: d.counts.profiles },
         { label:'Ready', value:`${d.counts.ready}/${d.counts.profiles}` }],
        [{ label:'New Profile', route:'Form/Nexus AI Agent Profile/new-nexus-ai-agent-profile-1' },
         { label:'All Profiles', route:'List/Nexus AI Agent Profile' }]
    )}
    ${issues(d.issues)}
    <div class="nlc-cards">
        ${(d.items||[]).map(p=>`
        <div class="nlc-card ${p.ready?'':'nlc-card-warn'}">
            <div class="nlc-card-head">
                <div>
                    <div class="nlc-card-title">${esc(p.agent_name)}</div>
                    <div class="nlc-card-sub">${esc(p.agent_code)} · ${esc(p.status)}</div>
                </div>
                ${chip(p.ready?'ready':'incomplete')}
            </div>
            <div class="nlc-checklist">
                ${chk(p.checks.has_behavior,'Behavior prompt')}
                ${chk(p.checks.has_route,'Assigned to a route')}
                ${chk(p.checks.has_persona,'Nickname / display name')}
                ${chk(p.checks.has_threshold,'Confidence threshold')}
            </div>
            ${p.pool_total>0?`
            <div class="nlc-pool-wrap">
                <div class="nlc-pool-label">Nickname pool (${p.pool_total})</div>
                <div class="nlc-pool-tags">
                    ${p.nickname_pool.map(n=>`<span>${esc(n)}</span>`).join('')}
                    ${p.pool_total>6?`<span class="nlc-pool-more">+${p.pool_total-6}</span>`:''}
                </div>
            </div>`:(p.display_name?`
            <div class="nlc-pool-wrap">
                <div class="nlc-pool-label">Display name</div>
                <div class="nlc-pool-tags"><span>${esc(p.display_name)}</span></div>
            </div>`:`
            <div class="nlc-pool-wrap nlc-pool-empty">No persona name configured — widget will use default.</div>`)}
            <div class="nlc-pool-wrap">
                <div class="nlc-pool-label">Routes using this profile</div>
                <div class="nlc-pool-tags">
                    ${p.route_count>0
                        ?`<span class="nlc-chip nlc-chip-blue">${p.route_count} route${p.route_count>1?'s':''}</span>`
                        :'<span class="nlc-warn-txt">Not used by any route</span>'}
                </div>
            </div>
            <div class="nlc-card-foot">
                <a class="nlc-link" onclick="frappe.set_route('Form','Nexus AI Agent Profile','${esc(p.name)}')">Open Profile</a>
            </div>
        </div>`).join('')}
        ${!d.items.length?emptyCard('No enabled AI Agent Profiles.'):''}
    </div>
</div>`;
    }

    // ── Routes & Access ────────────────────────────────────────────────────────

    function buildRoutesSection(d) {
        if (!d) return '';
        return `
<div class="nlc-section">
    ${secHead(d,
        [{ label:'Routes', value: d.counts.routes },
         { label:'Public', value: d.counts.public },
         { label:'Registered', value: d.counts.registered },
         { label:'Ready', value:`${d.counts.ready}/${d.counts.routes}` }],
        [{ label:'Configure Routes', page:'nexus-category-profile-routes' },
         { label:'New Route', route:'Form/Nexus Category Identity Route/new-nexus-category-identity-route-1' }]
    )}
    ${issues(d.issues)}
    <div class="nlc-table-wrap">
        <table class="nlc-table">
            <thead><tr>
                <th>Channel</th><th>Category</th><th>Type</th>
                <th>Agent Profile</th><th>Identity Profiles</th><th>Mappings</th><th></th>
            </tr></thead>
            <tbody>
                ${(d.items||[]).map(r=>`
                <tr class="${r.ready?'':'nlc-row-warn'}">
                    <td>${esc(r.channel_name)}</td>
                    <td>${esc(r.category_label)}</td>
                    <td>${r.open_to_all
                        ?'<span class="nlc-chip nlc-chip-blue">Public</span>'
                        :'<span class="nlc-chip nlc-chip-purple">Registered</span>'}</td>
                    <td>${r.ai_agent_profile
                        ?`<a class="nlc-link" onclick="frappe.set_route('Form','Nexus AI Agent Profile','${esc(r.ai_agent_profile)}')">${esc(r.ai_agent_profile)}</a>`
                        :'<span class="nlc-warn-txt">— none —</span>'}</td>
                    <td>${r.open_to_all
                        ?'<span class="nlc-muted">Open to all</span>'
                        :r.identity_profiles.length
                            ?r.identity_profiles.map(p=>`<span class="nlc-chip">${esc(p)}</span>`).join('')
                            :'<span class="nlc-warn-txt">None assigned</span>'}</td>
                    <td>${r.open_to_all
                        ?'<span class="nlc-muted">Public bypass</span>'
                        :r.mappings_ok
                            ?'<span class="nlc-ok-txt">✓ Mapped</span>'
                            :'<span class="nlc-warn-txt">⚠ No mappings</span>'}</td>
                    <td><a class="nlc-link" onclick="frappe.set_route('Form','Nexus Category Identity Route','${esc(r.name)}')">Edit</a></td>
                </tr>`).join('')}
                ${!d.items.length?`<tr><td colspan="7" class="nlc-empty-row">No routes configured</td></tr>`:''}
            </tbody>
        </table>
    </div>
</div>`;
    }

    // ── Identity ───────────────────────────────────────────────────────────────

    function buildIdentitySection(d) {
        if (!d) return '';
        const types = d.identity_types || [];
        return `
<div class="nlc-section">
    ${secHead(d,
        [{ label:'Identity Types', value: d.counts.identity_types },
         { label:'Profiles', value: d.counts.identity_profiles },
         { label:'Profiles Ready', value:`${d.counts.ready}/${d.counts.identity_profiles}` }],
        [{ label:'New Identity Profile', route:'Form/Nexus Identity Profile/new-nexus-identity-profile-1' },
         { label:'Identity Registry', page:'nexus-identity-registry-manager' },
         { label:'All Profiles', route:'List/Nexus Identity Profile' }]
    )}
    ${issues(d.issues)}
    <div class="nlc-identity-grid">
        <div>
            <div class="nlc-sub-head">Identity Types</div>
            <div class="nlc-type-chips">
                ${types.map(t=>`<div class="nlc-type-chip">${esc(t.title)}</div>`).join('')}
                ${!types.length?'<div class="nlc-empty-row">No identity types seeded — run install setup.</div>':''}
            </div>
        </div>
        <div>
            <div class="nlc-sub-head">Identity Profiles</div>
            <div class="nlc-cards nlc-cards-sm">
                ${(d.items||[]).map(ip=>`
                <div class="nlc-card nlc-card-sm ${ip.ready?'':'nlc-card-warn'}">
                    <div class="nlc-card-head">
                        <div class="nlc-card-title">${esc(ip.label)}</div>
                        ${chip(ip.ready?'ready':'incomplete')}
                    </div>
                    <div class="nlc-mapping-rows">
                        ${(ip.mappings||[]).map(m=>`
                        <div class="nlc-mapping-row">
                            <span class="nlc-chip nlc-chip-purple">${esc(m.identity_type||'—')}</span>
                            <span class="nlc-arrow">→</span>
                            ${m.kp
                                ?`<span class="nlc-chip ${m.ok?'':'nlc-chip-red'}">${esc(m.kp)}</span>`
                                :'<span class="nlc-muted">No KP filter</span>'}
                        </div>`).join('')}
                        ${!ip.mappings.length?'<div class="nlc-empty-row">No mappings — add at least one identity type mapping</div>':''}
                    </div>
                    <div class="nlc-card-foot">
                        <a class="nlc-link" onclick="frappe.set_route('Form','Nexus Identity Profile','${esc(ip.name)}')">Open</a>
                    </div>
                </div>`).join('')}
                ${!d.items.length?emptyCard('No Identity Profiles. Required for registered visitor routes.','Form/Nexus Identity Profile/new-nexus-identity-profile-1'):''}
            </div>
        </div>
    </div>
</div>`;
    }

    // ── Escalation ─────────────────────────────────────────────────────────────

    function buildEscalationSection(d) {
        if (!d) return '';
        return `
<div class="nlc-section">
    ${secHead(d,
        [{ label:'Escalation Profiles', value: d.counts.escalation_profiles },
         { label:'Human Agents', value: d.counts.human_agents },
         { label:'Rules', value: d.counts.rules }],
        [{ label:'User Profile & Escalation', page:'nexus-user-profile-manager' },
         { label:'Escalation Rules', route:'List/Nexus Escalation Rule' }]
    )}
    ${issues(d.issues)}
    <div class="nlc-esc-grid">
        <div>
            <div class="nlc-sub-head">Active Human Agents</div>
            ${(d.human_agents||[]).length?`
            <div class="nlc-agent-list">
                ${d.human_agents.map(a=>`
                <div class="nlc-agent-row">
                    <span class="nlc-dot-sm nlc-dot-ready"></span>
                    <span>${esc(a.user)}</span>
                    <span class="nlc-muted">max ${a.max_sessions||'—'} sessions</span>
                </div>`).join('')}
            </div>`:`
            <div class="nlc-empty-card">
                No active human agents.<br>
                <a class="nlc-link" onclick="frappe.set_route('nexus-user-profile-manager')">Assign via User Profile &amp; Escalation</a>
            </div>`}
        </div>
        <div>
            <div class="nlc-sub-head">Escalation Rules</div>
            ${(d.rules||[]).length?`
            <div class="nlc-rule-list">
                ${d.rules.map(r=>`
                <div class="nlc-rule-row">
                    <div class="nlc-rule-name">${esc(r.rule_name||r.name)}</div>
                    <div class="nlc-rule-meta">
                        ${r.agent_role?`<span class="nlc-chip">${esc(r.agent_role)}</span>`:''}
                        ${r.min_confidence?`<span class="nlc-chip">conf &lt; ${r.min_confidence}</span>`:''}
                        ${r.on_no_knowledge?`<span class="nlc-chip nlc-chip-blue">No knowledge</span>`:''}
                        ${r.on_human_request?`<span class="nlc-chip nlc-chip-blue">User request</span>`:''}
                    </div>
                </div>`).join('')}`:`
            <div class="nlc-empty-card">No escalation rules configured.</div>`}
        </div>
    </div>
    ${d.items.length?`
    <div class="nlc-sub-head" style="margin-top:18px;">Profiles with Escalation Enabled</div>
    <div class="nlc-cards nlc-cards-sm">
        ${d.items.map(p=>`
        <div class="nlc-card nlc-card-sm ${p.ready?'':'nlc-card-warn'}">
            <div class="nlc-card-head">
                <div class="nlc-card-title">${esc(p.agent_name)}</div>
                ${chip(p.ready?'ready':'incomplete')}
            </div>
            <div class="nlc-checklist">
                ${chk(p.has_policy,'Escalation policy set')}
                ${chk(d.counts.human_agents>0,'Human agent available')}
            </div>
            <div class="nlc-card-foot">
                <a class="nlc-link" onclick="frappe.set_route('Form','Nexus AI Agent Profile','${esc(p.name)}')">Open Profile</a>
            </div>
        </div>`).join('')}
    </div>`:''}
</div>`;
    }

    // ── Shared builders ────────────────────────────────────────────────────────

    function secHead(d, metrics, actions) {
        return `
<div class="nlc-sec-head">
    <div class="nlc-sec-left">
        <div class="nlc-sec-title">${chip(d.status)} ${esc(d.title)}</div>
        <div class="nlc-metrics">
            ${metrics.map(m=>`
            <div class="nlc-metric">
                <span>${esc(String(m.value))}</span>
                <small>${esc(m.label)}</small>
            </div>`).join('')}
        </div>
    </div>
    <div class="nlc-sec-actions">
        ${actions.map(a => a.page
            ?`<button class="btn btn-default btn-sm" onclick="frappe.set_route('${esc(a.page)}')">${esc(a.label)}</button>`
            :`<button class="btn btn-default btn-sm" onclick="frappe.set_route('${esc(a.route)}'.split('/'))">${esc(a.label)}</button>`
        ).join('')}
    </div>
</div>`;
    }

    function issues(list) {
        if (!list || !list.length) return '';
        return `<div class="nlc-issues">${list.map(i=>`<div class="nlc-issue">⚠ ${esc(i)}</div>`).join('')}</div>`;
    }

    function chip(status) {
        const m = { ready:['nlc-chip-green','Ready'], warning:['nlc-chip-yellow','Warning'], incomplete:['nlc-chip-red','Incomplete'] };
        const [cls,lbl] = m[status] || m.incomplete;
        return `<span class="nlc-chip ${cls}">${lbl}</span>`;
    }

    function chk(ok, label) {
        return `<div class="nlc-chk ${ok?'ok':'fail'}"><span>${ok?'✓':'✗'}</span>${esc(label)}</div>`;
    }

    function emptyCard(msg, route) {
        return `<div class="nlc-empty-card">${esc(msg)}${route?`<br><a class="nlc-link" onclick="frappe.set_route('${esc(route)}'.split('/'))">Get started →</a>`:''}`;
    }

    function esc(v) { return frappe.utils.escape_html(v==null?'':String(v)); }

    // ── Events ─────────────────────────────────────────────────────────────────

    function bindEvents() {
        $(page.body)
            .on('click', '#nlc-refresh', loadData)
            .on('click', '#nlc-run-test', () => frappe.set_route('nexus-chat-workflow-tester'))
            .on('click', '.nlc-nav-item', function () {
                $('.nlc-nav-item').removeClass('active');
                $(this).addClass('active');
                if (state.data) renderSection($(this).data('section'));
            });
    }

    // ── CSS ────────────────────────────────────────────────────────────────────

    function inject_css() {
        if ($('#nlc_css').length) return;
        $('<style id="nlc_css">').text(`
.nlc-wrap{padding:18px;}
/* Hero */
.nlc-hero{display:flex;justify-content:space-between;align-items:center;gap:20px;
    background:#fff;border:1px solid #d9e2f2;border-radius:10px;padding:22px 24px;margin-bottom:16px;}
.nlc-hero h1{font-size:22px;font-weight:900;color:#102b67;margin:4px 0 6px;}
.nlc-hero p{color:#53688f;max-width:600px;margin:0;font-size:13px;}
.nlc-badge{color:#214dbb;font-size:11px;font-weight:800;letter-spacing:.04em;
    display:flex;align-items:center;gap:6px;margin-bottom:6px;}
.nlc-pulse{width:7px;height:7px;background:#12b76a;border-radius:50%;
    animation:nlc-pulse 2s infinite;display:inline-block;flex-shrink:0;}
@keyframes nlc-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}
.nlc-hero-right{display:flex;align-items:center;gap:20px;flex-shrink:0;}
.nlc-hero-actions{display:flex;flex-direction:column;gap:8px;}
/* Score ring */
.nlc-score-ring{position:relative;width:80px;height:80px;flex-shrink:0;}
.nlc-score-ring svg{transform:rotate(-90deg);}
.nlc-ring-bg{fill:none;stroke:#edf1f7;stroke-width:7;}
.nlc-ring-fill{fill:none;stroke:#d1d5db;stroke-width:7;stroke-linecap:round;
    stroke-dasharray:0 201;transition:stroke-dasharray .6s,stroke .4s;}
.nlc-score-inner{position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;}
.nlc-score-inner span{font-size:18px;font-weight:900;color:#102b67;line-height:1;}
.nlc-score-inner small{font-size:9px;color:#667085;font-weight:700;text-transform:uppercase;}
/* Nav */
.nlc-nav{display:flex;gap:4px;background:#fff;border:1px solid #d9e2f2;
    border-radius:8px;padding:5px;margin-bottom:16px;flex-wrap:wrap;}
.nlc-nav-item{flex:1;min-width:100px;text-align:center;padding:8px 10px;border-radius:6px;
    cursor:pointer;font-size:12px;font-weight:700;color:#53688f;
    display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s;}
.nlc-nav-item:hover{background:#f5f8ff;color:#214dbb;}
.nlc-nav-item.active{background:#2f63d6;color:#fff;}
.nlc-nav-dot{width:8px;height:8px;border-radius:50%;background:#d1d5db;
    display:inline-block;flex-shrink:0;}
.nlc-dot-ready{background:#12b76a;}
.nlc-dot-warning{background:#f79009;}
.nlc-dot-incomplete{background:#f04438;}
.nlc-nav-item.active .nlc-nav-dot{border:1.5px solid rgba(255,255,255,.5);}
/* Section */
.nlc-section{animation:nlc-fade .18s ease;}
@keyframes nlc-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.nlc-sec-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;
    background:#fff;border:1px solid #d9e2f2;border-radius:8px;
    padding:16px 18px;margin-bottom:12px;}
.nlc-sec-left{display:flex;flex-direction:column;gap:10px;}
.nlc-sec-title{font-size:17px;font-weight:900;color:#102b67;
    display:flex;align-items:center;gap:10px;}
.nlc-metrics{display:flex;gap:20px;flex-wrap:wrap;}
.nlc-metric{display:flex;flex-direction:column;}
.nlc-metric span{font-size:24px;font-weight:900;color:#102b67;line-height:1.1;}
.nlc-metric small{font-size:10px;color:#667085;font-weight:700;text-transform:uppercase;}
.nlc-sec-actions{display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;}
/* Issues */
.nlc-issues{margin-bottom:12px;display:flex;flex-direction:column;gap:5px;}
.nlc-issue{background:#fffaeb;border:1px solid #fedf89;color:#b54708;
    border-radius:7px;padding:8px 12px;font-size:12px;font-weight:700;}
/* Cards */
.nlc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;}
.nlc-cards-sm{grid-template-columns:repeat(auto-fill,minmax(250px,1fr));}
.nlc-card{background:#fff;border:1px solid #d9e2f2;border-radius:8px;padding:14px;}
.nlc-card-sm{padding:12px;}
.nlc-card-warn{border-color:#fecdca;background:#fff9f9;}
.nlc-card-head{display:flex;justify-content:space-between;align-items:flex-start;
    gap:8px;margin-bottom:10px;}
.nlc-card-title{font-size:14px;font-weight:800;color:#102b67;}
.nlc-card-sub{font-size:11px;color:#667085;margin-top:2px;}
.nlc-card-foot{border-top:1px solid #edf1f7;padding-top:8px;margin-top:10px;
    display:flex;gap:12px;}
/* Cat rows */
.nlc-cat-rows{display:flex;flex-direction:column;gap:3px;}
.nlc-cat-row{display:flex;align-items:center;gap:7px;font-size:12px;
    padding:4px 0;border-bottom:1px solid #f5f5f5;}
.nlc-cat-label{flex:1;font-weight:700;color:#344054;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.nlc-verify-badge{background:#edf1f7;border-radius:4px;padding:1px 6px;
    font-size:10px;color:#53688f;font-weight:700;flex-shrink:0;}
/* Checklist */
.nlc-checklist{display:flex;flex-direction:column;gap:3px;margin:6px 0;}
.nlc-chk{display:flex;align-items:center;gap:7px;font-size:12px;color:#344054;padding:2px 0;}
.nlc-chk.ok span{color:#12b76a;font-weight:900;}
.nlc-chk.fail span{color:#f04438;font-weight:900;}
/* Pool */
.nlc-pool-wrap{margin-top:9px;}
.nlc-pool-empty{font-size:11px;color:#9aa5b4;font-style:italic;margin-top:8px;}
.nlc-pool-label{font-size:10px;font-weight:800;text-transform:uppercase;
    color:#667085;margin-bottom:4px;}
.nlc-pool-tags{display:flex;flex-wrap:wrap;gap:4px;}
.nlc-pool-tags span,.nlc-pool-more{border:1px solid #d9e2f2;border-radius:999px;
    padding:2px 8px;font-size:11px;color:#344054;}
.nlc-pool-more{background:#f5f8ff;color:#214dbb;border-color:#c6d5f0;}
/* Chips */
.nlc-chip{display:inline-block;border-radius:999px;padding:2px 9px;
    font-size:11px;font-weight:700;background:#edf1f7;color:#344054;border:1px solid #d9e2f2;}
.nlc-chip-green{background:#ecfdf3;color:#027a48;border-color:#abefc6;}
.nlc-chip-yellow{background:#fffaeb;color:#b54708;border-color:#fedf89;}
.nlc-chip-red{background:#fff1f3;color:#c01048;border-color:#fecdd6;}
.nlc-chip-blue{background:#eff8ff;color:#175cd3;border-color:#b2ddff;}
.nlc-chip-purple{background:#f4f3ff;color:#5925dc;border-color:#d9d6fe;}
/* Table */
.nlc-table-wrap{background:#fff;border:1px solid #d9e2f2;border-radius:8px;overflow:auto;}
.nlc-table{width:100%;border-collapse:collapse;font-size:12px;}
.nlc-table th{background:#f9fafb;font-size:11px;font-weight:800;color:#667085;
    text-transform:uppercase;padding:10px 12px;border-bottom:1px solid #edf1f7;text-align:left;}
.nlc-table td{padding:10px 12px;border-bottom:1px solid #f5f5f5;vertical-align:middle;}
.nlc-table tr:last-child td{border-bottom:none;}
.nlc-row-warn td{background:#fff9f9;}
.nlc-warn-txt{color:#c01048;font-weight:700;}
.nlc-ok-txt{color:#027a48;font-weight:700;}
/* Identity */
.nlc-identity-grid{display:grid;grid-template-columns:200px 1fr;gap:16px;}
.nlc-type-chips{display:flex;flex-wrap:wrap;gap:6px;}
.nlc-type-chip{background:#f4f3ff;color:#5925dc;border:1px solid #d9d6fe;
    border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;}
.nlc-sub-head{font-size:11px;font-weight:800;text-transform:uppercase;
    color:#667085;margin-bottom:10px;}
.nlc-mapping-rows{display:flex;flex-direction:column;gap:6px;margin-top:4px;}
.nlc-mapping-row{display:flex;align-items:center;gap:6px;}
.nlc-arrow{color:#9aa5b4;font-size:14px;}
/* Escalation */
.nlc-esc-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px;}
.nlc-agent-list,.nlc-rule-list{display:flex;flex-direction:column;gap:6px;}
.nlc-agent-row{display:flex;align-items:center;gap:8px;font-size:12px;
    background:#fff;border:1px solid #edf1f7;border-radius:6px;padding:8px 12px;}
.nlc-dot-sm{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.nlc-rule-row{background:#fff;border:1px solid #edf1f7;border-radius:6px;padding:10px 12px;}
.nlc-rule-name{font-size:13px;font-weight:700;color:#344054;margin-bottom:6px;}
.nlc-rule-meta{display:flex;flex-wrap:wrap;gap:5px;}
/* Empty / misc */
.nlc-empty-row{color:#9aa5b4;font-size:12px;padding:6px 0;text-align:center;}
.nlc-empty-card{background:#f9fafb;border:1px dashed #d9e2f2;border-radius:8px;
    padding:18px;text-align:center;color:#667085;font-size:12px;line-height:1.8;}
.nlc-link{color:#2f63d6;font-size:12px;font-weight:700;cursor:pointer;}
.nlc-link:hover{text-decoration:underline;}
.nlc-muted{color:#9aa5b4;}
.nlc-loading{padding:40px;text-align:center;color:#667085;}
@media(max-width:900px){
    .nlc-hero{flex-direction:column;}
    .nlc-identity-grid,.nlc-esc-grid{grid-template-columns:1fr;}
}
        `).appendTo('head');
    }
};

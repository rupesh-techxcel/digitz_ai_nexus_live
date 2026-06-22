import frappe


@frappe.whitelist()
def get_config_readiness(tenant=None):
    from digitz_ai_nexus_live.api.nexus_profile_access_allocation import get_available_tenants

    tenant = tenant or None

    tenant_data    = get_available_tenants()
    default_tenant = tenant_data.get("default_tenant") or ""
    raw_tenants    = tenant_data.get("tenants") or []
    tenant_options = [{"name": t.get("name", ""), "label": t.get("tenant_name") or t.get("name", "")} for t in raw_tenants]

    channels   = _check_channels(tenant)
    agents     = _check_agents(tenant)
    routes     = _check_routes(tenant)
    identity   = _check_identity(tenant)
    escalation = _check_escalation(tenant)

    sections = [channels, agents, routes, identity, escalation]
    total    = sum(s["score"] for s in sections)
    score    = round(total / len(sections))

    return {
        "score":          score,
        "tenant":         tenant,
        "default_tenant": default_tenant,
        "tenant_options": tenant_options,
        "channels":       channels,
        "agents":         agents,
        "routes":         routes,
        "identity":       identity,
        "escalation":     escalation,
    }


# ── Channels & Categories ──────────────────────────────────────────────────────

def _check_channels(tenant=None):
    issues = []
    items  = []

    ch_filters = {}
    if tenant:
        ch_filters["tenant"] = tenant

    channels = frappe.get_all(
        "Nexus Live Channel",
        filters=ch_filters,
        fields=["name", "channel_code", "channel_name", "channel_type",
                "enabled", "default_agent"],
    )

    enabled_channels = [c for c in channels if c.enabled]

    for ch in enabled_channels:
        cat_filters = {"channel": ch.name, "enabled": 1}
        if tenant:
            cat_filters["tenant"] = tenant

        cats = frappe.get_all(
            "Nexus Chat Category",
            filters=cat_filters,
            fields=["name", "category_code", "category_label",
                    "identity_verification_mode"],
        )

        cat_items = []
        for cat in cats:
            route_filters = {"channel": ch.name, "chat_category": cat.name, "enabled": 1}
            if tenant:
                route_filters["tenant"] = tenant

            routes = frappe.db.count("Nexus Category Identity Route", route_filters)
            cat_ready = routes > 0
            if not cat_ready:
                issues.append(
                    f"Category '{cat.category_label}' on {ch.channel_name} has no enabled route."
                )
            cat_items.append({
                "name":         cat.name,
                "label":        cat.category_label,
                "route_count":  routes,
                "verify_mode":  cat.identity_verification_mode or "None",
                "ready":        cat_ready,
            })

        if not cat_items:
            issues.append(f"Channel '{ch.channel_name}' has no enabled categories.")

        ch_ready = bool(cat_items) and all(c["ready"] for c in cat_items)
        items.append({
            "name":       ch.name,
            "label":      ch.channel_name,
            "type":       ch.channel_type,
            "categories": cat_items,
            "ready":      ch_ready,
        })

    if not enabled_channels:
        issues.append("No enabled channels. Configure at least one Nexus Live Channel.")

    score = _score(items, issues)
    return {
        "section":  "channels",
        "title":    "Channels & Categories",
        "score":    score,
        "status":   _status(score),
        "counts":   {
            "channels":   len(enabled_channels),
            "categories": sum(len(i["categories"]) for i in items),
            "ready":      sum(1 for i in items if i["ready"]),
        },
        "items":  items,
        "issues": issues,
    }


# ── AI Agent Profiles ──────────────────────────────────────────────────────────

def _check_agents(tenant=None):
    issues = []
    items  = []

    profile_filters = {"enabled": 1}
    if tenant:
        profile_filters["tenant"] = tenant

    profiles = frappe.get_all(
        "Nexus AI Agent Profile",
        filters=profile_filters,
        fields=["name", "agent_code", "agent_name", "display_name",
                "nickname_pool", "behavior_prompt", "escalation_enabled",
                "escalation_policy", "status", "confidence_threshold"],
    )

    for p in profiles:
        route_filters = {"ai_agent_profile": p.name, "enabled": 1}
        if tenant:
            route_filters["tenant"] = tenant

        route_count = frappe.db.count("Nexus Category Identity Route", route_filters)

        checks = {
            "has_behavior":  bool(p.behavior_prompt),
            "has_route":     bool(route_count),
            "has_persona":   bool(p.nickname_pool or p.display_name),
            "has_threshold": bool(p.confidence_threshold),
        }
        item_issues = []
        if not checks["has_behavior"]:
            item_issues.append("No behavior prompt configured.")
        if not checks["has_route"]:
            item_issues.append("Not referenced by any enabled route — profile will never be selected.")
        if not checks["has_persona"]:
            item_issues.append("No display name or nickname pool — widget will show a default name.")
        ready = checks["has_behavior"] and checks["has_route"]
        if not ready:
            issues.extend([f"{p.agent_name}: {x}" for x in item_issues])

        pool_names = [n.strip() for n in (p.nickname_pool or "").splitlines() if n.strip()]

        items.append({
            "name":          p.name,
            "agent_code":    p.agent_code,
            "agent_name":    p.agent_name,
            "display_name":  p.display_name or "",
            "nickname_pool": pool_names[:6],
            "pool_total":    len(pool_names),
            "route_count":   route_count,
            "status":        p.status or "Idle",
            "checks":        checks,
            "ready":         ready,
            "item_issues":   item_issues,
        })

    if not profiles:
        issues.append("No enabled AI Agent Profiles. Create and enable at least one.")

    score = _score(items, issues)
    return {
        "section": "agents",
        "title":   "AI Agent Profiles",
        "score":   score,
        "status":  _status(score),
        "counts": {
            "profiles": len(profiles),
            "ready":    sum(1 for i in items if i["ready"]),
        },
        "items":  items,
        "issues": issues,
    }


# ── Routes & Access ────────────────────────────────────────────────────────────

def _check_routes(tenant=None):
    issues = []
    items  = []

    route_filters = {"enabled": 1}
    if tenant:
        route_filters["tenant"] = tenant

    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters=route_filters,
        fields=["name", "channel", "chat_category", "ai_agent_profile", "priority"],
    )

    for r in routes:
        route_issues = []
        has_profile  = bool(r.ai_agent_profile)

        identity_profiles = frappe.get_all(
            "Nexus Route Identity Profile",
            filters={"parent": r.name},
            pluck="identity_profile",
        )
        open_to_all = not bool(identity_profiles)

        mappings_ok = True
        if not open_to_all:
            has_any_mapping = False
            for ip_name in identity_profiles:
                if frappe.db.count("Nexus Identity Profile Mapping", {"parent": ip_name}):
                    has_any_mapping = True
                    break
            if not has_any_mapping:
                route_issues.append(
                    "No identity profile attached to this route has identity mappings — "
                    "registered visitors will be denied all knowledge access."
                )
                mappings_ok = False

        if not has_profile:
            route_issues.append("No AI Agent Profile assigned.")

        ready = has_profile and mappings_ok
        if not ready:
            issues.extend([f"Route {r.name}: {x}" for x in route_issues])

        cat_label = frappe.db.get_value("Nexus Chat Category", r.chat_category, "category_label") or r.chat_category
        ch_name   = frappe.db.get_value("Nexus Live Channel", r.channel, "channel_name") or r.channel

        items.append({
            "name":               r.name,
            "channel":            r.channel,
            "channel_name":       ch_name,
            "chat_category":      r.chat_category,
            "category_label":     cat_label,
            "ai_agent_profile":   r.ai_agent_profile,
            "open_to_all":        open_to_all,
            "identity_profiles":  identity_profiles,
            "mappings_ok":        mappings_ok,
            "priority":           r.priority or 0,
            "ready":              ready,
            "item_issues":        route_issues,
        })

    if not routes:
        issues.append("No enabled routes configured.")

    score = _score(items, issues)
    return {
        "section": "routes",
        "title":   "Routes & Access",
        "score":   score,
        "status":  _status(score),
        "counts": {
            "routes":     len(routes),
            "public":     sum(1 for i in items if i["open_to_all"]),
            "registered": sum(1 for i in items if not i["open_to_all"]),
            "ready":      sum(1 for i in items if i["ready"]),
        },
        "items":  items,
        "issues": issues,
    }


# ── Identity & Registry ────────────────────────────────────────────────────────

def _check_identity(tenant=None):
    issues = []
    items  = []

    # Identity Types have no tenant field — structurally global across all tenants
    identity_types = frappe.get_all(
        "Nexus Identity Type",
        filters={"enabled": 1},
        fields=["name", "title", "sort_order"],
        order_by="sort_order asc",
    ) if frappe.db.exists("DocType", "Nexus Identity Type") else []

    standard = {"Public", "Customer", "Prospect", "Partner", "Internal", "Admin"}
    seeded   = {t.name for t in identity_types}
    missing  = standard - seeded
    if missing:
        issues.append(f"Missing standard identity types: {', '.join(sorted(missing))}.")

    # Identity Profiles are per-tenant
    ip_filters = {"enabled": 1}
    if tenant:
        ip_filters["tenant"] = tenant
    ip_docs = frappe.get_all(
        "Nexus Identity Profile",
        filters=ip_filters,
        fields=["name", "profile_name", "title"],
    ) if frappe.db.exists("DocType", "Nexus Identity Profile") else []

    ip_items = []
    for ip in ip_docs:
        mappings = frappe.get_all(
            "Nexus Identity Profile Mapping",
            filters={"parent": ip.name},
            fields=["identity_type", "knowledge_profile"],
        )
        has_mappings = bool(mappings)
        if not has_mappings:
            issues.append(f"Identity Profile '{ip.title or ip.name}' has no identity mappings.")

        kp_check = []
        for m in mappings:
            if m.knowledge_profile:
                kp_ok = bool(
                    frappe.db.exists("Knowledge Profile", m.knowledge_profile)
                    and frappe.db.get_value("Knowledge Profile", m.knowledge_profile, "enabled")
                )
                if not kp_ok:
                    issues.append(
                        f"Knowledge Profile '{m.knowledge_profile}' in '{ip.title or ip.name}' "
                        "is missing or disabled."
                    )
                kp_check.append({"identity_type": m.identity_type, "kp": m.knowledge_profile, "ok": kp_ok})
            else:
                kp_check.append({"identity_type": m.identity_type, "kp": None, "ok": True})

        ip_ready = has_mappings
        ip_items.append({
            "name":     ip.name,
            "label":    ip.title or ip.profile_name,
            "mappings": kp_check,
            "ready":    ip_ready,
        })

    items = ip_items
    score = _score(items, issues) if items else (100 if not issues else 40)

    return {
        "section": "identity",
        "title":   "Identity & Access Profiles",
        "score":   score,
        "status":  _status(score),
        "counts": {
            "identity_types":    len(identity_types),
            "identity_profiles": len(ip_docs),
            "ready":             sum(1 for i in ip_items if i["ready"]),
        },
        "identity_types": [{"name": t.name, "title": t.title} for t in identity_types],
        "items":  items,
        "issues": issues,
    }


# ── Human Escalation ───────────────────────────────────────────────────────────

def _check_escalation(tenant=None):
    issues = []
    items  = []

    esc_filters = {"enabled": 1, "escalation_enabled": 1}
    if tenant:
        esc_filters["tenant"] = tenant

    escalation_profiles = frappe.get_all(
        "Nexus AI Agent Profile",
        filters=esc_filters,
        fields=["name", "agent_name", "escalation_policy"],
    )

    # Human agents and escalation rules are global (not per-tenant)
    human_agents = frappe.get_all(
        "Nexus User Profile Assignment",
        filters={"active": 1, "can_handle_escalations": 1},
        fields=["name", "user", "max_escalation_sessions"],
    )

    rules = frappe.get_all(
        "Nexus Escalation Rule",
        filters={"enabled": 1},
        fields=["name", "rule_name", "agent_role", "minimum_confidence",
                "escalate_on_no_knowledge", "escalate_on_human_request"],
    ) if frappe.db.exists("DocType", "Nexus Escalation Rule") else []

    if escalation_profiles and not human_agents:
        issues.append(
            f"{len(escalation_profiles)} AI profile(s) have escalation enabled "
            "but no human agents are assigned and active."
        )

    for ep in escalation_profiles:
        has_policy = bool(ep.escalation_policy)
        if not has_policy:
            issues.append(f"Profile '{ep.agent_name}' has escalation enabled but no escalation policy set.")
        items.append({
            "name":       ep.name,
            "agent_name": ep.agent_name,
            "policy":     ep.escalation_policy,
            "has_policy": has_policy,
            "ready":      has_policy and bool(human_agents),
        })

    if not escalation_profiles:
        score = 100
    else:
        score = _score(items, issues)

    return {
        "section": "escalation",
        "title":   "Human Escalation",
        "score":   score,
        "status":  _status(score),
        "counts": {
            "escalation_profiles": len(escalation_profiles),
            "human_agents":        len(human_agents),
            "rules":               len(rules),
        },
        "human_agents": [
            {"user": a.user, "max_sessions": a.max_escalation_sessions}
            for a in human_agents
        ],
        "rules": [
            {
                "name":             r.name,
                "rule_name":        r.rule_name,
                "agent_role":       r.agent_role,
                "min_confidence":   r.minimum_confidence,
                "on_no_knowledge":  bool(r.escalate_on_no_knowledge),
                "on_human_request": bool(r.escalate_on_human_request),
            }
            for r in rules
        ],
        "items":  items,
        "issues": issues,
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _score(items, issues):
    if not items:
        return 0 if issues else 100
    ready_pct = int(sum(1 for i in items if i.get("ready", False)) / len(items) * 100)
    issue_penalty = min(len(issues) * 10, 30)
    return max(0, ready_pct - issue_penalty)


def _status(score):
    if score >= 90:
        return "ready"
    if score >= 60:
        return "warning"
    return "incomplete"

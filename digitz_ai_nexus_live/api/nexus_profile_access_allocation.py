import frappe


@frappe.whitelist()
def get_page_data(tenant=None):
    """Return Knowledge Profiles and enabled Access Categories, both scoped to tenant."""
    profiles = []
    if frappe.db.exists("DocType", "Knowledge Profile"):
        kp_filters = {}
        if tenant:
            kp_filters["tenant"] = tenant

        raw = frappe.get_all(
            "Knowledge Profile",
            filters=kp_filters,
            fields=["name", "profile_name", "title", "enabled", "tenant"],
            order_by="profile_name asc",
        )
        for p in raw:
            cat_count = frappe.db.count(
                "Knowledge Profile Access Category",
                {"parent": p.name, "enabled": 1},
            ) if frappe.db.exists("DocType", "Knowledge Profile Access Category") else 0
            profiles.append({
                "name":       p.name,
                "title":      p.title or p.profile_name,
                "enabled":    bool(p.enabled),
                "tenant":     p.tenant or "",
                "cat_count":  cat_count,
            })

    cat_filters = {"disabled": 0}
    if tenant:
        cat_filters["tenant"] = tenant

    categories = frappe.get_all(
        "Nexus Access Category",
        filters=cat_filters,
        fields=["name", "category_name", "title", "description", "priority", "tenant"],
        order_by="priority asc",
    )

    # Exclude categories whose entire policy set is "Public" — public knowledge
    # sources are served autonomously and do not require explicit KP assignment.
    categories = _exclude_public_only_categories(categories)

    # Recompute cat_count using only the allocatable (non-Public-only) categories
    # so the profile list badge reflects meaningful assignments only.
    allocatable_cat_names = {c["name"] for c in categories}
    for p in profiles:
        if allocatable_cat_names and frappe.db.exists("DocType", "Knowledge Profile Access Category"):
            p["cat_count"] = frappe.db.count(
                "Knowledge Profile Access Category",
                {
                    "parent": p["name"],
                    "enabled": 1,
                    "access_category": ["in", list(allocatable_cat_names)],
                },
            )
        else:
            p["cat_count"] = 0

    return {"profiles": profiles, "categories": categories}


@frappe.whitelist()
def get_available_tenants():
    """Return tenants plus the active tenant for the current user.

    Active tenant priority (server-side):
      1. Nexus User Context.active_tenant  (set when admin page changes tenant)
      2. Nexus Settings.default_tenant     (system-wide fallback)
    """
    # 1. User's active tenant from Nexus User Context
    active_tenant = ""
    if frappe.db.exists("DocType", "Nexus User Context"):
        existing = frappe.db.get_value(
            "Nexus User Context",
            {"user": frappe.session.user, "is_default": 1},
            "active_tenant",
        )
        active_tenant = existing or ""

    # 2. System default fallback
    if not active_tenant and frappe.db.exists("DocType", "Nexus Settings"):
        active_tenant = frappe.db.get_single_value("Nexus Settings", "default_tenant") or ""

    if not frappe.db.exists("DocType", "Nexus Tenant"):
        return {"tenants": [], "default_tenant": active_tenant}

    meta = frappe.get_meta("Nexus Tenant")
    fields = ["name"]
    if meta.has_field("tenant_name"):
        fields.append("tenant_name")
    if meta.has_field("disabled"):
        tenants = frappe.get_all("Nexus Tenant", filters={"disabled": 0}, fields=fields, order_by="name asc")
    else:
        tenants = frappe.get_all("Nexus Tenant", fields=fields, order_by="name asc")

    return {"tenants": tenants, "default_tenant": active_tenant}


@frappe.whitelist()
def get_profile_detail(profile):
    """
    Return full detail for one Knowledge Profile:
    - assigned access categories
    - resolved effective policies
    - identity profiles that reference this Knowledge Profile
    """
    if not frappe.db.exists("Knowledge Profile", profile):
        frappe.throw(f"Knowledge Profile '{profile}' not found.")

    doc = frappe.get_doc("Knowledge Profile", profile)

    assignments = []
    for row in (doc.access_categories or []):
        assignments.append({
            "access_category": row.access_category,
            "enabled": bool(row.enabled),
        })

    effective_policies = _get_effective_policies_for_kp(profile)

    # Find Identity Profiles that map to this Knowledge Profile
    identity_profile_refs = []
    if frappe.db.exists("DocType", "Nexus Identity Profile Mapping"):
        rows = frappe.get_all(
            "Nexus Identity Profile Mapping",
            filters={"knowledge_profile": profile},
            fields=["parent", "identity_type"],
        )
        for row in rows:
            ip_title = frappe.db.get_value(
                "Nexus Identity Profile", row.parent, "title"
            ) or row.parent
            identity_profile_refs.append({
                "identity_profile":       row.parent,
                "identity_profile_title": ip_title,
                "identity_type":          row.identity_type,
            })

    chat_routes = _get_chat_routes_for_kp(profile)

    # Identity Knowledge Rules that allocate identity types to this Knowledge Profile
    identity_rules = []
    if frappe.db.exists("DocType", "Nexus Identity Knowledge Rule"):
        rows = frappe.get_all(
            "Nexus Identity Knowledge Rule",
            filters={"knowledge_profile": profile},
            fields=["name", "rule_label", "identity_type", "knowledge_profile", "description"],
            order_by="identity_type asc",
        )
        for row in rows:
            it_label = frappe.db.get_value("Nexus Identity Type", row.identity_type, "title") or row.identity_type
            identity_rules.append({
                "name":          row.name,
                "rule_label":    row.rule_label or row.name,
                "identity_type": row.identity_type,
                "it_label":      it_label,
                "description":   row.description or "",
            })

    return {
        "name":               doc.name,
        "title":              doc.title or doc.profile_name,
        "enabled":            bool(doc.enabled),
        "tenant":             doc.tenant or "",
        "description":        doc.description or "",
        "assignments":        assignments,
        "effective_policies": effective_policies,
        "used_by":            identity_profile_refs,
        "identity_rules":     identity_rules,
        "chat_routes":        chat_routes,
    }


@frappe.whitelist()
def save_knowledge_profile_categories(profile, categories_to_assign, categories_to_remove):
    """
    Assign or remove Access Categories on a Knowledge Profile.
    categories_to_assign / categories_to_remove are JSON arrays of category names.
    """
    import json

    to_assign = json.loads(categories_to_assign or "[]")
    to_remove = json.loads(categories_to_remove or "[]")

    if not frappe.db.exists("Knowledge Profile", profile):
        frappe.throw(f"Knowledge Profile '{profile}' not found.")

    doc = frappe.get_doc("Knowledge Profile", profile)

    existing = {row.access_category: row for row in (doc.access_categories or [])}

    for cat in to_assign:
        if cat in existing:
            existing[cat].enabled = 1
        else:
            doc.append("access_categories", {
                "access_category": cat,
                "enabled": 1,
            })

    for cat in to_remove:
        if cat in existing:
            existing[cat].enabled = 0

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return get_profile_detail(profile)


@frappe.whitelist()
def get_available_identity_types(knowledge_profile):
    """Return identity types not yet allocated to this Knowledge Profile."""
    if not frappe.db.exists("DocType", "Nexus Identity Type"):
        return []

    all_types = frappe.get_all(
        "Nexus Identity Type",
        filters={"enabled": 1},
        fields=["name", "title"],
        order_by="sort_order asc, title asc",
    )

    # Exclude types that already have a rule pointing to this profile
    already_allocated = set()
    if frappe.db.exists("DocType", "Nexus Identity Knowledge Rule"):
        rows = frappe.get_all(
            "Nexus Identity Knowledge Rule",
            filters={"knowledge_profile": knowledge_profile},
            pluck="identity_type",
        )
        already_allocated = set(rows)

    return [t for t in all_types if t.name not in already_allocated]


@frappe.whitelist()
def create_identity_knowledge_rule(identity_type, knowledge_profile, rule_label="", description=""):
    """Create a Nexus Identity Knowledge Rule linking an identity type to a knowledge profile."""
    if not frappe.db.exists("Nexus Identity Type", identity_type):
        frappe.throw(f"Identity Type '{identity_type}' not found.")
    if not frappe.db.exists("Knowledge Profile", knowledge_profile):
        frappe.throw(f"Knowledge Profile '{knowledge_profile}' not found.")

    # Check duplicate
    existing = frappe.db.exists("Nexus Identity Knowledge Rule", {
        "identity_type": identity_type,
        "knowledge_profile": knowledge_profile,
    })
    if existing:
        frappe.throw(f"A rule for this Identity Type and Knowledge Profile already exists.")

    it_label = frappe.db.get_value("Nexus Identity Type", identity_type, "title") or identity_type
    kp_title = frappe.db.get_value("Knowledge Profile", knowledge_profile, "title") or knowledge_profile
    auto_label = rule_label or f"{it_label} → {kp_title}"

    doc = frappe.new_doc("Nexus Identity Knowledge Rule")
    doc.rule_label      = auto_label
    doc.identity_type   = identity_type
    doc.knowledge_profile = knowledge_profile
    doc.description     = description
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "name":          doc.name,
        "rule_label":    doc.rule_label,
        "identity_type": doc.identity_type,
        "it_label":      it_label,
        "description":   doc.description or "",
    }


@frappe.whitelist()
def delete_identity_knowledge_rule(rule_name):
    """Delete a Nexus Identity Knowledge Rule."""
    if not frappe.db.exists("Nexus Identity Knowledge Rule", rule_name):
        frappe.throw(f"Rule '{rule_name}' not found.")
    frappe.delete_doc("Nexus Identity Knowledge Rule", rule_name, ignore_permissions=True)
    frappe.db.commit()
    return {"success": True}


@frappe.whitelist()
def create_knowledge_profile(profile_name, title, tenant, description=""):
    """Create a new Knowledge Profile under the given tenant."""
    profile_name = (profile_name or "").strip().upper().replace(" ", "-")
    if not profile_name:
        frappe.throw("Profile name is required.")
    if not tenant:
        frappe.throw("Tenant is required.")

    doc = frappe.new_doc("Knowledge Profile")
    doc.profile_name = profile_name
    doc.title = title or profile_name
    doc.tenant = tenant
    doc.description = description
    doc.enabled = 1
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"name": doc.name, "title": doc.title, "tenant": doc.tenant}


@frappe.whitelist()
def get_category_policies(category):
    """Return policies belonging to an Access Category."""
    rows = frappe.get_all(
        "Nexus Access Category Policy",
        filters={"parent": category, "parentfield": "allowed_policies"},
        pluck="access_policy",
    )

    policies = []
    for name in rows:
        doc = frappe.db.get_value(
            "Nexus Access Policy",
            name,
            ["policy_name", "access_level", "sensitivity", "is_primitive", "disabled", "description"],
            as_dict=True,
        )
        if doc:
            policies.append(doc)

    return {"policies": policies}


def _get_effective_policies_for_kp(profile_name):
    """Resolve effective policies for a Knowledge Profile via its access categories."""
    category_names = frappe.get_all(
        "Knowledge Profile Access Category",
        filters={"parent": profile_name, "enabled": 1},
        pluck="access_category",
    )

    if not category_names:
        return []

    policy_names = frappe.get_all(
        "Nexus Access Category Policy",
        filters={"parent": ["in", category_names], "parentfield": "allowed_policies"},
        pluck="access_policy",
    )

    if not policy_names:
        return []

    # access_policy stores the doc name (e.g. "Public-DIGITZ-AI-NEXUS"), not the policy_name field
    return frappe.get_all(
        "Nexus Access Policy",
        filters={"name": ["in", list(set(policy_names))], "disabled": 0},
        fields=["name", "policy_name", "access_level", "sensitivity", "is_primitive", "description"],
        order_by="policy_name asc",
    )


def _exclude_public_only_categories(categories):
    """
    Filter out Access Categories whose entire allowed policy set resolves to
    "Public" — public knowledge is served autonomously regardless of KP
    assignment, so allocating a Public-only category to a Knowledge Profile
    adds no value and creates unnecessary configuration burden.

    A category is considered Public-only when every Nexus Access Policy in its
    allowed_policies child table has policy_name == "Public" (case-insensitive).
    Categories with no policies at all are kept (they may be in progress).
    """
    if not categories or not frappe.db.exists("DocType", "Nexus Access Category Policy"):
        return categories

    cat_names = [c["name"] for c in categories]

    # Batch-fetch all policy links for these categories
    policy_rows = frappe.get_all(
        "Nexus Access Category Policy",
        filters={"parent": ["in", cat_names], "parentfield": "allowed_policies"},
        fields=["parent", "access_policy"],
    )

    # Map category → list of linked policy doc names
    cat_policies = {}
    for row in policy_rows:
        cat_policies.setdefault(row.parent, []).append(row.access_policy)

    # Batch-fetch policy_name for all distinct policies referenced
    all_policy_names_raw = list({p for links in cat_policies.values() for p in links})
    policy_name_map = {}
    if all_policy_names_raw and frappe.db.exists("DocType", "Nexus Access Policy"):
        rows = frappe.get_all(
            "Nexus Access Policy",
            filters={"name": ["in", all_policy_names_raw]},
            fields=["name", "policy_name"],
        )
        policy_name_map = {r.name: (r.policy_name or "").strip().lower() for r in rows}

    result = []
    for cat in categories:
        linked = cat_policies.get(cat["name"], [])
        if not linked:
            # No policies configured — keep (not Public-only, just unconfigured)
            result.append(cat)
            continue

        # Public-only when every linked policy resolves to "public"
        all_public = all(
            policy_name_map.get(p, "").lower() == "public"
            for p in linked
        )
        if not all_public:
            result.append(cat)

    return result


def _get_chat_routes_for_kp(profile_name):
    """
    Reverse-lookup: which Chat Categories reach this Knowledge Profile through the
    real routing chain?

    Chain:
      Nexus Identity Profile Mapping (knowledge_profile = profile_name)
        → Nexus Identity Profile
          → Nexus Route Identity Profile (permitted identity_profile on a route)
            → Nexus Category Identity Route
              → Nexus Chat Category
    """
    if not frappe.db.exists("DocType", "Nexus Identity Profile Mapping"):
        return []

    # Step 1 — Identity Profiles that map to this KP
    ip_mappings = frappe.get_all(
        "Nexus Identity Profile Mapping",
        filters={"knowledge_profile": profile_name},
        fields=["parent", "identity_type"],
    )
    if not ip_mappings:
        return []

    ip_names = list({r.parent for r in ip_mappings})
    ip_type_map = {}
    for r in ip_mappings:
        ip_type_map.setdefault(r.parent, []).append(r.identity_type)

    # Step 2 — Routes that permit those Identity Profiles
    if not frappe.db.exists("DocType", "Nexus Route Identity Profile"):
        return []

    route_ip_rows = frappe.get_all(
        "Nexus Route Identity Profile",
        filters={"identity_profile": ["in", ip_names]},
        fields=["parent", "identity_profile"],
    )
    if not route_ip_rows:
        return []

    route_names = list({r.parent for r in route_ip_rows})
    # map: route_name → [identity_profile, ...]
    route_ip_map = {}
    for r in route_ip_rows:
        route_ip_map.setdefault(r.parent, []).append(r.identity_profile)

    # Step 3 — Category Identity Routes
    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters={"name": ["in", route_names], "enabled": 1},
        fields=["name", "chat_category", "ai_agent_profile", "is_public_route"],
    )
    if not routes:
        return []

    # Step 4 — Enrich with Chat Category details, deduplicate by category
    seen = set()
    results = []
    for route in routes:
        cc_name = route.chat_category
        if not cc_name or cc_name in seen:
            continue
        seen.add(cc_name)

        cc = frappe.db.get_value(
            "Nexus Chat Category", cc_name,
            ["category_label", "channel", "enabled"],
            as_dict=True,
        )
        if not cc:
            continue

        # Which identity profiles bridge this category → KP, and via what identity type?
        bridging = []
        for ip in route_ip_map.get(route.name, []):
            for itype in ip_type_map.get(ip, []):
                ip_label = frappe.db.get_value("Nexus Identity Profile", ip, "title") or ip
                bridging.append({"identity_profile": ip, "label": ip_label, "identity_type": itype})

        results.append({
            "chat_category":      cc_name,
            "category_label":     cc.category_label or cc_name,
            "channel":            cc.channel or "",
            "enabled":            bool(cc.enabled),
            "route":              route.name,
            "ai_agent_profile":   route.ai_agent_profile or "",
            "is_public_route":    bool(route.is_public_route),
            "via":                bridging,
        })

    return results

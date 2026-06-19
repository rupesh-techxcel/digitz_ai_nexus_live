import frappe
from frappe.utils import cstr, random_string
import re


@frappe.whitelist()
def get_wizard_data(tenant=None):
    """Return all initial data needed for the Channel Setup Wizard."""
    tenants = frappe.get_all(
        "Nexus Tenant",
        fields=["name", "tenant_name"],
        order_by="tenant_name asc",
    )
    channel_filters = {}
    if tenant:
        channel_filters["tenant"] = tenant
    channels = frappe.get_all(
        "Nexus Live Channel",
        filters=channel_filters,
        fields=["name", "channel_name", "channel_type", "tenant"],
        order_by="channel_name asc",
    )
    profile_filters = {}
    if tenant:
        profile_filters["tenant"] = tenant
    profiles = frappe.get_all(
        "Nexus AI Agent Profile",
        filters=profile_filters,
        fields=["name", "agent_name", "tenant"],
        order_by="agent_name asc",
    )
    ip_filters = {"enabled": 1}
    if tenant:
        ip_filters["tenant"] = tenant
    identity_profiles = frappe.get_all(
        "Nexus Identity Profile",
        filters=ip_filters,
        fields=["name", "profile_name", "title"],
        order_by="profile_name asc",
    )

    # Enrich each identity profile with its knowledge mappings
    ip_names = [ip["name"] for ip in identity_profiles]
    if ip_names:
        mapping_rows = frappe.get_all(
            "Nexus Identity Profile Mapping",
            filters={"parent": ["in", ip_names]},
            fields=["parent", "identity_type", "knowledge_profile"],
            order_by="idx asc",
        )
        # Fetch display labels
        it_names  = list({r["identity_type"] for r in mapping_rows if r.get("identity_type")})
        kp_names  = list({r["knowledge_profile"] for r in mapping_rows if r.get("knowledge_profile")})
        it_labels, kp_labels = {}, {}
        if it_names:
            for row in frappe.get_all("Nexus Identity Type", filters={"name": ["in", it_names]}, fields=["name", "title"]):
                it_labels[row["name"]] = row.get("title") or row["name"]
        if kp_names:
            for row in frappe.get_all("Knowledge Profile", filters={"name": ["in", kp_names]}, fields=["name", "profile_name"]):
                kp_labels[row["name"]] = row.get("profile_name") or row["name"]

        # Group by parent
        from collections import defaultdict
        mappings_by_ip = defaultdict(list)
        for r in mapping_rows:
            mappings_by_ip[r["parent"]].append({
                "identity_type":         r["identity_type"],
                "identity_type_label":   it_labels.get(r["identity_type"], r["identity_type"]),
                "knowledge_profile":     r["knowledge_profile"],
                "knowledge_profile_label": kp_labels.get(r["knowledge_profile"], r["knowledge_profile"]),
            })
        for ip in identity_profiles:
            ip["mappings"] = mappings_by_ip.get(ip["name"], [])
    else:
        for ip in identity_profiles:
            ip["mappings"] = []
    existing_routes = frappe.get_all(
        "Nexus Category Identity Route",
        fields=["name", "channel", "chat_category", "ai_agent_profile", "enabled", "priority"],
        order_by="priority asc",
    )

    # Build lookup maps for display labels
    channel_map   = {c["name"]: c for c in channels}
    profile_map   = {p["name"]: p for p in profiles}
    category_names = list({r["chat_category"] for r in existing_routes if r.get("chat_category")})
    category_map  = {}
    if category_names:
        for cat in frappe.get_all(
            "Nexus Chat Category",
            filters={"name": ["in", category_names]},
            fields=["name", "category_label", "category_code"],
        ):
            category_map[cat["name"]] = cat

    for route in existing_routes:
        ch = channel_map.get(route["channel"], {})
        route["channel_name"]   = ch.get("channel_name") or route["channel"]
        route["tenant"]         = ch.get("tenant") or ""
        cat = category_map.get(route["chat_category"], {})
        route["category_label"] = cat.get("category_label") or route["chat_category"]
        pr = profile_map.get(route["ai_agent_profile"], {})
        route["agent_name"]     = pr.get("agent_name") or route["ai_agent_profile"]
        route["identity_profiles"] = frappe.get_all(
            "Nexus Route Identity Profile",
            filters={"parent": route["name"]},
            pluck="identity_profile",
        )

    return {
        "tenants":           tenants,
        "channels":          channels,
        "profiles":          profiles,
        "identity_profiles": identity_profiles,
        "existing_routes":   existing_routes,
    }


@frappe.whitelist()
def get_categories_for_channel(channel):
    """Return chat categories belonging to this channel."""
    categories = frappe.get_all(
        "Nexus Chat Category",
        filters={"channel": channel},
        fields=["name", "category_label", "category_code", "enabled", "published", "display_order"],
        order_by="display_order asc",
    )
    return {"categories": categories}


@frappe.whitelist()
def save_category(
    channel,
    tenant,
    category_label,
    visibility="External",
    identity_verification_mode="None",
    allow_public_fallback=0,
    enable_escalation=0,
    description="",
    display_order=10,
):
    """Create a new Nexus Chat Category."""
    frappe.only_for("System Manager")

    slug = category_label.lower().replace(" ", "-").replace("/", "-")
    base_code = re.sub(r"[^a-z0-9-]+", "", slug).strip("-")[:55] or "category"
    category_code = f"{channel}-{base_code}"[:60]
    counter = 1
    while frappe.db.exists("Nexus Chat Category", category_code):
        category_code = f"{channel}-{base_code}-{counter}"
        counter += 1

    doc = frappe.get_doc({
        "doctype": "Nexus Chat Category",
        "channel": channel,
        "tenant": tenant,
        "category_label": category_label,
        "category_code": category_code,
        "visibility": visibility,
        "identity_verification_mode": identity_verification_mode,
        "allow_public_fallback": int(allow_public_fallback),
        "enable_escalation": int(enable_escalation),
        "description": description,
        "display_order": int(display_order),
        "enabled": 1,
        "published": 0,
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"name": doc.name, "category_code": doc.category_code}


@frappe.whitelist()
def save_agent_profile(
    tenant,
    channel,
    agent_name,
    display_name="",
    agent_role="Public Responder",
    tone="Professional",
    response_style="Concise",
    confidence_threshold=0.65,
    escalation_enabled=0,
    memory_mode="None",
    behavior_prompt="",
    welcome_message="",
    fallback_message="",
):
    """Create a new Nexus AI Agent Profile.

    Note: Knowledge access is NOT configured on the agent profile directly.
    Access is governed by: Identity Profile → identity_mappings → Knowledge Profile → Access Categories.
    """
    frappe.only_for("System Manager")

    agent_code = _slugify(agent_name)
    if frappe.db.exists("Nexus AI Agent Profile", {"agent_code": agent_code}):
        agent_code = f"{agent_code}-{random_string(4).lower()}"

    doc = frappe.get_doc({
        "doctype": "Nexus AI Agent Profile",
        "tenant": tenant,
        "agent_code": agent_code,
        "agent_name": agent_name,
        "display_name": display_name or agent_name,
        "agent_role": agent_role,
        "tone": tone,
        "response_style": response_style,
        "confidence_threshold": float(confidence_threshold),
        "escalation_enabled": int(escalation_enabled),
        "memory_mode": memory_mode,
        "behavior_prompt": behavior_prompt,
        "welcome_message": welcome_message,
        "fallback_message": fallback_message,
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"name": doc.name, "agent_name": doc.agent_name}


@frappe.whitelist()
def save_route(
    channel,
    chat_category,
    ai_agent_profile,
    identity_profiles=None,
    existing_route=None,
    priority=10,
):
    """
    Create or update ONE Nexus Category Identity Route.

    identity_profiles — list of Nexus Identity Profile names to permit.
                        Empty list = route is open to all (public access).
    existing_route    — name of existing route doc to update (optional).
    """
    frappe.only_for("System Manager")

    import json

    if isinstance(identity_profiles, str):
        try:
            identity_profiles = json.loads(identity_profiles)
        except Exception:
            identity_profiles = []

    identity_profiles = [p for p in (identity_profiles or []) if p]
    category_channel = frappe.db.get_value("Nexus Chat Category", chat_category, "channel")
    if not category_channel:
        frappe.throw("Selected chat category is not linked to a channel.")

    # Load existing or create new
    if existing_route and frappe.db.exists("Nexus Category Identity Route", existing_route):
        doc = frappe.get_doc("Nexus Category Identity Route", existing_route)
    else:
        # Check if one already exists for this channel+category+profile combo
        found = frappe.db.get_value(
            "Nexus Category Identity Route",
            {
                "channel": category_channel,
                "chat_category": chat_category,
                "ai_agent_profile": ai_agent_profile,
            },
            "name",
        )
        if found:
            doc = frappe.get_doc("Nexus Category Identity Route", found)
        else:
            doc = frappe.new_doc("Nexus Category Identity Route")
            doc.chat_category = chat_category
            doc.priority = int(priority)

    doc.chat_category = chat_category
    doc.channel = category_channel
    doc.ai_agent_profile = ai_agent_profile
    doc.enabled = 1
    doc.published = 0

    # Replace child identity profiles
    doc.set("identity_profiles", [])
    for ip_name in identity_profiles:
        doc.append("identity_profiles", {"identity_profile": ip_name})

    is_new = doc.is_new()
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "status": "success",
        "created": 1 if is_new else 0,
        "updated": 0 if is_new else 1,
        "route_name": doc.name,
        "open_to_all": not bool(identity_profiles),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _slugify(text):
    """Convert a label to a code-friendly slug."""
    text = cstr(text).lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:60] or "profile"

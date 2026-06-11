import frappe


def get_authenticated_session_user():
    user = getattr(frappe.session, "user", None)
    if not user or user == "Guest":
        return None
    return user


def get_user_context(user=None):
    user = user or get_authenticated_session_user()
    if not user:
        return None

    return {
        "name": user,
        "email": frappe.db.get_value("User", user, "email") or user,
        "roles": frappe.get_roles(user),
    }


def get_session_user_type(user=None):
    user = user or get_authenticated_session_user()
    if not user:
        return "Guest"
    frappe_type = frappe.db.get_value("User", user, "user_type") or "System User"
    if frappe_type == "System User":
        return "Desk User"
    if frappe_type == "Website User":
        return "Website User"
    return "Guest"


def is_internal_session_user(user=None):
    user = user or get_authenticated_session_user()
    return bool(user and get_session_user_type(user) == "Desk User")


def is_system_manager_session_user(user=None):
    user = user or get_authenticated_session_user()
    return bool(user and "System Manager" in frappe.get_roles(user))


def resolve_behavior_from_chat_category(category_code, identity_type, is_authenticated=False, payload=None):
    """
    Resolve AI behavior for a visitor-selected chat category.

    Route selection:
    - Public visitors (identity_type == "Public"): find a route where is_public_route = 1.
    - Registered visitors: find a route whose permitted Identity Profiles intersect
      with the visitor's assigned Identity Profiles from their registry entry.

    Returns a behavior dict containing:
    - profile_name: Nexus AI Agent Profile name (for AI behavior config)
    - knowledge_profile_names: list of Knowledge Profile names (for knowledge access)
    - identity_type, route_name, category_code, etc.

    Raises if no matching route is found.
    """
    payload = payload or {}

    if not category_code:
        frappe.throw("Chat category is required to start this conversation.")

    if not frappe.db.exists("Nexus Chat Category", category_code):
        frappe.throw(f"Chat category '{category_code}' not found.")

    category = frappe.get_doc("Nexus Chat Category", category_code)

    if not category.enabled:
        frappe.throw(f"Chat category '{category_code}' is not currently active.")

    if category.requires_authentication and not is_authenticated:
        frappe.throw(
            "This conversation type requires you to be logged in. "
            "Please sign in and try again."
        )

    channel = category.channel

    if identity_type == "Public":
        route = _find_public_route(channel, category_code)
        if not route:
            frappe.throw(
                f"No public route configured for category '{category.category_label}'. "
                "Please contact support or try a different option."
            )
        knowledge_profile_names = []

    else:
        route, knowledge_profile_names = _find_registered_route(
            channel, category_code, identity_type, payload
        )
        if not route:
            frappe.throw(
                f"No route configured for category '{category.category_label}' "
                f"matching your identity ({identity_type}). "
                "Please contact support or try a different option."
            )

    profile = frappe.get_doc("Nexus AI Agent Profile", route.ai_agent_profile)

    return _build_behavior_dict(
        profile=profile,
        source="Nexus Category Identity Route",
        route_name=route.name,
        category_code=category.category_code,
        category_label=category.category_label,
        identity_type=identity_type,
        knowledge_profile_names=knowledge_profile_names,
    )


def resolve_behavior_from_conversation(conversation):
    """
    Restore AI behavior for a follow-up message from the snapshot frozen at
    conversation creation. Reads knowledge_profile_names from the snapshot so
    knowledge access is consistent across all turns of the same conversation.
    """
    import json

    if not conversation:
        return None

    profile_name = getattr(conversation, "assigned_ai_agent_profile", None)
    if not profile_name or not frappe.db.exists("Nexus AI Agent Profile", profile_name):
        return None

    snapshot = {}
    raw_snapshot = getattr(conversation, "ai_profile_snapshot_json", None)
    if raw_snapshot:
        try:
            snapshot = json.loads(raw_snapshot)
        except Exception:
            snapshot = {}

    profile = frappe.get_doc("Nexus AI Agent Profile", profile_name)

    return _build_behavior_dict(
        profile=profile,
        source="Nexus Live Conversation (snapshot)",
        category_code=getattr(conversation, "chat_category", None),
        identity_type=getattr(conversation, "resolved_identity_type", None),
        knowledge_profile_names=snapshot.get("knowledge_profile_names") or [],
    )


def resolve_behavior_for_internal_user(user):
    """
    Resolve knowledge access for an authenticated desk user via
    Nexus Identity Registry → Nexus Identity Profile → Knowledge Profile.

    Returns a minimal behavior dict carrying knowledge_profile_names for access
    resolution. AI behavior (prompts, tone) comes from the assigned AI agent itself.

    Returns None if no registry entry or no matching identity profile mappings.
    """
    from digitz_ai_nexus_live.services.identity_resolver import (
        _find_identity_registry,
        _get_active_registry_identity_profiles,
    )

    if not user or user == "Guest":
        return None

    if get_session_user_type(user) != "Desk User":
        return None

    payload = {"user_type": "Desk User"}
    registry_name = _find_identity_registry(payload)
    if not registry_name:
        return None

    registry = frappe.get_doc("Nexus Identity Registry", registry_name)
    if registry.verification_status == "Blocked":
        frappe.throw(
            "This identity is blocked from chat access. Please contact support.",
            title="Identity Blocked",
        )

    active_profiles = _get_active_registry_identity_profiles(registry)
    if not active_profiles:
        return None

    identity_type = "Admin" if is_system_manager_session_user(user) else "Internal"

    knowledge_profiles = []
    for profile_row in active_profiles:
        if not frappe.db.exists("Nexus Identity Profile", profile_row.identity_profile):
            continue
        ip_doc = frappe.get_doc("Nexus Identity Profile", profile_row.identity_profile)
        if not ip_doc.enabled:
            continue
        for row in ip_doc.identity_mappings or []:
            if row.identity_type == identity_type and row.knowledge_profile:
                knowledge_profiles.append(row.knowledge_profile)

    knowledge_profiles = list(set(knowledge_profiles))

    if not knowledge_profiles:
        return None

    return frappe._dict({
        "source": "Nexus Identity Registry",
        "profile_name": None,
        "knowledge_profile_names": knowledge_profiles,
        "route_name": None,
        "category_code": None,
        "category_label": None,
        "identity_type": identity_type,
        "behavior_prompt": None,
        "tone": None,
        "response_style": None,
        "welcome_message": None,
        "fallback_message": None,
        "memory_mode": None,
        "confidence_threshold": None,
        "escalation_enabled": False,
        "escalation_policy": None,
        "do_not_answer_rules": None,
    })


# ── Private helpers ────────────────────────────────────────────────────────────

def _find_public_route(channel, category_code):
    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters={
            "channel": channel,
            "chat_category": category_code,
            "is_public_route": 1,
            "enabled": 1,
        },
        fields=["name", "ai_agent_profile"],
        order_by="priority asc",
        limit_page_length=1,
    )
    return routes[0] if routes else None


def _find_registered_route(channel, category_code, identity_type, payload):
    """
    Find the highest-priority route for a registered visitor whose Identity Profiles
    intersect with the route's permitted Identity Profiles.

    Returns (route_dict, knowledge_profile_names) or (None, []).
    """
    from digitz_ai_nexus_live.services.identity_resolver import (
        _find_identity_registry,
        _get_active_registry_identity_profiles,
    )

    registry_name = _find_identity_registry(payload)
    if not registry_name:
        return None, []

    registry = frappe.get_doc("Nexus Identity Registry", registry_name)
    if registry.verification_status != "Verified":
        return None, []

    active_profiles = _get_active_registry_identity_profiles(registry)
    person_profile_names = {row.identity_profile for row in active_profiles if row.identity_profile}
    if not person_profile_names:
        return None, []

    all_routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters={"channel": channel, "chat_category": category_code, "enabled": 1},
        fields=["name", "ai_agent_profile"],
        order_by="priority asc",
    )

    for route in all_routes:
        route_profile_names = set(
            frappe.get_all(
                "Nexus Route Identity Profile",
                filters={"parent": route.name},
                pluck="identity_profile",
            )
        )

        matched = person_profile_names.intersection(route_profile_names)
        if not matched:
            continue

        # Collect knowledge profiles for this identity_type from matched profiles
        knowledge_profiles = []
        for profile_name in matched:
            if not frappe.db.exists("Nexus Identity Profile", profile_name):
                continue
            ip_doc = frappe.get_doc("Nexus Identity Profile", profile_name)
            if not ip_doc.enabled:
                continue
            for row in ip_doc.identity_mappings or []:
                if row.identity_type == identity_type and row.knowledge_profile:
                    knowledge_profiles.append(row.knowledge_profile)

        knowledge_profiles = list(set(knowledge_profiles))
        return route, knowledge_profiles

    return None, []


def _build_behavior_dict(
    profile,
    source,
    route_name=None,
    category_code=None,
    category_label=None,
    identity_type=None,
    knowledge_profile_names=None,
):
    return frappe._dict({
        "source": source,
        "route_name": route_name,
        "profile_name": profile.name if profile else None,
        "category_code": category_code,
        "category_label": category_label,
        "identity_type": identity_type,
        "knowledge_profile_names": knowledge_profile_names or [],
        "behavior_prompt": profile.behavior_prompt if profile else None,
        "tone": profile.tone if profile else None,
        "response_style": profile.response_style if profile else None,
        "welcome_message": profile.welcome_message if profile else None,
        "fallback_message": profile.fallback_message if profile else None,
        "memory_mode": profile.memory_mode if profile else None,
        "confidence_threshold": profile.confidence_threshold if profile else None,
        "escalation_enabled": profile.escalation_enabled if profile else False,
        "escalation_policy": profile.escalation_policy if profile else None,
        "do_not_answer_rules": profile.do_not_answer_rules if profile else None,
        "confidence_threshold_source": source,
    })

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
    # Map Frappe's internal user_type to the allowed values on Nexus Live Conversation
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


def resolve_behavior_from_chat_category(category_code, identity_type, is_authenticated=False):
    """
    Resolve AI behavior from a visitor-selected chat category and their identity type.

    Resolution path:
        Nexus Chat Category + Identity Type
            → Nexus Category Identity Route
            → Nexus AI Agent Profile

    Raises if:
    - Category does not exist or is disabled
    - Category requires authentication but visitor is not authenticated
    - No route exists for this category + identity type combination
    """
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

    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters={
            "channel": category.channel,
            "chat_category": category_code,
            "identity_type": identity_type,
            "enabled": 1,
        },
        fields=["name", "ai_agent_profile"],
        order_by="priority asc",
        limit_page_length=1,
    )

    if not routes:
        frappe.throw(
            f"No profile configured for category '{category.category_label}' "
            f"with identity '{identity_type}'. "
            "Please contact support or try a different option."
        )

    route = routes[0]
    profile_name = route.ai_agent_profile
    profile = frappe.get_doc("Nexus AI Agent Profile", profile_name)

    return _build_behavior_dict(
        profile=profile,
        source="Nexus Category Identity Route",
        route_name=route.name,
        category_code=category.category_code,
        category_label=category.category_label,
        identity_type=identity_type,
    )


def resolve_behavior_from_conversation(conversation):
    """
    Re-resolve behavior for a follow-up message using the profile stored on
    the conversation at creation time. This ensures follow-up messages use the
    same profile as the opening message even if configuration changes later.
    """
    if not conversation:
        return None

    profile_name = getattr(conversation, "assigned_ai_agent_profile", None)

    if not profile_name:
        return None

    if not frappe.db.exists("Nexus AI Agent Profile", profile_name):
        return None

    profile = frappe.get_doc("Nexus AI Agent Profile", profile_name)

    return _build_behavior_dict(
        profile=profile,
        source="Nexus Live Conversation (snapshot)",
        category_code=getattr(conversation, "chat_category", None),
        identity_type=getattr(conversation, "resolved_identity_type", None),
    )


def resolve_behavior_for_internal_user(user):
    """
    Resolve knowledge access for an authenticated internal desk user via
    Nexus User Profile Assignment → Knowledge Profile.

    Returns a minimal behavior dict carrying knowledge_profile_name for access
    resolution. AI behavior (prompts, tone) comes from the assigned agent itself.
    """
    if not user or user == "Guest":
        return None

    if get_session_user_type(user) != "Desk User":
        return None

    row = frappe.db.get_value(
        "Nexus User Profile Assignment",
        {"user": user, "active": 1},
        ["name", "knowledge_profile"],
        as_dict=True,
    )

    if not row or not row.knowledge_profile:
        return None

    return frappe._dict({
        "source": "Nexus User Profile Assignment",
        "profile_name": None,
        "knowledge_profile_name": row.knowledge_profile,
        "category_code": None,
        "identity_type": None,
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


def _build_behavior_dict(
    profile,
    source,
    route_name=None,
    category_code=None,
    category_label=None,
    identity_type=None,
):
    """
    Build a standard behavior dict from a Nexus AI Agent Profile document.
    Compatible with the shape returned by agent_service.get_agent_behavior().
    """
    return frappe._dict({
        "source": source,
        "route_name": route_name,
        "profile_name": profile.name,
        "category_code": category_code,
        "category_label": category_label,
        "identity_type": identity_type,
        "behavior_prompt": profile.behavior_prompt,
        "tone": profile.tone,
        "response_style": profile.response_style,
        "welcome_message": profile.welcome_message,
        "fallback_message": profile.fallback_message,
        "memory_mode": profile.memory_mode,
        "confidence_threshold": profile.confidence_threshold,
        "escalation_enabled": profile.escalation_enabled,
        "escalation_policy": profile.escalation_policy,
        "do_not_answer_rules": profile.do_not_answer_rules,
        "confidence_threshold_source": source,
    })

import frappe


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

    profile_name = frappe.db.get_value(
        "Nexus Category Identity Route",
        {
            "channel": category.channel,
            "chat_category": category_code,
            "identity_type": identity_type,
            "enabled": 1,
        },
        "ai_agent_profile",
        order_by="priority asc",
    )

    if not profile_name:
        frappe.throw(
            f"No profile configured for category '{category.category_label}' "
            f"with identity '{identity_type}'. "
            "Please contact support or try a different option."
        )

    profile = frappe.get_doc("Nexus AI Agent Profile", profile_name)

    return _build_behavior_dict(
        profile=profile,
        source="Nexus Category Identity Route",
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
    )


def resolve_behavior_for_internal_user(user):
    """
    Resolve AI behavior for an authenticated internal desk user via direct
    profile assignment (Nexus User Profile Assignment).
    """
    if not user or user == "Guest":
        return None

    assignment_name = frappe.db.get_value(
        "Nexus User Profile Assignment",
        {"user": user, "active": 1},
        "name",
    )

    if not assignment_name:
        return None

    assignment = frappe.get_doc("Nexus User Profile Assignment", assignment_name)
    profile = frappe.get_doc("Nexus AI Agent Profile", assignment.ai_agent_profile)

    return _build_behavior_dict(
        profile=profile,
        source="Nexus User Profile Assignment",
    )


def _build_behavior_dict(
    profile,
    source,
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
        "profile_name": profile.name,
        "category_code": category_code,
        "category_label": category_label,
        "identity_type": identity_type,
        "uses_assigned_behaviour": 0,
        "behaviour": None,
        "behaviour_code": None,
        "behaviour_name": None,
        "behaviour_designation": None,
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

import json

import frappe

_NEXY_TRIGGER_KEYWORDS = [
    "price", "pricing", "cost", "costs", "how much", "rates", "fee", "fees",
    "subscription", "plan", "plans", "package", "packages", "quote", "quotation",
    "demo", "demonstration", "trial", "show me",
    "consultancy", "consultation", "consult", "consulting",
    "proposal", "enterprise", "custom solution",
    "buy", "purchase", "get started", "sign up",
]


def detect_nexy_intent(message: str) -> bool:
    """Return True if the visitor message contains a Nexy handover trigger."""
    lower = message.lower()
    return any(kw in lower for kw in _NEXY_TRIGGER_KEYWORDS)


def get_nexy_category(channel: str, tenant=None):
    """
    Return the name of the first active, published 'Use for Nexy' category
    for the given channel, or None if none exists.
    """
    filters = {"channel": channel, "use_for_nexy": 1, "enabled": 1, "published": 1}
    if tenant:
        filters["tenant"] = tenant
    cats = frappe.get_all(
        "Nexus Chat Category",
        filters=filters,
        fields=["name"],
        order_by="display_order asc, category_label asc",
        limit=1,
    )
    return cats[0]["name"] if cats else None


def validate_nexy_routing(channel: str, tenant=None) -> list:
    """
    Validate Nexy routing setup for a channel.
    Returns a list of error strings; empty list means the setup is valid.
    """
    errors = []
    cat_name = get_nexy_category(channel, tenant)
    if not cat_name:
        errors.append("No active, published 'Use for Nexy' category found for this channel.")
        return errors

    cat = frappe.get_doc("Nexus Chat Category", cat_name)

    settings = frappe.get_single("Nexus Settings")
    if settings.nexy_email_verification_mandatory:
        if not cat.identity_verification_mode or cat.identity_verification_mode == "None":
            errors.append(
                f"Nexy category '{cat_name}' has no identity verification configured, "
                "but Nexus Settings requires it for Nexy connections."
            )

    route = frappe.db.get_value(
        "Nexus Category Identity Route",
        {"chat_category": cat_name, "enabled": 1, "published": 1},
        "name",
    )
    if not route:
        errors.append(
            f"Nexy category '{cat_name}' has no active, published routing. "
            "Create and publish a Nexus Category Identity Route for it."
        )

    return errors


def _is_already_nexy(conversation) -> bool:
    """Return True if the conversation is already assigned to a Nexy category."""
    cat = getattr(conversation, "chat_category", None)
    if not cat:
        return False
    return bool(frappe.db.get_value("Nexus Chat Category", cat, "use_for_nexy"))


def initiate_nexy_handover(conversation, payload: dict):
    """
    Trigger a Nexy handover from the current conversation.

    - Resolves the Nexy category for the channel.
    - If the Nexy category requires email verification and the visitor has not yet
      verified, sets intent to 'await_nexy_verification' and stores the pending category.
    - If verification is not required (or already done), completes the handover immediately.

    Returns one of:
      "await_nexy_verification" — caller should prompt for email verification
      "nexy_handover_complete"  — handover done; conversation reassigned
      None                      — no Nexy category available, do nothing
    """
    channel = conversation.channel
    tenant = frappe.db.get_value("Nexus Live Channel", channel, "tenant") if channel else None

    nexy_cat_name = get_nexy_category(channel, tenant)
    if not nexy_cat_name:
        return None

    nexy_cat = frappe.get_doc("Nexus Chat Category", nexy_cat_name)

    verification_needed = (
        nexy_cat.identity_verification_mode
        and nexy_cat.identity_verification_mode != "None"
    )
    already_verified = bool(
        getattr(conversation, "visitor_email", None)
        or getattr(conversation, "resolved_identity_type", None)
    )

    frappe.db.set_value(
        "Nexus Live Conversation",
        conversation.name,
        "nexy_handover_category",
        nexy_cat_name,
        update_modified=False,
    )
    conversation.nexy_handover_category = nexy_cat_name

    if verification_needed and not already_verified:
        frappe.db.set_value(
            "Nexus Live Conversation",
            conversation.name,
            "intent",
            "await_nexy_verification",
            update_modified=False,
        )
        conversation.intent = "await_nexy_verification"
        return "await_nexy_verification"

    return complete_nexy_handover(conversation, payload)


def complete_nexy_handover(conversation, payload: dict):
    """
    Finalise the Nexy handover: resolve the Nexy AI profile, rewrite the conversation's
    category and profile snapshot, and clear the pending handover state.

    Returns "nexy_handover_complete" on success, None on failure.
    """
    from digitz_ai_nexus_live.services.profile_resolver import resolve_behavior_from_chat_category
    from digitz_ai_nexus_live.services.identity_resolver import resolve_identity_type

    nexy_cat_name = getattr(conversation, "nexy_handover_category", None)
    if not nexy_cat_name:
        return None

    identity_type = resolve_identity_type(payload) or getattr(
        conversation, "resolved_identity_type", "Public"
    ) or "Public"

    is_authenticated = (
        payload.get("user_type", "Guest") != "Guest"
        and bool(payload.get("user"))
    ) or frappe.session.user not in ("Guest", None, "")

    cat_behavior = resolve_behavior_from_chat_category(
        nexy_cat_name,
        identity_type,
        is_authenticated,
        payload=payload,
    )
    if not cat_behavior or not cat_behavior.profile_name:
        return None

    profile = frappe.get_doc("Nexus AI Agent Profile", cat_behavior.profile_name)

    from digitz_ai_nexus_live.services.conversation_service import _pick_nickname

    nickname = _pick_nickname(profile)
    snapshot = {
        "name": profile.name,
        "nickname": nickname,
        "chat_category": nexy_cat_name,
        "identity_type": identity_type,
        "knowledge_profile_names": cat_behavior.knowledge_profile_names or [],
        "behavior_prompt": profile.behavior_prompt,
        "tone": profile.tone,
        "response_style": profile.response_style,
        "welcome_message": profile.welcome_message,
        "fallback_message": profile.fallback_message,
        "do_not_answer_rules": profile.do_not_answer_rules,
        "confidence_threshold": profile.confidence_threshold,
        "escalation_enabled": profile.escalation_enabled,
        "escalation_policy": profile.escalation_policy,
        "memory_mode": profile.memory_mode,
        "default_response_mode": profile.default_response_mode,
        "collect_visitor_name": getattr(profile, "collect_visitor_name", 0),
    }

    frappe.db.set_value(
        "Nexus Live Conversation",
        conversation.name,
        {
            "chat_category": nexy_cat_name,
            "assigned_agent": profile.name,
            "assigned_agent_type": "AI",
            "assigned_ai_agent_profile": profile.name,
            "ai_profile_snapshot_json": json.dumps(snapshot),
            "intent": "",
            "nexy_handover_category": None,
        },
        update_modified=False,
    )

    # Keep payload consistent so the next AI call uses the Nexy profile
    payload["chat_category"] = nexy_cat_name
    payload["knowledge_profile_names"] = cat_behavior.knowledge_profile_names or []

    conversation.reload()
    return "nexy_handover_complete"

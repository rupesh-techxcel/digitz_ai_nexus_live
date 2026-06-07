import frappe


def resolve_intents_for_profile(profile_name=None):
    """
    Merge global Nexus Intent Handlers with profile-level overrides.

    Each returned entry:
        name, intent_name, trigger_description, action_type,
        response_template, priority,
        active (False = disabled for this profile),
        decline_response (message when active=False)
    """
    if not frappe.db.exists("DocType", "Nexus Intent Handler"):
        return []

    global_handlers = frappe.get_all(
        "Nexus Intent Handler",
        filters={"enabled": 1},
        fields=["name", "intent_name", "trigger_description", "action_type", "response_template", "priority"],
        order_by="priority asc",
    )

    if not global_handlers:
        return []

    override_map = {}
    if profile_name and frappe.db.exists("Nexus AI Agent Profile", profile_name):
        profile = frappe.get_doc("Nexus AI Agent Profile", profile_name)
        for row in (profile.get("intent_overrides") or []):
            override_map[row.intent_handler] = row

    resolved = []
    for handler in global_handlers:
        override = override_map.get(handler["name"])

        entry = {
            "name": handler["name"],
            "intent_name": handler["intent_name"],
            "trigger_description": handler["trigger_description"],
            "action_type": handler["action_type"],
            "response_template": handler.get("response_template") or "",
            "priority": handler.get("priority") or 10,
            "active": True,
            "decline_response": "",
        }

        if override:
            if override.disabled:
                entry["active"] = False
                entry["decline_response"] = override.decline_response or ""
            else:
                if override.override_action_type:
                    entry["action_type"] = override.override_action_type
                if override.override_response:
                    entry["response_template"] = override.override_response

        resolved.append(entry)

    return resolved

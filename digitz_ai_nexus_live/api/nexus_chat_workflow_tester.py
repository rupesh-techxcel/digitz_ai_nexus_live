import frappe

from digitz_ai_nexus_live.api.nexus_category_profile_router import get_route_chain
from digitz_ai_nexus_live.services.identity_resolver import (
    resolve_identity_type,
    resolve_registered_identity_type,
)


@frappe.whitelist()
def get_page_data():
    channels = frappe.get_all(
        "Nexus Live Channel",
        filters={"enabled": 1},
        fields=["name", "channel_code", "channel_name", "channel_type", "requires_visitor_email"],
        order_by="channel_name asc",
    )

    return {"channels": channels}


@frappe.whitelist()
def get_channel_categories(channel):
    categories = frappe.get_all(
        "Nexus Chat Category",
        filters={"channel": channel, "enabled": 1},
        fields=[
            "name",
            "category_code",
            "category_label",
            "visibility",
            "identity_verification_mode",
            "allow_public_fallback",
            "display_order",
        ],
        order_by="display_order asc",
    )

    return {"categories": categories}


@frappe.whitelist()
def simulate_workflow(
    channel,
    chat_category,
    visitor_email=None,
    assume_authenticated=0,
    assume_email_verified=0,
):
    if not channel:
        frappe.throw("Channel is required.")
    if not chat_category:
        frappe.throw("Chat category is required.")

    result = {
        "input": {
            "channel": channel,
            "chat_category": chat_category,
            "visitor_email": _normalize_email(visitor_email),
            "assume_authenticated": int(assume_authenticated or 0),
            "assume_email_verified": int(assume_email_verified or 0),
        },
        "category": None,
        "identity_registry": None,
        "registered_identities": [],
        "resolved_identity_type": None,
        "route_chain": None,
        "warnings": [],
        "blocked": 0,
    }

    if not frappe.db.exists("Nexus Chat Category", chat_category):
        frappe.throw(f"Chat category '{chat_category}' not found.")

    category = frappe.get_doc("Nexus Chat Category", chat_category)
    result["category"] = {
        "name": category.name,
        "category_code": category.category_code,
        "category_label": category.category_label,
        "channel": category.channel,
        "visibility": category.visibility or "External",
        "identity_verification_mode": category.identity_verification_mode or "None",
        "allow_public_fallback": category.allow_public_fallback,
        "enabled": category.enabled,
    }

    if category.channel != channel:
        result["warnings"].append(
            f"Selected category belongs to channel '{category.channel}', not '{channel}'."
        )

    if category.visibility == "Internal" and not int(assume_authenticated or 0):
        result["blocked"] = 1
        result["warnings"].append("Category is Internal only — not accessible to unauthenticated public visitors.")
        return result

    registry_name = _get_registry_for_email(result["input"]["visitor_email"])
    if registry_name:
        registry = frappe.get_doc("Nexus Identity Registry", registry_name)
        result["identity_registry"] = {
            "name": registry.name,
            "email": registry.email,
            "full_name": registry.full_name,
            "enabled": registry.enabled,
            "verification_status": registry.verification_status,
            "user": registry.user,
            "reference_doctype": registry.reference_doctype,
            "reference_name": registry.reference_name,
            "reference_label": registry.reference_label,
            "contact": registry.contact,
        }
        result["registered_identities"] = [
            {
                "identity_profile": row.identity_profile,
                "is_primary": row.is_primary,
                "valid_from": row.valid_from,
                "valid_until": row.valid_until,
            }
            for row in registry.identity_profiles
        ]
    elif result["input"]["visitor_email"]:
        result["warnings"].append("No enabled identity registry found for this email.")

    identity_type = _resolve_simulated_identity(
        channel=channel,
        chat_category=chat_category,
        visitor_email=result["input"]["visitor_email"],
        category=result["category"],
        assume_authenticated=int(assume_authenticated or 0),
        assume_email_verified=int(assume_email_verified or 0),
        warnings=result["warnings"],
    )

    if not identity_type:
        result["blocked"] = 1
        result["warnings"].append("No identity type could be resolved for this scenario.")
        return result

    result["resolved_identity_type"] = identity_type
    result["route_chain"] = get_route_chain(channel, chat_category, identity_type=identity_type)

    if result["route_chain"].get("warnings"):
        result["warnings"].extend(result["route_chain"]["warnings"])

    if not result["route_chain"].get("profile"):
        result["blocked"] = 1

    return result


def _resolve_simulated_identity(
    channel,
    chat_category,
    visitor_email,
    category,
    assume_authenticated,
    assume_email_verified,
    warnings,
):
    mode = category.get("identity_verification_mode") or "None"

    if mode == "Registered Email OTP":
        if not assume_email_verified:
            warnings.append("Registered Email OTP must be verified before runtime identity can elevate.")
            return None

        registered_identity = resolve_registered_identity_type({
            "channel": channel,
            "chat_category": chat_category,
            "visitor_email": visitor_email,
            "trust_visitor_email": 1,
        })
        if registered_identity:
            return registered_identity

        if category.get("allow_public_fallback"):
            warnings.append("No registered identity matched; public fallback is enabled.")
            return "Public"

        warnings.append("Registered Email OTP requires a verified registry identity for this category.")
        return None

    if mode == "Email OTP":
        if not assume_email_verified:
            warnings.append("Email OTP must be verified before chat can start.")
            return None

        registered_identity = resolve_registered_identity_type({
            "channel": channel,
            "chat_category": chat_category,
            "visitor_email": visitor_email,
            "trust_visitor_email": 1,
        })
        if registered_identity:
            return registered_identity

        return "Public"

    payload = {
        "channel": channel,
        "chat_category": chat_category,
        "visitor_email": visitor_email,
        "user_type": "Website User" if assume_authenticated else "Guest",
    }
    return resolve_identity_type(payload)


def _get_registry_for_email(email):
    if not email:
        return None

    return frappe.db.get_value(
        "Nexus Identity Registry",
        {"email": email, "enabled": 1},
        "name",
    )


def _normalize_email(email):
    if not email:
        return None
    return email.strip().lower()

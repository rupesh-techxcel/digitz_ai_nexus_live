import frappe
from frappe.utils import getdate, nowdate


DEFAULT_IDENTITY_TYPES = ("Public", "Customer", "Prospect", "Partner", "Internal", "Admin")


def get_enabled_identity_types():
    """Return enabled identity type document names in display order."""
    if not frappe.db.exists("DocType", "Nexus Identity Type"):
        return list(DEFAULT_IDENTITY_TYPES)

    identity_types = frappe.get_all(
        "Nexus Identity Type",
        filters={"enabled": 1},
        pluck="name",
        order_by="sort_order asc, title asc",
    )

    return identity_types


def is_valid_identity_type(identity_type):
    if not identity_type:
        return False

    if not frappe.db.exists("DocType", "Nexus Identity Type"):
        return identity_type in DEFAULT_IDENTITY_TYPES

    return bool(
        frappe.db.exists(
            "Nexus Identity Type",
            {"name": identity_type, "enabled": 1},
        )
    )


def resolve_identity_type(payload):
    """
    Derive the visitor's identity type from request context.

    Priority:
    1. Trusted explicit identity_type in payload, for server-side integrations only.
    2. Verified OTP challenge or authenticated session registry.
    3. Derived from frappe session user type and roles.

    Returns a `Nexus Identity Type` document name.
    """
    explicit = payload.get("identity_type")
    if explicit:
        if payload.get("trust_payload_identity") and is_valid_identity_type(explicit):
            return explicit

        if payload.get("trust_payload_identity"):
            frappe.throw(f"Identity Type '{explicit}' is not enabled or does not exist.")

    verified_challenge_identity = _resolve_verified_challenge_identity(payload)
    if verified_challenge_identity:
        return verified_challenge_identity

    registered_identity = resolve_registered_identity_type(payload)
    if registered_identity:
        return registered_identity

    user = frappe.session.user
    user_type = payload.get("user_type") or "Guest"

    if not user or user == "Guest" or user_type == "Guest":
        return "Public"

    frappe_user_type = frappe.db.get_value("User", user, "user_type") or ""

    if frappe_user_type == "Website User":
        return "Customer"

    if frappe_user_type == "System User":
        roles = set(frappe.get_roles(user))

        if "System Manager" in roles:
            return "Admin"

        return "Internal"

    api_scope = payload.get("api_scope") or ""
    if api_scope.lower() == "partner":
        return "Partner"
    if api_scope.lower() == "prospect":
        return "Prospect"

    return "Public"


def resolve_registered_identity_type(payload):
    """Resolve identity from a verified Nexus Identity Registry record."""
    if not frappe.db.exists("DocType", "Nexus Identity Registry"):
        return None

    registry_name = _find_identity_registry(payload)
    if not registry_name:
        return None

    registry = frappe.get_doc("Nexus Identity Registry", registry_name)

    if registry.verification_status == "Blocked":
        frappe.throw(
            "This identity is blocked from chat access. Please contact support.",
            title="Identity Blocked",
        )

    if registry.verification_status != "Verified":
        return None

    identities = _get_active_registry_identities(registry)
    if not identities:
        return None

    routed_identity = _pick_identity_for_chat_category(
        identities=identities,
        chat_category=payload.get("chat_category"),
        channel=payload.get("channel"),
    )
    if routed_identity:
        return routed_identity

    primary = next((row.identity_type for row in identities if row.is_primary), None)
    if primary:
        return primary

    return identities[0].identity_type


def resolve_identity_registry_name(payload):
    """Return the matched enabled identity registry for this payload, if any."""
    return _find_identity_registry(payload)


def resolve_identity_safeguard_access_categories(payload):
    """
    Return parent-level Safe Guard access categories for the matched registry.

    Returns:
    - None when no registry is resolved, so no registry safeguard cap applies.
    - [] when a registry exists but no enabled safeguards are configured, so
      registered identity access fails closed.
    - list[str] of access category names when safeguards are configured.
    """
    if not frappe.db.exists("DocType", "Nexus Identity Registry"):
        return None

    registry_name = _find_identity_registry(payload)
    if not registry_name:
        return None

    registry = frappe.get_doc("Nexus Identity Registry", registry_name)

    if registry.verification_status == "Blocked":
        frappe.throw(
            "This identity is blocked from chat access. Please contact support.",
            title="Identity Blocked",
        )

    if registry.verification_status != "Verified":
        return []

    return [
        row.access_category
        for row in registry.safe_guard_access_categories or []
        if row.access_category
    ]


def _find_identity_registry(payload):
    verified_registry = _resolve_verified_challenge_registry(payload)
    if verified_registry:
        return verified_registry

    user = frappe.session.user
    if user and user != "Guest":
        registry_name = frappe.db.get_value(
            "Nexus Identity Registry",
            {"user": user, "enabled": 1},
            "name",
        )
        if registry_name:
            return registry_name

    email = _get_payload_email(payload)
    if email and payload.get("trust_visitor_email"):
        return frappe.db.get_value(
            "Nexus Identity Registry",
            {"email": email, "enabled": 1},
            "name",
        )

    return None


def _resolve_verified_challenge_registry(payload):
    if not payload.get("identity_verification_challenge"):
        return None

    from digitz_ai_nexus_live.services.identity_verification import get_verified_challenge

    challenge = get_verified_challenge(
        challenge_token=payload.get("identity_verification_challenge"),
        chat_category=payload.get("chat_category"),
        email=payload.get("visitor_email") or payload.get("email"),
    )

    if not challenge:
        return None

    return challenge.identity_registry


def _get_payload_email(payload):
    email = payload.get("visitor_email") or payload.get("email")

    user_context = payload.get("user")
    if isinstance(user_context, dict):
        email = email or user_context.get("email") or user_context.get("name")

    if not email:
        session_user = frappe.session.user
        if session_user and session_user != "Guest":
            email = frappe.db.get_value("User", session_user, "email") or session_user

    if not email:
        return None

    return email.strip().lower()


def _get_active_registry_identities(registry):
    today = getdate(nowdate())
    rows = []

    for row in registry.identities or []:
        if not row.enabled or not row.identity_type:
            continue
        if not is_valid_identity_type(row.identity_type):
            continue
        if row.valid_from and getdate(row.valid_from) > today:
            continue
        if row.valid_until and getdate(row.valid_until) < today:
            continue
        rows.append(row)

    return sorted(rows, key=lambda item: 0 if item.is_primary else 1)


def _pick_identity_for_chat_category(identities, chat_category=None, channel=None):
    if not chat_category:
        return None

    category_channel = frappe.db.get_value("Nexus Chat Category", chat_category, "channel")
    route_channel = category_channel or channel
    if not route_channel:
        return None

    for row in identities:
        route = frappe.db.exists(
            "Nexus Category Identity Route",
            {
                "channel": route_channel,
                "chat_category": chat_category,
                "identity_type": row.identity_type,
                "enabled": 1,
            },
        )
        if route:
            return row.identity_type

    return None


def _resolve_verified_challenge_identity(payload):
    if not payload.get("identity_verification_challenge"):
        return None

    from digitz_ai_nexus_live.services.identity_verification import (
        resolve_identity_from_verified_challenge,
    )

    return resolve_identity_from_verified_challenge(payload)

import frappe
from frappe.utils import getdate, nowdate


DEFAULT_IDENTITY_TYPES = ("Public", "Customer", "Prospect", "Partner", "Internal", "Admin")


def get_enabled_identity_types():
    """Return enabled identity type document names in display order."""
    if not frappe.db.exists("DocType", "Nexus Identity Type"):
        return list(DEFAULT_IDENTITY_TYPES)

    return frappe.get_all(
        "Nexus Identity Type",
        filters={"enabled": 1},
        pluck="name",
        order_by="sort_order asc, title asc",
    )


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
    1. Trusted explicit identity_type in payload (server-side integrations only).
    2. Verified OTP challenge.
    3. Nexus Identity Registry lookup — works for any website (Frappe or external).
       Uses existing security gates: OTP-verified session, Frappe login, or
       server-asserted trust_visitor_email. Registry takes precedence over
       Frappe user type so the configured identity model is always authoritative.
    4. Frappe session fallback — for Frappe portal users with no registry entry.
    5. api_scope field (Partner / Prospect for programmatic API calls).
    6. Default: Public.

    Blocks if the resolved registry is blocked.
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

    # Raise if the resolved registry is blocked
    _assert_registry_not_blocked(payload)

    # Registry-based resolution — authoritative for all website types.
    # _find_identity_registry uses security-gated lookup (OTP / Frappe session /
    # trust_visitor_email), so this is safe for external widget deployments.
    registry_identity = _resolve_identity_type_from_registry(payload)
    if registry_identity:
        return registry_identity

    # Frappe session fallback — only meaningful when the widget runs inside a
    # Frappe portal and the visitor has a Frappe login but no registry entry.
    user = frappe.session.user
    user_type = payload.get("user_type") or "Guest"

    if not user or user == "Guest" or user_type == "Guest":
        api_scope = payload.get("api_scope") or ""
        if api_scope.lower() == "partner":
            return "Partner"
        if api_scope.lower() == "prospect":
            return "Prospect"
        return "Public"

    frappe_user_type = frappe.db.get_value("User", user, "user_type") or ""

    if frappe_user_type == "Website User":
        return "Customer"

    if frappe_user_type == "System User":
        roles = set(frappe.get_roles(user))
        if "System Manager" in roles:
            return "Admin"
        return "Internal"

    return "Public"


def resolve_identity_registry_name(payload):
    """Return the matched enabled identity registry name for this payload, if any."""
    return _find_identity_registry(payload)


def resolve_identity_safeguard_access_categories(payload, identity_type=None):
    """
    Return safeguard access categories for the resolved identity type.

    Safeguards now live on Nexus Identity Type (not on the registry).
    They are a hard cap applied uniformly to all holders of that identity class.

    Returns:
    - None if identity_type is Public or unknown (no cap applies).
    - [] if the identity type exists but has no safeguards (fails closed for registered users).
    - list[str] of access category names when safeguards are configured.
    """
    resolved_type = identity_type or payload.get("identity_type")
    if not resolved_type or resolved_type == "Public":
        return None

    if not frappe.db.exists("Nexus Identity Type", resolved_type):
        return []

    categories = frappe.get_all(
        "Nexus Identity Type Safe Guard Category",
        filters={"parent": resolved_type, "parentfield": "safeguard_access_categories"},
        pluck="access_category",
    )

    return categories if categories else None


def resolve_registered_identity_type(payload):
    """
    Return the identity type for a verified registered visitor.

    Used by challenge-based verification (Email OTP / Registered Email OTP) to
    determine what identity class to stamp on the challenge at issue time.

    Resolution:
    1. Find the registry entry (by OTP challenge, Frappe user, or trusted email).
    2. Require verification_status = "Verified".
    3. Get active identity profiles (sorted primary-first, date-range checked).
    4. If channel + chat_category are in the payload, narrow by the route's
       permitted identity profiles.
    5. Return the identity_type from the first mapping in the best matching profile.

    Returns None if no registry, not verified, or no compatible profile/mapping.
    """
    registry_name = _find_identity_registry(payload)
    if not registry_name:
        return None

    registry = frappe.get_doc("Nexus Identity Registry", registry_name)
    if registry.verification_status != "Verified":
        return None

    active_profiles = _get_active_registry_identity_profiles(registry)
    if not active_profiles:
        return None

    # Keep insertion order (primary-first from sort) as a list
    person_profile_names = [
        row.identity_profile for row in active_profiles if row.identity_profile
    ]

    # Narrow to route's permitted profiles when channel + category are known
    channel = payload.get("channel")
    chat_category = payload.get("chat_category")
    if channel and chat_category:
        route_name = frappe.db.get_value(
            "Nexus Category Identity Route",
            {"channel": channel, "chat_category": chat_category, "enabled": 1},
            "name",
            order_by="priority asc",
        )
        if route_name:
            permitted = set(
                frappe.get_all(
                    "Nexus Route Identity Profile",
                    filters={"parent": route_name},
                    pluck="identity_profile",
                )
            )
            person_profile_names = [p for p in person_profile_names if p in permitted]

    if not person_profile_names:
        return None

    # Return the first identity_type found — primary profile takes precedence
    for profile_name in person_profile_names:
        if not frappe.db.exists("Nexus Identity Profile", profile_name):
            continue
        ip_doc = frappe.get_doc("Nexus Identity Profile", profile_name)
        if not ip_doc.enabled:
            continue
        for row in ip_doc.identity_mappings or []:
            if row.identity_type:
                return row.identity_type

    return None


def resolve_registry_knowledge_profiles(payload, identity_type, route_name=None):
    """
    Resolve the union of Knowledge Profile names for this visitor/user.

    Resolution:
    1. Find the person's Nexus Identity Registry entry.
    2. Get all their active assigned Identity Profiles.
    3. If a route_name is given, intersect with the route's permitted profiles.
    4. From matched profiles, collect all knowledge_profile values where
       identity_type == session identity_type.
    5. Return deduplicated list (union).

    Returns [] for Public (no registry; access policy cap handles restriction).
    Returns [] if no registry or no matching mappings.
    """
    if identity_type == "Public":
        return []

    registry_name = _find_identity_registry(payload)
    if not registry_name:
        return []

    registry = frappe.get_doc("Nexus Identity Registry", registry_name)
    if registry.verification_status != "Verified":
        return []

    active_profiles = _get_active_registry_identity_profiles(registry)
    if not active_profiles:
        return []

    person_profile_names = {row.identity_profile for row in active_profiles if row.identity_profile}

    # Narrow to route-permitted profiles when a route is known
    if route_name and frappe.db.exists("Nexus Category Identity Route", route_name):
        route_permitted = set(
            frappe.get_all(
                "Nexus Route Identity Profile",
                filters={"parent": route_name},
                pluck="identity_profile",
            )
        )
        matched_profile_names = person_profile_names.intersection(route_permitted)
    else:
        matched_profile_names = person_profile_names

    if not matched_profile_names:
        return []

    knowledge_profiles = []
    for profile_name in matched_profile_names:
        if not frappe.db.exists("Nexus Identity Profile", profile_name):
            continue
        ip_doc = frappe.get_doc("Nexus Identity Profile", profile_name)
        if not ip_doc.enabled:
            continue
        for row in ip_doc.identity_mappings or []:
            if row.identity_type == identity_type and row.knowledge_profile:
                knowledge_profiles.append(row.knowledge_profile)

    return list(set(knowledge_profiles))


# ── Private helpers ────────────────────────────────────────────────────────────

def _find_identity_registry(payload):
    """Locate the Nexus Identity Registry for this session/payload."""
    if not frappe.db.exists("DocType", "Nexus Identity Registry"):
        return None

    # 1. OTP challenge registry
    verified_registry = _resolve_verified_challenge_registry(payload)
    if verified_registry:
        return verified_registry

    # 2. Authenticated Frappe session user
    user = frappe.session.user
    if user and user != "Guest":
        registry_name = frappe.db.get_value(
            "Nexus Identity Registry",
            {"user": user, "enabled": 1},
            "name",
        )
        if registry_name:
            return registry_name

    # 3. Trusted visitor email
    email = _get_payload_email(payload)
    if email and payload.get("trust_visitor_email"):
        return frappe.db.get_value(
            "Nexus Identity Registry",
            {"email": email, "enabled": 1},
            "name",
        )

    return None


def _assert_registry_not_blocked(payload):
    """Raise if the resolved registry is blocked. Silent if no registry found."""
    if not frappe.db.exists("DocType", "Nexus Identity Registry"):
        return

    registry_name = _find_identity_registry(payload)
    if not registry_name:
        return

    status = frappe.db.get_value("Nexus Identity Registry", registry_name, "verification_status")
    if status == "Blocked":
        frappe.throw(
            "This identity is blocked from chat access. Please contact support.",
            title="Identity Blocked",
        )


def _get_active_registry_identity_profiles(registry):
    """
    Return active Nexus Registry Identity Profile rows from the registry,
    sorted primary-first. Validity dates are respected.
    """
    today = getdate(nowdate())
    rows = []

    for row in registry.identity_profiles or []:
        if not row.identity_profile:
            continue
        if row.valid_from and getdate(row.valid_from) > today:
            continue
        if row.valid_until and getdate(row.valid_until) < today:
            continue
        rows.append(row)

    return sorted(rows, key=lambda r: 0 if r.is_primary else 1)


def _resolve_verified_challenge_registry(payload):
    if not payload.get("identity_verification_challenge"):
        return None

    from digitz_ai_nexus_live.services.identity_verification import get_verified_challenge

    challenge = get_verified_challenge(
        challenge_token=payload.get("identity_verification_challenge"),
        chat_category=payload.get("chat_category"),
        email=payload.get("visitor_email") or payload.get("email"),
    )

    return challenge.identity_registry if challenge else None


def _resolve_verified_challenge_identity(payload):
    if not payload.get("identity_verification_challenge"):
        return None

    from digitz_ai_nexus_live.services.identity_verification import (
        resolve_identity_from_verified_challenge,
    )

    return resolve_identity_from_verified_challenge(payload)


def _resolve_identity_type_from_registry(payload):
    """
    Resolve identity type from the visitor's Nexus Identity Registry entry.

    Uses _find_identity_registry which enforces security gates:
      - Verified OTP challenge token present in this session
      - Authenticated Frappe session user
      - Server-asserted trust_visitor_email flag

    Returns the identity_type from the visitor's primary active Identity Profile,
    or None if no registry found, not verified, or no profile mappings configured.
    """
    registry_name = _find_identity_registry(payload)
    if not registry_name:
        return None

    registry = frappe.get_doc("Nexus Identity Registry", registry_name)
    if registry.verification_status != "Verified":
        return None

    active_profiles = _get_active_registry_identity_profiles(registry)
    if not active_profiles:
        return None

    for row in active_profiles:
        if not row.identity_profile:
            continue
        if not frappe.db.exists("Nexus Identity Profile", row.identity_profile):
            continue
        ip_doc = frappe.get_doc("Nexus Identity Profile", row.identity_profile)
        if not ip_doc.enabled:
            continue
        for mapping in ip_doc.identity_mappings or []:
            if mapping.identity_type:
                return mapping.identity_type

    return None


def _get_payload_email(payload):
    email = payload.get("visitor_email") or payload.get("email")

    user_context = payload.get("user")
    if isinstance(user_context, dict):
        email = email or user_context.get("email") or user_context.get("name")

    if not email:
        session_user = frappe.session.user
        if session_user and session_user != "Guest":
            email = frappe.db.get_value("User", session_user, "email") or session_user

    return email.strip().lower() if email else None

import frappe


DEFAULT_IDENTITY_TYPES = ("Public", "Customer", "Prospect", "Partner", "Internal", "Admin")


def get_enabled_identity_types():
    """Return enabled identity type document names in display order."""
    if not frappe.db.exists("DocType", "Nexus Identity Type"):
        return list(DEFAULT_IDENTITY_TYPES)

    identity_types = frappe.get_all(
        "Nexus Identity Type",
        filters={"enabled": 1},
        pluck="name",
        order_by="sort_order asc, identity_label asc",
    )

    return identity_types or list(DEFAULT_IDENTITY_TYPES)


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
    1. Explicit identity_type in payload (caller-declared, used for API integrations)
    2. Derived from frappe session user type and roles

    Returns a `Nexus Identity Type` document name.
    """
    explicit = payload.get("identity_type")
    if explicit:
        if is_valid_identity_type(explicit):
            return explicit

        frappe.throw(f"Identity Type '{explicit}' is not enabled or does not exist.")

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

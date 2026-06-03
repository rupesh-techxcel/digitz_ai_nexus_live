import frappe


IDENTITY_TYPES = ("Public", "Customer", "Prospect", "Partner", "Internal", "Admin")


def resolve_identity_type(payload):
    """
    Derive the visitor's identity type from request context.

    Priority:
    1. Explicit identity_type in payload (caller-declared, used for API integrations)
    2. Derived from frappe session user type and roles

    Returns one of: Public, Customer, Prospect, Partner, Internal, Admin
    """
    explicit = payload.get("identity_type")
    if explicit and explicit in IDENTITY_TYPES:
        return explicit

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

import frappe
from frappe.utils import now_datetime


@frappe.whitelist()
def get_challenges(status=None, email=None, limit=100):
    filters = {}
    if status and status != "All":
        filters["status"] = status
    if email:
        filters["email"] = ["like", f"%{email.strip().lower()}%"]

    rows = frappe.get_all(
        "Nexus Identity Verification Challenge",
        filters=filters,
        fields=[
            "name",
            "challenge_token",
            "status",
            "verification_mode",
            "email",
            "channel",
            "chat_category",
            "expires_on",
            "attempts",
            "max_attempts",
            "verified_on",
            "identity_registry",
            "resolved_identity_type",
            "creation",
        ],
        order_by="creation desc",
        limit_page_length=int(limit or 100),
    )

    now = now_datetime()
    for row in rows:
        row["is_expired"] = bool(
            row.status == "Pending" and row.expires_on and row.expires_on < now
        )

    return {"challenges": rows}

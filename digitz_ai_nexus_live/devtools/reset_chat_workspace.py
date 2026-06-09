from __future__ import annotations

import frappe


CONFIRM_TOKEN = "RESET_NEXUS_CHAT_WORKSPACE"


RESET_GROUPS = [
    (
        "Live runtime and audit data",
        [
            "Nexus Agent Activity Log",
            "Nexus Agent Performance Snapshot",
            "Nexus Conversation Outcome",
            "Nexus Lead Capture",
            "Nexus Live Interaction Log",
            "Nexus Conversation Feedback",
            "Nexus Conversation Participant",
            "Nexus Live Message",
            "Nexus Live Escalation",
            "Nexus Live Conversation",
            "Nexus Identity Verification Challenge",
        ],
    ),
    (
        "Live chat configuration",
        [
            "Nexus Queue Assignment",
            "Nexus Agent Queue",
            "Nexus Escalation Rule",
            "Nexus Channel Routing Rule",
            "Nexus Website Widget",
            "Nexus Category Identity Route",
            "Nexus Chat Category",
            "Nexus Live Channel",
        ],
    ),
    (
        "Identity registry and profile routing",
        [
            "Nexus Registered Identity",
            "Nexus Identity Registry",
            "Nexus Identity Type",
            "Nexus AI Agent Profile Access Category",
            "Nexus User Profile Assignment",
            "Nexus AI Agent Profile",
            "Nexus AI Behaviour",
            "Nexus Live Agent",
        ],
    ),
    (
        "Knowledge and retrieval data",
        [
            "Nexus Knowledge Test Run",
            "Nexus Knowledge Test Case",
            "Nexus Knowledge Chunk",
            "Nexus Knowledge Unit",
            "Nexus Knowledge Source",
            "Nexus Query Log",
        ],
    ),
    (
        "Access and tenant setup",
        [
            "Nexus Access Category Policy",
            "Nexus Role Access Category",
            "Nexus Access Category",
            "Nexus Access Policy",
            "Nexus User Context",
            "Nexus Tenant Configuration",
            "Nexus Tenant",
        ],
    ),
]


def preview_reset() -> dict:
    return reset_chat_workspace(dry_run=True)


def reset_chat_workspace(dry_run: bool = True, confirm: str | None = None) -> dict:
    """Reset Nexus chat/knowledge setup data for local implementation testing.

    This function is intentionally not whitelisted. Run it through bench execute.
    It preserves DocTypes, Pages, Nexus Settings, and LLM Provider records.
    """

    if not dry_run and confirm != CONFIRM_TOKEN:
        frappe.throw(f"Pass confirm='{CONFIRM_TOKEN}' to execute the reset.")

    result = {
        "dry_run": bool(dry_run),
        "confirm_required": CONFIRM_TOKEN,
        "groups": [],
        "total_records": 0,
        "deleted_records": 0,
        "skipped_doctypes": [],
    }

    for group_label, doctypes in RESET_GROUPS:
        group_result = {"group": group_label, "doctypes": []}

        for doctype in doctypes:
            if not frappe.db.exists("DocType", doctype):
                result["skipped_doctypes"].append(doctype)
                continue

            if not frappe.db.table_exists(doctype):
                result["skipped_doctypes"].append(doctype)
                continue

            count = frappe.db.count(doctype)
            result["total_records"] += count
            row = {"doctype": doctype, "count": count}

            if not dry_run and count:
                deleted = _delete_all_records(doctype)
                row["deleted"] = deleted
                result["deleted_records"] += deleted

            group_result["doctypes"].append(row)

        result["groups"].append(group_result)

    if not dry_run:
        frappe.db.commit()

    return result


def _delete_all_records(doctype: str) -> int:
    meta = frappe.get_meta(doctype)
    count = frappe.db.count(doctype)

    if meta.istable:
        frappe.db.delete(doctype)
        return count

    for name in frappe.get_all(doctype, pluck="name", order_by="modified desc"):
        frappe.delete_doc(
            doctype,
            name,
            force=True,
            ignore_permissions=True,
            ignore_missing=True,
        )

    return count

import frappe


def execute():
    """Drop the Nexus AI Agent Profile Access Category DocType and its table.

    This DocType was a legacy linking table in the old knowledge access chain:
        Agent Profile → Access Category → Access Policy → Knowledge Chunk

    The chain is now resolved through:
        Identity Profile → identity_mappings → Knowledge Profile → Access Categories → Policies
    """
    doctype = "Nexus AI Agent Profile Access Category"

    # Remove DocType record (silently skip if already gone)
    if frappe.db.exists("DocType", doctype):
        frappe.delete_doc("DocType", doctype, force=True, ignore_permissions=True)

    # Drop the underlying database table
    table = "tabNexus AI Agent Profile Access Category"
    if frappe.db.table_exists(table):
        frappe.db.sql(f"DROP TABLE IF EXISTS `{table}`")  # nosec — table name is a constant

    frappe.db.commit()

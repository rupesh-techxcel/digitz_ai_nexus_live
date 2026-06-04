import frappe


def execute():
    old_page = "nexus-identity-registry"
    if frappe.db.exists("Page", old_page):
        frappe.delete_doc("Page", old_page, force=True, ignore_permissions=True)

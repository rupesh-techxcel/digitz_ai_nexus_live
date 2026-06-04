import frappe


PAGES = [
    ("nexus-category-profile-routes", "Nexus Category Profile Routes"),
    ("nexus-chat-category-manager", "Nexus Chat Category Manager"),
    ("nexus-chat-workflow-tester", "Nexus Chat Workflow Tester"),
    ("nexus-identity-registry-manager", "Nexus Identity Registry Manager"),
    ("nexus-identity-verification-monitor", "Nexus Identity Verification Monitor"),
    ("nexus-profile-access-allocation", "Nexus Profile Access Allocation"),
    ("nexus-user-profile-manager", "Nexus User Profile Manager"),
    ("nexus_live_console", "Nexus Live Console"),
    ("nexus_live_studio", "Nexus Live Studio"),
]


def execute():
    for page_name, title in PAGES:
        if frappe.db.exists("Page", page_name):
            continue

        page = frappe.get_doc({
            "doctype": "Page",
            "name": page_name,
            "page_name": page_name,
            "title": title,
            "module": "Digitz AI Nexus Live",
            "standard": "Yes",
            "system_page": 0,
            "roles": [{"role": "System Manager"}],
        })
        page.insert(ignore_permissions=True)

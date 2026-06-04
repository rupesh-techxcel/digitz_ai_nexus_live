import frappe


DEFAULT_IDENTITY_TYPES = [
    {
        "title": "Public",
        "description": "Unauthenticated visitor. No login, no session. Default for all anonymous access.",
        "sort_order": 10,
    },
    {
        "title": "Customer",
        "description": "Authenticated portal or website user. Has a customer/website account.",
        "sort_order": 20,
    },
    {
        "title": "Prospect",
        "description": "Pre-sales visitor. Not yet a customer but has expressed interest.",
        "sort_order": 30,
    },
    {
        "title": "Partner",
        "description": "External partner or reseller with API or portal access.",
        "sort_order": 40,
    },
    {
        "title": "Internal",
        "description": "Internal desk user — employee or staff with a Frappe desk account.",
        "sort_order": 50,
    },
    {
        "title": "Admin",
        "description": "System administrator with System Manager role.",
        "sort_order": 60,
    },
]


def after_install():
    seed_identity_types()


def seed_identity_types():
    for entry in DEFAULT_IDENTITY_TYPES:
        if frappe.db.exists("Nexus Identity Type", entry["title"]):
            continue

        doc = frappe.new_doc("Nexus Identity Type")
        doc.title = entry["title"]
        doc.description = entry["description"]
        doc.sort_order = entry["sort_order"]
        doc.enabled = 1
        doc.insert(ignore_permissions=True)

    frappe.db.commit()
    frappe.logger().info("Nexus Identity Types seeded.")

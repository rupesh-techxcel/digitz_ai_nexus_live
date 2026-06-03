import frappe
from frappe.model.document import Document


class NexusChatCategory(Document):

    def validate(self):
        self._warn_if_no_routes()

    def _warn_if_no_routes(self):
        if not self.name:
            return

        has_routes = frappe.db.exists(
            "Nexus Category Identity Route",
            {"chat_category": self.name, "enabled": 1},
        )

        if not has_routes:
            frappe.msgprint(
                f"No identity routes are configured for '{self.category_label}'. "
                "Visitors who select this category will receive an error until at least "
                "one route is added in the Category Profile Routes page.",
                title="No Routes Configured",
                indicator="orange",
            )

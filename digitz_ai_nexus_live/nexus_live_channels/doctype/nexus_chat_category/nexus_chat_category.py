import frappe
from frappe.model.document import Document


class NexusChatCategory(Document):

    def validate(self):
        self._validate_profile_has_access_category()

    def _validate_profile_has_access_category(self):
        if not self.ai_agent_profile:
            return

        has_access = frappe.db.exists(
            "Nexus AI Agent Profile Access Category",
            {"ai_agent_profile": self.ai_agent_profile, "enabled": 1},
        )

        if not has_access:
            frappe.msgprint(
                f"Warning: AI Agent Profile '{self.ai_agent_profile}' has no Access Category "
                "configured. Queries through this category will be denied until an access "
                "category is assigned to the profile.",
                title="Access Category Missing",
                indicator="orange",
            )

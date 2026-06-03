import frappe
from frappe.model.document import Document


class NexusCategoryIdentityRoute(Document):

    def validate(self):
        self._validate_category_belongs_to_channel()
        self._warn_if_profile_missing_access()

    def _validate_category_belongs_to_channel(self):
        if not self.chat_category or not self.channel:
            return

        cat_channel = frappe.db.get_value("Nexus Chat Category", self.chat_category, "channel")
        if cat_channel and cat_channel != self.channel:
            frappe.throw(
                f"Category '{self.chat_category}' belongs to channel '{cat_channel}', "
                f"not '{self.channel}'."
            )

    def _warn_if_profile_missing_access(self):
        if not self.ai_agent_profile:
            return

        has_access = frappe.db.exists(
            "Nexus AI Agent Profile Access Category",
            {"ai_agent_profile": self.ai_agent_profile, "enabled": 1},
        )
        if not has_access:
            frappe.msgprint(
                f"Profile '{self.ai_agent_profile}' has no Access Category configured. "
                "Queries through this route will be denied until access is assigned.",
                title="Access Category Missing",
                indicator="orange",
            )

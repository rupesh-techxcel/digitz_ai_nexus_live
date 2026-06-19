import frappe
from frappe.model.document import Document


class NexusCategoryIdentityRoute(Document):

    def validate(self):
        self._derive_channel_from_category()
        self._warn_if_profile_missing_access()

    def _derive_channel_from_category(self):
        if not self.chat_category:
            return

        cat_channel = frappe.db.get_value("Nexus Chat Category", self.chat_category, "channel")
        if not cat_channel:
            frappe.throw(
                f"Chat category '{self.chat_category}' is not linked to a channel."
            )
        self.channel = cat_channel

    def _warn_if_profile_missing_access(self):
        # No identity profiles = open to all visitors (valid — no warning needed).
        # The warning only fires when profiles ARE assigned but none have identity mappings,
        # which is caught by the route health check in nexus_live_config.
        pass

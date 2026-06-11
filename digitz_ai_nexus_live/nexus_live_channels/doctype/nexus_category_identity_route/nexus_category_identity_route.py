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
        if self.is_public_route:
            return

        if not self.identity_profiles:
            frappe.msgprint(
                "This route has no Identity Profiles configured. "
                "Registered visitors will not be matched to this route until "
                "at least one Identity Profile is assigned.",
                title="Identity Profile Missing",
                indicator="orange",
            )

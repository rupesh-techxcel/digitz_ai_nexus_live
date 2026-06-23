import frappe
from frappe.model.document import Document


class NexusChatCategory(Document):

    def validate(self):
        self._warn_if_multiple_identity_gates()
        self._warn_if_no_routes()
        self._validate_nexy_requirements()

    def _warn_if_multiple_identity_gates(self):
        if self.visibility == "Internal" and self.identity_verification_mode not in (None, "", "None"):
            frappe.msgprint(
                "This category is set to Internal only. Email OTP verification is designed "
                "for external/public visitors and has no effect for internal users.",
                title="Verification Mode Has No Effect",
                indicator="orange",
            )

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

    def _validate_nexy_requirements(self):
        if not self.use_for_nexy:
            return

        settings = frappe.get_single("Nexus Settings")

        if settings.nexy_email_verification_mandatory:
            if not self.identity_verification_mode or self.identity_verification_mode == "None":
                frappe.msgprint(
                    f"'{self.category_label}' is marked 'Use for Nexy', but has no identity "
                    "verification mode set. Nexus Settings requires email verification for all "
                    "Nexy categories. Set Identity Verification Mode to 'Email OTP' or "
                    "'Registered Email OTP'.",
                    title="Nexy: Verification Required",
                    indicator="red",
                )

        if self.name:
            has_published_route = frappe.db.exists(
                "Nexus Category Identity Route",
                {"chat_category": self.name, "enabled": 1, "published": 1},
            )
            if not has_published_route:
                frappe.msgprint(
                    f"'{self.category_label}' is marked 'Use for Nexy' but has no published "
                    "routing. Nexy handover will fail until at least one route is enabled and "
                    "published in the Category Profile Routes page.",
                    title="Nexy: No Published Route",
                    indicator="orange",
                )

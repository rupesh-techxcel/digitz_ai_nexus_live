import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class NexusIdentityRegistry(Document):

    def validate(self):
        self._normalize_email()
        self._set_verified_on()
        self._validate_unique_active_keys()
        self._validate_identity_rows()
        self._validate_safe_guard_rows()

    def _normalize_email(self):
        if self.email:
            self.email = self.email.strip().lower()

    def _set_verified_on(self):
        if self.verification_status == "Verified" and not self.verified_on:
            self.verified_on = now_datetime()

    def _validate_unique_active_keys(self):
        if not self.enabled:
            return

        if self.email:
            existing = frappe.db.get_value(
                "Nexus Identity Registry",
                {
                    "email": self.email,
                    "enabled": 1,
                    "name": ["!=", self.name or ""],
                },
                "name",
            )
            if existing:
                frappe.throw(
                    f"An active identity registry already exists for email '{self.email}' ({existing}).",
                    title="Duplicate Identity Registry",
                )

        if self.user:
            existing = frappe.db.get_value(
                "Nexus Identity Registry",
                {
                    "user": self.user,
                    "enabled": 1,
                    "name": ["!=", self.name or ""],
                },
                "name",
            )
            if existing:
                frappe.throw(
                    f"An active identity registry already exists for user '{self.user}' ({existing}).",
                    title="Duplicate Identity Registry",
                )

    def _validate_identity_rows(self):
        seen = set()
        primary_count = 0

        for row in self.identities or []:
            if not row.identity_type:
                continue

            if row.identity_type in seen:
                frappe.throw(
                    f"Identity Type '{row.identity_type}' is duplicated in the identity rows.",
                    title="Duplicate Identity Type",
                )
            seen.add(row.identity_type)

            if row.enabled and row.is_primary:
                primary_count += 1

        if primary_count > 1:
            frappe.throw(
                "Only one enabled identity row can be marked as primary.",
                title="Multiple Primary Identities",
            )

    def _validate_safe_guard_rows(self):
        seen = set()

        for row in self.safe_guard_access_categories or []:
            if not row.access_category:
                continue

            if row.access_category in seen:
                frappe.throw(
                    f"Access Category '{row.access_category}' is duplicated in Safe Guard.",
                    title="Duplicate Safe Guard Access Category",
                )
            seen.add(row.access_category)

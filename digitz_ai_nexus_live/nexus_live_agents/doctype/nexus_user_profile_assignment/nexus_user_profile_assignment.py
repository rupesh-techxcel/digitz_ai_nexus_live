import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class NexusUserProfileAssignment(Document):

    def before_insert(self):
        self.assigned_by = frappe.session.user
        self.assigned_on = now_datetime()

    def validate(self):
        self._enforce_single_active_assignment()
        self._validate_knowledge_profile_has_access_category()

    def _enforce_single_active_assignment(self):
        if not self.active:
            return

        existing = frappe.db.get_value(
            "Nexus User Profile Assignment",
            {
                "user": self.user,
                "active": 1,
                "name": ["!=", self.name or ""],
            },
            "name",
        )

        if existing:
            frappe.throw(
                f"User '{self.user}' already has an active profile assignment ({existing}). "
                "Deactivate the existing assignment before creating a new one.",
                title="Duplicate Active Assignment",
            )

    def _validate_knowledge_profile_has_access_category(self):
        if not self.knowledge_profile:
            return

        kp = frappe.get_doc("Knowledge Profile", self.knowledge_profile)
        has_access = any(row.enabled for row in (kp.access_categories or []))

        if not has_access:
            frappe.msgprint(
                f"Warning: Knowledge Profile '{self.knowledge_profile}' has no enabled "
                "Access Category. This user's queries will be denied until the profile "
                "has at least one access category assigned.",
                title="Access Category Missing",
                indicator="orange",
            )

import frappe
from frappe.tests.utils import FrappeTestCase

from digitz_ai_nexus_live.services.agent_router import (
    find_available_agent,
    detect_required_role,
    normalize_role,
)


class TestLiveAgentRouting(FrappeTestCase):
    def setUp(self):
        self.agent_name = None

        self.cleanup_test_records()
        self.create_test_agent()

    def tearDown(self):
        self.cleanup_test_records()

    def cleanup_test_records(self):
        test_agent_code = "TEST-ROUTER-PUBLIC-AI"

        for doctype in [
            "Nexus Agent Activity Log",
            "Nexus AI Agent Profile",
        ]:
            for name in frappe.get_all(doctype, pluck="name"):
                doc = frappe.get_doc(doctype, name)

                if getattr(doc, "agent", None) == test_agent_code:
                    frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

        if frappe.db.exists("Nexus Live Agent", test_agent_code):
            frappe.delete_doc("Nexus Live Agent", test_agent_code, force=True, ignore_permissions=True)

        frappe.db.commit()

    def create_test_agent(self):
        agent = frappe.new_doc("Nexus Live Agent")
        agent.agent_code = "TEST-ROUTER-PUBLIC-AI"
        agent.agent_name = "Test Router Public AI"
        agent.display_name = "Test Router AI"
        agent.agent_type = "AI"
        agent.agent_role = "Public Responder"
        agent.status = "Idle"
        agent.enabled = 1
        agent.visibility = "Public"
        agent.priority = 1
        agent.max_active_sessions = 2
        agent.current_active_sessions = 0
        agent.insert(ignore_permissions=True)

        self.agent_name = agent.name

    def find_test_agent(self):
        return find_available_agent({
            "agent_role": "public",
            "visibility": "Public",
            "agent_code": self.agent_name,
        })

    def test_normalize_role_public(self):
        self.assertEqual(normalize_role("public"), "Public Responder")
        self.assertEqual(normalize_role("q and a"), "Public Responder")

    def test_detect_required_role_sales(self):
        role = detect_required_role({
            "query": "Can I get pricing and demo details?"
        })

        self.assertEqual(role, "Sales")

    def test_detect_required_role_support(self):
        role = detect_required_role({
            "query": "I have an error and need support"
        })

        self.assertEqual(role, "Support")

    def test_public_agent_is_selected(self):
        agent = self.find_test_agent()

        self.assertIsNotNone(agent)
        self.assertEqual(agent.name, self.agent_name)

    def test_disabled_agent_is_not_selected(self):
        frappe.db.set_value("Nexus Live Agent", self.agent_name, "enabled", 0)
        frappe.db.commit()

        agent = self.find_test_agent()

        self.assertIsNone(agent)

    def test_non_idle_agent_is_not_selected(self):
        frappe.db.set_value("Nexus Live Agent", self.agent_name, "status", "Responding")
        frappe.db.commit()

        agent = self.find_test_agent()

        self.assertIsNone(agent)

    def test_max_active_sessions_blocks_agent(self):
        frappe.db.set_value("Nexus Live Agent", self.agent_name, "max_active_sessions", 1)
        frappe.db.set_value("Nexus Live Agent", self.agent_name, "current_active_sessions", 1)
        frappe.db.commit()

        agent = self.find_test_agent()

        self.assertIsNone(agent)
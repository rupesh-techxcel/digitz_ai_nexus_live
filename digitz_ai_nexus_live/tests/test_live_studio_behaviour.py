import frappe
from frappe.tests.utils import FrappeTestCase

from digitz_ai_nexus_live.api.live_studio import (
    get_live_studio_snapshot,
    get_behaviour_options,
    assign_behaviour_to_agent,
)


class TestNexusLiveStudioBehaviour(FrappeTestCase):

    def setUp(self):
        self.cleanup_test_records()

        self.behaviour = self.create_behaviour()
        self.ai_agent = self.create_agent(
            agent_code="TEST-LIVE-AI-001",
            agent_type="AI",
            agent_role="Sales",
        )
        self.human_agent = self.create_agent(
            agent_code="TEST-LIVE-HUMAN-001",
            agent_type="Human",
            agent_role="Support",
        )

        self.create_onboarding(self.ai_agent.name)
        self.create_onboarding(self.human_agent.name)

    def tearDown(self):
        self.cleanup_test_records()

    def cleanup_test_records(self):
        test_agent_names = frappe.get_all(
            "Nexus Live Agent",
            filters={
                "agent_code": ["like", "TEST-LIVE-%"]
            },
            pluck="name",
        )

        test_behaviour_names = frappe.get_all(
            "Nexus AI Behaviour",
            filters={
                "behaviour_code": ["like", "TEST-%"]
            },
            pluck="name",
        )

        if frappe.db.exists("DocType", "Nexus Agent Onboarding") and test_agent_names:
            onboarding_names = frappe.get_all(
                "Nexus Agent Onboarding",
                filters={
                    "agent": ["in", test_agent_names]
                },
                pluck="name",
            )

            for name in onboarding_names:
                frappe.delete_doc(
                    "Nexus Agent Onboarding",
                    name,
                    force=True,
                    ignore_permissions=True,
                )

        for name in test_agent_names:
            frappe.delete_doc(
                "Nexus Live Agent",
                name,
                force=True,
                ignore_permissions=True,
            )

        for name in test_behaviour_names:
            frappe.delete_doc(
                "Nexus AI Behaviour",
                name,
                force=True,
                ignore_permissions=True,
            )

        frappe.db.commit()
    
    def create_behaviour(self):
        doc = frappe.new_doc("Nexus AI Behaviour")
        doc.behaviour_code = "TEST-SALES-BEHAVIOUR"
        doc.behaviour_name = "TEST Sales Behaviour"
        doc.designation = "Sales"
        doc.enabled = 1
        doc.behavior_prompt = "You are a test sales AI behaviour."
        doc.tone = "Consultative"
        doc.response_style = "Balanced"
        doc.memory_mode = "Session"
        doc.confidence_threshold = 0.65
        doc.escalation_enabled = 1
        doc.fallback_message = "I do not have enough approved knowledge to answer this."
        doc.insert(ignore_permissions=True)
        return doc

    def create_agent(self, agent_code, agent_type, agent_role):
        doc = frappe.new_doc("Nexus Live Agent")
        doc.agent_code = agent_code
        doc.agent_name = agent_code
        doc.display_name = agent_code
        doc.agent_type = agent_type
        doc.agent_role = agent_role
        doc.status = "Idle"
        doc.enabled = 1
        doc.visibility = "Public"
        doc.priority = 10
        doc.max_active_sessions = 5
        doc.current_active_sessions = 0
        doc.insert(ignore_permissions=True)
        return doc

    def create_onboarding(self, agent_name):
        existing = frappe.db.get_value(
            "Nexus Agent Onboarding",
            {
                "agent": agent_name,
            },
            "name",
        )

        if existing:
            return frappe.get_doc("Nexus Agent Onboarding", existing)

        doc = frappe.new_doc("Nexus Agent Onboarding")
        doc.agent = agent_name
        doc.onboarding_status = "Draft"

        if frappe.get_meta("Nexus Agent Onboarding").has_field("identity_completed"):
            doc.identity_completed = 1

        doc.insert(ignore_permissions=True)
        return doc

    def test_behaviour_appears_in_studio_snapshot(self):
        snapshot = get_live_studio_snapshot()

        self.assertIn("overview", snapshot)
        self.assertIn("behaviours", snapshot)

        behaviour_names = [
            row.get("behaviour_name")
            for row in snapshot.get("behaviours", [])
        ]

        self.assertIn("TEST Sales Behaviour", behaviour_names)
        self.assertGreaterEqual(snapshot["overview"].get("behaviours", 0), 1)

    def test_behaviour_options_returns_enabled_behaviours(self):
        options = get_behaviour_options()

        option_names = [
            row.get("behaviour_name")
            for row in options
        ]

        self.assertIn("TEST Sales Behaviour", option_names)

    def test_assign_behaviour_to_ai_agent_succeeds(self):
        result = assign_behaviour_to_agent(
            agent=self.ai_agent.name,
            behaviour=self.behaviour.name,
        )

        self.assertEqual(result.get("status"), "success")

        assigned_behaviour = frappe.db.get_value(
            "Nexus Live Agent",
            self.ai_agent.name,
            "behaviour",
        )

        self.assertEqual(assigned_behaviour, self.behaviour.name)

    def test_assigned_behaviour_appears_in_workforce_snapshot(self):
        assign_behaviour_to_agent(
            agent=self.ai_agent.name,
            behaviour=self.behaviour.name,
        )

        snapshot = get_live_studio_snapshot()

        matching_agents = [
            row
            for row in snapshot.get("agents", [])
            if row.get("name") == self.ai_agent.name
        ]

        self.assertTrue(matching_agents)

        agent_row = matching_agents[0]

        self.assertEqual(agent_row.get("behaviour"), self.behaviour.name)
        self.assertEqual(agent_row.get("behaviour_name"), "TEST Sales Behaviour")
        self.assertEqual(agent_row.get("behaviour_designation"), "Sales")

    def test_assign_behaviour_to_human_agent_fails(self):
        with self.assertRaises(Exception):
            assign_behaviour_to_agent(
                agent=self.human_agent.name,
                behaviour=self.behaviour.name,
            )

    def test_onboarding_behaviour_completed_after_assignment(self):
        assign_behaviour_to_agent(
            agent=self.ai_agent.name,
            behaviour=self.behaviour.name,
        )

        onboarding_name = frappe.db.get_value(
            "Nexus Agent Onboarding",
            {
                "agent": self.ai_agent.name,
            },
            "name",
        )

        self.assertTrue(onboarding_name)

        onboarding = frappe.get_doc(
            "Nexus Agent Onboarding",
            onboarding_name,
        )

        meta = frappe.get_meta("Nexus Agent Onboarding")

        if meta.has_field("behavior_completed"):
            self.assertEqual(onboarding.behavior_completed, 1)

        if meta.has_field("behaviour_completed"):
            self.assertEqual(onboarding.behaviour_completed, 1)
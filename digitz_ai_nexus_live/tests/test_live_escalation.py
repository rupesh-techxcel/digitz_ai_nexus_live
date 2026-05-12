import frappe
from frappe.tests.utils import FrappeTestCase

from digitz_ai_nexus_live.services.conversation_service import create_conversation
from digitz_ai_nexus_live.services.escalation_service import (
    should_escalate,
    create_escalation,
    resolve_escalation,
    reject_escalation,
)


class TestLiveEscalation(FrappeTestCase):
    def setUp(self):
        self.agent_name = None
        self.queue_name = None
        self.rule_name = None

        self.cleanup_test_records()
        self.create_test_agent()
        self.create_test_queue()
        self.create_test_escalation_rule()

    def tearDown(self):
        self.cleanup_test_records()

    def cleanup_test_records(self):
        test_agent_code = "TEST-ESCALATION-AI"
        test_queue_code = "TEST-ESCALATION-QUEUE"

        for doctype in [
            "Nexus Live Escalation",
            "Nexus Live Message",
            "Nexus Conversation Participant",
            "Nexus Conversation Feedback",
            "Nexus Live Conversation",
            "Nexus Queue Assignment",
            "Nexus Escalation Rule",
            "Nexus Agent Activity Log",
        ]:
            for name in frappe.get_all(doctype, pluck="name"):
                doc = frappe.get_doc(doctype, name)

                if (
                    getattr(doc, "from_agent", None) == test_agent_code
                    or getattr(doc, "to_agent", None) == test_agent_code
                    or getattr(doc, "assigned_agent", None) == test_agent_code
                    or getattr(doc, "agent", None) == test_agent_code
                    or getattr(doc, "target_queue", None) == test_queue_code
                    or getattr(doc, "to_queue", None) == test_queue_code
                    or str(getattr(doc, "conversation_id", "")).startswith("TEST-ESC")
                ):
                    frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

        if frappe.db.exists("Nexus Live Agent", test_agent_code):
            frappe.delete_doc("Nexus Live Agent", test_agent_code, force=True, ignore_permissions=True)

        if frappe.db.exists("Nexus Agent Queue", test_queue_code):
            frappe.delete_doc("Nexus Agent Queue", test_queue_code, force=True, ignore_permissions=True)

        frappe.db.commit()

    def create_test_agent(self):
        agent = frappe.new_doc("Nexus Live Agent")
        agent.agent_code = "TEST-ESCALATION-AI"
        agent.agent_name = "Test Escalation AI"
        agent.display_name = "Test Escalation AI"
        agent.agent_type = "AI"
        agent.agent_role = "Public Responder"
        agent.status = "Idle"
        agent.enabled = 1
        agent.visibility = "Public"
        agent.priority = 1
        agent.max_active_sessions = 5
        agent.current_active_sessions = 0
        agent.insert(ignore_permissions=True)

        self.agent_name = agent.name

    def create_test_queue(self):
        queue = frappe.new_doc("Nexus Agent Queue")
        queue.queue_code = "TEST-ESCALATION-QUEUE"
        queue.queue_name = "Test Escalation Queue"
        queue.queue_type = "Support"
        queue.enabled = 1
        queue.insert(ignore_permissions=True)

        self.queue_name = queue.name

    def create_test_escalation_rule(self):
        rule = frappe.new_doc("Nexus Escalation Rule")
        rule.rule_name = "Test Escalation Rule"
        rule.enabled = 1
        rule.agent_role = "Public Responder"
        rule.minimum_confidence = 0.65
        rule.escalate_on_no_knowledge = 1
        rule.escalate_on_human_request = 1
        rule.target_queue = self.queue_name
        rule.insert(ignore_permissions=True)

        self.rule_name = rule.name

    def create_test_conversation(self):
        return create_conversation({
            "conversation_id": "TEST-ESC-CONV",
            "conversation_type": "Chat",
            "assigned_agent": self.agent_name,
            "user_type": "Guest",
        })

    def test_should_escalate_low_confidence(self):
        self.assertTrue(
            should_escalate(
                confidence=0.2,
                threshold=0.65,
            )
        )

    def test_should_not_escalate_high_confidence(self):
        self.assertFalse(
            should_escalate(
                confidence=0.9,
                threshold=0.65,
            )
        )

    def test_should_escalate_no_knowledge(self):
        self.assertTrue(
            should_escalate(
                confidence=0.95,
                no_knowledge=True,
                threshold=0.65,
            )
        )

    def test_should_escalate_user_requested_human(self):
        self.assertTrue(
            should_escalate(
                confidence=0.95,
                user_requested_human=True,
                threshold=0.65,
            )
        )

    def test_should_escalate_repeated_fallback(self):
        self.assertTrue(
            should_escalate(
                confidence=0.95,
                repeated_fallback=True,
                threshold=0.65,
            )
        )

    def test_create_escalation_record(self):
        conversation = self.create_test_conversation()

        escalation = create_escalation(
            conversation=conversation,
            reason="Low Confidence",
            from_agent=self.agent_name,
            confidence=0.2,
            remarks="Unit test escalation",
        )

        self.assertTrue(escalation.name)
        self.assertEqual(escalation.escalation_reason, "Low Confidence")
        self.assertEqual(escalation.status, "Pending")
        self.assertEqual(escalation.from_agent, self.agent_name)
        self.assertEqual(escalation.to_queue, self.queue_name)

        conversation.reload()
        self.assertEqual(conversation.status, "Escalated")
        self.assertEqual(conversation.escalation_status, "Pending")

    def test_resolve_escalation(self):
        conversation = self.create_test_conversation()

        escalation = create_escalation(
            conversation=conversation,
            reason="Low Confidence",
            from_agent=self.agent_name,
            confidence=0.2,
            remarks="Unit test escalation",
        )

        resolved = resolve_escalation(
            escalation,
            remarks="Resolved by unit test",
        )

        self.assertEqual(resolved.status, "Resolved")
        self.assertEqual(resolved.remarks, "Resolved by unit test")
        self.assertTrue(resolved.resolved_on)

    def test_reject_escalation(self):
        conversation = self.create_test_conversation()

        escalation = create_escalation(
            conversation=conversation,
            reason="Low Confidence",
            from_agent=self.agent_name,
            confidence=0.2,
            remarks="Unit test escalation",
        )

        rejected = reject_escalation(
            escalation,
            remarks="Rejected by unit test",
        )

        self.assertEqual(rejected.status, "Rejected")
        self.assertEqual(rejected.remarks, "Rejected by unit test")
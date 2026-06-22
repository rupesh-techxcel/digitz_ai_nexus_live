from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from digitz_ai_nexus_live.services.live_qa_service import ask_live_question


class TestLiveQA(FrappeTestCase):
    def setUp(self):
        self.agent_name = None
        self.profile_name = None
        self.qa_channel_name = None
        self.escalation_rule_name = None
        self.queue_name = None

        self.cleanup_test_records()

        self.create_test_agent()
        self.create_test_channels()
        self.create_test_profile()
        self.create_test_escalation_rule()

    def tearDown(self):
        self.cleanup_test_records()

    def cleanup_test_records(self):
        test_agent_code = "TEST-LIVE-PUBLIC-AI"
        test_channels = ["TEST-WEBSITE-QA"]
        test_queue = "TEST-SUPPORT-QUEUE"

        for doctype in [
            "Nexus Live Escalation",
            "Nexus Live Message",
            "Nexus Conversation Participant",
            "Nexus Conversation Feedback",
            "Nexus Live Conversation",
            "Nexus Queue Assignment",
            "Nexus Escalation Rule",
            "Nexus Agent Activity Log",
            "Nexus AI Agent Profile",
        ]:
            for name in frappe.get_all(doctype, pluck="name"):
                doc = frappe.get_doc(doctype, name)

                if (
                    getattr(doc, "agent", None) == test_agent_code
                    or getattr(doc, "from_agent", None) == test_agent_code
                    or getattr(doc, "assigned_agent", None) == test_agent_code
                    or getattr(doc, "conversation_id", "").startswith("TEST-")
                    or getattr(doc, "channel", None) in test_channels
                    or getattr(doc, "target_queue", None) == test_queue
                    or getattr(doc, "to_queue", None) == test_queue
                ):
                    frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

        if frappe.db.exists("Nexus Live Agent", test_agent_code):
            frappe.delete_doc("Nexus Live Agent", test_agent_code, force=True, ignore_permissions=True)

        for channel in test_channels:
            if frappe.db.exists("Nexus Live Channel", channel):
                frappe.delete_doc("Nexus Live Channel", channel, force=True, ignore_permissions=True)

        if frappe.db.exists("Nexus Agent Queue", test_queue):
            frappe.delete_doc("Nexus Agent Queue", test_queue, force=True, ignore_permissions=True)

        frappe.db.commit()

    def create_test_agent(self):
        agent = frappe.new_doc("Nexus Live Agent")
        agent.agent_code = "TEST-LIVE-PUBLIC-AI"
        agent.agent_name = "Test Live Public AI"
        agent.display_name = "Test Public AI"
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

    def create_test_channels(self):
        qa_channel = frappe.new_doc("Nexus Live Channel")
        qa_channel.channel_code = "TEST-WEBSITE-QA"
        qa_channel.channel_name = "Test Website Q And A"
        qa_channel.channel_type = "Website Q&A"
        qa_channel.enabled = 1
        qa_channel.default_agent = self.agent_name
        qa_channel.agent_based = 0
        qa_channel.insert(ignore_permissions=True)

        self.qa_channel_name = qa_channel.name

    def create_test_profile(self):
        profile = frappe.new_doc("Nexus AI Agent Profile")
        profile.agent = self.agent_name
        profile.behavior_prompt = "You are a public test AI responder."
        profile.tone = "Professional"
        profile.response_style = "Balanced"
        profile.fallback_message = "I do not have enough approved knowledge to answer this."
        profile.default_response_mode = "chat"
        profile.knowledge_scope = "Public Only"
        profile.confidence_threshold = 0.65
        profile.escalation_enabled = 1
        profile.memory_mode = "Session"
        profile.insert(ignore_permissions=True)

        self.profile_name = profile.name

    def create_test_escalation_rule(self):
        queue = frappe.new_doc("Nexus Agent Queue")
        queue.queue_code = "TEST-SUPPORT-QUEUE"
        queue.queue_name = "Test Support Queue"
        queue.queue_type = "Support"
        queue.enabled = 1
        queue.insert(ignore_permissions=True)

        self.queue_name = queue.name

        rule = frappe.new_doc("Nexus Escalation Rule")
        rule.rule_name = "Test Public Responder Escalation"
        rule.enabled = 1
        rule.agent_role = "Public Responder"
        rule.minimum_confidence = 0.65
        rule.escalate_on_no_knowledge = 1
        rule.escalate_on_human_request = 1
        rule.target_queue = self.queue_name
        rule.insert(ignore_permissions=True)

        self.escalation_rule_name = rule.name

    def reset_agent(self):
        frappe.db.set_value("Nexus Live Agent", self.agent_name, "status", "Idle")
        frappe.db.set_value("Nexus Live Agent", self.agent_name, "current_active_sessions", 0)
        frappe.db.commit()

    @patch("digitz_ai_nexus_live.services.live_qa_service.answer_query")
    def test_autonomous_qa_success_without_agent_assignment(self, mock_answer_query):
        mock_answer_query.return_value = {
            "answer": "DIGITZ AI Nexus is a governed AI knowledge platform.",
            "confidence": 0.9,
            "sources": [],
            "retrieval_debug": {},
        }

        result = ask_live_question({
            "query": "What is DIGITZ AI Nexus?",
            "channel": self.qa_channel_name,
            "agent_role": "public",
            "tenant": "DIGITZ",
            "business_unit": "Product",
            "roles": ["Guest"],
        })

        self.assertEqual(result["status"], "success")
        self.assertFalse(result["agent_based"])
        self.assertIsNone(result["agent"])
        self.assertIsNone(result["agent_code"])
        self.assertEqual(result["confidence"], 0.9)
        self.assertFalse(result["escalated"])

        conversation = frappe.get_doc("Nexus Live Conversation", result["conversation"])
        self.assertFalse(conversation.assigned_agent)

        agent = frappe.get_doc("Nexus Live Agent", self.agent_name)
        self.assertEqual(agent.current_active_sessions, 0)

    @patch("digitz_ai_nexus_live.services.live_qa_service.answer_query")
    def test_autonomous_qa_fallback_does_not_escalate(self, mock_answer_query):
        mock_answer_query.return_value = {
            "answer": "I do not have enough approved knowledge to answer this.",
            "confidence": 0.0,
            "sources": [],
            "retrieval_debug": {},
        }

        result = ask_live_question({
            "query": "Unknown autonomous question",
            "channel": self.qa_channel_name,
            "agent_role": "public",
            "tenant": "DIGITZ",
            "business_unit": "Product",
            "roles": ["Guest"],
        })

        self.assertEqual(result["status"], "success")
        self.assertFalse(result["agent_based"])
        self.assertFalse(result["escalated"])
        self.assertIsNone(result["escalation"])
        self.assertEqual(result["confidence"], 0.0)

    @patch("digitz_ai_nexus_live.services.live_qa_service.answer_query")
    def test_agent_based_qa_assigns_agent_when_channel_enabled(self, mock_answer_query):
        self.reset_agent()

        frappe.db.set_value(
            "Nexus Live Channel",
            self.qa_channel_name,
            "agent_based",
            1,
        )
        frappe.db.commit()

        mock_answer_query.return_value = {
            "answer": "Agent based Q And A response.",
            "confidence": 0.9,
            "sources": [],
            "retrieval_debug": {},
        }

        result = ask_live_question({
            "query": "What is DIGITZ AI Nexus?",
            "channel": self.qa_channel_name,
            "agent_role": "public",
            "tenant": "DIGITZ",
            "business_unit": "Product",
            "roles": ["Guest"],
        })

        self.assertEqual(result["status"], "success")
        self.assertTrue(result["agent_based"])
        self.assertEqual(result["agent"], self.agent_name)
        self.assertEqual(result["agent_code"], "TEST-LIVE-PUBLIC-AI")
        self.assertFalse(result["escalated"])

    @patch("digitz_ai_nexus_live.services.live_qa_service.answer_query")
    def test_agent_based_qa_fallback_escalates(self, mock_answer_query):
        self.reset_agent()

        frappe.db.set_value(
            "Nexus Live Channel",
            self.qa_channel_name,
            "agent_based",
            1,
        )
        frappe.db.commit()

        mock_answer_query.return_value = {
            "answer": "I do not have enough approved knowledge to answer this.",
            "confidence": 0.0,
            "sources": [],
            "retrieval_debug": {},
        }

        result = ask_live_question({
            "query": "Unknown agent based question",
            "channel": self.qa_channel_name,
            "agent_role": "public",
            "tenant": "DIGITZ",
            "business_unit": "Product",
            "roles": ["Guest"],
        })

        self.assertEqual(result["status"], "success")
        self.assertTrue(result["agent_based"])
        self.assertTrue(result["escalated"])
        self.assertIsNotNone(result["escalation"])

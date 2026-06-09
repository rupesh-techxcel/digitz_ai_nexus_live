from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from digitz_ai_nexus_live.services.live_chat_service import (
    start_live_chat,
    continue_live_chat,
)
from digitz_ai_nexus_live.services.conversation_service import (
    get_conversation,
    get_conversation_messages,
)


class TestLiveChat(FrappeTestCase):
    def setUp(self):
        self.agent_name = None
        self.profile_name = None
        self.chat_channel_name = None
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
        test_agent_code = "TEST-CHAT-PUBLIC-AI"
        test_channels = ["TEST-CHAT-CHANNEL", "TEST-QA-NON-AGENT-CHANNEL"]
        test_queue = "TEST-CHAT-SUPPORT-QUEUE"

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
        agent.agent_code = "TEST-CHAT-PUBLIC-AI"
        agent.agent_name = "Test Chat Public AI"
        agent.display_name = "Test Chat AI"
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
        chat_channel = frappe.new_doc("Nexus Live Channel")
        chat_channel.channel_code = "TEST-CHAT-CHANNEL"
        chat_channel.channel_name = "Test Chat Channel"
        chat_channel.channel_type = "Website Chat"
        chat_channel.enabled = 1
        chat_channel.default_agent = self.agent_name
        chat_channel.public_access = 1
        chat_channel.agent_based = 1
        chat_channel.insert(ignore_permissions=True)

        self.chat_channel_name = chat_channel.name

        qa_channel = frappe.new_doc("Nexus Live Channel")
        qa_channel.channel_code = "TEST-QA-NON-AGENT-CHANNEL"
        qa_channel.channel_name = "Test Non Agent Q And A Channel"
        qa_channel.channel_type = "Website Q&A"
        qa_channel.enabled = 1
        qa_channel.public_access = 1
        qa_channel.agent_based = 0
        qa_channel.insert(ignore_permissions=True)

        self.qa_channel_name = qa_channel.name

    def create_test_profile(self):
        profile = frappe.new_doc("Nexus AI Agent Profile")
        profile.agent = self.agent_name
        profile.behavior_prompt = "You are a public test chat AI responder."
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
        queue.queue_code = "TEST-CHAT-SUPPORT-QUEUE"
        queue.queue_name = "Test Chat Support Queue"
        queue.queue_type = "Support"
        queue.enabled = 1
        queue.insert(ignore_permissions=True)

        self.queue_name = queue.name

        rule = frappe.new_doc("Nexus Escalation Rule")
        rule.rule_name = "Test Chat Public Responder Escalation"
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

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _get_last_ai_message(self, conversation_id):
        """Return the last AI Agent message stored for the conversation.

        Because frappe.enqueue uses now=frappe.flags.in_test, the background
        job runs synchronously in tests so the message is already in DB by the
        time the service call returns.
        """
        conversation = get_conversation(conversation_id)
        messages = get_conversation_messages(conversation, limit=100)
        for m in reversed(messages):
            if m.sender_type == "AI Agent":
                return m
        return None

    def _conversation_has_escalation(self, conversation_id):
        conversation = get_conversation(conversation_id)
        return bool(frappe.db.exists(
            "Nexus Live Escalation",
            {"conversation": conversation.name},
        ))

    # ── Tests ─────────────────────────────────────────────────────────────────

    @patch("digitz_ai_nexus_live.services.live_chat_service.answer_query")
    def test_start_live_chat_success(self, mock_answer_query):
        mock_answer_query.return_value = {
            "answer": "Hello, I am the DIGITZ public AI assistant.",
            "confidence": 0.9,
            "sources": [],
            "retrieval_debug": {},
        }

        result = start_live_chat({
            "message": "Hello",
            "channel": self.chat_channel_name,
            "agent_role": "public",
            "tenant": "DIGITZ",
            "business_unit": "Product",
            "roles": ["Guest"],
        })

        # Fast-return — conversation created, AI job enqueued (runs inline in tests)
        self.assertEqual(result["status"], "processing")
        self.assertEqual(result["agent"], self.agent_name)
        self.assertTrue(result["conversation_id"])

        # Background job ran inline — verify AI response is in DB
        ai_msg = self._get_last_ai_message(result["conversation_id"])
        self.assertIsNotNone(ai_msg)
        self.assertAlmostEqual(ai_msg.confidence, 0.9)
        self.assertFalse(self._conversation_has_escalation(result["conversation_id"]))

    @patch("digitz_ai_nexus_live.services.live_chat_service.answer_query")
    def test_continue_live_chat_success(self, mock_answer_query):
        mock_answer_query.return_value = {
            "answer": "First response.",
            "confidence": 0.9,
            "sources": [],
            "retrieval_debug": {},
        }

        start_result = start_live_chat({
            "message": "Hello",
            "channel": self.chat_channel_name,
            "agent_role": "public",
            "tenant": "DIGITZ",
            "business_unit": "Product",
            "roles": ["Guest"],
        })

        self.assertEqual(start_result["status"], "processing")

        mock_answer_query.return_value = {
            "answer": "Follow-up response.",
            "confidence": 0.88,
            "sources": [],
            "retrieval_debug": {},
        }

        result = continue_live_chat(
            conversation_id=start_result["conversation_id"],
            payload={
                "message": "Tell me more",
                "tenant": "DIGITZ",
                "business_unit": "Product",
                "roles": ["Guest"],
            },
        )

        self.assertEqual(result["status"], "processing")

        ai_msg = self._get_last_ai_message(result["conversation_id"])
        self.assertIsNotNone(ai_msg)
        self.assertAlmostEqual(ai_msg.confidence, 0.88)
        self.assertIn("Follow-up", ai_msg.message)

    @patch("digitz_ai_nexus_live.services.live_chat_service.answer_query")
    def test_live_chat_fallback_escalates(self, mock_answer_query):
        self.reset_agent()

        mock_answer_query.return_value = {
            "answer": "I do not have enough approved knowledge to answer this.",
            "confidence": 0.0,
            "sources": [],
            "retrieval_debug": {},
        }

        result = start_live_chat({
            "message": "Unknown question",
            "channel": self.chat_channel_name,
            "agent_role": "public",
            "tenant": "DIGITZ",
            "business_unit": "Product",
            "roles": ["Guest"],
        })

        self.assertEqual(result["status"], "processing")
        self.assertTrue(self._conversation_has_escalation(result["conversation_id"]))

    @patch("digitz_ai_nexus_live.services.live_chat_service.answer_query")
    def test_user_requested_human_escalates(self, mock_answer_query):
        self.reset_agent()

        mock_answer_query.return_value = {
            "answer": "I can connect you with a human agent.",
            "confidence": 0.95,
            "sources": [],
            "retrieval_debug": {},
        }

        result = start_live_chat({
            "message": "I want to talk to a human",
            "channel": self.chat_channel_name,
            "agent_role": "public",
            "tenant": "DIGITZ",
            "business_unit": "Product",
            "roles": ["Guest"],
            "user_requested_human": True,
        })

        self.assertEqual(result["status"], "processing")
        self.assertTrue(self._conversation_has_escalation(result["conversation_id"]))

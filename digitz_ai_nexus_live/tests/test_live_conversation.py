import frappe
from frappe.tests.utils import FrappeTestCase

from digitz_ai_nexus_live.services.conversation_service import (
    create_conversation,
    update_conversation_assignment,
    add_message,
    add_participant,
    set_conversation_status,
    close_conversation,
    get_conversation_messages,
)
from digitz_ai_nexus_live.services.conversation_service import (
    create_conversation,
    update_conversation_assignment,
    add_message,
    add_participant,
    set_conversation_status,
    close_conversation,
    get_conversation_messages,
)

class TestLiveConversation(FrappeTestCase):
    def setUp(self):
        self.agent_name = None
        self.cleanup_test_records()
        self.create_test_agent()

    def tearDown(self):
        self.cleanup_test_records()


    def cleanup_test_records(self):
        test_agent_code = "TEST-CONVERSATION-AI"

        test_conversations = frappe.get_all(
            "Nexus Live Conversation",
            filters={"conversation_id": ["like", "TEST-CONV%"]},
            pluck="name",
        )

        if test_conversations:
            for doctype in [
                "Nexus Live Message",
                "Nexus Conversation Participant",
                "Nexus Conversation Feedback",
            ]:
                for name in frappe.get_all(
                    doctype,
                    filters={"conversation": ["in", test_conversations]},
                    pluck="name",
                ):
                    frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

            for name in test_conversations:
                frappe.delete_doc("Nexus Live Conversation", name, force=True, ignore_permissions=True)

        for doctype in ["Nexus Agent Activity Log"]:
            for name in frappe.get_all(doctype, pluck="name"):
                doc = frappe.get_doc(doctype, name)

                if getattr(doc, "agent", None) == test_agent_code:
                    frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

        if frappe.db.exists("Nexus Live Agent", test_agent_code):
            frappe.delete_doc("Nexus Live Agent", test_agent_code, force=True, ignore_permissions=True)

        frappe.db.commit()

    def create_test_agent(self):
        agent = frappe.new_doc("Nexus Live Agent")
        agent.agent_code = "TEST-CONVERSATION-AI"
        agent.agent_name = "Test Conversation AI"
        agent.display_name = "Test Conversation AI"
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

    def test_create_conversation(self):
        conversation = create_conversation({
            "conversation_id": "TEST-CONV-001",
            "conversation_type": "Chat",
            "channel": None,
            "visitor_name": "Test Visitor",
            "user_type": "Guest",
        })

        self.assertTrue(conversation.name)
        self.assertEqual(conversation.conversation_id, "TEST-CONV-001")
        self.assertEqual(conversation.conversation_type, "Chat")
        self.assertEqual(conversation.status, "Open")
        self.assertEqual(conversation.visitor_name, "Test Visitor")

    def test_update_conversation_assignment(self):
        conversation = create_conversation({
            "conversation_id": "TEST-CONV-002",
            "conversation_type": "Chat",
            "user_type": "Guest",
        })

        agent = frappe.get_doc("Nexus Live Agent", self.agent_name)
        updated = update_conversation_assignment(conversation, agent)

        self.assertEqual(updated.assigned_agent, self.agent_name)
        self.assertEqual(updated.assigned_agent_type, "AI")
        self.assertEqual(updated.status, "Responding")

    def test_add_visitor_message(self):
        conversation = create_conversation({
            "conversation_id": "TEST-CONV-003",
            "conversation_type": "Chat",
            "user_type": "Guest",
        })

        msg = add_message(
            conversation=conversation,
            sender_type="Visitor",
            message="Hello",
            response_mode="chat",
        )

        self.assertTrue(msg.name)
        self.assertEqual(msg.sender_type, "Visitor")
        self.assertEqual(msg.message, "Hello")

        conversation.reload()
        self.assertEqual(conversation.last_message, "Hello")

    def test_add_ai_message(self):
        conversation = create_conversation({
            "conversation_id": "TEST-CONV-004",
            "conversation_type": "Chat",
            "user_type": "Guest",
        })

        msg = add_message(
            conversation=conversation,
            sender_type="AI Agent",
            sender_agent=self.agent_name,
            message="AI response",
            response_mode="chat",
            confidence=0.92,
            sources=[],
            retrieval_debug={},
        )

        self.assertTrue(msg.name)
        self.assertEqual(msg.sender_type, "AI Agent")
        self.assertEqual(msg.sender_agent, self.agent_name)
        self.assertEqual(msg.confidence, 0.92)

        conversation.reload()
        self.assertEqual(conversation.last_response, "AI response")
        self.assertEqual(conversation.confidence, 0.92)

    def test_add_participant(self):
        conversation = create_conversation({
            "conversation_id": "TEST-CONV-005",
            "conversation_type": "Chat",
            "user_type": "Guest",
        })

        participant = add_participant(
            conversation=conversation,
            participant_type="AI Agent",
            agent=self.agent_name,
        )

        self.assertTrue(participant.name)
        self.assertEqual(participant.conversation, conversation.name)
        self.assertEqual(participant.participant_type, "AI Agent")
        self.assertEqual(participant.agent, self.agent_name)
        self.assertEqual(participant.is_active, 1)

    def test_get_conversation_messages(self):
        conversation = create_conversation({
            "conversation_id": "TEST-CONV-006",
            "conversation_type": "Chat",
            "user_type": "Guest",
        })

        msg1 = add_message(
            conversation=conversation,
            sender_type="Visitor",
            message="First message",
            response_mode="chat",
        )

        msg2 = add_message(
            conversation=conversation,
            sender_type="AI Agent",
            sender_agent=self.agent_name,
            message="Second message",
            response_mode="chat",
            confidence=0.8,
            sources=[],
            retrieval_debug={},
        )

        messages = get_conversation_messages(conversation, limit=50)

        test_messages = [
            row for row in messages
            if row.name in (msg1.name, msg2.name)
        ]

        self.assertEqual(len(test_messages), 2)
        self.assertEqual(test_messages[0].message, "First message")
        self.assertEqual(test_messages[1].message, "Second message")

    def test_set_conversation_status(self):
        conversation = create_conversation({
            "conversation_id": "TEST-CONV-007",
            "conversation_type": "Chat",
            "user_type": "Guest",
        })

        updated = set_conversation_status(conversation, "Waiting")
        self.assertEqual(updated.status, "Waiting")

    def test_close_conversation(self):
        conversation = create_conversation({
            "conversation_id": "TEST-CONV-008",
            "conversation_type": "Chat",
            "user_type": "Guest",
        })

        closed = close_conversation(conversation)

        self.assertEqual(closed.status, "Closed")
        self.assertTrue(closed.closed_on)
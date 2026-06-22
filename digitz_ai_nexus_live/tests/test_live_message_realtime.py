from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from digitz_ai_nexus_live.services.conversation_service import add_message, create_conversation


class TestLiveMessageRealtime(FrappeTestCase):
	conversation_id = "LIVE-MESSAGE-REALTIME-TEST"

	def setUp(self):
		frappe.db.delete("Nexus Live Message", {"conversation": self.conversation_id})
		frappe.db.delete("Nexus Live Conversation", {"conversation_id": self.conversation_id})

	def tearDown(self):
		frappe.db.delete("Nexus Live Message", {"conversation": self.conversation_id})
		frappe.db.delete("Nexus Live Conversation", {"conversation_id": self.conversation_id})

	def test_persisted_message_publishes_console_event(self):
		conversation = create_conversation({
			"conversation_id": self.conversation_id,
			"conversation_type": "Chat",
			"user_type": "Guest",
		})

		with patch("frappe.publish_realtime") as publish:
			message = add_message(
				conversation=conversation,
				sender_type="Visitor",
				message="A newly arrived message",
				response_mode="chat",
			)

		message_calls = [
			call for call in publish.call_args_list
			if call.kwargs.get("event") == "nexus_live_message"
		]
		self.assertEqual(len(message_calls), 1)
		kwargs = message_calls[0].kwargs
		self.assertEqual(kwargs["event"], "nexus_live_message")
		self.assertEqual(kwargs["task_id"], self.conversation_id)
		self.assertTrue(kwargs["after_commit"])
		self.assertEqual(kwargs["message"]["name"], message.name)
		self.assertEqual(kwargs["message"]["sender_type"], "Visitor")

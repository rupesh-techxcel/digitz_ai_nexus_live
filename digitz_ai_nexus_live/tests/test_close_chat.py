from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from digitz_ai_nexus_live.api.live import close_chat, start_chat
from digitz_ai_nexus_live.services.conversation_service import create_conversation


class TestCloseChat(FrappeTestCase):
	conversation_id = "VISITOR-CLOSE-TEST"

	def setUp(self):
		frappe.db.delete("Nexus Live Message", {"conversation": self.conversation_id})
		frappe.db.delete("Nexus Live Conversation", {"conversation_id": self.conversation_id})

	def tearDown(self):
		frappe.db.delete("Nexus Live Message", {"conversation": self.conversation_id})
		frappe.db.delete("Nexus Live Conversation", {"conversation_id": self.conversation_id})

	def _conversation(self):
		return create_conversation({
			"conversation_id": self.conversation_id,
			"conversation_type": "Chat",
			"user_type": "Guest",
		})

	def test_guest_requires_matching_caller_token(self):
		conversation = self._conversation()

		with self.assertRaises(frappe.PermissionError):
			close_chat(self.conversation_id, caller_token="wrong-token")

		conversation.reload()
		self.assertEqual(conversation.status, "Open")

	def test_start_returns_token_for_guest_mode_in_authenticated_session(self):
		conversation = self._conversation()
		with patch(
			"digitz_ai_nexus_live.api.live.start_live_chat",
			return_value={"conversation_id": conversation.conversation_id},
		):
			result = start_chat({})

		self.assertEqual(result["caller_token"], conversation.caller_token)

	def test_guest_can_close_own_conversation(self):
		conversation = self._conversation()

		result = close_chat(self.conversation_id, caller_token=conversation.caller_token)

		conversation.reload()
		self.assertEqual(result["status"], "closed")
		self.assertEqual(conversation.status, "Closed")
		self.assertTrue(conversation.closed_on)

		# Closing is idempotent; a delayed duplicate request needs no token.
		repeated = close_chat(self.conversation_id)
		self.assertEqual(repeated["status"], "closed")

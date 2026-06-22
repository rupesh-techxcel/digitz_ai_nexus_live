import frappe
from frappe.tests.utils import FrappeTestCase

from digitz_ai_nexus_live.services.conversation_service import create_conversation
from digitz_ai_nexus_live.services.visitor_data_capture import _capture_key, capture_visitor_data


class TestVisitorDataCapture(FrappeTestCase):
	def setUp(self):
		frappe.db.delete(
			"Nexus Visitor Data Capture",
			{"normalized_email": "analytics-test@example.com"},
		)
		frappe.db.delete("Nexus Live Conversation", {"conversation_id": "ANALYTICS-CHAT-TEST"})

	def tearDown(self):
		frappe.db.delete(
			"Nexus Visitor Data Capture",
			{"normalized_email": "analytics-test@example.com"},
		)
		frappe.db.delete("Nexus Live Conversation", {"conversation_id": "ANALYTICS-CHAT-TEST"})

	def test_capture_is_idempotent_for_same_email_and_context(self):
		first = capture_visitor_data(
			email=" Analytics-Test@Example.com ",
			visitor_name="First Name",
			collection_context="Knowledge Gap Follow-up",
			collection_reason="Initial follow-up request",
			consent_status="Explicitly Provided",
			consent_scope="Knowledge availability notification",
		)
		second = capture_visitor_data(
			email="analytics-test@example.com",
			visitor_name="Updated Name",
			collection_context="Knowledge Gap Follow-up",
			collection_reason="Updated follow-up request",
			consent_status="Explicitly Provided",
			consent_scope="Knowledge availability notification",
		)

		self.assertEqual(first, second)
		doc = frappe.get_doc("Nexus Visitor Data Capture", first)
		self.assertEqual(doc.email, "analytics-test@example.com")
		self.assertEqual(doc.visitor_name, "Updated Name")
		self.assertEqual(doc.collection_reason, "Updated follow-up request")

	def test_different_collection_purposes_are_separate_events(self):
		verification = capture_visitor_data(
			email="analytics-test@example.com",
			collection_context="Identity Verification",
			collection_reason="Verify selected category access",
			email_verified=True,
			consent_status="Service Requested",
		)
		followup = capture_visitor_data(
			email="analytics-test@example.com",
			collection_context="Knowledge Gap Follow-up",
			collection_reason="Notify visitor when knowledge is ready",
			email_verified=True,
			consent_status="Explicitly Provided",
		)

		self.assertNotEqual(verification, followup)

	def test_reference_is_part_of_capture_identity(self):
		first = _capture_key(
			"analytics-test@example.com",
			"Knowledge Gap Follow-up",
			conversation="CHAT-1",
			reference_name="GAP-1",
		)
		second = _capture_key(
			"analytics-test@example.com",
			"Knowledge Gap Follow-up",
			conversation="CHAT-1",
			reference_name="GAP-2",
		)

		self.assertNotEqual(first, second)

	def test_conversation_creation_feeds_data_analytics(self):
		conversation = create_conversation({
			"conversation_id": "ANALYTICS-CHAT-TEST",
			"conversation_type": "Chat",
			"visitor_name": "Analytics Visitor",
			"visitor_email": "analytics-test@example.com",
			"user_type": "Guest",
		})

		capture = frappe.get_doc(
			"Nexus Visitor Data Capture",
			{"conversation": conversation.name, "collection_context": "Chat Start"},
		)
		self.assertEqual(capture.visitor_name, "Analytics Visitor")
		self.assertEqual(capture.consent_scope, "Live chat service and conversation continuity")

import unittest
from unittest.mock import patch

import frappe

from digitz_ai_nexus.api.nexus_administration import (
    create_tenant_onboarding,
    save_ecosystem_configuration,
)
from digitz_ai_nexus.services.tenant_context import set_user_context
from digitz_ai_nexus_live.services.live_qa_service import ask_live_question
from digitz_ai_nexus_live.services.live_chat_service import start_live_chat


TEST_TENANT = "TEST-NEXUS"
TEST_TENANT_NAME = "Test Nexus Tenant"
TEST_BU = "Nexus Synthetic BU"

QA_CHANNEL = "SYN-WEBSITE-QA"
CHAT_CHANNEL = "SYN-WEBSITE-CHAT"
PUBLIC_AGENT = "SYN-LIVE-PUBLIC-AI"

PUBLIC_CONTEXT = "Nexus Live"
SUB_CONTEXT = "Operational Validation"
ENTITY_TYPE = "Live Scenario"
ENTITY = "Nexus Live Synthetic Validation"
TOPIC = "Live Interaction"


class TestLiveTenantContextRuntime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_user = frappe.session.user

    @classmethod
    def tearDownClass(cls):
        frappe.set_user(cls.original_user or "Administrator")

    def setUp(self):
        frappe.set_user("Administrator")
        self.prepare_test_tenant_and_ecosystem()
        self.reset_synthetic_live_agents()

    def tearDown(self):
        self.reset_synthetic_live_agents()
        frappe.set_user(self.original_user or "Administrator")

    # -------------------------------------------------------------------------
    # Preparation Helpers
    # -------------------------------------------------------------------------

    def prepare_test_tenant_and_ecosystem(self):
        """
        Prepare tenant context and ecosystem defaults used by tenant-aware
        Live runtime tests.

        These tests intentionally use the existing synthetic validation tenant
        and synthetic Live agents/channels.
        """
        create_tenant_onboarding(
            tenant_name=TEST_TENANT_NAME,
            tenant_code=TEST_TENANT,
            business_unit_name=TEST_BU,
        )
        self.ensure_synthetic_live_agent()
        self.ensure_synthetic_live_channels()

        save_ecosystem_configuration({
            "tenant": TEST_TENANT,
            "enabled": 1,
            "activation_status": "Configured",

            "default_business_unit": TEST_BU,

            "require_approved_knowledge": 1,
            "strict_tenant_mode": 1,
            "default_top_k": 5,

            "qa_enabled": 1,
            "default_qa_channel": QA_CHANNEL,
            "qa_fallback_message": "I do not have enough approved knowledge to answer this.",
            "source_citation_required": 1,

            "live_chat_enabled": 1,
            "default_chat_channel": CHAT_CHANNEL,

            "website_widget_enabled": 1,
            "widget_title": "DIGITZ AI Nexus",
            "widget_welcome_message": "Hello, how can I help you?",
            "widget_brand_color": "#214dbb",

            "testing_required_before_activation": 1,
            "certification_status": "Not Certified",
        })

        set_user_context(
            user="Administrator",
            tenant=TEST_TENANT,
            business_unit=TEST_BU,
            project=None,
            channel=CHAT_CHANNEL,
            is_default=1,
        )

        frappe.db.commit()

    def ensure_synthetic_live_agent(self):
        if not frappe.db.exists("DocType", "Nexus Live Agent"):
            self.skipTest("Nexus Live Agent DocType is not installed.")

        if frappe.db.exists("Nexus Live Agent", PUBLIC_AGENT):
            agent = frappe.get_doc("Nexus Live Agent", PUBLIC_AGENT)
        else:
            agent = frappe.new_doc("Nexus Live Agent")
            agent.agent_code = PUBLIC_AGENT

        agent.agent_name = "Synthetic Live Public AI"
        agent.display_name = "Synthetic Live AI"
        agent.agent_type = "AI"
        agent.agent_role = "Public Responder"
        agent.status = "Idle"
        agent.enabled = 1
        agent.visibility = "Public"
        agent.business_unit = TEST_BU
        agent.priority = 1
        agent.max_active_sessions = 5
        agent.current_active_sessions = 0
        agent.save(ignore_permissions=True)

    def ensure_synthetic_live_channels(self):
        if not frappe.db.exists("DocType", "Nexus Live Channel"):
            self.skipTest("Nexus Live Channel DocType is not installed.")

        if frappe.db.exists("Nexus Live Channel", CHAT_CHANNEL):
            chat_channel = frappe.get_doc("Nexus Live Channel", CHAT_CHANNEL)
        else:
            chat_channel = frappe.new_doc("Nexus Live Channel")
            chat_channel.channel_code = CHAT_CHANNEL

        chat_channel.channel_name = "Synthetic Website Chat"
        chat_channel.channel_type = "Website Chat"
        chat_channel.enabled = 1
        chat_channel.default_agent = PUBLIC_AGENT
        chat_channel.requires_visitor_email = 0
        chat_channel.agent_based = 1
        chat_channel.save(ignore_permissions=True)

        if frappe.db.exists("Nexus Live Channel", QA_CHANNEL):
            qa_channel = frappe.get_doc("Nexus Live Channel", QA_CHANNEL)
        else:
            qa_channel = frappe.new_doc("Nexus Live Channel")
            qa_channel.channel_code = QA_CHANNEL

        qa_channel.channel_name = "Synthetic Website Q&A"
        qa_channel.channel_type = "Website Q&A"
        qa_channel.enabled = 1
        qa_channel.requires_visitor_email = 0
        qa_channel.agent_based = 0
        qa_channel.save(ignore_permissions=True)

        frappe.db.set_value(
            "Nexus Live Agent",
            PUBLIC_AGENT,
            "default_channel",
            CHAT_CHANNEL,
            update_modified=False,
        )

    def reset_synthetic_live_agents(self):
        """
        Reset synthetic Live agents so tests are repeatable.
        This is scoped only to SYN-LIVE-% agents.
        """
        if not frappe.db.exists("DocType", "Nexus Live Agent"):
            return

        meta_fields = {
            df.fieldname
            for df in frappe.get_meta("Nexus Live Agent").fields
        }

        agents = frappe.get_all(
            "Nexus Live Agent",
            filters={
                "agent_code": ["like", "SYN-LIVE-%"],
            },
            fields=["name", "agent_code"],
            limit_page_length=500,
        )

        for agent in agents:
            values = {}

            if "enabled" in meta_fields:
                values["enabled"] = 1

            if "status" in meta_fields:
                values["status"] = "Idle"

            if "current_active_sessions" in meta_fields:
                values["current_active_sessions"] = 0

            if "visibility" in meta_fields:
                values["visibility"] = "Public"

            if "default_channel" in meta_fields:
                values["default_channel"] = CHAT_CHANNEL

            if "disabled" in meta_fields:
                values["disabled"] = 0

            if "approval_status" in meta_fields:
                values["approval_status"] = "Approved"

            if "onboarding_status" in meta_fields:
                values["onboarding_status"] = "Approved"

            if "availability_status" in meta_fields:
                values["availability_status"] = "Available"

            if "rejection_reason" in meta_fields:
                values["rejection_reason"] = None

            if values:
                frappe.db.set_value(
                    "Nexus Live Agent",
                    agent.name,
                    values,
                    update_modified=False,
                )

        frappe.db.commit()

    def fake_core_answer(self, captured_payloads):
        def _fake_answer_query(core_payload):
            captured_payloads.append(core_payload)

            return {
                "status": "success",
                "access_status": "allowed",
                "answer": "Tenant-aware runtime answer from Nexus Live.",
                "confidence": 0.91,
                "sources": [
                    {
                        "chunk": "TEST-CHUNK",
                        "score": 0.91,
                        "context_path": "Synthetic Runtime Test",
                    }
                ],
                "citations": [],
                "fallback_used": 0,
                "retrieval_debug": {
                    "runtime_test": True,
                },
            }

        return _fake_answer_query

    # -------------------------------------------------------------------------
    # Tests
    # -------------------------------------------------------------------------

    def test_live_qa_uses_user_context_when_tenant_not_passed(self):
        captured_payloads = []

        with patch(
            "digitz_ai_nexus_live.services.live_qa_service.answer_query",
            side_effect=self.fake_core_answer(captured_payloads),
        ):
            result = ask_live_question({
                "question": "What is Nexus Test Orbit?",
                "channel": QA_CHANNEL,
                "user": {
                    "roles": ["Guest"],
                },
            })

        self.assertEqual(result.get("status"), "success")
        self.assertEqual(result.get("tenant"), TEST_TENANT)
        self.assertEqual(result.get("business_unit"), TEST_BU)
        self.assertEqual(result.get("channel"), QA_CHANNEL)
        self.assertEqual(result.get("tenant_context_applied"), 1)

        self.assertTrue(captured_payloads)

        core_payload = captured_payloads[0]

        self.assertEqual(core_payload.get("tenant"), TEST_TENANT)
        self.assertEqual(core_payload.get("business_unit"), TEST_BU)
        self.assertEqual(core_payload.get("channel"), QA_CHANNEL)
        self.assertEqual(core_payload.get("response_mode"), "qa")

    def test_live_qa_uses_ecosystem_default_context_and_top_k(self):
        captured_payloads = []

        with patch(
            "digitz_ai_nexus_live.services.live_qa_service.answer_query",
            side_effect=self.fake_core_answer(captured_payloads),
        ):
            result = ask_live_question({
                "question": "Explain the default Nexus Live context.",
                "tenant": TEST_TENANT,
                "business_unit": TEST_BU,
                "channel": QA_CHANNEL,
                "user": {
                    "roles": ["Guest"],
                },
            })

        self.assertEqual(result.get("status"), "success")

        core_payload = captured_payloads[0]

        self.assertEqual(int(core_payload.get("top_k") or 0), 5)

    def test_live_chat_uses_user_context_and_ecosystem_default_agent(self):
        captured_payloads = []

        with patch(
            "digitz_ai_nexus_live.services.live_chat_service.answer_query",
            side_effect=self.fake_core_answer(captured_payloads),
        ):
            result = start_live_chat({
                "message": "Hi, what is Nexus Test Orbit?",
                "user": {
                    "roles": ["Guest"],
                },
            })

        # Fast-return: only conversation_id and status are returned directly
        self.assertEqual(result.get("status"), "processing")
        self.assertEqual(result.get("agent_code"), PUBLIC_AGENT)

        # Tenant/context correctness is verified via the payload captured in the background job
        self.assertTrue(captured_payloads)

        core_payload = captured_payloads[0]

        self.assertEqual(core_payload.get("tenant"), TEST_TENANT)
        self.assertEqual(core_payload.get("business_unit"), TEST_BU)
        self.assertEqual(core_payload.get("channel"), CHAT_CHANNEL)
        self.assertEqual(core_payload.get("agent_code"), PUBLIC_AGENT)
        self.assertEqual(core_payload.get("response_mode"), "chat")

    def test_live_chat_preserves_explicit_payload_values(self):
        captured_payloads = []

        explicit_payload = {
            "tenant": TEST_TENANT,
            "business_unit": TEST_BU,
            "channel": CHAT_CHANNEL,
            "context": PUBLIC_CONTEXT,
            "sub_context": SUB_CONTEXT,
            "entity_type": ENTITY_TYPE,
            "entity": ENTITY,
            "topic": TOPIC,
            "message": "I need support with a Nexus Live issue.",
            "user": {
                "roles": ["Guest"],
            },
        }

        with patch(
            "digitz_ai_nexus_live.services.live_chat_service.answer_query",
            side_effect=self.fake_core_answer(captured_payloads),
        ):
            result = start_live_chat(explicit_payload)

        self.assertEqual(result.get("status"), "processing")

        core_payload = captured_payloads[0]

        self.assertEqual(core_payload.get("tenant"), TEST_TENANT)
        self.assertEqual(core_payload.get("business_unit"), TEST_BU)
        self.assertEqual(core_payload.get("channel"), CHAT_CHANNEL)
        self.assertEqual(core_payload.get("context"), PUBLIC_CONTEXT)
        self.assertEqual(core_payload.get("sub_context"), SUB_CONTEXT)
        self.assertEqual(core_payload.get("entity_type"), ENTITY_TYPE)
        self.assertEqual(core_payload.get("entity"), ENTITY)
        self.assertEqual(core_payload.get("topic"), TOPIC)

    def test_live_chat_uses_ecosystem_default_channel_when_channel_not_passed(self):
        captured_payloads = []

        with patch(
            "digitz_ai_nexus_live.services.live_chat_service.answer_query",
            side_effect=self.fake_core_answer(captured_payloads),
        ):
            result = start_live_chat({
                "tenant": TEST_TENANT,
                "business_unit": TEST_BU,
                "message": "Hello from tenant runtime test.",
                "user": {
                    "roles": ["Guest"],
                },
            })

        self.assertEqual(result.get("status"), "processing")

        core_payload = captured_payloads[0]

        self.assertEqual(core_payload.get("channel"), CHAT_CHANNEL)
        self.assertEqual(core_payload.get("agent_code"), PUBLIC_AGENT)


if __name__ == "__main__":
    unittest.main()

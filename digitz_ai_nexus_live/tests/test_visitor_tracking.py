"""
Tests for Nexus Visitor Tracking

Privacy assertions included:
- No raw IP field in any DocType.
- No IP hash field in any DocType.
- No user-agent field in any DocType.
- No user-agent hash field in any DocType.
"""

import unittest
from unittest.mock import MagicMock, patch

import frappe
from frappe.utils import now_datetime


class TestVisitorTracking(unittest.TestCase):

    def setUp(self):
        frappe.set_user("Administrator")

    def tearDown(self):
        # Clean up any test records created during the tests
        for doctype in ("Nexus Web Page Visit", "Nexus Web Session", "Nexus Web Visitor"):
            for rec in frappe.get_all(doctype, filters={"name": ["like", "test_%"]}):
                frappe.delete_doc(doctype, rec.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    # ── Privacy field assertions ──────────────────────────────────────────────

    def test_nexus_web_visitor_has_no_ip_field(self):
        meta = frappe.get_meta("Nexus Web Visitor")
        fieldnames = [f.fieldname for f in meta.fields]
        self.assertNotIn("raw_ip", fieldnames, "raw_ip must not exist in Nexus Web Visitor")
        self.assertNotIn("ip_hash", fieldnames, "ip_hash must not exist in Nexus Web Visitor")
        self.assertNotIn("user_agent", fieldnames, "user_agent must not exist in Nexus Web Visitor")
        self.assertNotIn("user_agent_hash", fieldnames, "user_agent_hash must not exist in Nexus Web Visitor")

    def test_nexus_web_session_has_no_ip_field(self):
        meta = frappe.get_meta("Nexus Web Session")
        fieldnames = [f.fieldname for f in meta.fields]
        self.assertNotIn("raw_ip", fieldnames, "raw_ip must not exist in Nexus Web Session")
        self.assertNotIn("ip_hash", fieldnames, "ip_hash must not exist in Nexus Web Session")
        self.assertNotIn("user_agent", fieldnames, "user_agent must not exist in Nexus Web Session")
        self.assertNotIn("user_agent_hash", fieldnames, "user_agent_hash must not exist in Nexus Web Session")

    def test_nexus_web_page_visit_has_no_ip_field(self):
        meta = frappe.get_meta("Nexus Web Page Visit")
        fieldnames = [f.fieldname for f in meta.fields]
        self.assertNotIn("raw_ip", fieldnames, "raw_ip must not exist in Nexus Web Page Visit")
        self.assertNotIn("ip_hash", fieldnames, "ip_hash must not exist in Nexus Web Page Visit")
        self.assertNotIn("user_agent", fieldnames, "user_agent must not exist in Nexus Web Page Visit")
        self.assertNotIn("user_agent_hash", fieldnames, "user_agent_hash must not exist in Nexus Web Page Visit")

    # ── Visitor creation ──────────────────────────────────────────────────────

    def test_new_visitor_created_when_no_id(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import get_or_create_visitor
        vid = get_or_create_visitor(visitor_id=None, request=None)
        self.assertIsNotNone(vid)
        self.assertTrue(vid.startswith("nv_"))
        self.assertTrue(frappe.db.exists("Nexus Web Visitor", vid))

    def test_existing_visitor_reused(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import get_or_create_visitor

        # Create a visitor first
        vid1 = get_or_create_visitor(visitor_id=None, request=None)
        frappe.db.commit()

        # Calling again with the same id should return the same visitor
        vid2 = get_or_create_visitor(visitor_id=vid1, request=None)
        self.assertEqual(vid1, vid2)

    def test_invalid_visitor_id_creates_new_visitor(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import get_or_create_visitor
        # Malformed id — should silently create a new visitor
        vid = get_or_create_visitor(visitor_id="not_a_valid_id", request=None)
        self.assertTrue(vid.startswith("nv_"))

    def test_disabled_visitor_creates_new_visitor(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import get_or_create_visitor
        vid1 = get_or_create_visitor(visitor_id=None, request=None)
        frappe.db.commit()

        # Disable the visitor
        frappe.db.set_value("Nexus Web Visitor", vid1, "disabled", 1)
        frappe.db.commit()

        vid2 = get_or_create_visitor(visitor_id=vid1, request=None)
        self.assertNotEqual(vid1, vid2, "Disabled visitor must not be reused")

    # ── Session creation ──────────────────────────────────────────────────────

    def test_new_session_created_for_new_visitor(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import (
            get_or_create_visitor, get_or_create_session,
        )
        vid = get_or_create_visitor(visitor_id=None, request=None)
        frappe.db.commit()
        sid = get_or_create_session(visitor_id=vid, session_id=None, request=None)
        frappe.db.commit()
        self.assertIsNotNone(sid)
        self.assertTrue(sid.startswith("ns_"))
        self.assertTrue(frappe.db.exists("Nexus Web Session", sid))

    def test_returning_visitor_creates_new_session(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import (
            get_or_create_visitor, get_or_create_session,
        )
        vid = get_or_create_visitor(visitor_id=None, request=None)
        frappe.db.commit()

        sid1 = get_or_create_session(visitor_id=vid, session_id=None, request=None)
        frappe.db.commit()

        # Mark session as completed (simulates returning visitor after session ends)
        frappe.db.set_value("Nexus Web Session", sid1, "status", "Completed")
        frappe.db.commit()

        sid2 = get_or_create_session(visitor_id=vid, session_id=sid1, request=None)
        frappe.db.commit()

        self.assertNotEqual(sid1, sid2, "Completed session must not be reused")
        sess2 = frappe.db.get_value("Nexus Web Session", sid2, ["visitor"], as_dict=True)
        self.assertEqual(sess2["visitor"], vid, "New session must link to the same visitor")

    def test_timed_out_session_creates_new_session(self):
        from datetime import timedelta
        from digitz_ai_nexus_live.services.visitor_tracking_service import (
            get_or_create_visitor, get_or_create_session,
        )
        vid = get_or_create_visitor(visitor_id=None, request=None)
        frappe.db.commit()

        sid1 = get_or_create_session(visitor_id=vid, session_id=None, request=None)
        frappe.db.commit()

        # Simulate stale last_activity_on (more than 30 min ago)
        stale_time = now_datetime() - timedelta(minutes=31)
        frappe.db.set_value("Nexus Web Session", sid1, "last_activity_on", stale_time)
        frappe.db.commit()

        settings = {"session_timeout_minutes": 30}
        sid2 = get_or_create_session(
            visitor_id=vid, session_id=sid1, request=None, settings=settings
        )
        frappe.db.commit()

        self.assertNotEqual(sid1, sid2, "Timed-out session must not be reused")
        abandoned = frappe.db.get_value("Nexus Web Session", sid1, "status")
        self.assertEqual(abandoned, "Abandoned", "Timed-out session must be marked Abandoned")

    # ── Page visit lifecycle ──────────────────────────────────────────────────

    def test_page_visit_start_and_end_calculates_duration(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import (
            get_or_create_visitor, get_or_create_session,
            start_page_visit, end_page_visit,
        )
        vid = get_or_create_visitor(visitor_id=None, request=None)
        frappe.db.commit()
        sid = get_or_create_session(visitor_id=vid, session_id=None, request=None)
        frappe.db.commit()

        payload = {"page_url": "https://example.com/home", "page_title": "Home"}
        pvid = start_page_visit(vid, sid, payload)
        frappe.db.commit()

        self.assertIsNotNone(pvid)
        visit = frappe.db.get_value(
            "Nexus Web Page Visit", pvid,
            ["status", "page_path", "started_on"], as_dict=True
        )
        self.assertEqual(visit["status"], "Started")

        end_page_visit(pvid, duration_seconds=45, active_duration_seconds=30)
        frappe.db.commit()

        visit_after = frappe.db.get_value(
            "Nexus Web Page Visit", pvid,
            ["status", "duration_seconds", "active_duration_seconds"], as_dict=True
        )
        self.assertEqual(visit_after["status"], "Completed")
        self.assertEqual(visit_after["duration_seconds"], 45)
        self.assertEqual(visit_after["active_duration_seconds"], 30)

    def test_hidden_tab_not_counted_when_active_duration_provided(self):
        """Frontend sends active_duration_seconds separately — we honour it as-is."""
        from digitz_ai_nexus_live.services.visitor_tracking_service import (
            get_or_create_visitor, get_or_create_session,
            start_page_visit, end_page_visit,
        )
        vid = get_or_create_visitor(visitor_id=None, request=None)
        frappe.db.commit()
        sid = get_or_create_session(visitor_id=vid, session_id=None, request=None)
        frappe.db.commit()

        pvid = start_page_visit(vid, sid, {"page_url": "https://example.com/about"})
        frappe.db.commit()

        # 120s total, but only 40s active (tab was hidden for 80s)
        end_page_visit(pvid, duration_seconds=120, active_duration_seconds=40)
        frappe.db.commit()

        result = frappe.db.get_value(
            "Nexus Web Page Visit", pvid,
            ["duration_seconds", "active_duration_seconds"], as_dict=True
        )
        self.assertEqual(result["duration_seconds"], 120)
        self.assertEqual(result["active_duration_seconds"], 40)

    # ── URL sanitization ──────────────────────────────────────────────────────

    def test_query_params_stripped_by_default(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import sanitize_page_url
        url = "https://example.com/page?email=test@x.com&token=secret123"
        result = sanitize_page_url(url, strip_query=True)
        self.assertNotIn("email", result)
        self.assertNotIn("secret123", result)
        self.assertIn("/page", result)

    def test_utm_params_preserved_when_allowed(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import sanitize_page_url
        url = "https://example.com/page?utm_source=google&email=secret"
        result = sanitize_page_url(
            url, strip_query=True,
            allowed_params=["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]
        )
        self.assertIn("utm_source=google", result)
        self.assertNotIn("email", result)

    def test_fragment_always_stripped(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import sanitize_page_url
        url = "https://example.com/page#section-3"
        result = sanitize_page_url(url, strip_query=False)
        self.assertNotIn("#section-3", result)

    # ── Chat + visitor linking ────────────────────────────────────────────────

    def test_conversation_can_be_started_with_visitor_context(self):
        """Chat conversation accepts visitor_id/session_id without failing."""
        from digitz_ai_nexus_live.services.visitor_tracking_service import (
            get_or_create_visitor, get_or_create_session,
        )
        vid = get_or_create_visitor(visitor_id=None, request=None)
        frappe.db.commit()
        sid = get_or_create_session(visitor_id=vid, session_id=None, request=None)
        frappe.db.commit()

        conv = frappe.new_doc("Nexus Live Conversation")
        conv.conversation_id = "TEST-VT-CONV-001"
        conv.conversation_type = "Chat"
        conv.user_type = "Guest"
        conv.status = "Open"
        conv.escalation_status = "None"
        conv.visitor_id = vid
        conv.web_session_id = sid
        conv.web_visitor = vid
        conv.web_session = sid
        conv.insert(ignore_permissions=True)
        frappe.db.commit()

        saved = frappe.db.get_value(
            "Nexus Live Conversation",
            {"conversation_id": "TEST-VT-CONV-001"},
            ["visitor_id", "web_session_id", "web_visitor", "web_session"],
            as_dict=True,
        )
        self.assertEqual(saved["visitor_id"], vid)
        self.assertEqual(saved["web_session_id"], sid)
        self.assertEqual(saved["web_visitor"], vid)
        self.assertEqual(saved["web_session"], sid)

        # Cleanup
        frappe.delete_doc(
            "Nexus Live Conversation", "TEST-VT-CONV-001",
            force=True, ignore_permissions=True
        )
        frappe.db.commit()

    def test_conversation_works_without_visitor_context(self):
        """Chat must not fail when visitor_id/session_id are absent."""
        conv = frappe.new_doc("Nexus Live Conversation")
        conv.conversation_id = "TEST-VT-CONV-002"
        conv.conversation_type = "Chat"
        conv.user_type = "Guest"
        conv.status = "Open"
        conv.escalation_status = "None"
        # No visitor_id, no web_session_id — must not raise
        conv.insert(ignore_permissions=True)
        frappe.db.commit()

        saved = frappe.db.get_value(
            "Nexus Live Conversation",
            {"conversation_id": "TEST-VT-CONV-002"},
            "name",
        )
        self.assertIsNotNone(saved)

        # Cleanup
        frappe.delete_doc(
            "Nexus Live Conversation", "TEST-VT-CONV-002",
            force=True, ignore_permissions=True
        )
        frappe.db.commit()

    # ── Analytics disabled mode ───────────────────────────────────────────────

    def test_analytics_disabled_returns_safe_response(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import get_settings
        with patch(
            "digitz_ai_nexus_live.services.visitor_tracking_service.get_settings",
            return_value={**get_settings(), "enable_visitor_analytics": 0},
        ):
            from digitz_ai_nexus_live.services.visitor_tracking_service import is_analytics_enabled
            with patch(
                "digitz_ai_nexus_live.services.visitor_tracking_service.is_analytics_enabled",
                return_value=False,
            ):
                from digitz_ai_nexus_live.api.visitor_tracking import start_visitor_session
                result = start_visitor_session()
                self.assertFalse(result.get("enabled"))
                self.assertIsNone(result.get("visitor_id"))

    # ── Device parsing — no raw UA stored ────────────────────────────────────

    def test_device_parse_returns_only_categories(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import parse_device_info
        chrome_ua = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        result = parse_device_info(chrome_ua)
        # Only broad categories — no raw UA in result
        self.assertEqual(result["device_type"], "Desktop")
        self.assertEqual(result["browser"], "Chrome")
        self.assertEqual(result["os"], "Windows")
        # The raw UA string is NOT a key in the returned dict
        self.assertNotIn("user_agent", result)
        self.assertNotIn("raw_ua", result)

    def test_mobile_ua_detected(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import parse_device_info
        mobile_ua = (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        )
        result = parse_device_info(mobile_ua)
        self.assertEqual(result["device_type"], "Mobile")
        self.assertEqual(result["os"], "iOS")

    def test_bot_ua_detected(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import parse_device_info
        bot_ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
        result = parse_device_info(bot_ua)
        self.assertEqual(result["device_type"], "Bot")

    # ── GeoIP: no IP stored ───────────────────────────────────────────────────

    def test_derive_location_returns_only_country_city(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import derive_location_from_request
        # Without a real GeoIP DB configured, should return blank gracefully
        result = derive_location_from_request(request=None, settings={"store_country": 1, "store_city": 1, "geoip_db_path": None})
        # Must not expose any IP-derived value beyond country/city
        self.assertNotIn("ip", result)
        self.assertNotIn("raw_ip", result)
        self.assertIn("country", result)
        self.assertIn("city", result)

    # ── Referrer sanitization ─────────────────────────────────────────────────

    def test_referrer_stores_only_domain(self):
        from digitz_ai_nexus_live.services.visitor_tracking_service import sanitize_referrer
        full_url = "https://google.com/search?q=sensitive+query+terms"
        result = sanitize_referrer(full_url)
        self.assertEqual(result, "https://google.com")
        self.assertNotIn("sensitive", result)
        self.assertNotIn("search", result)


if __name__ == "__main__":
    unittest.main()

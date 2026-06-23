"""
Nexus Visitor Tracking — Guest-Safe API

All endpoints are allow_guest=True so the visitor tracker JS can call them
without requiring a Frappe session. Rate limiting is applied per IP to
prevent abuse. Payloads are size-capped and defensively validated.

Privacy note: No IP addresses, IP hashes, user-agent strings, or user-agent
hashes are stored. The request object is passed to the service layer only for
transient GeoIP lookup and broad device classification.
"""

import json

import frappe

from digitz_ai_nexus_live.services.visitor_tracking_service import (
    get_settings,
    is_analytics_enabled,
    get_or_create_visitor,
    get_or_create_session,
    start_page_visit,
    heartbeat_page_visit,
    end_page_visit,
)
from digitz_ai_nexus_live.services.rate_limit import check_rate_limit, get_caller_ip

_MAX_PAYLOAD_BYTES = 4096


def _parse_payload(payload):
    """Safely parse a JSON payload string with a size cap."""
    if not payload:
        return {}
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        if len(payload.encode("utf-8")) > _MAX_PAYLOAD_BYTES:
            frappe.throw("Payload too large.", frappe.ValidationError)
        try:
            return json.loads(payload)
        except Exception:
            return {}
    return {}


def _rate_limit(key_prefix, max_calls=30, window=60):
    try:
        check_rate_limit(
            f"{key_prefix}:{get_caller_ip()}",
            max_calls=max_calls,
            window_seconds=window,
            throw_message="Too many tracking requests. Please slow down.",
        )
    except Exception:
        pass


def _safe_str(val, max_len=512):
    if not val or not isinstance(val, str):
        return None
    return val.strip()[:max_len] or None


def _resolve_tenant_from_widget(widget_code):
    """Resolve tenant from a Nexus Website Widget's linked channel. Returns None on any failure."""
    if not widget_code:
        return None
    try:
        channel = frappe.db.get_value("Nexus Website Widget", widget_code, "channel")
        if channel:
            return frappe.db.get_value("Nexus Live Channel", channel, "tenant") or None
    except Exception:
        pass
    return None


@frappe.whitelist(allow_guest=True)
def start_visitor_session(visitor_id=None, session_id=None, payload=None, channel=None):
    """
    Initialise or resume a visitor session.

    Args:
        channel  — Nexus Website Widget code (NexusConfig.channel from the embedding page).
                   Used to resolve the tenant so visitor records are tagged correctly.

    Returns:
        visitor_id      — long-term anonymous visitor identifier
        session_id      — current session identifier
        settings        — subset of analytics settings the frontend needs
        enabled         — False when analytics is disabled (frontend should stop tracking)
    """
    _rate_limit("nva_session", max_calls=20, window=60)
    payload = _parse_payload(payload)

    if not is_analytics_enabled():
        return {"enabled": False, "visitor_id": None, "session_id": None, "settings": {}}

    settings = get_settings()
    request = frappe.local.request
    tenant = _resolve_tenant_from_widget(_safe_str(channel, 128))

    try:
        vid = get_or_create_visitor(
            visitor_id=_safe_str(visitor_id, 64),
            request=request,
            settings=settings,
            tenant=tenant,
        )
        sid = get_or_create_session(
            visitor_id=vid,
            session_id=_safe_str(session_id, 64),
            request=request,
            payload=payload,
            settings=settings,
            tenant=tenant,
        )
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus Visitor Session Error")
        return {"enabled": True, "visitor_id": None, "session_id": None, "settings": {}}

    # Return only the settings subset the frontend needs
    frontend_settings = {
        "heartbeat_interval_seconds": int(settings.get("heartbeat_interval_seconds") or 30),
        "enable_persistent_visitor_id": bool(settings.get("enable_persistent_visitor_id")),
        "visitor_cookie_expiry_days": int(settings.get("visitor_cookie_expiry_days") or 365),
        "privacy_mode": settings.get("privacy_mode") or "Balanced",
    }

    return {
        "enabled": True,
        "visitor_id": vid,
        "session_id": sid,
        "settings": frontend_settings,
    }


@frappe.whitelist(allow_guest=True)
def track_page_start(visitor_id=None, session_id=None, payload=None):
    """
    Record the start of a page visit.

    Returns:
        page_visit_id   — opaque ID used in heartbeat and end calls
        enabled         — False if analytics is off
    """
    _rate_limit("nva_page_start", max_calls=60, window=60)
    payload = _parse_payload(payload)

    if not is_analytics_enabled():
        return {"enabled": False, "page_visit_id": None}

    vid = _safe_str(visitor_id, 64)
    sid = _safe_str(session_id, 64)
    if not vid or not sid:
        return {"enabled": True, "page_visit_id": None}

    # Validate that visitor + session exist
    if not frappe.db.exists("Nexus Web Visitor", vid):
        return {"enabled": True, "page_visit_id": None}
    if not frappe.db.exists("Nexus Web Session", sid):
        return {"enabled": True, "page_visit_id": None}

    try:
        settings = get_settings()
        tenant = frappe.db.get_value("Nexus Web Session", sid, "tenant") or None
        pvid = start_page_visit(vid, sid, payload, settings, tenant=tenant)
        return {"enabled": True, "page_visit_id": pvid}
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus Page Visit Start Error")
        return {"enabled": True, "page_visit_id": None}


@frappe.whitelist(allow_guest=True)
def track_page_heartbeat(page_visit_id=None, active_duration_seconds=0):
    """
    Update the active duration for an ongoing page visit.
    Called every heartbeat_interval_seconds by the frontend tracker.
    """
    _rate_limit("nva_heartbeat", max_calls=120, window=60)

    pvid = _safe_str(page_visit_id, 128)
    if not pvid or not is_analytics_enabled():
        return {"ok": True}

    try:
        active = max(0, int(active_duration_seconds or 0))
        heartbeat_page_visit(pvid, active)
        frappe.db.commit()
    except Exception:
        pass

    return {"ok": True}


@frappe.whitelist(allow_guest=True)
def track_page_end(page_visit_id=None, duration_seconds=0, active_duration_seconds=0):
    """
    Mark a page visit as completed with final timing data.
    Called via navigator.sendBeacon on page unload.
    """
    _rate_limit("nva_page_end", max_calls=60, window=60)

    pvid = _safe_str(page_visit_id, 128)
    if not pvid or not is_analytics_enabled():
        return {"ok": True}

    try:
        duration = max(0, int(duration_seconds or 0))
        active = max(0, int(active_duration_seconds or 0))
        end_page_visit(pvid, duration, active)
    except Exception:
        pass

    return {"ok": True}


@frappe.whitelist(allow_guest=True)
def get_visitor_context(visitor_id=None, session_id=None):
    """
    Return lightweight context so the chat widget can read visitor/session IDs.
    Does not create any records. Returns empty dict if analytics is disabled.
    """
    if not is_analytics_enabled():
        return {}

    vid = _safe_str(visitor_id, 64)
    sid = _safe_str(session_id, 64)

    result = {}
    if vid and frappe.db.exists("Nexus Web Visitor", vid):
        result["visitor_id"] = vid
    if sid and frappe.db.exists("Nexus Web Session", sid):
        result["session_id"] = sid

    return result

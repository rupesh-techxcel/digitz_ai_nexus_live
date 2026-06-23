"""
Nexus Visitor Tracking Service

Privacy principles enforced in this module:
- Raw IP addresses are NEVER stored in any DocType field.
- IP hash is NEVER stored.
- Full user-agent strings are NEVER stored.
- User-agent hash is NEVER stored.
- IPs are used only transiently (within a single request) for approximate geo lookup, then discarded.
- Only broad device/browser/OS categories are derived and stored.
- Only approved UTM parameters are extracted from URLs.
- Full query strings are NOT stored.
"""

import json
import re
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

import frappe
from frappe.utils import now_datetime, get_datetime


# ── Settings cache ──────────────────────────────────────────────────────────

_settings_cache = {}
_settings_cache_ttl = 60  # seconds


def get_settings():
    """Return Nexus Visitor Analytics Settings with safe defaults on any failure."""
    cache_key = "nexus_visitor_analytics_settings"
    now = datetime.now().timestamp()
    if cache_key in _settings_cache:
        cached, cached_at = _settings_cache[cache_key]
        if now - cached_at < _settings_cache_ttl:
            return cached

    defaults = {
        "enable_visitor_analytics": 1,
        "privacy_mode": "Balanced",
        "enable_persistent_visitor_id": 1,
        "visitor_cookie_expiry_days": 365,
        "session_timeout_minutes": 30,
        "heartbeat_interval_seconds": 30,
        "store_country": 1,
        "store_city": 1,
        "geoip_db_path": None,
        "strip_url_query_params": 1,
        "allowed_query_params_json": '["utm_source","utm_medium","utm_campaign","utm_term","utm_content"]',
    }
    try:
        s = frappe.get_single("Nexus Visitor Analytics Settings")
        result = {k: getattr(s, k, defaults[k]) for k in defaults}
        _settings_cache[cache_key] = (result, now)
        return result
    except Exception:
        return defaults


def is_analytics_enabled():
    try:
        return bool(get_settings().get("enable_visitor_analytics"))
    except Exception:
        return False


def _allowed_utm_params(settings):
    raw = settings.get("allowed_query_params_json") or '[]'
    try:
        params = json.loads(raw)
        if isinstance(params, list):
            return [str(p).strip().lower() for p in params if p]
    except Exception:
        pass
    return ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]


# ── ID generation ────────────────────────────────────────────────────────────

def generate_visitor_id():
    """Generate a long-form anonymous visitor identifier (nv_ prefix, 24 hex chars)."""
    return "nv_" + secrets.token_hex(12)


def generate_session_id():
    """Generate a session identifier (ns_ prefix, 16 hex chars)."""
    return "ns_" + secrets.token_hex(8)


def generate_page_visit_id():
    """Generate a page visit identifier (np_ prefix)."""
    return "np_" + secrets.token_hex(10)


# ── URL sanitization ─────────────────────────────────────────────────────────

def sanitize_page_url(url, strip_query=True, allowed_params=None):
    """
    Sanitise a page URL before storage.
    - Always strips fragments.
    - Strips query string by default; keeps only allowed_params if provided.
    - Returns a truncated string to prevent oversized payloads.
    """
    if not url or not isinstance(url, str):
        return None
    url = url.strip()[:2048]

    try:
        parsed = urlparse(url)
        # Strip fragment unconditionally
        rebuilt = parsed._replace(fragment="")

        if strip_query:
            if allowed_params:
                qs = parse_qs(parsed.query, keep_blank_values=False)
                safe = {k: v for k, v in qs.items() if k.lower() in allowed_params}
                rebuilt = rebuilt._replace(query=urlencode(safe, doseq=True))
            else:
                rebuilt = rebuilt._replace(query="")

        result = urlunparse(rebuilt)
        return result[:1024]
    except Exception:
        return None


def sanitize_referrer(referrer):
    """Store only the domain of an external referrer, not the full URL."""
    if not referrer or not isinstance(referrer, str):
        return None
    referrer = referrer.strip()[:2048]
    try:
        parsed = urlparse(referrer)
        if parsed.netloc:
            return parsed.scheme + "://" + parsed.netloc
    except Exception:
        pass
    return None


def extract_page_path(url):
    """Extract only the path component from a URL."""
    if not url:
        return None
    try:
        return urlparse(url).path[:512] or "/"
    except Exception:
        return None


def extract_allowed_utm_params(url, allowed_params=None):
    """Return a dict of allowed UTM parameters found in the URL query string."""
    if not url or not isinstance(url, str):
        return {}
    if allowed_params is None:
        allowed_params = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]
    try:
        qs = parse_qs(urlparse(url).query, keep_blank_values=False)
        return {k: v[0][:200] for k, v in qs.items() if k.lower() in allowed_params and v}
    except Exception:
        return {}


# ── Device/browser parsing ───────────────────────────────────────────────────
# Privacy note: the raw user-agent string is NEVER stored. Only broad category
# labels (Desktop, Chrome, Windows, etc.) are derived here and then discarded.

def parse_device_info(user_agent_string):
    """
    Derive broad device/browser/OS categories from a user-agent string.
    The raw user-agent is NOT stored anywhere — only the derived labels are used.
    """
    if not user_agent_string or not isinstance(user_agent_string, str):
        return {"device_type": "Unknown", "browser": "Unknown", "os": "Unknown"}

    ua = user_agent_string[:512]  # work on a capped copy, never store it

    # Device type
    if re.search(r"bot|crawl|spider|slurp|bingbot|googlebot|facebookexternalhit", ua, re.I):
        device_type = "Bot"
    elif re.search(r"Mobi|Android.*Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini", ua, re.I):
        device_type = "Mobile"
    elif re.search(r"iPad|Tablet|Kindle|PlayBook|Silk|Android(?!.*Mobile)", ua, re.I):
        device_type = "Tablet"
    elif re.search(r"Windows|Macintosh|Linux|X11", ua, re.I):
        device_type = "Desktop"
    else:
        device_type = "Unknown"

    # Browser (order matters: Edge before Chrome, Chrome before Safari)
    if re.search(r"Edg/|Edge/", ua, re.I):
        browser = "Edge"
    elif re.search(r"Chrome/|CriOS/", ua, re.I):
        browser = "Chrome"
    elif re.search(r"Firefox/|FxiOS/", ua, re.I):
        browser = "Firefox"
    elif re.search(r"Safari/", ua, re.I):
        browser = "Safari"
    else:
        browser = "Unknown"

    # OS — iOS must be checked before macOS because iPhone UAs contain "Mac OS X"
    if re.search(r"iPhone|iPad|iPod", ua, re.I):
        os_name = "iOS"
    elif re.search(r"Android", ua, re.I):
        os_name = "Android"
    elif re.search(r"Windows", ua, re.I):
        os_name = "Windows"
    elif re.search(r"Macintosh|Mac OS X", ua, re.I):
        os_name = "macOS"
    elif re.search(r"Linux|X11", ua, re.I):
        os_name = "Linux"
    else:
        os_name = "Unknown"

    return {"device_type": device_type, "browser": browser, "os": os_name}


# ── GeoIP ────────────────────────────────────────────────────────────────────
# Privacy note: the IP is used only within this function and NEVER stored.
# The function returns only approximate country/city strings.

_geoip_reader = None
_geoip_load_attempted = False


def _get_geoip_reader(db_path):
    global _geoip_reader, _geoip_load_attempted
    if _geoip_load_attempted:
        return _geoip_reader
    _geoip_load_attempted = True
    if not db_path:
        return None
    try:
        import geoip2.database
        _geoip_reader = geoip2.database.Reader(db_path)
    except Exception:
        _geoip_reader = None
    return _geoip_reader


def derive_location_from_request(request, settings=None):
    """
    Derive approximate country/city from the current request's IP.

    Privacy guarantees:
    - The IP address is extracted only within this function scope.
    - The IP is passed only to the local GeoIP reader.
    - The IP is NEVER returned, logged, or stored anywhere.
    - Only the resulting country/city strings are returned.
    - If geo lookup fails for any reason, returns blank values silently.
    """
    if settings is None:
        settings = get_settings()

    result = {"country": None, "city": None}
    if not settings.get("store_country") and not settings.get("store_city"):
        return result

    db_path = settings.get("geoip_db_path")
    if not db_path:
        return result

    reader = _get_geoip_reader(db_path)
    if not reader:
        return result

    try:
        # Extract IP transiently — NOT stored anywhere
        forwarded_for = getattr(request.headers, "get", lambda k: None)("X-Forwarded-For") or ""
        if forwarded_for:
            ip = forwarded_for.split(",")[0].strip()
        else:
            ip = getattr(request, "remote_addr", None) or ""

        if not ip or ip in ("unknown", "127.0.0.1", "::1"):
            return result

        record = reader.city(ip)
        if settings.get("store_country") and record.country.name:
            result["country"] = record.country.name[:100]
        if settings.get("store_city") and record.city.name:
            result["city"] = record.city.name[:100]
    except Exception:
        pass  # IP not found, lookup error, or private IP — silently skip

    return result


# ── Visitor management ───────────────────────────────────────────────────────

def get_or_create_visitor(visitor_id, request=None, settings=None, tenant=None):
    """
    Return an existing Nexus Web Visitor or create a new anonymous one.
    If visitor_id is missing/invalid/disabled, a fresh visitor is always created.
    """
    if settings is None:
        settings = get_settings()
    now = now_datetime()

    # Try to reuse an existing visitor record
    if visitor_id and isinstance(visitor_id, str) and re.match(r"^nv_[a-f0-9]{24}$", visitor_id):
        existing = frappe.db.get_value(
            "Nexus Web Visitor", visitor_id,
            ["name", "visitor_id", "disabled", "tenant"], as_dict=True
        )
        if existing and not existing.get("disabled"):
            updates = {"last_seen": now}
            if tenant and not existing.get("tenant"):
                updates["tenant"] = tenant
            frappe.db.set_value(
                "Nexus Web Visitor", existing["name"],
                updates, update_modified=False
            )
            return existing["visitor_id"]

    # Create a new anonymous visitor
    location = derive_location_from_request(request, settings) if request else {}
    ua_string = ""
    try:
        ua_string = (request.headers.get("User-Agent") or "") if request else ""
    except Exception:
        pass
    device_info = parse_device_info(ua_string)
    # Raw ua_string is discarded here — only device_info dict is used

    new_id = generate_visitor_id()
    visitor = frappe.new_doc("Nexus Web Visitor")
    visitor.visitor_id = new_id
    visitor.tenant = tenant or None
    visitor.visitor_type = "Anonymous"
    visitor.first_seen = now
    visitor.last_seen = now
    visitor.country = location.get("country") if settings.get("store_country") else None
    visitor.city = location.get("city") if settings.get("store_city") else None
    visitor.device_type = device_info.get("device_type")
    visitor.browser = device_info.get("browser")
    visitor.os = device_info.get("os")
    visitor.insert(ignore_permissions=True)
    frappe.db.commit()

    return new_id


def get_or_create_session(visitor_id, session_id, request=None, payload=None, settings=None, tenant=None):
    """
    Return an existing active Nexus Web Session or create a new one.
    A session is expired when inactive for session_timeout_minutes.
    """
    if settings is None:
        settings = get_settings()

    now = now_datetime()
    timeout_minutes = int(settings.get("session_timeout_minutes") or 30)
    payload = payload or {}
    allowed_params = _allowed_utm_params(settings)
    strip_qs = bool(settings.get("strip_url_query_params"))

    # Try to reuse an existing active session
    if session_id and isinstance(session_id, str) and re.match(r"^ns_[a-f0-9]{16}$", session_id):
        sess = frappe.db.get_value(
            "Nexus Web Session", session_id,
            ["name", "session_id", "status", "last_activity_on", "visitor"], as_dict=True
        )
        if sess and sess.get("status") == "Active" and sess.get("visitor") == visitor_id:
            last = get_datetime(sess.get("last_activity_on") or sess["name"])
            cutoff = now_datetime() - timedelta(minutes=timeout_minutes)
            if last > get_datetime(str(cutoff)):
                frappe.db.set_value(
                    "Nexus Web Session", sess["name"],
                    "last_activity_on", now, update_modified=False
                )
                return sess["session_id"]
            else:
                # Mark the timed-out session as abandoned
                frappe.db.set_value(
                    "Nexus Web Session", sess["name"],
                    {"status": "Abandoned", "ended_on": now}, update_modified=False
                )

    # Derive location and UTM for the new session
    location = derive_location_from_request(request, settings) if request else {}
    ua_string = ""
    try:
        ua_string = (request.headers.get("User-Agent") or "") if request else ""
    except Exception:
        pass
    device_info = parse_device_info(ua_string)

    landing_url = payload.get("page_url") or ""
    sanitized_landing = sanitize_page_url(landing_url, strip_qs, allowed_params)
    raw_referrer = payload.get("referrer") or ""
    utm = extract_allowed_utm_params(landing_url, allowed_params)

    new_sid = generate_session_id()
    session = frappe.new_doc("Nexus Web Session")
    session.session_id = new_sid
    session.tenant = tenant or None
    session.visitor = visitor_id
    session.status = "Active"
    session.started_on = now
    session.last_activity_on = now
    session.landing_page = sanitized_landing
    session.referrer = sanitize_referrer(raw_referrer)
    session.utm_source = utm.get("utm_source")
    session.utm_medium = utm.get("utm_medium")
    session.utm_campaign = utm.get("utm_campaign")
    session.utm_term = utm.get("utm_term")
    session.utm_content = utm.get("utm_content")
    session.country = location.get("country") if settings.get("store_country") else None
    session.city = location.get("city") if settings.get("store_city") else None
    session.device_type = device_info.get("device_type")
    session.browser = device_info.get("browser")
    session.os = device_info.get("os")
    session.page_count = 0
    session.total_duration_seconds = 0
    session.active_duration_seconds = 0
    session.insert(ignore_permissions=True)
    frappe.db.commit()

    return new_sid


# ── Page visit management ─────────────────────────────────────────────────────

def start_page_visit(visitor_id, session_id, payload, settings=None, tenant=None):
    """Create a new Nexus Web Page Visit record and return its name."""
    if settings is None:
        settings = get_settings()

    allowed_params = _allowed_utm_params(settings)
    strip_qs = bool(settings.get("strip_url_query_params"))
    now = now_datetime()

    raw_url = (payload.get("page_url") or "")[:2048]
    sanitized_url = sanitize_page_url(raw_url, strip_qs, allowed_params)
    page_path = payload.get("page_path") or extract_page_path(raw_url)
    page_title = (payload.get("page_title") or "")[:512]
    raw_prev = (payload.get("previous_page_url") or "")[:2048]
    sanitized_prev = sanitize_page_url(raw_prev, strip_qs, allowed_params)
    raw_referrer = (payload.get("referrer") or "")[:2048]
    country = (payload.get("country") or "")[:100]
    city = (payload.get("city") or "")[:100]

    visit = frappe.new_doc("Nexus Web Page Visit")
    visit.tenant = tenant or None
    visit.visitor = visitor_id
    visit.session = session_id
    visit.page_url = sanitized_url
    visit.page_path = (page_path or "")[:512]
    visit.page_title = page_title
    visit.previous_page_url = sanitized_prev
    visit.referrer = sanitize_referrer(raw_referrer)
    visit.started_on = now
    visit.status = "Started"
    visit.heartbeat_count = 0
    visit.duration_seconds = 0
    visit.active_duration_seconds = 0
    visit.country = country if settings.get("store_country") else None
    visit.city = city if settings.get("store_city") else None
    visit.insert(ignore_permissions=True)

    # Update session activity and page count
    _increment_session_page_count(session_id, now)
    frappe.db.commit()

    return visit.name


def heartbeat_page_visit(page_visit_name, active_duration_seconds):
    """Record a heartbeat from an active page visit. Does not commit — caller decides."""
    if not page_visit_name or not isinstance(page_visit_name, str):
        return
    active_secs = max(0, int(active_duration_seconds or 0))
    now = now_datetime()

    try:
        current = frappe.db.get_value(
            "Nexus Web Page Visit", page_visit_name,
            ["name", "status", "heartbeat_count", "session"], as_dict=True
        )
        if not current or current["status"] in ("Completed", "Abandoned"):
            return

        frappe.db.set_value(
            "Nexus Web Page Visit", page_visit_name,
            {
                "status": "Active",
                "last_heartbeat_on": now,
                "heartbeat_count": (current.get("heartbeat_count") or 0) + 1,
                "active_duration_seconds": active_secs,
            },
            update_modified=False,
        )

        # Keep session last_activity fresh
        if current.get("session"):
            frappe.db.set_value(
                "Nexus Web Session", current["session"],
                "last_activity_on", now, update_modified=False
            )
    except Exception:
        pass


def end_page_visit(page_visit_name, duration_seconds, active_duration_seconds):
    """Mark a page visit as completed with final timing data."""
    if not page_visit_name or not isinstance(page_visit_name, str):
        return
    duration = max(0, int(duration_seconds or 0))
    active = max(0, int(active_duration_seconds or 0))
    now = now_datetime()

    try:
        current = frappe.db.get_value(
            "Nexus Web Page Visit", page_visit_name,
            ["name", "status", "session", "page_url"], as_dict=True
        )
        if not current or current["status"] in ("Completed", "Abandoned"):
            return

        frappe.db.set_value(
            "Nexus Web Page Visit", page_visit_name,
            {
                "status": "Completed",
                "ended_on": now,
                "duration_seconds": duration,
                "active_duration_seconds": active,
            },
            update_modified=False,
        )

        # Update session exit page and cumulative duration
        if current.get("session"):
            update_session_summary(current["session"], exit_page=current.get("page_url"))
    except Exception:
        pass

    frappe.db.commit()


def update_session_summary(session_id, exit_page=None):
    """Recalculate page_count and cumulative durations for a session."""
    if not session_id:
        return
    try:
        agg = frappe.db.sql("""
            SELECT COUNT(*) AS cnt,
                   COALESCE(SUM(duration_seconds), 0) AS total_dur,
                   COALESCE(SUM(active_duration_seconds), 0) AS active_dur
            FROM `tabNexus Web Page Visit`
            WHERE session = %s
        """, (session_id,), as_dict=True)

        updates = {}
        if agg:
            updates["page_count"] = agg[0].get("cnt") or 0
            updates["total_duration_seconds"] = agg[0].get("total_dur") or 0
            updates["active_duration_seconds"] = agg[0].get("active_dur") or 0

        if exit_page:
            updates["exit_page"] = exit_page[:1024]

        if updates:
            frappe.db.set_value("Nexus Web Session", session_id, updates, update_modified=False)
    except Exception:
        pass


def _increment_session_page_count(session_id, now):
    """Efficiently increment the session page counter without a full recalculation."""
    if not session_id:
        return
    try:
        frappe.db.sql(
            "UPDATE `tabNexus Web Session` SET page_count = COALESCE(page_count,0) + 1, last_activity_on = %s WHERE name = %s",
            (now, session_id)
        )
    except Exception:
        pass


# ── Conversation linking ──────────────────────────────────────────────────────

def resolve_visitor_context_for_conversation(visitor_id, session_id):
    """
    Resolve Nexus Web Visitor and Nexus Web Session records by their IDs.
    Returns a dict with the fields to stamp on Nexus Live Conversation.
    Returns an empty dict if records are not found or analytics is disabled.
    """
    result = {}
    if not visitor_id or not session_id:
        return result
    try:
        visitor_name = frappe.db.get_value("Nexus Web Visitor", visitor_id, "name")
        session_name = frappe.db.get_value("Nexus Web Session", session_id, "name")
        if visitor_name:
            result["web_visitor"] = visitor_name
        if session_name:
            result["web_session"] = session_name
    except Exception:
        pass
    return result


# ── Scheduled task ────────────────────────────────────────────────────────────

def close_abandoned_sessions():
    """
    Scheduler task: mark sessions as Abandoned when inactive beyond session_timeout_minutes.
    Called periodically by the scheduler.
    """
    try:
        settings = get_settings()
        if not settings.get("enable_visitor_analytics"):
            return
        timeout_minutes = int(settings.get("session_timeout_minutes") or 30)
        cutoff = now_datetime() - timedelta(minutes=timeout_minutes)
        stale = frappe.db.sql("""
            SELECT name FROM `tabNexus Web Session`
            WHERE status = 'Active'
              AND (last_activity_on IS NULL OR last_activity_on < %s)
        """, (cutoff,), as_dict=True)

        for row in stale:
            frappe.db.set_value(
                "Nexus Web Session", row["name"],
                {"status": "Abandoned", "ended_on": now_datetime()},
                update_modified=False,
            )
        if stale:
            frappe.db.commit()
    except Exception:
        pass

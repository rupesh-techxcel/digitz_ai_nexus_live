import frappe


def check_rate_limit(key, max_calls, window_seconds, throw_message=None):
    """
    Redis-based sliding-window rate limiter.

    key           — unique string identifying the caller + action (e.g. "ncw_chat:{ip}")
    max_calls     — maximum allowed calls in the window
    window_seconds — length of the window in seconds
    throw_message — if set, frappe.throw() with this message when limit exceeded;
                    otherwise returns True (limited) / False (allowed)
    """
    cache_key = f"ncw_rl:{key}"
    try:
        count = frappe.cache().get_value(cache_key) or 0
        count = int(count)
        if count >= max_calls:
            if throw_message:
                frappe.throw(throw_message, frappe.TooManyRequestsError)
            return True
        pipe = frappe.cache().pipeline()
        pipe.incr(cache_key)
        pipe.expire(cache_key, window_seconds)
        pipe.execute()
    except Exception:
        pass
    return False


def get_caller_ip():
    try:
        request = frappe.local.request
        forwarded_for = request.headers.get("X-Forwarded-For", "")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        return request.remote_addr or "unknown"
    except Exception:
        return "unknown"


def validate_widget_origin(widget_code):
    """
    When a widget_code is present, verify that the HTTP Origin header
    matches the widget's allowed_domains_json. Throws on mismatch.
    Skipped for authenticated (non-guest) callers.
    """
    if not widget_code:
        return
    if frappe.session.user not in ("Guest", None, ""):
        return

    try:
        origin = frappe.local.request.headers.get("Origin") or ""
    except Exception:
        return

    if not origin:
        return

    from digitz_ai_nexus_live.nexus_live_channels.doctype.nexus_website_widget.nexus_website_widget import (
        get_widget_for_api_call,
        get_allowed_origins,
        normalize_origin,
    )

    widget_row = get_widget_for_api_call(widget_code)
    if not widget_row:
        return

    widget = frappe.get_doc("Nexus Website Widget", widget_row.name)
    allowed = get_allowed_origins(widget)
    if not allowed or "*" in allowed:
        return

    normalized = normalize_origin(origin)
    if normalized not in allowed:
        frappe.throw(
            "This widget is not authorized for your origin.",
            frappe.PermissionError,
        )

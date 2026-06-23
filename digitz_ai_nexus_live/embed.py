import frappe

from digitz_ai_nexus_live.nexus_live_channels.doctype.nexus_website_widget.nexus_website_widget import (
    get_external_widget,
    normalize_origin,
)

_TRACKING_PREFIX = "/api/method/digitz_ai_nexus_live.api.visitor_tracking."


def set_embed_headers(response=None, request=None):
    if not response or not request:
        return

    # Chat embed iframe — set frame-ancestors CSP
    if request.path == "/nexus-chat-embed":
        origin = normalize_origin(request.args.get("origin"))
        widget_code = request.args.get("widget")
        config = get_external_widget(widget_code, origin)

        frame_ancestors = "'self'"
        if config:
            frame_ancestors = f"'self' {config['origin']}"

        response.headers["Content-Security-Policy"] = f"frame-ancestors {frame_ancestors}"
        response.headers["X-Frame-Options"] = ""
        response.headers["Cache-Control"] = "no-store"
        return

    # Visitor tracking API — add CORS headers for cross-origin embeds
    if request.path.startswith(_TRACKING_PREFIX):
        _set_tracking_cors(response, request)


def _set_tracking_cors(response, request):
    """
    Add CORS headers for visitor tracking API endpoints so external websites
    can call them directly from the browser.

    Origin is validated against the allowed_domains of any active Nexus Website Widget.
    Requests from unknown origins are also allowed because tracking data is anonymous
    and rate-limited — the risk of accepting unknown origins is negligible.
    """
    origin = request.headers.get("Origin")
    if not origin:
        return

    # Validate against configured widget domains (best-effort; cache via frappe.cache)
    allowed = _get_allowed_origins()
    norm = normalize_origin(origin)
    # Allow if origin matches a configured widget domain OR if no widgets are configured
    if norm in allowed or not allowed:
        _add_cors(response, origin)
    else:
        # Still allow — tracking is anonymous and rate-limited
        _add_cors(response, origin)


def _add_cors(response, origin):
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Max-Age"] = "86400"
    response.headers["Vary"] = "Origin"


def _get_allowed_origins():
    """Return a set of normalised origins from all active widget allowed-domain rows."""
    try:
        cache_key = "nxv_allowed_origins"
        cached = frappe.cache().get_value(cache_key)
        if cached is not None:
            return set(cached)

        rows = frappe.db.sql("""
            SELECT d.domain
            FROM `tabNexus Widget Allowed Domain` d
            JOIN `tabNexus Website Widget` w ON w.name = d.parent
            WHERE w.enabled = 1
              AND (d.enabled IS NULL OR d.enabled = 1)
              AND d.domain IS NOT NULL AND d.domain != ''
        """, as_dict=True)

        origins = [normalize_origin(r.domain) for r in rows if r.domain]
        origins = [o for o in origins if o]
        frappe.cache().set_value(cache_key, origins, expires_in_sec=120)
        return set(origins)
    except Exception:
        return set()


def handle_options_preflight(response=None, request=None):
    """
    Respond to OPTIONS preflight requests for visitor tracking endpoints.
    Called from before_request hook — sets response early to avoid Frappe
    processing the OPTIONS as an API call.
    """
    if not frappe.local.request or frappe.local.request.method != "OPTIONS":
        return
    if not frappe.local.request.path.startswith(_TRACKING_PREFIX):
        return

    origin = frappe.local.request.headers.get("Origin", "")
    frappe.local.response.update({
        "http_status_code": 204,
    })
    frappe.local.response["headers"] = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Content-Length": "0",
    }


def ensure_external_widget(
    widget_code,
    widget_name,
    channel,
    allowed_origins,
    widget_type="Chat",
    theme="DIGITZ Blue",
    primary_color="#2158c7",
):
    if isinstance(allowed_origins, str):
        allowed_origins = [allowed_origins]

    if frappe.db.exists("Nexus Website Widget", widget_code):
        doc = frappe.get_doc("Nexus Website Widget", widget_code)
    else:
        doc = frappe.new_doc("Nexus Website Widget")
        doc.widget_code = widget_code

    doc.widget_name = widget_name
    doc.channel = channel
    doc.widget_type = widget_type
    doc.enabled = 1
    doc.theme = theme
    doc.primary_color = primary_color
    doc.position = "Bottom Right"
    doc.set("allowed_domains", [{"domain": o, "enabled": 1} for o in allowed_origins])
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return doc.name

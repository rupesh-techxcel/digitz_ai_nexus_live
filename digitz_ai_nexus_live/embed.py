import frappe

from digitz_ai_nexus_live.nexus_live_channels.doctype.nexus_website_widget.nexus_website_widget import (
	get_external_widget,
	normalize_origin,
)


def set_embed_headers(response=None, request=None):
	if not response or not request or request.path != "/nexus-chat-embed":
		return

	origin = normalize_origin(request.args.get("origin"))
	widget_code = request.args.get("widget")
	config = get_external_widget(widget_code, origin)

	frame_ancestors = "'self'"
	if config:
		frame_ancestors = f"'self' {config['origin']}"

	response.headers["Content-Security-Policy"] = f"frame-ancestors {frame_ancestors}"
	response.headers["X-Frame-Options"] = ""
	response.headers["Cache-Control"] = "no-store"


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
	doc.allowed_domains_json = frappe.as_json(allowed_origins)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return doc.name

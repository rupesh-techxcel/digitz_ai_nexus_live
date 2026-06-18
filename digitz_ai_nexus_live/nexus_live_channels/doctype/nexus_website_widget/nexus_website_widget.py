import json
from urllib.parse import urlparse

import frappe
from frappe.model.document import Document


class NexusWebsiteWidget(Document):
	pass


def normalize_origin(origin):
	if not origin:
		return None

	parsed = urlparse(origin)
	if not parsed.scheme or not parsed.netloc:
		return None

	return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def get_allowed_origins(widget):
	raw = (widget.allowed_domains_json or "").strip()
	if not raw:
		return []

	try:
		value = json.loads(raw)
	except Exception:
		return []

	if isinstance(value, list):
		origins = value
	elif isinstance(value, dict):
		origins = value.get("allowed_origins") or value.get("allowed_domains") or []
	else:
		origins = []

	return [origin for origin in (normalize_origin(item) for item in origins) if origin]


def get_external_widget(widget_code, origin=None):
	origin = normalize_origin(origin)
	if not widget_code or not origin:
		return None

	name = frappe.db.get_value("Nexus Website Widget", {"widget_code": widget_code, "enabled": 1}, "name")
	if not name:
		return None

	widget = frappe.get_doc("Nexus Website Widget", name)
	allowed_origins = get_allowed_origins(widget)
	if "*" not in allowed_origins and origin not in allowed_origins:
		return None

	channel = frappe.get_doc("Nexus Live Channel", widget.channel)
	if not channel.enabled:
		return None

	return {
		"widget": widget,
		"channel": channel,
		"origin": origin,
		"allowed_origins": allowed_origins,
	}


@frappe.whitelist(allow_guest=True)
def get_embed_config(widget_code=None, origin=None):
	config = get_external_widget(widget_code, origin)
	if not config:
		frappe.throw("Widget is not available for this origin.")

	widget = config["widget"]
	channel = config["channel"]
	return {
		"widget_code": widget.widget_code,
		"widget_name": widget.widget_name,
		"channel": channel.name,
		"tenant": channel.tenant,
		"theme": widget.theme,
		"primary_color": widget.primary_color,
		"welcome_text": widget.welcome_text,
		"position": widget.position,
	}

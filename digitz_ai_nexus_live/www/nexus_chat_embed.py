no_cache = 1

import frappe

from digitz_ai_nexus_live.nexus_live_channels.doctype.nexus_website_widget.nexus_website_widget import (
	get_external_widget,
)


def get_context(context):
	context.title = "Nexus Chat Embed"
	context.no_cache = 1
	context.widget_valid = 0
	context.widget_code = frappe.form_dict.get("widget")
	context.parent_origin = frappe.form_dict.get("origin")
	context.widget_channel = ""
	context.widget_tenant = ""
	context.widget_name = "Nexus AI"
	context.knowledge_delivery_enabled = 1

	config = get_external_widget(context.widget_code, context.parent_origin)
	if not config:
		return

	context.widget_valid = 1
	context.parent_origin = config["origin"]
	context.widget_channel = config["channel"].name
	context.widget_tenant = config["channel"].tenant or ""
	context.widget_name = config["widget"].widget_name or "Nexus AI"
	context.knowledge_delivery_enabled = int(config["widget"].knowledge_delivery_enabled)

import json
import re
from urllib.parse import urlparse

import frappe
from frappe.model.document import Document


class NexusWebsiteWidget(Document):
	def validate(self):
		self._auto_generate_widget_code()
		self._sync_allowed_domains_json()

	def _auto_generate_widget_code(self):
		if not self.widget_code and self.widget_name:
			slug = re.sub(r"[^a-zA-Z0-9]+", "-", self.widget_name).strip("-").upper()
			self.widget_code = slug[:50]

	def _sync_allowed_domains_json(self):
		"""Keep allowed_domains_json in sync with the child table."""
		if not (hasattr(self, "allowed_domains") and self.allowed_domains):
			return
		origins = []
		for row in self.allowed_domains:
			if row.enabled and row.domain:
				normalized = normalize_origin(row.domain)
				if normalized:
					origins.append(normalized)
		self.allowed_domains_json = json.dumps(origins, indent=2)


# ── Helpers used by embed.py and api/live.py ──────────────────────────────────

def normalize_origin(origin):
	if not origin:
		return None
	parsed = urlparse(origin)
	if not parsed.scheme or not parsed.netloc:
		return None
	return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def is_local_origin(origin):
	"""Return True for localhost / 127.x.x.x / ::1 — always allowed without a domain entry."""
	if not origin:
		return False
	host = urlparse(origin).hostname or ""
	return host in ("localhost", "127.0.0.1", "::1", "0.0.0.0") or host.startswith("127.")


def get_allowed_origins(widget):
	"""
	Return the list of permitted origins for a widget doc.
	Reads from the child table when loaded; falls back to allowed_domains_json
	for records that pre-date the child-table migration.
	"""
	table_origins = []
	if hasattr(widget, "allowed_domains") and widget.allowed_domains:
		for row in widget.allowed_domains:
			if getattr(row, "enabled", 1) and row.domain:
				normalized = normalize_origin(row.domain)
				if normalized:
					table_origins.append(normalized)
		if table_origins:
			return table_origins

	# Fallback: JSON field (old records / records saved before migration)
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
	return [o for o in (normalize_origin(item) for item in origins) if o]


def get_external_widget(widget_code, origin=None):
	origin = normalize_origin(origin)
	if not widget_code or not origin:
		return None

	row = frappe.db.get_value(
		"Nexus Website Widget",
		{"widget_code": widget_code, "enabled": 1},
		["name", "contract_status"],
		as_dict=True,
	)
	if not row or row.contract_status != "Active":
		return None

	widget = frappe.get_doc("Nexus Website Widget", row.name)
	allowed_origins = get_allowed_origins(widget)
	if not is_local_origin(origin) and "*" not in allowed_origins and origin not in allowed_origins:
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


def get_widget_for_api_call(widget_code):
	if not widget_code:
		return None
	row = frappe.db.get_value(
		"Nexus Website Widget",
		{"widget_code": widget_code, "enabled": 1},
		["name", "contract_status", "knowledge_delivery_enabled"],
		as_dict=True,
	)
	if not row or row.contract_status != "Active":
		return None
	return row


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
		"knowledge_delivery_enabled": int(widget.knowledge_delivery_enabled),
		"contract_status": widget.contract_status,
	}

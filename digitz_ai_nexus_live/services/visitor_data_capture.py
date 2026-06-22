import hashlib

import frappe
from frappe.utils import now_datetime


def normalize_email(email):
	return (email or "").strip().lower()


def _capture_key(email, collection_context, conversation=None, reference_name=None):
	identity = "|".join((conversation or "unlinked", reference_name or "unreferenced"))
	raw = "|".join((normalize_email(email), collection_context or "Other", identity))
	return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _conversation_context(conversation):
	if not conversation:
		return None, None, None, None

	doc = conversation
	if isinstance(conversation, str):
		name = frappe.db.get_value(
			"Nexus Live Conversation",
			{"conversation_id": conversation},
			"name",
		) or conversation
		if not frappe.db.exists("Nexus Live Conversation", name):
			return None, None, None, None
		doc = frappe.get_doc("Nexus Live Conversation", name)

	channel = getattr(doc, "channel", None)
	tenant = frappe.db.get_value("Nexus Live Channel", channel, "tenant") if channel else None
	return doc, tenant, channel, getattr(doc, "chat_category", None)


def capture_visitor_data(
	*,
	email,
	collection_context,
	collection_reason,
	visitor_name=None,
	conversation=None,
	selected_option=None,
	source_event=None,
	email_verified=False,
	consent_status="Not Recorded",
	consent_scope=None,
	reference_doctype=None,
	reference_name=None,
):
	"""Create or update one purpose-specific visitor data capture event."""
	normalized_email = normalize_email(email)
	if not normalized_email:
		return None

	conversation_doc, tenant, channel, chat_category = _conversation_context(conversation)
	conversation_name = getattr(conversation_doc, "name", None)
	visitor_name = visitor_name or getattr(conversation_doc, "visitor_name", None)
	selected_option = selected_option or (
		frappe.db.get_value("Nexus Chat Category", chat_category, "category_label")
		if chat_category
		else None
	)
	key = _capture_key(
		normalized_email,
		collection_context,
		conversation=conversation_name,
		reference_name=reference_name,
	)
	now = now_datetime()

	values = {
		"visitor_name": visitor_name,
		"email": normalized_email,
		"normalized_email": normalized_email,
		"tenant": tenant,
		"conversation": conversation_name,
		"channel": channel,
		"chat_category": chat_category,
		"collection_context": collection_context or "Other",
		"selected_option": selected_option,
		"collection_reason": collection_reason,
		"source_event": source_event,
		"reference_doctype": reference_doctype,
		"reference_name": reference_name,
		"email_verified": int(bool(email_verified)),
		"consent_status": consent_status or "Not Recorded",
		"consent_scope": consent_scope,
		"last_seen_on": now,
	}

	existing = frappe.db.get_value("Nexus Visitor Data Capture", {"capture_key": key}, "name")
	if existing:
		frappe.db.set_value("Nexus Visitor Data Capture", existing, values, update_modified=True)
		return existing

	doc = frappe.new_doc("Nexus Visitor Data Capture")
	doc.update(values)
	doc.capture_key = key
	doc.captured_on = now
	try:
		doc.insert(ignore_permissions=True)
	except frappe.DuplicateEntryError:
		# A browser retry can race another worker between the lookup and insert.
		return frappe.db.get_value("Nexus Visitor Data Capture", {"capture_key": key}, "name")
	return doc.name


def capture_from_conversation(conversation, **overrides):
	doc, _tenant, _channel, _category = _conversation_context(conversation)
	if not doc or not getattr(doc, "visitor_email", None):
		return None

	return capture_visitor_data(
		email=doc.visitor_email,
		visitor_name=getattr(doc, "visitor_name", None),
		conversation=doc,
		collection_context=overrides.pop("collection_context", "Chat Start"),
		collection_reason=overrides.pop(
			"collection_reason", "Visitor identity supplied for the live chat session."
		),
		selected_option=overrides.pop("selected_option", None),
		**overrides,
	)

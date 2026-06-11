import json
import random
import frappe
from frappe.utils import now_datetime


def generate_conversation_id():
    return frappe.generate_hash(length=12).upper()


def get_conversation(conversation_id_or_name):
    if not conversation_id_or_name:
        return None

    if frappe.db.exists("Nexus Live Conversation", conversation_id_or_name):
        return frappe.get_doc("Nexus Live Conversation", conversation_id_or_name)

    name = frappe.db.get_value(
        "Nexus Live Conversation",
        {"conversation_id": conversation_id_or_name},
        "name",
    )

    if name:
        return frappe.get_doc("Nexus Live Conversation", name)

    return None


def create_conversation(payload, assigned_agent=None, ai_profile_override=None):
    payload = payload or {}

    conversation = frappe.new_doc("Nexus Live Conversation")
    conversation.conversation_id = payload.get("conversation_id") or generate_conversation_id()
    conversation.conversation_type = payload.get("conversation_type") or "Chat"
    conversation.channel = payload.get("channel")
    conversation.chat_category = payload.get("chat_category")
    conversation.resolved_identity_type = payload.get("identity_type")
    conversation.identity_registry = payload.get("identity_registry")
    if "identity_safeguard_access_categories" in payload:
        conversation.identity_safeguard_access_json = json.dumps(
            payload.get("identity_safeguard_access_categories") or []
        )
    conversation.visitor_name = payload.get("visitor_name")
    conversation.visitor_email = payload.get("visitor_email")
    conversation.visitor_phone = payload.get("visitor_phone")
    conversation.user_type = payload.get("user_type") or "Guest"
    conversation.intent = payload.get("intent")
    conversation.status = "Open"
    conversation.escalation_status = "None"
    conversation.started_on = now_datetime()

    if assigned_agent:
        conversation.assigned_agent = assigned_agent.name
        conversation.assigned_agent_type = "AI"

        # The profile IS the agent — snapshot behavior fields for immutability
        profile = ai_profile_override or assigned_agent
        if profile:
            conversation.assigned_ai_agent_profile = profile.name
            nickname = _pick_nickname(profile)
            conversation.ai_profile_snapshot_json = json.dumps({
                "name": profile.name,
                "nickname": nickname,
                "chat_category": payload.get("chat_category"),
                "identity_type": payload.get("identity_type"),
                "identity_registry": payload.get("identity_registry"),
                "identity_safeguard_access_categories": payload.get(
                    "identity_safeguard_access_categories"
                ),
                "knowledge_profile_names": payload.get("knowledge_profile_names") or [],
                "behavior_prompt": profile.behavior_prompt,
                "tone": profile.tone,
                "response_style": profile.response_style,
                "welcome_message": profile.welcome_message,
                "fallback_message": profile.fallback_message,
                "do_not_answer_rules": profile.do_not_answer_rules,
                "confidence_threshold": profile.confidence_threshold,
                "escalation_enabled": profile.escalation_enabled,
                "escalation_policy": profile.escalation_policy,
                "memory_mode": profile.memory_mode,
                "default_response_mode": profile.default_response_mode,
                "collect_visitor_name": getattr(profile, "collect_visitor_name", 0),
            })

    conversation.insert(ignore_permissions=True)

    # Create a runtime agent profile instance to represent this session's persona.
    # Re-use the nickname already picked for the snapshot so both are consistent.
    if assigned_agent:
        profile = ai_profile_override or assigned_agent
        if profile:
            # Extract nickname from the frozen snapshot rather than picking again
            try:
                _snap = json.loads(conversation.ai_profile_snapshot_json or "{}")
                _nickname = _snap.get("nickname") or _pick_nickname(profile)
            except Exception:
                _nickname = _pick_nickname(profile)

            instance = frappe.new_doc("Nexus AI Agent Profile Instance")
            instance.profile_template = profile.name
            instance.nickname = _nickname
            instance.conversation = conversation.name
            instance.status = "Active"
            instance.created_on = now_datetime()
            instance.insert(ignore_permissions=True)
            conversation.db_set("agent_profile_instance", instance.name, update_modified=False)
            conversation.agent_profile_instance = instance.name

    return conversation


def update_conversation_assignment(conversation, agent):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    if not conversation_doc or not agent:
        return None

    conversation_doc.assigned_agent = agent.name
    conversation_doc.assigned_agent_type = "AI"
    conversation_doc.status = "Responding"
    conversation_doc.save(ignore_permissions=True)

    return conversation_doc


def add_message(
    conversation,
    sender_type,
    message,
    sender_agent=None,
    response_mode=None,
    confidence=None,
    sources=None,
    retrieval_debug=None,
):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    if not conversation_doc:
        frappe.throw("Conversation not found.")

    msg = frappe.new_doc("Nexus Live Message")
    msg.conversation = conversation_doc.name
    msg.sender_type = sender_type
    msg.sender_agent = sender_agent
    msg.message = message
    msg.response_mode = response_mode
    msg.confidence = confidence
    msg.sources_json = json.dumps(sources or [], indent=2)
    msg.retrieval_debug_json = json.dumps(retrieval_debug or {}, indent=2)
    msg.message_time = now_datetime()
    msg.insert(ignore_permissions=True)

    conversation_doc.last_message = message if sender_type in ("Visitor", "User") else conversation_doc.last_message
    conversation_doc.last_response = message if sender_type in ("AI Agent", "Human Agent") else conversation_doc.last_response

    if confidence is not None:
        conversation_doc.confidence = confidence

    conversation_doc.save(ignore_permissions=True)

    return msg


def add_participant(conversation, participant_type, agent=None, user=None):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    participant = frappe.new_doc("Nexus Conversation Participant")
    participant.conversation = conversation_doc.name
    participant.participant_type = participant_type
    participant.agent = agent
    participant.user = user
    participant.joined_on = now_datetime()
    participant.is_active = 1
    participant.insert(ignore_permissions=True)

    return participant


def set_conversation_status(conversation, status):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    if not conversation_doc:
        return None

    conversation_doc.status = status

    if status == "Closed":
        conversation_doc.closed_on = now_datetime()
        if conversation_doc.agent_profile_instance:
            frappe.db.set_value(
                "Nexus AI Agent Profile Instance",
                conversation_doc.agent_profile_instance,
                "status",
                "Closed",
                update_modified=False,
            )

    conversation_doc.save(ignore_permissions=True)
    return conversation_doc


def mark_escalated(conversation):
    from frappe.utils import now_datetime

    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    if not conversation_doc:
        return None

    conversation_doc.status = "Escalated"
    conversation_doc.escalation_status = "Pending"
    conversation_doc.escalated_at = now_datetime()
    conversation_doc.save(ignore_permissions=True)

    return conversation_doc


def close_conversation(conversation):
    return set_conversation_status(conversation, "Closed")


def get_conversation_messages(conversation, limit=20):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    if not conversation_doc:
        return []

    return frappe.get_all(
        "Nexus Live Message",
        filters={"conversation": conversation_doc.name},
        fields=[
            "name",
            "sender_type",
            "sender_agent",
            "message",
            "response_mode",
            "confidence",
            "message_time",
        ],
        order_by="message_time asc",
        limit_page_length=limit,
    )


_DEFAULT_NICKNAME_POOL = [
    "Aria", "Nova", "Zara", "Lyra", "Sage",
    "Echo", "Finn", "Milo", "Luca", "Orion",
    "Iris", "Jade", "Remi", "Skye", "Taya",
    "Ezra", "Cleo", "Demi", "Halo", "Juno",
    "Kira", "Lena", "Noel", "Pax",  "Vera",
]


def _pick_nickname(profile):
    """
    Pick a display name for a new agent profile instance.

    Priority:
    1. Random choice from the profile's nickname_pool (one name per line).
    2. The profile's display_name.
    3. Random choice from the built-in _DEFAULT_NICKNAME_POOL.
    4. The profile's agent_name.
    """
    pool_text = getattr(profile, "nickname_pool", None) or ""
    names = [n.strip() for n in pool_text.splitlines() if n.strip()]
    if names:
        return random.choice(names)
    if profile.display_name:
        return profile.display_name
    return random.choice(_DEFAULT_NICKNAME_POOL)

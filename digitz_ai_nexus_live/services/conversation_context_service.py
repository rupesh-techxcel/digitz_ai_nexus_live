import re
import frappe

MAX_CONTEXT_MESSAGES = 20
MAX_CONTEXT_CHARS = 6000

FOLLOW_UP_PATTERNS = [
    r"\bcontinue\b",
    r"\bprevious\b",
    r"\bthat\b",
    r"\bthis\b",
    r"\bit\b",
    r"\bsame\b",
    r"\bmore\b",
    r"\btell me more\b",
    r"\bexplain further\b",
    r"\bwhat about\b",
    r"\bhow about\b",
]


def is_follow_up_query(query):
    query = (query or "").strip().lower()
    return bool(query) and any(re.search(pattern, query) for pattern in FOLLOW_UP_PATTERNS)


def get_recent_conversation_messages(conversation, limit=MAX_CONTEXT_MESSAGES):
    conversation_name = conversation.name if hasattr(conversation, "name") else conversation

    if not conversation_name:
        return []

    return frappe.get_all(
        "Nexus Live Message",
        filters={"conversation": conversation_name},
        fields=[
            "sender_type",
            "message",
            "response_mode",
            "confidence",            
            "creation",
        ],
        order_by="creation desc",
        limit_page_length=limit,
    )[::-1]


def build_conversation_context(messages):
    lines = []

    for row in messages or []:
        sender = row.get("sender_type") or "Unknown"
        message = (row.get("message") or "").strip()

        if not message:
            continue

        lines.append(f"{sender}: {message}")

    context = "\n".join(lines)

    if len(context) > MAX_CONTEXT_CHARS:
        context = context[-MAX_CONTEXT_CHARS:]

    return context


def extract_last_meaningful_topic(messages):
    for row in reversed(messages or []):
        message = (row.get("message") or "").strip()

        if not message:
            continue

        if len(message) < 8:
            continue

        if message.lower() in {"yes", "no", "ok", "okay", "thanks", "thank you"}:
            continue

        return message[:500]

    return ""


def build_effective_query(current_query, messages):
    current_query = (current_query or "").strip()

    if not current_query:
        return current_query

    if not is_follow_up_query(current_query):
        return current_query

    last_topic = extract_last_meaningful_topic(messages)

    if not last_topic:
        return current_query

    return (
        f"{current_query}\n\n"
        f"Previous conversation topic/context:\n{last_topic}\n\n"
        "Reconstructed retrieval intent:\n"
        f"Answer the user follow-up in relation to: {last_topic}"
    )


def build_chat_continuity_payload(payload, conversation):
    payload = payload or {}

    current_query = (
        payload.get("query")
        or payload.get("message")
        or payload.get("question")
    )

    messages = get_recent_conversation_messages(
        conversation=conversation,
        limit=MAX_CONTEXT_MESSAGES,
    )

    conversation_context = build_conversation_context(messages)
    effective_query = build_effective_query(current_query, messages)

    return {
        "original_query": current_query,
        "effective_query": effective_query,
        "conversation_context": conversation_context,
        "context_message_count": len(messages),
        "is_follow_up": is_follow_up_query(current_query),
    }
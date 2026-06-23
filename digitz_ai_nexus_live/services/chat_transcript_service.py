"""
Chat transcript email service.

Lets a visitor request an email copy of their conversation after the chat.
If their email is already verified on the conversation, the transcript is
sent immediately. Otherwise a 6-digit OTP is delivered to the supplied
address first — the same pattern as WhatsApp registration.

Flow:
  1. Visitor clicks "Email this conversation" in the widget
  2. Widget calls request_chat_transcript(conversation_id, email)
     → email matches conversation.visitor_email (already verified) → send directly
     → otherwise → 6-digit OTP cached, sent to the email address
  3. Visitor enters OTP → verify_chat_transcript_otp(conversation_id, otp)
     → match → transcript email sent → cache cleared
"""

import random
import string
from html import escape

import frappe
from frappe.utils import format_datetime, now_datetime


_OTP_TTL_SECONDS = 300
_OTP_DIGITS = 6
_MAX_ATTEMPTS = 5


def request_chat_transcript(conversation_id, email):
    """
    Initiate transcript delivery.

    Returns {"status": "sent"} if the email is already verified
    (transcript delivered immediately) or {"status": "otp_sent"} if
    an OTP was dispatched.
    """
    email = _normalise_email(email)
    if not email:
        frappe.throw("Please enter a valid email address.")

    conversation = _get_conversation(conversation_id)

    # Already verified — send directly without OTP
    if conversation.visitor_email and _normalise_email(conversation.visitor_email) == email:
        _deliver_transcript(conversation, email)
        return {"status": "sent", "email": _mask_email(email)}

    # New email — OTP required
    otp = _generate_otp()
    _store_otp(conversation_id, email, otp)
    _send_otp_email(email, otp, conversation)

    return {"status": "otp_sent", "email": _mask_email(email)}


def verify_chat_transcript_otp(conversation_id, otp_input):
    """
    Verify the OTP, then deliver the transcript.

    Returns {"status": "sent"} on success.
    """
    conversation = _get_conversation(conversation_id)

    stored = _load_otp(conversation_id)
    if not stored:
        frappe.throw("Your verification code has expired. Please request a new one.")

    if stored.get("attempts", 0) >= _MAX_ATTEMPTS:
        _clear_otp(conversation_id)
        frappe.throw("Too many incorrect attempts. Please request a new code.")

    if stored.get("otp") != otp_input.strip():
        stored["attempts"] = stored.get("attempts", 0) + 1
        frappe.cache().set_value(_otp_key(conversation_id), stored, expires_in_sec=_OTP_TTL_SECONDS)
        remaining = _MAX_ATTEMPTS - stored["attempts"]
        frappe.throw(f"Incorrect code. {remaining} attempt(s) remaining.")

    email = stored["email"]
    _clear_otp(conversation_id)
    _deliver_transcript(conversation, email)

    return {"status": "sent", "email": _mask_email(email)}


# ── Internal helpers ───────────────────────────────────────────────────────────

def _get_conversation(conversation_id):
    conv = frappe.db.get_value(
        "Nexus Live Conversation",
        {"conversation_id": conversation_id},
        ["name", "conversation_id", "channel", "visitor_email", "visitor_name",
         "chat_category", "creation", "status"],
        as_dict=True,
    )
    if not conv:
        frappe.throw("Conversation not found.")
    return conv


def _deliver_transcript(conversation, email):
    """Build the transcript and send it."""
    messages = frappe.get_all(
        "Nexus Live Message",
        filters={"conversation": conversation.name},
        fields=["sender_type", "sender_agent", "message", "message_time"],
        order_by="message_time asc",
        limit_page_length=200,
    )

    channel_label = ""
    if conversation.channel:
        channel_label = frappe.db.get_value("Nexus Live Channel", conversation.channel, "channel_name") or ""

    category_label = ""
    if conversation.chat_category:
        category_label = frappe.db.get_value("Nexus Chat Category", conversation.chat_category, "category_label") or ""

    topic = category_label or channel_label or "Chat"
    chat_date = format_datetime(conversation.creation, "d MMM YYYY")

    subject = f"Your conversation summary — {topic}"

    html_rows = []
    for msg in messages:
        if msg.sender_type == "Visitor":
            sender_label = escape(conversation.visitor_name or "You")
            bubble_style = (
                "background:#f0f4ff;border-left:3px solid #2158c7;"
                "padding:10px 14px;border-radius:6px;margin:10px 0;"
            )
        elif msg.sender_type == "AI Agent":
            agent_name = escape(msg.sender_agent or "AI Assistant")
            sender_label = agent_name
            bubble_style = (
                "background:#f8f9fa;border-left:3px solid #6b7280;"
                "padding:10px 14px;border-radius:6px;margin:10px 0;"
            )
        else:
            sender_label = escape(msg.sender_type or "System")
            bubble_style = (
                "background:#fff8e1;border-left:3px solid #f59e0b;"
                "padding:10px 14px;border-radius:6px;margin:10px 0;"
            )

        ts = ""
        if msg.message_time:
            ts = format_datetime(msg.message_time, "h:mm a")

        msg_html = escape(msg.message or "").replace("\n", "<br>")

        html_rows.append(
            f'<div style="{bubble_style}">'
            f'<div style="font-size:11px;color:#6b7280;margin-bottom:4px;">'
            f'<strong>{sender_label}</strong>'
            f'{(" &bull; " + ts) if ts else ""}'
            f'</div>'
            f'<div style="font-size:14px;color:#1f2937;line-height:1.5;">{msg_html}</div>'
            f'</div>'
        )

    body_rows = "\n".join(html_rows) if html_rows else "<p>No messages found.</p>"

    html_body = f"""
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937;">
  <p style="font-size:13px;color:#6b7280;margin:0 0 4px 0;">Your conversation on {escape(chat_date)}</p>
  <h2 style="margin:0 0 24px 0;font-size:18px;font-weight:600;">{escape(topic)}</h2>
  {body_rows}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px 0;">
  <p style="font-size:11px;color:#9ca3af;margin:0;">
    This is a copy of your conversation from {escape(channel_label or "Nexus AI")}.
    Replies to this email are not monitored.
  </p>
</div>
""".strip()

    try:
        frappe.sendmail(
            recipients=[email],
            subject=subject,
            message=html_body,
            delayed=False,
        )
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus Transcript: sendmail failed")
        frappe.throw("Could not send the email. Please try again.")


def _send_otp_email(email, otp, conversation):
    channel_label = ""
    if conversation.channel:
        channel_label = frappe.db.get_value("Nexus Live Channel", conversation.channel, "channel_name") or ""

    subject = "Your conversation transcript verification code"

    html_body = f"""
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937;">
  <p style="margin:0 0 12px 0;">
    You requested a copy of your conversation
    {("with <strong>" + escape(channel_label) + "</strong>") if channel_label else ""}.
  </p>
  <p style="margin:0 0 20px 0;">Enter this code in the chat window to confirm your email:</p>
  <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#2158c7;
              padding:16px;background:#f0f4ff;border-radius:8px;text-align:center;">
    {escape(otp)}
  </div>
  <p style="margin:20px 0 0 0;font-size:12px;color:#6b7280;">
    This code expires in 5 minutes. If you did not request this, ignore this email.
  </p>
</div>
""".strip()

    try:
        frappe.sendmail(
            recipients=[email],
            subject=subject,
            message=html_body,
            delayed=False,
        )
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus Transcript OTP: sendmail failed")
        frappe.throw("Could not send the verification email. Please check the address and try again.")


def _otp_key(conversation_id):
    return f"nexus_transcript_otp:{conversation_id}"


def _store_otp(conversation_id, email, otp):
    frappe.cache().set_value(
        _otp_key(conversation_id),
        {"otp": otp, "email": email, "attempts": 0, "sent_at": str(now_datetime())},
        expires_in_sec=_OTP_TTL_SECONDS,
    )


def _load_otp(conversation_id):
    return frappe.cache().get_value(_otp_key(conversation_id))


def _clear_otp(conversation_id):
    frappe.cache().delete_value(_otp_key(conversation_id))


def _generate_otp():
    return "".join(random.choices(string.digits, k=_OTP_DIGITS))


def _normalise_email(email):
    if not email:
        return ""
    return email.strip().lower()


def _mask_email(email):
    """Return p***@domain.com form."""
    if not email or "@" not in email:
        return email
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked_local = local[0] + "*"
    else:
        masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
    return f"{masked_local}@{domain}"

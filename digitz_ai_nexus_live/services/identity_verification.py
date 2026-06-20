import hashlib
from html import escape
import random

import frappe
from frappe.utils import add_to_date, get_datetime, now_datetime


DEFAULT_OTP_VALIDITY_MINUTES = 10
DEFAULT_OTP_MAX_ATTEMPTS = 5


def get_category_verification_mode(chat_category):
    if not chat_category or not frappe.db.exists("Nexus Chat Category", chat_category):
        return "None"

    return (
        frappe.db.get_value(
            "Nexus Chat Category",
            chat_category,
            "identity_verification_mode",
        )
        or "None"
    )


def request_verification(channel, chat_category, email):
    email = _normalize_email(email)
    if not email:
        frappe.throw("Email is required for identity verification.")

    category = frappe.get_doc("Nexus Chat Category", chat_category)
    mode = category.identity_verification_mode or "None"

    if mode == "None":
        return {"required": 0, "status": "not_required"}

    if mode not in ("Email OTP", "Registered Email OTP"):
        frappe.throw(f"Unsupported identity verification mode '{mode}'.")

    resolved_identity_type = None
    identity_registry = None

    if mode == "Registered Email OTP":
        identity_registry, resolved_identity_type = _resolve_registered_identity(
            channel=channel,
            chat_category=chat_category,
            email=email,
        )

        if (not identity_registry or not resolved_identity_type) and category.allow_public_fallback:
            resolved_identity_type = "Public"

        if not resolved_identity_type:
            frappe.throw(
                "This email is not registered for the selected chat category.",
                title="Registered Identity Required",
            )
    else:
        identity_registry, resolved_identity_type = _resolve_optional_registered_identity(
            channel=channel,
            chat_category=chat_category,
            email=email,
        )
        resolved_identity_type = resolved_identity_type or "Public"

    otp = _generate_otp()
    challenge_token = frappe.generate_hash(length=32)

    doc = frappe.new_doc("Nexus Identity Verification Challenge")
    doc.challenge_token = challenge_token
    doc.status = "Pending"
    doc.verification_mode = mode
    doc.email = email
    doc.channel = channel
    doc.chat_category = chat_category
    doc.otp_hash = _hash_otp(challenge_token, otp)
    doc.expires_on = add_to_date(now_datetime(), minutes=DEFAULT_OTP_VALIDITY_MINUTES)
    doc.attempts = 0
    doc.max_attempts = DEFAULT_OTP_MAX_ATTEMPTS
    doc.identity_registry = identity_registry
    doc.resolved_identity_type = resolved_identity_type
    doc.insert(ignore_permissions=True)

    _send_otp_email(email=email, otp=otp, category_label=category.category_label)

    return {
        "required": 1,
        "status": "pending",
        "challenge_token": challenge_token,
        "email": email,
        "expires_on": doc.expires_on,
        "verification_mode": mode,
    }


def verify_challenge(challenge_token, otp):
    if not challenge_token or not otp:
        frappe.throw("Challenge token and OTP are required.")

    name = frappe.db.get_value(
        "Nexus Identity Verification Challenge",
        {"challenge_token": challenge_token},
        "name",
    )
    if not name:
        frappe.throw("Invalid identity verification challenge.")

    doc = frappe.get_doc("Nexus Identity Verification Challenge", name)
    _expire_if_needed(doc)

    if doc.status != "Pending":
        frappe.throw(f"Identity verification challenge is {doc.status.lower()}.")

    if int(doc.attempts or 0) >= int(doc.max_attempts or DEFAULT_OTP_MAX_ATTEMPTS):
        doc.status = "Failed"
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.throw("Maximum OTP attempts exceeded.")

    doc.attempts = int(doc.attempts or 0) + 1

    if doc.otp_hash != _hash_otp(challenge_token, str(otp).strip()):
        if int(doc.attempts or 0) >= int(doc.max_attempts or DEFAULT_OTP_MAX_ATTEMPTS):
            doc.status = "Failed"
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.throw("Invalid OTP.")

    doc.status = "Verified"
    doc.verified_on = now_datetime()
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "status": "verified",
        "challenge_token": doc.challenge_token,
        "email": doc.email,
        "identity_type": doc.resolved_identity_type,
        "chat_category": doc.chat_category,
    }


def enforce_category_verification(payload):
    chat_category = payload.get("chat_category")
    mode = get_category_verification_mode(chat_category)

    if mode == "None":
        return None

    challenge = get_verified_challenge(
        challenge_token=payload.get("identity_verification_challenge"),
        chat_category=chat_category,
        email=payload.get("visitor_email") or payload.get("email"),
    )

    if not challenge:
        frappe.throw(
            f"This chat category requires {mode}. Please verify your email before starting chat.",
            title="Identity Verification Required",
        )

    payload["visitor_email"] = challenge.email
    return challenge


def get_verified_challenge(challenge_token, chat_category=None, email=None):
    if not challenge_token:
        return None

    name = frappe.db.get_value(
        "Nexus Identity Verification Challenge",
        {"challenge_token": challenge_token, "status": "Verified"},
        "name",
    )
    if not name:
        return None

    doc = frappe.get_doc("Nexus Identity Verification Challenge", name)
    _expire_if_needed(doc)
    if doc.status != "Verified":
        return None

    if chat_category and doc.chat_category != chat_category:
        return None

    normalized_email = _normalize_email(email)
    if normalized_email and doc.email != normalized_email:
        return None

    return doc


def resolve_identity_from_verified_challenge(payload):
    challenge = get_verified_challenge(
        challenge_token=payload.get("identity_verification_challenge"),
        chat_category=payload.get("chat_category"),
        email=payload.get("visitor_email") or payload.get("email"),
    )
    if not challenge:
        return None

    return challenge.resolved_identity_type


def _resolve_registered_identity(channel, chat_category, email):
    registry_name = frappe.db.get_value(
        "Nexus Identity Registry",
        {"email": email, "enabled": 1, "verification_status": "Verified"},
        "name",
    )
    if not registry_name:
        return None, None

    from digitz_ai_nexus_live.services.identity_resolver import resolve_registered_identity_type

    identity_type = resolve_registered_identity_type({
        "channel": channel,
        "chat_category": chat_category,
        "visitor_email": email,
        "trust_visitor_email": 1,
    })

    return registry_name, identity_type


def _resolve_optional_registered_identity(channel, chat_category, email):
    registry_name = frappe.db.get_value(
        "Nexus Identity Registry",
        {"email": email, "enabled": 1, "verification_status": "Verified"},
        "name",
    )
    if not registry_name:
        return None, None

    from digitz_ai_nexus_live.services.identity_resolver import resolve_registered_identity_type

    identity_type = resolve_registered_identity_type({
        "channel": channel,
        "chat_category": chat_category,
        "visitor_email": email,
        "trust_visitor_email": 1,
    })

    return registry_name, identity_type


def _send_otp_email(email, otp, category_label):
    try:
        frappe.sendmail(
            recipients=[email],
            subject="Your Nexus chat verification code",
            message=(
                f"Your verification code for {escape(category_label or 'chat')} is "
                f"<b>{otp}</b>. This code expires in {DEFAULT_OTP_VALIDITY_MINUTES} minutes."
            ),
            delayed=True,
        )
    except Exception:
        import traceback as _tb
        frappe.log_error(
            title="Nexus OTP (email not configured)",
            message=f"OTP for {email}: {otp}\n\n{_tb.format_exc()}",
        )


def _expire_if_needed(doc):
    if doc.status == "Pending" and doc.expires_on and get_datetime(doc.expires_on) < now_datetime():
        doc.status = "Expired"
        doc.save(ignore_permissions=True)
        frappe.db.commit()


def _generate_otp():
    return f"{random.SystemRandom().randint(100000, 999999)}"


def _hash_otp(challenge_token, otp):
    return hashlib.sha256(f"{challenge_token}:{otp}".encode("utf-8")).hexdigest()


def _normalize_email(email):
    if not email:
        return None
    return email.strip().lower()

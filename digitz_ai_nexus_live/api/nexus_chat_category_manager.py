import frappe
from frappe.utils import now_datetime


@frappe.whitelist()
def test_chat_connectivity():
    """
    Trace the desk-user start_chat path step by step.
    Each step runs inside a try/except so the exact failure point and full
    error are captured and returned to the UI.

    Steps:
      1  Session User       — is the caller an authenticated desk user?
      2  Tenant Context     — can tenant/channel be resolved?
      3  Profile Assignment — is there an active Nexus User Profile Assignment?
      4  Agent Availability — is an approved idle AI agent available?
      5  Live Chat Init     — actually call start_live_chat (no message → no background job)
      6  Cleanup            — close the test conversation
    """
    from digitz_ai_nexus_live.services.live_chat_service import (
        apply_session_user_context,
        start_live_chat,
    )
    from digitz_ai_nexus_live.services.profile_resolver import (
        get_authenticated_session_user,
        is_internal_session_user,
        is_system_manager_session_user,
        resolve_behavior_for_internal_user,
    )
    from digitz_ai_nexus_live.services.agent_router import assign_agent
    from digitz_ai_nexus.services.tenant_context import apply_tenant_context_to_payload

    steps = []

    def add_step(num, label, status, detail, error=None):
        steps.append({
            "step": num,
            "label": label,
            "status": status,   # "pass" | "fail" | "skip"
            "detail": detail,
            "error": error,
        })

    # ── Step 1: Session user ───────────────────────────────────────────────────
    user = None
    is_sm = False
    try:
        user = get_authenticated_session_user()
        payload = apply_session_user_context({})
        user_type = payload.get("user_type", "Guest")
        is_internal = is_internal_session_user(user)
        is_sm = is_system_manager_session_user(user)

        if not user or user == "Guest":
            add_step(1, "Session User", "fail",
                     "Not authenticated. Desk chat requires a logged-in desk user.",
                     "frappe.session.user is Guest")
            return {"steps": steps, "overall": "fail"}

        if not is_internal:
            add_step(1, "Session User", "fail",
                     f"'{user}' is not a desk user (user_type={user_type}). "
                     "Only Frappe desk accounts can use the internal AI chat.",
                     "is_internal_session_user returned False")
            return {"steps": steps, "overall": "fail"}

        add_step(1, "Session User", "pass",
                 f"User: {user} · Type: {user_type} · System Manager: {'Yes' if is_sm else 'No'}")
    except Exception:
        add_step(1, "Session User", "fail", "Unexpected error checking session.", frappe.get_traceback())
        return {"steps": steps, "overall": "fail"}

    # ── Step 2: Tenant context (informational — not a hard requirement) ─────────
    # Tenant is not mandatory for desk user chat; if absent start_live_chat will
    # surface the error at step 5. We resolve here to show what was found.
    payload = {"conversation_type": "Chat"}
    try:
        payload = apply_session_user_context(payload)
        payload = apply_tenant_context_to_payload(payload=payload, require_tenant=False)
        tenant = payload.get("tenant")
        channel = payload.get("channel")
        business_unit = payload.get("business_unit")

        if not tenant:
            add_step(2, "Tenant Context", "skip",
                     "No tenant resolved from Nexus Tenant Configuration or Nexus User Context. "
                     "If the live API requires one, the error will appear at step 5.")
        else:
            parts = [f"Tenant: {tenant}"]
            if channel:
                parts.append(f"Channel: {channel}")
            if business_unit:
                parts.append(f"Business Unit: {business_unit}")
            add_step(2, "Tenant Context", "pass", " · ".join(parts))
    except Exception:
        add_step(2, "Tenant Context", "skip",
                 "Exception while resolving tenant context (non-fatal at this stage).",
                 frappe.get_traceback())

    # ── Step 3: Profile assignment ─────────────────────────────────────────────
    behavior = None
    try:
        behavior = resolve_behavior_for_internal_user(user)
        if not behavior:
            if is_sm:
                add_step(3, "Profile Assignment", "pass",
                         "No Nexus User Profile Assignment found, but user is System Manager — "
                         "will fall back to agent default behavior.")
            else:
                add_step(3, "Profile Assignment", "fail",
                         f"No active Nexus User Profile Assignment for '{user}'. "
                         "Create one via Setup → User Profile Assignments and link a Nexus AI Agent Profile.",
                         "resolve_behavior_for_internal_user returned None for non-System Manager user")
                return {"steps": steps, "overall": "fail"}
        else:
            add_step(3, "Profile Assignment", "pass",
                     f"Profile: {behavior.profile_name}")
    except Exception:
        add_step(3, "Profile Assignment", "fail", "Exception resolving profile assignment.", frappe.get_traceback())
        return {"steps": steps, "overall": "fail"}

    # ── Step 4: Agent availability ─────────────────────────────────────────────
    try:
        probe = dict(payload)
        if behavior and behavior.profile_name:
            try:
                profile_doc = frappe.get_doc("Nexus AI Agent Profile", behavior.profile_name)
                if profile_doc.get("agent_name"):
                    probe["agent"] = profile_doc.agent_name
            except Exception:
                pass

        if not probe.get("agent"):
            probe.setdefault("visibility", "Internal")

        agent = assign_agent(probe)
        if not agent:
            add_step(4, "Agent Availability", "fail",
                     "No AI agent available for desk chat. "
                     "Set a Default Agent on the Nexus Live Channel, or assign a "
                     "Nexus User Profile Assignment for this user that links to an "
                     "AI Agent Profile with an available agent.",
                     "assign_agent returned None — no matching agent available")
            return {"steps": steps, "overall": "fail"}

        add_step(4, "Agent Availability", "pass",
                 f"Agent: {agent.agent_code} · {agent.display_name or agent.agent_name} · Role: {agent.agent_role}")
    except Exception:
        add_step(4, "Agent Availability", "fail", "Exception during agent lookup.", frappe.get_traceback())
        return {"steps": steps, "overall": "fail"}

    # ── Step 5: Live chat init ─────────────────────────────────────────────────
    # No message → desk path returns greeting in HTTP; no background job is enqueued.
    conversation_name = None
    conversation_id = None
    try:
        result = start_live_chat({"conversation_type": "Chat"})
        conversation_id = result.get("conversation_id")
        conversation_name = result.get("conversation")
        status = result.get("status")
        greeting = (result.get("greeting") or "").strip()[:100] or "(none)"

        add_step(5, "Live Chat Init", "pass",
                 f"Conversation: {conversation_name} · ID: {conversation_id} · "
                 f"Status: {status} · Agent: {result.get('agent_code')} · "
                 f"Greeting: \"{greeting}\"")
    except Exception:
        add_step(5, "Live Chat Init", "fail",
                 "start_live_chat raised an exception. "
                 "This is the error blocking desk user chat.",
                 frappe.get_traceback())
        return {"steps": steps, "overall": "fail", "conversation_id": None}

    # ── Step 6: Cleanup ────────────────────────────────────────────────────────
    if conversation_name:
        try:
            frappe.db.set_value("Nexus Live Conversation", conversation_name, {
                "status": "Closed",
                "closed_on": now_datetime(),
            })
            frappe.db.commit()
            add_step(6, "Cleanup", "pass", f"Test conversation {conversation_name} closed and will not appear in the console.")
        except Exception as e:
            add_step(6, "Cleanup", "skip", f"Could not close test conversation: {str(e)}")
    else:
        add_step(6, "Cleanup", "skip", "No conversation created; nothing to clean up.")

    return {"steps": steps, "overall": "pass", "conversation_id": conversation_id}


@frappe.whitelist()
def get_category_chain(category_code):
    """
    Return all identity routes for a category, each with their full chain:
    Identity Type → Profile → Access Categories → Policies

    Since the same category can route to different profiles per identity type,
    this returns a list of route chains — one per configured identity type.
    """
    if not frappe.db.exists("Nexus Chat Category", category_code):
        frappe.throw(f"Category '{category_code}' not found.")

    cat = frappe.get_doc("Nexus Chat Category", category_code)

    _cat_route_filters = {"chat_category": category_code, "enabled": 1}
    if cat.tenant:
        _cat_route_filters["tenant"] = cat.tenant
    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters=_cat_route_filters,
        fields=["name", "ai_agent_profile", "priority"],
        order_by="priority asc",
    )

    result = {
            "category": {
                "code": cat.category_code,
                "label": cat.category_label,
                "visibility": cat.visibility,
                "identity_verification_mode": cat.identity_verification_mode,
                "allow_public_fallback": cat.allow_public_fallback,
                "enabled": cat.enabled,
            },
        "routes": [],
        "warnings": [],
    }

    if not routes:
        result["warnings"].append(
            "No identity routes configured. Visitors who select this category will "
            "receive an error. Add routes in the Category Profile Routes page."
        )
        return result

    for route in routes:
        permitted = frappe.get_all(
            "Nexus Route Identity Profile",
            filters={"parent": route.name},
            pluck="identity_profile",
        )
        open_to_all = not bool(permitted)
        route_identity_label = "Open to all" if open_to_all else ", ".join(permitted)

        entry = {
            "identity_type": route_identity_label,
            "open_to_all": open_to_all,
            "profile": None,
            "access_categories": [],
            "policies": [],
            "warnings": [],
        }

        profile_name = route.ai_agent_profile
        if not profile_name or not frappe.db.exists("Nexus AI Agent Profile", profile_name):
            entry["warnings"].append(f"Profile '{profile_name}' not found.")
            result["routes"].append(entry)
            continue

        profile = frappe.get_doc("Nexus AI Agent Profile", profile_name)
        entry["profile"] = {
            "name": profile.name,
            "agent": profile.agent_name,
            "tone": profile.tone,
            "memory_mode": profile.memory_mode,
            "confidence_threshold": profile.confidence_threshold,
            "escalation_enabled": profile.escalation_enabled,
            "fallback_message": profile.fallback_message,
        }

        # Knowledge access is governed by Identity Profile → Knowledge Profile → Access Categories.
        # Display the permitted identity profiles for this route as the access context.
        if permitted:
            entry["identity_profiles"] = list(permitted)
        else:
            entry["identity_profiles"] = []

        result["routes"].append(entry)

    return result


@frappe.whitelist()
def get_page_data():
    from digitz_ai_nexus_live.api.nexus_profile_access_allocation import get_available_tenants

    channels = frappe.get_all(
        "Nexus Live Channel",
        filters={"enabled": 1},
        fields=["name", "channel_code", "channel_name", "channel_type", "tenant"],
        order_by="channel_name asc",
    )
    tenant_data = get_available_tenants()
    return {
        "channels": channels,
        "tenants": tenant_data.get("tenants") or [],
        "default_tenant": tenant_data.get("default_tenant") or "",
    }


@frappe.whitelist()
def get_channel_categories(channel, tenant=None):
    filters = {"channel": channel}
    if tenant:
        filters["tenant"] = tenant
    categories = frappe.get_all(
        "Nexus Chat Category",
        filters=filters,
        fields=[
            "name", "category_code", "category_label",
            "visibility", "identity_verification_mode",
            "allow_public_fallback", "display_order", "enabled", "published", "description",
        ],
        order_by="display_order asc",
    )

    # Annotate each category with its configured identity profiles
    for cat in categories:
        _route_f = {"chat_category": cat.category_code, "enabled": 1}
        if tenant:
            _route_f["tenant"] = tenant
        routes = frappe.get_all(
            "Nexus Category Identity Route",
            filters=_route_f,
            fields=["name"],
            order_by="priority asc",
        )
        labels = []
        for r in routes:
            permitted = frappe.get_all(
                "Nexus Route Identity Profile",
                filters={"parent": r.name},
                pluck="identity_profile",
            )
            if not permitted:
                labels.append("Open to all")
            else:
                labels.extend(permitted)
        cat["configured_identities"] = list(dict.fromkeys(labels))  # deduplicate, preserve order

    return {"categories": categories}


@frappe.whitelist()
def save_category(
    channel,
    category_label,
    display_order,
    description,
    enabled,
    visibility="External",
    identity_verification_mode="None",
    allow_public_fallback=0,
    published=1,
    tenant=None,
    name=None,
    category_code=None,
):
    if name and frappe.db.exists("Nexus Chat Category", name):
        doc = frappe.get_doc("Nexus Chat Category", name)
    else:
        doc = frappe.new_doc("Nexus Chat Category")
        if category_code:
            doc.category_code = category_code
        else:
            slug = category_label.lower().replace(" ", "-").replace("/", "-")
            base = f"{channel}-{slug}"
            doc.category_code = base
            counter = 1
            while frappe.db.exists("Nexus Chat Category", doc.category_code):
                doc.category_code = f"{base}-{counter}"
                counter += 1

    doc.channel = channel
    if tenant:
        doc.tenant = tenant
    doc.category_label = category_label
    doc.visibility = visibility or "External"
    doc.identity_verification_mode = identity_verification_mode or "None"
    doc.allow_public_fallback = int(allow_public_fallback or 0)
    doc.display_order = int(display_order or 10)
    doc.description = description or ""
    doc.enabled = int(enabled)
    doc.published = int(published)

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"status": "success", "name": doc.name, "category_code": doc.category_code}


@frappe.whitelist()
def delete_category(name):
    if not frappe.db.exists("Nexus Chat Category", name):
        frappe.throw("Category not found.")

    cat = frappe.get_doc("Nexus Chat Category", name)

    # Remove all associated identity routes before deleting
    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters={"chat_category": cat.category_code},
        pluck="name",
    )
    for route in routes:
        frappe.delete_doc("Nexus Category Identity Route", route, ignore_permissions=True)

    frappe.delete_doc("Nexus Chat Category", name, ignore_permissions=True)
    frappe.db.commit()
    return {"status": "success"}


@frappe.whitelist()
def toggle_category(name, enabled):
    if not frappe.db.exists("Nexus Chat Category", name):
        frappe.throw("Category not found.")
    frappe.db.set_value("Nexus Chat Category", name, "enabled", int(enabled))
    frappe.db.commit()
    return {"status": "success"}


@frappe.whitelist()
def toggle_published(name, published):
    if not frappe.db.exists("Nexus Chat Category", name):
        frappe.throw("Category not found.")
    frappe.db.set_value("Nexus Chat Category", name, "published", int(published))
    frappe.db.commit()
    return {"status": "success"}

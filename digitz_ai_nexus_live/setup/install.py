import frappe

from digitz_ai_nexus.setup.access_seed import seed_default_access_governance


DEFAULT_IDENTITY_TYPES = [
    {
        "title": "Public",
        "description": "Unauthenticated visitor. No login, no session. Default for all anonymous access.",
        "sort_order": 10,
    },
    {
        "title": "Customer",
        "description": "Authenticated portal or website user. Has a customer/website account.",
        "sort_order": 20,
    },
    {
        "title": "Prospect",
        "description": "Pre-sales visitor. Not yet a customer but has expressed interest.",
        "sort_order": 30,
    },
    {
        "title": "Partner",
        "description": "External partner or reseller with API or portal access.",
        "sort_order": 40,
    },
    {
        "title": "Internal",
        "description": "Internal desk user — employee or staff with a Frappe desk account.",
        "sort_order": 50,
    },
    {
        "title": "Admin",
        "description": "System administrator with System Manager role.",
        "sort_order": 60,
    },
]

DEFAULT_TENANT = {
    "tenant_code": "DIGITZ-NEXUS",
    "tenant_name": "DIGITZ AI Nexus",
    "description": "Default tenant for Nexus Live chat workflow setup and validation.",
}

DEFAULT_LIVE_CHANNEL = {
    "channel_code": "WEBSITE-CHAT",
    "channel_name": "Website Chat",
    "channel_type": "Website Chat",
    "description": "Default public website chat channel.",
}

DEFAULT_CHAT_CATEGORY = {
    "category_code": "GENERAL-SUPPORT",
    "category_label": "General Support",
    "description": "Default public chat category for testing the governed chat workflow.",
}

DEFAULT_AGENT = {
    "agent_code": "PUBLIC-AI-ASSISTANT",
    "agent_name": "Public AI Assistant",
    "display_name": "Nexus Assistant",
    "description": "Default public AI agent used by the seeded website chat flow.",
}

DEFAULT_PROFILE = {
    "behavior_prompt": (
        "You are the default Nexus Live public assistant. Answer only from approved "
        "knowledge available through the resolved access policies. If the knowledge "
        "is insufficient, say that you do not have enough approved knowledge."
    ),
    "welcome_message": "Hello. How can I help you today?",
    "fallback_message": "I do not have enough approved knowledge to answer this.",
}


def after_install():
    seed_defaults()


def seed_defaults():
    core_seed = seed_default_access_governance()
    seed_identity_types()

    tenant = ensure_default_tenant()
    channel = ensure_default_chat_channel()
    category = ensure_default_chat_category(channel)
    agent = ensure_default_agent(channel)
    profile = ensure_default_ai_agent_profile(agent)

    ensure_profile_access_category(profile, "Public Access")
    ensure_default_category_route(channel, category, "Public", profile)
    ensure_default_ecosystem(tenant, channel)

    frappe.db.commit()
    frappe.logger().info("Nexus Live defaults seeded.")

    return {
        "success": True,
        "message": "Nexus Live default chat workflow seed completed.",
        "core_seed": core_seed,
        "tenant": tenant,
        "live_channel": channel,
        "chat_category": category,
        "agent": agent,
        "ai_agent_profile": profile,
        "identity_route": {
            "channel": channel,
            "chat_category": category,
            "identity_type": "Public",
        },
    }


def seed_identity_types():
    for entry in DEFAULT_IDENTITY_TYPES:
        if frappe.db.exists("Nexus Identity Type", entry["title"]):
            doc = frappe.get_doc("Nexus Identity Type", entry["title"])
        else:
            doc = frappe.new_doc("Nexus Identity Type")
            doc.title = entry["title"]

        doc.description = entry["description"]
        doc.sort_order = entry["sort_order"]
        doc.enabled = 1
        doc.save(ignore_permissions=True)

    frappe.logger().info("Nexus Identity Types seeded.")


def ensure_default_tenant():
    name = DEFAULT_TENANT["tenant_code"]
    if frappe.db.exists("Nexus Tenant", name):
        doc = frappe.get_doc("Nexus Tenant", name)
    else:
        doc = frappe.new_doc("Nexus Tenant")
        doc.tenant_code = name

    doc.tenant_name = DEFAULT_TENANT["tenant_name"]
    doc.description = DEFAULT_TENANT["description"]
    doc.disabled = 0
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_chat_channel():
    name = DEFAULT_LIVE_CHANNEL["channel_code"]
    if frappe.db.exists("Nexus Live Channel", name):
        doc = frappe.get_doc("Nexus Live Channel", name)
    else:
        doc = frappe.new_doc("Nexus Live Channel")
        doc.channel_code = name

    doc.channel_name = DEFAULT_LIVE_CHANNEL["channel_name"]
    doc.channel_type = DEFAULT_LIVE_CHANNEL["channel_type"]
    doc.enabled = 1
    doc.public_access = 1
    doc.requires_visitor_email = 0
    doc.agent_based = 0
    doc.description = DEFAULT_LIVE_CHANNEL["description"]
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_chat_category(channel):
    name = DEFAULT_CHAT_CATEGORY["category_code"]
    if frappe.db.exists("Nexus Chat Category", name):
        doc = frappe.get_doc("Nexus Chat Category", name)
    else:
        doc = frappe.new_doc("Nexus Chat Category")
        doc.category_code = name

    doc.category_label = DEFAULT_CHAT_CATEGORY["category_label"]
    doc.channel = channel
    doc.enabled = 1
    doc.requires_authentication = 0
    doc.identity_verification_mode = "None"
    doc.allow_public_fallback = 0
    doc.display_order = 10
    doc.description = DEFAULT_CHAT_CATEGORY["description"]
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_agent(channel):
    name = DEFAULT_AGENT["agent_code"]
    if frappe.db.exists("Nexus Live Agent", name):
        doc = frappe.get_doc("Nexus Live Agent", name)
    else:
        doc = frappe.new_doc("Nexus Live Agent")
        doc.agent_code = name

    doc.agent_name = DEFAULT_AGENT["agent_name"]
    doc.display_name = DEFAULT_AGENT["display_name"]
    doc.agent_type = "AI"
    doc.agent_role = "Public Responder"
    doc.status = "Idle"
    doc.enabled = 1
    doc.visibility = "Public"
    doc.default_channel = channel
    doc.priority = 10
    doc.max_active_sessions = 10
    doc.description = DEFAULT_AGENT["description"]
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_ai_agent_profile(agent):
    existing = frappe.get_all(
        "Nexus AI Agent Profile",
        filters={"agent": agent},
        pluck="name",
        limit_page_length=1,
    )
    if existing:
        doc = frappe.get_doc("Nexus AI Agent Profile", existing[0])
    else:
        doc = frappe.new_doc("Nexus AI Agent Profile")
        doc.agent = agent

    doc.behavior_prompt = DEFAULT_PROFILE["behavior_prompt"]
    doc.tone = "Professional"
    doc.response_style = "Balanced"
    doc.welcome_message = DEFAULT_PROFILE["welcome_message"]
    doc.fallback_message = DEFAULT_PROFILE["fallback_message"]
    doc.do_not_answer_rules = "Do not invent facts. Do not answer outside approved knowledge."
    doc.default_response_mode = "chat"
    doc.knowledge_scope = "Governed"
    doc.confidence_threshold = 0.65
    doc.escalation_enabled = 1
    doc.memory_mode = "Session"
    doc.system_notes = "Seeded default profile for public website chat."
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_profile_access_category(profile, access_category):
    existing = frappe.get_all(
        "Nexus AI Agent Profile Access Category",
        filters={"ai_agent_profile": profile, "access_category": access_category},
        pluck="name",
        limit_page_length=1,
    )
    if existing:
        doc = frappe.get_doc("Nexus AI Agent Profile Access Category", existing[0])
    else:
        doc = frappe.new_doc("Nexus AI Agent Profile Access Category")
        doc.ai_agent_profile = profile
        doc.access_category = access_category

    doc.enabled = 1
    doc.priority = 10
    doc.description = "Seeded public access category for the default public AI profile."
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_category_route(channel, category, identity_type, profile):
    existing = frappe.get_all(
        "Nexus Category Identity Route",
        filters={
            "channel": channel,
            "chat_category": category,
            "identity_type": identity_type,
        },
        pluck="name",
        limit_page_length=1,
    )
    if existing:
        doc = frappe.get_doc("Nexus Category Identity Route", existing[0])
    else:
        doc = frappe.new_doc("Nexus Category Identity Route")
        doc.channel = channel
        doc.chat_category = category
        doc.identity_type = identity_type

    doc.ai_agent_profile = profile
    doc.enabled = 1
    doc.priority = 10
    doc.description = "Default public visitor route for website chat."
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_ecosystem(tenant, channel):
    ensure_nexus_master("Nexus Business Unit", "Default", "business_unit_name", tenant)
    ensure_nexus_master("Nexus Public Context", "Website Chat", "public_context_name", tenant)

    existing = frappe.get_all(
        "Nexus Ecosystem",
        filters={"tenant": tenant, "ecosystem_name": "Default Live"},
        pluck="name",
        limit_page_length=1,
    )
    if existing:
        doc = frappe.get_doc("Nexus Ecosystem", existing[0])
    else:
        doc = frappe.new_doc("Nexus Ecosystem")
        doc.tenant = tenant
        doc.ecosystem_name = "Default Live"

    doc.ecosystem_type = "Sandbox"
    doc.enabled = 1
    doc.is_default = 1
    doc.activation_status = "Configured"
    doc.default_business_unit = "Default"
    doc.default_public_context = "Website Chat"
    doc.require_approved_knowledge = 1
    doc.strict_tenant_mode = 1
    doc.default_top_k = 5
    doc.qa_enabled = 1
    doc.default_qa_channel = channel
    doc.live_chat_enabled = 1
    doc.default_chat_channel = channel
    doc.website_widget_enabled = 0
    doc.widget_title = "Nexus Assistant"
    doc.widget_welcome_message = "Hello. How can I help you today?"
    doc.testing_required_before_activation = 1
    doc.certification_status = "Not Certified"
    doc.notes = "Seeded default ecosystem for Nexus Live setup."
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_nexus_master(doctype, name, name_field, tenant=None):
    if not frappe.db.exists("DocType", doctype):
        return

    if frappe.db.exists(doctype, name):
        return

    doc = frappe.new_doc(doctype)
    doc.set(name_field, name)

    meta = frappe.get_meta(doctype)

    if meta.has_field("tenant"):
        doc.tenant = tenant

    if meta.has_field("enabled"):
        doc.enabled = 1

    doc.insert(ignore_permissions=True)

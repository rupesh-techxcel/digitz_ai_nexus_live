import json

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

DEFAULT_QA_CHANNEL = {
    "channel_code": "WEBSITE-QA",
    "channel_name": "Website Q&A",
    "channel_type": "Website Q&A",
    "description": "Default public website Q&A channel.",
}

DEFAULT_CHAT_CATEGORY = {
    "category_code": "GENERAL-SUPPORT",
    "category_label": "General Support",
    "description": "Default public chat category for testing the governed chat workflow.",
}

DEFAULT_NICKNAME_POOL = (
    "Aria\nNova\nZara\nLyra\nSage\n"
    "Echo\nFinn\nMilo\nLuca\nOrion\n"
    "Iris\nJade\nRemi\nSkye\nTaya\n"
    "Ezra\nCleo\nDemi\nHalo\nJuno\n"
    "Kira\nLena\nNoel\nPax\nVera"
)

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

DEFAULT_IDENTITY_PROFILE = {
    "profile_name": "DEFAULT-PUBLIC-PROFILE",
    "title": "Default Public Profile",
    "description": (
        "Seeded identity profile for the public access route. "
        "Maps the Public identity type with no knowledge restriction."
    ),
}


def after_install():
    seed_defaults()


def seed_defaults():
    """
    Creates platform-level infrastructure only.
    No tenant, channel, agent, or knowledge records are created here.
    Those are created on demand via dedicated seed functions in devtools/.
    """
    seed_identity_types()
    ensure_nexus_live_workspace()

    frappe.db.commit()
    frappe.logger().info("Nexus Live platform defaults seeded.")

    return {
        "success": True,
        "message": "Nexus Live platform defaults seeded.",
    }


def seed_digitz_nexus_live_foundation():
    """
    Optional manual seed for the default DIGITZ-NEXUS development tenant.

    NOT called during installation. Run from bench console when needed:

        from digitz_ai_nexus_live.setup.install import seed_digitz_nexus_live_foundation
        seed_digitz_nexus_live_foundation()
    """
    tenant = ensure_default_tenant()

    core_seed = seed_default_access_governance(tenant=tenant)

    channel          = ensure_default_chat_channel(tenant)
    qa_channel       = ensure_default_qa_channel(tenant)
    category         = ensure_default_chat_category(channel, tenant)
    profile          = ensure_default_ai_agent_profile(channel, qa_channel, tenant)
    identity_profile = ensure_default_identity_profile(tenant)

    public_access_cat = frappe.db.get_value(
        "Nexus Access Category",
        {"category_name": "Public Access", "tenant": tenant},
        "name",
    )
    if public_access_cat:
        ensure_profile_access_category(profile, public_access_cat)

    ensure_default_category_route(channel, category, profile, identity_profile)
    ensure_tenant_configuration(tenant, channel, qa_channel)

    frappe.db.commit()
    frappe.logger().info("Nexus Live DIGITZ-NEXUS foundation seeded.")

    return {
        "success": True,
        "message": "Nexus Live DIGITZ-NEXUS foundation seeded.",
        "core_seed": core_seed,
        "tenant": tenant,
        "live_channel": channel,
        "qa_channel": qa_channel,
        "chat_category": category,
        "ai_agent_profile": profile,
        "identity_profile": identity_profile,
    }


# ── Seeding helpers ───────────────────────────────────────────────────────────

def seed_identity_types():
    for entry in DEFAULT_IDENTITY_TYPES:
        if frappe.db.exists("Nexus Identity Type", entry["title"]):
            doc = frappe.get_doc("Nexus Identity Type", entry["title"])
        else:
            doc = frappe.new_doc("Nexus Identity Type")
            doc.title = entry["title"]

        doc.description = entry["description"]
        doc.sort_order   = entry["sort_order"]
        doc.enabled      = 1
        doc.save(ignore_permissions=True)

    frappe.logger().info("Nexus Identity Types seeded.")


def ensure_default_tenant():
    code     = DEFAULT_TENANT["tenant_code"]
    existing = frappe.db.get_value("Nexus Tenant", {"tenant_code": code}, "name")

    if existing:
        doc = frappe.get_doc("Nexus Tenant", existing)
    else:
        doc = frappe.new_doc("Nexus Tenant")
        doc.tenant_code = code

    doc.tenant_name = DEFAULT_TENANT["tenant_name"]
    doc.description = DEFAULT_TENANT["description"]
    doc.disabled    = 0
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_chat_channel(tenant):
    code     = DEFAULT_LIVE_CHANNEL["channel_code"]
    existing = frappe.db.get_value(
        "Nexus Live Channel", {"channel_code": code, "tenant": tenant}, "name"
    )

    if existing:
        doc = frappe.get_doc("Nexus Live Channel", existing)
    else:
        doc = frappe.new_doc("Nexus Live Channel")
        doc.channel_code = code
        doc.tenant       = tenant

    doc.channel_name         = DEFAULT_LIVE_CHANNEL["channel_name"]
    doc.channel_type         = DEFAULT_LIVE_CHANNEL["channel_type"]
    doc.enabled              = 1
    doc.public_access        = 1
    doc.requires_visitor_email = 0
    doc.agent_based          = 0
    doc.description          = DEFAULT_LIVE_CHANNEL["description"]
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_qa_channel(tenant):
    code     = DEFAULT_QA_CHANNEL["channel_code"]
    existing = frappe.db.get_value(
        "Nexus Live Channel", {"channel_code": code, "tenant": tenant}, "name"
    )

    if existing:
        doc = frappe.get_doc("Nexus Live Channel", existing)
    else:
        doc = frappe.new_doc("Nexus Live Channel")
        doc.channel_code = code
        doc.tenant       = tenant

    doc.channel_name           = DEFAULT_QA_CHANNEL["channel_name"]
    doc.channel_type           = DEFAULT_QA_CHANNEL["channel_type"]
    doc.enabled                = 1
    doc.public_access          = 1
    doc.requires_visitor_email = 0
    doc.agent_based            = 0
    doc.description            = DEFAULT_QA_CHANNEL["description"]
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_chat_category(channel, tenant):
    code     = DEFAULT_CHAT_CATEGORY["category_code"]
    existing = frappe.db.get_value(
        "Nexus Chat Category", {"category_code": code, "tenant": tenant}, "name"
    )

    if existing:
        doc = frappe.get_doc("Nexus Chat Category", existing)
    else:
        doc = frappe.new_doc("Nexus Chat Category")
        doc.category_code = code
        doc.tenant        = tenant

    doc.category_label             = DEFAULT_CHAT_CATEGORY["category_label"]
    doc.channel                    = channel
    doc.enabled                    = 1
    doc.requires_authentication    = 0
    doc.identity_verification_mode = "None"
    doc.allow_public_fallback      = 0
    doc.display_order              = 10
    doc.description                = DEFAULT_CHAT_CATEGORY["description"]
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_ai_agent_profile(channel, qa_channel=None, tenant=None):
    code     = DEFAULT_AGENT["agent_code"]
    existing = frappe.db.get_value(
        "Nexus AI Agent Profile", {"agent_code": code, "tenant": tenant}, "name"
    )

    if existing:
        doc = frappe.get_doc("Nexus AI Agent Profile", existing)
    else:
        doc = frappe.new_doc("Nexus AI Agent Profile")
        doc.agent_code = code
        if tenant:
            doc.tenant = tenant

    doc.agent_name          = DEFAULT_AGENT["agent_name"]
    doc.display_name        = DEFAULT_AGENT["display_name"]
    doc.nickname_pool       = DEFAULT_NICKNAME_POOL
    doc.agent_role          = "Public Responder"
    doc.visibility          = "Public"
    doc.enabled             = 1
    doc.status              = "Idle"
    doc.priority            = 10
    doc.max_active_sessions = 10
    doc.default_channel     = channel
    doc.description         = DEFAULT_AGENT["description"]
    doc.behavior_prompt     = DEFAULT_PROFILE["behavior_prompt"]
    doc.tone                = "Professional"
    doc.response_style      = "Balanced"
    doc.welcome_message     = DEFAULT_PROFILE["welcome_message"]
    doc.fallback_message    = DEFAULT_PROFILE["fallback_message"]
    doc.do_not_answer_rules = "Do not invent facts. Do not answer outside approved knowledge."
    doc.default_response_mode = "chat"
    doc.knowledge_scope     = "Governed"
    doc.confidence_threshold = 0.65
    doc.escalation_enabled  = 1
    doc.memory_mode         = "Session"
    doc.system_notes        = "Seeded default profile for public website chat."
    doc.save(ignore_permissions=True)

    if qa_channel and frappe.db.exists("Nexus Live Channel", qa_channel):
        qa_doc = frappe.get_doc("Nexus Live Channel", qa_channel)
        if frappe.get_meta("Nexus Live Channel").has_field("default_agent"):
            qa_doc.default_agent = doc.name
            qa_doc.save(ignore_permissions=True)

    return doc.name


def ensure_default_identity_profile(tenant=None):
    code     = DEFAULT_IDENTITY_PROFILE["profile_name"]
    existing = frappe.db.get_value(
        "Nexus Identity Profile", {"profile_name": code, "tenant": tenant}, "name"
    )

    if existing:
        doc = frappe.get_doc("Nexus Identity Profile", existing)
    else:
        doc = frappe.new_doc("Nexus Identity Profile")
        doc.profile_name = code
        if tenant:
            doc.tenant = tenant

    doc.title       = DEFAULT_IDENTITY_PROFILE["title"]
    doc.enabled     = 1
    doc.description = DEFAULT_IDENTITY_PROFILE["description"]

    has_public = any(
        row.identity_type == "Public"
        for row in (doc.identity_mappings or [])
    )
    if not has_public:
        doc.append("identity_mappings", {
            "identity_type":   "Public",
            "knowledge_profile": None,
        })

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
        doc.access_category  = access_category

    doc.enabled     = 1
    doc.priority    = 10
    doc.description = "Seeded public access category for the default public AI profile."
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_default_category_route(channel, category, profile, identity_profile=None):
    existing = frappe.get_all(
        "Nexus Category Identity Route",
        filters={"channel": channel, "chat_category": category, "is_public_route": 1},
        pluck="name",
        limit_page_length=1,
    )
    if existing:
        doc = frappe.get_doc("Nexus Category Identity Route", existing[0])
    else:
        doc = frappe.new_doc("Nexus Category Identity Route")
        doc.channel       = channel
        doc.chat_category = category

    doc.ai_agent_profile = profile
    doc.is_public_route  = 1
    doc.enabled          = 1
    doc.priority         = 10
    doc.description      = "Default public visitor route for website chat."

    if identity_profile:
        already_linked = any(
            row.identity_profile == identity_profile
            for row in (doc.identity_profiles or [])
        )
        if not already_linked:
            doc.append("identity_profiles", {"identity_profile": identity_profile})

    doc.save(ignore_permissions=True)
    return doc.name


def ensure_tenant_configuration(tenant, channel, qa_channel=None):
    ensure_nexus_master("Nexus Business Unit", "Default", "business_unit_name", tenant)

    existing = frappe.get_all(
        "Nexus Tenant Configuration",
        filters={"tenant": tenant, "configuration_name": "Default Live"},
        pluck="name",
        limit_page_length=1,
    )
    if existing:
        doc = frappe.get_doc("Nexus Tenant Configuration", existing[0])
    else:
        doc = frappe.new_doc("Nexus Tenant Configuration")
        doc.tenant              = tenant
        doc.configuration_name  = "Default Live"

    doc.ecosystem_type                  = "Sandbox"
    doc.enabled                         = 1
    doc.is_default                      = 1
    doc.activation_status               = "Configured"
    doc.default_business_unit           = "Default"
    doc.require_approved_knowledge      = 1
    doc.strict_tenant_mode              = 1
    doc.default_top_k                   = 5
    doc.qa_enabled                      = 1
    doc.default_qa_channel              = qa_channel or channel
    doc.live_chat_enabled               = 1
    doc.default_chat_channel            = channel
    doc.website_widget_enabled          = 0
    doc.widget_title                    = "Nexus Assistant"
    doc.widget_welcome_message          = "Hello. How can I help you today?"
    doc.testing_required_before_activation = 1
    doc.certification_status            = "Not Certified"
    doc.notes                           = "Seeded default ecosystem for Nexus Live setup."
    doc.save(ignore_permissions=True)
    return doc.name


def ensure_nexus_live_workspace():
    ws_name = "Nexus Live"

    shortcuts = [
        {"label": "Live Studio",       "link_to": "nexus_live_studio",       "type": "Page",    "color": "Blue"},
        {"label": "Live Console",      "link_to": "nexus_live_console",      "type": "Page",    "color": "Green"},
        {"label": "AI Agent Profile",  "link_to": "Nexus AI Agent Profile",  "type": "DocType", "color": "Orange", "doc_view": "List"},
        {"label": "Live Channel",      "link_to": "Nexus Live Channel",      "type": "DocType", "color": "Teal",   "doc_view": "List"},
        {"label": "Live Conversation", "link_to": "Nexus Live Conversation", "type": "DocType", "color": "Grey",   "doc_view": "List"},
        {"label": "Identity Registry", "link_to": "Nexus Identity Registry", "type": "DocType", "color": "Purple", "doc_view": "List"},
    ]

    links = [
        {"type": "Card Break", "label": "Administration Tools",   "hidden": 0, "link_count": 9,  "onboard": 0, "is_query_report": 0},
        {"type": "Link", "label": "Live Studio",                  "link_to": "nexus_live_studio",                   "link_type": "Page",    "hidden": 0, "onboard": 1, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Live Console",                 "link_to": "nexus_live_console",                  "link_type": "Page",    "hidden": 0, "onboard": 1, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Category Manager",             "link_to": "nexus-chat-category-manager",         "link_type": "Page",    "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Category Profile Routes",      "link_to": "nexus-category-profile-routes",       "link_type": "Page",    "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Knowledge Access Manager",     "link_to": "nexus-profile-access-allocation",     "link_type": "Page",    "hidden": 0, "onboard": 1, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Identity Registry Manager",    "link_to": "nexus-identity-registry-manager",    "link_type": "Page",    "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Verification Monitor",         "link_to": "nexus-identity-verification-monitor", "link_type": "Page",    "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "User Profile Manager",         "link_to": "nexus-user-profile-manager",          "link_type": "Page",    "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Workflow Tester",              "link_to": "nexus-chat-workflow-tester",          "link_type": "Page",    "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},

        {"type": "Card Break", "label": "Channels & Categories",  "hidden": 0, "link_count": 4,  "onboard": 0, "is_query_report": 0},
        {"type": "Link", "label": "Nexus Live Channel",           "link_to": "Nexus Live Channel",            "link_type": "DocType", "hidden": 0, "onboard": 1, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Nexus Chat Category",          "link_to": "Nexus Chat Category",           "link_type": "DocType", "hidden": 0, "onboard": 1, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Category Identity Route",      "link_to": "Nexus Category Identity Route", "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Nexus Website Widget",         "link_to": "Nexus Website Widget",          "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},

        {"type": "Card Break", "label": "AI Agents",              "hidden": 0, "link_count": 4,  "onboard": 0, "is_query_report": 0},
        {"type": "Link", "label": "AI Agent Profile",             "link_to": "Nexus AI Agent Profile",           "link_type": "DocType", "hidden": 0, "onboard": 1, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Agent Profile Instance",       "link_to": "Nexus AI Agent Profile Instance",  "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "AI Behaviour",                 "link_to": "Nexus AI Behaviour",               "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},

        {"type": "Card Break", "label": "Identity & Access",      "hidden": 0, "link_count": 6,  "onboard": 0, "is_query_report": 0},
        {"type": "Link", "label": "Identity Type",                "link_to": "Nexus Identity Type",              "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Identity Profile",             "link_to": "Nexus Identity Profile",           "link_type": "DocType", "hidden": 0, "onboard": 1, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Identity Registry",            "link_to": "Nexus Identity Registry",          "link_type": "DocType", "hidden": 0, "onboard": 1, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Knowledge Profile",            "link_to": "Knowledge Profile",                "link_type": "DocType", "hidden": 0, "onboard": 1, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Access Category",              "link_to": "Nexus Access Category",            "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "User Profile Assignment",      "link_to": "Nexus User Profile Assignment",    "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},

        {"type": "Card Break", "label": "Escalation",             "hidden": 0, "link_count": 3,  "onboard": 0, "is_query_report": 0},
        {"type": "Link", "label": "Escalation Rule",              "link_to": "Nexus Escalation Rule",            "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Agent Queue",                  "link_to": "Nexus Agent Queue",                "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Queue Assignment",             "link_to": "Nexus Queue Assignment",           "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},

        {"type": "Card Break", "label": "Conversations",          "hidden": 0, "link_count": 3,  "onboard": 0, "is_query_report": 0},
        {"type": "Link", "label": "Live Conversation",            "link_to": "Nexus Live Conversation",          "link_type": "DocType", "hidden": 0, "onboard": 1, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Live Message",                 "link_to": "Nexus Live Message",               "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Live Escalation",              "link_to": "Nexus Live Escalation",            "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},

        {"type": "Card Break", "label": "Analytics & Audit",      "hidden": 0, "link_count": 5,  "onboard": 0, "is_query_report": 0},
        {"type": "Link", "label": "Agent Activity Log",           "link_to": "Nexus Agent Activity Log",          "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Performance Snapshot",         "link_to": "Nexus Agent Performance Snapshot",  "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Conversation Outcome",         "link_to": "Nexus Conversation Outcome",        "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Conversation Feedback",        "link_to": "Nexus Conversation Feedback",       "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
        {"type": "Link", "label": "Lead Capture",                 "link_to": "Nexus Lead Capture",                "link_type": "DocType", "hidden": 0, "onboard": 0, "is_query_report": 0, "dependencies": ""},
    ]

    content = json.dumps([
        {"id": "nlws-cb",  "type": "custom-block", "data": {"custom_block_name": "nexus-live-workspace-html-block", "col": 12}},
        {"id": "nlws-sp0", "type": "spacer",   "data": {"col": 12}},
        {"id": "nlws-h1",  "type": "header",   "data": {"text": "<span class=\"h4\"><b>Quick Access</b></span>", "col": 12}},
        {"id": "nlws-s1",  "type": "shortcut", "data": {"shortcut_name": "Live Studio",       "col": 3}},
        {"id": "nlws-s2",  "type": "shortcut", "data": {"shortcut_name": "Live Console",      "col": 3}},
        {"id": "nlws-s3",  "type": "shortcut", "data": {"shortcut_name": "AI Agent Profile",  "col": 3}},
        {"id": "nlws-s4",  "type": "shortcut", "data": {"shortcut_name": "Live Channel",      "col": 3}},
        {"id": "nlws-s5",  "type": "shortcut", "data": {"shortcut_name": "Live Conversation", "col": 3}},
        {"id": "nlws-s6",  "type": "shortcut", "data": {"shortcut_name": "Identity Registry", "col": 3}},
        {"id": "nlws-sp1", "type": "spacer",   "data": {"col": 12}},
        {"id": "nlws-h2",  "type": "header",   "data": {"text": "<span class=\"h4\"><b>Configuration &amp; Setup</b></span>", "col": 12}},
        {"id": "nlws-c1",  "type": "card",     "data": {"card_name": "Administration Tools",  "col": 4}},
        {"id": "nlws-c2",  "type": "card",     "data": {"card_name": "Channels & Categories", "col": 4}},
        {"id": "nlws-c3",  "type": "card",     "data": {"card_name": "AI Agents",             "col": 4}},
        {"id": "nlws-sp2", "type": "spacer",   "data": {"col": 12}},
        {"id": "nlws-h3",  "type": "header",   "data": {"text": "<span class=\"h4\"><b>Identity, Access &amp; Escalation</b></span>", "col": 12}},
        {"id": "nlws-c4",  "type": "card",     "data": {"card_name": "Identity & Access",     "col": 4}},
        {"id": "nlws-c5",  "type": "card",     "data": {"card_name": "Escalation",            "col": 4}},
        {"id": "nlws-c6",  "type": "card",     "data": {"card_name": "Conversations",         "col": 4}},
        {"id": "nlws-sp3", "type": "spacer",   "data": {"col": 12}},
        {"id": "nlws-h4",  "type": "header",   "data": {"text": "<span class=\"h4\"><b>Analytics &amp; Audit</b></span>", "col": 12}},
        {"id": "nlws-c7",  "type": "card",     "data": {"card_name": "Analytics & Audit",     "col": 12}},
    ])

    if frappe.db.exists("Workspace", ws_name):
        doc = frappe.get_doc("Workspace", ws_name)
    else:
        doc = frappe.new_doc("Workspace")
        doc.name = ws_name

    doc.label   = ws_name
    doc.module  = "Digitz AI Nexus Live"
    doc.public  = 1
    doc.icon    = "message-square"
    doc.title   = ws_name
    doc.content = content

    doc.set("shortcuts", shortcuts)
    doc.set("links", links)

    existing_blocks = {row.custom_block_name for row in (doc.get("custom_blocks") or [])}
    if "nexus-live-workspace-html-block" not in existing_blocks:
        doc.append("custom_blocks", {
            "custom_block_name": "nexus-live-workspace-html-block",
            "label": "nexus-live-workspace-html-block",
        })

    doc.save(ignore_permissions=True)
    frappe.logger().info("Nexus Live workspace seeded.")
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

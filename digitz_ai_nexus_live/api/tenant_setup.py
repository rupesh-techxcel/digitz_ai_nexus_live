import frappe
from frappe import _

from digitz_ai_nexus.setup.access_seed import seed_default_access_governance
from digitz_ai_nexus_live.setup.install import (
    ensure_default_chat_channel,
    ensure_default_chat_category,
    ensure_default_ai_agent_profile,
    ensure_default_identity_profile,
    ensure_default_category_route,
    ensure_tenant_configuration,
)


@frappe.whitelist()
def seed_tenant_defaults(tenant):
    """
    Copy all platform defaults to a newly created tenant.
    Creates channels, categories, agent profile, identity profile,
    routing, access governance, tenant configuration, and Sales Companion.

    Called from the Nexus Tenant form button — System Manager only.
    """
    frappe.only_for("System Manager")

    if not frappe.db.exists("Nexus Tenant", tenant):
        frappe.throw(_("Tenant {0} not found.").format(tenant))

    results = {}

    # Access governance (access categories + policies)
    results["access_governance"] = seed_default_access_governance(tenant=tenant)

    # Live channel
    channel = ensure_default_chat_channel(tenant)
    results["live_channel"] = channel

    # Chat category
    category = ensure_default_chat_category(channel, tenant)
    results["chat_category"] = category

    # AI agent profile
    profile = ensure_default_ai_agent_profile(channel, tenant=tenant)
    results["ai_agent_profile"] = profile

    # Identity profile
    identity_profile = ensure_default_identity_profile(tenant)
    results["identity_profile"] = identity_profile

    # Category route
    ensure_default_category_route(channel, category, profile, identity_profile)

    # Tenant configuration
    ensure_tenant_configuration(tenant, channel)

    # Sales Companion (nexy) — optional, only if app is installed
    try:
        from digitz_ai_nexus_nexy.setup.install import seed_default_sales_companion
        results["sales_companion"] = seed_default_sales_companion(tenant=tenant)
    except ImportError:
        results["sales_companion"] = None

    frappe.db.commit()

    return {
        "success": True,
        "tenant": tenant,
        "created": results,
        "message": f"Platform defaults seeded for tenant {tenant}.",
    }

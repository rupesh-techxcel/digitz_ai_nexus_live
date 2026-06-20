no_cache = 1

import frappe


def get_context(context):
	context.sitename = frappe.local.site

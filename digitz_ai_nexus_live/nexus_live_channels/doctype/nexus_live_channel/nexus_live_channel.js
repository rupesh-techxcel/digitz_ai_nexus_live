// Copyright (c) 2026, Techxcel Technologies and contributors
// For license information, please see license.txt

frappe.ui.form.on("Nexus Live Channel", {
	refresh(frm) {
		frm.set_query("default_agent", () => {
			const filters = { enabled: 1 };
			if (frm.doc.tenant) filters.tenant = frm.doc.tenant;
			return { filters };
		});
	},

	tenant(frm) {
		// Clear default_agent if it no longer belongs to the newly selected tenant
		if (frm.doc.default_agent && frm.doc.tenant) {
			frappe.db.get_value("Nexus AI Agent Profile", frm.doc.default_agent, "tenant", (r) => {
				if (r && r.tenant !== frm.doc.tenant) {
					frm.set_value("default_agent", "");
				}
			});
		}
	},
});

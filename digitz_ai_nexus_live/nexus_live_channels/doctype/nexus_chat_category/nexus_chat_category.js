frappe.ui.form.on('Nexus Chat Category', {
    ai_agent_profile(frm) {
        if (!frm.doc.ai_agent_profile) return;

        frappe.db.get_list('Nexus AI Agent Profile Access Category', {
            filters: { ai_agent_profile: frm.doc.ai_agent_profile, enabled: 1 },
            fields: ['name'],
            limit: 1,
        }).then(rows => {
            if (!rows.length) {
                frappe.show_alert({
                    message: `Profile '${frm.doc.ai_agent_profile}' has no Access Category. Queries will be denied.`,
                    indicator: 'orange',
                }, 8);
            }
        });
    },
});

frappe.ui.form.on('Nexus User Profile Assignment', {
    ai_agent_profile(frm) {
        if (!frm.doc.ai_agent_profile) return;

        frappe.db.get_list('Nexus AI Agent Profile Access Category', {
            filters: { ai_agent_profile: frm.doc.ai_agent_profile, enabled: 1 },
            fields: ['access_category'],
        }).then(rows => {
            if (!rows.length) {
                frappe.show_alert({
                    message: `Profile '${frm.doc.ai_agent_profile}' has no Access Category. This user's queries will be denied.`,
                    indicator: 'orange',
                }, 8);
            } else {
                const cats = rows.map(r => r.access_category).join(', ');
                frappe.show_alert({
                    message: `Profile grants access via: ${cats}`,
                    indicator: 'green',
                }, 5);
            }
        });
    },
});

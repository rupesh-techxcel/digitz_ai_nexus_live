frappe.ui.form.on('Nexus Category Identity Route', {

    setup(frm) {
        frm.set_query('chat_category', () => {
            const tenant = frm.doc.tenant;
            const filters = {};
            if (tenant) filters['tenant'] = tenant;
            return { filters };
        });

        frm.set_query('ai_agent_profile', () => {
            const tenant = frm.doc.tenant;
            const filters = {};
            if (tenant) filters['tenant'] = tenant;
            return { filters };
        });
    },

    tenant(frm) {
        // Tenant changed — clear category and dependent read-only fields so
        // the user picks a category that belongs to the new tenant.
        frm.set_value('chat_category', '');
        frm.set_value('channel', '');
        frm.set_value('ai_agent_profile', '');
    },

    chat_category(frm) {
        // channel and tenant are read-only fetch_from fields — Frappe auto-fills
        // them when chat_category is set. Clear ai_agent_profile so the user
        // picks one that belongs to this category's tenant.
        if (!frm.doc.chat_category) {
            frm.set_value('ai_agent_profile', '');
        }
    },
});

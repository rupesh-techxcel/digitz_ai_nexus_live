frappe.ui.form.on('Nexus Identity Profile', {
    refresh(frm) {
        _lock_fetched_mapping_columns(frm);
    },
    onload(frm) {
        _lock_fetched_mapping_columns(frm);
    },
});

frappe.ui.form.on('Nexus Identity Profile Mapping', {
    knowledge_access_rule(frm) {
        // Trigger fetch_from manually so the row updates immediately in the grid
        frm.fields_dict['identity_mappings'].grid.grid_rows.forEach(row => {
            if (row.doc.knowledge_access_rule && (!row.doc.identity_type || !row.doc.knowledge_profile)) {
                frappe.db.get_value(
                    'Nexus Identity Knowledge Rule',
                    row.doc.knowledge_access_rule,
                    ['identity_type', 'knowledge_profile'],
                    (vals) => {
                        if (vals) {
                            frappe.model.set_value(row.doc.doctype, row.doc.name, 'identity_type', vals.identity_type);
                            frappe.model.set_value(row.doc.doctype, row.doc.name, 'knowledge_profile', vals.knowledge_profile);
                        }
                    }
                );
            }
        });
    },
});

function _lock_fetched_mapping_columns(frm) {
    const grid = frm.fields_dict['identity_mappings'] && frm.fields_dict['identity_mappings'].grid;
    if (!grid) return;
    grid.toggle_enable('identity_type', false);
    grid.toggle_enable('knowledge_profile', false);
}

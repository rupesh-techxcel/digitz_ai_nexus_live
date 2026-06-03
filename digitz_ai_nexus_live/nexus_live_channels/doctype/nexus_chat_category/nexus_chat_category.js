frappe.ui.form.on('Nexus Chat Category', {
    refresh(frm) {
        if (frm.doc.name) {
            frm.add_custom_button('Manage Routes', () => {
                frappe.set_route('Page', 'nexus-category-profile-routes');
            });
        }
    },
});

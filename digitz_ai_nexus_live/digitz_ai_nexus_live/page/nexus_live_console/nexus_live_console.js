frappe.pages['nexus_live_console'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Nexus Live Console',
		single_column: true
	});
}
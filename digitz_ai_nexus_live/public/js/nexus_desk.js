(function () {
	// Auto-expand top-level sidebar groups that have child workspaces.
	// Frappe collapses them by default; this expands them once per session.
	var _expanded = {};

	function expandSidebarItem(itemName) {
		if (_expanded[itemName]) return;
		var $item = $('[item-name="' + itemName + '"]');
		if (!$item.length) return;
		var $child = $item.find(".sidebar-child-item").first();
		if ($child.hasClass("hidden")) {
			$item.find(".drop-icon").first().trigger("click");
		}
		_expanded[itemName] = true;
	}

	function expandAll() {
		expandSidebarItem("Nexus Orbit");
		expandSidebarItem("Nexus Nexy");
	}

	$(document).on("page-change", function () {
		var allDone = _expanded["Nexus Orbit"] && _expanded["Nexus Nexy"];
		if (!allDone) {
			setTimeout(expandAll, 150);
		}
	});
})();

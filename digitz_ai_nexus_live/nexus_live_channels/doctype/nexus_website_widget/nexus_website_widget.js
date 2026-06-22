frappe.ui.form.on("Nexus Website Widget", {
	refresh(frm) {
		render_embed_snippet(frm);
		add_status_actions(frm);
	},
	widget_code(frm) {
		render_embed_snippet(frm);
	},
});

function add_status_actions(frm) {
	frm.remove_custom_button(__("Activate"));
	frm.remove_custom_button(__("Suspend"));
	frm.remove_custom_button(__("Revoke"));
	frm.remove_custom_button(__("Revert to Draft"));

	if (frm.doc.__islocal) return;

	const status = frm.doc.contract_status;

	if (status === "Active") {
		frm.add_custom_button(__("Suspend"), () => set_status(frm, "Suspended"), __("Access"));
		frm.add_custom_button(__("Revoke"), () => {
			frappe.confirm(
				__("Revoking will permanently block this widget. Are you sure?"),
				() => set_status(frm, "Revoked")
			);
		}, __("Access"));
	}

	if (status === "Suspended") {
		frm.add_custom_button(__("Activate"), () => set_status(frm, "Active"), __("Access"));
		frm.add_custom_button(__("Revoke"), () => {
			frappe.confirm(
				__("Revoking will permanently block this widget. Are you sure?"),
				() => set_status(frm, "Revoked")
			);
		}, __("Access"));
	}

	if (status === "Draft") {
		frm.add_custom_button(__("Activate"), () => set_status(frm, "Active"), __("Access"));
	}

	if (status === "Revoked") {
		frm.add_custom_button(__("Revert to Draft"), () => {
			frappe.confirm(
				__("This will reset the widget to Draft status. Continue?"),
				() => set_status(frm, "Draft")
			);
		}, __("Access"));
	}
}

function set_status(frm, new_status) {
	frappe.db.set_value("Nexus Website Widget", frm.docname, "contract_status", new_status)
		.then(() => {
			frm.reload_doc();
			frappe.show_alert({
				message: __("Access status set to {0}", [new_status]),
				indicator: status_to_color(new_status),
			});
		});
}

function status_to_color(status) {
	return { Active: "green", Draft: "yellow", Suspended: "orange", Revoked: "red" }[status] || "blue";
}

function render_embed_snippet(frm) {
	const widget_code = frm.doc.widget_code;
	const server = window.location.origin;
	const script_url = `${server}/assets/digitz_ai_nexus_live/js/nexus_external_embed.js`;

	const snippet = widget_code
		? `<script\n  src="${script_url}"\n  data-widget="${widget_code}"\n  async\n></script>`
		: "";

	const wrapper = frm.get_field("embed_snippet_html").$wrapper;
	wrapper.empty();

	if (!widget_code) {
		wrapper.html(`<p class="text-muted small">Save the widget to generate the embed snippet.</p>`);
		return;
	}

	const status = frm.doc.contract_status || "Draft";
	const color = status_to_color(status);
	const badge = `<span style="
		display:inline-block;
		padding:2px 10px;
		border-radius:20px;
		font-size:11px;
		font-weight:600;
		text-transform:uppercase;
		letter-spacing:.5px;
		background:var(--${color}-100,#e8f5e9);
		color:var(--${color}-700,#2e7d32);
		margin-bottom:10px;
	">${status}</span>`;

	wrapper.html(`
		${badge}
		<div style="position:relative;">
			<pre id="ncw-embed-snippet" style="
				background:#1e1e2e;
				color:#cdd6f4;
				border-radius:8px;
				padding:16px 20px;
				font-size:13px;
				line-height:1.6;
				white-space:pre;
				overflow-x:auto;
				margin:0;
				border:1px solid var(--border-color);
			">${frappe.utils.escape_html(snippet)}</pre>
			<button id="ncw-copy-btn" style="
				position:absolute;
				top:10px;
				right:10px;
				padding:4px 12px;
				font-size:12px;
				border:1px solid #585b70;
				border-radius:5px;
				background:#313244;
				color:#cdd6f4;
				cursor:pointer;
				font-family:inherit;
			">Copy</button>
		</div>
		<p style="margin-top:8px;font-size:12px;color:var(--text-muted);">
			Paste this tag inside the <code>&lt;body&gt;</code> of every page on the client site where the chat widget should appear.
		</p>
	`);

	wrapper.find("#ncw-copy-btn").on("click", function () {
		navigator.clipboard.writeText(snippet).then(() => {
			const btn = $(this);
			btn.text("Copied!");
			setTimeout(() => btn.text("Copy"), 2000);
		}).catch(() => {
			frappe.msgprint(__("Could not copy. Please select and copy manually."));
		});
	});
}

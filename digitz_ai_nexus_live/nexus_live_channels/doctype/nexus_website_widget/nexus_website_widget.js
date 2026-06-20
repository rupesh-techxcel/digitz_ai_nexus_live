frappe.ui.form.on("Nexus Website Widget", {
	refresh(frm) {
		render_embed_snippet(frm);
	},
	widget_code(frm) {
		render_embed_snippet(frm);
	},
});

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

	wrapper.html(`
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
			Make sure <code>${frappe.utils.escape_html(window.location.origin)}</code> is listed in <strong>Allowed Domains JSON</strong>.
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

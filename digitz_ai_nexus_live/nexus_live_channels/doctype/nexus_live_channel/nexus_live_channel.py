# Copyright (c) 2026, Techxcel Technologies and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class NexusLiveChannel(Document):
	def validate(self):
		self._validate_unique_channel_name()

	def _validate_unique_channel_name(self):
		duplicate = frappe.db.get_value(
			"Nexus Live Channel",
			{
				"channel_name": self.channel_name,
				"tenant": self.tenant,
				"name": ("!=", self.name),
			},
			"name",
		)
		if duplicate:
			frappe.throw(
				frappe._("Channel Name '{0}' already exists for tenant '{1}'.").format(
					self.channel_name, self.tenant
				),
				title=frappe._("Duplicate Channel Name"),
			)

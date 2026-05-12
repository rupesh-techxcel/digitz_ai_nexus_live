# Copilot instructions for Digitz AI Nexus Live

- This repository is a Frappe app located at `digitz_ai_nexus_live` inside a `bench` project. Most business logic lives in Python service modules, not in custom doctypes.
- The important service files are:
  - `agent_router.py`: payload parsing, role normalization, channel lookup, and best-agent selection.
  - `agent_service.py`: agent loading, availability checks, session counter updates, status transitions, and activity logging.
- The app is built around Frappe DocTypes. Key records are `Nexus Live Agent`, `Nexus Live Channel`, `Nexus Agent Activity Log`, `Nexus AI Agent Profile`, `Nexus Human Agent Profile`, and `Nexus Agent Onboarding`.
- `Nexus Live Agent` is the central model. Relevant fields used by code include `agent_code`, `agent_role`, `agent_type`, `enabled`, `status`, `visibility`, `default_channel`, `priority`, `max_active_sessions`, and `current_active_sessions`.
- Agent routing is driven by payload heuristics in `detect_required_role()` and `normalize_role()`, then by filtering agents in `find_available_agent()`.
- Session lifecycle must use `increment_active_sessions()` and `decrement_active_sessions()` to keep `current_active_sessions` and `status` consistent, and to write activity logs.
- Use Frappe ORM methods (`frappe.db.get_value`, `frappe.db.exists`, `frappe.get_doc`, `frappe.get_all`, `frappe.new_doc`) rather than inventing raw SQL.
- When saving service-side documents, follow the existing pattern of `save(ignore_permissions=True)`.
- There is no explicit API module in this app; most of the app behavior is exposed via Frappe document models and service routines.
- Development workflow:
  - Install the app with `bench get-app ...` and `bench install-app digitz_ai_nexus_live`.
  - Use `pre-commit install` and `pre-commit run --all-files` to validate formatting.
  - Use `bench --site <site> run-tests --app digitz_ai_nexus_live` for app-level tests.
- Style conventions:
  - Python formatting is enforced by `ruff` with tab indentation and a 110-character line length.
  - JavaScript linting is managed by `eslint` with Frappe-specific globals declared in `.eslintrc`.
- Do not add large new features directly inside empty auto-generated doctype classes; prefer adding reusable logic to service modules and keep doctypes as schema definitions.
- If behavior touches `Nexus Live Channel`, note that channel visibility and default agent assignment are resolved with `get_channel_name()` and `get_default_agent_for_channel()`.

If any part of the app behavior is unclear, I can refine this guide with more detail from the relevant DocType JSON or service flow.
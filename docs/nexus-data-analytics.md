# Nexus Data Analytics

`Nexus Data Analytics` stores purpose-specific visitor contact capture events from the live chat widget.

## Stored data

Each `Nexus Visitor Data Capture` record contains:

- visitor name and normalized email address;
- tenant, conversation, channel, and selected chat category when available;
- the option selected by the visitor and the reason the email was collected;
- the originating workflow event and related source record;
- verification status, permitted-use scope, and how consent was established;
- first capture and latest observation timestamps.

The deterministic capture key prevents browser retries from duplicating the same event. A different collection purpose remains a separate event, even for the same email, so future processing can respect the purpose under which data was supplied.

## Current feeds

The standard capture service is fed by:

1. a chat session created with an email already present;
2. successful category identity verification;
3. an explicit request to receive a knowledge-gap follow-up.

Use `digitz_ai_nexus_live.services.visitor_data_capture.capture_visitor_data` for future widget collection flows instead of inserting the DocType directly.

Operational identity verification and a follow-up request do not grant general marketing permission. Consumers must check `consent_status` and `consent_scope` before reusing an address.


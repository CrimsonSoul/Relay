# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Relay's React interface runs inside Electron and in Relay Web. The existing visual
system is documented in [docs/DESIGN.md](docs/DESIGN.md).

## Users

Relay is used by on-call and operations staff who assemble bridge recipients, create incident communications, manage coverage, review service health and Dynatrace Problems, and consult shared Wiki, Contacts, and Servers data. They often work under time pressure, scan dense information, and rely on keyboard-heavy workflows.

## Product Purpose

Relay is an operations command center that keeps incident communications, on-call coverage, service health, and shared operational context in one focused workspace. Success means an operator can understand current conditions, reach the right people, consult trusted guidance, and act with confidence without stitching together disconnected tools.

## Service Desk

Tickets opens the live SDP workspace on desktop. NOC, SOX, and Unassigned queues remain separate;
Unassigned means no support group regardless of technician. Work-account sign-in uses a single
administrator-configured OAuth app. SDP remains authoritative and controls each user's permissions.
Descriptions, properties, form answers, messages, notes and resolution load on demand. Tasks, worklogs and approvals have native controls. Attachments upload after review and download
through a Save dialog, with a 10 MB limit.

Operators can create tickets, update subject/description, route or unassign groups and technicians,
change status (including close/reopen), priority, type, category, impact and urgency, add notes,
and submit resolution text. The native editor follows the active template and loads custom field names, types and limits from SDP’s read-only setup API. It supports text,
multiline text, choices, checkboxes, references, numbers, date/time and date-only fields. Replies are real technician emails with reviewed recipients. Operators can
search by ticket number, link/unlink separate tickets, or merge a selected ticket into the current
one with explicit direction shown before confirmation.
Every operation shows a review before a separate **Confirm live change** action. Existing tickets
are checked again for changes before submitting; this is a best-effort conflict check, not an
atomic SDP conditional update. Failed or uncertain submissions are never automatically retried.
Template-specific required fields and exact workflow names are enforced by SDP. Major incident
creation uses the default CWGS Incident/Request template with its Major Incident checkbox checked.
It preserves the subject and collects requester, request
type, impact and urgency; the operator can set priority and support group.

Ticket navigation uses six sections, with secondary detail views grouped together. Related clearly
separates SDP ticket relationships from Dynatrace problem links; bridge preparation is a separate
More actions command. Problems keeps verified tickets visible and presents possible changes as
expandable context, with evidence and review actions available on demand.

Live ticket/problem links store only identifiers in Relay and appear in both ticket and Dynatrace
problem views. Problem-side ticket links open SDP with the user's sign-in. Bridge preparation
brings the ticket reference, meeting link and selected groups into Relay's existing composer.
Ticket text is not automatically copied into shared bridge records; preparing context never
creates a meeting or sends a message.

Queue monitoring starts automatically after work sign-in while the Tickets workspace remains
mounted and connected. The Relay server checks NOC, SOX and no-group queues for changes every
30 seconds and reconciles full queues every five minutes. Sessions of the same verified SDP user
share one job; different users retain their own credentials and results. Checks continue during
ticket editing/inspection, with at most 1,000 tickets per queue and an explicit partial-coverage
label. Users can pause monitoring. SDP errors trigger backoff; startup/recovery establishes a
fresh alert baseline. Deletions and moves out of the monitored groups can take until reconciliation.
Rules support all/any conditions for ticket ID, group, technician, priority, status, request type,
category, template and linked problems, with in-app inbox/popups, desktop notices, optional sound,
quiet hours, snooze and cooldowns. Live reply and native major-incident flag alerts are not yet
available. Live inbox contents remain in memory; desktop notices are generic. Only rule preferences
persist on the device.

Encrypted per-user server copies allow read-only access during an SDP outage while Relay remains
reachable. Copies expire after 60 minutes by default; **Clear my saved SDP data** is available only in unpackaged test builds and removes the user's
Relay copies without changing SDP. Release builds omit it. Sign-in must be repeated after expiry or server restart, and
previous read-only grants require renewed consent for create/update/delete and read-only setup scopes. Existing ticket-only grants
must reconnect to enable custom field metadata. Live ticket bodies
never enter shared PocketBase collections or client offline storage.

The synthetic workspace, sample loading and demo bridge/problem actions are removed. New
installations do not create sample ticket collections. Existing data is preserved.

The request workspace includes forwarding a ticket or an individual message, paginated request
history, checklists and their item answers, personal SDP reminders, and bulk updates of up to 20
selected tickets. Checklist definitions are selected from searchable read-only catalogs. Bulk
changes require a separate review and confirmation, report each ticket independently, and stop at
the first conflict or unconfirmed result without retrying. Forwarding starts with empty recipients
and private visibility; operators review the exact recipients and content before sending.

Tenant-specific workflow extensions are excluded from the current implementation scope. Assets,
change editing, purchasing and SDP administration remain outside the request workspace. SDP
queue monitoring automatically links workflow-created tickets after verifying their exact Dynatrace
problem URL; ambiguous matches remain manual and unlinking suppresses automatic recreation. Dynatrace
problem details can read SDP change controls and correlate affected hostnames/services with
scheduled timing. Strong host matches are associated automatically; weaker matches are suggested
with evidence. Confirm/dismiss decisions are local to the view session. Change access requires
renewed work-account consent for the read-only Changes scope. Local tests
exercise these additional operations with fixtures. Sandbox read-only responses and the Cloud
client establish their contracts; no live forwarding, reminder, checklist or bulk writes were
performed for this change, and email delivery is not claimed.

## Brand Personality

Precise, dark, tactile. Relay should feel like a serious operations console with careful craft, not a generic SaaS dashboard or a decorative marketing surface.

## Anti-references

Avoid generic SaaS card grids, landing-page composition, fake hardware motifs, beige or cream editorial styling, decorative glow effects, overly rounded controls, playful illustration, browser-default form styling, and visual flourishes that do not clarify workflow state.

## Design Principles

1. Preserve the command-console shell: black canvas, a restrained swappable accent, dense scan-friendly chrome, and a familiar sidebar-plus-header structure.
2. Make workflow state visible at the point of action: delivery confidence, recipient selection, validation, alerts, and server/runtime state should sit near the controls they affect.
3. Use sharp hierarchy, not decoration: spacing, borders, rails, type weight, and semantic color should organize information before adding new components.
4. Keep controls tactile and consistent: same button geometry, icon style, focus treatment, and disabled/loading/error states across screens.
5. Design for speed under pressure: keyboard access, readable text, high contrast, low motion, and no hidden critical actions.

## Accessibility & Inclusion

Target high-contrast dark UI with readable text, visible focus states, reduced-motion friendly transitions, and semantic state colors that are never the only indicator of meaning.

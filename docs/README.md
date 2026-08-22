# Relay documentation

## Live documentation

- [Architecture](architecture.md): runtime model, data flow, trust boundaries, and subsystem layout
- [Development](DEVELOPMENT.md): service patterns, hooks, testing, and contributor conventions
- [Design](DESIGN.md): current renderer styling and component conventions
- [Wiki administration](knowledge-base.md): Publisher workflow, links, queue recovery, retention, and offline behavior
- [Relay Web](relay-web.md): browser setup, supported experience, notifications, and network safety
- [Security](SECURITY.md): security posture, hardening, validation, and secret handling

The [screenshots](screenshots/) directory contains the current README preview assets. Git history is
the archive for completed designs, implementation plans, and retired exploratory material.

## Documentation lifecycle

Relay intentionally keeps one small, living documentation set: `AGENTS.md`, `PRODUCT.md`, and
`README.md` at the repository root; this index; and the six guides above. Update those ten files in
place instead of adding one-off plans, specifications, reports, mockups, or historical notes.

New persistent Markdown requires explicit user approval and a matching update to the documentation
contract test. Use pull requests, issues, and Git history for temporary planning and archived context.

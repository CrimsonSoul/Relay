// Migration 1: Initial schema — create all data collections
// PocketBase v0.25.x JS migration API:
//   - migrate(upFn, downFn) — both receive a transactional app instance
//   - new Collection({type, name, fields, rules}) — create collection
//   - app.save(collection) / app.delete(collection)
//   - fields are plain objects: { type, name, required, ... }

migrate(
  (app) => {
    // ── contacts ──────────────────────────────────────────────────────────
    const contacts = new Collection({
      type: "base",
      name: "contacts",
      fields: [
        { type: "text", name: "name", required: true },
        { type: "text", name: "email" },
        { type: "text", name: "phone" },
        { type: "text", name: "title" },
      ],
    });
    app.save(contacts);

    // ── servers ───────────────────────────────────────────────────────────
    const servers = new Collection({
      type: "base",
      name: "servers",
      fields: [
        { type: "text", name: "name", required: true },
        { type: "text", name: "businessArea" },
        { type: "text", name: "lob" },
        { type: "text", name: "comment" },
        { type: "text", name: "owner" },
        { type: "text", name: "contact" },
        { type: "text", name: "os" },
      ],
    });
    app.save(servers);

    // ── oncall ────────────────────────────────────────────────────────────
    const oncall = new Collection({
      type: "base",
      name: "oncall",
      fields: [
        { type: "text",   name: "team",       required: true },
        { type: "text",   name: "role" },
        { type: "text",   name: "name" },
        { type: "text",   name: "contact" },
        { type: "text",   name: "timeWindow" },
        { type: "number", name: "sortOrder" },
      ],
    });
    app.save(oncall);

    // ── bridge_groups ─────────────────────────────────────────────────────
    const bridgeGroups = new Collection({
      type: "base",
      name: "bridge_groups",
      fields: [
        { type: "text", name: "name",     required: true },
        { type: "json", name: "contacts" },
      ],
    });
    app.save(bridgeGroups);

    // ── bridge_history ────────────────────────────────────────────────────
    const bridgeHistory = new Collection({
      type: "base",
      name: "bridge_history",
      fields: [
        { type: "text",   name: "note" },
        { type: "json",   name: "groups" },
        { type: "json",   name: "contacts" },
        { type: "number", name: "recipientCount" },
      ],
    });
    app.save(bridgeHistory);

    // ── alert_history ─────────────────────────────────────────────────────
    const alertHistory = new Collection({
      type: "base",
      name: "alert_history",
      fields: [
        {
          type:      "select",
          name:      "severity",
          values:    ["ISSUE", "MAINTENANCE", "INFO", "RESOLVED"],
          maxSelect: 1,
        },
        { type: "text", name: "subject" },
        { type: "text", name: "bodyHtml" },
        { type: "text", name: "sender" },
        { type: "text", name: "recipient" },
        { type: "bool", name: "pinned" },
        { type: "text", name: "label" },
      ],
    });
    app.save(alertHistory);

    // ── notes ─────────────────────────────────────────────────────────────
    const notes = new Collection({
      type: "base",
      name: "notes",
      fields: [
        {
          type:      "select",
          name:      "entityType",
          required:  true,
          values:    ["contact", "server"],
          maxSelect: 1,
        },
        { type: "text", name: "entityKey", required: true },
        { type: "text", name: "note" },
        { type: "json", name: "tags" },
      ],
    });
    app.save(notes);

    // ── saved_locations ───────────────────────────────────────────────────
    const savedLocations = new Collection({
      type: "base",
      name: "saved_locations",
      fields: [
        { type: "text",   name: "name",      required: true },
        { type: "number", name: "lat" },
        { type: "number", name: "lon" },
        { type: "bool",   name: "isDefault" },
      ],
    });
    app.save(savedLocations);

    // ── oncall_layout ─────────────────────────────────────────────────────
    const oncallLayout = new Collection({
      type: "base",
      name: "oncall_layout",
      fields: [
        { type: "text",   name: "team",     required: true },
        { type: "number", name: "x" },
        { type: "number", name: "y" },
        { type: "number", name: "w" },
        { type: "number", name: "h" },
        { type: "bool",   name: "isStatic" },
      ],
    });
    app.save(oncallLayout);

    // ── conflict_log ──────────────────────────────────────────────────────
    const conflictLog = new Collection({
      type: "base",
      name: "conflict_log",
      fields: [
        { type: "text", name: "collection",     required: true },
        { type: "text", name: "recordId",       required: true },
        { type: "json", name: "overwrittenData", required: true },
        { type: "text", name: "overwrittenBy" },
      ],
    });
    app.save(conflictLog);
  },

  // ── down: drop all collections in reverse order ────────────────────────
  (app) => {
    const names = [
      "conflict_log",
      "oncall_layout",
      "saved_locations",
      "notes",
      "alert_history",
      "bridge_history",
      "bridge_groups",
      "oncall",
      "servers",
      "contacts",
    ];
    for (const name of names) {
      try {
        const col = app.findCollectionByNameOrId(name);
        app.delete(col);
      } catch (_) {
        // collection may not exist — safe to ignore
      }
    }
  }
);

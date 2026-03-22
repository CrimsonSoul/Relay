// Migration 2: Auth setup
//   1. Create the `users` auth collection
//   2. Lock every data collection behind @request.auth.id != ""

// Collections created in migration 1 that should require authentication.
const DATA_COLLECTIONS = [
  "contacts",
  "servers",
  "oncall",
  "bridge_groups",
  "bridge_history",
  "alert_history",
  "notes",
  "saved_locations",
  "oncall_layout",
  "conflict_log",
];

const AUTH_RULE = '@request.auth.id != ""';

migrate(
  (app) => {
    // ── 1. Create users auth collection ────────────────────────────────────
    const users = new Collection({
      type: "auth",
      name: "users",
      // Only authenticated users can list/view other users.
      // Self-management rules: update/delete only own record.
      listRule:   AUTH_RULE,
      viewRule:   AUTH_RULE,
      createRule: "",   // allow anyone to register (admin can tighten later)
      updateRule: "id = @request.auth.id",
      deleteRule: "id = @request.auth.id",
      fields: [
        // email and password are built-in to auth collections;
        // add a display name field as a convenience.
        { type: "text", name: "name" },
      ],
    });
    app.save(users);

    // ── 2. Require auth on all data collections ────────────────────────────
    for (const collectionName of DATA_COLLECTIONS) {
      const col = app.findCollectionByNameOrId(collectionName);
      col.listRule   = AUTH_RULE;
      col.viewRule   = AUTH_RULE;
      col.createRule = AUTH_RULE;
      col.updateRule = AUTH_RULE;
      col.deleteRule = AUTH_RULE;
      app.save(col);
    }
  },

  // ── down ──────────────────────────────────────────────────────────────────
  (app) => {
    // Remove auth rules from data collections
    for (const collectionName of DATA_COLLECTIONS) {
      try {
        const col = app.findCollectionByNameOrId(collectionName);
        col.listRule   = null;
        col.viewRule   = null;
        col.createRule = null;
        col.updateRule = null;
        col.deleteRule = null;
        app.save(col);
      } catch (_) {
        // collection may not exist
      }
    }

    // Delete the users collection
    try {
      const users = app.findCollectionByNameOrId("users");
      app.delete(users);
    } catch (_) {
      // already gone
    }
  }
);

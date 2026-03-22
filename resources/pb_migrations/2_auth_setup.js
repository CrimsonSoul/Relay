/* eslint-disable */
// Migration 2: Auth setup
//   1. Create the `users` auth collection
//   2. Lock every data collection behind @request.auth.id != ""

// Collections created in migration 1 that should require authentication.
const DATA_COLLECTIONS = [
  'contacts',
  'servers',
  'oncall',
  'bridge_groups',
  'bridge_history',
  'alert_history',
  'notes',
  'saved_locations',
  'oncall_layout',
  'conflict_log',
];

const AUTH_RULE = '@request.auth.id != ""';

migrate(
  (app) => {
    // ── 1. Configure the built-in users auth collection ─────────────────────
    // PocketBase v0.25+ creates a default "users" auth collection automatically.
    // We just need to update its rules rather than creating a new one.
    let users;
    try {
      users = app.findCollectionByNameOrId('users');
    } catch (_) {
      // If users collection doesn't exist (shouldn't happen), create it
      users = new Collection({
        type: 'auth',
        name: 'users',
        fields: [{ type: 'text', name: 'name' }],
      });
    }
    users.listRule = AUTH_RULE;
    users.viewRule = AUTH_RULE;
    users.createRule = ''; // allow anyone to register (admin can tighten later)
    users.updateRule = 'id = @request.auth.id';
    users.deleteRule = 'id = @request.auth.id';
    app.save(users);

    // ── 2. Require auth on all data collections ────────────────────────────
    for (const collectionName of DATA_COLLECTIONS) {
      const col = app.findCollectionByNameOrId(collectionName);
      col.listRule = AUTH_RULE;
      col.viewRule = AUTH_RULE;
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
        col.listRule = null;
        col.viewRule = null;
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
      const users = app.findCollectionByNameOrId('users');
      app.delete(users);
    } catch (_) {
      // already gone
    }
  },
);

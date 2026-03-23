# JSON to PocketBase Migration Guide

## Overview

Earlier versions of Relay stored all data as JSON files in the `userData/data/` directory. The PocketBase-enabled build replaces this with an embedded SQLite database managed by PocketBase. On first launch, Relay automatically detects and migrates your existing JSON data.

## When Migration Happens

Migration runs automatically at startup when `JsonMigrator.hasLegacyData()` detects any of these files in `userData/data/`:

- `contacts.json`
- `servers.json`
- `oncall.json`
- `bridgeGroups.json`
- `notes.json`

If none of these files are present, migration is skipped.

## What Gets Migrated

| JSON file             | PocketBase collection |
| --------------------- | --------------------- |
| `contacts.json`       | `contacts`            |
| `servers.json`        | `servers`             |
| `oncall.json`         | `oncall`              |
| `bridgeGroups.json`   | `bridge_groups`       |
| `bridgeHistory.json`  | `bridge_history`      |
| `alertHistory.json`   | `alert_history`       |
| `notes.json`          | `notes`               |
| `savedLocations.json` | `saved_locations`     |
| `oncall_layout.json`  | `oncall_layout`       |

Note: Legacy `id`, `createdAt`, `updatedAt`, and `timestamp` fields are not carried over — PocketBase assigns new IDs and timestamps.

## Before You Upgrade

**Recommended:** Back up your data directory before launching the new build.

```
# macOS
cp -r ~/Library/Application\ Support/Relay/data/ ~/Desktop/relay-data-backup/

# Windows
xcopy "%APPDATA%\Relay\data" "%USERPROFILE%\Desktop\relay-data-backup\" /E /I
```

## What Happens During Migration

1. A `pre-migration-backup/` directory is created inside `userData/data/` and all JSON files are copied into it.
2. Each collection is migrated in batches of 30 records.
3. On success, the original JSON file is renamed to `<filename>.migrated` (e.g., `contacts.json` → `contacts.json.migrated`).
4. Progress and any errors are written to the migration logger (see `userData/logs/`).

Migration is **fault-tolerant**: if one collection fails, the others continue. Failed collections are logged and left untouched for inspection.

Migration is also **idempotent**: if a JSON file has not been renamed to `.migrated` yet (e.g., after a partial migration), the migrator clears the corresponding PocketBase collection and re-imports it on the next launch.

## After Migration

- Open Relay and verify your contacts, servers, on-call schedules, and other data appear correctly.
- The `.migrated` files and `pre-migration-backup/` directory are kept as a safety net and can be deleted once you have confirmed everything looks correct.

## Rolling Back

If you need to revert to the pre-PocketBase version of Relay:

1. Reinstall or relaunch the older (non-PB) build.
2. For any collection that completed migration, rename the `.migrated` file back to `.json`:
   ```
   # Example
   mv contacts.json.migrated contacts.json
   ```
3. The older build will read the JSON files as normal.

## Troubleshooting

**Where are the logs?**
Check `userData/logs/` for files prefixed with `migration`. Errors include the collection name and the underlying exception message.

**Some data is missing after migration.**
Check the migration log for `Failed to migrate <file>` entries. The affected JSON file will still be present (not renamed). You can re-trigger migration by relaunching the app — the migrator will retry any collection whose source file remains un-renamed.

**Migration appears to hang.**
Large datasets are processed in 30-record parallel batches against the local PocketBase process. If the app is unresponsive for more than a minute, check the log for the last successfully migrated collection and report the issue.

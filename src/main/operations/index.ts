/**
 * Operations Module Index
 *
 * Re-exports all operation modules for convenient importing.
 */

export * from "./FileContext";
// Note: GroupOperations.ts is the legacy CSV-based groups.csv system
// The new JSON-based BridgeGroup system is in PresetOperations.ts (getGroups, saveGroup, etc.)
export * from "./GroupImportOperations";
export * from "./ContactOperations";
export * from "./ContactImportOperations";
export * from "./ServerOperations";
export * from "./ServerParser";
export * from "./ServerImportOperations";
export * from "./ServerCleanup";
export * from "./BackupOperations";
export * from "./PresetOperations";
export * from "./BridgeHistoryOperations";
export * from "./NotesOperations";
export * from "./SavedLocationOperations";
// JSON-based data operations
export * from "./ContactJsonOperations";
export * from "./ServerJsonOperations";
export * from "./OnCallJsonOperations";
export * from "./MigrationOperations";
export * from "./DataExportOperations";
export * from "./DataImportOperations";

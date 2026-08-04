import PocketBase from 'pocketbase';
import { RELAY_PRIVILEGED_ACCOUNTS_COLLECTION } from '@shared/privilegedAccess';
import { loggers } from '../../logger';
import {
  AUTODATE_FIELDS,
  DEFAULT_AUTH_RULES,
  PRIVILEGED_ACCOUNT_OPERATOR_INDEX,
  PRIVILEGED_ACCOUNT_USERNAME_INDEX,
} from './collectionCatalog';
import type {
  AuthCollectionOptions,
  CollectionDef,
  CollectionRules,
  ExistingCollection,
  FieldDef,
} from './collectionTypes';

const logger = loggers.pocketbase;

function managedFieldsForDefinition(definition: CollectionDef): FieldDef[] {
  return definition.type === 'auth'
    ? [...definition.fields]
    : [...definition.fields, ...AUTODATE_FIELDS];
}

function serializeManagedFields(
  definition: CollectionDef,
  collectionIds: ReadonlyMap<string, string>,
): FieldDef[] {
  return managedFieldsForDefinition(definition).map((field) => {
    const { targetCollectionName, ...serialized } = field;
    if (!targetCollectionName) return serialized;
    const collectionId = collectionIds.get(targetCollectionName);
    if (!collectionId) {
      throw new Error(
        `Cannot resolve relation ${definition.name}.${field.name} to ${targetCollectionName}`,
      );
    }
    return { ...serialized, collectionId };
  });
}

function fieldValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every((value, index) => value === expected[index])
    );
  }
  if (expected === false && actual === undefined) return true;
  return actual === expected;
}

export function reconcileManagedFields(
  fields: FieldDef[],
  expectedSchemaFields: FieldDef[],
): { fields: FieldDef[]; added: FieldDef[]; changed: FieldDef[] } {
  const expectedByName = new Map(expectedSchemaFields.map((field) => [field.name, field]));
  const added = expectedSchemaFields.filter(
    (expected) => !fields.some((field) => field.name === expected.name),
  );
  const changed: FieldDef[] = [];
  const reconciled = fields.map((field) => {
    const expected = expectedByName.get(field.name);
    if (!expected) return field;
    const differs = Object.entries(expected).some(
      ([key, expectedValue]) => !fieldValueMatches(field[key as keyof FieldDef], expectedValue),
    );
    if (!differs) return field;
    const replacement = { ...field, ...expected };
    changed.push(replacement);
    return replacement;
  });
  return { fields: [...reconciled, ...added], added, changed };
}

function passwordAuthMatches(
  actual: AuthCollectionOptions['passwordAuth'] | undefined,
  expected: AuthCollectionOptions['passwordAuth'],
): boolean {
  return (
    actual?.enabled === expected.enabled &&
    Array.isArray(actual?.identityFields) &&
    actual.identityFields.length === expected.identityFields.length &&
    actual.identityFields.every((field, index) => field === expected.identityFields[index])
  );
}

function hasCompleteCollectionSnapshot(
  collection: ExistingCollection,
  expectedAuth?: AuthCollectionOptions,
): boolean {
  if (!Array.isArray(collection.fields) || !Array.isArray(collection.indexes)) return false;
  for (const rule of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'] as const) {
    if (!Object.hasOwn(collection, rule)) return false;
  }
  if (!expectedAuth) return true;
  return (
    Object.hasOwn(collection, 'authRule') &&
    Object.hasOwn(collection, 'manageRule') &&
    typeof collection.passwordAuth?.enabled === 'boolean' &&
    Array.isArray(collection.passwordAuth.identityFields)
  );
}

function buildAuthPatch(
  colFull: ExistingCollection,
  expectedAuth?: AuthCollectionOptions,
): Partial<AuthCollectionOptions> {
  if (!expectedAuth) return {};
  const authPatch: Partial<AuthCollectionOptions> = {};
  if (colFull.authRule !== expectedAuth.authRule) authPatch.authRule = expectedAuth.authRule;
  if (colFull.manageRule !== expectedAuth.manageRule)
    authPatch.manageRule = expectedAuth.manageRule;
  if (!passwordAuthMatches(colFull.passwordAuth, expectedAuth.passwordAuth)) {
    authPatch.passwordAuth = expectedAuth.passwordAuth;
  }
  return authPatch;
}

function reconcileManagedIndexes(
  colName: string,
  indexes: string[],
  expectedIndexes: string[],
): { indexes: string[]; changed: boolean; added: number } {
  const initiallyRetainedIndexes =
    colName === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION &&
    expectedIndexes.includes(PRIVILEGED_ACCOUNT_USERNAME_INDEX)
      ? indexes.filter((index) => index !== PRIVILEGED_ACCOUNT_OPERATOR_INDEX)
      : indexes;
  const expectedByName = new Map(
    expectedIndexes.map((index) => [managedIndexName(index), index] as const),
  );
  const retainedIndexes = initiallyRetainedIndexes.filter((index) => {
    const expected = expectedByName.get(managedIndexName(index));
    return expected === undefined || expected === index;
  });
  const missingIndexes = expectedIndexes.filter((index) => !retainedIndexes.includes(index));
  return {
    indexes: [...retainedIndexes, ...missingIndexes],
    changed: retainedIndexes.length !== indexes.length || missingIndexes.length > 0,
    added: missingIndexes.length,
  };
}

function managedIndexName(definition: string): string {
  return /\bINDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i.exec(definition)?.[1] ?? definition;
}

type PatchCollectionDefinitionOptions = Readonly<{
  pb: PocketBase;
  colId: string;
  colName: string;
  expectedSchemaFields: FieldDef[];
  expectedIndexes?: string[];
  expectedRules?: CollectionRules;
  expectedAuth?: AuthCollectionOptions;
  snapshot?: ExistingCollection;
}>;

/** Patch a single collection to add missing fields and enforce API rules. Returns true if patched. */
async function patchCollectionDefinition({
  pb,
  colId,
  colName,
  expectedSchemaFields,
  expectedIndexes = [],
  expectedRules = DEFAULT_AUTH_RULES,
  expectedAuth,
  snapshot,
}: PatchCollectionDefinitionOptions): Promise<boolean> {
  const colFull =
    snapshot ?? ((await pb.collections.getOne(colId)) as unknown as ExistingCollection);
  const fields = colFull.fields || [];
  const reconciledFields = reconcileManagedFields(fields, expectedSchemaFields);
  const indexes = colFull.indexes || [];
  const reconciledIndexes = reconcileManagedIndexes(colName, indexes, expectedIndexes);
  const rulesPatch = Object.fromEntries(
    Object.entries(expectedRules).filter(([key, value]) => {
      return colFull[key as keyof CollectionRules] !== value;
    }),
  );
  const authPatch = buildAuthPatch(colFull, expectedAuth);

  if (
    reconciledFields.added.length === 0 &&
    reconciledFields.changed.length === 0 &&
    !reconciledIndexes.changed &&
    Object.keys(rulesPatch).length === 0 &&
    Object.keys(authPatch).length === 0
  ) {
    return false;
  }

  await pb.collections.update(colId, {
    ...(reconciledFields.added.length > 0 || reconciledFields.changed.length > 0
      ? { fields: reconciledFields.fields }
      : {}),
    ...(reconciledIndexes.changed ? { indexes: reconciledIndexes.indexes } : {}),
    ...rulesPatch,
    ...authPatch,
  });

  if (reconciledFields.added.length > 0) {
    logger.info(
      `Patched fields on collection: ${colName} (+${reconciledFields.added.map((f) => f.name).join(', ')})`,
    );
  }
  if (reconciledFields.changed.length > 0) {
    logger.info(
      `Updated field definitions on collection: ${colName} (${reconciledFields.changed.map((f) => f.name).join(', ')})`,
    );
  }
  if (Object.keys(rulesPatch).length > 0) {
    logger.info(`Patched API rules on collection: ${colName}`);
  }
  if (reconciledIndexes.changed) {
    logger.info(`Patched indexes on collection: ${colName} (+${reconciledIndexes.added})`);
  }
  if (Object.keys(authPatch).length > 0) {
    logger.info(`Patched authentication options on collection: ${colName}`);
  }
  return true;
}

/**
 * Create or patch managed collections in declaration order.
 *
 * PocketBase validates collection rules when they are saved. Processing each
 * definition completely before moving to the next one ensures that rules on a
 * new dependent collection can reference fields added to an older collection
 * during the same startup migration.
 */
async function createManagedCollection(
  pb: PocketBase,
  def: CollectionDef,
  existing: Set<string>,
  collectionIds: Map<string, string>,
): Promise<void> {
  try {
    const createdCollection = await pb.collections.create({
      name: def.name,
      type: def.type,
      fields: serializeManagedFields(def, collectionIds),
      ...(def.indexes ? { indexes: def.indexes } : {}),
      ...(def.rules ?? DEFAULT_AUTH_RULES),
      ...def.auth,
    });
    const createdId = (createdCollection as unknown as { id?: unknown }).id;
    if (typeof createdId !== 'string' || !createdId) {
      throw new Error(`PocketBase did not return an ID for collection: ${def.name}`);
    }
    collectionIds.set(def.name, createdId);
    existing.add(def.name);
    logger.info(`Created collection: ${def.name}`);
  } catch (err) {
    logger.error(`Failed to create collection: ${def.name}`, { error: err });
    throw new Error(`Failed to create collection: ${def.name}`, { cause: err });
  }
}

type PatchManagedCollectionOptions = Readonly<{
  /**
   * Reuse the listing snapshot instead of re-reading the collection. Only safe
   * before anything in the same run has patched it: a stale snapshot omits the
   * fields PocketBase created during an earlier patch, and re-sending those
   * fields without the ids PocketBase assigned them drops and recreates their
   * columns — silently discarding every value already written to them.
   */
  reuseSnapshot?: boolean;
}>;

export async function patchManagedCollection(
  pb: PocketBase,
  def: CollectionDef,
  allCols: ExistingCollection[],
  collectionIds: ReadonlyMap<string, string>,
  options: PatchManagedCollectionOptions = {},
): Promise<boolean> {
  const col = allCols.find((candidate) => candidate.name === def.name);
  if (!col) return false;
  const reuseSnapshot = options.reuseSnapshot ?? true;
  try {
    return await patchCollectionDefinition({
      pb,
      colId: col.id,
      colName: def.name,
      expectedSchemaFields: serializeManagedFields(def, collectionIds),
      expectedIndexes: def.indexes,
      expectedRules: def.rules ?? DEFAULT_AUTH_RULES,
      expectedAuth: def.auth,
      snapshot: reuseSnapshot && hasCompleteCollectionSnapshot(col, def.auth) ? col : undefined,
    });
  } catch (err) {
    logger.error(`Failed to patch fields on: ${def.name}`, { error: err });
    throw new Error(`Failed to patch collection: ${def.name}`, { cause: err });
  }
}

export async function ensureManagedCollections(
  pb: PocketBase,
  existing: Set<string>,
  allCols: ExistingCollection[],
  collectionIds: Map<string, string>,
  definitions: readonly CollectionDef[],
): Promise<{ created: number; patched: number }> {
  let created = 0;
  let patched = 0;
  for (const def of definitions) {
    if (!existing.has(def.name)) {
      await createManagedCollection(pb, def, existing, collectionIds);
      created++;
      continue;
    }

    if (await patchManagedCollection(pb, def, allCols, collectionIds)) patched++;
  }
  return { created, patched };
}

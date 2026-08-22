export interface FieldDef {
  id?: string;
  type: string;
  name: string;
  required?: boolean;
  values?: string[];
  maxSelect?: number;
  max?: number;
  onCreate?: boolean;
  onUpdate?: boolean;
  maxSize?: number;
  mimeTypes?: string[];
  protected?: boolean;
  collectionId?: string;
  cascadeDelete?: boolean;
  /** Internal dependency name. It is resolved to collectionId before PocketBase sees the field. */
  targetCollectionName?: string;
}

export interface CollectionDef {
  name: string;
  type: 'base' | 'auth';
  fields: FieldDef[];
  indexes?: string[];
  rules?: CollectionRules;
  auth?: AuthCollectionOptions;
}

export type CollectionBootstrapResult =
  { privilegedRuntimeReady: true } | { privilegedRuntimeReady: false; reason: string };

export type AuthCollectionOptions = {
  authRule: string | null;
  manageRule: string | null;
  passwordAuth: {
    enabled: boolean;
    identityFields: string[];
  };
};

export type CollectionRules = {
  listRule: string | null;
  viewRule: string | null;
  createRule: string | null;
  updateRule: string | null;
  deleteRule: string | null;
};

export type ExistingCollection = {
  id: string;
  name: string;
  fields?: FieldDef[];
  indexes?: string[];
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
  authRule?: string | null;
  manageRule?: string | null;
  passwordAuth?: {
    enabled: boolean;
    identityFields: string[];
  };
};

export const RELAY_OPERATORS_COLLECTION = 'relay_operators';
export const MAX_OPERATOR_DISPLAY_NAME_LENGTH = 120;
export const INITIAL_RELAY_OPERATOR_NAMES = [
  'Ryan Bell',
  'Tristan Stillwell',
  'Vlad McCarty',
  'Paris Carlson',
  'Connor McElroy',
  'Weston Yokley',
  'Charles Gibbs',
] as const;

export type RelayOperatorRecord = {
  id: string;
  displayName: string;
  active: boolean;
  created: string;
  updated: string;
};

export type OperatorAttribution = {
  operatorId: string;
  operatorName: string;
};

export function normalizeOperatorDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function getOperatorDisplayNameError(value: string): string | null {
  const normalized = normalizeOperatorDisplayName(value);
  if (!normalized) return 'Enter an operator display name.';
  if (normalized.length > MAX_OPERATOR_DISPLAY_NAME_LENGTH) {
    return `Operator display names can be up to ${MAX_OPERATOR_DISPLAY_NAME_LENGTH} characters.`;
  }
  return null;
}

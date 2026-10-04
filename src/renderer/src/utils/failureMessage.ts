/**
 * Copy for a failed operator action. Every routine error toast reads the same way: what failed
 * (naming the object), why when Relay knows, what happened to the operator's data, and the next
 * step — "Couldn't save Leadership. The Relay server didn't respond. Nothing changed. Try again."
 */
export interface FailureCopy {
  /** What failed, naming the object when there is one: "Couldn't save Leadership". */
  what: string;
  /** The thrown error or IPC error string. Unknown or empty causes are left out. */
  error?: unknown;
  /** What happened to the data, e.g. "Nothing changed." Only state what the code path guarantees. */
  outcome?: string;
  /** The next step for the operator. */
  next?: string;
}

const SERVER_UNREACHABLE = "The Relay server didn't respond";
const GENERIC_PB_MESSAGES: Record<string, true> = {
  'Failed to create record.': true,
  'Failed to update record.': true,
  'Failed to delete record.': true,
  'Something went wrong while processing your request.': true,
  'Unknown error': true,
};

type ResponseErrorLike = {
  status?: unknown;
  isAbort?: unknown;
  response?: { data?: Record<string, { message?: unknown } | undefined> };
};

/** PocketBase reports per-field validation failures under `response.data`; the first is the cause. */
function firstFieldMessage(error: ResponseErrorLike): string | undefined {
  const fields = error.response?.data;
  if (!fields || typeof fields !== 'object') return undefined;
  for (const field of Object.values(fields)) {
    if (typeof field?.message === 'string' && field.message.trim()) return field.message;
  }
  return undefined;
}

function isServerUnreachable(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  if (typeof error !== 'object' || error === null) return false;
  const response = error as ResponseErrorLike;
  return response.status === 0 && response.isAbort !== true;
}

/** The operator-readable cause of a failure, or undefined when Relay has nothing useful to say. */
export function failureCause(error: unknown): string | undefined {
  if (isServerUnreachable(error)) return SERVER_UNREACHABLE;
  if (typeof error === 'string') return error.trim() || undefined;
  if (!(error instanceof Error)) return undefined;
  const fieldMessage = firstFieldMessage(error as ResponseErrorLike);
  if (fieldMessage) return fieldMessage;
  const message = error.message.trim();
  return message && !GENERIC_PB_MESSAGES[message] ? message : undefined;
}

function asSentence(text: string): string {
  const trimmed = text.trim();
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

export function formatFailure({ what, error, outcome, next = 'Try again.' }: FailureCopy): string {
  const cause = failureCause(error);
  return [what, cause, outcome, next]
    .filter((part): part is string => Boolean(part?.trim()))
    .map(asSentence)
    .join(' ');
}

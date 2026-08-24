const PROBATION_ARGUMENT_PREFIX = '--relay-recovery-probation=';
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type RecoveryProbationArgument =
  { requested: false } | { requested: true; transactionId: string | null };

export function parseRecoveryProbationArgument(
  argv: readonly string[] = process.argv,
): RecoveryProbationArgument {
  const values = argv.filter((argument) => argument.startsWith(PROBATION_ARGUMENT_PREFIX));
  if (values.length === 0) return { requested: false };
  if (values.length !== 1) return { requested: true, transactionId: null };
  const transactionId = values[0]!.slice(PROBATION_ARGUMENT_PREFIX.length);
  return {
    requested: true,
    transactionId: UUID_V4_PATTERN.test(transactionId) ? transactionId : null,
  };
}

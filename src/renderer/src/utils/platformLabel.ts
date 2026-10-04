/** Upper-case platform family label for a server OS string; identity colours live in utils/colors. */
export const getPlatformLabel = (os: string = ''): string => {
  const lower = os.toLowerCase();
  // Word-start match so "Darwin" isn't read as Windows.
  if (/(?:^|[^a-z])win/.test(lower)) return 'WINDOWS';
  if (['lin', 'rhel', 'ubuntu', 'centos'].some((family) => lower.includes(family))) return 'LINUX';
  if (lower.includes('vmware') || lower.includes('esx')) return 'VMWARE';
  return os.toUpperCase() || 'UNKNOWN';
};

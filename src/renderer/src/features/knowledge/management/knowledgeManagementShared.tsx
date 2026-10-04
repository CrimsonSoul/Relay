export function formatDate(value: string | null): string {
  if (!value) return 'Unknown time';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

export function EmptyPanel({ children }: Readonly<{ children: string }>) {
  return <div className="knowledge-management-empty">{children}</div>;
}

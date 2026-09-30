import { getDynatraceCustomDqlMatcherError, validWorkflowDqlTask } from '@shared/dynatraceProblems';

const ACTION = 'dynatrace.automations:execute-dql-query';
const unsupported = () =>
  new Error(
    'Workflow DQL cannot be followed safely. Use a static fetch events query with per-event filters before any fields, sort, limit or summarize commands, or turn off Follow workflow DQL.',
  );

function quotedEnd(query: string, start: number): number {
  let i = start + 1;
  while (i < query.length) {
    if (query[i] === '\\') i += 2;
    else if (query[i] === query[start]) return i + 1;
    else i++;
  }
  throw unsupported();
}

function assertStaticQuery(query: string): void {
  if (
    query.length > 100_000 ||
    query.includes('{{') ||
    query.includes('{%') ||
    query.includes('"""')
  )
    throw unsupported();
}

function blockCommentEnd(query: string, start: number): number {
  const end = query.indexOf('*/', start + 2);
  if (end < 0) throw unsupported();
  return end + 2;
}

/** Split a static query without treating quoted pipes or comments as commands. */
function commands(query: string): string[] {
  assertStaticQuery(query);
  const parts: string[] = [];
  let part = '';
  let i = 0;
  while (i < query.length) {
    const c = query[i]!;
    if (['"', '`'].includes(c)) {
      const end = quotedEnd(query, i);
      part += query.slice(i, end);
      i = end;
    } else if (query.startsWith('//', i)) {
      const end = query.indexOf('\n', i);
      i = end < 0 ? query.length : end + 1;
      part += '\n';
    } else if (query.startsWith('/*', i)) {
      i = blockCommentEnd(query, i);
      part += ' ';
    } else {
      if (c === '|') {
        parts.push(part.trim());
        part = '';
      } else part += c;
      i++;
    }
  }
  parts.push(part.trim());
  return parts;
}

function validSource(source: string): boolean {
  const [fetch, ...options] = source.split(',').map((value) => value.trim());
  return (
    /^fetch\s+events$/i.test(fetch ?? '') &&
    options.every((option) => /^(?:from|to)\s*:\s*-?\d+[smhdw]$/i.test(option))
  );
}

export function workflowQueryMatcher(query: string): string {
  const [source, ...pipeline] = commands(query);
  if (!validSource(source ?? '')) throw unsupported();
  const filters: string[] = [];
  let projection = false;
  for (const command of pipeline) {
    const filter = /^filter\s/i.test(command) ? command.slice(7).trim() : undefined;
    if (filter && !projection) filters.push(filter.trim());
    else if (/^(?:fields|sort|limit|summarize)\s+\S/i.test(command)) projection = true;
    else throw unsupported();
  }
  if (!filters.length) throw unsupported();
  const matcher =
    filters.length === 1 ? filters[0]! : filters.map((filter) => `(\n${filter}\n)`).join('\nand\n');
  if (getDynatraceCustomDqlMatcherError(matcher)) throw unsupported();
  return matcher;
}

export function workflowDqlSource(
  tasks: unknown,
  selected: string,
): { task: string; matcher: string } {
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) throw unsupported();
  const queries = Object.entries(tasks).flatMap(([name, value]) => {
    if (!validWorkflowDqlTask(name) || !name || !value || typeof value !== 'object') return [];
    const task = value as { action?: unknown; active?: unknown; input?: { query?: unknown } };
    return task.action === ACTION && task.active !== false && typeof task.input?.query === 'string'
      ? [{ name, query: task.input.query }]
      : [];
  });
  if (selected) {
    const chosen = queries.find(({ name }) => name === selected);
    if (!chosen)
      throw new Error(
        'The selected workflow DQL task is missing or inactive. Choose its replacement in Relay Settings.',
      );
    return { task: chosen.name, matcher: workflowQueryMatcher(chosen.query) };
  }
  const suitable = queries.flatMap(({ name, query }) => {
    try {
      return [{ task: name, matcher: workflowQueryMatcher(query) }];
    } catch {
      return [];
    }
  });
  if (suitable.length === 1) return suitable[0]!;
  if (suitable.length > 1)
    throw new Error(
      `Several workflow DQL tasks are suitable. Enter a task name in Relay Settings: ${suitable
        .map(({ task }) => task)
        .join(', ')
        .slice(0, 300)}`,
    );
  throw unsupported();
}

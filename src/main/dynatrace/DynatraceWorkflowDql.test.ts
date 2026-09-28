import { describe, expect, it } from 'vitest';
import { workflowDqlSource, workflowQueryMatcher } from './DynatraceWorkflowDql';
const task = (query: string) => ({
  action: 'dynatrace.automations:execute-dql-query',
  input: { query },
});

describe('workflow task filter extraction', () => {
  it('combines filters while preserving quoted text, and strips comments', () => {
    expect(
      workflowQueryMatcher(
        'fetch events, from:-5m\n// scope\n| filter event.kind == "DAVIS_PROBLEM"\n| filter contains(event.name, "a|b//c") /* note */\n| fields event.id\n| limit 10',
      ),
    ).toBe('(\nevent.kind == "DAVIS_PROBLEM"\n)\nand\n(\ncontains(event.name, "a|b//c")\n)');
  });
  it.each([
    'fetch logs | filter severity == "ERROR"',
    'fetch events | fieldsAdd x=1 | filter x == 1',
    'fetch events | filter event.id == "{{ event()[\'event.id\'] }}"',
    'fetch events | filter a == 1 | limit 1 | filter b == 2',
    'fetch events | filter a in [fetch secrets]',
    'fetch events, samplingRatio:100 | filter a == 1',
    'fetch events | filter a == "unclosed',
    'fetch events | filter a == 1 /* unclosed',
    'fetch events',
  ])('refuses to guess the meaning of %s', (query) => {
    expect(() => workflowQueryMatcher(query)).toThrow('cannot be followed safely');
  });
  it('discovers the sole suitable task and ignores unrelated actions', () => {
    expect(
      workflowDqlSource(
        {
          logs: task('fetch logs | filter a == 1'),
          noc: task('fetch events | filter a == 1'),
          mail: { action: 'email', input: { query: 'anything' } },
        },
        '',
      ),
    ).toEqual({ task: 'noc', matcher: 'a == 1' });
  });
  it('requires an explicit choice when several tasks qualify and pins that task', () => {
    const tasks = {
      first: task('fetch events | filter a == 1'),
      second: task('fetch events | filter a == 2'),
    };
    expect(() => workflowDqlSource(tasks, '')).toThrow('first, second');
    expect(workflowDqlSource(tasks, 'second').matcher).toBe('a == 2');
    expect(() => workflowDqlSource({ first: tasks.first }, 'second')).toThrow(
      'missing or inactive',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../alertUtils';
import { ALERT_GUIDE_TEMPLATES, type AlertGuideTemplate } from '../guideTemplates';

function blocksOf(template: AlertGuideTemplate) {
  const body = new DOMParser().parseFromString(template.bodyHtml, 'text/html').body;
  const select = (selector: string) => body.querySelectorAll(`:scope > ${selector}`).length;
  return {
    steps: select('[data-relay-block="step"]'),
    notes: select('[data-tone="note"]'),
    warnings: select('[data-tone="warning"]'),
    successes: select('[data-tone="success"]'),
    buttons: select('[data-relay-block="button"]'),
    headings: Array.from(body.querySelectorAll(':scope > h2'), (heading) => heading.textContent),
  };
}

const template = (id: AlertGuideTemplate['id']) =>
  ALERT_GUIDE_TEMPLATES.find((candidate) => candidate.id === id)!;

describe('ALERT_GUIDE_TEMPLATES', () => {
  it('offers the three guides with their suggested severities', () => {
    expect(ALERT_GUIDE_TEMPLATES.map(({ label, severity }) => [label, severity])).toEqual([
      ['How-to guide', 'INFO'],
      ['Maintenance notice', 'MAINTENANCE'],
      ['Known issue + workaround', 'INFO'],
    ]);
  });

  it.each(ALERT_GUIDE_TEMPLATES.map((guide) => [guide.label, guide] as const))(
    'stores %s exactly as the sanitizer keeps it',
    (_label, guide) => {
      expect(sanitizeHtml(guide.bodyHtml)).toBe(guide.bodyHtml);
      expect(guide.subject.trim()).not.toBe('');
    },
  );

  it('builds the how-to guide from three steps, an expected result and a button', () => {
    expect(blocksOf(template('how-to'))).toMatchObject({ steps: 3, successes: 1, buttons: 1 });
    expect(template('how-to').bodyHtml).toContain('href="https://example.com/"');
  });

  it('builds the maintenance notice around a warning', () => {
    expect(blocksOf(template('maintenance'))).toMatchObject({
      warnings: 1,
      headings: ["What's happening"],
    });
  });

  it('builds the known issue from a note, two steps and an expected result', () => {
    expect(blocksOf(template('known-issue'))).toMatchObject({
      notes: 1,
      steps: 2,
      successes: 1,
      headings: ['Symptoms', 'Workaround'],
    });
  });
});

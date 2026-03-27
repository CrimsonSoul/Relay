import { describe, it, expect } from 'vitest';
import { parseNoteContent } from '../noteContentParser';

describe('parseNoteContent', () => {
  it('should parse plain text lines', () => {
    const result = parseNoteContent('Hello world');
    expect(result).toEqual([{ id: 'text-0', type: 'text', text: 'Hello world' }]);
  });

  it('should parse empty lines as text', () => {
    const result = parseNoteContent('Line 1\n\nLine 3');
    expect(result).toEqual([
      { id: 'text-0', type: 'text', text: 'Line 1' },
      { id: 'text-1', type: 'text', text: '' },
      { id: 'text-2', type: 'text', text: 'Line 3' },
    ]);
  });

  it('should parse bullet items', () => {
    const result = parseNoteContent('- Check replication lag');
    expect(result).toEqual([{ id: 'bullet-0', type: 'bullet', text: 'Check replication lag' }]);
  });

  it('should parse numbered items', () => {
    const result = parseNoteContent('1. First step\n2. Second step');
    expect(result).toEqual([
      { id: 'numbered-0', type: 'numbered', number: '1', text: 'First step' },
      { id: 'numbered-1', type: 'numbered', number: '2', text: 'Second step' },
    ]);
  });

  it('should parse mixed content', () => {
    const content = 'Header text\n- Bullet point\n1. Numbered item';
    const result = parseNoteContent(content);
    expect(result).toEqual([
      { id: 'text-0', type: 'text', text: 'Header text' },
      { id: 'bullet-1', type: 'bullet', text: 'Bullet point' },
      { id: 'numbered-2', type: 'numbered', number: '1', text: 'Numbered item' },
    ]);
  });

  it('should parse DB Failover Runbook sample as bullets', () => {
    const content =
      '- Check replication lag\n- Notify on-call DBA\n- Initiate failover via orchestrator';
    const result = parseNoteContent(content);
    expect(result).toHaveLength(3);
    expect(result.every((l) => l.type === 'bullet')).toBe(true);
  });

  it('should parse Bridge Call Checklist sample as bullets', () => {
    const content =
      '- Confirm all required participants\n- Verify Teams link is active\n- Prepare incident timeline\n- Assign note-taker\n- Send summary within 30 min';
    const result = parseNoteContent(content);
    expect(result).toHaveLength(5);
    expect(result.every((l) => l.type === 'bullet')).toBe(true);
  });
});

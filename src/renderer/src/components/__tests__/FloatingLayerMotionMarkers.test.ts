import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('floating layer motion markers', () => {
  it.each([
    'src/renderer/src/components/ContextMenu.tsx',
    'src/renderer/src/components/Combobox.tsx',
    'src/renderer/src/components/HeaderSearch.tsx',
    'src/renderer/src/components/Tooltip.tsx',
    'src/renderer/src/components/WorldClock.tsx',
    'src/renderer/src/components/sidebar/SidebarDashboards.tsx',
    'src/renderer/src/tabs/alerts/HighlightPopover.tsx',
  ])('%s uses the shared popover motion marker', (path) => {
    expect(source(path)).toContain('data-motion="popover"');
  });
});

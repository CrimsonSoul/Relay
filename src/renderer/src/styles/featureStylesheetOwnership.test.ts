import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererPath = (path: string) => resolve(process.cwd(), 'src/renderer/src', path);
const read = (path: string) => readFileSync(rendererPath(path), 'utf8');

describe('feature stylesheet ownership', () => {
  it('loads lazy feature styles from their owning module instead of the global manifest', () => {
    const manifest = read('styles.css');

    expect(manifest).not.toContain('./components/settings/settings.css');
    expect(manifest).not.toContain('./tabs/alerts.css');
    expect(manifest).not.toContain('./features/knowledge/knowledge.css');
    expect(read('components/SettingsModal.tsx')).toContain("import './settings/settings.css';");
    expect(read('tabs/AlertsTab.tsx')).toContain("import './alerts.css';");
    expect(read('features/knowledge/KnowledgeWorkspace.tsx')).toContain(
      "import './knowledge.css';",
    );
  });

  it.each([
    ['styles/components.css', 'relay.shared'],
    ['components/settings/settings.css', 'relay.settings'],
    ['tabs/alerts.css', 'relay.features.alerts'],
    ['features/knowledge/knowledge.css', 'relay.features.knowledge'],
  ])('decomposes %s through an explicitly ordered layer family', (path, layerFamily) => {
    const source = read(path);
    const imports = [...source.matchAll(/@import\s+['"][^'"]+['"]\s+layer\(([^)]+)\);/g)];

    expect(imports.length).toBeGreaterThan(1);
    expect(imports.every((match) => match[1]?.startsWith(layerFamily))).toBe(true);
  });
});

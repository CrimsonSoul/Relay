import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('PocketBase privileged reauthentication hook contract', () => {
  it('packages the hook beside PocketBase in the Windows release', () => {
    const config = read('electron-builder.yml');

    expect(config.match(/from: 'resources\/pocketbase\/hooks\/'/g)).toHaveLength(1);
    expect(config.match(/to: 'pocketbase\/hooks\/'/g)).toHaveLength(1);
  });

  it('includes runtime hooks in Sonar static analysis without requiring runtime coverage', () => {
    const sonar = read('sonar-project.properties');

    expect(sonar).toMatch(/^sonar\.sources=.*(?:^|,)resources\/pocketbase\/hooks(?:,|$)/mu);
    expect(sonar).toMatch(/^sonar\.coverage\.exclusions=.*resources\/pocketbase\/hooks\/\*\*/mu);
    expect(sonar).not.toMatch(/^sonar\.exclusions=.*resources\/pocketbase\/hooks/mu);
  });

  it('creates proofs only after server-side password, authority, and device validation', () => {
    const hook = read('resources/pocketbase/hooks/relay_privileged_reauth.pb.js');

    expect(hook).toContain('POST');
    expect(hook).toContain('/api/relay/privileged/reauth');
    expect(hook).toMatch(/\$apis\.requireAuth\(['"]relay_privileged_accounts['"]\)/);
    expect(hook).toContain('$apis.bodyLimit(4096)');
    expect(hook).toContain('account.validatePassword(input.password)');
    expect(hook).toContain("state = 'active'");
    expect(hook).toContain('e.app.runInTransaction');
    expect(hook).toMatch(/command:\s*['"]privileged\.reauth\.confirm['"]/);
    expect(hook).toMatch(/state:\s*['"]succeeded['"]/);
    expect(hook).not.toContain('onRecordAuthWithPasswordRequest');
    expect(hook).not.toContain('e.next()');
  });
});

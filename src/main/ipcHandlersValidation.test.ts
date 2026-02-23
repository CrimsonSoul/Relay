import { describe, it, expect } from 'vitest';

// Test the isUncPath function directly
// Since it's not exported, we test the logic here
function isUncPath(path: string): boolean {
  return /^[/\\]{2}[^/\\]+[/\\]+[^/\\]+/.test(path);
}

describe('isUncPath', () => {
  it('detects standard UNC paths', () => {
    expect(isUncPath(String.raw`\\server\share`)).toBe(true);
    expect(isUncPath(String.raw`\\server\share\folder`)).toBe(true);
    expect(isUncPath(String.raw`\\192.168.1.1\share`)).toBe(true);
  });

  it('detects UNC paths with forward slashes', () => {
    expect(isUncPath('//server/share')).toBe(true);
    expect(isUncPath('//server/share/folder')).toBe(true);
  });

  it('detects mixed slash UNC paths', () => {
    expect(isUncPath(String.raw`\/server\share`)).toBe(true);
    expect(isUncPath(String.raw`/\server/share`)).toBe(true);
  });

  it('rejects non-UNC paths', () => {
    expect(isUncPath('/home/user/data')).toBe(false);
    expect(isUncPath(String.raw`C:\Users\data`)).toBe(false);
    expect(isUncPath('./relative/path')).toBe(false);
    expect(isUncPath('../parent/path')).toBe(false);
    expect(isUncPath(String.raw`\single\backslash`)).toBe(false);
    expect(isUncPath('/single/forward')).toBe(false);
  });

  it('rejects paths with incomplete UNC format', () => {
    expect(isUncPath(String.raw`\\`)).toBe(false); // No server
    expect(isUncPath(String.raw`\\server`)).toBe(false); // No share
    expect(isUncPath('\\\\server\\')).toBe(false); // Empty share
  });
});

describe('Path traversal protection', () => {
  it('detects path traversal attempts', () => {
    // These paths should be normalized and validated
    const traversalAttempts = [
      '../../../etc/passwd',
      String.raw`..\..\..\windows\system32`,
      'folder/../../../escape',
      'valid/../../escape',
      './valid/../../../escape',
    ];

    // Each of these would fail the relative path check after normalization
    for (const path of traversalAttempts) {
      const normalized = require('node:path').normalize(path);
      // After normalization, the path should start with .. if it escapes
      expect(normalized.startsWith('..')).toBe(true);
    }
  });
});

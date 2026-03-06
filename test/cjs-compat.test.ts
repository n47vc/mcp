import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import { readFileSync } from 'fs';

const ROOT = path.resolve(__dirname, '..');

describe('CJS compatibility', () => {
  it('dist/index.js is requireable from CommonJS', () => {
    // This catches ESM-only dependencies that break CJS consumers
    execSync(
      `node -e "require('./dist/index.js')"`,
      { cwd: ROOT, encoding: 'utf-8', timeout: 10000 },
    );
  });

  it('dist/auth/jwt.js is requireable from CommonJS', () => {
    execSync(
      `node -e "require('./dist/auth/jwt.js')"`,
      { cwd: ROOT, encoding: 'utf-8', timeout: 10000 },
    );
  });

  it('jose dependency resolves to a CJS-compatible version (not v6+)', () => {
    // jose v6 is ESM-only and breaks any CJS consumer.
    // This test ensures we never regress to v6.
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    const joseRange = pkg.dependencies?.jose;
    expect(joseRange).toBeDefined();

    // The semver range must not allow v6+
    expect(joseRange).toMatch(/^\^5\./);

    // Also verify the actually-installed version is v5
    const installedPkg = JSON.parse(
      readFileSync(path.join(ROOT, 'node_modules/jose/package.json'), 'utf-8'),
    );
    expect(installedPkg.version).toMatch(/^5\./);
  });
});

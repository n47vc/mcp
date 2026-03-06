import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

describe('CJS compatibility', () => {
  it('dist/index.js is requireable from CommonJS', () => {
    // This catches ESM-only dependencies that break CJS consumers
    const result = execSync(
      `node -e "require('./dist/index.js')"`,
      { cwd: ROOT, encoding: 'utf-8', timeout: 10000 },
    );
    expect(result).toBeDefined();
  });

  it('dist/auth/jwt.js is requireable from CommonJS', () => {
    const result = execSync(
      `node -e "require('./dist/auth/jwt.js')"`,
      { cwd: ROOT, encoding: 'utf-8', timeout: 10000 },
    );
    expect(result).toBeDefined();
  });
});

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import config from '../vite.config';
it('reads the base from Vite environment files and permits an explicit process override', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-meeting-base-'));
  try {
    writeFileSync(join(directory, '.env.production'), 'VITE_BASE_PATH=/PrivateMeeting/\n');
    vi.spyOn(process, 'cwd').mockReturnValue(directory);
    vi.stubEnv('VITE_BASE_PATH', undefined);
    if (typeof config !== 'function') throw new Error('Expected mode-aware Vite configuration.');
    expect((await config({ mode: 'production', command: 'build' })).base).toBe('/PrivateMeeting/');
    vi.stubEnv('VITE_BASE_PATH', '/custom/');
    expect((await config({ mode: 'production', command: 'build' })).base).toBe('/custom/');
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true });
  }
});

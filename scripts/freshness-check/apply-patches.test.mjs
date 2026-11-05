import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { updateLastChecked } from './apply-patches.mjs';

async function tempData(source) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'last-checked-'));
  const file = path.join(dir, 'data.js');
  await fs.writeFile(file, source);
  return file;
}

test('updateLastChecked writes the new month', async () => {
  const file = await tempData('const LAST_CHECKED = "November 2026";\nconst CATALOG = [];\n');
  const label = await updateLastChecked(file, new Date('2026-12-01T06:00:00Z'));
  assert.equal(label, 'December 2026');
  assert.equal(await fs.readFile(file, 'utf8'), 'const LAST_CHECKED = "December 2026";\nconst CATALOG = [];\n');
});

test('updateLastChecked leaves a current date alone', async () => {
  const file = await tempData('const LAST_CHECKED = "December 2026";\n');
  assert.equal(await updateLastChecked(file, new Date('2026-12-20T06:00:00Z')), null);
});

test('updateLastChecked fails loudly when the constant is missing', async () => {
  const file = await tempData('const CATALOG = [];\n');
  await assert.rejects(updateLastChecked(file), /LAST_CHECKED/);
});

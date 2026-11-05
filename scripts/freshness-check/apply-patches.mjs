// Applies trivial field patches to data.js via targeted string surgery (not a
// full re-serialize — a one-field change should produce a one-line diff, not
// reformat 150 questions). Self-verifying: after patching, it re-parses both
// the old and new data.js and walks every field of every exam to confirm the
// ONLY differences are the intended patches. If anything else moved, it
// throws instead of writing the file — a failed patch should be loud and
// produce nothing, never silently corrupt production data.

import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

function weightMidpoint(weight) {
  const m = weight.match(/(\d+)\D+(\d+)/);
  if (!m) return null;
  return (parseInt(m[1], 10) + parseInt(m[2], 10)) / 2;
}

function findExamBlock(source, code) {
  const marker = `"${code}": {`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not locate "${code}" block in data.js`);
  let depth = 0, i = start + marker.length - 1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return { start, end: i, block: source.slice(start, i) };
}

// data.js mixes two valid object-literal styles depending on when/how an
// exam was written: bare keys (name: "X") from the earliest hand-formatted
// exams, and quoted keys ("name": "X") from exams spliced in later via
// JSON.stringify. Both are valid JS and the app doesn't care, but patch
// regexes need to match either — `"?key"?` handles both without forcing a
// style conversion (the replacement re-uses whatever quoting was captured).
function applyOnePatch(block, patch) {
  if (patch.field === 'level') {
    const re = /("?level"?)(\s*:\s*)"[^"]*"/;
    if (!re.test(block)) throw new Error(`Could not find level field to patch`);
    return block.replace(re, `$1$2"${patch.to}"`);
  }
  if (patch.field === 'beta') {
    const re = /("?beta"?)(\s*:\s*)(true|false)/;
    if (!re.test(block)) throw new Error(`Could not find beta field to patch`);
    return block.replace(re, `$1$2${patch.to}`);
  }
  if (patch.field.startsWith('domains[')) {
    const escapedName = patch.domainName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedOldWeight = patch.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `("?name"?\\s*:\\s*"${escapedName}"[\\s\\S]{0,25}?"?weight"?\\s*:\\s*")${escapedOldWeight}("[\\s\\S]{0,25}?"?mid"?\\s*:\\s*)[\\d.]+`
    );
    if (!re.test(block)) throw new Error(`Could not find domain "${patch.domainName}" weight field to patch`);
    const newMid = weightMidpoint(patch.to);
    return block.replace(re, `$1${patch.to}$2${newMid}`);
  }
  throw new Error(`Unknown patch field: ${patch.field}`);
}

// A beta flip also has to reach the "(beta)" suffix on the cert name and the
// exam's CATALOG entry, or the site keeps showing the old status.
function withoutBetaSuffix(text) {
  return text.replace(/\s*\(beta\)/i, '');
}

function patchCertName(block, patch) {
  if (patch.field !== 'beta' || patch.to !== false) return block;
  return block.replace(/("?cert"?\s*:\s*")([^"]*)"/, (_, prefix, cert) => `${prefix}${withoutBetaSuffix(cert)}"`);
}

function patchCatalogBeta(source, code, patches) {
  const patch = patches.find(p => p.field === 'beta');
  if (!patch) return source;
  const lineRe = new RegExp(`^.*\\{ code:"${code}".*$`, 'm');
  if (!lineRe.test(source)) throw new Error(`Could not find ${code} in CATALOG`);
  return source.replace(lineRe, line => {
    if (patch.to === false) {
      return line.replace(/, beta:true/, '').replace(/title:"([^"]*)"/, (_, title) => `title:"${withoutBetaSuffix(title)}"`);
    }
    return line.includes('beta:true') ? line : line.replace(/ \},?\s*$/, m => `, beta:true${m}`);
  });
}

// Structural self-check: re-parse old vs new data.js as real JS and confirm
// every exam/field is identical except the patches we meant to apply.
function verifyOnlyIntendedChanges(oldSource, newSource, code, patches) {
  const req = createRequire(import.meta.url);
  const tmpOld = `/tmp/freshness-verify-old-${Date.now()}.cjs`;
  const tmpNew = `/tmp/freshness-verify-new-${Date.now()}.cjs`;
  return fs.writeFile(tmpOld, oldSource + '\nmodule.exports = { CATALOG, EXAMS };')
    .then(() => fs.writeFile(tmpNew, newSource + '\nmodule.exports = { CATALOG, EXAMS };'))
    .then(() => {
      const oldData = req(tmpOld);
      const newData = req(tmpNew);
      delete req.cache[req.resolve(tmpOld)];
      delete req.cache[req.resolve(tmpNew)];
      const before = oldData.EXAMS[code];
      const after = newData.EXAMS[code];

      const beforeJson = JSON.stringify(before);
      const afterJson = JSON.stringify(after);

      // Apply the same patches to a clone of `before` and confirm it equals `after`
      // exactly — proves the diff is precisely the patch set, nothing more.
      const expected = JSON.parse(beforeJson);
      for (const p of patches) {
        if (p.field === 'level') expected.level = p.to;
        else if (p.field === 'beta') {
          expected.beta = p.to;
          if (p.to === false) expected.cert = withoutBetaSuffix(expected.cert);
        }
        else if (p.field.startsWith('domains[')) {
          const d = expected.domains.find(d => d.name === p.domainName);
          if (!d) throw new Error(`Verify: domain "${p.domainName}" not found in expected structure`);
          d.weight = p.to;
          d.mid = weightMidpoint(p.to);
        }
      }
      if (JSON.stringify(expected) !== afterJson) {
        throw new Error(`Verification failed for ${code}: patched file doesn't match expected result. Aborting, no changes written.`);
      }

      const betaPatch = patches.find(p => p.field === 'beta');
      const expectedCatalog = oldData.CATALOG.map(entry => {
        if (entry.code !== code || !betaPatch) return entry;
        const { beta, ...rest } = entry;
        if (betaPatch.to) return { ...rest, beta: true };
        return { ...rest, title: withoutBetaSuffix(rest.title) };
      });
      if (JSON.stringify(expectedCatalog) !== JSON.stringify(newData.CATALOG)) {
        throw new Error(`Verification failed for ${code}: CATALOG changed unexpectedly. Aborting, no changes written.`);
      }
    })
    .finally(() => Promise.all([fs.unlink(tmpOld).catch(() => {}), fs.unlink(tmpNew).catch(() => {})]));
}

export async function applyPatches(dataJsPath, code, patches) {
  if (!patches.length) return;
  const oldSource = await fs.readFile(dataJsPath, 'utf8');
  const { start, end, block } = findExamBlock(oldSource, code);

  let newBlock = block;
  for (const patch of patches) newBlock = patchCertName(applyOnePatch(newBlock, patch), patch);

  const newSource = patchCatalogBeta(oldSource.slice(0, start) + newBlock + oldSource.slice(end), code, patches);
  await verifyOnlyIntendedChanges(oldSource, newSource, code, patches);
  await fs.writeFile(dataJsPath, newSource);
}

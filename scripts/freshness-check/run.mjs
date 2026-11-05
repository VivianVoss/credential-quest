// Orchestrator. Run with: node run.mjs
//
// Writes two artifacts for the GitHub Actions workflow to act on:
//   report/patch-summary.md  – human-readable body for the auto-PR (empty file if no patches)
//   report/issues.json       – array of {title, body} for structural findings (empty array if none)
//   report/deferred.json     – array of strings for outline changes not in effect yet
// Exit code is always 0 (a "nothing to do" run is a success, not a failure) —
// the workflow decides what to do based on the artifact contents, not the exit code.
// Scraper/parse failures are reported as issues, not thrown, so one broken
// page can't take down the whole run.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { checkPoster } from './check-poster.mjs';
import { scrapeExam, diffExam } from './lib.mjs';
import { applyPatches, updateLastChecked } from './apply-patches.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_JS_PATH = path.join(__dirname, '..', '..', 'data.js');
const REPORT_DIR = path.join(__dirname, 'report');
const POSTER_STATE_PATH = path.join(__dirname, 'poster-state.json');

// Remembers the last poster fingerprint. The first run only records a baseline.
async function checkPosterEdition(textSha256, allIssues, allPatchLines) {
  const stored = await fs.readFile(POSTER_STATE_PATH, 'utf8').then(JSON.parse).catch(() => null);
  if (stored?.textSha256 === textSha256) return;
  await fs.writeFile(POSTER_STATE_PATH, `${JSON.stringify({ textSha256 }, null, 2)}\n`);
  if (!stored) {
    allPatchLines.push('- Recorded a baseline fingerprint of the current poster');
    return;
  }
  allPatchLines.push('- Updated the stored poster fingerprint');
  allIssues.push({
    title: `Freshness check: new poster edition (${textSha256.slice(0, 8)})`,
    body: `The text of the official poster changed since the last run, even if no exam code did.\n\nCompare it with \`CATALOG\` by hand: titles, categories, tiers and the retirement notes in \`check-poster.mjs\`, and update anything that changed.`
  });
}

function loadData(dataJsPath, source) {
  // Fresh require each time (no caching across old/new reads).
  const tmp = `/tmp/freshness-run-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`;
  return fs.writeFile(tmp, source + '\nmodule.exports = { CATALOG, EXAMS };')
    .then(async () => {
      const { createRequire } = await import('node:module');
      const req = createRequire(import.meta.url);
      const data = req(tmp);
      delete req.cache[req.resolve(tmp)];
      await fs.unlink(tmp).catch(() => {});
      return data;
    });
}

async function main() {
  // Always start from a clean report dir — a stale patch-summary.md left over
  // from a previous (e.g. scoped/manual) run must never be picked up by a
  // later run that found nothing to patch.
  await fs.rm(REPORT_DIR, { recursive: true, force: true });
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const allPatchLines = [];
  const allIssues = [];
  const allDeferred = [];

  // ---- Problem A: poster membership ----
  const initialSource = await fs.readFile(DATA_JS_PATH, 'utf8');
  const { CATALOG } = await loadData(DATA_JS_PATH, initialSource);
  const posterResult = await checkPoster(CATALOG, execFileAsync);
  if (posterResult.error) {
    allIssues.push({ title: 'Freshness check: could not read the poster PDF', body: posterResult.error });
  } else {
    await checkPosterEdition(posterResult.textSha256, allIssues, allPatchLines);
    if (posterResult.added.length) {
      allIssues.push({
        title: `Freshness check: possible new poster credential(s): ${posterResult.added.join(', ')}`,
        body: `Found on the live poster but not in \`CATALOG\`: ${posterResult.added.join(', ')}.\n\nVerify manually — could be a genuinely new credential, or a code the extraction picked up from poster legend/note text. If real, add to \`CATALOG\` and build it out the usual way.`
      });
    }
    if (posterResult.removed.length) {
      allIssues.push({
        title: `Freshness check: credential(s) no longer found on the poster: ${posterResult.removed.join(', ')}`,
        body: `In \`CATALOG\` but not found on the current poster: ${posterResult.removed.join(', ')}.\n\nVerify manually before removing — could mean genuine retirement, or just a one-off PDF text-extraction miss. Re-run before acting on this if it's the only thing flagged.`
      });
    }
  }

  // ---- Problem B: per-exam live-page drift ----
  // FRESHNESS_ONLY=AZ-104,SC-500 restricts the run to specific codes — used
  // for manual spot-checks and for the workflow_dispatch "check one exam" input.
  const onlyCodes = process.env.FRESHNESS_ONLY
    ? new Set(process.env.FRESHNESS_ONLY.split(',').map(s => s.trim().toUpperCase()))
    : null;

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Re-read data.js after each exam's patch so later exams see earlier patches
  // (irrelevant in practice since patches are per-exam-scoped, but keeps state honest).
  let allCodes = Object.keys((await loadData(DATA_JS_PATH, await fs.readFile(DATA_JS_PATH, 'utf8'))).EXAMS);
  if (onlyCodes) allCodes = allCodes.filter(c => onlyCodes.has(c));

  const unreadableNames = [];

  for (const code of allCodes) {
    const currentSource = await fs.readFile(DATA_JS_PATH, 'utf8');
    const { EXAMS } = await loadData(DATA_JS_PATH, currentSource);
    const stored = EXAMS[code];

    const live = await scrapeExam(page, stored);
    const { patches, issues, nameIssues, unverified, deferred } = diffExam(stored, live);
    allDeferred.push(...deferred);
    allIssues.push(...nameIssues);
    if (unverified.includes('cert name')) unreadableNames.push(code);

    if (patches.length) {
      try {
        await applyPatches(DATA_JS_PATH, code, patches);
        for (const p of patches) {
          if (p.field.startsWith('domains[')) {
            allPatchLines.push(`- **${code}** — "${p.domainName}" weight: \`${p.from}\` → \`${p.to}\``);
          } else {
            allPatchLines.push(`- **${code}** — ${p.field}: \`${p.from}\` → \`${p.to}\``);
          }
        }
      } catch (e) {
        allIssues.push({
          title: `Freshness check: auto-patch failed for ${code}`,
          body: `Tried to apply: ${JSON.stringify(patches, null, 2)}\n\nFailed with: ${e.message}\n\nNo changes were written for this exam — needs a manual look.`
        });
      }
    }
    for (const issue of issues) {
      allIssues.push({ title: `Freshness check: ${code} needs attention`, body: issue });
    }
    if (unverified.length) {
      console.log(`[info] ${code}: could not verify ${unverified.join(', ')} this run (page template variation, not an error)`);
    }

    await new Promise(r => setTimeout(r, 1000)); // be polite to learn.microsoft.com
  }

  await browser.close();

  // Only a full run that could read the poster counts as a check.
  if (!onlyCodes && !posterResult.error) {
    const label = await updateLastChecked(DATA_JS_PATH);
    if (label) allPatchLines.push(`- Updated the site's last checked date to ${label}`);
  }

  // One unreadable name is a page hiccup. Most of them means Learn's markup
  // changed, and a name check that can't read names must not look like a clean run.
  if (unreadableNames.length > allCodes.length / 2) {
    allIssues.push({
      title: 'Freshness check: could not read certification names',
      body: `No name could be read from the live page for ${unreadableNames.length} of ${allCodes.length} exams, so renames weren't checked for them: ${unreadableNames.join(', ')}.\n\nCheck \`readCertName\` in \`lib.mjs\` against a live page.`
    });
  }

  // Only write patch-summary.md when there's something to say — the workflow
  // uses this file's mere existence (hashFiles(...) != '') to decide whether
  // to open a PR, so an empty-but-present file would trigger a no-op PR step.
  if (allPatchLines.length) {
    await fs.writeFile(
      path.join(REPORT_DIR, 'patch-summary.md'),
      `## Freshness check — auto-patched fields\n\nThese are mechanical field updates from Microsoft's live pages (level/beta status, or a weight percentage on an unchanged domain). Nothing structural, so this PR merges automatically.\n\n${allPatchLines.join('\n')}\n`
    );
  }
  await fs.writeFile(path.join(REPORT_DIR, 'issues.json'), JSON.stringify(allIssues, null, 2));
  await fs.writeFile(path.join(REPORT_DIR, 'deferred.json'), JSON.stringify(allDeferred, null, 2));

  console.log(`Done. ${allPatchLines.length} field patch(es), ${allIssues.length} issue(s) to file, ${allDeferred.length} deferred.`);
}

main().catch(e => {
  console.error('Freshness check run failed:', e);
  process.exit(1);
});

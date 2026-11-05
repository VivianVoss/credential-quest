// Files GitHub issues for structural findings from report/issues.json.
// De-dupes against currently-open issues by exact title, so an unaddressed
// finding gets left alone (not re-filed) on the next scheduled run.
// Requires GITHUB_TOKEN and GITHUB_REPOSITORY (both provided automatically
// inside a GitHub Actions job) — no-ops outside that context.
//
// Full runs then post a digest issue assigned to the repo owner, which is what
// makes GitHub send an email. It's posted even when nothing changed, so a
// missing digest means the check itself stopped running.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIGEST_LABEL = 'freshness-digest';
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;

if (!token || !repo) {
  console.log('No GITHUB_TOKEN/GITHUB_REPOSITORY in the environment — not running in Actions, skipping issue creation.');
  process.exit(0);
}

const issuesPath = path.join(__dirname, 'report', 'issues.json');
const issues = JSON.parse(await fs.readFile(issuesPath, 'utf8').catch(() => '[]'));

const api = (p, opts = {}) => fetch(`https://api.github.com/repos/${repo}${p}`, {
  ...opts,
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    ...opts.headers,
  },
});

const existingRes = await api('/issues?state=open&per_page=100&labels=freshness-check');
const existing = existingRes.ok ? await existingRes.json() : [];
const existingTitles = new Set(existing.map(i => i.title));

for (const issue of issues) {
  if (existingTitles.has(issue.title)) {
    console.log(`Skipping (already open): ${issue.title}`);
    continue;
  }
  const res = await api('/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: issue.title, body: issue.body, labels: ['freshness-check'] }),
  });
  if (!res.ok) {
    console.error(`Failed to create issue "${issue.title}": ${res.status} ${await res.text()}`);
  } else {
    console.log(`Created issue: ${issue.title}`);
  }
}

await postDigest();

async function postDigest() {
  if (process.env.FRESHNESS_ONLY) {
    console.log('Scoped run, skipping the digest.');
    return;
  }

  const reportDir = path.join(__dirname, 'report');
  const deferred = JSON.parse(await fs.readFile(path.join(reportDir, 'deferred.json'), 'utf8').catch(() => '[]'));
  const patchSummary = await fs.readFile(path.join(reportDir, 'patch-summary.md'), 'utf8').catch(() => '');
  const patchLines = patchSummary.split('\n').filter(line => line.startsWith('- '));

  const openRes = await api('/issues?state=open&per_page=100&labels=freshness-check');
  const open = openRes.ok ? await openRes.json() : [];

  const merged = process.env.MERGE_OUTCOME === 'success';
  const sections = [
    ['Needs you', open.map(i => `- #${i.number} ${i.title}`), 'Nothing open.'],
    [merged ? 'Applied automatically' : 'Patches not merged, check the run', patchLines, 'No field changes.'],
    ['Scheduled for a later run', deferred.map(line => `- ${line}`), 'Nothing scheduled.'],
  ];
  const body = sections
    .map(([heading, lines, empty]) => `## ${heading}\n\n${lines.length ? lines.join('\n') : empty}`)
    .join('\n\n');

  await api('/labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DIGEST_LABEL, color: '0E8A16', description: 'Monthly summary from the freshness check' }),
  }); // a 422 just means the label already exists

  const previousRes = await api(`/issues?state=open&per_page=100&labels=${DIGEST_LABEL}`);
  const previous = previousRes.ok ? await previousRes.json() : [];

  const month = new Date().toISOString().slice(0, 7);
  const res = await api('/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `Freshness digest ${month}: ${open.length} open, ${patchLines.length} patched, ${deferred.length} scheduled`,
      body: `${body}\n\n[Run details](${process.env.RUN_URL})`,
      labels: [DIGEST_LABEL],
      assignees: [process.env.GITHUB_REPOSITORY_OWNER],
    }),
  });
  if (!res.ok) {
    console.error(`Failed to post digest: ${res.status} ${await res.text()}`);
    process.exitCode = 1;
    return;
  }

  for (const issue of previous) {
    await api(`/issues/${issue.number}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    });
  }
  console.log('Posted digest.');
}

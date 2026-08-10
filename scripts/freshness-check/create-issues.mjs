// Files GitHub issues for structural findings from report/issues.json.
// De-dupes against currently-open issues by exact title, so an unaddressed
// finding gets left alone (not re-filed) on the next scheduled run.
// Requires GITHUB_TOKEN and GITHUB_REPOSITORY (both provided automatically
// inside a GitHub Actions job) — no-ops outside that context.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;

if (!token || !repo) {
  console.log('No GITHUB_TOKEN/GITHUB_REPOSITORY in the environment — not running in Actions, skipping issue creation.');
  process.exit(0);
}

const issuesPath = path.join(__dirname, 'report', 'issues.json');
const issues = JSON.parse(await fs.readFile(issuesPath, 'utf8').catch(() => '[]'));

if (!issues.length) {
  console.log('No issues to file.');
  process.exit(0);
}

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

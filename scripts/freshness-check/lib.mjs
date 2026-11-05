// Shared extraction helpers for the freshness checker.
//
// Every extractor returns `null` on failure/uncertainty rather than guessing —
// callers must treat null as "couldn't verify this field" and skip it, never
// as "field is now empty" or "field was removed". Microsoft's cert pages use
// more than one page template (confirmed: expert-tier certs like AI-500 have
// no "At a glance" panel at all), so silent misses are expected and must be
// safe, not just rare.

export function extractLevel(pageText) {
  const m = pageText.match(/\bLevel\b\s*\n+\s*(Beginner|Intermediate|Advanced)\b/);
  return m ? m[1] : null;
}

export function extractBeta(pageText, titleText) {
  if (/beta exam/i.test(pageText)) return true;
  if (titleText && /\(beta\)/i.test(titleText)) return true;
  // Absence of both signals is a genuine "false", not "unknown" — beta status
  // is always explicitly called out on Microsoft's pages when it applies.
  return false;
}

// Microsoft's live pages use typographic quotes/dashes (’ – “ ”); data.js
// entries vary between typographic and straight characters depending on
// when/how they were written. Normalize before comparing text for equality
// so this doesn't read as a "domain renamed" structural change — but always
// patch/report using the STORED string, since that's what literally has to
// be found in the file.
function normalizeText(s) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .trim();
}

// Reduces a certification name to the words that identify it, so only a real
// rename reads as a difference: case, punctuation and a "(beta)" suffix don't
// count.
export function normalizeCertName(name) {
  return name
    .replace(/\(beta\)\s*$/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Study guides can publish a future outline early ("Skills measured as of
// November 16, 2026"). Returns that date, or null when the guide has none.
export function extractEffectiveDate(studyGuideText) {
  const m = studyGuideText.match(/Skills measured as of\s+([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (!m) return null;
  const date = new Date(`${m[1]} UTC`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Learn pages can stall on background requests, so wait for the content
// itself rather than network idle, and retry before reporting a failure.
async function loadMainText(page, url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const main = page.locator('main').first();
      await main.waitFor({ timeout: 15000 });
      return { text: await main.innerText(), found: response.status() < 400 };
    } catch (e) {
      lastError = e;
      if (attempt < attempts) await new Promise(r => setTimeout(r, attempt * 5000));
    }
  }
  throw lastError;
}

// A page this short didn't render properly, so its missing "beta" wording
// proves nothing.
const MIN_PAGE_TEXT_LENGTH = 500;

// Midpoints of a real outline add up to roughly 100. Anything far off means
// the scrape misread the page, so it must not become an auto-merged patch.
function weightsLookPlausible(domains) {
  const total = domains.reduce((sum, d) => {
    const m = d.weight.match(/(\d+)\D+(\d+)/);
    return sum + (m ? (Number(m[1]) + Number(m[2])) / 2 : 0);
  }, 0);
  return total >= 85 && total <= 115;
}

export function extractDomains(studyGuideText) {
  const idx = studyGuideText.indexOf('Skills at a glance');
  if (idx === -1) return null;
  const chunk = studyGuideText.slice(idx, idx + 6000);
  const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);
  const seen = new Set();
  const domains = [];
  const re = /^(.+?)\s*\((\d{1,2}[-–]\d{1,2}%)\)$/;
  for (const line of lines.slice(1)) {
    const m = line.match(re);
    if (!m) continue;
    const name = m[1].trim();
    const weight = m[2].replace('–', '-');
    if (seen.has(name)) break; // hit the detailed section repeating domain 1

    // Confirmed on GH-300 (2026-08): Microsoft's own "Skills at a glance"
    // list can contain a genuine duplicate-looking line right after a real
    // domain — e.g. "Use GitHub Copilot features (25–30%)" immediately
    // followed by "GitHub Copilot features (25–30%)" — same weight, no
    // detailed section of its own anywhere on the page. That's a content
    // artifact on their end, not a second domain. Skip a line whose name is
    // a substring of (or contains) the immediately-preceding collected
    // domain's name, when the weight also matches exactly.
    const prev = domains[domains.length - 1];
    if (prev && prev.weight === weight) {
      const a = name.toLowerCase(), b = prev.name.toLowerCase();
      if (a.includes(b) || b.includes(a)) continue;
    }

    seen.add(name);
    domains.push({ name, weight });
  }
  return domains.length ? domains : null;
}

// The page's only h1 is the certification name, on every template in use.
async function readCertName(page) {
  const h1 = await page.locator('main h1').first().textContent({ timeout: 5000 }).catch(() => null);
  return h1?.trim() || null;
}

export async function scrapeExam(page, exam) {
  const result = { code: exam.code, certName: null, level: null, beta: null, domains: null, effectiveDate: null, error: null };
  try {
    const { text: certText, found } = await loadMainText(page, exam.certUrl);
    // A 404 page has an h1 too ("404 - Page not found"), which isn't a rename.
    if (found) result.certName = await readCertName(page);
    const titleText = certText.slice(0, 300);
    result.level = extractLevel(certText);
    if (certText.length >= MIN_PAGE_TEXT_LENGTH) result.beta = extractBeta(certText, titleText);

    const { text: guideText } = await loadMainText(page, exam.studyGuideUrl);
    result.domains = extractDomains(guideText);
    result.effectiveDate = extractEffectiveDate(guideText);
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

// A rename is filed, never patched: it can also change the exam's title and
// its CATALOG entry, and the new name can imply a different tier. The title
// is specific to the rename because issues are de-duplicated by exact title,
// so a shared "needs attention" title would hide it behind any open issue for
// the same exam.
function certNameIssue(stored, liveName) {
  return {
    title: `Freshness check: ${stored.code} certification name changed to "${liveName}"`,
    body:
      `The name on Microsoft Learn no longer matches \`cert\` in \`data.js\`.\n\n` +
      `- Stored: ${stored.cert}\n` +
      `- Live: ${liveName}\n` +
      `- Page: ${stored.certUrl}\n\n` +
      `This wasn't patched automatically. Check by hand:\n\n` +
      `- \`cert\` and \`title\` on ${stored.code} in \`EXAMS\`\n` +
      `- \`title\` and \`tier\` on its \`CATALOG\` entry, against the poster`
  };
}

// Diffs a live scrape against the stored exam data. Returns:
//   patches   – confident, mechanical field updates (safe to auto-apply)
//   issues    – structural changes that need human/LLM judgment
//   nameIssues – {title, body} for a renamed certification (filed, not patched)
//   unverified – fields the scraper couldn't confirm this run (informational only)
//   deferred  – outline changes that aren't in effect yet (reported, not applied)
export function diffExam(stored, live, now = new Date()) {
  const patches = [];
  const issues = [];
  const nameIssues = [];
  const unverified = [];
  const deferred = [];

  if (live.error) {
    issues.push(`Could not load live pages for ${stored.code}: ${live.error}`);
    return { patches, issues, nameIssues, unverified, deferred };
  }

  if (live.certName === null) unverified.push('cert name');
  else if (normalizeCertName(live.certName) !== normalizeCertName(stored.cert)) {
    nameIssues.push(certNameIssue(stored, live.certName));
  }

  if (live.level === null) unverified.push('level');
  else if (live.level !== stored.level) {
    patches.push({ field: 'level', from: stored.level, to: live.level });
  }

  if (live.beta === null) unverified.push('beta');
  else if (live.beta !== stored.beta) {
    patches.push({ field: 'beta', from: stored.beta, to: live.beta });
  }

  if (live.domains === null) {
    unverified.push('domains');
  } else {
    const domainPatches = [];
    const domainIssues = [];
    const storedNames = stored.domains.map(d => normalizeText(d.name));
    const liveNames = live.domains.map(d => normalizeText(d.name));
    const sameNamesSameOrder = storedNames.length === liveNames.length
      && storedNames.every((n, i) => n === liveNames[i]);

    if (sameNamesSameOrder) {
      // Structure unchanged — any weight differences are mechanical. Report/patch
      // using the STORED name (not live), since that's the literal string that
      // has to be found in data.js — they're equal here modulo typographic chars.
      // Deliberately NOT normalized here (unlike the name check above): a
      // dash-style mismatch in the weight value is exactly the kind of
      // trivial drift this is supposed to catch and patch, not paper over.
      live.domains.forEach((d, i) => {
        if (d.weight !== stored.domains[i].weight) {
          domainPatches.push({ field: `domains[${i}].weight`, domainName: stored.domains[i].name, from: stored.domains[i].weight, to: d.weight });
        }
      });
    } else {
      const added = liveNames.filter(n => !storedNames.includes(n));
      const removed = storedNames.filter(n => !liveNames.includes(n));
      domainIssues.push(
        `${stored.code}: domain structure changed.\n` +
        (added.length ? `  Added on live page: ${added.join('; ')}\n` : '') +
        (removed.length ? `  No longer on live page: ${removed.join('; ')}\n` : '') +
        `  This needs real content work (new/removed domains mean the question pool coverage is out of date), not just a data patch.`
      );
    }

    if (domainPatches.length && !weightsLookPlausible(live.domains)) {
      domainPatches.length = 0;
      domainIssues.push(`${stored.code}: scraped domain weights don't add up to about 100%, so they were not applied. Check the study guide by hand.`);
    }

    const changed = domainPatches.length || domainIssues.length;
    if (changed && live.effectiveDate && live.effectiveDate > now) {
      const date = live.effectiveDate.toISOString().slice(0, 10);
      deferred.push(`${stored.code}: new skills outline takes effect on ${date}. It will be picked up by the first run after that date.`);
    } else {
      patches.push(...domainPatches);
      issues.push(...domainIssues);
    }
  }

  return { patches, issues, nameIssues, unverified, deferred };
}

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
    seen.add(name);
    domains.push({ name, weight });
  }
  return domains.length ? domains : null;
}

export async function scrapeExam(page, exam) {
  const result = { code: exam.code, level: null, beta: null, domains: null, error: null };
  try {
    await page.goto(exam.certUrl, { waitUntil: 'networkidle', timeout: 30000 });
    const certText = await page.locator('main').first().innerText();
    const titleText = certText.slice(0, 300);
    result.level = extractLevel(certText);
    result.beta = extractBeta(certText, titleText);

    await page.goto(exam.studyGuideUrl, { waitUntil: 'networkidle', timeout: 30000 });
    const guideText = await page.locator('main').first().innerText();
    result.domains = extractDomains(guideText);
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

// Diffs a live scrape against the stored exam data. Returns:
//   patches   – confident, mechanical field updates (safe to auto-apply)
//   issues    – structural changes that need human/LLM judgment
//   unverified – fields the scraper couldn't confirm this run (informational only)
export function diffExam(stored, live) {
  const patches = [];
  const issues = [];
  const unverified = [];

  if (live.error) {
    issues.push(`Could not load live pages for ${stored.code}: ${live.error}`);
    return { patches, issues, unverified };
  }

  if (live.level === null) unverified.push('level');
  else if (live.level !== stored.level) {
    patches.push({ field: 'level', from: stored.level, to: live.level });
  }

  if (live.beta !== stored.beta) {
    patches.push({ field: 'beta', from: stored.beta, to: live.beta });
  }

  if (live.domains === null) {
    unverified.push('domains');
  } else {
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
          patches.push({ field: `domains[${i}].weight`, domainName: stored.domains[i].name, from: stored.domains[i].weight, to: d.weight });
        }
      });
    } else {
      const added = liveNames.filter(n => !storedNames.includes(n));
      const removed = storedNames.filter(n => !liveNames.includes(n));
      issues.push(
        `${stored.code}: domain structure changed.\n` +
        (added.length ? `  Added on live page: ${added.join('; ')}\n` : '') +
        (removed.length ? `  No longer on live page: ${removed.join('; ')}\n` : '') +
        `  This needs real content work (new/removed domains mean the question pool coverage is out of date), not just a data patch.`
      );
    }
  }

  return { patches, issues, unverified };
}

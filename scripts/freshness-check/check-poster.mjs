import { createHash } from 'node:crypto';

// Problem A: does the official poster still list exactly the credentials in
// CATALOG? Pure text-diffing, no browser needed — the poster is a static PDF.
//
// Codes that appear in the poster's text layer but are deliberately NOT real,
// current credentials (legend example text, or codes explicitly called out as
// retiring) — verified by hand against the July 2026 edition, re-check this
// list if a future edition restructures the legend or retirement note.
const KNOWN_NON_CREDENTIAL_CODES = new Set([
  'MB-300', // legend's "Full certification title" example code, not a real cert
  'AZ-800', // poster's own note: retiring, replaced by AZ-802 (already in CATALOG)
  'AZ-801', // same retirement note as AZ-800
]);

const POSTER_URL = 'https://arch-center.azureedge.net/Credentials/Certification-Poster_en-us.pdf';

// Fingerprints the poster's text, not the PDF bytes, so a re-export with
// identical content doesn't read as a new edition. Whitespace is collapsed
// so a different pdftotext version doesn't either.
function fingerprint(text) {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}

export async function checkPoster(catalog, execFileAsync) {
  const tmpPath = '/tmp/freshness-check-poster.pdf';
  const res = await fetch(POSTER_URL);
  if (!res.ok) {
    return { error: `Could not download poster PDF (HTTP ${res.status})`, added: [], removed: [], textSha256: null };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const fs = await import('node:fs/promises');
  await fs.writeFile(tmpPath, buf);

  const { stdout } = await execFileAsync('pdftotext', ['-layout', tmpPath, '-']);
  await fs.unlink(tmpPath).catch(() => {});

  const found = new Set(
    (stdout.match(/\b[A-Z]{2,4}-[0-9]{3,4}\b/g) || [])
      .filter(code => !KNOWN_NON_CREDENTIAL_CODES.has(code))
  );

  const catalogCodes = new Set(catalog.map(c => c.code));
  const added = [...found].filter(c => !catalogCodes.has(c)).sort();
  const removed = [...catalogCodes].filter(c => !found.has(c)).sort();

  return { error: null, added, removed, textSha256: fingerprint(stdout) };
}

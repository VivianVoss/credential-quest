import test from 'node:test';
import assert from 'node:assert/strict';
import { diffExam, normalizeCertName, scrapeExam } from './lib.mjs';

const stored = {
  code: 'DP-420',
  cert: 'Microsoft Certified: Azure Cosmos DB AI Developer Associate',
  certUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/azure-cosmos-db-developer-specialty/',
  level: 'Intermediate',
  beta: false,
  domains: [],
};
const live = { certName: stored.cert, level: null, beta: null, domains: null, effectiveDate: null, error: null };

test('names that differ only in case, punctuation or a beta suffix are the same name', () => {
  const same = [
    ['Microsoft Certified: Azure AI Fundamentals', 'MICROSOFT CERTIFIED AZURE AI FUNDAMENTALS'],
    ['Security, Compliance, and Identity Fundamentals', 'Security Compliance and Identity Fundamentals'],
    ['Multi-Agent AI Solutions Expert', 'Multi–Agent AI Solutions Expert'],
    ['Dynamics 365 Sales AI Consultant Associate (beta)', 'Dynamics 365 Sales AI Consultant Associate'],
    ['Dynamics 365 Sales AI Consultant Associate (Beta) ', 'Dynamics 365 Sales AI Consultant Associate'],
  ];
  for (const [a, b] of same) assert.equal(normalizeCertName(a), normalizeCertName(b));
});

test('a matching name files nothing', () => {
  const { nameIssues, unverified } = diffExam(stored, { ...live, certName: `${stored.cert} (beta)` });
  assert.deepEqual(nameIssues, []);
  assert.ok(!unverified.includes('cert name'));
});

test('a renamed certification files an issue and no patch', () => {
  const renamed = 'Microsoft Certified: Azure Cosmos DB Developer Specialty';
  const { nameIssues, patches } = diffExam(stored, { ...live, certName: renamed });
  assert.equal(patches.length, 0);
  assert.equal(nameIssues.length, 1);
  assert.equal(nameIssues[0].title, `Freshness check: DP-420 certification name changed to "${renamed}"`);
  assert.match(nameIssues[0].body, /Stored: Microsoft Certified: Azure Cosmos DB AI Developer Associate/);
  assert.match(nameIssues[0].body, /Live: Microsoft Certified: Azure Cosmos DB Developer Specialty/);
  assert.match(nameIssues[0].body, /`CATALOG`/);
});

test('an unreadable name is unverified, not a rename', () => {
  const { nameIssues, unverified } = diffExam(stored, { ...live, certName: null });
  assert.deepEqual(nameIssues, []);
  assert.ok(unverified.includes('cert name'));
});

function fakePage({ status, h1 }) {
  return {
    goto: async () => ({ status: () => status }),
    locator: selector => ({
      first: () => ({
        waitFor: async () => {},
        innerText: async () => 'page text',
        textContent: async () => {
          assert.equal(selector, 'main h1');
          return h1;
        },
      }),
    }),
  };
}

test('the scrape reads the h1 of a page that exists', async () => {
  const result = await scrapeExam(fakePage({ status: 200, h1: `  ${stored.cert}\n` }), stored);
  assert.equal(result.certName, stored.cert);
});

test('the h1 of a 404 page is not taken for a name', async () => {
  const result = await scrapeExam(fakePage({ status: 404, h1: '404 - Page not found' }), stored);
  assert.equal(result.certName, null);
});

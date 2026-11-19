/* eslint-disable no-console */
// Local test: node actions/dispatch/test.js  (GitHub is mocked; nothing is sent)
const assert = require('node:assert');
const { main, findDamPaths, sheetsFor } = require('./index.js');

const routes = { '/content/dam/hol/lowfare-destinations/': 'lowfare-destinations' };

(async () => {
  const sample = {
    type: 'aem.sites.contentFragment.published',
    data: { user: { imsUserId: 'x' }, path: '/content/dam/hol/lowfare-destinations/seoul', model: { id: 'm' } },
  };
  assert.deepStrictEqual([...findDamPaths(sample)], ['/content/dam/hol/lowfare-destinations/seoul']);
  assert.deepStrictEqual(sheetsFor(['/content/dam/hol/lowfare-destinations/seoul'], routes), ['lowfare-destinations']);
  assert.deepStrictEqual(sheetsFor(['/content/dam/wknd/x'], routes), []);

  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return { status: 204 };
  };
  const inputs = { GITHUB_TOKEN: 't', GITHUB_REPO: 'edshol/edsue5', SHEET_ROUTES: JSON.stringify(routes) };

  const r1 = await main({ ...sample, ...inputs });
  assert.strictEqual(r1.statusCode, 200);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/edshol/edsue5/dispatches');
  assert.deepStrictEqual(calls[0].body, { event_type: 'cf-published', client_payload: { sheet: 'lowfare-destinations' } });

  // Unrelated CF -> no dispatch
  const r2 = await main({ type: 'x', data: { path: '/content/dam/wknd/a' }, ...inputs });
  assert.deepStrictEqual(r2.body.results, []);
  assert.strictEqual(calls.length, 1);

  // Missing token -> 500, nothing sent
  const r3 = await main({ ...sample, GITHUB_REPO: 'r' });
  assert.strictEqual(r3.statusCode, 500);
  console.log('all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

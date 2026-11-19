#!/usr/bin/env node
/* eslint-disable no-console */
/*
 * Create / update the GraphQL persisted queries in config.json (sheets + apis) on AEM author.
 * Publish them afterwards (AEM GraphiQL IDE > Publish, or replicate
 * /conf/<conf>/settings/graphql/persistentQueries/<name>).
 *
 * Usage: AEM_TOKEN=<local development token> node tools/cf-sheets/persist-queries.mjs
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(join(HERE, 'config.json'), 'utf8'));
const token = process.env.AEM_TOKEN;
if (!token) {
  console.error('AEM_TOKEN is required (Developer Console > Local token)');
  process.exit(1);
}

let failed = 0;
// Sheets (read by the GitHub Action) and APIs (read by blocks at display time).
const entries = [...(config.sheets || []), ...(config.apis || [])];
await Promise.all(entries.map(async (entry) => {
  const query = await readFile(join(HERE, entry.query), 'utf8');
  const url = `${config.authorOrigin}/graphql/persist.json/${entry.persistedQuery}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // Short cache settings for data that changes often (e.g. fares).
  const body = entry.cacheControl || entry.surrogateControl
    ? JSON.stringify({
      query,
      ...(entry.cacheControl && { 'cache-control': entry.cacheControl }),
      ...(entry.surrogateControl && { 'surrogate-control': entry.surrogateControl }),
    })
    : query;
  // PUT creates; POST updates an existing query.
  let resp = await fetch(url, { method: 'PUT', headers, body });
  if (resp.status === 409) resp = await fetch(url, { method: 'POST', headers, body });
  const text = await resp.text();
  console.log(`${entry.persistedQuery}: HTTP ${resp.status} ${text.slice(0, 200)}`);
  if (!resp.ok) failed += 1;
}));
process.exit(failed ? 1 : 0);

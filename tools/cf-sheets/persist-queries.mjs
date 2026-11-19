#!/usr/bin/env node
/* eslint-disable no-console */
/*
 * Create / update the GraphQL persisted queries listed in config.json on AEM author.
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
await Promise.all(config.sheets.map(async (sheet) => {
  const query = await readFile(join(HERE, sheet.query), 'utf8');
  const url = `${config.authorOrigin}/graphql/persist.json/${sheet.persistedQuery}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // PUT creates; POST updates an existing query.
  let resp = await fetch(url, { method: 'PUT', headers, body: query });
  if (resp.status === 409) resp = await fetch(url, { method: 'POST', headers, body: query });
  const body = await resp.text();
  console.log(`${sheet.persistedQuery}: HTTP ${resp.status} ${body.slice(0, 200)}`);
  if (!resp.ok) failed += 1;
}));
process.exit(failed ? 1 : 0);

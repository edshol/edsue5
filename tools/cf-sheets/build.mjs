#!/usr/bin/env node
/* eslint-disable no-console, no-underscore-dangle */
/*
 * CF -> JSON sheet
 *
 * Reads PUBLISHED Content Fragments from AEM Publish (GraphQL persisted queries, public,
 * no credentials) and writes them as EDS sheet JSON files into the repo (data/cf/*.json).
 * The EDS code bus serves them same-origin from *.aem.page / *.aem.live.
 *
 * Authors only edit + publish CFs. A GitHub Action runs this script and commits changes.
 *
 * Usage: node tools/cf-sheets/build.mjs [sheet-name ...]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const config = JSON.parse(await readFile(join(HERE, 'config.json'), 'utf8'));
const only = process.argv.slice(2);

/** Content reference -> absolute delivery URL (web-optimized if available). */
function refToUrl(ref) {
  if (!ref || typeof ref !== 'object') return ref ?? '';
  if (ref._dynamicUrl) return `${config.publishOrigin}${ref._dynamicUrl}`;
  if (ref._publishUrl) return ref._publishUrl;
  if (ref._path) return `${config.publishOrigin}${ref._path}`;
  return '';
}

/** GraphQL item -> flat sheet row. _path becomes "path"; references become URLs. */
function toRow(item) {
  const row = {};
  Object.entries(item).forEach(([key, value]) => {
    const col = key === '_path' ? 'path' : key;
    if (Array.isArray(value)) row[col] = value.map(refToUrl).join(', ');
    else if (value && typeof value === 'object') row[col] = refToUrl(value);
    else row[col] = value ?? '';
  });
  return row;
}

async function fetchItems(sheet) {
  // CF_FETCH_ORIGIN lets you test against another host; delivery URLs still use publishOrigin.
  const origin = process.env.CF_FETCH_ORIGIN || config.publishOrigin;
  // Cache buster: persisted query responses are CDN-cached (s-maxage=7200) on AEM Publish.
  const url = `${origin}/graphql/execute.json/${sheet.persistedQuery}?cb=${Date.now()}`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`${sheet.name}: ${url} -> HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.errors?.length) throw new Error(`${sheet.name}: ${JSON.stringify(json.errors).slice(0, 300)}`);
  const items = json.data?.[sheet.list]?.items;
  if (!Array.isArray(items)) throw new Error(`${sheet.name}: data.${sheet.list}.items not found`);
  return items;
}

async function readPrevious(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

let failed = 0;
await Promise.all(config.sheets
  .filter((sheet) => !only.length || only.includes(sheet.name))
  .map(async (sheet) => {
    const file = join(ROOT, sheet.output);
    try {
      const rows = (await fetchItems(sheet)).map(toRow)
        .sort((a, b) => `${a.path}`.localeCompare(`${b.path}`));
      const previous = await readPrevious(file);
      // Safety: never wipe a sheet because of an empty response (e.g. mid-replication).
      if (!rows.length && previous?.data?.length && !sheet.allowEmpty) {
        throw new Error(`${sheet.name}: 0 items returned, keeping the previous ${previous.data.length} rows`);
      }
      const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const out = {
        total: rows.length,
        offset: 0,
        limit: rows.length,
        columns,
        data: rows,
        ':type': 'sheet',
      };
      const text = `${JSON.stringify(out, null, 2)}\n`;
      if (previous && `${JSON.stringify(previous, null, 2)}\n` === text) {
        console.log(`${sheet.name}: unchanged (${rows.length} rows)`);
        return;
      }
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text);
      console.log(`${sheet.name}: wrote ${rows.length} rows -> ${sheet.output}`);
    } catch (e) {
      failed += 1;
      console.error(`ERROR ${e.message}`);
    }
  }));
process.exit(failed ? 1 : 0);

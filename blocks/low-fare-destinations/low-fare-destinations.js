/*
 * Low Fare Destinations (Universal Editor + Content Fragments)
 *
 * Authors only pick WHICH destinations to show and in WHAT order
 * ("MH Low Fare Destination" CFs, model /conf/global/.../mh-low-fare-destination).
 *   - Destination data (airport code, city name, images, link) lives in the CF,
 *     managed once and reused by every market.
 *   - The origin comes from the page path (scripts/market.js), not from authoring.
 *   - Prices come from the fare API, never from authoring.
 *
 * CF data source:
 *   - AEM author (Universal Editor): Sites API /adobe/sites/cf/fragments (same origin, drafts)
 *   - *.aem.page / *.aem.live: the CF sheet /data/cf/lowfare-destinations.json, generated from
 *     PUBLISHED CFs by tools/cf-sheets (GitHub Action). Authors only edit + publish CFs.
 */
import { createOptimizedPicture, getMetadata } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';
import { resolveOrigin } from '../../scripts/market.js';

const CF_SHEET = '/data/cf/lowfare-destinations.json';
/*
 * Fare API (called at display time, never authored).
 * Default: MH Fare CFs exposed like an API by the persisted query global/lowfare-fares.
 * Switch to the real external API by setting the metadata "low-fare-api" (e.g. one row in the
 * bulk metadata sheet for /**) to a URL template with {origin} and optionally {destination}.
 */
const PUBLISH_ORIGIN = 'https://publish-p236456-e2388687.adobeaemcloud.com';
const DEFAULT_FARE_API = '/graphql/execute.json/global/lowfare-fares;origin={origin}';
const MAX_DESTINATIONS = 15;
const DEFAULT_FARE_CACHE_SECONDS = 10; // fares change often; metadata "low-fare-cache-seconds"
const DESKTOP_MQ = '(min-width: 900px)';

const isAuthor = () => window.location.hostname.startsWith('author-');
const cleanPath = (href) => {
  try {
    return new URL(href, window.location.href).pathname.replace(/\.html$/, '').replace(/\/$/, '');
  } catch (e) {
    return '';
  }
};
const parentOf = (path) => path.substring(0, path.lastIndexOf('/'));

const jsonRequests = new Map();
function getJson(url, init) {
  if (!jsonRequests.has(url)) {
    jsonRequests.set(url, fetch(url, init)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return jsonRequests.get(url);
}

/** Author (Sites API) item -> tile data. Fields come as [{ name, values: [...] }]. */
function fromSitesApi(item) {
  const v = (name) => `${(item.fields || []).find((f) => f.name === name)?.values?.[0] ?? ''}`.trim();
  return {
    path: item.path,
    airportCode: v('airportCode').toUpperCase(),
    cityName: v('cityName'),
    link: v('link'),
    imagePortrait: v('imagePortrait'),
    imageLandscape: v('imageLandscape'),
  };
}

/** CF sheet row -> tile data (references are already absolute Publish URLs). */
function fromSheetRow(row) {
  return {
    path: row.path,
    airportCode: `${row.airportCode || ''}`.trim().toUpperCase(),
    cityName: `${row.cityName || ''}`.trim(),
    link: `${row.link || ''}`.trim(),
    imagePortrait: `${row.imagePortrait || ''}`.trim(),
    imageLandscape: `${row.imageLandscape || ''}`.trim(),
  };
}

/**
 * Selected CFs -> Map<path, tile data>.
 * Author: live drafts from the Sites API (one request per CF folder).
 * EDS:    the CF sheet (one same-origin, CDN-cached request).
 */
async function loadDestinations(paths) {
  const map = new Map();
  if (isAuthor()) {
    const folders = [...new Set(paths.map(parentOf).filter(Boolean))];
    const responses = await Promise.all(folders.map((folder) => getJson(
      `/adobe/sites/cf/fragments?path=${encodeURIComponent(folder)}&projection=full&limit=50`,
      { credentials: 'include' },
    )));
    responses.forEach((json) => (json?.items || []).forEach((item) => {
      if (item?.path) map.set(item.path, fromSitesApi(item));
    }));
    return map;
  }
  const sheet = getMetadata('low-fare-destinations-sheet') || `${window.hlx?.codeBasePath || ''}${CF_SHEET}`;
  const json = await getJson(sheet);
  (json?.data || []).forEach((row) => {
    if (row?.path) map.set(row.path, fromSheetRow(row));
  });
  return map;
}

function withWidth(url, width) {
  if (!url) return url;
  const u = new URL(url, window.location.href);
  u.searchParams.set('width', width);
  u.searchParams.set('preferwebp', 'true');
  return u.toString();
}

function buildPicture(cf) {
  const portrait = cf.imagePortrait;
  const landscape = cf.imageLandscape || portrait;
  const base = portrait || landscape;
  if (!base) return null;
  // Same-origin (author DAM): use the standard EDS helper.
  if (base.startsWith('/')) {
    const picture = createOptimizedPicture(base, cf.cityName, false, [{ width: '750' }]);
    if (landscape && landscape !== base) {
      const desktop = createOptimizedPicture(landscape, cf.cityName, false, [
        { media: DESKTOP_MQ, width: '1200' },
      ]);
      desktop.querySelectorAll(`source[media="${DESKTOP_MQ}"]`).forEach((s) => picture.prepend(s));
    }
    return picture;
  }
  // AEM Publish delivery URLs.
  const picture = document.createElement('picture');
  const source = document.createElement('source');
  source.media = DESKTOP_MQ;
  source.srcset = withWidth(landscape, 1200);
  const img = document.createElement('img');
  img.src = withWidth(base, 750);
  img.alt = cf.cityName || '';
  img.loading = 'lazy';
  picture.append(source, img);
  return picture;
}

/* ---------- fares (never authored) ---------- */

const pick = (obj, ...keys) => keys.map((k) => obj?.[k])
  .find((v) => v !== undefined && v !== null);
const code = (v) => `${v ?? ''}`.trim().toUpperCase();

/** First array of fare-like objects: sheet rows, GraphQL list items, { fares: [...] } */
function fareRows(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.fares)) return json.fares;
  if (Array.isArray(json.data)) return json.data;
  const nested = [json.fares, json.data].filter((v) => v && typeof v === 'object');
  if (json.data && typeof json.data === 'object') nested.push(...Object.values(json.data));
  return nested.map(fareRows).find(Array.isArray) || null;
}

/**
 * Normalizes the fare API response. Accepts:
 *  - a list (sheet rows, GraphQL items, { fares }) with origin/destination/price/currency
 *    (any letter case), filtered by route
 *  - a single fare object { price, currency } (per-route endpoint)
 */
export function pickFare(json, origin, destination) {
  if (!json) return null;
  const rows = fareRows(json);
  const data = rows
    ? rows.find((r) => code(pick(r, 'destination', 'Destination')) === destination
      && (!pick(r, 'origin', 'Origin') || code(pick(r, 'origin', 'Origin')) === origin))
    : (json.data || json);
  if (!data) return null;
  const raw = `${data.price ?? data.Price ?? data.amount ?? ''}`.replace(/,/g, '').trim();
  const price = Number(raw);
  if (!raw || !Number.isFinite(price)) return null;
  return { price, currency: `${data.currency || data.Currency || 'MYR'}`.trim() };
}

async function fetchFare(template, origin, destination, ttlSeconds) {
  const cacheKey = `lfd:${origin}-${destination}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (ttlSeconds > 0 && cached && Date.now() - cached.ts < ttlSeconds * 1000) return cached.fare;
  } catch (e) { /* storage unavailable */ }
  const url = template
    .replace('{origin}', encodeURIComponent(origin))
    .replace('{destination}', encodeURIComponent(destination));
  const fare = pickFare(await getJson(url), origin, destination);
  if (fare && ttlSeconds > 0) {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), fare }));
    } catch (e) { /* ignore */ }
  }
  return fare;
}

function formatFare({ price, currency }) {
  return `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(price)}`;
}

/* ---------- authoring rows ---------- */

/**
 * Rows (Universal Editor renders block fields first, then one row per item):
 *   - text-only row          -> title
 *   - link to a non-DAM page -> "View all"
 *   - link to /content/dam/  -> a destination item (Destination CF)
 */
function parseRows(block) {
  const config = { title: '', viewAll: null };
  const items = [];
  [...block.children].forEach((row) => {
    const link = row.querySelector('a');
    const href = link?.getAttribute('href') || '';
    const text = row.textContent.trim();
    // In Universal Editor every item row is instrumented, even before a CF is chosen.
    const isItemRow = row.dataset.aueModel === 'low-fare-destination';
    if (isItemRow || href.includes('/content/dam/') || /^\/content\/dam\//.test(text)) {
      const raw = href || (/^\/content\/dam\//.test(text) ? text : '');
      items.push({ row, path: raw ? cleanPath(raw) : '' });
    } else if (link) {
      config.viewAll = { href: link.href, text: link.textContent.trim() };
    } else if (text && !config.title) {
      config.title = text;
    }
  });
  return { config, items: items.slice(0, MAX_DESTINATIONS) };
}

function buildTile(cf, row, priceLabel) {
  const li = document.createElement('li');
  li.className = 'lfd-tile';
  moveInstrumentation(row, li);
  li.dataset.destination = cf.airportCode;

  const inner = document.createElement(cf.link ? 'a' : 'div');
  inner.className = 'lfd-tile-inner';
  if (cf.link) inner.href = cf.link;

  const picture = buildPicture(cf);
  if (picture) inner.append(picture);

  const text = document.createElement('div');
  text.className = 'lfd-tile-text';
  text.innerHTML = '<p class="lfd-name"></p><p class="lfd-label"></p><p class="lfd-price" aria-live="polite"></p>';
  text.querySelector('.lfd-name').textContent = cf.cityName;
  text.querySelector('.lfd-label').textContent = priceLabel;
  inner.append(text);
  li.append(inner);
  return li;
}

function buildPlaceholder(row, message) {
  const li = document.createElement('li');
  li.className = 'lfd-tile lfd-missing';
  moveInstrumentation(row, li);
  li.innerHTML = '<div class="lfd-tile-inner"><div class="lfd-tile-text"><p class="lfd-name"></p></div></div>';
  li.querySelector('.lfd-name').textContent = message;
  return li;
}

export default async function decorate(block) {
  const { config, items } = parseRows(block);
  const origin = resolveOrigin();
  const priceLabel = getMetadata('low-fare-price-label') || 'All-in return from';

  const heading = document.createElement('h2');
  heading.className = 'lfd-title';
  heading.textContent = `${config.title || 'Explore our top destinations from'} ${origin?.city || ''}`.trim();

  const list = document.createElement('ul');
  list.className = 'lfd-tiles';

  if (![...block.classList].some((c) => c.startsWith('variant-'))) block.classList.add('variant-2');
  if (origin) block.dataset.origin = origin.code;

  const destinations = await loadDestinations(items.map((i) => i.path));
  const tiles = [];
  items.forEach(({ row, path }) => {
    const cf = destinations.get(path);
    if (cf && cf.airportCode !== origin?.code) {
      const tile = buildTile(cf, row, priceLabel);
      tiles.push({ tile, cf });
      list.append(tile);
    } else if (isAuthor()) {
      // Visible only in Universal Editor, so authors can select the item and fix it.
      let message = `CF が見つかりません: ${path}`;
      if (!path) message = '行き先の CF を選んでください（右のプロパティ → Destination）';
      else if (cf) message = `出発地と同じ空港です: ${cf.airportCode}`;
      list.append(buildPlaceholder(row, message));
    }
  });

  block.replaceChildren(heading, list);
  if (isAuthor() && !items.length) {
    const hint = document.createElement('p');
    hint.className = 'lfd-hint';
    hint.textContent = 'コンテンツツリーでこのブロックを選び、「+」→ Low Fare Destination で行き先を追加してください。';
    block.append(hint);
  }

  if (config.viewAll?.href) {
    const p = document.createElement('p');
    p.className = 'button-container lfd-view-all';
    const a = document.createElement('a');
    a.className = 'button primary';
    a.href = config.viewAll.href;
    a.textContent = config.viewAll.text && !config.viewAll.text.startsWith('http') && !config.viewAll.text.startsWith('/')
      ? config.viewAll.text : 'View all';
    p.append(a);
    block.append(p);
  }

  // Author (UE): same-origin persisted query = draft fares. EDS: AEM Publish.
  const fareApi = getMetadata('low-fare-api')
    || `${isAuthor() ? '' : PUBLISH_ORIGIN}${DEFAULT_FARE_API}`;
  const cacheMeta = Number.parseInt(getMetadata('low-fare-cache-seconds'), 10);
  const ttl = Number.isFinite(cacheMeta) ? cacheMeta : DEFAULT_FARE_CACHE_SECONDS;
  if (!origin || !fareApi) {
    block.classList.add('no-price');
    return;
  }
  tiles.forEach(async ({ tile, cf }) => {
    const fare = await fetchFare(fareApi, origin.code, cf.airportCode, ttl);
    if (fare) {
      tile.querySelector('.lfd-price').textContent = formatFare(fare);
      tile.classList.add('has-price');
    } else {
      tile.classList.add('price-unavailable');
    }
  });
}

/* eslint-disable no-underscore-dangle -- AEM GraphQL system fields (_path, _dynamicUrl, ...) */
/*
 * Low Fare Destinations (Universal Editor + Content Fragments)
 *
 * Authors only pick WHICH destinations to show and in WHAT order (Destination CFs).
 *   - Destination data (airport code, city name, images, link) lives in the "destination"
 *     Content Fragment model, managed once and reused by every market.
 *   - The origin comes from the page path (scripts/market.js), not from authoring.
 *   - Prices come from the fare API, never from authoring.
 *
 * CF data is read with the AEM GraphQL persisted query <PQ_NAME>:
 *   - on AEM author (Universal Editor): same origin, draft content
 *   - on *.aem.page / *.aem.live: AEM Publish (needs CORS for the EDS origins)
 */
import { createOptimizedPicture, getMetadata } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';
import { resolveOrigin } from '../../scripts/market.js';

const PUBLISH_ORIGIN = 'https://publish-p135178-e1337005.adobeaemcloud.com';
const PQ_NAME = 'eds-ue/destinations';
const DEMO_FARE_API = '/data/demo-fares.json';
const MAX_DESTINATIONS = 15;
const FARE_CACHE_TTL = 30 * 60 * 1000;
const DESKTOP_MQ = '(min-width: 900px)';

const isAuthor = () => window.location.hostname.startsWith('author-');
const aemOrigin = () => (isAuthor() ? '' : (getMetadata('aem-publish-origin') || PUBLISH_ORIGIN));
const cleanPath = (href) => {
  try {
    return new URL(href, window.location.href).pathname.replace(/\.html$/, '').replace(/\/$/, '');
  } catch (e) {
    return '';
  }
};

const jsonRequests = new Map();
function getJson(url, init) {
  if (!jsonRequests.has(url)) {
    jsonRequests.set(url, fetch(url, init)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return jsonRequests.get(url);
}

/** All Destination CFs, keyed by DAM path. One cacheable request per page. */
async function loadDestinations() {
  const json = await getJson(`${aemOrigin()}/graphql/execute.json/${PQ_NAME}`, {
    credentials: isAuthor() ? 'include' : 'omit',
  });
  const items = json?.data?.destinationList?.items || [];
  return new Map(items.map((item) => [item._path, item]));
}

/** Image URL for the current tier. Author: DAM path. Publish: web-optimized delivery. */
function imageUrl(ref) {
  if (!ref) return '';
  if (isAuthor()) return ref._path || '';
  if (ref._dynamicUrl) return `${aemOrigin()}${ref._dynamicUrl}`;
  return ref._publishUrl || '';
}

function withWidth(url, width) {
  if (!url) return url;
  const u = new URL(url, window.location.href);
  u.searchParams.set('width', width);
  u.searchParams.set('preferwebp', 'true');
  return u.toString();
}

function buildPicture(cf) {
  const portrait = imageUrl(cf.imagePortrait);
  const landscape = imageUrl(cf.imageLandscape) || portrait;
  const base = portrait || landscape;
  if (!base) return null;
  // Same-origin (EDS media / author DAM): use the standard EDS helper.
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

export function pickFare(json, origin, destination) {
  if (!json) return null;
  const sheet = json.fares || json.data;
  const rows = Array.isArray(sheet) ? sheet : sheet?.data;
  const data = Array.isArray(rows)
    ? rows.find((r) => `${r.Origin || ''}`.trim().toUpperCase() === origin
      && `${r.Destination || ''}`.trim().toUpperCase() === destination)
    : (json.data || json);
  if (!data) return null;
  const raw = `${data.price ?? data.Price ?? data.amount ?? ''}`.replace(/,/g, '').trim();
  const price = Number(raw);
  if (!raw || !Number.isFinite(price)) return null;
  return { price, currency: `${data.currency || data.Currency || 'MYR'}`.trim() };
}

async function fetchFare(template, origin, destination) {
  const cacheKey = `lfd:${origin}-${destination}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached && Date.now() - cached.ts < FARE_CACHE_TTL) return cached.fare;
  } catch (e) { /* storage unavailable */ }
  const url = template
    .replace('{origin}', encodeURIComponent(origin))
    .replace('{destination}', encodeURIComponent(destination));
  const fare = pickFare(await getJson(url), origin, destination);
  if (fare) {
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
    if (href.includes('/content/dam/') || /^\/content\/dam\//.test(text)) {
      items.push({ row, path: cleanPath(href || text) });
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

  const destinations = await loadDestinations();
  const tiles = [];
  items.forEach(({ row, path }) => {
    const cf = destinations.get(path);
    if (cf && cf.airportCode !== origin?.code) {
      const tile = buildTile(cf, row, priceLabel);
      tiles.push({ tile, cf });
      list.append(tile);
    } else if (isAuthor()) {
      // Visible only in Universal Editor, so authors can fix the selection.
      list.append(buildPlaceholder(row, cf ? `出発地と同じ空港です: ${cf.airportCode}` : `CF が見つかりません: ${path}`));
    }
  });

  block.replaceChildren(heading, list);

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

  const fareApi = getMetadata('low-fare-api') || `${window.hlx?.codeBasePath || ''}${DEMO_FARE_API}`;
  if (!origin || !fareApi) {
    block.classList.add('no-price');
    return;
  }
  tiles.forEach(async ({ tile, cf }) => {
    const fare = await fetchFare(fareApi, origin.code, cf.airportCode);
    if (fare) {
      tile.querySelector('.lfd-price').textContent = formatFare(fare);
      tile.classList.add('has-price');
    } else {
      tile.classList.add('price-unavailable');
    }
  });
}

/*
 * Market / origin resolution shared by blocks.
 *
 * The departure airport is decided by the page path (the market), not by authors:
 *   1. page metadata "origin" / "origin-city"
 *      (set per market with bulk metadata, e.g. /my/** -> KUL)
 *   2. built-in default for the market in the path, at any depth
 *      (e.g. /sg/en/home -> sg, /hol/my/en/home -> my)
 *   3. ?origin=XXX  -- only on non-production hosts (localhost, *.aem.page, AEM author) for testing
 */
import { getMetadata } from './aem.js';

/* Defaults per market. Bulk metadata overrides these; review with MAG before go-live. */
export const MARKET_ORIGINS = {
  my: { code: 'KUL', city: 'Kuala Lumpur' },
  sg: { code: 'SIN', city: 'Singapore' },
  th: { code: 'BKK', city: 'Bangkok' },
  id: { code: 'CGK', city: 'Jakarta' },
  ph: { code: 'MNL', city: 'Manila' },
  vn: { code: 'SGN', city: 'Ho Chi Minh City' },
  au: { code: 'SYD', city: 'Sydney' },
  nz: { code: 'AKL', city: 'Auckland' },
  in: { code: 'DEL', city: 'Delhi' },
  jp: { code: 'NRT', city: 'Tokyo' },
  kr: { code: 'ICN', city: 'Seoul' },
  cn: { code: 'PVG', city: 'Shanghai' },
  hk: { code: 'HKG', city: 'Hong Kong' },
  tw: { code: 'TPE', city: 'Taipei' },
  uk: { code: 'LHR', city: 'London' },
  qa: { code: 'DOH', city: 'Doha' },
  fr: { code: 'CDG', city: 'Paris' },
};

/** Site-relative path: strips the AEM author prefix (/content/<site>) and .html */
export function sitePath(pathname = window.location.pathname) {
  return pathname.replace(/^\/content\/[^/]+/, '').replace(/\.html$/, '') || '/';
}

/**
 * Market = the first path segment that is a known market code, at any depth:
 *   /my/en/home -> my,  /hol/my/en/home -> my,  /content/eds-ue/hol/sg/en -> sg
 */
export function marketOf(pathname, markets = MARKET_ORIGINS) {
  return sitePath(pathname).split('/').filter(Boolean)
    .map((seg) => seg.toLowerCase())
    .find((seg) => Object.prototype.hasOwnProperty.call(markets, seg)) || '';
}

export function isProductionHost(hostname = window.location.hostname) {
  return !(hostname === 'localhost'
    || hostname.endsWith('.aem.page')
    || hostname.endsWith('.hlx.page')
    || hostname.startsWith('author-'));
}

/** @returns {{ code: string, city: string, source: string } | null} */
export function resolveOrigin({
  pathname = window.location.pathname,
  search = window.location.search,
} = {}) {
  if (!isProductionHost()) {
    const debug = new URLSearchParams(search).get('origin');
    if (debug && /^[A-Za-z]{3}$/.test(debug)) {
      const code = debug.toUpperCase();
      const known = Object.values(MARKET_ORIGINS).find((o) => o.code === code);
      return { code, city: known?.city || code, source: 'query' };
    }
  }
  const metaCode = getMetadata('origin');
  if (/^[A-Za-z]{3}$/.test(metaCode)) {
    const code = metaCode.toUpperCase();
    const city = getMetadata('origin-city')
      || Object.values(MARKET_ORIGINS).find((o) => o.code === code)?.city || code;
    return { code, city, source: 'metadata' };
  }
  const market = MARKET_ORIGINS[marketOf(pathname)];
  return market ? { ...market, source: 'market' } : null;
}

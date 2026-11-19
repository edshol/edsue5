/*
 * Read Content Fragments at display time through AEM GraphQL persisted queries.
 *
 *   EDS (*.aem.page / *.aem.live): AEM Publish -> PUBLISHED CFs only (CDN-cached ~10 s)
 *   AEM author (UE / page preview):   same origin -> DRAFT CFs (check before publishing)
 *
 * Page metadata "<name>-api" (e.g. "injections-api") overrides the URL for testing.
 */
import { getMetadata } from './aem.js';

export const PUBLISH_ORIGIN = 'https://publish-p236456-e2388687.adobeaemcloud.com';

export const isAuthor = () => window.location.hostname.startsWith('author-');

/** Inside the Universal Editor canvas (an iframe on the author host). */
export const isEditorCanvas = () => isAuthor() && window.self !== window.top;

export function cfApiUrl(name) {
  return getMetadata(`${name}-api`)
    || `${isAuthor() ? '' : PUBLISH_ORIGIN}/graphql/execute.json/global/${name}`;
}

/** items[] of data.<list>, or [] on any error (never break the page). */
export async function fetchCfItems(name, list) {
  try {
    const resp = await fetch(cfApiUrl(name), isAuthor() ? { credentials: 'include' } : {});
    if (!resp.ok) return [];
    const json = await resp.json();
    return json?.data?.[list]?.items || [];
  } catch (e) {
    return [];
  }
}

/** CF multi-value text -> comma list used by the glob matcher. */
export const joinList = (v) => (Array.isArray(v) ? v.filter(Boolean).join(',') : `${v ?? ''}`);

/** long-text fields come back as { plaintext }. */
export const plain = (v) => (v && typeof v === 'object' ? `${v.plaintext ?? ''}` : `${v ?? ''}`);

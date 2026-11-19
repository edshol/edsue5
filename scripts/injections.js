/*
 * Authored JavaScript injections (EDS replacement for the AEM "Script executor").
 *
 * ALL authored JS lives in ONE place: "MH Injection" Content Fragments in
 * /content/dam/hol/injections. This loader never reads JS from anywhere else.
 *   - Who can change it = who has write access to that DAM folder (AEM user groups / ACL)
 *   - History           = CF version history + AEM audit log (who published what, when)
 *   - Editing           = AEM Content Fragment editor (multi-line "Script" field)
 * Published CFs reach the site within ~10 s (persisted query global/injections).
 * On AEM author the DRAFT CFs are used, so authors can check a change before publishing.
 *
 * MH Injection fields:
 *   injectionId  unique id, e.g. INJ-001 (duplicates are ignored)
 *   enabled      on = run
 *   paths        globs on the site path, e.g. /hol/my/en/*  (empty = all pages)
 *   exclude      globs to skip
 *   device       all | desktop | mobile
 *   timing       lazy (default, after blocks are decorated) | eager | delayed
 *   start/end    optional date-time window
 *   script       the JavaScript (runs inside an async function; `inject` helper is available)
 *   owner / ticket / note   audit trail only (not used at runtime)
 *
 * Kill switches: page metadata "injections: off", URL ?injections=off (debug).
 * Not run inside the Universal Editor canvas unless ?injections=on.
 *
 * Inside a script:
 *   const el = await inject.waitFor('.low-fare-destinations .lfd-price');
 *   inject.log('patched', el);
 */
import {
  fetchCfItems, isEditorCanvas, joinList, plain,
} from './cf-api.js';
import {
  isOff, isTrue, matchesContext, pageContext,
} from './overrides.js';

const PHASES = ['eager', 'lazy', 'delayed'];
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** MH Injection CF item -> rule. */
export function injectionRule(item) {
  return {
    id: `${item.injectionId || ''}`.trim(),
    Enabled: item.enabled,
    Path: joinList(item.paths),
    Exclude: joinList(item.exclude),
    Device: item.device,
    Start: item.start,
    End: item.end,
    timing: `${item.timing || 'lazy'}`.trim().toLowerCase(),
    code: plain(item.script),
    path: item._path, // eslint-disable-line no-underscore-dangle
  };
}

/** Pure selection logic (unit-testable): which injections run on this page. */
export function selectInjections(items, ctx) {
  const seen = new Set();
  return items.map(injectionRule)
    .filter((r) => {
      if (!SAFE_ID.test(r.id) || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .filter((r) => isTrue(r.Enabled) && r.code.trim() && PHASES.includes(r.timing))
    .filter((r) => matchesContext(r, ctx));
}

function emit(id, status, error) {
  document.dispatchEvent(new CustomEvent('mag:injection', { detail: { id, status, error: error?.message } }));
}

function waitFor(selector, { timeout = 10000, root = document } = {}) {
  return new Promise((resolve) => {
    const found = root.querySelector(selector);
    if (found) { resolve(found); return; }
    const observer = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    const target = root === document ? document.documentElement : root;
    observer.observe(target, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}

const started = new Set();

function installRuntime() {
  if (window.magInjections) return;
  window.magInjections = {
    context(id) {
      started.add(id);
      const prefix = `[injection ${id}]`;
      return {
        id,
        waitFor,
        // eslint-disable-next-line no-console
        log: (...args) => console.info(prefix, ...args),
        fail: (e) => {
          // eslint-disable-next-line no-console
          console.error(prefix, 'failed', e);
          emit(id, 'error', e);
        },
        done: () => emit(id, 'done'),
      };
    },
  };
}

/**
 * Wrap authored code: isolated async scope, error capture,
 * shown in DevTools as injections/<id>.js
 */
export function wrapScript(id, code) {
  return `(async (inject) => {\ntry {\nawait (async () => {\n${code}\n})();\ninject.done();\n} catch (e) { inject.fail(e); }\n})(window.magInjections.context(${JSON.stringify(id)}));\n//# sourceURL=injections/${id}.js`;
}

function runOne({ id, code }) {
  const el = document.createElement('script');
  // Reuse the page's CSP nonce if one is set.
  const nonce = document.querySelector('script[nonce]')?.nonce;
  if (nonce) el.nonce = nonce;
  el.dataset.injection = id;
  // textContent is never parsed as HTML, so "</script>" inside the code cannot break out.
  el.textContent = wrapScript(id, code);
  document.head.append(el);
  // Inline scripts execute synchronously on insertion; if context() was not reached,
  // the code has a syntax error or was blocked by CSP.
  if (!started.has(id)) {
    // eslint-disable-next-line no-console
    console.error(`[injection ${id}] did not start (syntax error or CSP block)`);
    emit(id, 'not-started');
  }
}

let loading;

/** Fetch the injections once (call early from loadEager, do not await). */
export function loadInjections() {
  if (loading) return loading;
  loading = (async () => {
    const params = new URLSearchParams(window.location.search);
    const pageMeta = document.head.querySelector('meta[name="injections"]')?.content;
    if (isOff(params.get('injections')) || isOff(pageMeta)) return [];
    if (isEditorCanvas() && !isTrue(params.get('injections'))) return [];
    return selectInjections(await fetchCfItems('injections', 'mhInjectionList'), pageContext());
  })();
  return loading;
}

/** Run the injections for one phase: 'eager' | 'lazy' | 'delayed'. */
export async function runInjections(phase) {
  const list = await loadInjections();
  const todo = list.filter((i) => i.timing === phase);
  if (!todo.length) return;
  installRuntime();
  todo.forEach(runOne);
}

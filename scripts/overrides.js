/*
 * Page overrides (no code): EDS replacement for the AEM "Script executor" injection.
 *
 * Authors create "MH Override" Content Fragments in /content/dam/hol/overrides and publish
 * them; the change shows on every matching page within ~10 s (persisted query global/overrides).
 * No authored JavaScript is executed here; real JS goes to injections (scripts/injections.js).
 *
 * MH Override fields:
 *   enabled   on = active
 *   paths     globs on the site path, e.g. /hol/my/en/*, /hol/sg/en/home  (empty = all pages)
 *   exclude   globs to skip
 *   device    all | desktop | mobile
 *   start/end optional date-time window
 *   selector  CSS selector, e.g. .low-fare-destinations .lfd-view-all a
 *   action    hide | show | text | html | attr | add-class | remove-class | remove
 *   value     text / html / "name=value" / class name
 */
import {
  fetchCfItems, isEditorCanvas, joinList, plain,
} from './cf-api.js';
import { sitePath } from './market.js';

export const DESKTOP_MQ = '(min-width: 900px)';

export function globToRegExp(glob) {
  const escaped = glob.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

const splitGlobs = (value) => `${value || ''}`.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

export const isTrue = (v) => v === true || /^(true|yes|on|1)$/i.test(`${v ?? ''}`.trim());
export const isOff = (v) => v === false || /^(false|no|off|0)$/i.test(`${v ?? ''}`.trim());

/**
 * Shared targeting used by overrides and injections:
 * Path (comma-separated globs, default *), Exclude (globs), Device, Start, End.
 */
export function matchesContext(rule, { path, now = new Date(), isDesktop = true }) {
  const include = splitGlobs(rule.Path);
  if (!(include.length ? include : ['*']).some((g) => globToRegExp(g).test(path))) return false;
  if (splitGlobs(rule.Exclude).some((g) => globToRegExp(g).test(path))) return false;
  const device = `${rule.Device || 'all'}`.trim().toLowerCase();
  if (device === 'desktop' && !isDesktop) return false;
  if (device === 'mobile' && isDesktop) return false;
  if (rule.Start && now < new Date(rule.Start)) return false;
  if (rule.End && now > new Date(rule.End)) return false;
  return true;
}

export function pageContext() {
  return {
    path: sitePath(window.location.pathname),
    isDesktop: window.matchMedia(DESKTOP_MQ).matches,
  };
}

/** MH Override CF item -> rule (same shape the matcher uses for both features). */
export function overrideRule(item, i) {
  return {
    id: `ov${i}`,
    Enabled: item.enabled,
    Path: joinList(item.paths),
    Exclude: joinList(item.exclude),
    Device: item.device,
    Start: item.start,
    End: item.end,
    Selector: `${item.selector || ''}`.trim(),
    action: `${item.action || ''}`.trim().toLowerCase(),
    Value: plain(item.value),
  };
}

export function selectOverrides(items, ctx) {
  return items.map(overrideRule)
    .filter((r) => isTrue(r.Enabled) && r.Selector && matchesContext(r, ctx));
}

function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script, iframe, object, embed, style, link, meta').forEach((n) => n.remove());
  tpl.content.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach(({ name, value }) => {
      if (name.startsWith('on') || /^\s*javascript:/i.test(value)) el.removeAttribute(name);
    });
  });
  return tpl;
}

/* Each action is idempotent so re-running it from the MutationObserver never loops. */
const ACTIONS = {
  show: (el) => { if (el.style.display === 'none' || el.hidden) { el.hidden = false; el.style.removeProperty('display'); } },
  text: (el, value) => { if (el.textContent !== value) el.textContent = value; },
  html: (el, value, id) => {
    if (el.dataset.overrideApplied === id) return;
    el.replaceChildren(sanitizeHtml(value).content.cloneNode(true));
    el.dataset.overrideApplied = id;
  },
  attr: (el, value) => {
    const idx = value.indexOf('=');
    const name = (idx < 0 ? value : value.slice(0, idx)).trim();
    const val = idx < 0 ? '' : value.slice(idx + 1).trim();
    if (!name || name.startsWith('on')) return;
    if (el.getAttribute(name) !== val) el.setAttribute(name, val);
  },
  'add-class': (el, value) => el.classList.add(...value.split(/\s+/).filter(Boolean)),
  'remove-class': (el, value) => el.classList.remove(...value.split(/\s+/).filter(Boolean)),
  remove: (el) => el.remove(),
};

function applyDomRules(rules, root = document) {
  rules.forEach((rule) => {
    const action = ACTIONS[rule.action];
    try {
      root.querySelectorAll(rule.Selector).forEach((el) => action(el, rule.Value, rule.id));
    } catch (e) {
      // invalid selector in a CF: skip the rule rather than breaking the page
    }
  });
}

/**
 * Fetch and apply overrides. Call (without awaiting) from loadEager() in scripts.js
 * so "hide" rules are injected as CSS as early as possible.
 * Not applied inside the Universal Editor canvas (authors edit the original content there).
 */
export async function loadOverrides() {
  const params = new URLSearchParams(window.location.search);
  if (isOff(params.get('overrides'))) return;
  if (isEditorCanvas() && !isTrue(params.get('overrides'))) return;

  const rules = selectOverrides(await fetchCfItems('overrides', 'mhOverrideList'), pageContext());
  if (!rules.length) return;

  // 1) hide: CSS, applied immediately and to anything rendered later
  const hideCss = rules.filter((r) => r.action === 'hide')
    .map((r) => `${r.Selector}{display:none!important}`);
  if (hideCss.length) {
    const style = document.createElement('style');
    style.id = 'page-overrides';
    style.textContent = hideCss.join('\n');
    document.head.append(style);
  }

  // 2) DOM rules: apply now and whenever blocks/fragments decorate later
  const domRules = rules.filter((r) => ACTIONS[r.action]);
  if (domRules.length) {
    applyDomRules(domRules);
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; applyDomRules(domRules); });
    }).observe(document.body, { childList: true, subtree: true });
  }
}

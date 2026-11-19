/*
 * I/O Events -> GitHub repository_dispatch
 *
 * Registered in Adobe Developer Console as the "Runtime action" receiver of AEM
 * Content Fragment events (published / unpublished / deleted). For every event whose
 * DAM path matches SHEET_ROUTES, it asks GitHub to rebuild that sheet immediately
 * (workflow "CF sheets", event type "cf-published").
 *
 * Inputs (app.config.yaml / .env): GITHUB_TOKEN, GITHUB_REPO, SHEET_ROUTES
 */

/** Every /content/dam/... string anywhere in the event payload. */
function findDamPaths(value, out = new Set()) {
  if (typeof value === 'string') {
    const m = value.match(/\/content\/dam\/[^\s"'?#]+/g);
    if (m) m.forEach((p) => out.add(p));
  } else if (Array.isArray(value)) {
    value.forEach((v) => findDamPaths(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => findDamPaths(v, out));
  }
  return out;
}

/** DAM paths -> sheet names, using { "<path prefix>": "<sheet>" } routes. */
function sheetsFor(paths, routes) {
  const sheets = new Set();
  paths.forEach((p) => Object.entries(routes).forEach(([prefix, sheet]) => {
    if (p.startsWith(prefix) || `${p}/` === prefix) sheets.add(sheet);
  }));
  return [...sheets];
}

async function dispatch(repo, token, sheet) {
  const resp = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'cf-sheets-dispatcher',
    },
    body: JSON.stringify({ event_type: 'cf-published', client_payload: { sheet } }),
  });
  return resp.status; // 204 = accepted
}

async function main(params) {
  const { GITHUB_TOKEN: token, GITHUB_REPO: repo } = params;
  if (!token || !repo) return { statusCode: 500, body: { error: 'GITHUB_TOKEN / GITHUB_REPO missing' } };

  let routes;
  try {
    routes = typeof params.SHEET_ROUTES === 'string' ? JSON.parse(params.SHEET_ROUTES) : (params.SHEET_ROUTES || {});
  } catch (e) {
    return { statusCode: 500, body: { error: 'SHEET_ROUTES is not valid JSON' } };
  }

  // Only look at the event itself, never at our own inputs.
  const event = { ...params };
  ['GITHUB_TOKEN', 'GITHUB_REPO', 'SHEET_ROUTES'].forEach((k) => delete event[k]);
  Object.keys(event).filter((k) => k.startsWith('__ow_')).forEach((k) => delete event[k]);

  const paths = [...findDamPaths(event)];
  const sheets = sheetsFor(paths, routes);
  const results = await Promise.all(sheets.map(async (sheet) => ({
    sheet,
    status: await dispatch(repo, token, sheet).catch((e) => `error: ${e.message}`),
  })));
  // eslint-disable-next-line no-console -- visible in `aio rt activation logs`
  console.log(JSON.stringify({ type: event.type || event.event?.type, paths, results }));
  return { statusCode: 200, body: { paths, results } };
}

module.exports = { main, findDamPaths, sheetsFor };

#!/usr/bin/env node
/**
 * Turns the outcome of a live check into a GitHub issue, so a broken published
 * site arrives as a notification on the owner's account instead of a red run
 * nobody opens.
 *
 *   node scripts/report-live-failure.mjs open
 *   node scripts/report-live-failure.mjs close
 *   node scripts/report-live-failure.mjs open --dry-run
 *
 * Reads the result the live check recorded (WATCH_FILE, default dist/live.json)
 * and uses the REST API with GITHUB_TOKEN or GH_TOKEN, which needs
 * `issues: write`. One open issue labelled `live-site` is reused: a repeat
 * failure adds a comment, and a green run closes it, so the issue never turns
 * into a pile.
 */
import { readFileSync } from 'node:fs';

const action = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const label = process.env.LIVE_LABEL ?? 'live-site';
const title = process.env.LIVE_TITLE ?? 'Live site check failed';
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const repo = process.env.GITHUB_REPOSITORY ?? '';
const runUrl = process.env.RUN_URL ?? '';
const resultFile = process.env.WATCH_FILE ?? 'dist/live.json';

if (action !== 'open' && action !== 'close') {
  console.error('usage: report-live-failure.mjs open|close [--dry-run]');
  process.exit(2);
}

function readResult() {
  try {
    return JSON.parse(readFileSync(resultFile, 'utf8'));
  } catch {
    return {};
  }
}

const result = readResult();
const base = result.base ?? '(unknown origin)';
const detail = result.tail || JSON.stringify(result, null, 2) || '(no recorded result)';

async function api(path, init = {}) {
  const method = init.method ?? 'GET';
  if (dryRun) {
    console.log(`[dry-run] ${method} ${path}${init.body ? ` ${init.body}` : ''}`);
    return { json: [] };
  }
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'sokerisport-live-check',
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
  return { json: text ? JSON.parse(text) : {} };
}

async function openIssues() {
  const issues = await api(`/repos/${repo}/issues?labels=${label}&state=open&per_page=10`);
  return Array.isArray(issues.json) ? issues.json.filter((issue) => !issue.pull_request) : [];
}

if (action === 'open') {
  if (result.ok === true) {
    console.log('live check is green; nothing to report');
    process.exit(0);
  }

  const body = [
    `The live check failed against ${base}.`,
    runUrl ? `\nRun: ${runUrl}` : '',
    '',
    '```',
    detail.slice(0, 4000),
    '```',
    '',
    'Repeat failures comment on this issue, and a green run closes it.'
  ].join('\n');

  const [existing] = await openIssues();
  if (existing) {
    await api(`/repos/${repo}/issues/${existing.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body })
    });
    console.log(`commented on #${existing.number}: ${title}`);
  } else {
    const created = await api(`/repos/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        body,
        labels: [label],
        assignees: repo.includes('/') ? [repo.split('/')[0]] : []
      })
    });
    console.log(`opened #${created.json.number ?? '?'}: ${title}`);
  }
} else {
  const open = await openIssues();
  if (open.length === 0) {
    console.log('no open live-site issue; nothing to close');
    process.exit(0);
  }
  for (const issue of open) {
    await api(`/repos/${repo}/issues/${issue.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: `The live check passed again (${base}).${runUrl ? ` Run: ${runUrl}` : ''}` })
    });
    await api(`/repos/${repo}/issues/${issue.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' })
    });
    console.log(`closed #${issue.number}`);
  }
}

#!/usr/bin/env node
// Publish .gitlab/duo/flows/shakefix.yml as a new version of the ShakeFix ER custom flow in the AI Catalog.
//   GITLAB_TOKEN=<maintainer PAT, api scope> FLOW_ITEM_ID=<catalog item id> node scripts/push-flow.mjs [--bump PATCH|MINOR|MAJOR]
// Projects that enabled the flow without pinning a version pick the new version up on the next run.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: o } = parseArgs({ options: { bump: { type: 'string', default: 'PATCH' }, file: { type: 'string', default: '.gitlab/duo/flows/shakefix.yml' } } });
const token = process.env.GITLAB_TOKEN;
const item = process.env.FLOW_ITEM_ID;
const api = (process.env.GITLAB_URL || 'https://gitlab.com').replace(/\/+$/, '');
if (!token || !item) {
  console.error('push-flow: set GITLAB_TOKEN and FLOW_ITEM_ID (the number in AI > Flows > <flow> URL)');
  process.exit(2);
}
const definition = readFileSync(o.file, 'utf8');
if (/<!--/.test(definition.split('prompt_template').slice(1).join(''))) {
  console.error('push-flow: prompts contain HTML comments, which GitLab rejects');
  process.exit(1);
}
const query = `mutation($input: AiCatalogFlowUpdateInput!) {
  aiCatalogFlowUpdate(input: $input) { errors item { id latestVersion { versionName } } } }`;
const res = await fetch(`${api}/api/graphql`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ query, variables: { input: { id: `gid://gitlab/Ai::Catalog::Item/${item}`, definition, versionBump: o.bump } } }),
});
const body = await res.json();
const out = body?.data?.aiCatalogFlowUpdate;
if (!res.ok || body.errors?.length || out?.errors?.length) {
  console.error('push-flow: failed', JSON.stringify(body.errors ?? out?.errors ?? body));
  process.exit(1);
}
console.log(`push-flow: ${out.item.id} is now ${out.item.latestVersion.versionName}`);

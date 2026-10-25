#!/usr/bin/env node
// "Plan, explained": turns `terraform show -json <plan>` into a plain-English Infra Chart for people who
// don't read Terraform. What gets created, changed, replaced or destroyed, each setting before → after,
// and the warnings that matter (data loss, downtime, who-can-access, cost, region moves).
//
//   terraform plan -out tf.plan && terraform show -json tf.plan > plan.json
//   node scripts/infra/explain-plan.mjs plan.json [--json] [--post-mr <iid>]
//
// Agents never apply infra (policy: infra/** is assisted). This chart is what the human reads before
// they approve the MR.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FRIENDLY = {
  google_cloud_run_v2_service: 'Cloud Run service',
  google_cloud_run_v2_service_iam_member: 'Cloud Run access rule',
  google_project_iam_member: 'project permission',
  google_service_account: 'service account',
  google_service_account_iam_member: 'service account permission',
  google_secret_manager_secret: 'secret',
  google_secret_manager_secret_version: 'secret value',
  google_artifact_registry_repository: 'container registry',
  google_firestore_database: 'Firestore database',
  google_storage_bucket: 'storage bucket',
  google_sql_database_instance: 'SQL database',
  google_compute_instance: 'virtual machine',
  google_iam_workload_identity_pool: 'CI identity pool',
  google_iam_workload_identity_pool_provider: 'CI identity provider',
  google_project_service: 'enabled Google API',
  google_billing_budget: 'billing budget',
  aws_instance: 'EC2 virtual machine',
  aws_s3_bucket: 'S3 bucket',
  aws_db_instance: 'RDS database',
  aws_iam_role: 'IAM role',
  aws_security_group: 'firewall (security group)',
  azurerm_resource_group: 'resource group',
};
// Resources whose destruction loses data.
const STATEFUL = /(firestore|sql|database|db_instance|storage_bucket|s3_bucket|disk|volume|secret_version|bigquery|spanner|redis|bucket)/;
const ACCESS = /(iam|policy|security_group|firewall|access|invoker)/;
const COSTLY = /(sql_database_instance|db_instance|compute_instance|aws_instance|gke|container_cluster|node_pool|redis|spanner)/;
// Settings worth a plain-English note when they change.
const NOTES = [
  [/(^|\.)(region|location)$/, 'moves to another region: usually means rebuild + new URL/IPs'],
  [/max_instance_count|max_scale|max_size|desired_capacity/, 'caps how many copies can run at once (capacity)'],
  [/min_instance_count|min_scale|min_size/, 'copies kept always on (cost, cold starts)'],
  [/(^|\.)image$/, 'which build of the app runs'],
  [/(^|\.)env(\.|$)/, 'app settings / environment variables'],
  [/allowed_origins|ALLOWED_ORIGINS/, 'which sites may call this service from a browser'],
  [/(memory|cpu|machine_type|instance_type|tier)/, 'size of each machine (cost and speed)'],
  [/(^|\.)members?$|role$/, 'who can access it'],
  [/deletion_protection/, 'protection against accidental deletion'],
];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
// What a reader needs to recognise a new resource.
const KEY_FIELDS = ['name', 'account_id', 'bucket', 'role', 'member', 'location', 'region', 'machine_type', 'instance_type', 'image'];

/** Leaf-level differences between two values: [{path, before, after}] (arrays compared by index). */
export function leafDiff(before, after, path = '', out = []) {
  if (isObj(before) || isObj(after) || Array.isArray(before) || Array.isArray(after)) {
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    for (const k of keys) leafDiff(before?.[k], after?.[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ path, before, after });
  return out;
}

/** Env vars are [{name, value}] lists: diff them by name so a change reads as "ALLOWED_ORIGINS: a → b". */
function normalise(v) {
  if (Array.isArray(v) && v.length && v.every((e) => isObj(e) && 'name' in e && ('value' in e || 'value_source' in e))) {
    return Object.fromEntries(v.map((e) => [e.name, e.value ?? '(from a secret)']));
  }
  if (Array.isArray(v)) return v.map(normalise);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalise(x)]));
  return v;
}

function sensitivePaths(change) {
  const out = new Set();
  const walk = (s, p) => {
    if (s === true) out.add(p);
    else if (isObj(s) || Array.isArray(s)) for (const [k, v] of Object.entries(s)) walk(v, p ? `${p}.${k}` : k);
  };
  walk(change.before_sensitive, '');
  walk(change.after_sensitive, '');
  return out;
}

function kindOf(actions) {
  if (actions.includes('delete') && actions.includes('create')) return 'replace';
  if (actions.includes('create')) return 'create';
  if (actions.includes('delete')) return 'destroy';
  if (actions.includes('update')) return 'change';
  return 'none';
}

/** Explain a `terraform show -json` plan. */
export function explainPlan(plan) {
  const items = [];
  for (const r of plan.resource_changes ?? []) {
    const kind = kindOf(r.change?.actions ?? []);
    if (kind === 'none') continue;
    const what = FRIENDLY[r.type] ?? r.type.replace(/_/g, ' ');
    const secret = sensitivePaths(r.change);
    const unknown = new Set(Object.keys(r.change?.after_unknown ?? {}).filter((k) => r.change.after_unknown[k] === true));
    const diffs = kind === 'change' || kind === 'replace'
      ? leafDiff(normalise(r.change.before), normalise(r.change.after))
          .filter((d) => !/(^|\.)(etag|uid|generation|update_time|create_time|terminal_condition|conditions|observed_generation|latest_.*revision|reconciling)(\.|$)/.test(d.path))
          // A provider default dropping out of the config (0, "", false → unset) is not a real change.
          .filter((d) => !(d.after == null && (d.before === 0 || d.before === '' || d.before === false || d.before == null)))
          .map((d) => {
            const hidden = [...secret].some((s) => s && d.path.startsWith(s));
            const pending = unknown.has(d.path.split('.')[0]);
            let note = NOTES.find(([re]) => re.test(d.path))?.[1] ?? null;
            if (d.after == null && d.before != null && !pending) note = `removed${note ? `: ${note}` : ''}. If CI or a person set this outside Terraform, apply will wipe it`;
            return { path: d.path, before: hidden ? '(hidden)' : d.before, after: hidden ? '(hidden)' : pending && d.after == null ? '(known after apply)' : d.after, note };
          })
          .slice(0, 12)
      : kind === 'create'
        ? KEY_FIELDS.filter((k) => r.change.after?.[k] != null && typeof r.change.after[k] !== 'object')
            .map((k) => ({ path: k, before: null, after: r.change.after[k], note: /(region|location)$/.test(k) ? 'where it runs' : NOTES.find(([re]) => re.test(k))?.[1] ?? null }))
        : [];
    const warnings = [];
    const stateful = STATEFUL.test(r.type);
    if ((kind === 'destroy' || kind === 'replace') && stateful) warnings.push('DATA LOSS: this deletes stored data');
    else if (kind === 'destroy') warnings.push('removed for good');
    if (kind === 'replace') warnings.push(`rebuilt from scratch (downtime likely)${r.change.replace_paths ? ` because ${r.change.replace_paths.map((p) => p.join('.')).join(', ')} changed` : ''}`);
    if (ACCESS.test(r.type) || diffs.some((d) => /(members?|role|invoker|ingress)/.test(d.path))) warnings.push('changes who can access something');
    if (JSON.stringify(r.change.after ?? {}).includes('allUsers')) warnings.push('PUBLIC: open to anyone on the internet');
    if (kind === 'create' && COSTLY.test(r.type)) warnings.push('new always-on cost');
    if (kind !== 'create' && diffs.some((d) => /(region|location)$/.test(d.path) && d.before != null)) warnings.push('moves region');
    items.push({ address: r.address, type: r.type, what, name: r.name, kind, diffs, warnings });
  }
  const count = (k) => items.filter((i) => i.kind === k).length;
  const summary = { create: count('create'), change: count('change'), replace: count('replace'), destroy: count('destroy') };
  const risk = items.some((i) => i.warnings.some((w) => /DATA LOSS|PUBLIC/.test(w))) ? 'high'
    : items.some((i) => i.kind === 'destroy' || i.kind === 'replace' || i.warnings.length) ? 'medium'
    : items.length ? 'low' : 'none';
  return { summary, risk, items, terraform: plan.terraform_version ?? null };
}

const show = (v) => {
  if (v === undefined || v === null) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return `\`${s.length > 70 ? `${s.slice(0, 67)}…` : s}\``.replace(/\|/g, '\\|');
};
const VERB = { create: '➕ create', change: '✏️ change', replace: '♻️ replace', destroy: '🗑️ destroy' };
const RISK = { none: '✅ nothing changes', low: '🟢 low', medium: '🟡 medium', high: '🔴 high' };

/** Markdown Infra Chart for an MR. */
export function renderChart(x) {
  const s = x.summary;
  const lines = [
    '### 🏗️ Infra Chart — Terraform plan, explained',
    '',
    `**${s.create} to create · ${s.change} to change · ${s.replace} to replace · ${s.destroy} to destroy** · risk ${RISK[x.risk]}`,
    '',
  ];
  if (!x.items.length) lines.push('_Applying this changes nothing in the cloud._');
  for (const i of x.items) {
    lines.push(`**${VERB[i.kind]} ${i.what}** \`${i.name}\`${i.warnings.length ? ` · ⚠️ ${i.warnings.join(' · ')}` : ''}`);
    if (i.kind === 'change' && !i.diffs.length) lines.push('', '_Only provider defaults move; nothing you would notice._');
    if (i.diffs.length) {
      lines.push('', '| Setting | Before | After | What it means |', '|---|---|---|---|');
      for (const d of i.diffs) lines.push(`| \`${d.path}\` | ${show(d.before)} | ${show(d.after)} | ${d.note ?? ''} |`);
    }
    lines.push('');
  }
  lines.push('Agents never apply infrastructure. A human approves this MR, then CI runs `terraform apply` on exactly this plan.');
  lines.push('', '_— Plan, explained, ShakeFix ER_');
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) { console.error('usage: explain-plan.mjs <plan.json> [--json]'); process.exit(2); }
  const x = explainPlan(JSON.parse(readFileSync(file, 'utf8')));
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(x, null, 2)}\n` : `${renderChart(x)}\n`);
}

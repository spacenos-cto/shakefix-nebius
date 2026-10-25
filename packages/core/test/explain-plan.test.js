import { describe, it, expect } from 'vitest';
import { explainPlan, renderChart } from '../../../scripts/infra/explain-plan.mjs';

const rc = (type, name, actions, before, after, extra = {}) => ({ address: `${type}.${name}`, type, name, change: { actions, before, after, ...extra } });

describe('Plan, explained (scripts/infra/explain-plan.mjs)', () => {
  it('flags data loss, replacement, region moves and public access; risk is high', () => {
    const x = explainPlan({ resource_changes: [
      rc('google_firestore_database', 'db', ['delete'], { name: 'db' }, null),
      rc('google_cloud_run_v2_service', 'app', ['delete', 'create'], { location: 'us-central1' }, { location: 'asia-southeast1' }, { replace_paths: [['location']] }),
      rc('google_cloud_run_v2_service_iam_member', 'pub', ['create'], null, { member: 'allUsers', role: 'roles/run.invoker' }),
      rc('google_storage_bucket', 'logs', ['no-op'], {}, {}),
    ] });
    expect(x.summary).toEqual({ create: 1, change: 0, replace: 1, destroy: 1 });
    expect(x.risk).toBe('high');
    const by = Object.fromEntries(x.items.map((i) => [i.name, i]));
    expect(by.db.warnings).toContain('DATA LOSS: this deletes stored data');
    expect(by.app.warnings.join(' ')).toMatch(/rebuilt from scratch .*because location changed/);
    expect(by.app.warnings).toContain('moves region');
    expect(by.app.diffs[0]).toMatchObject({ path: 'location', before: 'us-central1', after: 'asia-southeast1' });
    expect(by.pub.warnings).toContain('PUBLIC: open to anyone on the internet');
    const md = renderChart(x);
    expect(md).toContain('1 to create · 0 to change · 1 to replace · 1 to destroy');
    expect(md).toContain('🔴 high');
  });

  it('env vars diff by name, secrets stay hidden, provider defaults are ignored', () => {
    const before = { env: [{ name: 'MODE', value: 'a' }, { name: 'TOKEN', value: 's1' }], scaling: [{ manual_instance_count: 0 }] };
    const after = { env: [{ name: 'MODE', value: 'b' }, { name: 'TOKEN', value: 's2' }], scaling: [{}] };
    const x = explainPlan({ resource_changes: [rc('google_cloud_run_v2_service', 'svc', ['update'], before, after, {
      after_sensitive: { env: { TOKEN: true } },
    })] });
    const d = x.items[0].diffs;
    expect(d.find((r) => r.path === 'env.MODE')).toMatchObject({ before: 'a', after: 'b' });
    expect(d.find((r) => r.path === 'env.TOKEN')).toMatchObject({ before: '(hidden)', after: '(hidden)' });
    expect(d.some((r) => r.path.includes('manual_instance_count'))).toBe(false);
    expect(x.risk).toBe('low');
  });

  it('an empty plan says nothing changes', () => {
    const x = explainPlan({ resource_changes: [] });
    expect(x.risk).toBe('none');
    expect(renderChart(x)).toContain('Applying this changes nothing');
  });
});

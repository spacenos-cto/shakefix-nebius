import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  FLOW_PATH, ROLES, expectedPromptFiles, rolesFromFlow, parseFlow, renderPromptFile, parsePromptFile, loadRolePrompts, fillTemplate,
} from '../src/prompts.js';

const REPO = resolve(import.meta.dirname, '../../..');
const yaml = readFileSync(join(REPO, FLOW_PATH), 'utf8');

describe('prompt sync (.gitlab/duo/flows/shakefix.yml -> .shakefix/prompts)', () => {
  it('every .shakefix/prompts/*.md matches the Duo YAML exactly (run node scripts/sync-prompts.mjs on drift)', () => {
    const files = expectedPromptFiles(yaml);
    expect(Object.keys(files).sort()).toEqual(ROLES.map((r) => `.shakefix/prompts/${r}.md`).sort());
    for (const [rel, content] of Object.entries(files)) {
      expect(existsSync(join(REPO, rel)), `${rel} missing`).toBe(true);
      expect(readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n'), `${rel} drifted from ${FLOW_PATH}`).toBe(content);
    }
  });

  it('scripts/sync-prompts.mjs --check agrees', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts/sync-prompts.mjs'), '--check'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });

  it('extracts the four roles with their toolsets and prompt text', () => {
    const roles = rolesFromFlow(yaml);
    expect(roles.map((r) => r.role)).toEqual(['triage_nurse', 'surgeon', 'attending', 'discharge']);
    const by = Object.fromEntries(roles.map((r) => [r.role, r]));
    expect(by.triage_nurse.toolset).toContain('run_command');
    expect(by.attending.toolset).not.toContain('edit_file');
    expect(by.discharge.toolset).toContain('create_merge_request');
    expect(by.triage_nurse.system.startsWith('You are the Triage Nurse of ShakeFix ER.')).toBe(true);
    expect(by.triage_nurse.system).toMatch(/FINAL ANSWER: exactly one word/);
    expect(by.surgeon.user).toBe('Goal: {{goal}}\nProject ID: {{project_id}}\nStart by reading .shakefix/tmp/triage.json.\n');
    // YAML indentation is stripped, blank lines inside the block are kept
    expect(by.triage_nurse.system).toContain('\n\nSTEPS\n1. Find <iid>');
  });

  it('render/parse round-trips and the loader returns the same data', async () => {
    for (const r of rolesFromFlow(yaml)) {
      const back = parsePromptFile(renderPromptFile(r), r.role);
      expect(back).toMatchObject({ role: r.role, name: r.name, toolset: r.toolset, system: r.system, user: r.user });
    }
    const loaded = await loadRolePrompts(REPO);
    expect(loaded.map((r) => r.name)).toEqual(['ShakeFix Triage Nurse', 'ShakeFix Surgeon', 'ShakeFix Attending', 'ShakeFix Discharge']);
  });

  it('parseFlow handles inline toolset lists too', () => {
    const y = 'components:\n  - name: "a"\n    prompt_id: "p"\n    toolset: ["read_file", "grep"]\nprompts:\n  - prompt_id: "p"\n    name: "A"\n    prompt_template:\n      system: |\n        line 1\n\n          indented\n      user: |\n        Goal: {{goal}}\n';
    const f = parseFlow(y);
    expect(f.components.a).toEqual({ promptId: 'p', toolset: ['read_file', 'grep'] });
    expect(f.prompts.p).toEqual({ name: 'A', system: 'line 1\n\n  indented\n', user: 'Goal: {{goal}}\n' });
  });

  it('fillTemplate fills placeholders and marks missing ones', () => {
    expect(fillTemplate('Goal: {{goal}}\nR: {{review}}\nS: {{surgery_report}}', { goal: 'g', surgery_report: { operated: true } }))
      .toBe('Goal: g\nR: (none)\nS: {"operated":true}');
  });
});

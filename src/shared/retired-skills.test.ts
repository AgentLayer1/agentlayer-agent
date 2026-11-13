import { describe, expect, test } from 'bun:test';
import { migrateGrant, migrateGrants, type RetiredNames } from './retired-skills';

const NAMES: RetiredNames = {
  skills: { 'daily-brief': 'briefing morning', 'weekly-plan': 'goals week' },
  tools: { brief_write: 'briefing_write' }
};
const grant = (entry: string) => migrateGrant(entry, 'acme', NAMES);

describe('migrateGrant', () => {
  test("a retired skill's rule becomes its successor's, wildcard kept", () => {
    expect(grant('Skill(acme:daily-brief)')).toEqual(['Skill(acme:briefing)']);
    expect(grant('Skill(acme:daily-brief *)')).toEqual(['Skill(acme:briefing *)']);
    expect(grant('Skill(/acme:weekly-plan)')).toEqual(['Skill(acme:goals)']);
  });

  test('a prefix rule that reached retired skills stays, joined by each successor it no longer reaches', () => {
    expect(grant('Skill(acme:daily*)')).toBeNull();
    expect(grant('Skill(acme:daily:*)')).toEqual(['Skill(acme:daily:*)', 'Skill(acme:briefing)']);
    expect(grant('Skill(acme:weekly *)')).toEqual(['Skill(acme:weekly *)', 'Skill(acme:goals)']);
  });

  test("a retired tool's rule is renamed in place, server key kept", () => {
    expect(grant('mcp__plugin_acme_agent__brief_write')).toEqual(['mcp__plugin_acme_agent__briefing_write']);
  });

  test("a live rule, another plugin's rule and a non-skill rule reach nothing", () => {
    expect(grant('Skill(acme:briefing)')).toBeNull();
    expect(grant('Skill(other:daily-brief)')).toBeNull();
    expect(grant('mcp__plugin_other_agent__brief_write')).toBeNull();
    expect(grant('Bash(ls *)')).toBeNull();
  });

  test('nothing is retired until a release retires it', () => {
    expect(migrateGrant('Skill(acme:daily-brief)', 'acme')).toBeNull();
  });
});

describe('migrateGrants', () => {
  test('migrates in place, first position kept and duplicates dropped', () => {
    expect(
      migrateGrants(['Bash(ls *)', 'Skill(acme:daily-brief)', 'Skill(acme:briefing)', 'Skill(acme:seed)'], 'acme', NAMES)
    ).toEqual(['Bash(ls *)', 'Skill(acme:briefing)', 'Skill(acme:seed)']);
  });
});

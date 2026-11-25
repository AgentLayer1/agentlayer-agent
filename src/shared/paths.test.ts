import { describe, expect, test } from 'bun:test';
import { claudeForm, driveForm, samePath } from '@/shared/paths';

describe('Windows path spellings', () => {
  test("Git Bash's drive spelling becomes the drive form, and a drive path becomes Claude's rule form", () => {
    expect(driveForm('/c/Users/ada')).toBe('c:/Users/ada');
    expect(driveForm('/cygdrive/d/acme')).toBe('d:/acme');
    expect(driveForm('/Users/ada')).toBe('/Users/ada');
    expect(claudeForm('C:\\Users\\ada\\.env')).toBe('/c/Users/ada/.env');
    expect(claudeForm('/Users/ada/.env')).toBe('/Users/ada/.env');
  });

  test('Windows compares paths without case or separator; elsewhere they must match exactly', () => {
    expect(samePath('C:\\Dev\\agentlayer', 'c:/dev/AgentLayer', 'win32')).toBe(true);
    expect(samePath('/Users/ada/Dev', '/users/ada/dev', 'darwin')).toBe(false);
  });
});

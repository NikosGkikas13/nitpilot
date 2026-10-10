import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../test/temp';
import { configDir, configPath, DEFAULT_SERVER, loadConfig, loadConfigFile, saveConfig } from './config';

afterEach(() => vi.unstubAllEnvs());

const writeConfig = (dir: string, content: string) => writeFileSync(configPath(dir), content);
const modeOf = (path: string) => statSync(path).mode & 0o777;

describe('configDir', () => {
  it('uses NITPILOT_CONFIG_DIR first, then XDG_CONFIG_HOME, then ~/.config', () => {
    expect(configDir({ NITPILOT_CONFIG_DIR: '/tmp/a', XDG_CONFIG_HOME: '/tmp/xdg' })).toBe('/tmp/a');
    expect(configDir({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe(join('/tmp/xdg', 'nitpilot'));
    expect(configDir({})).toBe(join(homedir(), '.config', 'nitpilot'));
  });
});

describe('loadConfig', () => {
  it('has the spec §13 defaults when there is no file', () => {
    expect(loadConfig({ env: {}, dir: tempDir() })).toEqual({
      server: DEFAULT_SERVER,
      token: null,
      agent: 'claude-code',
      auto: { review: true, address: true },
      concurrency: 1,
      jobTimeoutMinutes: 15,
      dailyJobCap: 40,
      apiBilling: false,
      repos: {},
    });
  });

  it('lets NITPILOT_SERVER and NITPILOT_TOKEN win over the file, one field at a time', () => {
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ server: 'https://file.example', token: 'nit_fromfile', concurrency: 2 }));
    expect(loadConfig({ env: { NITPILOT_TOKEN: 'nit_fromenv' }, dir })).toMatchObject({ server: 'https://file.example', token: 'nit_fromenv', concurrency: 2 });
    expect(loadConfig({ env: { NITPILOT_SERVER: 'http://localhost:8787' }, dir })).toMatchObject({ server: 'http://localhost:8787', token: 'nit_fromfile' });
  });

  it('names the file when it is not valid JSON', () => {
    const dir = tempDir();
    writeConfig(dir, '{ "server": ');
    expect(() => loadConfig({ env: {}, dir })).toThrow(`${configPath(dir)} is not valid JSON`);
  });

  it('names the setting that is wrong', () => {
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ concurrency: 9 }));
    expect(() => loadConfig({ env: {}, dir })).toThrow(/Invalid setting "concurrency" in .*config\.json/);
  });

  it("names a setting it doesn't know, so a typo isn't silently ignored", () => {
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ concurency: 2 }));
    expect(() => loadConfig({ env: {}, dir })).toThrow(/Unknown setting "concurency" in .*config\.json/);
    writeConfig(dir, JSON.stringify({ repos: { 'acme/shop-api': { path: '/code/shop-api', setpu: ['npm', 'ci'] } } }));
    expect(() => loadConfig({ env: {}, dir })).toThrow('Unknown setting "repos.acme/shop-api.setpu"');
  });
});

describe('loadConfigFile', () => {
  it('reads the file alone, so saving what it returns never writes an environment override', () => {
    vi.stubEnv('NITPILOT_TOKEN', 'nit_fromenv');
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ token: 'nit_fromfile' }));
    expect(loadConfigFile(dir).token).toBe('nit_fromfile');
  });
});

describe('saveConfig', () => {
  it('writes a file only you can read, even over one with looser permissions', () => {
    const dir = tempDir();
    writeConfig(dir, '{}');
    chmodSync(configPath(dir), 0o644);
    const cfg = { ...loadConfigFile(dir), token: 'nit_saved' };
    saveConfig(cfg, dir);
    expect(modeOf(configPath(dir))).toBe(0o600);
    expect(loadConfigFile(dir)).toEqual(cfg);
  });

  it('creates the folder when it does not exist yet', () => {
    const dir = join(tempDir(), 'nested', 'nitpilot');
    saveConfig(loadConfigFile(dir), dir);
    expect(modeOf(configPath(dir))).toBe(0o600);
    expect(JSON.parse(readFileSync(configPath(dir), 'utf8'))).toMatchObject({ server: DEFAULT_SERVER });
  });
});

import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../test/temp';
import { configDir, configPath, DEFAULT_SERVER, ignoredSettingsIn, loadConfig, loadConfigFile, saveConfig } from './config';

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
      concurrency: 1,
      jobTimeoutMinutes: 15,
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

describe('the server address', () => {
  const load = (env: Record<string, string>) => loadConfig({ env, dir: tempDir() });

  it('takes http only for a server on this computer', () => {
    expect(load({ NITPILOT_SERVER: 'http://localhost:8787' }).server).toBe('http://localhost:8787');
    expect(load({ NITPILOT_SERVER: 'http://127.0.0.1:8787' }).server).toBe('http://127.0.0.1:8787');
    expect(load({ NITPILOT_SERVER: 'http://[::1]:8787' }).server).toBeDefined();
    expect(load({ NITPILOT_SERVER: 'http://app.localhost:5173' }).server).toBeDefined();
    expect(() => load({ NITPILOT_SERVER: 'http://nitpilot.example' })).toThrow('must start with https://');
    expect(() => load({ NITPILOT_SERVER: 'http://localhost.evil.example' })).toThrow('must start with https://');
  });

  it('takes https anywhere, with a path', () => {
    expect(load({ NITPILOT_SERVER: 'https://h.example/nitpilot' }).server).toBe('https://h.example/nitpilot');
  });

  it('says "Invalid setting" for an address that is not a URL, instead of crashing', () => {
    expect(() => load({ NITPILOT_SERVER: 'nitpilot.dev' })).toThrow(/Invalid setting "server"/);
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ server: 'not a url' }));
    expect(() => loadConfig({ env: {}, dir })).toThrow(/Invalid setting "server"/);
  });

  it('takes no query or fragment, since a path is added after the address', () => {
    for (const server of ['https://h.example/x?a=1', 'https://h.example/x#y', 'https://h.example/x?', 'https://h.example/x#']) {
      expect(() => load({ NITPILOT_SERVER: server })).toThrow(/can't have a \?query or #fragment/);
      const dir = tempDir();
      writeConfig(dir, JSON.stringify({ server }));
      expect(() => loadConfig({ env: {}, dir })).toThrow(/can't have a \?query or #fragment/);
    }
  });

  it('applies the same rule to the file', () => {
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ server: 'http://nitpilot.example' }));
    expect(() => loadConfig({ env: {}, dir })).toThrow('must start with https://');
  });
});

describe('settings that moved to the server', () => {
  it('accepts a Plan 1 config.json that still has auto and dailyJobCap, and ignores them', () => {
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ token: 'nit_old', auto: { review: false, address: true }, dailyJobCap: 10 }));
    const config = loadConfig({ env: {}, dir });
    expect(config.token).toBe('nit_old');
    expect(config).not.toHaveProperty('auto');
    expect(config).not.toHaveProperty('dailyJobCap');
    expect(ignoredSettingsIn(dir)).toEqual(['auto', 'dailyJobCap']);
  });

  it('drops them from the file the next time it is saved', () => {
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ dailyJobCap: 10 }));
    saveConfig(loadConfigFile(dir), dir);
    expect(JSON.parse(readFileSync(configPath(dir), 'utf8'))).not.toHaveProperty('dailyJobCap');
    expect(ignoredSettingsIn(dir)).toEqual([]);
  });

  it('finds none in a missing or unreadable file', () => {
    const dir = tempDir();
    expect(ignoredSettingsIn(dir)).toEqual([]);
    writeConfig(dir, '{ not json');
    expect(ignoredSettingsIn(dir)).toEqual([]);
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

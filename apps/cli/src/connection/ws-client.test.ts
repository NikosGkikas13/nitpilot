import { describe, expect, it } from 'vitest';
import { wsUrlFor } from './ws-client';

describe('wsUrlFor', () => {
  it('keeps the path prefix for the socket', () => {
    expect(wsUrlFor('https://h.example/nitpilot').href).toBe('wss://h.example/nitpilot/ws/cli');
    expect(wsUrlFor('https://h.example/nitpilot/').href).toBe('wss://h.example/nitpilot/ws/cli');
  });

  it('uses ws for http and wss for https', () => {
    expect(wsUrlFor('http://localhost:8787').href).toBe('ws://localhost:8787/ws/cli');
    expect(wsUrlFor('https://nitpilot.dev').href).toBe('wss://nitpilot.dev/ws/cli');
  });
});

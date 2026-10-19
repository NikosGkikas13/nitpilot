import type { DeviceView } from '@nitpilot/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from '../../test/push';
import { fakeViewport, renderApp, type Answer } from '../../test/render';
import { device, sent, serveSettings } from '../../test/settings';

afterEach(() => {
  vi.unstubAllGlobals();
});

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

async function open(devices: DeviceView[] | (() => Answer | Promise<Answer>), routes: Record<string, () => Answer | Promise<Answer>> = {}) {
  fakeViewport(true);
  fakeBrowser();
  const fetch = serveSettings({ devices, routes });
  const app = renderApp('/settings');
  const section = within(await screen.findByRole('region', { name: 'Devices' }));
  return { ...app, fetch, section };
}

describe('Devices (handoff §7)', () => {
  it('lists your computers, online ones first, then the most recently seen', async () => {
    const { section } = await open([
      device({ id: 'old', name: 'old-mini', online: false, lastSeenAt: daysAgo(40) }),
      device({ id: 'desk', name: 'maya-linux-desk', online: false, lastSeenAt: daysAgo(3) }),
      device({ id: 'fresh', name: 'new-laptop', online: false, lastSeenAt: null }),
      device({ id: 'mbp', name: "Maya's MacBook Pro", online: true }),
    ]);
    const rows = await section.findAllByRole('listitem');
    expect(rows.map((row) => within(row).getByTestId('device-name').textContent)).toEqual(["Maya's MacBook Pro", 'maya-linux-desk', 'old-mini', 'new-laptop']);
    expect(within(rows[0]!).getByText('Online')).toBeInTheDocument();
    expect(within(rows[0]!).queryByText(/Last seen/)).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText('Last seen 3 days ago')).toBeInTheDocument();
    expect(within(rows[1]!).queryByText('Online')).not.toBeInTheDocument();
    expect(within(rows[3]!).getByText('Never connected')).toBeInTheDocument();
    expect(section.getAllByRole('button', { name: /^Revoke/ })).toHaveLength(4);
  });

  it('revokes a device: it calls the route, says so, and the device is gone once the list is read again', async () => {
    let devices = [device({ id: 'mbp' }), device({ id: 'desk', name: 'maya-linux-desk', online: false, lastSeenAt: daysAgo(3) })];
    const { section, fetch } = await open(() => [200, { devices }], {
      'DELETE /api/devices/desk': (): Answer => {
        devices = devices.filter((d) => d.id !== 'desk');
        return [204, null];
      },
    });
    await userEvent.click(await section.findByRole('button', { name: 'Revoke maya-linux-desk' }));
    expect(await screen.findByText('Revoked. That computer has to log in again.')).toBeInTheDocument();
    await waitFor(() => expect(section.queryByText('maya-linux-desk')).not.toBeInTheDocument());
    expect(sent(fetch, '/api/devices/desk')).toEqual(['DELETE ']);
    expect(section.getByText("Maya's MacBook Pro")).toBeInTheDocument();
  });

  it('is busy while the revoke is on its way, and says why when it is refused', async () => {
    let refuse: () => void = () => {};
    const { section } = await open([device({ id: 'mbp' })], {
      'DELETE /api/devices/mbp': () => new Promise<Answer>((resolve) => (refuse = () => resolve([404, { error: { code: 'not_found', message: 'No such device.' } }]))),
    });
    const revoke = await section.findByRole('button', { name: "Revoke Maya's MacBook Pro" });
    await userEvent.click(revoke);
    expect(revoke).toBeDisabled();
    expect(revoke).toHaveAttribute('aria-busy', 'true');
    refuse();
    expect(await screen.findByText('No such device.')).toBeInTheDocument();
    await waitFor(() => expect(revoke).toBeEnabled());
  });

  it('tells you how to connect one when there are none', async () => {
    const { section } = await open([]);
    expect(await section.findByText(/No computers yet\. Run/)).toHaveTextContent('No computers yet. Run npx nitpilot login on one to connect it.');
  });
});

describe('Agent (handoff §7): worked out from your devices', () => {
  async function agents(devices: DeviceView[]) {
    await open(devices);
    return within(await screen.findByRole('region', { name: 'Agent' }));
  }

  it('shows each agent once, with its version, the computers it is on, and whether one of them is online', async () => {
    const section = await agents([
      device({ id: 'a', name: "Maya's MacBook Pro", online: true, agent: { id: 'claude-code', version: '2.1.290' } }),
      device({ id: 'b', name: 'maya-linux-desk', online: false, lastSeenAt: daysAgo(3), agent: { id: 'claude-code', version: '2.1.100' } }),
      device({ id: 'c', name: 'old-mini', online: false, lastSeenAt: daysAgo(9), agent: { id: 'gemini-cli', version: null } }),
      device({ id: 'd', name: 'new-laptop', online: false, lastSeenAt: null, agent: null }),
    ]);
    const rows = await section.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Claude Code');
    expect(within(rows[0]!).getByText('v2.1.290')).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Used on Maya's MacBook Pro, maya-linux-desk")).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Online')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Gemini CLI');
    expect(within(rows[1]!).getByText('Used on old-mini')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Not connected')).toBeInTheDocument();
  });

  it('takes the version from a computer that is offline when none with it is online', async () => {
    const section = await agents([device({ online: false, lastSeenAt: daysAgo(1), agent: { id: 'claude-code', version: '2.1.100' } })]);
    expect(await section.findByText('v2.1.100')).toBeInTheDocument();
  });

  it('says what to do when no computer reported an agent', async () => {
    const section = await agents([device({ agent: null })]);
    expect(await section.findByText(/Install Claude Code, then run/)).toHaveTextContent('Install Claude Code, then run nitpilot start.');
  });
});

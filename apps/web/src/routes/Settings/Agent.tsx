import { BRAND, type AgentId, type DeviceView } from '@nitpilot/protocol';
import { useDevices } from '../../api/settings';
import { AGENT_NAME } from '../../lib/names';
import { sortDevices } from './Devices';
import { Section } from './Section';
import styles from './Settings.module.css';

/** One coding agent across your computers. */
export type AgentRow = { id: AgentId; version: string | null; online: boolean; usedOn: string[] };

/**
 * The agents your computers reported, one row each (online computers first): online when any computer with it is
 * online, the version from an online one first, and the computers it's on.
 */
export function agentsFrom(devices: DeviceView[]): AgentRow[] {
  const rows = new Map<AgentId, AgentRow>();
  for (const device of sortDevices(devices)) {
    if (!device.agent) continue;
    const row = rows.get(device.agent.id) ?? { id: device.agent.id, version: null, online: false, usedOn: [] };
    row.usedOn.push(device.name);
    // Sorted online first, so the first version found comes from an online computer when there is one.
    row.version ??= device.agent.version;
    row.online ||= device.online;
    rows.set(device.agent.id, row);
  }
  return [...rows.values()];
}

/** "v2.1.290", whether or not the agent wrote the v itself. */
function versionLabel(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

/** The coding agents on your computers (handoff §7 "Agent"), worked out from `GET /api/devices`. */
export function Agent() {
  const devices = useDevices();
  let body;
  if (devices.isPending) {
    body = <p className={styles.line}>Loading…</p>;
  } else if (devices.isError) {
    body = <p className={styles.line}>Couldn't read your computers' agents.</p>;
  } else {
    const agents = agentsFrom(devices.data);
    body =
      agents.length === 0 ? (
        <p className={styles.line}>
          Install Claude Code, then run <span className={styles.mono}>{BRAND.cli} start</span>.
        </p>
      ) : (
        <ul className={styles.list}>
          {agents.map((agent) => (
            <li key={agent.id} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowTitle}>
                  {AGENT_NAME[agent.id]}
                  {agent.version && <span className={styles.version}>{versionLabel(agent.version)}</span>}
                </span>
                <span className={styles.hint}>Used on {agent.usedOn.join(', ')}</span>
              </div>
              {agent.online ? (
                <span className={`${styles.chip} ${styles.ok}`}>
                  <span aria-hidden="true">✓</span>
                  <span>Online</span>
                </span>
              ) : (
                <span className={`${styles.chip} ${styles.quiet}`}>
                  <span aria-hidden="true">○</span>
                  <span>Not connected</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      );
  }
  return (
    <Section id="agent" title="Agent">
      {body}
    </Section>
  );
}

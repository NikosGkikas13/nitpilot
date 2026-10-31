import { BRAND, type ChatView, type ParticipantView } from '@nitpilot/protocol';
import { useFiles } from '../../api/chat';
import { AgentBadge } from '../../components/AgentBadge/AgentBadge';
import { Avatar } from '../../components/Avatar/Avatar';
import { itemTime } from '../../lib/time';
import styles from './DetailsPanel.module.css';

/**
 * The PR beside the chat (handoff §2 "Details panel", desktop at 1180 px and wider): its files, its people, the team's
 * rules. A visitor who isn't signed in gets no file list (`files` false): that route needs a session.
 */
export function DetailsPanel({ view, files = true }: { view: ChatView; files?: boolean }) {
  return (
    <aside className={styles.panel} aria-label="PR details">
      {files && <Files chatId={view.id} />}
      <section className={styles.section}>
        <h2 className={styles.heading}>Participants</h2>
        <ul className={styles.people}>
          {view.participants.map((p) => (
            <Person key={`${p.githubId} ${p.role}`} person={p} />
          ))}
        </ul>
      </section>
      <section className={styles.section}>
        <div className={styles.headingRow}>
          <h2 className={styles.heading}>Team rules</h2>
          <span className={styles.meta}>{BRAND.teamConfigFile}</span>
        </div>
        <dl className={styles.rules}>
          <dt>Max rounds</dt>
          <dd className={styles.mono}>{view.rules.maxRounds}</dd>
          <dt>Always escalate</dt>
          <dd className={styles.mono}>{view.rules.alwaysEscalate.join(', ') || 'nothing'}</dd>
          <dt>Auto modes</dt>
          <dd>{autoModes(view.rules)}</dd>
        </dl>
        {view.rules.error && (
          <p className={styles.rulesError}>
            {BRAND.teamConfigFile} has an error, so the defaults apply: <span className={styles.mono}>{view.rules.error}</span>
          </p>
        )}
      </section>
      {view.summaryUrl && (
        <a className={styles.summary} href={view.summaryUrl} target="_blank" rel="noreferrer">
          Summary comment on GitHub <span aria-hidden="true">↗</span>
        </a>
      )}
    </aside>
  );
}

/** "6 · +123 −15", then one line per file, its path cut from the left so the file name shows. */
function Files({ chatId }: { chatId: string }) {
  const files = useFiles(chatId);
  const data = files.data;
  return (
    <section className={styles.section}>
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>Files changed</h2>
        {data && (
          <span className={styles.meta}>
            {data.files.length}
            {data.truncated ? '+' : ''} · +{data.adds} −{data.dels}
          </span>
        )}
      </div>
      {files.isPending && <p className={styles.note}>Loading…</p>}
      {files.isError && <p className={styles.note}>{files.error.message}</p>}
      {data && data.files.length > 0 && (
        <ul className={styles.files}>
          {data.files.map((f) => (
            <li key={f.path} className={styles.file}>
              <span className={styles.path} title={f.path}>
                <bdi>{f.path}</bdi>
              </span>
              <span className={styles.adds}>+{f.adds}</span>
              <span className={styles.dels}>−{f.dels}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Person({ person }: { person: ParticipantView }) {
  const agent = person.agent;
  return (
    <li className={styles.person}>
      <Avatar login={person.login} src={person.avatarUrl} size={30}>
        {agent?.working && <AgentBadge login={person.login} size="small" />}
      </Avatar>
      <div className={styles.personMain}>
        <div className={styles.personName}>
          <span>{person.login}</span>
          <span className={styles.meta}>{person.role === 'author' ? 'Author' : 'Reviewer'}</span>
        </div>
        <div className={styles.personStatus}>
          {agent && <span className={agent.online ? styles.online : styles.offline} aria-hidden="true" />}
          {agentStatus(person)}
        </div>
      </div>
    </li>
  );
}

function agentStatus(person: ParticipantView): string {
  if (person.isBot) return 'Bot';
  const agent = person.agent;
  if (!agent) return `Not on ${BRAND.name}`;
  if (agent.working) return 'Agent working';
  if (agent.online) return 'Agent online';
  return agent.offlineSince ? `Agent offline since ${itemTime(agent.offlineSince)}` : 'No agent connected yet';
}

function autoModes(rules: ChatView['rules']): string {
  if (rules.autoReview && rules.autoAddress) return 'Allowed';
  if (rules.autoReview) return 'Auto-review only';
  if (rules.autoAddress) return 'Auto-fix only';
  return 'Off';
}

/** @jsxImportSource hono/jsx */
import { BRAND } from '@nitpilot/protocol';
import { Layout } from './layout';

export function ApprovePending(props: { userCode: string; deviceName: string; minutesLeft: number }) {
  return (
    <Layout title="Approve device">
      <p class="muted">Device login</p>
      <h1>Approve this device?</h1>
      <p class="muted">Check that this code matches the one in your terminal.</p>
      <div class="code">{props.userCode}</div>
      <p><strong>{props.deviceName}</strong></p>
      <form method="post" action="/cli/approve">
        <input type="hidden" name="code" value={props.userCode} />
        <div class="row">
          <button class="primary" type="submit" name="decision" value="approve">Approve</button>
          <button type="submit" name="decision" value="deny">Deny</button>
        </div>
      </form>
      <p class="muted">Only approve if you just ran <code>npx {BRAND.npmPackage} login</code>. The code expires in {props.minutesLeft} min.</p>
    </Layout>
  );
}

const RESULT = {
  approved: { title: 'Device approved', body: 'Your terminal is connected. You can close this tab.' },
  denied: { title: 'Login denied', body: 'Nothing was connected. If that was you, run the login command again.' },
  expired: { title: 'This code expired', body: `Codes last 10 minutes. Run npx ${BRAND.npmPackage} login again.` },
  not_found: { title: "This code isn't valid", body: 'Check the code in your terminal, or start the login again.' },
} as const;

export function ApproveResult(props: { outcome: keyof typeof RESULT }) {
  const r = RESULT[props.outcome];
  return (
    <Layout title={r.title}>
      <h1>{r.title}</h1>
      <p class="muted">{r.body}</p>
    </Layout>
  );
}

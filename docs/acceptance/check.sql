-- What the database says about one sandbox PR, for the acceptance runbook (docs/acceptance/plan-1.md).
--   docker exec -i nitpilot-postgres-1 psql -U nitpilot -d nitpilot_acceptance -v pr=5 -f - < docs/acceptance/check.sql
-- Times are UTC, like the ones the CLI prints in the runbook's timestamped terminals.
\set repo '''NikosGkikas13/nitpilot-sandbox'''

\echo
\echo '== 1. The chat: READY (or Escalated) within max_rounds (3), and one summary comment'
select c.number as pr, c.phase, c.round, c."addressPasses" as address_passes, c."pointCount" as points, c."summaryCommentId" is not null as has_summary
from "PrChat" c join "Repo" r on r.id = c."repoId" where r."fullName" = :repo and c.number = :pr;

\echo
\echo '== 2. Jobs, oldest first (no job twice: every row is a different type/round/person)'
select j.type, j.round, j.status, j.attempt, u.login as for_person, coalesce(j.failure, '') as failure, coalesce(j."cancelReason", '') as cancelled_because
from "Job" j join "PrChat" c on c.id = j."chatId" join "Repo" r on r.id = c."repoId" join "User" u on u.id = j."userId"
where r."fullName" = :repo and c.number = :pr order by j."createdAt";

\echo
\echo '== 3. Duplicate jobs (must print 0 rows; a cancelled or failed job and the one that replaced it (Retry) are not a duplicate)'
select j."participantId", j.type, j.round, count(*) as rows
from "Job" j join "PrChat" c on c.id = j."chatId" join "Repo" r on r.id = c."repoId"
where r."fullName" = :repo and c.number = :pr and j.status not in ('cancelled', 'failed') group by 1, 2, 3 having count(*) > 1;

\echo
\echo '== 4. Webhooks about this PR, with the time each reached the server (compare with the CLI terminals)'
select to_char("createdAt", 'HH24:MI:SS.MS') as arrived_utc, event || coalesce('.' || action, '') as delivery, body::jsonb -> 'sender' ->> 'login' as sender, status
from "RawEvent" where coalesce(body::jsonb -> 'pull_request' ->> 'number', body::jsonb -> 'issue' ->> 'number') = :'pr' order by "createdAt";

\echo
\echo '== 5. Every webhook since this PR first appeared was processed or ignored on purpose (no received / retrying / failed)'
select status, count(*) as deliveries from "RawEvent"
where "createdAt" >= (select min("createdAt") from "RawEvent" where coalesce(body::jsonb -> 'pull_request' ->> 'number', body::jsonb -> 'issue' ->> 'number') = :'pr')
group by status order by status;

\echo
\echo '== 6. Points'
select p.number, p.status, p.severity, p.category, coalesce(p."escalationReason", '') as escalation, coalesce(p."authorResolution", '') as author_said, left(p.title, 50) as title
from "Point" p join "PrChat" c on c.id = p."chatId" join "Repo" r on r.id = c."repoId" where r."fullName" = :repo and c.number = :pr order by p.number;

\echo
\echo '== 7. The chat timeline'
select m.seq, m.kind, coalesce(m."authorLogin", '') as who, left(m.body, 80) as text
from "Message" m join "PrChat" c on c.id = m."chatId" join "Repo" r on r.id = c."repoId" where r."fullName" = :repo and c.number = :pr order by m.seq;

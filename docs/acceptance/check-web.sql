-- What the database says about one sandbox PR's web side, for the Plan 2 acceptance runbook (docs/acceptance/plan-2.md).
-- Run it after check.sql, which covers the chat, its jobs, webhooks, points and timeline:
--   docker exec -i nitpilot-postgres-1 psql -U nitpilot -d nitpilot_acceptance -v pr=5 -f - < docs/acceptance/check-web.sql
-- Times are UTC.
\set repo '''NikosGkikas13/nitpilot-sandbox'''

\echo
\echo '== 1. People in the chat: Auto (false = their agent''s work waits as a draft), what needs them, and the round limit'
select p.role, p.login, p.auto, p.attention, p."byHand" as by_hand, c."extraRounds" as extra_rounds
from "Participant" p join "PrChat" c on c.id = p."chatId" join "Repo" r on r.id = c."repoId"
where r."fullName" = :repo and c.number = :pr order by p.role, p.login;

\echo
\echo '== 2. Jobs and their drafts: applyState draft = waiting for Send, applied = sent (or Auto was on), discarded = Discard'
select j.type, j.round, j.status, j.attempt, u.login as for_person, j."applyState" as apply_state, coalesce(j.failure, '') as failure
from "Job" j join "PrChat" c on c.id = j."chatId" join "Repo" r on r.id = c."repoId" join "User" u on u.id = j."userId"
where r."fullName" = :repo and c.number = :pr order by j."createdAt";

\echo
\echo '== 3. Notes people wrote in the composer, and the job that started next for each agent'
select m.seq, m."authorLogin" as who, left(m.body, 60) as note, to_char(m."createdAt", 'HH24:MI:SS') as written_utc,
  (select j.type || ' for ' || u.login || ' at ' || to_char(j."createdAt", 'HH24:MI:SS')
     from "Job" j join "User" u on u.id = j."userId"
    where j."chatId" = c.id and j."createdAt" > m."createdAt" and j.type <> 'publish' order by j."createdAt" limit 1) as next_job
from "Message" m join "PrChat" c on c.id = m."chatId" join "Repo" r on r.id = c."repoId"
where r."fullName" = :repo and c.number = :pr and m.kind = 'human' order by m.seq;

\echo
\echo '== 4. Push subscriptions (one row per browser that turned push on; a failed one is deleted)'
select u.login, s.label, s."failCount" as fail_count, to_char(s."createdAt", 'YYYY-MM-DD HH24:MI') as since_utc
from "PushSubscription" s join "User" u on u.id = s."userId" order by u.login, s."createdAt";

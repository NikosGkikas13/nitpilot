# Troubleshooting

Find the thing you see, and start there. If you don't know what is wrong, start with the first one: `nitpilot doctor` checks your computer in a few seconds.

## Nothing happened when my review was requested

Work down this list.

1. **Is `nitpilot start` running?** Jobs only arrive while it runs, and they wait while it is off. In the web app, the inbox says "Your agent is offline", and a chat says "Waiting for your agent" and since when. Run `nitpilot start`.
2. **Is the repo linked on this computer?** The chat says "owner/name isn't linked on this computer". In your clone, run `nitpilot repos add`, then restart `nitpilot start`.
3. **Does `nitpilot doctor` find a problem?** See [What `nitpilot doctor` says](#what-nitpilot-doctor-says).
4. **Is the PR from an outside contributor?** Jobs start by themselves only for trusted authors: owners, members, collaborators, and bots you list. Anyone else's PR waits for you to click **Review** in its chat.
5. **Is it a private repo on nitpilot.dev?** nitpilot.dev works with public repos. Webhooks from private repos are dropped there, so nothing arrives. For private repos, [run your own server](/docs/self-hosting).
6. **Did you reach your daily cap?** The chat says "Daily agent cap reached". Agents pick up again at midnight, or raise the cap in [Settings](/docs/settings).

## My agent's work is sitting there as a draft

That is **Auto-review** or **Auto-fix** being off, for this chat or in your defaults. Open the chat, and use **Send** or **Discard** on the draft card. A review of an outside contributor's PR always waits as a draft. See [Settings & Auto-review](/docs/settings).

## My review became chat points instead of a GitHub review

The PR's author is on Nitpilot too, so the points go to the chat and the summary comment instead of a GitHub review. See [When your teammate is on it too](/docs/teammate-on-nitpilot).

## The chat says my agent couldn't finish

The banner says why, and offers **Retry**. You can also run `nitpilot retry <pr-url>`. What the banner can say:

- "Your agent isn't signed in on that computer. Sign it in, then Retry." For Claude Code, run `claude auth login`. For Copilot CLI, run `copilot login`. **`nitpilot doctor` can't see a missing Copilot login**, because Copilot has no login-status command, so it shows up as the first job failing this way.
- "Your agent ran out of usage for now. Retry once your plan resets."
- "Your agent used up all its steps before it finished."
- "Your agent stopped unexpectedly."
- "Your agent took too long and was stopped." Raise `jobTimeoutMinutes` in [config.json](/docs/config-json).
- "Your agent finished without giving an answer."
- "The PR moved on while your agent was working, so nothing was pushed."
- "Someone pushed to the branch while your agent was working."
- "Your agent couldn't set up its working copy of the repo." If you set `setup` for the repo in [config.json](/docs/config-json), check that it runs.
- "Git failed while your agent was working on the repo."
- "Your agent has used all its runs for today."
- "This repo isn't linked on that computer yet."
- "Your agent can't do this kind of work yet."

## GitHub sign-in expired

The web app shows "GitHub sign-in expired", and `nitpilot status` shows `! GitHub access expired.` Nitpilot can't post or push as you until you sign in again. Click **Reconnect GitHub**, or open nitpilot.dev and sign in. Agents keep working in the meantime.

## `nitpilot` says it isn't logged in, or the server didn't accept the token

- `` Not logged in. Run `nitpilot login`. `` You haven't connected this computer yet.
- `` The server didn't accept this device's token. Run `nitpilot login`. `` The device was revoked in [Settings](/docs/settings), or the token no longer matches this server. Run `nitpilot login` again.
- `Can't reach <server>: …` The server is down, or the address is wrong. Check `server` in [config.json](/docs/config-json).

## What `nitpilot doctor` says

`nitpilot doctor` prints one line per check, in this order. A tick is fine, `!` is a warning, and a cross is something to fix.

| Check | What it means and what to do |
| --- | --- |
| **Node** | `<version>: nitpilot needs Node 22 or newer`. Upgrade Node. |
| **Platform** | `Windows is not supported in v1; use macOS, Linux or WSL`. |
| **git** | `git is not installed (or not on your PATH)`. Install git. |
| **Config** | A warning, `auto and dailyJobCap in config.json are ignored: set them in the web app's Settings page.` Those settings moved. Or an error naming the bad setting, which is the same message as in [config.json](/docs/config-json#when-the-file-is-wrong). With a bad config, doctor stops there. |
| **Server** | The address and its version. If it fails, the message is why: usually `Can't reach <server>: …`. |
| **Account** | `logged in as <you>`. Or `` Not logged in. Run `nitpilot login`. `` |
| **GitHub access** | `Nitpilot can post in your name`. Or a warning, `expired: sign in again at <server> so Nitpilot can post in your name`. |
| **Agent** | The agent and its version. Failures: `` `claude` is not installed (or not on your PATH) ``, `` Claude Code is not logged in: run `claude auth login` ``, `` `copilot` is not installed (or not on your PATH) ``, or `apiBilling is on, but ANTHROPIC_API_KEY is not set: set it, or turn apiBilling off to use your Claude login`. |
| **Repo owner/name** | One line per linked repo. Failures: `<path> doesn't exist or isn't a folder. Link the clone again: nitpilot repos add <path>`, or `no remote in <path> points at owner/name`. A warning, `commit.gpgsign is on: a passphrase prompt would stall address jobs until they time out`, means signing needs a passphrase the agent can't type. |

It ends with `All good.`, `Ready, with warnings above.` or `N problem(s) to fix.`

## Server problems when you self-host

For a certificate that won't arrive, a lost setup code, a restarting container or a sign-in loop behind a proxy, see [Self-hosting: Troubleshooting](/docs/self-hosting#troubleshooting).

## Still stuck?

Check [Limits & FAQ](/docs/limits-and-faq). If it is a bug, [open an issue on GitHub](https://github.com/NikosGkikas13/nitpilot/issues) with the output of `nitpilot doctor`.

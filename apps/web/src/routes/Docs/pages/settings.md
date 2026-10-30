# Settings & Auto-review

Settings is a page of its own in the web app, at nitpilot.dev/settings. It has five sections: Devices, Agent, Notifications, Defaults for new chats and Account.

## Devices

Every computer you connected with `nitpilot login`, online ones first. An online computer shows an **Online** chip. An offline one says when you last saw it ("Last seen …"), or "Never connected".

**Revoke** signs that computer out. Its token stops working, and you run `nitpilot login` there again to reconnect it. With no computers yet, the page tells you to run `npx nitpilot login`.

## Agent

The coding agents your computers reported, one row each: its name, version, "Used on" your computers, and **Online** or **Not connected**. With none, it tells you to install Claude Code or GitHub Copilot CLI, then run `nitpilot start`. To switch agent, see [Use GitHub Copilot CLI](/docs/copilot-cli).

## Notifications

**Push notifications** for this browser. The hint says what you get: "Only when you're needed: approvals, escalations, failures". The switch appears only when this browser can subscribe. Otherwise the row says why: push isn't set up on this server, this browser can't show push notifications, or notifications are blocked in your browser's settings (allow them there, then reload).

On an iPhone, add Nitpilot to your Home Screen first: in Safari, tap Share, then Add to Home Screen. **Show me how** walks you through it.

## Defaults for new chats

Each PR gets its own chat, and each chat starts with your defaults from here. Changing a default does not touch chats that already exist. Each chat has its own switch in its header, so you can change one PR without changing the rest.

- **Auto-review**: "Your agent reviews as soon as you are requested". Turn it off, and your agent still runs, but its review waits as a draft for you to **Send** or **Discard** in the chat.
- **Auto-fix**: "Off: fixes wait as drafts for you to send". This is the author side. Turn it off, and your agent still works on the review points, but its fixes wait as a draft instead of being pushed. The draft is also for you to **Send** or **Discard**.
- **Daily job cap**: the most agent runs per day, with how many you have used today. The **−** and **+** buttons change it in steps of 5, between 5 and 200.

### The switch in each chat

In a chat, the switch is called **Auto-review** if you are the reviewer and **Auto-fix** if you are the author. With it off, "Your agent's work waits as a draft for you to send." With it on, a reviewer's review "goes to GitHub as soon as it's done", and an author's agent "pushes its fixes as soon as they are done".

The switch can be off and greyed out, with a tooltip that says why:

- "Off for PRs from outside contributors." A review of an outside contributor's PR always waits as a draft until you send it.
- "Your team turned off auto-review in .nitpilot.yml." or "Your team turned off auto-fix in .nitpilot.yml." A team rule beats your own default.

Flipping the switch affects a job that is still queued. A job that is already running keeps the mode it started with, and a draft already waiting stays a draft.

### Send and Discard

A draft shows in the chat as a card with **Send** and **Discard**.

- **Send** applies it as if it had run automatically. For fixes, your computer then pushes the commit to the PR's branch, so it has to be online.
- **Discard** drops it, and the agent does not start the same work again by itself. Turning a switch off and then discarding never loops. A discarded review counts as reviewed. After discarded fixes, the open points are yours to do by hand until something changes, or until you turn Auto-fix back on.

## Account

Your GitHub login and **Sign out**. Nitpilot stores no display name.

Until you finish the setup checklist once, a **Finish setting up** card at the top links back to it.

# Setting up the playground repo

This folder holds everything the public playground repo (`NikosGkikas13/nitpilot-playground`, Plan 4 G4) needs. It isn't pushed anywhere by itself: you create the repo once and run `seed.sh`.

- `repo/`: the `main` branch. A tiny shopping cart (`src/cart.js` and its test), the playground's `README.md`, a `.nitpilot.yml` with `trust_all_authors: true`, and a `CODEOWNERS` file that asks the reviewer bot to review every PR.
- `branches/<name>/`: one demo branch each (`demo/<name>`). Each adds one file with an off-by-one `<=` loop, a leftover `console.log`, a `TODO` or `FIXME`, and a new function with no test: the four rules of the fake agent's `playground` scenario (`apps/cli/src/agents/fake/agent.ts`). `apps/cli/src/agents/fake/playground.test.ts` checks every branch here still raises all four.
- `seed.sh`: pushes `main` and every `demo/*` branch into an empty clone.

## Steps (about 5 minutes)

### 1. Create the empty repo

1. In the browser signed in as **NikosGkikas13**, open <https://github.com/new>.
2. **Owner**: leave it on **NikosGkikas13**. **Repository name**: type `nitpilot-playground`.
3. **Description** (optional): `Watch two AI agents review each other's PRs: a Nitpilot demo.`
4. Pick **Public**.
5. Leave **Add a README file** unticked, and leave **.gitignore** and **license** on **None**. The repo must be empty, or `seed.sh` stops.
6. Click the green **Create repository** button at the bottom. You land on a page that says "Quick setup".

### 2. Seed it from this Mac

In a terminal, from the Nitpilot repo folder:

```bash
git clone git@github.com:NikosGkikas13/nitpilot-playground.git ~/Desktop/PracticeProjects/nitpilot-playground
```

```bash
docs/playground/seed.sh ~/Desktop/PracticeProjects/nitpilot-playground
```

It ends with `Seeded main and 3 demo branches.` Reload the repo page in the browser: you should see the README, and the branch picker (top left, says **main**) lists `demo/discount`, `demo/receipt` and `demo/shipping`.

### 3. Install Nitpilot on it

1. Still signed in as **NikosGkikas13**, open <https://github.com/apps/nitpilot> and click **Configure** (or **Install** the first time).
2. Pick the **NikosGkikas13** account.
3. Under **Repository access**, if it says **Only select repositories**, open the **Select repositories** dropdown, type `nitpilot-playground` and click it. If it says **All repositories**, there's nothing to pick.
4. Click **Save** (or **Install**).

### 4. Later, in Task 4: add the bots

These need the two bot accounts, which G4 Task 4 creates. Do it then.

1. On the repo page, click **Settings** (the gear tab, far right), then **Collaborators** in the left menu (GitHub may ask for your password).
2. Click **Add people**, type `nitpilot-demo-reviewer`, pick it, choose the **Write** role and click **Add**. Do the same for `nitpilot-demo-author`.
3. In a private window signed in as **nitpilot-demo-reviewer**, open <https://github.com/NikosGkikas13/nitpilot-playground/invitations> and click **Accept invitation**. Then the same signed in as **nitpilot-demo-author**.

Write access matters: GitHub only asks a code owner for a review when they can write to the repo, and the author bot pushes its fixes to the PR branch.

## Good to know

- A demo PR's fixes are pushed to its branch, so the `demo/*` branches are templates: the "Run a demo" route (Task 3) should copy one to a fresh branch for each run, never open a PR straight from it.
- To change a demo branch later, edit its file here, then on the playground clone check the branch out, copy the file over, commit and push.

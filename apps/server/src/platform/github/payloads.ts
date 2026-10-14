// The parts of GitHub's payloads that Nitpilot reads. GitHub sends much more; we ignore the rest.

export type GhUser = { id: number; login: string; type?: string };
export type GhRepo = { id: number; full_name: string; private: boolean; default_branch?: string };

export type GhPull = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: 'open' | 'closed';
  draft?: boolean;
  merged?: boolean;
  user: GhUser;
  author_association: string;
  requested_reviewers?: GhUser[];
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { sha: string; ref: string; repo: GhRepo };
};

export type GhReviewComment = {
  id: number;
  in_reply_to_id?: number;
  user: GhUser;
  author_association: string;
  body: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  side?: 'LEFT' | 'RIGHT' | null;
  commit_id?: string;
};

type Envelope = { installation: { id: number }; repository: GhRepo; sender: GhUser };

export type GhPullRequestEvent = Envelope & {
  action: string;
  number: number;
  pull_request: GhPull;
  requested_reviewer?: GhUser;
  requested_team?: { slug: string };
  before?: string;
  after?: string;
  /** On `edited`: what changed, with the old values. `base` is there when the PR now targets another branch. */
  changes?: { base?: { ref: { from: string }; sha: { from: string } }; title?: { from: string }; body?: { from: string } };
};
export type GhReviewCommentEvent = Envelope & { action: string; comment: GhReviewComment; pull_request: GhPull };
export type GhReviewEvent = Envelope & {
  action: string;
  review: { id: number; user: GhUser; author_association: string; state: string; body: string | null };
  pull_request: GhPull;
};
export type GhReviewThreadEvent = Envelope & { action: string; thread: { comments: GhReviewComment[] }; pull_request: GhPull };
export type GhIssueCommentEvent = Envelope & {
  action: string;
  issue: { number: number; pull_request?: { url: string } };
  comment: { id: number; user: GhUser; author_association: string; body: string };
};
export type GhInstallationEvent = { action: string; installation: { id: number; account: { login: string } }; repositories?: GhRepo[] };
export type GhInstallationReposEvent = {
  action: string;
  installation: { id: number; account: { login: string } };
  repositories_added: GhRepo[];
  repositories_removed: GhRepo[];
};
export type GhRepositoryEvent = Envelope & { action: string };

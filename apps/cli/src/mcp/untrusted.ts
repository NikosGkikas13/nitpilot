/** Where a piece of untrusted text came from, as the agent sees it in the tag. A fixed list: never text from the PR itself. */
export type UntrustedSource = 'pr_title' | 'pr_body' | 'note' | 'point_title' | 'point_body' | 'comment';

/**
 * Wrap text that anyone could have written (a PR's title and body, comments, notes) so the agent can
 * tell it apart from its instructions (spec §11). A `<untrusted` or `</untrusted` inside the text is
 * spelled `&lt;untrusted`, so the text can't close its own tag and pretend to be us. See docs/why/prompt-injection.md.
 */
export function wrapUntrusted(source: UntrustedSource, text: string): string {
  return `<untrusted source="${source}">\n${text.replace(/<(?=\s*\/?\s*untrusted)/gi, '&lt;')}\n</untrusted>`;
}

/**
 * Leaving the web app for a page the server answers (GitHub sign-in), or for GitHub itself (the first-run page's form).
 * One object, so a test can replace these with `vi.spyOn(browser, 'goTo')`: jsdom won't let a test replace
 * `window.location.assign` itself, and it can't follow a form post.
 */
export const browser = {
  goTo(url: string): void {
    window.location.assign(url);
  },
  /** Post a form the page built: a real navigation to its `action`, as if its submit button were pressed. */
  submit(form: HTMLFormElement): void {
    form.submit();
  },
};

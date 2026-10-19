/**
 * Leaving the web app for a page the server answers (GitHub sign-in). One object, so a test can replace `goTo` with
 * `vi.spyOn(browser, 'goTo')`: jsdom won't let a test replace `window.location.assign` itself.
 */
export const browser = {
  goTo(url: string): void {
    window.location.assign(url);
  },
};

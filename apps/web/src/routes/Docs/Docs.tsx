import { BRAND } from '@nitpilot/protocol';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ThemeToggle } from '../../components/ThemeToggle/ThemeToggle';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import { SIGN_IN_URL } from '../Landing/Landing';
import styles from './Docs.module.css';
import { renderMarkdown } from './markdown';
import { OnThisPage } from './OnThisPage';
import { DOC_GROUPS, DOC_PAGES, findPage, neighbours, pageSource } from './pages';

const pagePath = (slug: string) => (slug === 'introduction' ? '/docs' : `/docs/${slug}`);

/** The public docs: `/docs` is the introduction, `/docs/<slug>` any other page. Needs no sign-in and makes no API call. */
export function Docs() {
  const slug = useParams().slug ?? 'introduction';
  const page = findPage(slug);
  const source = page && pageSource(slug);
  const rendered = useMemo(() => (source ? renderMarkdown(source) : undefined), [source]);
  const navigate = useNavigate();
  const location = useLocation();
  const { hash } = location;
  const [menuOpen, setMenuOpen] = useState(false);
  // Any navigation (links, Back, Forward) gives a new `location` object, which closes the menu. Resetting state during render is React's documented way to do this without an effect.
  const [lastLocation, setLastLocation] = useState(location);
  if (location !== lastLocation) {
    setLastLocation(location);
    setMenuOpen(false);
  }
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // After each page render, jump to the heading named in the URL (#id). The page body is a plain HTML string, so React can't do this for us.
  useEffect(() => {
    if (!hash) return;
    try {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    } catch {
      // A malformed hash like "#%" can't be decoded; just don't scroll.
    }
  }, [slug, hash]);

  useEffect(() => {
    const before = document.title;
    document.title = `${page?.title ?? 'Page not found'} · Nitpilot docs`;
    return () => {
      document.title = before;
    };
  }, [page]);

  /** One handler for the whole page body: its HTML is a string, so links and Copy buttons can't carry their own. */
  function onBodyClick(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-copy]');
    if (button) {
      const code = button.parentElement?.querySelector('pre')?.textContent ?? '';
      navigator.clipboard?.writeText(code).catch(() => {});
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy'), 1600);
      return;
    }
    const link = event.target.closest<HTMLAnchorElement>('a[href^="/docs"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void navigate(link.getAttribute('href')!);
  }

  const { prev, next } = neighbours(slug);
  return (
    <div
      className={styles.page}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !menuOpen) return;
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }}
    >
      <header className={styles.top}>
        <Link to="/" className={styles.brand}>
          <Wordmark size={22} />
        </Link>
        <button
          type="button"
          ref={menuButtonRef}
          className={styles.menuButton}
          aria-expanded={menuOpen}
          aria-controls="docs-pages"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          Menu
        </button>
        <Link to="/docs" className={styles.tag}>
          Docs
        </Link>
        <span className={styles.spacer} />
        <a className={`${styles.topLink} ${styles.repoLink}`} href={BRAND.repoUrl}>
          GitHub <span aria-hidden="true">↗</span>
        </a>
        <a className={styles.topLink} href={SIGN_IN_URL}>
          Sign in
        </a>
        <ThemeToggle />
      </header>

      <div className={styles.layout}>
        <nav
          id="docs-pages"
          className={`${styles.side} ${menuOpen ? styles.sideOpen : ''}`}
          aria-label="Docs pages"
          onClick={() => {
            // Closing the menu hides the focused link, so hand focus to the page first.
            if (menuOpen) mainRef.current?.focus({ preventScroll: true });
            setMenuOpen(false);
          }}
        >
          {DOC_GROUPS.map((group) => {
            const pages = DOC_PAGES.filter((p) => p.group === group);
            if (pages.length === 0) return null;
            return (
              <div key={group} className={styles.group}>
                <div className={styles.groupName}>{group}</div>
                {pages.map((p) => (
                  <Link
                    key={p.slug}
                    to={pagePath(p.slug)}
                    className={styles.sideLink}
                    aria-current={p.slug === slug ? 'page' : undefined}
                  >
                    {p.title}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>

        <main className={styles.main} ref={mainRef} tabIndex={-1}>
          {page && rendered ? (
            <>
              <div className={styles.crumb}>{page.group}</div>
              <h1 className={styles.title}>{page.title}</h1>
              {/* Safe: the Markdown is ours and built into the bundle; no user input reaches it. */}
              <div className={styles.body} onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: rendered.html }} />
              <div className={styles.pager}>
                {prev ? (
                  <Link to={pagePath(prev.slug)} className={styles.pagerLink}>
                    <span className={styles.pagerLabel}>Previous</span>
                    {prev.title}
                  </Link>
                ) : (
                  <span />
                )}
                {next && (
                  <Link to={pagePath(next.slug)} className={`${styles.pagerLink} ${styles.pagerNext}`}>
                    <span className={styles.pagerLabel}>Next</span>
                    {next.title}
                  </Link>
                )}
              </div>
            </>
          ) : (
            <>
              <h1 className={styles.title}>Page not found</h1>
              <p>
                There is no docs page at this address. Start from <Link to="/docs">Introduction</Link>.
              </p>
            </>
          )}
        </main>
        {rendered && <OnThisPage headings={rendered.headings} />}
      </div>
    </div>
  );
}

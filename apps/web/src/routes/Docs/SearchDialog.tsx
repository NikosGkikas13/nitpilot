import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router';
import styles from './SearchDialog.module.css';
import { pagePath } from './pages';
import { searchDocs, type SearchHit } from './search';

const hitPath = (hit: SearchHit) => `${pagePath(hit.slug)}${hit.heading ? `#${hit.heading.id}` : ''}`;

/** The ⌘K search: a dialog over the docs with an input and a list of matching pages and headings. */
export function Search({
  open,
  onClose,
  fallbackFocus,
  afterResultFocus,
}: {
  open: boolean;
  onClose: () => void;
  /** Gets focus on close when nothing real had it on open (Safari doesn't focus a button when it is clicked). */
  fallbackFocus?: RefObject<HTMLElement | null>;
  /** Gets focus instead when the dialog closed because a result was opened (the page behind it just changed). */
  afterResultFocus?: RefObject<HTMLElement | null>;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openedResult = useRef(false);
  const navigate = useNavigate();
  const hits = searchDocs(query);

  // On open, remember what had focus and move it to the input; on close, hand it back.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const fallback = fallbackFocus?.current;
    const afterResult = afterResultFocus?.current;
    inputRef.current?.focus();
    return () => {
      setQuery('');
      setActive(0);
      const hasOpener = opener instanceof HTMLElement && opener !== document.body && document.contains(opener);
      if (openedResult.current) {
        openedResult.current = false;
        afterResult?.focus({ preventScroll: true }); // preventScroll: the hash link scrolls to its heading
      } else {
        (hasOpener ? opener : fallback)?.focus();
      }
    };
  }, [open, fallbackFocus, afterResultFocus]);

  if (!open) return null;

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation(); // closes only the search, not the phone Menu behind it
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.min(Math.max(active + step, 0), Math.max(hits.length - 1, 0)));
    } else if (event.key === 'Enter' && hits[active]) {
      event.preventDefault();
      void navigate(hitPath(hits[active]));
      openedResult.current = true;
      onClose();
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Search docs" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className={styles.input}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="docs-search-results"
          aria-activedescendant={hits[active] ? `docs-hit-${active}` : undefined}
          placeholder="Search docs…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
        {query.trim() !== '' && hits.length === 0 && <p className={styles.empty}>No results</p>}
        <ul id="docs-search-results" role="listbox" className={styles.results}>
          {hits.map((hit, i) => (
            <li key={hitPath(hit)} id={`docs-hit-${i}`} role="option" aria-selected={i === active}>
              <Link to={hitPath(hit)} className={styles.hit} onClick={() => {
                  openedResult.current = true;
                  onClose();
                }} onMouseEnter={() => setActive(i)}>
                <span className={styles.hitTitle}>
                  {hit.pageTitle}
                  {hit.heading && <span className={styles.hitHeading}> › {hit.heading.text}</span>}
                </span>
                <span className={styles.snippet}>{hit.snippet}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

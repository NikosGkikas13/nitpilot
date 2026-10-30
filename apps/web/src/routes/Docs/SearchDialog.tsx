import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import styles from './SearchDialog.module.css';
import { searchDocs, type SearchHit } from './search';

const hitPath = (hit: SearchHit) => `/docs/${hit.slug}${hit.heading ? `#${hit.heading.id}` : ''}`;

/** The ⌘K search: a dialog over the docs with an input and a list of matching pages and headings. */
export function Search({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const hits = searchDocs(query);

  // On open, remember what had focus and move it to the input; on close, hand it back.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    inputRef.current?.focus();
    return () => {
      setQuery('');
      setActive(0);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

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
              <Link to={hitPath(hit)} className={styles.hit} onClick={onClose} onMouseEnter={() => setActive(i)}>
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

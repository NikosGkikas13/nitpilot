import type { DraftFile } from '@nitpilot/protocol';
import { useMemo, useState } from 'react';
import { splitDiff, type DiffFileView, type DiffLine } from '../../lib/diff';
import styles from './DiffView.module.css';

/** A file with more diff lines than this starts collapsed, so one big file doesn't bury the rest. */
const LONG_FILE_LINES = 80;

const SIGN: Record<DiffLine['kind'], string> = { add: '+', del: '−', context: ' ', hunk: '', note: '' };

/**
 * A draft commit's diff (handoff component sheet "Code snippet · diff"): one box per file, its path and `+adds −dels`
 * in a header that opens and closes it, then the lines. Added and removed lines carry a + or − sign as well as their
 * colour (handoff: "Draft fixes use +/− with sign glyphs, not color alone").
 */
export function DiffView({ diff, files }: { diff: string; files: DraftFile[] }) {
  const sections = useMemo(() => splitDiff(diff, files), [diff, files]);
  return (
    <div className={styles.diff}>
      {sections.map((file, i) => (
        <DiffFile key={`${i}:${file.path}`} file={file} />
      ))}
    </div>
  );
}

function DiffFile({ file }: { file: DiffFileView }) {
  const [open, setOpen] = useState(file.lines.length <= LONG_FILE_LINES);
  return (
    <section className={styles.file} aria-label={file.path}>
      <button type="button" className={styles.head} aria-expanded={open} aria-label={`${file.path}, ${file.adds} added, ${file.dels} removed`} onClick={() => setOpen(!open)}>
        <span className={styles.caret} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className={styles.path}>{file.path}</span>
        <span className={styles.adds}>+{file.adds}</span>
        <span className={styles.dels}>−{file.dels}</span>
      </button>
      {open && (
        <pre className={styles.code}>
          {file.lines.map((line, i) => (
            <div key={i} className={[styles.line, styles[line.kind]].filter(Boolean).join(' ')} data-kind={line.kind}>
              <span className={styles.number}>{line.n}</span>
              <span className={styles.sign}>{SIGN[line.kind]}</span>
              <code className={styles.text}>{line.text}</code>
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}

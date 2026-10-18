import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DRAFT_DIFF as DIFF, DRAFT_FILES as FILES } from '../../test/chat';
import { DiffView } from './DiffView';

const fileButton = (path: string) => screen.getByRole('button', { name: new RegExp(`^${path.replaceAll('.', '\\.')}`) });

describe('DiffView', () => {
  it('shows each file with its counts, and marks added and removed lines with a sign, not colour alone', () => {
    render(<DiffView diff={DIFF} files={FILES} />);
    expect(fileButton('src/orders/cursor.ts')).toHaveAccessibleName('src/orders/cursor.ts, 1 added, 1 removed');
    expect(fileButton('test/cursor.test.ts')).toHaveAccessibleName('test/cursor.test.ts, 1 added, 0 removed');
    const first = within(screen.getByRole('region', { name: 'src/orders/cursor.ts' }));
    const added = first.getByText("if (raw === '') return null;").closest('[data-kind]')!;
    const removed = first.getByText("const [ts, id] = raw.split(':');").closest('[data-kind]')!;
    expect(added).toHaveAttribute('data-kind', 'add');
    expect(added).toHaveTextContent(/^2\+/);
    expect(removed).toHaveAttribute('data-kind', 'del');
    expect(removed).toHaveTextContent(/^2−/);
  });

  it('collapses and opens each file on its own', async () => {
    render(<DiffView diff={DIFF} files={FILES} />);
    const first = fileButton('src/orders/cursor.ts');
    expect(first).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText("if (raw === '') return null;")).not.toBeInTheDocument();
    expect(screen.getByText("it('returns null for an empty cursor', () => expect(parseCursor('')).toBeNull());")).toBeInTheDocument();
    await userEvent.click(first);
    expect(screen.getByText("if (raw === '') return null;")).toBeInTheDocument();
  });

  it('starts a long file collapsed', async () => {
    const long = ['diff --git a/big.json b/big.json', '--- /dev/null', '+++ b/big.json', '@@ -0,0 +1,120 @@', ...Array.from({ length: 120 }, (_, i) => `+"line ${i}",`)].join('\n');
    render(<DiffView diff={long} files={[{ path: 'big.json', adds: 120, dels: 0 }]} />);
    expect(fileButton('big.json')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('"line 0",')).not.toBeInTheDocument();
    await userEvent.click(fileButton('big.json'));
    expect(screen.getByText('"line 0",')).toBeInTheDocument();
  });
});

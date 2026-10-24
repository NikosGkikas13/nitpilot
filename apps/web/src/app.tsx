import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { retryUnlessClientError } from './api/client';
import { Chat } from './routes/Chat/Chat';
import { Home } from './routes/Home/Home';
import { Settings } from './routes/Settings/Settings';
import { EmptyPane } from './routes/Shell/Pane';
import { InboxLayout } from './routes/Shell/Shell';

/**
 * Device approval, the setup checklist and the first-run page are pages most people open once (from `nitpilot login`,
 * after their first sign-in, and once per self-hosted server), so each is a file of its own that the browser fetches
 * only when that page opens (and the rest of the app stays under Vite's 500 kB chunk warning).
 */
const Approve = lazy(() => import('./routes/Approve/Approve').then((module) => ({ default: module.Approve })));
const Setup = lazy(() => import('./routes/Setup/Setup').then((module) => ({ default: module.Setup })));
const FirstRun = lazy(() => import('./routes/FirstRun/FirstRun').then((module) => ({ default: module.FirstRun })));

/** `queries` lets a test override a default (`retryDelay: 0`) while still using the real retry policy. */
export function makeQueryClient(queries: { retryDelay?: number } = {}): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: retryUnlessClientError, ...queries } } });
}

/** The whole app: the data cache, then the routes. */
export function App({ queryClient }: { queryClient?: QueryClient }) {
  // Made once and kept across re-renders; a new client would drop every cached query.
  const [client] = useState(() => queryClient ?? makeQueryClient());
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * Every page. Home decides between the landing page (signed out) and the app, or only a link to /first-run while the
 * server has no GitHub App. Signed in, the chat pages open beside the inbox (routes/Shell/Shell.tsx `InboxLayout`);
 * Settings and the setup checklist are pages of their own. Device approval (`/cli/approve`, the link `nitpilot login`
 * opens) and the first-run page stand outside Home: no landing page, no inbox, no socket.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Home />}>
        <Route element={<InboxLayout />}>
          <Route index element={<EmptyPane title="Pick a pull request" body="Its chat opens here." />} />
          <Route path="c/:owner/:repo/:number" element={<Chat />} />
          <Route path="*" element={<EmptyPane title="Nothing here" body="This page doesn't exist." />} />
        </Route>
        <Route path="settings" element={<Settings />} />
        <Route
          path="setup"
          element={
            <Suspense fallback={null}>
              <Setup />
            </Suspense>
          }
        />
      </Route>
      <Route
        path="cli/approve"
        element={
          <Suspense fallback={null}>
            <Approve />
          </Suspense>
        }
      />
      <Route
        path="first-run"
        element={
          <Suspense fallback={null}>
            <FirstRun />
          </Suspense>
        }
      />
    </Routes>
  );
}

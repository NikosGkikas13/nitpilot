import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { retryUnlessClientError } from './api/client';
import { Chat } from './routes/Chat/Chat';
import { Home } from './routes/Home/Home';
import { Settings } from './routes/Settings/Settings';
import { EmptyPane } from './routes/Shell/Pane';
import { InboxLayout } from './routes/Shell/Shell';

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
 * Every page. Home decides between the landing page (signed out) and the app. Signed in, the chat pages open beside
 * the inbox (routes/Shell/Shell.tsx `InboxLayout`), and Settings is a page of its own.
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
      </Route>
    </Routes>
  );
}

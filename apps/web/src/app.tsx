import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { retryUnlessClientError } from './api/client';
import { Home } from './routes/Home/Home';

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: retryUnlessClientError } } });
}

/** The whole app: the data cache, then the routes. */
export function App({ queryClient }: { queryClient?: QueryClient }) {
  // Made once and kept across re-renders; a new client would drop every cached query.
  const [client] = useState(() => queryClient ?? makeQueryClient());
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

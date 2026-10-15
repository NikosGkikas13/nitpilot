import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ThemeToggle } from './components/ThemeToggle/ThemeToggle';
import { Wordmark } from './components/Wordmark/Wordmark';

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
}

/** The whole app: data cache, then routes. Task 3 replaces the placeholder with the landing page and the inbox. */
export function App({ queryClient = makeQueryClient() }: { queryClient?: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Placeholder />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function Placeholder() {
  return (
    <main style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Wordmark />
      <ThemeToggle />
    </main>
  );
}

import './wdyr';
import { scan } from 'react-scan';
import { StrictMode } from 'react';
import { isPerfEnabled } from './utils/profiler';

if (typeof window !== 'undefined' && import.meta.env.DEV && isPerfEnabled()) {
  scan({
    enabled: true,
    log: true,
  });
}

import { createRoot } from 'react-dom/client';
import './i18n/index'; // must be imported before App
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 5000,
		},
	},
});

if (typeof window !== 'undefined') {
	(window as any).queryClient = queryClient;
}

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<ErrorBoundary label="the app">
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</ErrorBoundary>
	</StrictMode>,
);

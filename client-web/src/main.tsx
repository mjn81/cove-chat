import './wdyr';
import { StrictMode } from 'react';
import { isPerfEnabled } from './utils/profiler';

// react-scan (with its preact runtime) is a dev-only overlay. It is imported dynamically behind the DEV flag so the
// bundler drops the whole dependency from production builds instead of shipping ~130 kB of unused code.
if (typeof window !== 'undefined' && import.meta.env.DEV && isPerfEnabled()) {
  void import('react-scan').then(({ scan }) => scan({ enabled: true, log: true }));
}

import { createRoot } from 'react-dom/client';
import './i18n/index'; // must be imported before App
import './index.css';
import './styles/emoji-font.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from './components/ui/sonner';
import { DemoBanner } from './domains/demo/components/demo-banner';
import { VersionGate } from './domains/system/components/version-gate';

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
				<Toaster dir="auto" />
				<DemoBanner />
				<VersionGate />
			</QueryClientProvider>
		</ErrorBoundary>
	</StrictMode>,
);

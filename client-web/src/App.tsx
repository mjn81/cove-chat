import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, useAppStore } from './store/store';
import LoginPage    from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AppPage      from './pages/AppPage';
import ServerSelectionPage from './pages/ServerSelectionPage';
import { setApiBaseUrl } from './api/client';
import { isWails } from './utils/wails';
import LoadingScreen from './components/ui/LoadingScreen';

/** Redirect to /login when unauthenticated */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthLoading = useAuthStore(state => state.isAuthLoading)
  const user = useAuthStore(state => state.user);
  const location = useLocation();

  if (isAuthLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

/** Redirect to app when already authenticated */
function RequireGuest({ children }: { children: React.ReactNode }) {
  const isAuthLoading = useAuthStore(state => state.isAuthLoading);
  const user = useAuthStore((state) => state.user);

  if (isAuthLoading) return <LoadingScreen />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  const theme = useAppStore(state => state.theme);
  const [isWailsReady, setIsWailsReady] = React.useState(false);
  const [shouldConnect, setShouldConnect] = React.useState(false);

  useEffect(() => {
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    let unmounted = false;

    const init = async () => {
      try {
        const timeoutPromise = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Auth initialization timeout')), 6000)
        );

        const initPromise = (async () => {
          if (isWails()) {
            try {
              const wails = (window as any).go?.main?.App;
              const savedUrl = await wails?.GetServerURL?.();
              if (savedUrl) {
                setApiBaseUrl(savedUrl);
                await useAuthStore.getState().initAuth();
              } else {
                setShouldConnect(true);
                useAuthStore.setState({ isAuthLoading: false });
              }
            } catch (err) {
              console.error('Wails server URL check failed:', err);
              setShouldConnect(true);
              useAuthStore.setState({ isAuthLoading: false });
            }
          } else {
            await useAuthStore.getState().initAuth();
          }
        })();

        await Promise.race([initPromise, timeoutPromise]);
      } catch (err) {
        console.warn('App init timed out or encountered an error, unblocking:', err);
        useAuthStore.setState({ isAuthLoading: false });
      } finally {
        if (!unmounted) {
          setIsWailsReady(true);
        }
      }
    };

    init();
    
    const handleUrlChanged = () => {
      setShouldConnect(false);
    };

    const handleUnauthorized = () => {
      useAuthStore.getState().logout();
    };

    window.addEventListener('api:url_changed', handleUrlChanged);
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      unmounted = true;
      window.removeEventListener('api:url_changed', handleUrlChanged);
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  if (!isWailsReady) return <LoadingScreen />;

  return (
    <BrowserRouter>
      {shouldConnect && <Navigate to="/connect" replace />}
      <Routes>
        {/* Public routes */}
        <Route path="/connect"  element={<ServerSelectionPage />} />
        <Route path="/login"    element={<RequireGuest><LoginPage /></RequireGuest>} />
        <Route path="/register" element={<RequireGuest><RegisterPage /></RequireGuest>} />

        {/* Support legacy /join/ paths which AppPage handles internally */}
        <Route path="/join/*" element={
          <RequireAuth>
            <AppPage />
          </RequireAuth>
        } />

        {/* Main app shell */}
        <Route path="/" element={
          <RequireAuth>
            <AppPage />
          </RequireAuth>
        } />

        {/* Catch-all 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}

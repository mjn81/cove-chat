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
    const init = async () => {
      // Check for Wails server URL
      if (isWails()) {
        const wails = (window as any).go.main.App;
        const savedUrl = await wails.GetServerURL();
        if (savedUrl) {
          setApiBaseUrl(savedUrl);
          // Only init auth if we have a saved server
          await useAuthStore.getState().initAuth();
        } else {
          setShouldConnect(true);
          // Stop auth loading since we can't check session without a server
          useAuthStore.setState({ isAuthLoading: false });
        }
      } else {
        // Standard web browser mode
        await useAuthStore.getState().initAuth();
      }
      
      setIsWailsReady(true);
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

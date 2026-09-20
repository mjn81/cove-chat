import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/store/app.slice';
import { useAuthStore } from '@/store/auth.slice';
import GooLoaderDark from './GooLoaderDark';
import GooLoaderLight from './GooLoaderLight';
import { RefreshCw, LogIn, RotateCcw } from 'lucide-react';

interface LoadingScreenProps {
  message?: string;
  subtext?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Connecting to NodeTalk',
  subtext = 'Establishing encrypted session...',
}) => {
  const theme = useAppStore((s) => s.theme);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowTroubleshoot(true);
    }, 4000);

    return () => clearTimeout(timer);
  }, []);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await useAuthStore.getState().initAuth();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleGoToLogin = () => {
    useAuthStore.setState({ isAuthLoading: false, user: null });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background select-none">
      <div className="mb-6">
        {theme === 'light' ? <GooLoaderLight /> : <GooLoaderDark />}
      </div>

      <div className="flex flex-col items-center text-center space-y-1.5 px-4">
        <span className="text-base font-semibold text-foreground">{message}</span>
        {subtext && (
          <p className="text-xs text-muted-foreground">{subtext}</p>
        )}
      </div>

      {showTroubleshoot && (
        <div className="mt-8 flex flex-col items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <p className="text-xs text-muted-foreground mb-1">
            Taking longer than expected?
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isRetrying}
              onClick={handleRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary hover:bg-accent text-foreground transition-colors cursor-pointer border border-border"
            >
              <RefreshCw size={12} className={isRetrying ? 'animate-spin' : ''} />
              Retry
            </button>
            <button
              type="button"
              onClick={handleGoToLogin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <LogIn size={12} />
              Go to Login
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
              title="Reload Page"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoadingScreen;


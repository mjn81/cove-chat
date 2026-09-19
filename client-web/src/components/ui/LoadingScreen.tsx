import React from 'react';
import { useAppStore } from '@/store/app.slice';
import GooLoaderDark from './GooLoaderDark';
import GooLoaderLight from './GooLoaderLight';

interface LoadingScreenProps {
  message?: string;
  subtext?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Connecting to NodeTalk',
  subtext = 'Establishing encrypted session...',
}) => {
  const theme = useAppStore((s) => s.theme);

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
    </div>
  );
};

export default LoadingScreen;

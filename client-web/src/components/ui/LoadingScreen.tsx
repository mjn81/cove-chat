import React from 'react';

interface LoadingScreenProps {
  message?: string;
  subtext?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Connecting to NodeTalk',
  subtext = 'Establishing encrypted session...',
}) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background select-none overflow-hidden">
      {/* Background ambient glowing orbs */}
      <div className="absolute w-96 h-96 rounded-full bg-primary/10 blur-[120px] pointer-events-none animate-pulse" />
      <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-indigo-500/10 blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-cyan-500/10 blur-[100px] pointer-events-none" />

      {/* Center animated node container */}
      <div className="relative flex items-center justify-center mb-8">
        {/* Outer orbital rotating gradient ring */}
        <div className="w-28 h-28 rounded-full border-2 border-transparent border-t-primary border-r-indigo-500/50 animate-spin" style={{ animationDuration: '3s' }} />

        {/* Counter-rotating inner dashed ring */}
        <div className="absolute w-20 h-20 rounded-full border border-dashed border-primary/40 border-b-cyan-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '4s' }} />

        {/* Pulsing core glow */}
        <div className="absolute w-14 h-14 rounded-2xl bg-primary/20 backdrop-blur-md border border-primary/40 shadow-[0_0_25px_rgba(88,101,242,0.4)] flex items-center justify-center animate-pulse">
          {/* Stylized interconnected nodes icon */}
          <svg
            className="w-7 h-7 text-primary animate-in zoom-in duration-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" strokeDasharray="3 3" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" strokeDasharray="3 3" />
          </svg>
        </div>

        {/* Orbiting particle dots */}
        <div className="absolute w-28 h-28 animate-spin" style={{ animationDuration: '6s' }}>
          <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] -top-1 left-1/2 -translate-x-1/2 absolute" />
        </div>
        <div className="absolute w-20 h-20 animate-spin" style={{ animationDuration: '4.5s', animationDirection: 'reverse' }}>
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_6px_#818cf8] -bottom-1 left-1/2 -translate-x-1/2 absolute" />
        </div>
      </div>

      {/* Brand title & loading message */}
      <div className="flex flex-col items-center text-center space-y-2 z-10 px-4">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-wider text-foreground">
            {message}
          </span>
          {/* Animated jumping dots */}
          <span className="flex items-center gap-1 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" />
          </span>
        </div>

        {subtext && (
          <p className="text-xs font-medium text-muted-foreground tracking-wide">
            {subtext}
          </p>
        )}
      </div>

      {/* Modern thin loading beam line */}
      <div className="w-48 h-0.5 bg-secondary/80 rounded-full mt-6 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary to-transparent animate-[shimmer_1.8s_infinite] -translate-x-full w-full" 
             style={{ animation: 'shimmer 1.8s ease-in-out infinite' }} />
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default LoadingScreen;

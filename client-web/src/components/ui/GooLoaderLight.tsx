import React from 'react';

export const GooLoaderLight: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="goo" viewBox="0 0 64 64" width="96" height="96" fill="none" role="img" aria-label="Loading">
    <style>{`
      /* Two knobs: color is the ink, --rate multiplies every duration. */
      svg { color: #060607; --rate: 1; }

      .goo-bound { stroke: currentColor; stroke-width: 1; opacity: .14; }

      .goo-arm {
        transform-box: view-box;
        transform-origin: center;
        animation: goo-swing calc(var(--dur) * var(--rate, 1)) linear infinite;
      }

      .goo-core {
        transform-box: view-box;
        transform-origin: center;
        animation: goo-breathe calc(3.2s * var(--rate, 1)) ease-in-out infinite;
      }

      @keyframes goo-swing   { from { transform: rotate(0deg); } to { transform: rotate(calc(var(--dir) * 360deg)); } }
      @keyframes goo-breathe { 0%, 100% { transform: scale(.82); } 50% { transform: scale(1.05); } }

      @media (prefers-reduced-motion: reduce) {
        .goo-arm  { animation: none; transform: rotate(var(--rest)); }
        .goo-core { animation: none; transform: scale(1); }
      }
    `}</style>

    <defs>
      <filter id="goo-weld-light" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="soft"/>
        <feColorMatrix in="soft" type="matrix"
          values="1 0 0 0 0
                  0 1 0 0 0
                  0 0 1 0 0
                  0 0 0 19 -8"/>
      </filter>
    </defs>
    <circle className="goo-bound" cx="32" cy="32" r="30"/>
    <g filter="url(#goo-weld-light)" fill="currentColor">
      <circle className="goo-core" cx="32" cy="32" r="9.5"/>
      <g className="goo-arm" style={{ '--dur': '2.8s', '--dir': 1, '--rest': '20deg' } as React.CSSProperties}><circle cx="32" cy="21" r="7"/></g>
      <g className="goo-arm" style={{ '--dur': '3.6s', '--dir': -1, '--rest': '140deg' } as React.CSSProperties}><circle cx="32" cy="17.5" r="5.5"/></g>
      <g className="goo-arm" style={{ '--dur': '2.2s', '--dir': 1, '--rest': '255deg' } as React.CSSProperties}><circle cx="32" cy="23" r="4.6"/></g>
      <g className="goo-arm" style={{ '--dur': '4.4s', '--dir': -1, '--rest': '310deg' } as React.CSSProperties}><circle cx="32" cy="16" r="4"/></g>
    </g>
  </svg>
);

export default GooLoaderLight;

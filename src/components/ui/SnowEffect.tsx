'use client';

import { useState, useSyncExternalStore } from 'react';

const subscribeToNothing = () => () => { };
const onClient = () => true;
const onServer = () => false;

export default function SnowEffect() {
    // The flakes are randomly positioned, so they must never render on the
    // server — the markup would not match what the client produces.
    const mounted = useSyncExternalStore(subscribeToNothing, onClient, onServer);

    // Rolled once at mount, not per render: re-rolling would teleport every
    // flake whenever this component happens to re-render.
    const [flakes] = useState(() =>
        Array.from({ length: 50 }, () => ({
            size: Math.random() * 5 + 2 + 'px',
            left: Math.random() * 100 + 'vw',
            animationDelay: Math.random() * 5 + 's',
            animationDuration: Math.random() * 3 + 4 + 's',
        }))
    );

    if (!mounted) return null;

    return (
        <>
            <style jsx global>{`
        .snowflake {
          position: absolute;
          top: -10px;
          background-color: #fff; /* White snow */
          border-radius: 50%;
          opacity: 0.8;
          pointer-events: none;
          z-index: 50; /* Above other content but typically below modals */
          animation: fall linear infinite;
        }

        @keyframes fall {
          0% {
            transform: translateY(0) translateX(0);
            opacity: 0.8;
          }
          100% {
            transform: translateY(100vh) translateX(20px);
            opacity: 0.3;
          }
        }
      `}</style>
            <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
                {flakes.map((flake, i) => (
                    <div
                        key={i}
                        className="snowflake"
                        style={{
                            width: flake.size,
                            height: flake.size,
                            left: flake.left,
                            animationDelay: flake.animationDelay,
                            animationDuration: flake.animationDuration,
                        }}
                    />
                ))}
            </div>
        </>
    );
}

'use client';

import { useState, useSyncExternalStore } from 'react';

const subscribeToNothing = () => () => { };
const onClient = () => true;
const onServer = () => false;

export default function RainEffect() {
    // The drops are randomly positioned, so they must never render on the
    // server — the markup would not match what the client produces.
    const mounted = useSyncExternalStore(subscribeToNothing, onClient, onServer);

    // Rolled once at mount, not per render: re-rolling would teleport every
    // drop whenever this component happens to re-render.
    const [drops] = useState(() =>
        Array.from({ length: 80 }, () => ({
            height: Math.random() * 40 + 40 + 'px',
            left: Math.random() * 100 + 'vw',
            animationDelay: Math.random() * 3 + 's',
            animationDuration: Math.random() * 0.5 + 0.5 + 's',
        }))
    );

    if (!mounted) return null;

    return (
        <>
            <style jsx global>{`
        .raindrop {
          position: absolute;
          top: -120px;
          width: 1.5px;
          background: linear-gradient(
            to bottom,
            rgba(174, 214, 241, 0),
            rgba(174, 214, 241, 0.6)
          );
          pointer-events: none;
          z-index: 50; /* Above other content but typically below modals */
          animation: rainfall linear infinite;
        }

        @keyframes rainfall {
          0% {
            transform: translateY(0);
            opacity: 0.6;
          }
          100% {
            transform: translateY(120vh);
            opacity: 0.2;
          }
        }
      `}</style>
            <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
                {drops.map((drop, i) => (
                    <div
                        key={i}
                        className="raindrop"
                        style={{
                            height: drop.height,
                            left: drop.left,
                            animationDelay: drop.animationDelay,
                            animationDuration: drop.animationDuration,
                        }}
                    />
                ))}
            </div>
        </>
    );
}

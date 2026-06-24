'use client';

import { useEffect, useState } from 'react';

export default function RainEffect() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

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
                {Array.from({ length: 80 }).map((_, i) => {
                    const height = Math.random() * 40 + 40 + 'px';
                    const left = Math.random() * 100 + 'vw';
                    const animationDelay = Math.random() * 3 + 's';
                    const animationDuration = Math.random() * 0.5 + 0.5 + 's';

                    return (
                        <div
                            key={i}
                            className="raindrop"
                            style={{
                                height: height,
                                left: left,
                                animationDelay: animationDelay,
                                animationDuration: animationDuration,
                            }}
                        />
                    );
                })}
            </div>
        </>
    );
}

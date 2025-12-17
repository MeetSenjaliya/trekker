'use client';

import { useEffect, useState } from 'react';

export default function SnowEffect() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

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
                {Array.from({ length: 50 }).map((_, i) => {
                    const size = Math.random() * 5 + 2 + 'px';
                    const left = Math.random() * 100 + 'vw';
                    const animationDelay = Math.random() * 5 + 's';
                    const animationDuration = Math.random() * 3 + 4 + 's';

                    return (
                        <div
                            key={i}
                            className="snowflake"
                            style={{
                                width: size,
                                height: size,
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

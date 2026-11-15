
"use client";

import React from "react";

// Aries mark: ram-horn routing topology (matches public/favicon.svg). The old
// 4-arrow "X" mark read as the Xrouter brand at small sizes, so it was replaced.
export default function LogoMark({ className = "size-full" }) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`.trim()}>
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="size-full overflow-hidden block"
      >
        <defs>
          <linearGradient id="aries-logo-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#E25539" />
            <stop offset="100%" stopColor="#EB6446" />
          </linearGradient>
        </defs>

        {/* Squircle container background */}
        <rect
          x="4"
          y="4"
          width="92"
          height="92"
          rx="22"
          className="fill-surface-2 dark:fill-[#18191C] stroke-border dark:stroke-[#26282D]"
          strokeWidth="2"
        />

        {/* Aries ram horns, curling outward from a center bridge */}
        <g
          stroke="var(--color-brand-500, url(#aries-logo-gradient))"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="8"
          fill="none"
        >
          {/* Left horn */}
          <path d="M 50 68 C 50 55 43 44 34 37 C 26 31 17 34 16 41 C 15 48 21 54 28 53 C 32 52.5 34.5 49 33.5 46" />
          {/* Right horn */}
          <path d="M 50 68 C 50 55 57 44 66 37 C 74 31 83 34 84 41 C 85 48 79 54 72 53 C 68 52.5 65.5 49 66.5 46" />
          {/* Center bridge / muzzle */}
          <path d="M 42 76 L 58 76" strokeWidth="7" />
        </g>
      </svg>
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";

/* Measured visible viewport.
   window.innerHeight reports the LAYOUT viewport, which on a phone still
   includes the strip hidden behind the browser chrome (URL bar). A modal
   sized from that number is taller than what the user can actually see, so
   its header slides under the app bar.
   window.visualViewport reports the VISIBLE viewport — it shrinks the moment
   the URL bar expands or the soft keyboard opens — so a cap derived from it
   can never spill under the chrome.
   Measured in CSS pixels, so it lines up with the CSS viewport units used for
   layout; the returned numbers are ready to be used as inline pixel values. */
export function useVisibleViewport() {
  const [viewport, setViewport] = useState({ height: 0, width: 0, top: 0 });

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;

    const measure = () => {
      if (!vv) {
        setViewport({ height: window.innerHeight, width: window.innerWidth, top: 0 });
        return;
      }
      setViewport({
        height: Math.round(vv.height),
        width: Math.round(vv.width),
        top: Math.round(vv.offsetTop || 0),
      });
    };

    measure();
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  return viewport;
}

export default useVisibleViewport;

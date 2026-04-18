"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import NProgress from "nprogress";
import "nprogress/nprogress.css";

NProgress.configure({ showSpinner: false, trickleSpeed: 200 });

function FinishBarOnNavigate() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    NProgress.done();
  }, [pathname, searchParams]);

  return null;
}

export function NavigationProgress() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = (e.target as HTMLElement | null)?.closest("a[href]");
      if (!el || !(el instanceof HTMLAnchorElement)) return;
      if (el.target === "_blank" || el.download) return;
      const href = el.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const samePath =
        url.pathname === window.location.pathname &&
        url.search === window.location.search;
      if (samePath) return;
      NProgress.start();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <Suspense fallback={null}>
      <FinishBarOnNavigate />
    </Suspense>
  );
}

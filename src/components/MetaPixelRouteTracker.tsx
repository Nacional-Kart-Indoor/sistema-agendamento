import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { attachExternalId, isInternalRoute, trackPageView } from '@/lib/meta-pixel';

/**
 * PageView em toda troca de rota da SPA.
 * O PageView do primeiro carregamento já sai no snippet do index.html.
 */
export function MetaPixelRouteTracker() {
  const location = useLocation();
  const lastPath = useRef<string>(location.pathname);

  useEffect(() => {
    attachExternalId();
  }, []);

  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    if (isInternalRoute(location.pathname)) return;
    trackPageView();
  }, [location.pathname]);

  return null;
}

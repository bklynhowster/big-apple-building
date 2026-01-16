import { useState, useEffect } from 'react';

// Mobile breakpoint aligned with Tailwind's `sm` (640px)
export const BREAKPOINTS = {
  mobile: 640,
  tablet: 768,
  desktop: 1024,
} as const;

export function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${BREAKPOINTS.mobile - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < BREAKPOINTS.mobile);
    };
    mql.addEventListener('change', onChange);
    setIsMobile(window.innerWidth < BREAKPOINTS.mobile);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile ?? false;
}

export function useIsTabletViewport() {
  const [isTablet, setIsTablet] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const check = () => {
      const width = window.innerWidth;
      setIsTablet(width >= BREAKPOINTS.mobile && width < BREAKPOINTS.desktop);
    };
    window.addEventListener('resize', check);
    check();
    return () => window.removeEventListener('resize', check);
  }, []);

  return isTablet ?? false;
}

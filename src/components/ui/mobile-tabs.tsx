import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

/**
 * MobileTabsList: A horizontally scrollable tab strip for phones.
 * Prevents vertical scroll traps and uses -webkit-overflow-scrolling: touch.
 */
const MobileTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <div
    className="overflow-x-auto overflow-y-visible touch-pan-x scrollbar-hide"
    style={{
      WebkitOverflowScrolling: 'touch',
      overscrollBehavior: 'contain',
    }}
  >
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex h-12 items-center bg-transparent p-0 min-w-max',
        className
      )}
      {...props}
    />
  </div>
));
MobileTabsList.displayName = 'MobileTabsList';

/**
 * MobileTabsTrigger: Larger tap targets for mobile (min-height 44px).
 */
const MobileTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Larger touch target, no wrapping
      'inline-flex items-center justify-center whitespace-nowrap px-4 py-3 min-h-[44px]',
      // Typography
      'text-sm font-medium',
      // Border-based active indicator (bottom)
      'rounded-none border-b-2 border-transparent',
      'data-[state=active]:border-primary data-[state=active]:text-foreground',
      'data-[state=inactive]:text-muted-foreground',
      // Transitions
      'ring-offset-background transition-all',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:pointer-events-none disabled:opacity-50',
      className
    )}
    {...props}
  />
));
MobileTabsTrigger.displayName = 'MobileTabsTrigger';

export { MobileTabsList, MobileTabsTrigger };

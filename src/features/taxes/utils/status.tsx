/**
 * Payment status utilities for tax display
 */

import React from 'react';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { PaymentStatus } from '../types';

export interface StatusInfo {
  label: string;
  variant: 'default' | 'destructive' | 'secondary' | 'outline';
  icon: React.ReactNode;
}

/**
 * Get payment status badge info for display
 */
export function getPaymentStatusInfo(status: PaymentStatus | undefined): StatusInfo | null {
  switch (status) {
    case 'paid':
      return { 
        label: 'Paid', 
        variant: 'default', 
        icon: <CheckCircle2 className="h-3 w-3" /> 
      };
    case 'unpaid':
      return { 
        label: 'Unpaid', 
        variant: 'destructive', 
        icon: <XCircle className="h-3 w-3" /> 
      };
    case 'unknown':
      return { 
        label: 'Unknown', 
        variant: 'secondary', 
        icon: <Clock className="h-3 w-3" /> 
      };
    default:
      return null;
  }
}

/**
 * Get payment status badge info with icon for inline display (includes margin)
 */
export function getPaymentStatusBadgeInfo(status: PaymentStatus): StatusInfo | null {
  switch (status) {
    case 'paid':
      return { 
        label: 'Paid', 
        variant: 'default', 
        icon: <CheckCircle2 className="h-3 w-3 mr-1" /> 
      };
    case 'unpaid':
      return { 
        label: 'Unpaid', 
        variant: 'destructive', 
        icon: <XCircle className="h-3 w-3 mr-1" /> 
      };
    case 'unknown':
      return { 
        label: 'Status Unknown', 
        variant: 'secondary', 
        icon: <Clock className="h-3 w-3 mr-1" /> 
      };
    default:
      return null;
  }
}

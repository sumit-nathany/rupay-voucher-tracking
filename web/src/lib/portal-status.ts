export const PORTAL_STATUS_EXPLANATIONS: Record<string, string> = {
  tracker_reference_conflict:
    'A previous order reference conflicted with another card. Check RuPay portal orders.',
  worker_lost_after_submit_started:
    'Automation worker lost connection during checkout. Check RuPay portal orders.',
  network_post_submit:
    'Network disconnected after 3DS authorization. Check RuPay portal orders.',
  credentials_expired:
    'Portal sign-in failed. Please update portal login credentials.',
  challenge_required:
    'Portal required a captcha or security challenge. Sign in manually to clear.',
  portal_changed:
    'Portal layout changed unexpectedly. Check account configuration.',
};

export const PORTAL_STATUS_RESOLUTIONS: Record<string, string> = {
  tracker_reference_conflict:
    'A previous order reference conflicted with another card. Please verify your RuPay portal orders and reconnect this account when ready.',
  worker_lost_after_submit_started:
    'Automation worker lost connection during checkout. Please verify your RuPay portal orders and reconnect this account when ready.',
  network_post_submit:
    'Network disconnected after 3DS authorization. Please verify your RuPay portal orders and reconnect this account when ready.',
  credentials_expired:
    'Portal sign-in failed. Please update portal login credentials.',
  challenge_required:
    'Portal required a captcha or security challenge. Sign in manually to clear.',
  portal_changed:
    'Portal layout changed unexpectedly. Check account configuration.',
};

export function getPortalStatusExplanation(
  status: string,
  statusDetailCode?: string | null,
): string {
  if (statusDetailCode && PORTAL_STATUS_EXPLANATIONS[statusDetailCode]) {
    return PORTAL_STATUS_EXPLANATIONS[statusDetailCode];
  }
  if (PORTAL_STATUS_EXPLANATIONS[status]) {
    return PORTAL_STATUS_EXPLANATIONS[status];
  }
  if (statusDetailCode) {
    return `Issue: ${statusDetailCode.replace(/_/g, ' ')}. Check RuPay portal orders.`;
  }
  if (status === 'needs_attention') {
    return 'Account needs attention before automation can proceed. Check RuPay portal orders.';
  }
  return 'The worker will skip this account until it is fixed.';
}

export function getPortalStatusResolution(
  status: string,
  statusDetailCode?: string | null,
): string {
  if (statusDetailCode && PORTAL_STATUS_RESOLUTIONS[statusDetailCode]) {
    return PORTAL_STATUS_RESOLUTIONS[statusDetailCode];
  }
  if (PORTAL_STATUS_RESOLUTIONS[status]) {
    return PORTAL_STATUS_RESOLUTIONS[status];
  }
  if (statusDetailCode) {
    return `An issue occurred (${statusDetailCode.replace(/_/g, ' ')}). Please verify your RuPay portal orders and reconnect this account when ready.`;
  }
  return 'This account requires attention before automated ordering can proceed. Please verify your RuPay portal orders and reconnect this account when ready.';
}

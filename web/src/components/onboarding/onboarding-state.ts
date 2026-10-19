export const ONBOARDING_DISMISSED_KEY = 'rupay_onboarding_dismissed';

export function markOnboardingDismissed(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, 'true');
    } catch {
      // Ignore storage errors (private browsing, etc.)
    }
  }
}

export function isOnboardingDismissed(): boolean {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      return window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  }
  return false;
}

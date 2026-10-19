import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ONBOARDING_DISMISSED_KEY,
  isOnboardingDismissed,
  markOnboardingDismissed,
} from './onboarding-state';

describe('Onboarding State Management', () => {
  let mockStore: Record<string, string> = {};

  beforeEach(() => {
    mockStore = {};
    const mockStorage = {
      getItem: (key: string) => mockStore[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStore[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStore[key];
      },
      clear: () => {
        mockStore = {};
      },
    };

    (globalThis as unknown as { window: unknown }).window = {
      localStorage: mockStorage,
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('reports not dismissed when localStorage is empty', () => {
    expect(isOnboardingDismissed()).toBe(false);
  });

  it('marks onboarding as dismissed and preserves state', () => {
    markOnboardingDismissed();
    expect(isOnboardingDismissed()).toBe(true);
    expect(mockStore[ONBOARDING_DISMISSED_KEY]).toBe('true');
  });

  it('remains dismissed across multiple checks', () => {
    markOnboardingDismissed();
    expect(isOnboardingDismissed()).toBe(true);
    expect(isOnboardingDismissed()).toBe(true);
  });
});

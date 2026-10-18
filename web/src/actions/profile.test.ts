import { describe, expect, it } from 'vitest';
import { changePasswordAction } from './profile';

describe('profile actions validation', () => {
  it('rejects short passwords', async () => {
    const res = await changePasswordAction({
      newPassword: '123',
      confirmPassword: '123',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at least 6 characters/i);
  });

  it('rejects mismatched passwords', async () => {
    const res = await changePasswordAction({
      newPassword: 'password123',
      confirmPassword: 'password456',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not match/i);
  });
});

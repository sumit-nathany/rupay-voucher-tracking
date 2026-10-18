'use server';

import { z } from 'zod';
import { createSupabaseServerClient, getCtxAndUser } from '@/lib/session';
import { mapAuthError } from '@/lib/auth-errors';
import * as domain from '@/domain/profile';
import { eq } from 'drizzle-orm';
import { workspaces } from '@/db/schema';
import { AuthzError } from '@/lib/context';

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6, 'New password must be at least 6 characters long'),
  confirmPassword: z.string().min(6, 'Confirm password must be at least 6 characters long'),
});

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Workspace name cannot be empty').max(100, 'Workspace name is too long'),
});

export async function getUserProfileAction(): Promise<{
  ok: boolean;
  data?: domain.UserProfileView;
  error?: string;
}> {
  try {
    const { ctx, user } = await getCtxAndUser();
    const profile = await domain.getProfileView(ctx, {
      email: user.email,
      emailConfirmedAt: user.email_confirmed_at,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at,
    });
    return { ok: true, data: profile };
  } catch (err) {
    console.error('[getUserProfileAction]', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve profile details.',
    };
  }
}

export async function changePasswordAction(
  input: unknown,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    }

    const { currentPassword, newPassword, confirmPassword } = parsed.data;

    if (newPassword !== confirmPassword) {
      return { ok: false, error: 'New password and confirmation do not match.' };
    }

    const { user } = await getCtxAndUser();
    const supabase = await createSupabaseServerClient();

    // If current password was provided, verify it first
    if (currentPassword && currentPassword.trim().length > 0) {
      if (!user.email) {
        return { ok: false, error: 'No email address associated with this account.' };
      }

      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (verifyErr) {
        return {
          ok: false,
          error:
            'Current password is incorrect. (If you have never set a password, leave the current password box empty.)',
        };
      }
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    if (updateErr) {
      return { ok: false, error: mapAuthError(updateErr.message) };
    }

    return { ok: true, message: 'Your password has been changed successfully.' };
  } catch (err) {
    console.error('[changePasswordAction]', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred while changing password.',
    };
  }
}

export async function updateWorkspaceNameAction(
  input: unknown,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const { ctx } = await getCtxAndUser();
    if (ctx.role !== 'admin') {
      throw new AuthzError('Only workspace admins can rename the workspace.');
    }

    const parsed = updateWorkspaceSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid workspace name' };
    }

    await ctx.db
      .update(workspaces)
      .set({ name: parsed.data.name })
      .where(eq(workspaces.id, ctx.workspaceId));

    return { ok: true, message: 'Workspace name updated successfully.' };
  } catch (err) {
    console.error('[updateWorkspaceNameAction]', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to update workspace name.',
    };
  }
}

'use server';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient, getCtx } from '@/lib/session';

/** After browser sign-in: provision workspace using cookies on this request. */
export async function bootstrapSessionAction(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await getCtx();
    return { ok: true };
  } catch (err) {
    console.error('[bootstrapSessionAction] Workspace setup failed:', err);
    return {
      ok: false,
      message: 'Signed in, but your workspace could not be set up. The database may be unreachable.',
    };
  }
}

export async function setPassword(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  if (password !== String(formData.get('confirm') ?? '')) redirect('/auth/set-password?error=mismatch');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  // Supabase's message names the rule that failed (too short, same as old, too weak). Show it.
  if (error) redirect(`/auth/set-password?error=failed&reason=${encodeURIComponent(error.message.slice(0, 200))}`);
  redirect('/');
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/auth/login');
}

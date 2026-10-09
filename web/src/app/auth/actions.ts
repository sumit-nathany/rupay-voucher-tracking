'use server';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient, getCtx } from '@/lib/session';

export async function signIn(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });
  if (error) redirect('/auth/login?error=invalid_credentials');
  await getCtx(); // provisions workspace on first login
  redirect('/');
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

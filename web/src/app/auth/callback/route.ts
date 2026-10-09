import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getCtx, createSupabaseServerClient } from '@/lib/session';

// Same-origin relative paths only (no open redirect).
function safeNext(n: string | null): string {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

// Handles both Supabase link styles: PKCE `code` and invite/recovery `token_hash`+`type`.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const supabase = await createSupabaseServerClient();
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  if (!ok) return NextResponse.redirect(`${origin}/auth/login?error=invalid_link`);

  // First login of an invited user: getCtx() provisions workspace + owner membership.
  await getCtx();
  // Invited users arrive without a password; send them to set one.
  const next = type === 'invite' || type === 'recovery' ? '/auth/set-password' : safeNext(searchParams.get('next'));
  return NextResponse.redirect(`${origin}${next}`);
}

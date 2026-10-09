import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { provisionWorkspace } from '@/lib/session';

// Same-origin relative paths only (no open redirect).
function safeNext(n: string | null): string {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

// Handles both Supabase link styles: PKCE `code` and invite/recovery `token_hash`+`type`.
// Cookies must be written onto the redirect response (not only next/headers) or the session is lost.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  const next =
    type === 'invite' || type === 'recovery' ? '/auth/set-password' : safeNext(searchParams.get('next'));
  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;

  if (!ok) return NextResponse.redirect(`${origin}/auth/login?error=invalid_link`);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/auth/login?error=invalid_link`);

  try {
    const { db } = await import('@/db');
    await provisionWorkspace(db, user.id);
  } catch {
    return NextResponse.redirect(`${origin}/auth/login?error=setup_failed`);
  }

  return response;
}

/** Map Supabase Auth errors to text users can act on (never log passwords). */
export function mapAuthError(message: string, status?: number): string {
  const m = message.trim();
  const lower = m.toLowerCase();

  if (lower.includes('email logins are disabled') || lower.includes('email provider is disabled')) {
    return 'Email sign-in is turned off in Supabase. In the dashboard open Authentication → Providers → Email and enable it (with password sign-in).';
  }
  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    return 'Wrong email or password. If this is your first time, open your invite email, set a password, then sign in here.';
  }
  if (lower.includes('email not confirmed')) {
    return 'This email is not confirmed yet. Use the link in your invite email, or ask for a new invite.';
  }
  if (lower.includes('user not found')) {
    return 'No account for this email. You need an invite before you can sign in.';
  }
  if (status === 429 || lower.includes('rate limit')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (process.env.NODE_ENV === 'development' && m) {
    return m;
  }
  return 'Could not sign in. Check your email and password, or use your invite link to set a password first.';
}

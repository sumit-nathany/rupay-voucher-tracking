'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Check,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  Gift,
  KeyRound,
  Lock,
  Mail,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { UserProfileView } from '@/domain/profile';
import { changePasswordAction, updateWorkspaceNameAction } from '@/actions/profile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ProfileView({ initialData }: { initialData: UserProfileView }) {
  const [profile, setProfile] = useState<UserProfileView>(initialData);

  // Copy state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Workspace edit state
  const [isEditingWs, setIsEditingWs] = useState(false);
  const [wsName, setWsName] = useState(initialData.workspace.name);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsSuccess, setWsSuccess] = useState<string | null>(null);
  const [isWsPending, startWsTransition] = useTransition();

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [isPwdPending, startPwdTransition] = useTransition();

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSaveWorkspace = (e: React.FormEvent) => {
    e.preventDefault();
    setWsError(null);
    setWsSuccess(null);
    startWsTransition(async () => {
      const res = await updateWorkspaceNameAction({ name: wsName });
      if (!res.ok) {
        setWsError(res.error ?? 'Failed to update workspace name.');
      } else {
        setWsSuccess(res.message ?? 'Workspace name updated.');
        setProfile((prev) => ({
          ...prev,
          workspace: { ...prev.workspace, name: wsName },
        }));
        setIsEditingWs(false);
      }
    });
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    if (newPassword.length < 6) {
      setPwdError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdError('New password and confirmation do not match.');
      return;
    }

    startPwdTransition(async () => {
      const res = await changePasswordAction({
        currentPassword: currentPassword.trim() ? currentPassword : undefined,
        newPassword,
        confirmPassword,
      });

      if (!res.ok) {
        setPwdError(res.error ?? 'Failed to update password.');
      } else {
        setPwdSuccess(res.message ?? 'Password changed successfully!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return dateStr;
    }
  };

  const initials = profile.email
    ? profile.email.slice(0, 2).toUpperCase()
    : 'U';

  const isMinLength = newPassword.length >= 6;
  const isMatch = newPassword.length > 0 && newPassword === confirmPassword;

  return (
    <div className="space-y-8">
      {/* Top Profile Card */}
      <Card className="border-border bg-card/60 backdrop-blur-xs">
        <CardHeader className="pb-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary font-bold text-xl ring-1 ring-primary/20">
              {initials}
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-foreground truncate">
                  {profile.email}
                </h2>
                {profile.emailConfirmedAt && (
                  <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                    <Check className="h-3 w-3" /> Verified
                  </Badge>
                )}
                {profile.isSystemAdmin && (
                  <Badge variant="default" className="gap-1 font-semibold">
                    <ShieldCheck className="h-3 w-3" /> System Admin
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> Logged in via Supabase Auth
              </p>
            </div>
          </div>
          <div className="pt-2 sm:pt-0">
            <Badge variant="secondary" className="capitalize text-xs font-semibold px-2.5 py-1">
              {profile.role === 'admin' ? 'Workspace Admin' : 'Workspace Member'}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="pt-2">
          <div className="grid gap-4 rounded-xl border border-border/80 bg-background/50 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">User ID</p>
              <div className="mt-1 flex items-center gap-1.5">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  {profile.userId.slice(0, 18)}…
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => handleCopy(profile.userId, 'user-id')}
                  title="Copy full User ID"
                >
                  {copiedId === 'user-id' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Workspace</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {profile.workspace.name}
                </span>
                {profile.role === 'admin' && !isEditingWs && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setIsEditingWs(true);
                      setWsError(null);
                      setWsSuccess(null);
                    }}
                    title="Rename workspace"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Account Created</p>
              <p className="mt-1 text-sm text-foreground">
                {formatDate(profile.createdAt)}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Last Sign In</p>
              <p className="mt-1 text-sm text-foreground">
                {formatDate(profile.lastSignInAt)}
              </p>
            </div>

            <div className="sm:col-span-2 lg:col-span-2">
              <p className="text-xs font-medium text-muted-foreground">Workspace ID</p>
              <div className="mt-1 flex items-center gap-1.5">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  {profile.workspace.id}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => handleCopy(profile.workspace.id, 'ws-id')}
                  title="Copy Workspace ID"
                >
                  {copiedId === 'ws-id' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </div>

          {/* Inline Workspace Name Edit Form */}
          {isEditingWs && (
            <form onSubmit={handleSaveWorkspace} className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
              <Label htmlFor="ws-name-input" className="text-xs font-semibold">
                Edit Workspace Name
              </Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="ws-name-input"
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder="Workspace name"
                  required
                  maxLength={100}
                  className="bg-background max-w-sm"
                />
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={isWsPending}>
                    {isWsPending ? 'Saving…' : 'Save Name'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isWsPending}
                    onClick={() => {
                      setWsName(profile.workspace.name);
                      setIsEditingWs(false);
                      setWsError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
              {wsError && <p className="text-xs text-destructive">{wsError}</p>}
            </form>
          )}

          {wsSuccess && (
            <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              ✓ {wsSuccess}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Workspace Quick Resource Stats */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Workspace Overview
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/cards"
            className="group flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:bg-muted/50"
          >
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground">Saved Cards</p>
              <p className="text-2xl font-bold text-foreground">{profile.stats.cardsCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
              <CreditCard className="h-5 w-5" />
            </div>
          </Link>

          <Link
            href="/holders"
            className="group flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:bg-muted/50"
          >
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground">Card Holders</p>
              <p className="text-2xl font-bold text-foreground">{profile.stats.holdersCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
              <Users className="h-5 w-5" />
            </div>
          </Link>

          <Link
            href="/accounts"
            className="group flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:bg-muted/50"
          >
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground">RuPay Logins</p>
              <p className="text-2xl font-bold text-foreground">{profile.stats.accountsCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
              <KeyRound className="h-5 w-5" />
            </div>
          </Link>

          <Link
            href="/benefits"
            className="group flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:bg-muted/50"
          >
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground">Tracked Benefits</p>
              <p className="text-2xl font-bold text-foreground">{profile.stats.activeBenefitsCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
              <Gift className="h-5 w-5" />
            </div>
          </Link>
        </div>
      </div>

      {/* Change Password Card */}
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <Lock className="h-5 w-5" />
            <CardTitle>Change Password</CardTitle>
          </div>
          <CardDescription>
            Update your account password. Choose a secure password with at least 6 characters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="max-w-md space-y-4">
            {pwdError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
              >
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{pwdError}</span>
              </div>
            )}

            {pwdSuccess && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400"
              >
                <Check className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{pwdSuccess}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="current-password">Current password</Label>
                <span className="text-[11px] text-muted-foreground">Optional if never set</span>
              </div>
              <div className="relative">
                <Input
                  id="current-password"
                  name="currentPassword"
                  type={showCurrent ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCurrent((p) => !p)}
                  aria-label={showCurrent ? 'Hide password' : 'Show password'}
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Leave blank if you previously signed in via invite link without setting a password.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  name="newPassword"
                  type={showNew ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNew((p) => !p)}
                  aria-label={showNew ? 'Hide password' : 'Show password'}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {newPassword.length > 0 && (
                <p
                  className={`text-[11px] flex items-center gap-1 ${
                    isMinLength ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                  }`}
                >
                  {isMinLength ? <Check className="h-3 w-3" /> : '•'} At least 6 characters
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  name="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirm((p) => !p)}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {confirmPassword.length > 0 && (
                <p
                  className={`text-[11px] flex items-center gap-1 ${
                    isMatch ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                  }`}
                >
                  {isMatch ? <Check className="h-3 w-3" /> : '•'}
                  {isMatch ? 'Passwords match' : 'Passwords do not match'}
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={isPwdPending || !newPassword || !confirmPassword || !isMinLength || !isMatch}
              className="w-full sm:w-auto"
            >
              {isPwdPending ? 'Updating Password…' : 'Save New Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

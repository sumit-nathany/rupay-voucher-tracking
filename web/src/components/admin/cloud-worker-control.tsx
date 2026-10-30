'use client';

import { useState } from 'react';
import {
  Play,
  Pause,
  Clock,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Terminal,
  Loader2,
  Calendar,
  Layers,
  Activity,
  Cpu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { CloudWorkerStatus } from '@/lib/gcp-worker-client';
import {
  toggleAdminWorkerSchedulerAction,
  triggerAdminWorkerRunAction,
  getAdminWorkerStatusAction,
} from '@/actions/admin-worker';

function formatIST(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();

    const timeStr = d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });

    const dateStr = d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });

    const prefix = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : dateStr;
    return `${prefix} at ${timeStr} IST`;
  } catch {
    return isoString;
  }
}

export function CloudWorkerControl({ initialStatus }: { initialStatus: CloudWorkerStatus }) {
  const [status, setStatus] = useState<CloudWorkerStatus>(initialStatus);
  const [togglingScheduler, setTogglingScheduler] = useState(false);
  const [triggeringRun, setTriggeringRun] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isEnabled = status.schedulerState === 'ENABLED';
  const isPaused = status.schedulerState === 'PAUSED';

  async function handleRefresh() {
    setRefreshing(true);
    setFeedback(null);
    try {
      const updated = await getAdminWorkerStatusAction();
      setStatus(updated);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to refresh status from Google Cloud',
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleToggleScheduler(enable: boolean) {
    setTogglingScheduler(true);
    setFeedback(null);
    try {
      await toggleAdminWorkerSchedulerAction({ enable });
      setStatus((prev) => ({
        ...prev,
        schedulerState: enable ? 'ENABLED' : 'PAUSED',
      }));
      setFeedback({
        type: 'success',
        message: enable
          ? 'Cloud Scheduler successfully resumed! The worker will wake up hourly.'
          : 'Cloud Scheduler successfully paused. Automated wake-ups are stopped.',
      });
      // Background refresh to pick up nextRunTime
      setTimeout(handleRefresh, 1500);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update Cloud Scheduler state',
      });
    } finally {
      setTogglingScheduler(false);
    }
  }

  async function handleTriggerRun() {
    setTriggeringRun(true);
    setFeedback(null);
    try {
      const res = await triggerAdminWorkerRunAction();
      setFeedback({
        type: 'success',
        message: `Execution dispatched to Google Cloud Run (${res.executionName})!`,
      });
      setTimeout(handleRefresh, 3000);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to trigger Cloud Run Job execution',
      });
    } finally {
      setTriggeringRun(false);
    }
  }

  const logsExplorerUrl = `https://console.cloud.google.com/logs/viewer?project=${encodeURIComponent(
    status.projectId,
  )}&advancedFilter=${encodeURIComponent(
    `resource.type="cloud_run_job"\nresource.labels.job_name="${status.runJobName}"`,
  )}`;

  const cloudRunConsoleUrl = `https://console.cloud.google.com/run/jobs/details/${status.region}/${status.runJobName}/executions?project=${encodeURIComponent(
    status.projectId,
  )}`;

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Feedback banner */}
      {feedback && (
        <div
          className={`flex items-start gap-3 rounded-2xl p-4 text-sm border ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-200'
              : 'bg-destructive/10 border-destructive/30 text-destructive'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
          )}
          <div className="flex-1 font-medium">{feedback.message}</div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs opacity-70 hover:opacity-100 font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Status & Controls Card */}
      <div className="rounded-3xl border border-border/70 bg-card p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border/50">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-semibold text-foreground">Cloud Scheduler & Batch Worker</h2>
              {isEnabled ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1.5 font-medium px-2.5 py-0.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Active (Hourly)
                </Badge>
              ) : isPaused ? (
                <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10 gap-1.5 font-medium px-2.5 py-0.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Paused
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1.5 font-medium">
                  {status.schedulerState}
                </Badge>
              )}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Direct connection to GCP project <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{status.projectId}</code>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={handleRefresh}
              className="h-9 px-3 gap-1.5 text-xs rounded-xl"
              title="Refresh status from Google Cloud"
            >
              <RotateCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>

            {isEnabled ? (
              <Button
                variant="outline"
                size="sm"
                disabled={togglingScheduler}
                onClick={() => handleToggleScheduler(false)}
                className="h-9 px-3.5 gap-1.5 text-xs rounded-xl border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
              >
                {togglingScheduler ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Pause className="h-3.5 w-3.5 fill-current" />
                )}
                Pause Scheduler
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={togglingScheduler}
                onClick={() => handleToggleScheduler(true)}
                className="h-9 px-3.5 gap-1.5 text-xs rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {togglingScheduler ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
                Start Scheduler
              </Button>
            )}

            <Button
              variant="default"
              size="sm"
              disabled={triggeringRun}
              onClick={handleTriggerRun}
              className="h-9 px-4 gap-1.5 text-xs rounded-xl font-medium shadow-xs"
            >
              {triggeringRun ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Cpu className="h-3.5 w-3.5" />
              )}
              Trigger Run Now
            </Button>
          </div>
        </div>

        {/* Telemetry Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-border/50 bg-muted/20 p-4 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Calendar className="h-3.5 w-3.5" />
              <span>Schedule Cadence</span>
            </div>
            <div className="text-sm font-semibold text-foreground">
              {status.scheduleInterval}
            </div>
            <div className="text-[11px] text-muted-foreground">{status.timeZone}</div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-muted/20 p-4 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <span>Next Scheduled Run</span>
            </div>
            <div className="text-sm font-semibold text-foreground">
              {isEnabled ? formatIST(status.nextRunTime) : 'Paused'}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {isEnabled ? 'Automatic wake-up' : 'Scheduler is paused'}
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-muted/20 p-4 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Last Scheduler Trigger</span>
            </div>
            <div className="text-sm font-semibold text-foreground">
              {formatIST(status.lastRunTime)}
            </div>
            <div className="text-[11px] text-muted-foreground">Cloud Scheduler invocation</div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-muted/20 p-4 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Cloud Run Job</span>
            </div>
            <div className="text-sm font-semibold text-foreground truncate">
              {status.runJobName}
            </div>
            <div className="text-[11px] text-muted-foreground">{status.region}</div>
          </div>
        </div>
      </div>

      {/* Recent Cloud Run Executions Table */}
      <div className="rounded-3xl border border-border/70 bg-card p-6 sm:p-8 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">Recent Cloud Run Executions</h3>
            <p className="text-xs text-muted-foreground">
              Direct telemetry from the Google Cloud Run Jobs execution history.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="h-8 text-xs gap-1.5 rounded-lg text-primary hover:text-primary">
              <a href={cloudRunConsoleUrl} target="_blank" rel="noopener noreferrer">
                <span>View in GCP Console</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
            <Button variant="ghost" size="sm" asChild className="h-8 text-xs gap-1.5 rounded-lg text-muted-foreground hover:text-foreground">
              <a href={logsExplorerUrl} target="_blank" rel="noopener noreferrer">
                <span>Open Logs Explorer</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </div>
        </div>

        {status.recentExecutions.length === 0 ? (
          <div className="text-center py-8 text-xs sm:text-sm text-muted-foreground rounded-2xl border border-dashed border-border/70 p-6">
            No recent executions found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/60">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-muted/40 text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Execution</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Started At (IST)</th>
                  <th className="py-2.5 px-4 font-medium">Completed At (IST)</th>
                  <th className="py-2.5 px-4 font-medium text-right">Logs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono text-xs">
                {status.recentExecutions.map((exec) => (
                  <tr key={exec.name} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-4 font-medium text-foreground">{exec.name}</td>
                    <td className="py-3 px-4 font-sans">
                      {exec.running ? (
                        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 gap-1 font-medium">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Running
                        </Badge>
                      ) : exec.succeeded ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1 font-medium">
                          <CheckCircle2 className="h-3 w-3" />
                          Succeeded
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1 font-medium">
                          <AlertCircle className="h-3 w-3" />
                          Failed
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground font-sans">
                      {formatIST(exec.startTime)}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground font-sans">
                      {formatIST(exec.completionTime)}
                    </td>
                    <td className="py-3 px-4 text-right font-sans">
                      <a
                        href={exec.logUri || logsExplorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                      >
                        <span>Logs</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Terminal monitoring helper */}
      <div className="rounded-3xl border border-border/70 bg-muted/15 p-6 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wider">
          <Terminal className="h-4 w-4 text-primary" />
          <span>Real-Time CLI Log Streaming</span>
        </div>
        <p className="text-xs text-muted-foreground">
          You can stream live logs from any running or scheduled task directly in your terminal:
        </p>
        <div className="rounded-xl bg-zinc-950 p-3.5 font-mono text-xs text-zinc-200 border border-zinc-800 flex items-center justify-between">
          <code>./worker/infra/logs.sh -f</code>
          <span className="text-[10px] text-zinc-500">live stream (tail -f)</span>
        </div>
      </div>
    </div>
  );
}

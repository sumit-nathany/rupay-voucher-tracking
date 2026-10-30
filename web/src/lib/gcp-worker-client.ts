import { GoogleAuth } from 'google-auth-library';

export interface CloudWorkerExecution {
  name: string;
  uid?: string;
  startTime?: string;
  completionTime?: string;
  succeeded: boolean;
  running: boolean;
  logUri?: string;
}

export interface CloudWorkerStatus {
  configured: boolean;
  projectId: string;
  region: string;
  schedulerJobName: string;
  runJobName: string;
  schedulerState: 'ENABLED' | 'PAUSED' | 'DISABLED' | 'UNKNOWN';
  scheduleInterval: string;
  timeZone: string;
  nextRunTime: string | null;
  lastRunTime: string | null;
  latestExecution: CloudWorkerExecution | null;
  recentExecutions: CloudWorkerExecution[];
  errorMessage?: string;
}

function getGoogleClient() {
  const keyB64 = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!keyB64) {
    return null;
  }

  try {
    const credentials = JSON.parse(Buffer.from(keyB64, 'base64').toString('utf8'));
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    return auth.getClient();
  } catch (err) {
    console.error('[gcp-client] Error parsing GCP_SERVICE_ACCOUNT_KEY:', err);
    return null;
  }
}

export async function getCloudWorkerStatus(): Promise<CloudWorkerStatus> {
  const projectId = process.env.GCP_PROJECT_ID || 'rupay-order-worker-prod-final';
  const region = process.env.GCP_REGION || 'asia-south1';
  const schedulerJobName = process.env.GCP_SCHEDULER_JOB || 'rupay-order-worker-hourly';
  const runJobName = process.env.GCP_RUN_JOB || 'rupay-order-worker';

  const clientPromise = getGoogleClient();
  if (!clientPromise) {
    return {
      configured: false,
      projectId,
      region,
      schedulerJobName,
      runJobName,
      schedulerState: 'UNKNOWN',
      scheduleInterval: 'every 1 hours',
      timeZone: 'Asia/Kolkata',
      nextRunTime: null,
      lastRunTime: null,
      latestExecution: null,
      recentExecutions: [],
      errorMessage: 'GCP_SERVICE_ACCOUNT_KEY is not configured on this environment.',
    };
  }

  const client = await clientPromise;

  let schedulerState: CloudWorkerStatus['schedulerState'] = 'UNKNOWN';
  let scheduleInterval = 'every 1 hours';
  let timeZone = 'Asia/Kolkata';
  let nextRunTime: string | null = null;
  let lastRunTime: string | null = null;
  let errorMessage: string | undefined;

  try {
    const schedulerUrl = `https://cloudscheduler.googleapis.com/v1/projects/${projectId}/locations/${region}/jobs/${schedulerJobName}`;
    const res = await client.request<{
      state?: string;
      schedule?: string;
      timeZone?: string;
      scheduleTime?: string;
      lastAttemptTime?: string;
    }>({ url: schedulerUrl });

    if (res.data) {
      schedulerState = (res.data.state as CloudWorkerStatus['schedulerState']) || 'UNKNOWN';
      scheduleInterval = res.data.schedule || 'every 1 hours';
      timeZone = res.data.timeZone || 'Asia/Kolkata';
      nextRunTime = res.data.scheduleTime || null;
      lastRunTime = res.data.lastAttemptTime || null;
    }
  } catch (err) {
    console.error('[gcp-client] Error fetching scheduler status:', err);
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const executions: CloudWorkerExecution[] = [];
  try {
    const runUrl = `https://${region}-run.googleapis.com/v2/projects/${projectId}/locations/${region}/jobs/${runJobName}/executions?pageSize=5`;
    const res = await client.request<{
      executions?: Array<{
        name: string;
        uid?: string;
        startTime?: string;
        completionTime?: string;
        succeededCount?: number;
        failedCount?: number;
        logUri?: string;
      }>;
    }>({ url: runUrl });

    if (res.data?.executions) {
      for (const item of res.data.executions) {
        const shortName = item.name.split('/').pop() || item.name;
        const running = !item.completionTime;
        const succeeded = Boolean(item.succeededCount && item.succeededCount > 0);
        executions.push({
          name: shortName,
          uid: item.uid,
          startTime: item.startTime,
          completionTime: item.completionTime,
          running,
          succeeded,
          logUri: item.logUri,
        });
      }
    }
  } catch (err) {
    console.error('[gcp-client] Error fetching Cloud Run executions:', err);
  }

  return {
    configured: true,
    projectId,
    region,
    schedulerJobName,
    runJobName,
    schedulerState,
    scheduleInterval,
    timeZone,
    nextRunTime,
    lastRunTime,
    latestExecution: executions[0] || null,
    recentExecutions: executions,
    errorMessage,
  };
}

export async function setCloudSchedulerState(state: 'enable' | 'disable'): Promise<{ success: boolean; state: string }> {
  const projectId = process.env.GCP_PROJECT_ID || 'rupay-order-worker-prod-final';
  const region = process.env.GCP_REGION || 'asia-south1';
  const schedulerJobName = process.env.GCP_SCHEDULER_JOB || 'rupay-order-worker-hourly';

  const clientPromise = getGoogleClient();
  if (!clientPromise) {
    throw new Error('GCP_SERVICE_ACCOUNT_KEY is not configured');
  }

  const client = await clientPromise;
  const action = state === 'enable' ? 'resume' : 'pause';
  const url = `https://cloudscheduler.googleapis.com/v1/projects/${projectId}/locations/${region}/jobs/${schedulerJobName}:${action}`;

  const res = await client.request<{ state?: string }>({
    url,
    method: 'POST',
  });

  return {
    success: true,
    state: res.data?.state || (state === 'enable' ? 'ENABLED' : 'PAUSED'),
  };
}

export async function triggerCloudRunJob(): Promise<{ success: boolean; executionName?: string }> {
  const projectId = process.env.GCP_PROJECT_ID || 'rupay-order-worker-prod-final';
  const region = process.env.GCP_REGION || 'asia-south1';
  const runJobName = process.env.GCP_RUN_JOB || 'rupay-order-worker';

  const clientPromise = getGoogleClient();
  if (!clientPromise) {
    throw new Error('GCP_SERVICE_ACCOUNT_KEY is not configured');
  }

  const client = await clientPromise;
  const url = `https://${region}-run.googleapis.com/v2/projects/${projectId}/locations/${region}/jobs/${runJobName}:run`;

  const res = await client.request<{
    name?: string;
    metadata?: { name?: string };
    response?: { name?: string };
  }>({
    url,
    method: 'POST',
  });

  const fullPath = res.data?.name || res.data?.response?.name || '';
  const executionName = fullPath.split('/').pop() || 'Execution triggered';

  return {
    success: true,
    executionName,
  };
}

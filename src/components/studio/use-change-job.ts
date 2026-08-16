"use client";

import { useCallback, useEffect, useState } from "react";

export interface PrepareIntent {
  baseSha: string;
  title: string;
  reason: string;
  roleChanges: Array<{ roleCode: string; add: string[]; remove: string[] }>;
  contractChanges: Array<{
    contractType: string;
    menus: { add: string[]; remove: string[] };
    widgets: { add: string[]; remove: string[] };
  }>;
}

export interface ClientChangeJob {
  requestId: string;
  baseSha?: string;
  title?: string;
  reason?: string;
  branchName?: string;
  createdAt?: string;
  expiresAt?: string;
  state: "validating" | "awaiting-confirmation" | "finalizing" | "completed" | "failed";
  confirmationNonce?: string;
  touchedFiles?: string[];
  validationSteps?: Array<{ name: string; status: "passed"; durationMs: number }>;
  diff?: string;
  errorCode?: string;
  prUrl?: string;
  recoveryCommand?: string;
  failureSummary?: string;
}

export interface ChangeJobController {
  job: ClientChangeJob | null;
  pending: boolean;
  error: string | null;
  message: string | null;
  prepare(intent: PrepareIntent): Promise<void>;
  confirm(): Promise<void>;
  discard(): Promise<void>;
  clearCompleted(): void;
}

class HttpFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ErrorBody {
  code?: string;
  message?: string;
}

export const ACTIVE_CHANGE_JOB_KEY = "permission-studio:active-change";
export const CHANGE_JOB_POLL_INTERVAL_MS = 1_200;

function redactCredentials(value: string): string {
  return value
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/gi, "[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

function safeError(cause: unknown, fallback: string): string {
  return cause instanceof HttpFlowError ? redactCredentials(cause.message) : fallback;
}

async function responseJson<T>(response: Response): Promise<T> {
  let body: (T & ErrorBody) | null = null;
  try {
    body = (await response.json()) as T & ErrorBody;
  } catch {
    if (response.ok) throw new HttpFlowError("INVALID_RESPONSE", "服务器返回了无效响应");
  }
  if (!response.ok) {
    throw new HttpFlowError(body?.code ?? "REQUEST_FAILED", body?.message ?? "请求失败");
  }
  if (!body) throw new HttpFlowError("INVALID_RESPONSE", "服务器返回了无效响应");
  return body;
}

export function useChangeJob(sourceSha = ""): ChangeJobController {
  const [job, setJob] = useState<ClientChangeJob | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);

  const refreshJob = useCallback(async (requestId: string) => {
    const response = await fetch(`/api/changes/${requestId}`, { cache: "no-store" });
    if (response.status === 404) {
      window.sessionStorage.removeItem(ACTIVE_CHANGE_JOB_KEY);
      setJob(null);
      setMessage("准备结果已过期或被丢弃");
      return null;
    }
    const current = await responseJson<ClientChangeJob>(response);
    setJob(current);
    return current;
  }, []);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(ACTIVE_CHANGE_JOB_KEY);
    if (!saved) return;
    try {
      const record = JSON.parse(saved) as { requestId?: string; baseSha?: string };
      if (!record.requestId) {
        window.sessionStorage.removeItem(ACTIVE_CHANGE_JOB_KEY);
        return;
      }
      setJob({
        requestId: record.requestId,
        baseSha: record.baseSha,
        state: "validating",
      });
      void refreshJob(record.requestId).catch(() => {
        setError("暂时无法恢复任务状态，将继续重试");
      });
    } catch {
      window.sessionStorage.removeItem(ACTIVE_CHANGE_JOB_KEY);
    }
  }, [refreshJob]);

  useEffect(() => {
    if (!job) return;
    window.sessionStorage.setItem(
      ACTIVE_CHANGE_JOB_KEY,
      JSON.stringify({ requestId: job.requestId, baseSha: job.baseSha ?? sourceSha }),
    );
  }, [job, sourceSha]);

  useEffect(() => {
    if (job?.state !== "validating" && job?.state !== "finalizing") return;
    const requestId = job.requestId;
    const timer = window.setTimeout(() => {
      void refreshJob(requestId)
        .catch((cause: unknown) => {
          setError(safeError(cause, "无法刷新变更状态，将继续重试"));
        })
        .finally(() => setPollAttempt((current) => current + 1));
    }, CHANGE_JOB_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [job, pollAttempt, refreshJob]);

  const prepare = useCallback(async (intent: PrepareIntent) => {
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      const prepared = await responseJson<ClientChangeJob>(
        await fetch("/api/changes/prepare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(intent),
        }),
      );
      setJob(prepared);
    } catch (cause) {
      setError(safeError(cause, "无法校验变更"));
    } finally {
      setPending(false);
    }
  }, []);

  const confirm = useCallback(async () => {
    if (!job?.confirmationNonce || job.state !== "awaiting-confirmation") return;
    setPending(true);
    setError(null);
    try {
      const finalizing = await responseJson<ClientChangeJob>(
        await fetch(`/api/changes/${job.requestId}/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nonce: job.confirmationNonce }),
        }),
      );
      setJob(finalizing);
    } catch (cause) {
      await refreshJob(job.requestId).catch(() => undefined);
      setError(safeError(cause, "无法完成远端写入"));
    } finally {
      setPending(false);
    }
  }, [job, refreshJob]);

  const discard = useCallback(async () => {
    if (!job) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/changes/${job.requestId}`, { method: "DELETE" });
      if (!response.ok) await responseJson(response);
      setJob(null);
      window.sessionStorage.removeItem(ACTIVE_CHANGE_JOB_KEY);
      setMessage("变更草稿已丢弃");
    } catch (cause) {
      setError(safeError(cause, "无法丢弃变更草稿"));
    } finally {
      setPending(false);
    }
  }, [job]);

  const clearCompleted = useCallback(() => {
    if (job?.state !== "completed") return;
    window.sessionStorage.removeItem(ACTIVE_CHANGE_JOB_KEY);
    setJob(null);
    setError(null);
    setMessage(null);
  }, [job]);

  return { job, pending, error, message, prepare, confirm, discard, clearCompleted };
}

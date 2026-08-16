"use client";

import { useEffect, useState } from "react";

interface HealthData {
  ready: boolean;
  authenticated: boolean;
  repositoryAccessible: boolean;
  canWrite: boolean;
  login?: string;
  viewerPermission?: string;
  cacheReady: boolean;
  errorCode?: string;
}

const errorCopy: Record<string, { title: string; detail: string }> = {
  GH_NOT_INSTALLED: {
    title: "需要安装 GitHub CLI",
    detail: "安装 gh 后重新检查本地环境。",
  },
  GH_NOT_AUTHENTICATED: {
    title: "需要登录 GitHub CLI",
    detail: "登录完成后刷新页面。",
  },
  GH_REPOSITORY_INACCESSIBLE: {
    title: "无法访问目标仓库",
    detail: "确认当前 gh 账号可以访问 pep-webapp。",
  },
  GH_REPOSITORY_WRITE_REQUIRED: {
    title: "缺少仓库写权限",
    detail: "创建分支和 Draft PR 至少需要 WRITE 权限。",
  },
  GH_RESPONSE_INVALID: {
    title: "GitHub CLI 返回异常",
    detail: "升级 gh 后重新检查环境。",
  },
};

export function HealthCard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [networkError, setNetworkError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then(async (response) => {
        const body = (await response.json()) as HealthData;
        if (active) setHealth(body);
      })
      .catch(() => {
        if (active) setNetworkError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const failure = health?.errorCode
    ? (errorCopy[health.errorCode] ?? {
        title: "环境检查失败",
        detail: "请检查本地服务日志。",
      })
    : null;

  return (
    <section className="health-card" aria-labelledby="environment-heading">
      <div>
        <p className="eyebrow">ENVIRONMENT</p>
        <h2 id="environment-heading">
          {networkError
            ? "无法连接本地环境检查"
            : health?.ready
              ? "环境已就绪"
              : (failure?.title ?? "正在检查本地环境…")}
        </h2>
        {failure ? <p className="health-detail">{failure.detail}</p> : null}
        {health?.errorCode === "GH_NOT_AUTHENTICATED" ? (
          <div className="command-help" aria-label="GitHub CLI 登录命令">
            <code>gh auth login</code>
            <code>gh auth setup-git</code>
          </div>
        ) : null}
      </div>
      <dl>
        <div>
          <dt>GitHub 用户</dt>
          <dd>{health?.login ? `@${health.login}` : "—"}</dd>
        </div>
        <div>
          <dt>仓库权限</dt>
          <dd>{health?.viewerPermission ?? "—"}</dd>
        </div>
        <div>
          <dt>本地缓存</dt>
          <dd>{health?.cacheReady ? "已创建" : "首次刷新时创建"}</dd>
        </div>
      </dl>
    </section>
  );
}

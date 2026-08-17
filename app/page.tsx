import { studioConfig } from "@/src/system/config";
import { HealthCard } from "@/src/components/health-card";
import { StudioShell } from "@/src/components/studio/studio-shell";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="utility-bar" role="banner" aria-label="应用工具栏">
        <div className="product-mark" aria-label="Permission Studio">
          <span className="product-mark-icon" aria-hidden="true">
            P
          </span>
          <span>Permission Studio</span>
        </div>
        <div className="utility-meta">
          <div className="target-note" aria-label="目标仓库">
            <span>{studioConfig.targetSlug}</span>
            <span aria-hidden="true">·</span>
            <span>{studioConfig.target.baseBranch}</span>
          </div>
          <HealthCard />
        </div>
      </header>

      <div className="workspace-main">
        <StudioShell />
      </div>
    </main>
  );
}

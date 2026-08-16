import { studioConfig } from "@/src/system/config";
import { HealthCard } from "@/src/components/health-card";
import { PermissionWorkbench } from "@/src/components/permission-workbench";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">PEP-WEBAPP · LOCAL POLICY TOOL</p>
        <h1>Permission Studio</h1>
        <p className="intro">从远端 develop 解释权限、验证变更，并在最终确认后创建 Draft PR。</p>
      </header>

      <HealthCard />
      <PermissionWorkbench />
      <footer className="target-note">
        <span>{studioConfig.targetSlug}</span>
        <span>→</span>
        <span>{studioConfig.target.baseBranch}</span>
      </footer>
    </main>
  );
}

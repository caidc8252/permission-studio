import { studioConfig } from "@/src/system/config";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">PEP-WEBAPP · LOCAL POLICY TOOL</p>
        <h1>Permission Studio</h1>
        <p className="intro">从远端 develop 解释权限、验证变更，并在最终确认后创建 Draft PR。</p>
      </header>

      <section className="health-card" aria-labelledby="environment-heading">
        <div>
          <p className="eyebrow">ENVIRONMENT</p>
          <h2 id="environment-heading">本地环境尚未检查</h2>
        </div>
        <dl>
          <div>
            <dt>运行地址</dt>
            <dd>{studioConfig.serverOrigin}</dd>
          </div>
          <div>
            <dt>目标仓库</dt>
            <dd>{studioConfig.targetSlug}</dd>
          </div>
          <div>
            <dt>目标分支</dt>
            <dd>{studioConfig.target.baseBranch}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

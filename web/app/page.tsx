import Link from "next/link"

import { WorkspaceShell } from "../src/components/workspace-shell"

export default function CortexAppPage() {
  return (
    <WorkspaceShell activeRoute="home">
      <header className="aurora-surface p-5 grid gap-2">
        <span className="aurora-meta-label">Cortex Workspace</span>
        <h1 className="m-0 text-2xl font-extrabold">Cortex</h1>
        <p className="m-0 text-[13px] text-[var(--aurora-text-muted)] max-w-2xl">
          Self-hosted homelab observability workspace combining syslog, OTLP telemetry, host
          inventory, investigation graphs, and AI-session evidence.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3.5 md:grid-cols-2" aria-label="Available workspaces">
        <article className="aurora-surface p-5 grid gap-3 content-between">
          <div className="grid gap-1.5">
            <span className="aurora-badge aurora-badge-violet">Investigation</span>
            <h2 className="m-0 text-lg font-bold">Investigation Workspace</h2>
            <p className="m-0 text-[13px] text-[var(--aurora-text-muted)]">
              Ask + Explain workflows, interactive fleet &amp; entity topology graph, trust-graded
              relationship evidence inspection, and filterable log context.
            </p>
          </div>
          <div>
            <Link className="aurora-btn-primary inline-block no-underline" href="/investigate/">
              Open Investigate
            </Link>
          </div>
        </article>

        <article className="aurora-surface p-5 grid gap-3 content-between">
          <div className="grid gap-1.5">
            <span className="aurora-badge aurora-badge-neutral">Observatory</span>
            <h2 className="m-0 text-lg font-bold">Agent Observatory</h2>
            <p className="m-0 text-[13px] text-[var(--aurora-text-muted)]">
              Monitor live AI agent runs, repositories, worktrees, transcript timelines, and
              attributed commits across hosts.
            </p>
          </div>
          <div>
            <Link className="aurora-btn-secondary inline-block no-underline" href="/agents/">
              Open Agent Observatory
            </Link>
          </div>
        </article>
      </section>
    </WorkspaceShell>
  )
}

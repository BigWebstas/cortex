import type { Metadata } from "next"

import { ConnectionCard } from "../../src/components/observatory/connection-card"
import { WorkspaceShell } from "../../src/components/workspace-shell"
import { AuthProvider } from "../../src/lib/observatory/auth-context"

export const metadata: Metadata = { title: "Agent Observatory" }

export default function AgentObservatoryPage() {
  return (
    <WorkspaceShell activeRoute="agents">
      <header className="aurora-surface p-5 grid gap-2">
        <span className="aurora-meta-label">Observatory</span>
        <h1 className="m-0 text-2xl font-extrabold">Agent Observatory</h1>
        <p className="m-0 text-[13px] text-[var(--aurora-text-muted)] max-w-2xl">
          Connect to Cortex to observe repository worktrees, active AI sessions, OTLP traces, and
          attributed commits.
        </p>
      </header>
      <AuthProvider>
        <ConnectionCard />
      </AuthProvider>
    </WorkspaceShell>
  )
}

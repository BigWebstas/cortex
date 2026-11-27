import Link from "next/link"

import { Badge } from "@/components/ui/aurora/badge"
import { Button } from "@/components/ui/aurora/button"
import { Card, CardContent } from "@/components/ui/aurora/card"
import { WorkspaceShell } from "../src/components/workspace-shell"

export default function CortexAppPage() {
  return (
    <WorkspaceShell activeRoute="home">
      <Card>
        <CardContent className="p-5 grid gap-2">
          <span className="aurora-meta-label">Cortex Workspace</span>
          <h1 className="m-0 text-2xl font-extrabold">Cortex</h1>
          <p className="m-0 text-[13px] text-[var(--aurora-text-muted)] max-w-2xl">
            Self-hosted homelab observability workspace combining syslog, OTLP telemetry, host
            inventory, investigation graphs, and AI-session evidence.
          </p>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-3.5 md:grid-cols-2" aria-label="Available workspaces">
        <Card>
          <CardContent className="p-5 grid gap-3 content-between h-full">
            <div className="grid gap-1.5">
              <Badge tone="cyan">Investigation</Badge>
              <h2 className="m-0 text-lg font-bold">Investigation Workspace</h2>
              <p className="m-0 text-[13px] text-[var(--aurora-text-muted)]">
                Ask + Explain workflows, interactive fleet &amp; entity topology graph, trust-graded
                relationship evidence inspection, and filterable log context.
              </p>
            </div>
            <div>
              <Button variant="aurora" asChild>
                <Link className="no-underline" href="/investigate/">
                  Open Investigate
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 grid gap-3 content-between h-full">
            <div className="grid gap-1.5">
              <Badge tone="neutral">Observatory</Badge>
              <h2 className="m-0 text-lg font-bold">Agent Observatory</h2>
              <p className="m-0 text-[13px] text-[var(--aurora-text-muted)]">
                Monitor live AI agent runs, repositories, worktrees, transcript timelines, and
                attributed commits across hosts.
              </p>
            </div>
            <div>
              <Button variant="neutral" asChild>
                <Link className="no-underline" href="/agents/">
                  Open Agent Observatory
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </WorkspaceShell>
  )
}

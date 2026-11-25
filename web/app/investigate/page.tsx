import type { Metadata } from "next"

import { InvestigationWorkspace } from "../../src/components/investigate/investigation-workspace"
import { WorkspaceShell } from "../../src/components/workspace-shell"

export const metadata: Metadata = { title: "Investigate" }

export default function InvestigatePage() {
  return (
    <WorkspaceShell activeRoute="investigate">
      <InvestigationWorkspace />
    </WorkspaceShell>
  )
}

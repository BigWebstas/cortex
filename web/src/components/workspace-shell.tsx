import Link from "next/link"
import type { ReactNode } from "react"

import { INVESTIGATION_UI_VERSION } from "../contracts/investigation"

export interface WorkspaceShellProps {
  activeRoute: "home" | "investigate" | "agents"
  children: ReactNode
}

export function WorkspaceShell({ activeRoute, children }: WorkspaceShellProps) {
  return (
    <div className="aurora-workspace" data-app-root>
      <aside className="aurora-nav" aria-label="Workspace navigation">
        <Link className="aurora-brand" href="/investigate/" aria-label="Cortex investigation workspace">
          <span className="aurora-brand-mark" aria-hidden="true" />
          <span>Cortex</span>
        </Link>
        <nav className="aurora-nav-links" aria-label="Primary">
          <Link
            className="aurora-nav-item"
            href="/investigate/"
            aria-current={activeRoute === "investigate" ? "page" : undefined}
          >
            Investigate
          </Link>
          <Link
            className="aurora-nav-item"
            href="/agents/"
            aria-current={activeRoute === "agents" ? "page" : undefined}
          >
            Agent Observatory
          </Link>
          <a className="aurora-nav-item" href="/api/version">
            API
          </a>
          <a className="aurora-nav-item" href="/mcp">
            MCP
          </a>
        </nav>
        <div className="aurora-nav-foot">
          <span className="aurora-meta-label">Frontend</span>
          <span className="aurora-mono" data-ui-version>
            {INVESTIGATION_UI_VERSION}
          </span>
        </div>
      </aside>
      <main className="aurora-main">{children}</main>
    </div>
  )
}

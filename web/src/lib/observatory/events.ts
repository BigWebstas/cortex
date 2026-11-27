// Reads the payloads the projector stores for transcript and command events.
// Payloads are untrusted data: every field is checked and shown only as text.

import type { AgentRunEvent } from "../../../../docs/contracts/agent-observatory-types"

export const LONG_COMMAND_MS = 30_000

function payload(event: AgentRunEvent): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(event.payload_json ?? "null")
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null)
const number = (value: unknown) => (typeof value === "number" ? value : null)

export type Speaker =
  | "user" | "assistant" | "tool" | "reasoning" | "hook" | "status" | "error"
  | "provider" | "unknown"

const SPEAKERS: readonly Speaker[] = [
  "user", "assistant", "tool", "reasoning", "hook", "status", "error",
]

export interface TranscriptEntry {
  role: Speaker
  text: string
  /** The shown text is shorter than the original message. */
  partial: boolean
}

export function transcriptEntry(event: AgentRunEvent): TranscriptEntry {
  const data = payload(event)
  const metadata = data.metadata as { event_kind?: unknown } | undefined
  const message = text(data.message)
  const role =
    event.kind === "provider_event"
      ? "provider"
      : (SPEAKERS.find((speaker) => speaker === metadata?.event_kind) ?? "unknown")
  return {
    role,
    text: message ?? event.summary,
    partial: message === null || data.message_truncated === true,
  }
}

export interface CommandEntry {
  command: string
  cwd: string | null
  durationMs: number | null
  exitStatus: number | null
  finishedAt: string | null
  source: "agent command" | "shell history"
  truncated: boolean
  scrubbed: boolean
}

export function commandEntry(event: AgentRunEvent): CommandEntry {
  const data = payload(event)
  return {
    command: text(data.command) ?? event.summary,
    cwd: text(data.cwd),
    durationMs: number(data.duration_ms),
    exitStatus: number(data.exit_status),
    finishedAt: text(data.finished_at),
    source: event.kind === "shell_history" ? "shell history" : "agent command",
    truncated: data.command_truncated === true || text(data.command) === null,
    scrubbed: event.content_scrubbed,
  }
}

export type CommandFilter = "failed" | "long" | "git"

export function matchesCommandFilter(entry: CommandEntry, filter: CommandFilter): boolean {
  if (filter === "failed") return entry.exitStatus !== null && entry.exitStatus !== 0
  if (filter === "long") return (entry.durationMs ?? 0) >= LONG_COMMAND_MS
  return /^(sudo\s+)?git(\s|$)/.test(entry.command.trim())
}

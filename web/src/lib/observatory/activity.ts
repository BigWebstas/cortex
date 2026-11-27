// Reads Git, tool, hook, skill and model event payloads. Payloads are untrusted
// data: every field is checked and shown only as text.

import type { AgentRunEvent } from "../../../../docs/contracts/agent-observatory-types"

const MAX_DETAIL_CHARS = 4000

type Record_ = Record<string, unknown>

const record = (value: unknown): Record_ =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record_) : {}
const text = (value: unknown) => (typeof value === "string" && value ? value : null)
const number = (value: unknown) => (typeof value === "number" ? value : null)
const shortSha = (value: unknown) => text(value)?.slice(0, 7) ?? null
const shas = (value: unknown) =>
  Array.isArray(value) ? value.flatMap((item) => shortSha(item) ?? []) : []

function payload(event: AgentRunEvent): Record_ {
  try {
    return record(JSON.parse(event.payload_json ?? "null"))
  } catch {
    return {}
  }
}

export interface GitEntry {
  observation: string
  from: string | null
  to: string | null
  worktree: string | null
  /** How the observation was tied to this run; never assumed exact. */
  trust: string
  transition: string | null
  fastForward: boolean | null
  added: string[]
  displaced: string[]
}

export function gitEntry(event: AgentRunEvent): GitEntry {
  const data = payload(event)
  const observation = record(record(data.source).observation)
  const detail = record(observation.payload)
  return {
    observation: text(observation.kind) ?? event.summary,
    from: shortSha(observation.old_head_sha ?? detail.old_head_sha),
    to: shortSha(observation.new_head_sha ?? detail.head_sha),
    worktree: text(observation.worktree_path),
    trust: text(record(data.association).trust) ?? "unknown",
    transition: text(detail.transition_kind),
    fastForward: typeof detail.fast_forward === "boolean" ? detail.fast_forward : null,
    added: shas(detail.new_commit_shas),
    displaced: shas(detail.displaced_commit_shas),
  }
}

function block(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  const rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return rendered.length > MAX_DETAIL_CHARS
    ? `${rendered.slice(0, MAX_DETAIL_CHARS)}\n(shortened)`
    : rendered
}

export type ActivityKind = "mcp" | "hook" | "skill" | "llm"

export interface ActivityEntry {
  kind: ActivityKind
  name: string
  result: string
  failed: boolean
  durationMs: number | null
  details: Array<[string, string]>
  /** The stored payload was dropped for being too large. */
  truncated: boolean
}

const joined = (...parts: unknown[]) => parts.map(text).filter(Boolean).join(" · ")

export function activityEntry(event: AgentRunEvent): ActivityEntry {
  const data = payload(event)
  const kind = (["mcp", "hook", "skill", "llm"] as const).find((k) => k === event.kind) ?? "mcp"
  const exit = number(data.exit_code)
  const byKind = {
    mcp: {
      name: joined(data.mcp_server, data.mcp_tool ?? data.tool_name),
      result: data.is_error === true ? "failed" : text(data.status),
      fields: [["Arguments", data.arguments], ["Output", data.output_preview], ["Error", data.error]],
    },
    hook: {
      name: joined(data.hook_event, data.hook_name),
      result: exit === null ? text(data.status) : `exit ${exit}`,
      fields: [
        ["Command", data.hook_command], ["Source", data.hook_source],
        ["Standard output", data.stdout_preview], ["Standard error", data.stderr_preview],
      ],
    },
    skill: {
      name: joined(data.skill_plugin, data.skill_name),
      result: text(data.event_kind),
      fields: [["Evidence", data.evidence_kind]],
    },
    llm: {
      name: joined(data.provider, data.model),
      result: text(data.status),
      fields: [
        ["Action", data.action], ["Called from", data.caller_surface],
        ["Prompt bytes", data.prompt_bytes], ["Output bytes", data.output_bytes],
        ["Error", data.error],
      ],
    },
  }[kind]
  return {
    kind,
    name: byKind.name || event.title,
    result: byKind.result ?? "unknown",
    failed:
      data.is_error === true || (exit !== null && exit !== 0) || event.severity.startsWith("err"),
    durationMs: number(data.duration_ms),
    details: byKind.fields.flatMap(([label, value]) => {
      const rendered = block(value)
      return rendered ? [[label as string, rendered] as [string, string]] : []
    }),
    truncated: data.payload_truncated === true,
  }
}

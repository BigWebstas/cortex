// Pure state for repository, worktree and run snapshots plus stream updates.
// Stream events carry no entity bodies, so they mark what must be refetched.

import type {
  AgentRunSummary,
  RepositorySummary,
  StreamEnvelope,
  WorktreeSummary,
} from "../../../../docs/contracts/agent-observatory-types"

export interface ObservatoryState {
  /** Resume point for the stream; null until a snapshot has been applied. */
  cursor: string | null
  repositories: Record<string, RepositorySummary>
  repositoryOrder: string[]
  worktrees: Record<string, WorktreeSummary>
  worktreeOrder: string[]
  runs: Record<string, AgentRunSummary>
  runOrder: string[]
  /** Run keys changed since they were fetched. */
  dirtyRuns: string[]
  inventoryStale: boolean
  /** Set while a new snapshot is required. */
  resetReason: string | null
}

export type ObservatoryAction =
  | {
      type: "snapshot"
      cursor: string
      /** Replace the supplied collections instead of adding a page to them. */
      replace?: boolean
      repositories?: RepositorySummary[]
      worktrees?: WorktreeSummary[]
      runs?: AgentRunSummary[]
    }
  | { type: "stream"; envelope: StreamEnvelope }
  | { type: "runRefreshed"; run: AgentRunSummary }
  | { type: "inventoryRefreshed" }
  | { type: "reset"; reason: string }
  | { type: "clear" }

export const initialState: ObservatoryState = {
  cursor: null,
  repositories: {},
  repositoryOrder: [],
  worktrees: {},
  worktreeOrder: [],
  runs: {},
  runOrder: [],
  dirtyRuns: [],
  inventoryStale: false,
  resetReason: null,
}

function merge<T>(
  current: Record<string, T>,
  order: string[],
  items: T[] | undefined,
  replace: boolean,
  key: (item: T) => string,
): [Record<string, T>, string[]] {
  if (!items) return [current, order]
  const next: Record<string, T> = replace ? {} : { ...current }
  const nextOrder = replace ? [] : [...order]
  for (const item of items) {
    if (!(key(item) in next)) nextOrder.push(key(item))
    next[key(item)] = item
  }
  return [next, nextOrder]
}

/** Newest activity first, then the higher ID, matching the server. */
function sortRuns(runs: Record<string, AgentRunSummary>, keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const byTime = runs[b].last_activity_at.localeCompare(runs[a].last_activity_at)
    if (byTime) return byTime
    const difference = BigInt(runs[b].id) - BigInt(runs[a].id)
    return difference > 0n ? 1 : difference < 0n ? -1 : 0
  })
}

export function observatoryReducer(
  state: ObservatoryState,
  action: ObservatoryAction,
): ObservatoryState {
  switch (action.type) {
    case "snapshot": {
      const replace = action.replace ?? false
      const [repositories, repositoryOrder] = merge(
        state.repositories,
        state.repositoryOrder,
        action.repositories,
        replace,
        (item) => item.id,
      )
      const [worktrees, worktreeOrder] = merge(
        state.worktrees,
        state.worktreeOrder,
        action.worktrees,
        replace,
        (item) => item.id,
      )
      const [runs, runKeys] = merge(
        state.runs,
        state.runOrder,
        action.runs,
        replace,
        (item) => item.run_key,
      )
      // Resuming from the oldest snapshot replays anything a later one saw.
      const cursor =
        state.cursor === null || BigInt(action.cursor) < BigInt(state.cursor)
          ? action.cursor
          : state.cursor
      return {
        ...state,
        cursor,
        repositories,
        repositoryOrder,
        worktrees,
        worktreeOrder,
        runs,
        runOrder: sortRuns(runs, runKeys),
        resetReason: null,
      }
    }
    case "stream": {
      const { envelope } = action
      if (state.cursor === null) return state
      if (envelope.event === "observatory.reset") {
        return { ...initialState, resetReason: envelope.event }
      }
      if (BigInt(envelope.id) <= BigInt(state.cursor)) return state
      const inventory =
        envelope.event === "repository.updated" || envelope.event === "worktree.updated"
      const runKey = inventory ? null : envelope.run_key
      return {
        ...state,
        cursor: envelope.id,
        inventoryStale: state.inventoryStale || inventory,
        dirtyRuns:
          runKey && !state.dirtyRuns.includes(runKey)
            ? [...state.dirtyRuns, runKey]
            : state.dirtyRuns,
      }
    }
    case "runRefreshed": {
      const key = action.run.run_key
      const runs = { ...state.runs, [key]: action.run }
      const keys = key in state.runs ? state.runOrder : [...state.runOrder, key]
      return {
        ...state,
        runs,
        runOrder: sortRuns(runs, keys),
        dirtyRuns: state.dirtyRuns.filter((dirty) => dirty !== key),
      }
    }
    case "inventoryRefreshed":
      return { ...state, inventoryStale: false }
    case "reset":
      return { ...initialState, resetReason: action.reason }
    case "clear":
      return initialState
  }
}

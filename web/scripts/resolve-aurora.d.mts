export interface ResolvedAuroraItem {
  name: string
  type: string | null
  source_sha256: string
  registry_dependencies: string[]
  npm_dependencies: string[]
  installed_files: string[]
}

export function resolveGraph(
  topLevel: string[],
  fetchItem: (name: string) => Promise<string>,
): Promise<ResolvedAuroraItem[]>

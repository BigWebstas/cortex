// Resolves the pinned Aurora registry graph into web/aurora.lock.json.
// Network access happens only with --refresh; normal builds use vendored files.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

const LOCK_PATH = fileURLToPath(new URL("../aurora.lock.json", import.meta.url))

function dependencyName(reference) {
  const match = /^@aurora\/(aurora-[a-z0-9-]+)$/.exec(reference)
  if (!match) throw new Error(`dependency is outside the Aurora registry: ${reference}`)
  return match[1]
}

/** @param {string[]} topLevel @param {(name: string) => Promise<string>} fetchItem */
export async function resolveGraph(topLevel, fetchItem) {
  const resolved = new Map()
  const queue = [...topLevel]
  while (queue.length) {
    const name = queue.shift()
    if (resolved.has(name)) continue
    const body = await fetchItem(name)
    const item = JSON.parse(body)
    const dependencies = (item.registryDependencies ?? []).map(dependencyName).sort()
    resolved.set(name, {
      name,
      type: item.type ?? null,
      source_sha256: createHash("sha256").update(body).digest("hex"),
      registry_dependencies: dependencies,
      npm_dependencies: [...(item.dependencies ?? []), ...(item.devDependencies ?? [])].sort(),
      installed_files: (item.files ?? []).map((file) => file.target ?? file.path).sort(),
    })
    queue.push(...dependencies)
  }
  return [...resolved.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
}

async function refresh() {
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"))
  const { source_revision: sha, immutable_url_template: template } = lock.registry
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("source_revision must be a full commit SHA")
  lock.resolved_items = await resolveGraph(lock.top_level_items, async (name) => {
    const url = template.replace("{sha}", sha).replace("{name}", name)
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`${response.status} fetching ${url}`)
    return response.text()
  })
  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`)
  console.log(`Resolved ${lock.resolved_items.length} Aurora items at ${sha}.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!process.argv.includes("--refresh")) {
    console.error("Pass --refresh to fetch the pinned registry and rewrite aurora.lock.json.")
    process.exit(2)
  }
  await refresh()
}

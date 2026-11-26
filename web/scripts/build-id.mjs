// A build ID derived from the build inputs, so identical sources export
// identical files and changed sources get new immutable asset URLs.
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const INPUTS = [
  "app", "components", "lib", "public", "src",
  "next.config.ts", "package.json", "pnpm-lock.yaml", "postcss.config.mjs",
  "tailwind.config.ts", "tsconfig.json",
]

export function sourceBuildId(root, inputs = INPUTS) {
  const hash = createHash("sha256")
  const add = (path) => {
    const absolute = join(root, path)
    if (!existsSync(absolute)) return
    if (statSync(absolute).isDirectory()) {
      for (const name of readdirSync(absolute).sort()) add(`${path}/${name}`)
      return
    }
    const content = readFileSync(absolute)
    hash.update(`${path}\0${content.length}\0`).update(content)
  }
  for (const input of inputs) add(input)
  return hash.digest("hex").slice(0, 20)
}

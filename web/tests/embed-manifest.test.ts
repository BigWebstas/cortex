import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// @ts-expect-error Build manifest script is plain ESM JavaScript for Node.
import { buildEmbedManifest, extractInlineScriptHashes, sha256Base64 } from "../scripts/build-embed-manifest.mjs"

describe("embedded asset manifest generator", () => {
  it("hashes inline scripts while ignoring external scripts and JSON data blocks", () => {
    const html = [
      "<!doctype html><html><head>",
      '<script src="/app/_next/static/chunk.js"></script>',
      "<script>self.__next_f.push([1,'a'])</script>",
      '<script type="application/json">{"ignored":true}</script>',
      "<script>self.__next_f.push([1,'b'])</script>",
      "</head><body></body></html>",
    ].join("")

    const hashes = extractInlineScriptHashes(html)
    expect(hashes).toEqual([
      sha256Base64(Buffer.from("self.__next_f.push([1,'a'])", "utf8")),
      sha256Base64(Buffer.from("self.__next_f.push([1,'b'])", "utf8")),
    ])
  })

  it("generates a deterministic manifest with cache policies and exact ETags", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-embed-test-"))
    try {
      mkdirSync(join(dir, "investigate"), { recursive: true })
      mkdirSync(join(dir, "_next/static/chunks"), { recursive: true })
      writeFileSync(join(dir, "index.html"), "<!doctype html><script>console.log(1)</script>")
      writeFileSync(join(dir, "investigate/index.html"), "<!doctype html><h1>Investigate</h1>")
      writeFileSync(join(dir, "_next/static/chunks/main.js"), "console.log('chunk')")

      const manifest = buildEmbedManifest({
        outDir: dir,
        vendorCytoscape: null,
        sourceDateEpoch: "1700000000",
      })

      expect(manifest.schema).toBe(1)
      expect(manifest.generated_at).toBe("2023-11-14T22:13:20.000Z")
      expect(manifest.assets.map((asset: { request_path: string }) => asset.request_path)).toEqual([
        "/app/",
        "/app/_next/static/chunks/main.js",
        "/app/investigate/",
      ])
      const chunk = manifest.assets.find(
        (asset: { request_path: string }) => asset.request_path === "/app/_next/static/chunks/main.js",
      )
      expect(chunk.cache).toBe("immutable")
      const rootHtml = manifest.assets.find(
        (asset: { request_path: string }) => asset.request_path === "/app/",
      )
      expect(rootHtml.cache).toBe("no-store")
      expect(rootHtml.inline_script_hashes).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("rejects source maps and escaping symlinks", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-embed-bad-"))
    const outside = mkdtempSync(join(tmpdir(), "cortex-embed-outside-"))
    try {
      writeFileSync(join(dir, "bundle.js.map"), "{}")
      expect(() =>
        buildEmbedManifest({ outDir: dir, vendorCytoscape: null, sourceDateEpoch: "1700000000" }),
      ).toThrow("Source map")

      rmSync(join(dir, "bundle.js.map"))
      writeFileSync(join(outside, "secret.txt"), "nope")
      symlinkSync(join(outside, "secret.txt"), join(dir, "escape.txt"))
      expect(() =>
        buildEmbedManifest({ outDir: dir, vendorCytoscape: null, sourceDateEpoch: "1700000000" }),
      ).toThrow("Symlink escapes")
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

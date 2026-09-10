/**
 * Write or verify the committed CycloneDX SBOM.
 *
 * `--check` is the gate form: it regenerates the document and compares, so a
 * dependency change that never reaches `sbom.cdx.json` fails instead of leaving
 * a consumer scanning a stale inventory. Rendering lives in `sbom.ts`.
 *
 * @module
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SBOM_PATH, render } from './sbom.ts'

const root = resolve(import.meta.dirname, '..')
const check = process.argv.includes('--check')
const rendered = render(root)
const target = resolve(root, SBOM_PATH)

if (check) {
  let current: string
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    // Absent output: the gate reports the same remedy as a stale one.
    current = ''
  }
  if (current !== rendered) {
    console.error(`gen-sbom: ${SBOM_PATH} is stale. Run \`pnpm run gen-sbom\` and commit ${SBOM_PATH}.`)
    process.exitCode = 1
  } else {
    console.log(`gen-sbom: ${SBOM_PATH} is up to date.`)
  }
} else {
  writeFileSync(target, rendered)
  console.log(`gen-sbom: wrote ${SBOM_PATH}.`)
}

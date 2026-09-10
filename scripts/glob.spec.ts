import { globSync as builtinGlobSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { globSync } from './glob.ts'

const roots: string[] = []

/** Tree covering the segment shapes the gates glob: nested packages, dot directories, and sidecars. */
const FIXTURE_FILES = [
  'packages/core/session/package.json',
  'packages/core/session/src/index.ts',
  'packages/core/session/src/nested/deep.ts',
  'packages/client/ui/package.json',
  'vendor/cordis/package.json',
  'docs/architecture.md',
  'docs/guide/nested.md',
  'docs/.hidden.md',
  '.agents/notes/one.md',
  '.agents/notes/implemented/two.md',
  '.agents/skills/skill/SKILL.md',
  '.claude/settings.json',
  'node_modules/dep/index.ts',
  'apps/cli/app.cordis.yml',
]

/** Patterns exercised against the built-in; each names a shape a gate relies on. */
const AGREEMENT_PATTERNS: (string | string[])[] = [
  'packages/*/*/package.json',
  'packages/*/*/src/**/*.ts',
  'packages/*/*',
  'docs/**/*.md',
  'docs/*.md',
  '.agents/notes/**/*.md',
  '.agents/skills/**/*.md',
  '.claude/**',
  '**/*.md',
  '**/*.ts',
  '*',
  ['packages/*/*/package.json', 'vendor/*/package.json'],
  'missing-directory/**/*.ts',
]

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-glob-'))
  roots.push(root)
  for (const file of FIXTURE_FILES) {
    const absolute = join(root, file)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, '')
  }
  return root
}

function sorted(paths: Iterable<string>): string[] {
  return [...paths].map(path => path.replaceAll('\\', '/')).sort()
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('globSync', () => {
  it.each(AGREEMENT_PATTERNS)('matches the node:fs built-in for %j', (pattern) => {
    const cwd = fixture()
    expect(sorted(globSync(pattern, { cwd }))).toEqual(sorted(builtinGlobSync(pattern, { cwd })))
  })

  it('matches a literal dot directory segment', () => {
    const cwd = fixture()
    expect(sorted(globSync('.agents/notes/**/*.md', { cwd })))
      .toEqual(['.agents/notes/implemented/two.md', '.agents/notes/one.md'])
  })

  it('never matches a dot entry through a wildcard segment', () => {
    const cwd = fixture()
    expect(globSync('docs/*.md', { cwd })).not.toContain('docs/.hidden.md')
    expect(globSync('*', { cwd })).not.toContain('.agents')
  })

  it('drops excluded matches and does not descend excluded directories', () => {
    const cwd = fixture()
    const matches = globSync('**/*.ts', { cwd, exclude: ['node_modules/**', '**/nested/**'] })
    expect(sorted(matches)).toEqual(['packages/core/session/src/index.ts'])
  })

  it('agrees with the built-in when an exclusion is applied', () => {
    const cwd = fixture()
    const exclude = ['node_modules/**', 'vendor/**']
    expect(sorted(globSync('**/*.ts', { cwd, exclude })))
      .toEqual(sorted(builtinGlobSync('**/*.ts', { cwd, exclude })))
  })

  it('reports directory entries through withFileTypes', () => {
    const cwd = fixture()
    const entries = globSync('packages/*/*', { cwd, withFileTypes: true })
    expect(sorted(entries.filter(entry => entry.isDirectory()).map(entry => entry.name)))
      .toEqual(['session', 'ui'])
    expect(entries.every(entry => entry.isFile() !== entry.isDirectory())).toBe(true)
  })

  it('yields nothing for a walk root absent from the checkout', () => {
    expect(globSync('missing-directory/**/*.ts', { cwd: fixture() })).toEqual([])
  })
})

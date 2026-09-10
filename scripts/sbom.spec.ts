import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as CDX from '@cyclonedx/cyclonedx-library'
import { describe, expect, it } from 'vitest'

import { SBOM_PATH, npmPurl, parseSnapshotKey, runtimeClosure, seedKeys, unconditionalKeys } from './sbom.ts'

const root = resolve(import.meta.dirname, '..')

/** Lockfile covering the entry forms the walk distinguishes. */
const LOCK = {
  importers: {
    '.': { dependencies: { 'root-tooling-only': { version: '1.0.0' } } },
    'apps/cli': {
      dependencies: {
        shipped: { version: '1.0.0' },
        '@deepseek-ai/dsh-core': { version: 'link:../../packages/core/session' },
      },
      optionalDependencies: { 'shipped-optional': { version: '2.0.0' } },
    },
    'examples/demo': { dependencies: { 'demo-only': { version: '1.0.0' } } },
    'website': { dependencies: { 'docs-only': { version: '1.0.0' } } },
    'packages/test-support/harness': { dependencies: { 'test-only': { version: '1.0.0' } } },
  },
  packages: {
    'shipped@1.0.0': { resolution: { integrity: 'sha512-3q2+7w==' } },
    'shipped-optional@2.0.0': { resolution: { integrity: 'sha512-3q2+7w==' } },
    'transitive@3.0.0': { resolution: { integrity: 'sha512-3q2+7w==' } },
    'native-linux@4.0.0': { resolution: { integrity: 'sha512-3q2+7w==' }, os: ['linux'], cpu: ['x64'] },
    'behind-native@5.0.0': { resolution: { integrity: 'sha512-3q2+7w==' } },
  },
  snapshots: {
    'shipped@1.0.0': { dependencies: { transitive: '3.0.0' }, optionalDependencies: { 'native-linux': '4.0.0' } },
    'shipped-optional@2.0.0': {},
    'transitive@3.0.0': {},
    'native-linux@4.0.0': { dependencies: { 'behind-native': '5.0.0' } },
    'behind-native@5.0.0': {},
  },
}

describe('parseSnapshotKey', () => {
  it('splits a plain key', () => {
    expect(parseSnapshotKey('execa@10.0.0')).toEqual({ name: 'execa', version: '10.0.0' })
  })

  it('splits a scoped key', () => {
    expect(parseSnapshotKey('@scope/pkg@1.2.3')).toEqual({ name: '@scope/pkg', version: '1.2.3' })
  })

  it('splits before a peer group that contains its own separator', () => {
    expect(parseSnapshotKey('@agentclientprotocol/sdk@0.25.1(zod@4.4.3)'))
      .toEqual({ name: '@agentclientprotocol/sdk', version: '0.25.1' })
  })
})

describe('seedKeys', () => {
  it('takes runtime declarations from shipped areas only', () => {
    expect(seedKeys(LOCK).sort()).toEqual(['shipped-optional@2.0.0', 'shipped@1.0.0'])
  })
})

describe('runtimeClosure', () => {
  it('reaches transitive runtime dependencies and records their integrity', () => {
    const closure = runtimeClosure(LOCK)
    expect([...closure.keys()]).toEqual([
      'behind-native@5.0.0', 'native-linux@4.0.0', 'shipped-optional@2.0.0', 'shipped@1.0.0', 'transitive@3.0.0',
    ])
    expect(closure.get('shipped@1.0.0')?.integrity).toBe('sha512-3q2+7w==')
  })

  it('omits workspace and vendored link entries', () => {
    expect([...runtimeClosure(LOCK).keys()].some(key => key.includes('@deepseek-ai/dsh-core'))).toBe(false)
  })
})

describe('unconditionalKeys', () => {
  it('excludes a platform-restricted package and everything only behind one', () => {
    const unconditional = unconditionalKeys(LOCK)
    expect(unconditional.has('shipped@1.0.0')).toBe(true)
    expect(unconditional.has('transitive@3.0.0')).toBe(true)
    expect(unconditional.has('native-linux@4.0.0')).toBe(false)
    expect(unconditional.has('behind-native@5.0.0')).toBe(false)
  })
})

describe('npmPurl', () => {
  it('encodes a scoped identity', () => {
    expect(npmPurl('@scope/pkg', '1.2.3').toString()).toBe('pkg:npm/%40scope/pkg@1.2.3')
  })
})

describe(SBOM_PATH, () => {
  const document = readFileSync(resolve(root, SBOM_PATH), 'utf8')

  it('validates against the CycloneDX 1.6 schema', async () => {
    const validator = new CDX.Validation.JsonValidator(CDX.Spec.Spec1dot6.version)
    expect(await validator.validate(document)).toBeNull()
  })

  it('carries no field that varies between generating hosts', () => {
    const bom = JSON.parse(document) as { metadata: Record<string, unknown>; serialNumber?: string }
    expect(bom.serialNumber).toBeUndefined()
    expect(bom.metadata.timestamp).toBeUndefined()
  })

  it('identifies every component by purl and pins it by hash', () => {
    const bom = JSON.parse(document) as { components: { purl?: string; hashes?: unknown[]; 'bom-ref': string }[] }
    expect(bom.components.length).toBeGreaterThan(0)
    expect(bom.components.filter(component => component.purl === undefined)).toEqual([])
    expect(bom.components.filter(component => component.hashes === undefined)).toEqual([])
    expect(bom.components.every(component => component['bom-ref'] === component.purl)).toBe(true)
  })
})

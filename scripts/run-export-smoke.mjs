import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const pkgs = ['shared', 'content-ingest', 'ai-core', 'pedagogy', 'resource-service', 'export']
const alias = Object.fromEntries(pkgs.map((p) => [`@tutor/${p}`, path.join(root, 'packages', p, 'src', 'index.ts')]))

const outfile = path.join(root, 'tmp', 'export-smoke.cjs')
await build({
  entryPoints: [path.join(root, 'scripts', 'export-smoke.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  alias,
  external: ['electron'],
  outfile,
  logLevel: 'warning'
})

const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit', cwd: root })
process.exit(result.status ?? 1)

import assert from 'node:assert/strict'
import { build } from 'esbuild'

const entries = [{ entry: 'packages/practice/src/extract.ts', outfile: 'tmp/practice-extract-test.cjs' }]
for (const item of entries) {
  await build({
    entryPoints: [item.entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: item.outfile,
    alias: { '@tutor/shared': 'packages/shared/src/index.ts' },
    logLevel: 'silent'
  })
}
const { parseQuestionsFromText } = await import('../tmp/practice-extract-test.cjs')

const input = `19-20 高数练习
1 A. 充分且必要 (B) 必要非充分 (C) 充分非必要 (D) 既不充分也不必要
2、设（ ）函数 f(x) 在 (a,b) 上一致连续，则……
1 π x x e 1−
(A) 可去型间断点 (B) 跳跃型间断点 (C) 无穷型间断点 (D) 第二类间断点，但非无穷型间断点
3. 已知 f(0)=0，f'(0)=0，f''(0)=0，则下面结论正确的是
(A) (0,0) 是曲线 y=f(x) 的拐点
(B) (0,0) 是曲线 y=f(x) 的极值点
答案：B
`
const result = parseQuestionsFromText(input)
assert.equal(result.items.length, 2, JSON.stringify(result.items, null, 2))
assert.match(result.items[0].stem, /设（ ）函数 f\(x\)/)
assert.match(result.items[0].stem, /π x x e 1−/)
assert.deepEqual(result.items[0].options, [
  '可去型间断点', '跳跃型间断点', '无穷型间断点', '第二类间断点，但非无穷型间断点'
])
assert.deepEqual(result.items[1].options, [
  '(0,0) 是曲线 y=f(x) 的拐点', '(0,0) 是曲线 y=f(x) 的极值点'
])
assert.equal(result.items[1].answer, 'B')
assert.equal(result.items[0].sourceNo, 2)
console.log('pasted question extraction regressions passed')

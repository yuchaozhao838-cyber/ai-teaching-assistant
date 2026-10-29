/** 把 LaTeX 转成 Word / PPT 里可读的线性文本（Office 导出不支持 KaTeX 渲染） */

const SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  Delta: 'Δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  Theta: 'Θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  Lambda: 'Λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  Pi: 'Π',
  rho: 'ρ',
  sigma: 'σ',
  Sigma: 'Σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Omega: 'Ω',
  Gamma: 'Γ',
  infty: '∞',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  leftrightarrow: '↔',
  times: '×',
  cdot: '·',
  div: '÷',
  pm: '±',
  mp: '∓',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  equiv: '≡',
  sim: '∼',
  propto: '∝',
  sum: '∑',
  prod: '∏',
  int: '∫',
  oint: '∮',
  partial: '∂',
  nabla: '∇',
  cdots: '⋯',
  ldots: '…',
  dots: '…',
  angle: '∠',
  perp: '⊥',
  parallel: '∥',
  therefore: '∴',
  because: '∵',
  forall: '∀',
  exists: '∃',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  supset: '⊃',
  cup: '∪',
  cap: '∩',
  emptyset: '∅',
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  cot: 'cot',
  sec: 'sec',
  csc: 'csc',
  log: 'log',
  ln: 'ln',
  lg: 'lg',
  lim: 'lim',
  max: 'max',
  min: 'min',
  sup: 'sup',
  inf: 'inf',
  exp: 'exp',
  det: 'det',
  quad: '',
  qquad: '',
  left: '',
  right: '',
  limits: '',
  displaystyle: '',
  textstyle: '',
  big: '',
  Big: '',
  bigg: '',
  Bigg: ''
}

const SUPERS: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ'
}

const SUBS: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  o: 'ₒ',
  x: 'ₓ',
  h: 'ₕ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  p: 'ₚ',
  s: 'ₛ',
  t: 'ₜ'
}

function unwrapBraces(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed.slice(1, -1)
  return trimmed
}

/** 取出 { ... } 的内容（支持嵌套） */
function readGroup(source: string, start: number): { content: string; end: number } | null {
  if (source[start] !== '{') return null
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return { content: source.slice(start + 1, i), end: i + 1 }
    }
  }
  return null
}

function alreadyParenthesized(text: string): boolean {
  if (!text.startsWith('(') || !text.endsWith(')')) return false
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') {
      depth -= 1
      if (depth === 0 && i !== text.length - 1) return false
    }
  }
  return depth === 0
}

function wrapIfNeeded(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  if (alreadyParenthesized(trimmed)) return trimmed
  if (/[\s+\-×·÷/]/.test(trimmed)) return `(${trimmed})`
  return trimmed
}

function toSuperscript(raw: string): string {
  const content = unwrapBraces(raw).replace(/\s+/g, '')
  if (!content) return ''
  const chars = [...content]
  if (chars.every((ch) => SUPERS[ch] !== undefined)) return chars.map((ch) => SUPERS[ch]).join('')
  return `^(${content})`
}

function toSubscript(raw: string): string {
  const content = unwrapBraces(raw).replace(/\s+/g, '')
  if (!content) return ''
  const chars = [...content]
  if (chars.every((ch) => SUBS[ch] !== undefined)) return chars.map((ch) => SUBS[ch]).join('')
  if (/^[\wΔαβγθλμσφω]+$/u.test(content)) return `_${content}`
  return `_(${content})`
}

export function latexToPlain(latex: string): string {
  let text = (latex ?? '').trim()
  if (!text) return ''

  // 间距类命令
  text = text.replace(/\\(?:left|right|big|Big|bigg|Bigg)(?![a-zA-Z])/g, '')
  text = text.replace(/\\[,;:!]/g, ' ').replace(/\\\s/g, ' ')

  // \text{...} / \mathrm{...} 等：保留内容
  for (let guard = 0; guard < 40; guard += 1) {
    const match = /\\(?:text|textrm|mbox|mathrm|mathbf|mathit|operatorname|boldsymbol)\s*\{([^{}]*)\}/.exec(text)
    if (!match) break
    text = `${text.slice(0, match.index)}${match[1]}${text.slice(match.index + match[0].length)}`
  }

  // \frac{a}{b} → (a)/(b)
  for (let guard = 0; guard < 60; guard += 1) {
    const match = /\\[dt]?frac\s*\{\s*([^{}]*?)\s*\}\s*\{\s*([^{}]*?)\s*\}/.exec(text)
    if (!match) break
    const numerator = wrapIfNeeded(match[1])
    const denominator = wrapIfNeeded(match[2])
    text = `${text.slice(0, match.index)}${numerator}/${denominator}${text.slice(match.index + match[0].length)}`
  }

  // \sqrt{a} → √(a)
  for (let guard = 0; guard < 20; guard += 1) {
    const index = text.indexOf('\\sqrt')
    if (index < 0) break
    const braceIndex = text.indexOf('{', index)
    const group = braceIndex > 0 ? readGroup(text, braceIndex) : null
    if (!group) {
      text = text.replace('\\sqrt', '√')
      continue
    }
    text = `${text.slice(0, index)}√(${group.content.trim()})${text.slice(group.end)}`
  }

  // 希腊字母与数学符号（先于上下标处理，保证下标里的 \Delta 变成 Δ）
  text = text.replace(/\\([a-zA-Z]+)/g, (_m, name: string) => (SYMBOLS[name] !== undefined ? SYMBOLS[name] : name))
  text = text.replace(/\\%/g, '%').replace(/\\\{/g, '{').replace(/\\\}/g, '}')

  // 上下标
  text = text.replace(/\^\{([^{}]*)\}|\^(\w)/g, (_m, braced: string | undefined, single: string | undefined) =>
    toSuperscript(braced ?? single ?? '')
  )
  text = text.replace(/_\{([^{}]*)\}|_(\w)/g, (_m, braced: string | undefined, single: string | undefined) =>
    toSubscript(braced ?? single ?? '')
  )

  // 剩余花括号、多余空白
  text = text.replace(/[{}]/g, '')
  text = text.replace(/\s+/g, '')
  // 函数名后补一个空格，避免 sinx、limΔ 这类粘连
  text = text.replace(/(sin|cos|tan|cot|log|ln|lim|max|min|sup|inf|exp|det)(?=[a-zA-ZΔ-ω(])/g, '$1 ')
  // lim_(x→0) → lim(x→0)，读起来更像数学写法
  text = text.replace(/(lim|max|min|sup|inf)_\(([^()]*)\)/g, '$1($2)')
  return text.trim()
}

/** 处理正文里的行内/独立公式，转成线性文本 */
export function normalizeMathText(text: string): string {
  if (!text || !text.includes('$')) return text ?? ''
  return text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, latex: string) => {
      const plain = latexToPlain(latex)
      return plain ? ` ${plain} ` : ' '
    })
    .replace(/(?<!\$)\$(?!\$)([^\n$]{1,400}?)\$(?!\$)/g, (_m, latex: string) => latexToPlain(latex))
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** 一行文字里公式是否占绝对多数（PPT 侧栏里这类行就跳过） */
export function isMostlyMath(text: string): boolean {
  if (!text.includes('$')) return false
  const withoutMath = text.replace(/\$[^$]*\$/g, '')
  return withoutMath.replace(/[\s，。、；：,.;:!?（）()【】]/g, '').length < 4
}

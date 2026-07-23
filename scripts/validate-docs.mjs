import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsRoot = path.join(root, 'docs')
const sourcePath = path.join(root, 'work/main.js')
const catalogPath = path.join(docsRoot, 'public/feature-catalog.json')
const ignoredPages = new Set(['README.md', 'INTRODUCTION.md'])
const requiredPageFields = [
  'title',
  'description',
  'feature_ids',
  'source_anchors',
  'since',
  'version',
  'status',
  'last_verified',
  'screenshots',
]
const requiredFeatureFields = [
  'feature_id',
  'title',
  'category',
  'description',
  'source_anchor',
  'since',
  'version',
  'status',
  'last_verified',
  'screenshots',
  'docs',
]
const errors = []

function walk(directory, predicate) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.vitepress' || entry.name === 'superpowers') return []
      return walk(absolute, predicate)
    }
    return predicate(absolute) ? [absolute] : []
  })
}

function relativeDocs(file) {
  return path.relative(docsRoot, file).split(path.sep).join('/')
}

function parseValue(value) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed.replace(/^(['"])(.*)\1$/, '$2')
}

function frontmatter(file, text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) {
    errors.push(`${relativeDocs(file)}: 缺少 YAML frontmatter`)
    return {}
  }
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => {
    const field = line.match(/^([a-z_]+):\s*(.*)$/)
    return field ? [[field[1], parseValue(field[2])]] : []
  }))
}

function sourceVersion(source) {
  return source.match(/^\/\/\s*@version\s+([^\s]+)\s*$/m)?.[1] || ''
}

function assetExists(reference, pageFile) {
  const clean = reference.split(/[?#]/, 1)[0]
  if (!clean || /^(?:https?:|mailto:|#)/.test(clean)) return true
  if (clean.startsWith('/screenshots/')) {
    return fs.existsSync(path.join(root, 'assets', clean.slice(1)))
  }
  if (clean === '/logo.png') return fs.existsSync(path.join(root, 'assets/logo.png'))
  if (fs.existsSync(path.join(docsRoot, 'public', clean.replace(/^\/+/, '')))) return true
  if (clean.startsWith('/')) {
    const target = clean.replace(/^\/+/, '')
    return [
      path.join(docsRoot, `${target}.md`),
      path.join(docsRoot, target, 'index.md'),
      path.join(docsRoot, target),
    ].some(fs.existsSync)
  }
  const absolute = path.resolve(path.dirname(pageFile), clean)
  return [
    absolute,
    `${absolute}.md`,
    path.join(absolute, 'index.md'),
  ].some(fs.existsSync)
}

if (!fs.existsSync(sourcePath)) errors.push('work/main.js: 源文件不存在')
if (!fs.existsSync(catalogPath)) errors.push('docs/public/feature-catalog.json: 功能目录不存在')

const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : ''
const version = sourceVersion(source)
const pages = walk(docsRoot, (file) => file.endsWith('.md') && !ignoredPages.has(relativeDocs(file)))
const pageMeta = new Map()

for (const file of pages) {
  const relative = relativeDocs(file)
  const text = fs.readFileSync(file, 'utf8')
  const meta = frontmatter(file, text)
  pageMeta.set(relative, meta)

  for (const field of requiredPageFields) {
    if (!(field in meta)) errors.push(`${relative}: 缺少元数据字段 ${field}`)
  }
  if (!Array.isArray(meta.feature_ids) || meta.feature_ids.length === 0) {
    errors.push(`${relative}: feature_ids 必须是非空数组`)
  }
  if (!Array.isArray(meta.source_anchors) || meta.source_anchors.length === 0) {
    errors.push(`${relative}: source_anchors 必须是非空数组`)
  } else {
    for (const anchor of meta.source_anchors) {
      if (!source.includes(anchor)) errors.push(`${relative}: 源码锚点不存在：${anchor}`)
    }
  }
  if (!Array.isArray(meta.screenshots)) {
    errors.push(`${relative}: screenshots 必须是数组`)
  } else {
    for (const screenshot of meta.screenshots) {
      if (!assetExists(screenshot, file)) errors.push(`${relative}: 截图不存在：${screenshot}`)
    }
  }
  if (meta.version !== version) {
    errors.push(`${relative}: version=${meta.version || '空'}，当前脚本版本=${version || '未知'}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(meta.last_verified || ''))) {
    errors.push(`${relative}: last_verified 必须为 YYYY-MM-DD`)
  }
  if (!['current', 'experimental', 'deprecated'].includes(meta.status)) {
    errors.push(`${relative}: status 必须为 current、experimental 或 deprecated`)
  }

  for (const match of text.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)) {
    const [, image, label, reference] = match
    if (image && !label.trim()) errors.push(`${relative}: 图片缺少替代文本：${reference}`)
    if (!assetExists(reference.trim(), file)) errors.push(`${relative}: 链接或图片不存在：${reference}`)
  }
}

let catalog = []
if (fs.existsSync(catalogPath)) {
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  } catch (error) {
    errors.push(`feature-catalog.json: JSON 无效：${error.message}`)
  }
}
if (!Array.isArray(catalog)) {
  errors.push('feature-catalog.json: 顶层必须是数组')
  catalog = []
}

const ids = new Set()
for (const feature of catalog) {
  const id = feature?.feature_id || '<missing>'
  for (const field of requiredFeatureFields) {
    if (!(field in (feature || {}))) errors.push(`${id}: 缺少功能字段 ${field}`)
  }
  if (!/^[A-Z]+(?:-[A-Z]+)*-\d{3}$/.test(id)) errors.push(`${id}: feature_id 格式无效`)
  if (ids.has(id)) errors.push(`${id}: feature_id 重复`)
  ids.add(id)
  if (!source.includes(String(feature.source_anchor || ''))) {
    errors.push(`${id}: source_anchor 不存在：${feature.source_anchor || '空'}`)
  }
  if (feature.version !== version) {
    errors.push(`${id}: version=${feature.version || '空'}，当前脚本版本=${version || '未知'}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(feature.last_verified || ''))) {
    errors.push(`${id}: last_verified 必须为 YYYY-MM-DD`)
  }
  if (!['current', 'experimental', 'deprecated'].includes(feature.status)) {
    errors.push(`${id}: status 必须为 current、experimental 或 deprecated`)
  }
  if (!Array.isArray(feature.docs) || feature.docs.length === 0) {
    errors.push(`${id}: docs 必须至少映射一篇手册`)
  } else {
    for (const document of feature.docs) {
      const meta = pageMeta.get(document)
      if (!meta) errors.push(`${id}: 映射文档不存在或未纳入校验：${document}`)
      else if (!meta.feature_ids?.includes(id)) errors.push(`${id}: ${document} frontmatter 未反向声明该功能`)
    }
  }
  if (!Array.isArray(feature.screenshots)) {
    errors.push(`${id}: screenshots 必须是数组`)
  } else {
    for (const screenshot of feature.screenshots) {
      if (!fs.existsSync(path.join(root, screenshot))) errors.push(`${id}: 截图不存在：${screenshot}`)
    }
  }
}

for (const [page, meta] of pageMeta) {
  for (const id of meta.feature_ids || []) {
    if (!ids.has(id)) errors.push(`${page}: 引用了功能目录中不存在的 ${id}`)
  }
}

const screenshotCount = new Set(catalog.flatMap((feature) => feature.screenshots || [])).size
const categoryCount = new Set(catalog.map((feature) => feature.category)).size
const summary = {
  ok: errors.length === 0,
  version,
  pages: pages.length,
  features: catalog.length,
  categories: categoryCount,
  screenshots: screenshotCount,
  undocumented_features: errors.filter((error) => error.includes('docs 必须') || error.includes('未反向声明')).length,
  missing_source_anchors: errors.filter((error) => error.includes('源码锚点不存在') || error.includes('source_anchor 不存在')).length,
  errors,
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
if (errors.length) process.exitCode = 1

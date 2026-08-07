import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { transform, version as esbuildVersion } from 'esbuild'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const sourceRoot = path.join(projectRoot, 'lite/src')
const metadataPath = path.join(projectRoot, 'lite/userscript.meta.txt')
const releaseGatePath = path.join(projectRoot, 'lite/release-gate.json')
const featureCatalogPath = path.join(projectRoot, 'docs/public/feature-catalog.json')
const featureEvidencePath = path.join(
  projectRoot,
  'lite/contracts/feature-migration-evidence.json',
)
const releaseBrowserEvidencePath = path.join(
  projectRoot,
  'lite/contracts/release-browser-evidence.json',
)
const contractJsonPath = path.join(
  projectRoot,
  'lite/contracts/discourse-action-transports.json',
)
const outputRoot = path.join(projectRoot, 'work/greasyfork-lite')
const releaseOutputPaths = [
  path.join(projectRoot, 'work/main-lite.js'),
  path.join(projectRoot, 'work/mian-lite.js'),
]
const manifestPath = path.join(outputRoot, 'build-manifest.json')
const templatePath = path.join(outputRoot, 'main-loader.template.user.js')
const exampleConfigPath = path.join(outputRoot, 'release.config.example.json')
const runtimeKey = '__AWESOME_LINUXDO_READER_LITE_MODULE_RUNTIME__'
const entryModuleId = 'src/userscript/main-lite-entry.js'
const libraryMarker = '// __LDP_GREASYFORK_LIBRARY_REQUIREMENTS__'
const stylesheetToken = '__LDP_READER_STYLES_URL__'
const projectExecutableCeiling = 2_000_000
const projectTotalExecutableCeiling = 3_300_000
const greasyForkHardLimit = 2 * 1024 * 1024
const releaseAcceptanceKeys = [
  'runtimeComplete',
  'featureContractCoverageComplete',
  'browserMatrixAccepted',
  'performanceAccepted',
  'rollbackVerified',
]
const requiredBrowserScenarios = [
  'coldReload',
  'singlePortal',
  'readerSurface',
  'settingsMatrix',
  'notificationsAndMessages',
  'historyAndCollections',
  'timelineAndHiddenReplies',
  'errorCapture',
  'horizontalOverflow',
]
const coreDomains = new Set([
  'app',
  'cache',
  'discourse',
  'dom',
  'kernel',
  'layout',
  'live',
  'network',
  'shell',
  'state',
  'stream',
  'topic',
  'userscript',
])
const libraryDefinitions = [
  Object.freeze({
    name: 'main-lite-core',
    title: 'Awesome LinuxDo Reader Lite Core Library',
    titleZhCn: 'Awesome LinuxDo Reader Lite 核心库',
    file: 'libraries/main-lite-core.js',
    compatibilityFiles: ['libraries/mian-lite-core.js'],
    descriptionEn: 'Core runtime modules for Awesome LinuxDo Reader Lite.',
    description: '应用、数据、Discourse、Shell、主题、流与 userscript 运行核心',
  }),
  Object.freeze({
    name: 'main-lite-features',
    title: 'Awesome LinuxDo Reader Lite Features Library',
    titleZhCn: 'Awesome LinuxDo Reader Lite 功能库',
    file: 'libraries/main-lite-features.js',
    compatibilityFiles: ['libraries/mian-lite-features.js'],
    descriptionEn: 'Feature modules for Awesome LinuxDo Reader Lite.',
    description: '媒体、互动、设置、用户、通知、监控与其他功能模块',
  }),
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseArguments(args) {
  let check = false
  let config = ''
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--check') {
      check = true
      continue
    }
    if (value === '--config') {
      config = args[index + 1] ?? ''
      index += 1
      if (!config) throw new Error('--config 缺少文件路径')
      continue
    }
    throw new Error(`不支持的参数：${value}`)
  }
  return Object.freeze({ check, config })
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(entryPath) : [entryPath]
  }))
  return nested.flat()
}

function slash(value) {
  return value.replaceAll(path.sep, '/')
}

function moduleIdForSource(file) {
  const relative = slash(path.relative(path.join(projectRoot, 'lite'), file))
  return relative.endsWith('.ts')
    ? `${relative.slice(0, -3)}.js`
    : relative
}

function resolveModuleId(parentId, request) {
  if (!request.startsWith('.')) {
    throw new Error(`${parentId} 使用了不受支持的外部模块：${request}`)
  }
  const parts = parentId.split('/')
  parts.pop()
  for (const part of request.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error(`${parentId} 的依赖越出 Lite 根目录：${request}`)
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const resolved = parts.join('/')
  return /\.(?:js|json)$/.test(resolved) ? resolved : `${resolved}.js`
}

function indent(value, prefix = '\t') {
  return value
    .split('\n')
    .map((line) => line ? `${prefix}${line}` : '')
    .join('\n')
}

function runtimeBootstrap(sourceVersion, sharedHelpers) {
  return `
\tconst root = globalThis;
\tconst runtimeKey = ${JSON.stringify(runtimeKey)};
\tlet runtime = root[runtimeKey];
\tif (runtime === undefined) {
\t\tconst factories = new Map();
\t\tconst sourceHashes = new Map();
\t\tconst modules = new Map();
\t\tconst libraries = new Set();
\t\tlet started = false;

\t\tconst resolve = (parentId, request) => {
\t\t\tif (!request.startsWith('.')) {
\t\t\t\tthrow new Error(\`[main-lite] unsupported external module: \${request}\`);
\t\t\t}
\t\t\tconst parts = parentId.split('/');
\t\t\tparts.pop();
\t\t\tfor (const part of request.split('/')) {
\t\t\t\tif (!part || part === '.') continue;
\t\t\t\tif (part === '..') {
\t\t\t\t\tif (!parts.length) {
\t\t\t\t\t\tthrow new Error(\`[main-lite] module escapes root: \${parentId} -> \${request}\`);
\t\t\t\t\t}
\t\t\t\t\tparts.pop();
\t\t\t\t} else {
\t\t\t\t\tparts.push(part);
\t\t\t\t}
\t\t\t}
\t\t\tconst resolved = parts.join('/');
\t\t\treturn /\\.(?:js|json)$/.test(resolved) ? resolved : \`\${resolved}.js\`;
\t\t};

\t\tconst requireModule = (id) => {
\t\t\tconst cached = modules.get(id);
\t\t\tif (cached) return cached.exports;
\t\t\tconst factory = factories.get(id);
\t\t\tif (!factory) throw new Error(\`[main-lite] missing module: \${id}\`);
\t\t\tconst module = { exports: {} };
\t\t\tmodules.set(id, module);
\t\t\ttry {
\t\t\t\tfactory(module, module.exports, (request) => (
\t\t\t\t\trequireModule(resolve(id, request))
\t\t\t\t));
\t\t\t} catch (error) {
\t\t\t\tmodules.delete(id);
\t\t\t\tthrow error;
\t\t\t}
\t\t\treturn module.exports;
\t\t};

\t\truntime = Object.freeze({
\t\t\tschemaVersion: 1,
\t\t\tsourceVersion: ${JSON.stringify(sourceVersion)},
\t\t\tregister(id, factory, sourceHash) {
\t\t\t\tconst currentHash = sourceHashes.get(id);
\t\t\t\tif (currentHash !== undefined) {
\t\t\t\t\tif (currentHash !== sourceHash) {
\t\t\t\t\t\tthrow new Error(\`[main-lite] conflicting module: \${id}\`);
\t\t\t\t\t}
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tfactories.set(id, factory);
\t\t\t\tsourceHashes.set(id, sourceHash);
\t\t\t},
\t\t\tmarkLibrary(name) {
\t\t\t\tlibraries.add(name);
\t\t\t},
\t\t\tstart(entryId, expectedLibraries) {
\t\t\t\tfor (const name of expectedLibraries) {
\t\t\t\t\tif (!libraries.has(name)) {
\t\t\t\t\t\tthrow new Error(\`[main-lite] missing library: \${name}\`);
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tif (started) return requireModule(entryId);
\t\t\t\tstarted = true;
\t\t\t\ttry {
\t\t\t\t\treturn requireModule(entryId);
\t\t\t\t} catch (error) {
\t\t\t\t\tstarted = false;
\t\t\t\t\tthrow error;
\t\t\t\t}
\t\t\t},
\t\t});
\t\tObject.defineProperty(root, runtimeKey, {
\t\t\tconfigurable: true,
\t\t\tenumerable: false,
\t\t\twritable: false,
\t\t\tvalue: runtime,
\t\t});
\t}
\tif (runtime.schemaVersion !== 1 || runtime.sourceVersion !== ${JSON.stringify(sourceVersion)}) {
\t\tthrow new Error('[main-lite] Library 版本不匹配');
\t}

${indent(sharedHelpers)}
`
}

function stripCommonJsHelpers(code, source) {
  const ast = parse(code, { sourceType: 'script' })
  const helpers = []
  let helperEnd = 0
  for (const node of ast.program.body) {
    if (node.type !== 'VariableDeclaration') break
    const names = node.declarations.map((declaration) =>
      declaration.id.type === 'Identifier' ? declaration.id.name : '')
    if (!names.length || names.some((name) => !name.startsWith('__'))) break
    if (typeof node.start !== 'number' || typeof node.end !== 'number') {
      throw new Error(`${source} 的 CommonJS helper 缺少源码位置`)
    }
    const declarationSource = code.slice(node.start, node.end)
    for (const name of names) {
      helpers.push(Object.freeze({ name, source: declarationSource }))
    }
    helperEnd = node.end
  }
  return Object.freeze({
    code: helperEnd
      ? code.slice(helperEnd).replace(/^\r?\n/, '')
      : code,
    helpers: Object.freeze(helpers),
  })
}

async function compileModules() {
  const sourceFiles = (await walk(sourceRoot))
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => !/\/userscript\/mian-lite-(?:bootstrap|entry)\.ts$/.test(
      slash(file),
    ))
    .sort()
  const modules = []
  const sharedHelperSources = new Map()
  const sharedHelperOrder = []
  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8')
    const result = await transform(source, {
      charset: 'utf8',
      format: 'cjs',
      legalComments: 'inline',
      loader: 'ts',
      minify: false,
      sourcefile: slash(path.relative(projectRoot, file)),
      target: 'es2022',
      treeShaking: true,
    })
    if (result.warnings.length) {
      throw new Error(`${file} 编译产生 ${result.warnings.length} 条警告`)
    }
    const compiled = stripCommonJsHelpers(
      result.code.trimEnd(),
      slash(path.relative(projectRoot, file)),
    )
    for (const helper of compiled.helpers) {
      const current = sharedHelperSources.get(helper.name)
      if (current !== undefined && current !== helper.source) {
        throw new Error(`esbuild helper ${helper.name} 在模块间不一致`)
      }
      if (current === undefined) {
        sharedHelperSources.set(helper.name, helper.source)
        sharedHelperOrder.push(helper.name)
      }
    }
    modules.push(Object.freeze({
      id: moduleIdForSource(file),
      source: slash(path.relative(projectRoot, file)),
      sourceHash: sha256(source),
      code: compiled.code.trimEnd(),
    }))
  }

  const contractSource = await readFile(contractJsonPath, 'utf8')
  const contractValue = JSON.parse(contractSource)
  modules.push(Object.freeze({
    id: moduleIdForSource(contractJsonPath),
    source: slash(path.relative(projectRoot, contractJsonPath)),
    sourceHash: sha256(contractSource),
    code: `module.exports = ${JSON.stringify(contractValue, null, 2)};`,
  }))

  const ids = new Set(modules.map((module) => module.id))
  if (ids.size !== modules.length) throw new Error('Lite 模块 ID 存在重复')
  if (!ids.has(entryModuleId)) throw new Error(`缺少入口模块：${entryModuleId}`)
  for (const module of modules) {
    for (const match of module.code.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)) {
      const dependency = resolveModuleId(module.id, match[2])
      if (!ids.has(dependency)) {
        throw new Error(`${module.id} 缺少依赖模块：${dependency}`)
      }
    }
  }
  return Object.freeze({
    modules: Object.freeze(modules),
    sharedHelpers: sharedHelperOrder
      .map((name) => sharedHelperSources.get(name))
      .join('\n'),
  })
}

function libraryForModule(module) {
  if (module.id.startsWith('contracts/')) return libraryDefinitions[1]
  const domain = module.id.split('/')[1]
  return coreDomains.has(domain)
    ? libraryDefinitions[0]
    : libraryDefinitions[1]
}

function renderModule(module) {
  return [
    `\t/* Source: ${module.source} */`,
    `\truntime.register(${JSON.stringify(module.id)}, function(module, exports, require) {`,
    indent(module.code, '\t\t'),
    `\t}, ${JSON.stringify(module.sourceHash)});`,
  ].join('\n')
}

function renderLibrary(definition, modules, sourceVersion, sharedHelpers) {
  const body = modules.map(renderModule).join('\n\n')
  return [
    '// ==UserScript==',
    `// @name         ${definition.title}`,
    `// @name:zh-CN   ${definition.titleZhCn}`,
    '// @namespace    https://github.com/sunbigfly/awesome-linuxdo-reader',
    `// @version      ${sourceVersion}`,
    `// @description  ${definition.descriptionEn}`,
    `// @description:zh-CN ${definition.description}`,
    '// @author       sunbigfly',
    '// @license      MIT',
    '// @homepageURL  https://github.com/sunbigfly/awesome-linuxdo-reader',
    '// @supportURL   https://github.com/sunbigfly/awesome-linuxdo-reader/issues',
    '// @match        https://linux.do/*',
    '// @grant        none',
    '// ==/UserScript==',
    '',
    `/* Awesome LinuxDo Reader Lite ${sourceVersion} - ${definition.name}`,
    ` * ${definition.description}`,
    ' * Greasy Fork Library：可读、未压缩；由 TypeScript 源码确定性生成。',
    ' * 不要直接编辑此文件；修改 lite/src 后重新构建。',
    ' */',
    '(function () {',
    "\t'use strict';",
    runtimeBootstrap(sourceVersion, sharedHelpers).trimEnd(),
    '',
    body,
    '',
    `\truntime.markLibrary(${JSON.stringify(definition.name)});`,
    '})();',
    '',
  ].join('\n')
}

function parseMetadataVersion(metadata) {
  const match = metadata.match(/^\/\/\s+@version\s+(\S+)\s*$/m)
  if (!match) throw new Error('lite/userscript.meta.txt 缺少 @version')
  return match[1]
}

function renderLoader(metadata, sourceVersion, requirements = libraryMarker) {
  if (!metadata.includes(stylesheetToken) && requirements === libraryMarker) {
    throw new Error(`Lite metadata 缺少 ${stylesheetToken}`)
  }
  const endMarker = '// ==/UserScript=='
  if (metadata.split(endMarker).length !== 2) {
    throw new Error('Lite metadata 的结束标记数量不为 1')
  }
  const withLibraries = metadata.replace(
    endMarker,
    `${requirements}\n${endMarker}`,
  )
  const expectedLibraries = libraryDefinitions.map(({ name }) => name)
  return `${withLibraries.trimEnd()}\n\n` + [
    '(function () {',
    "\t'use strict';",
    `\tconst runtime = window.${runtimeKey};`,
    '\tif (!runtime || runtime.schemaVersion !== 1 ||',
    `\t\truntime.sourceVersion !== ${JSON.stringify(sourceVersion)}) {`,
    "\t\tthrow new Error('[main-lite] Greasy Fork Library 缺失或版本不匹配');",
    '\t}',
    `\truntime.start(${JSON.stringify(entryModuleId)}, ${JSON.stringify(expectedLibraries)});`,
    '})();',
    '',
  ].join('\n')
}

function validateStylesheetUrl(value, stylesheetHash) {
  const match = String(value ?? '').match(
    /^https:\/\/cdn\.jsdelivr\.net\/gh\/sunbigfly\/awesome-linuxdo-reader@([0-9a-f]{40})\/work\/main-lite\.css#sha256=([0-9a-f]{64})$/i,
  )
  if (!match) {
    throw new Error('readerStylesUrl 必须是带 commit 与 sha256 的不可变 main-lite.css jsDelivr URL')
  }
  if (match[2].toLowerCase() !== stylesheetHash) {
    throw new Error('readerStylesUrl 的 SHA-256 与当前 work/main-lite.css 不一致')
  }
  return String(value)
}

function validateLibraryUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('Library URL 必须使用 HTTPS')
  if (!['greasyfork.org', 'update.greasyfork.org'].includes(url.hostname)) {
    throw new Error(`Library 必须托管在 Greasy Fork：${url.hostname}`)
  }
  if (!/^\/scripts\/\d+\//.test(url.pathname) || !url.searchParams.has('version')) {
    throw new Error(`Library URL 必须固定到 Greasy Fork version：${value}`)
  }
  url.hash = ''
  return url.href
}

async function renderReleaseLoader(configPath, metadata, sourceVersion, libraries) {
  const releaseGate = JSON.parse(await readFile(releaseGatePath, 'utf8'))
  const blockedBy = releaseAcceptanceKeys.filter((key) => releaseGate[key] !== true)
  if (blockedBy.length) {
    throw new Error(`main-lite 正式发布门禁未通过：${blockedBy.join(', ')}`)
  }
  const [catalog, evidence, releaseBrowserEvidence] = await Promise.all([
    readFile(featureCatalogPath, 'utf8').then(JSON.parse),
    readFile(featureEvidencePath, 'utf8').then(JSON.parse),
    readFile(releaseBrowserEvidencePath, 'utf8').then(JSON.parse),
  ])
  const featureEntries = Object.entries(evidence.features ?? {})
  if (
    !Array.isArray(catalog) ||
    featureEntries.length !== catalog.length ||
    catalog.some((feature) => !Object.hasOwn(evidence.features ?? {}, feature.feature_id))
  ) {
    throw new Error('featureContractCoverageComplete 与当前功能证据不一致')
  }
  if (
    releaseBrowserEvidence.schemaVersion !== 1 ||
    releaseBrowserEvidence.releaseVersion !== sourceVersion ||
    releaseBrowserEvidence.browserMatrix?.accepted !== true ||
    requiredBrowserScenarios.some(
      (key) => releaseBrowserEvidence.browserMatrix?.scenarios?.[key] !== true,
    )
  ) {
    throw new Error('browserMatrixAccepted 与当前浏览器证据不一致')
  }
  if (
    releaseBrowserEvidence.performance?.accepted !== true ||
    releaseBrowserEvidence.performance?.cycles < 5 ||
    !Array.isArray(releaseBrowserEvidence.performance?.portalCounts) ||
    releaseBrowserEvidence.performance.portalCounts.length < 5 ||
    releaseBrowserEvidence.performance.portalCounts.some((value) => value !== 1) ||
    !Array.isArray(releaseBrowserEvidence.performance?.shadowNodeSamples) ||
    releaseBrowserEvidence.performance.shadowNodeSamples.length < 5 ||
    new Set(releaseBrowserEvidence.performance.shadowNodeSamples).size !== 1 ||
    !Array.isArray(releaseBrowserEvidence.performance?.heapUsedSamples) ||
    releaseBrowserEvidence.performance.heapUsedSamples.length < 5 ||
    releaseBrowserEvidence.performance.httpFailures !== 0 ||
    releaseBrowserEvidence.performance.http429 !== 0 ||
    releaseBrowserEvidence.performance.duplicateRequestPaths !== 0
  ) {
    throw new Error('performanceAccepted 与当前性能证据不一致')
  }
  if (releaseBrowserEvidence.rollback?.accepted !== true) {
    throw new Error('rollbackVerified 与当前回滚证据不一致')
  }
  if (releaseBrowserEvidence.security?.privateVulnerabilityReporting !== true) {
    throw new Error('私密漏洞报告渠道尚未验收')
  }
  const stylesheet = await readFile(
    path.join(projectRoot, 'work/main-lite.css'),
    'utf8',
  )
  const stylesheetUrl = validateStylesheetUrl(
    releaseGate.readerStylesUrl,
    sha256(stylesheet),
  )
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  if (config.schemaVersion !== 1 || !Array.isArray(config.libraries)) {
    throw new Error('Greasy Fork release config 无效')
  }
  const configByName = new Map(config.libraries.map((library) => [library.name, library]))
  if (configByName.size !== libraryDefinitions.length) {
    throw new Error('Greasy Fork release config 的 Library 数量不匹配')
  }
  const browserLibraryByName = new Map(
    (releaseBrowserEvidence.libraries ?? []).map((library) => [library.name, library]),
  )
  if (browserLibraryByName.size !== libraryDefinitions.length) {
    throw new Error('浏览器证据的 Library 数量不匹配')
  }
  const requirements = libraryDefinitions.map((definition) => {
    const configured = configByName.get(definition.name)
    const built = libraries.find((library) => library.name === definition.name)
    const accepted = browserLibraryByName.get(definition.name)
    if (!configured || !built || !accepted) {
      throw new Error(`缺少 Library 配置或浏览器证据：${definition.name}`)
    }
    const url = validateLibraryUrl(configured.url)
    const fixedUrl = new URL(url)
    if (
      accepted.versionId !== Number(fixedUrl.searchParams.get('version')) ||
      accepted.bytes !== built.bytes ||
      accepted.sha256 !== built.sha256
    ) {
      throw new Error(`Library 浏览器证据与构建不一致：${definition.name}`)
    }
    return `// @require      ${url}#sha256=${built.sha256}`
  }).join('\n')
  const releaseMetadata = metadata.replace(stylesheetToken, stylesheetUrl)
  const output = renderLoader(releaseMetadata, sourceVersion, requirements)
  if (Buffer.byteLength(output) > projectExecutableCeiling) {
    throw new Error('Greasy Fork 主 Loader 超过项目执行文件闸门')
  }
  return output
}

async function emit(file, content, check) {
  if (check) {
    let current = ''
    try {
      current = await readFile(file, 'utf8')
    } catch {
      throw new Error(`${slash(path.relative(projectRoot, file))} 不存在`)
    }
    if (current !== content) {
      throw new Error(`${slash(path.relative(projectRoot, file))} 已过期`)
    }
    return
  }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}

const { check, config } = parseArguments(process.argv.slice(2))
const metadata = await readFile(metadataPath, 'utf8')
const sourceVersion = parseMetadataVersion(metadata)
const { modules, sharedHelpers } = await compileModules()
const libraries = []
const generatedLibraries = []

for (const definition of libraryDefinitions) {
  const libraryModules = modules.filter(
    (module) => libraryForModule(module) === definition,
  )
  const content = renderLibrary(
    definition,
    libraryModules,
    sourceVersion,
    sharedHelpers,
  )
  parse(content, { sourceType: 'script' })
  const bytes = Buffer.byteLength(content)
  if (bytes > projectExecutableCeiling) {
    throw new Error(`${definition.name} 超过项目执行文件闸门：${bytes}`)
  }
  const outputPath = path.join(outputRoot, definition.file)
  const compatibilityOutputPaths = definition.compatibilityFiles.map(
    (file) => path.join(outputRoot, file),
  )
  generatedLibraries.push(Object.freeze({
    outputPaths: Object.freeze([outputPath, ...compatibilityOutputPaths]),
    content,
  }))
  libraries.push(Object.freeze({
    name: definition.name,
    file: slash(path.relative(projectRoot, outputPath)),
    compatibilityFiles: compatibilityOutputPaths.map(
      (file) => slash(path.relative(projectRoot, file)),
    ),
    description: definition.description,
    modules: libraryModules.length,
    bytes,
    sha256: sha256(content),
  }))
}

const template = renderLoader(metadata, sourceVersion)
parse(template, { sourceType: 'script' })
const projectTotalExecutableBytes = libraries.reduce(
  (total, library) => total + library.bytes,
  Buffer.byteLength(template),
)
if (projectTotalExecutableBytes > projectTotalExecutableCeiling) {
  throw new Error(
    `Lite 项目自有可执行 JS 总量超过闸门：${projectTotalExecutableBytes}`,
  )
}
for (const generated of generatedLibraries) {
  for (const outputPath of generated.outputPaths) {
    await emit(outputPath, generated.content, check)
  }
}
await emit(templatePath, template, check)

const exampleConfig = `${JSON.stringify({
  schemaVersion: 1,
  libraries: libraryDefinitions.map(({ name }) => ({
    name,
    url: `https://update.greasyfork.org/scripts/REPLACE_WITH_${name.toUpperCase().replaceAll('-', '_')}_ID/REPLACE_WITH_FILE.js?version=REPLACE_WITH_VERSION_ID`,
  })),
}, null, 2)}\n`
await emit(exampleConfigPath, exampleConfig, check)

const manifest = `${JSON.stringify({
  schemaVersion: 1,
  sourceVersion,
  entryModuleId,
  limits: {
    greasyForkHardLimit,
    projectExecutableCeiling,
    projectTotalExecutableCeiling,
  },
  compiler: {
    name: 'esbuild',
    version: esbuildVersion,
    transform: 'TypeScript modules to readable CommonJS factories with shared helpers',
    minified: false,
    sharedHelperDeclarations: sharedHelpers
      ? parse(sharedHelpers, { sourceType: 'script' }).program.body.length
      : 0,
  },
  modules: modules.length,
  projectTotalExecutableBytes,
  libraries,
  loaderTemplate: {
    file: slash(path.relative(projectRoot, templatePath)),
    bytes: Buffer.byteLength(template),
    sha256: sha256(template),
  },
}, null, 2)}\n`
await emit(manifestPath, manifest, check)

let release = null
if (config) {
  const configPath = path.resolve(projectRoot, config)
  const releaseLoader = await renderReleaseLoader(
    configPath,
    metadata,
    sourceVersion,
    libraries,
  )
  parse(releaseLoader, { sourceType: 'script' })
  for (const outputPath of releaseOutputPaths) {
    await emit(outputPath, releaseLoader, check)
  }
  release = Object.freeze({
    file: slash(path.relative(projectRoot, releaseOutputPaths[0])),
    compatibilityFiles: releaseOutputPaths.slice(1).map(
      (file) => slash(path.relative(projectRoot, file)),
    ),
    bytes: Buffer.byteLength(releaseLoader),
    sha256: sha256(releaseLoader),
  })
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  mode: check ? 'check' : 'build',
  sourceVersion,
  modules: modules.length,
  projectTotalExecutableBytes,
  libraries,
  loaderTemplate: slash(path.relative(projectRoot, templatePath)),
  release,
}, null, 2)}\n`)

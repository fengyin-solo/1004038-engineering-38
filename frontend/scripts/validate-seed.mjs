#!/usr/bin/env node
// 构建前样例校验（可单独重跑）：node scripts/validate-seed.mjs [--date=YYYY-MM-DD]
//
// 只做只读校验：不修改 seed.ts、不补造任何样例。任何设备类型/安装位置/最近校准/
// 校准周期缺失或越界，都会在这里打印出具体设备编号，并以非 0 退出码让构建失败。
// 校验逻辑与页面运行时同一份口径（src/data/calibration.ts）。
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const require = createRequire(import.meta.url)

function parseArgs(argv) {
  const args = { date: undefined }
  for (const item of argv.slice(2)) {
    if (item.startsWith('--date=')) {
      args.date = item.slice('--date='.length)
    }
  }
  return args
}

const args = parseArgs(process.argv)

// 在内存里把单个 TS 文件转成 CJS 并执行，跟随相对 import 递归加载同目录 TS。
function loadTsModule(tsPath, cache = new Map()) {
  const absPath = resolve(tsPath)
  if (cache.has(absPath)) {
    return cache.get(absPath).exports
  }
  const source = readFileSync(absPath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    fileName: absPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  })

  const module = { exports: {} }
  cache.set(absPath, module)

  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      let target = resolve(dirname(absPath), specifier)
      if (!target.endsWith('.ts')) {
        target = `${target}.ts`
      }
      return loadTsModule(target, cache)
    }
    // 校准模块只有相对 import；第三方包（typescript）走 node 解析兜底。
    return require(specifier)
  }

  const context = vm.createContext({
    module,
    exports: module.exports,
    require: localRequire,
    process,
    console,
    __filename: absPath,
    __dirname: dirname(absPath),
  })
  vm.runInContext(outputText, context, { filename: absPath })
  return module.exports
}

const seedPath = resolve(projectRoot, 'src/data/seed.ts')
const calibrationPath = resolve(projectRoot, 'src/data/calibration.ts')

const { SEED_ROWS } = loadTsModule(seedPath)
const { validateMonitorDeviceSeeds } = loadTsModule(calibrationPath)

const rows = SEED_ROWS.monitor_device ?? []
if (!Array.isArray(rows) || rows.length === 0) {
  console.error('✗ 样例校验失败：monitor_device 没有任何样例数据')
  process.exit(1)
}

const issues = validateMonitorDeviceSeeds(rows, args.date)
const refLabel = args.date ?? '今天'

if (issues.length > 0) {
  console.error(`✗ 监测设备样例校验失败（参照日期 ${refLabel}）：共 ${issues.length} 处问题`)
  for (const issue of issues) {
    const valueText = issue.value === '' ? '（空）' : `「${issue.value}」`
    console.error(`  - 设备 ${issue.device} 字段[${issue.field}]${valueText}：${issue.message}`)
  }
  console.error('')
  console.error('修复 seed.ts 后可单独重跑：npm run validate:seed（不生成重复样例）')
  process.exit(1)
}

console.log(`✓ 监测设备样例校验通过（参照日期 ${refLabel}）：已校验 ${rows.length} 台设备`)

#!/usr/bin/env node
// 监测设备样例的构建校验：设备类型 / 安装位置 / 最近校准 / 校准周期（上限见 calibration.js）。
// 只读校验——不修改 seed.json、不生成或补写样例，因此重复执行不会产生重复样例；
// 任何缺失或越界都会定位到具体设备后以退出码 1 失败。
//
// 用法：
//   node scripts/validate-seed.mjs            校验默认的 src/data/seed.json
//   node scripts/validate-seed.mjs <json路径>  校验指定的样例文件（便于单独重跑与测试）
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CALIBRATION_CYCLE_MAX_MONTHS,
  calibrationDueDate,
  calibrationIssues,
  calibrationVerdict,
  formatDate,
  todayString,
} from '../src/data/calibration.js'

const here = dirname(fileURLToPath(import.meta.url))
const seedPath = process.argv[2] ?? join(here, '../src/data/seed.json')

let seed
try {
  seed = JSON.parse(readFileSync(seedPath, 'utf8'))
} catch (error) {
  console.error(`样例校验失败：无法读取 ${seedPath}（${error.message}）`)
  process.exit(1)
}

const rows = Array.isArray(seed.monitor_device) ? seed.monitor_device : []
const today = todayString()
const errors = []

if (rows.length === 0) {
  errors.push('monitor_device：没有任何监测设备样例')
}

// 状态一致性只约束「运行中 / 待校准」：运行中的设备校准到期必须给出「待校准」结论，
// 未到期的设备不允许挂着「待校准」。待安装、已故障设备以安装与故障状态为准，不强制校准结论。
const STATUS_CHECK_EXEMPT = new Set(['待安装', '已故障'])

for (const row of rows) {
  const label = `monitor_device#${row?.id ?? '?'}（设备编号 ${row?.设备编号 ?? '未知'}）`
  const issues = calibrationIssues(row, today)
  for (const issue of issues) {
    errors.push(`${label}：${issue}`)
  }
  if (issues.length > 0) continue

  const status = String(row?.status ?? '')
  if (STATUS_CHECK_EXEMPT.has(status)) continue

  const verdict = calibrationVerdict(row, today)
  const due = formatDate(calibrationDueDate(row))
  if (verdict === '待校准' && status !== '待校准') {
    errors.push(`${label}：校准已于 ${due} 到期，状态应为「待校准」，当前为「${status}」`)
  } else if (verdict === '校准有效' && status === '待校准') {
    errors.push(`${label}：校准有效期至 ${due}，状态不应为「待校准」`)
  }
}

if (errors.length > 0) {
  console.error(
    `监测设备样例校验未通过：${errors.length} 处问题（基准日期 ${today}，校准周期上限 ${CALIBRATION_CYCLE_MAX_MONTHS} 个月）`,
  )
  for (const line of errors) {
    console.error(`  - ${line}`)
  }
  console.error('请修正 frontend/src/data/seed.json 后重跑：npm run validate:seed')
  process.exit(1)
}

console.log(
  `监测设备样例校验通过：${rows.length} 台设备（基准日期 ${today}，校准周期上限 ${CALIBRATION_CYCLE_MAX_MONTHS} 个月）`,
)

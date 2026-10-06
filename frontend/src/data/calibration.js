// 监测设备校准规则的唯一实现：构建校验（scripts/validate-seed.mjs，node 直接运行）与
// 页面运行时（流量监测页经 local-service 读取）共用这一份，保证「同一口径」。
// 全部是纯函数、只读：不写 localStorage，也不改种子数据，运行中与已故障设备记录不会被覆盖。

/** 校准周期上限（月）：超过即视为越界。 */
export const CALIBRATION_CYCLE_MAX_MONTHS = 36

/** 参与校验与展示的校准字段。 */
export const CALIBRATION_FIELDS = ['设备类型', '安装位置', '最近校准', '校准周期']

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 把 Date 格式化成 UTC 的 YYYY-MM-DD。
 * @param {Date} date
 * @returns {string}
 */
export function formatDate(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 今天的日期串（本地时区），校验脚本与浏览器都用同一取法。
 * @param {Date} [now]
 * @returns {string}
 */
export function todayString(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 严格解析 YYYY-MM-DD，格式不对或日期不存在（如 2026-02-30）都返回 null。
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseCalibrationDate(value) {
  if (typeof value !== 'string') return null
  const match = DATE_PATTERN.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date
}

/**
 * 校准周期是否合法：1 到上限之间的整数（月）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidCycle(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= CALIBRATION_CYCLE_MAX_MONTHS
  )
}

/**
 * 逐字段校验一条监测设备记录，返回问题列表（空数组 = 全部通过）。
 * @param {Record<string, unknown>} row
 * @param {string} [today] YYYY-MM-DD，用于判定「最近校准不能晚于今天」
 * @returns {string[]}
 */
export function calibrationIssues(row, today = todayString()) {
  const issues = []
  if (typeof row?.设备类型 !== 'string' || row.设备类型.trim() === '') {
    issues.push('设备类型缺失或为空')
  }
  if (typeof row?.安装位置 !== 'string' || row.安装位置.trim() === '') {
    issues.push('安装位置缺失或为空')
  }
  const last = parseCalibrationDate(row?.最近校准)
  if (!last) {
    issues.push('最近校准缺失或不是合法的 YYYY-MM-DD 日期')
  } else if (formatDate(last) > today) {
    issues.push(`最近校准 ${formatDate(last)} 晚于基准日期 ${today}`)
  }
  if (!isValidCycle(row?.校准周期)) {
    issues.push(`校准周期缺失或越界（应为 1-${CALIBRATION_CYCLE_MAX_MONTHS} 的整数月）`)
  }
  return issues
}

/**
 * 日期加若干个月，月末日期向目标月最后一天收敛（如 01-31 + 1 个月 = 02-28/29）。
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
function addMonths(date, months) {
  const day = date.getUTCDate()
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(day, lastDay))
  return first
}

/**
 * 校准到期日：最近校准 + 校准周期个月；字段缺失或越界时返回 null（无法判定）。
 * @param {Record<string, unknown>} row
 * @returns {Date | null}
 */
export function calibrationDueDate(row) {
  const last = parseCalibrationDate(row?.最近校准)
  if (!last || !isValidCycle(row?.校准周期)) return null
  return addMonths(last, Number(row.校准周期))
}

/**
 * 校准结论，构建校验与流量监测页读取的就是这同一个判定：
 * - '待校准'：到期日不晚于基准日期
 * - '校准有效'：到期日晚于基准日期
 * - '数据缺失'：校准字段缺失或越界，无法判定
 * @param {Record<string, unknown>} row
 * @param {string} [today] YYYY-MM-DD 基准日期
 * @returns {'待校准' | '校准有效' | '数据缺失'}
 */
export function calibrationVerdict(row, today = todayString()) {
  const due = calibrationDueDate(row)
  if (!due) return '数据缺失'
  return formatDate(due) <= today ? '待校准' : '校准有效'
}

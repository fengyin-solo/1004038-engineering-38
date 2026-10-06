import type { EntryRow } from './types'

// 校准口径集中在这里：构建期样例校验、监测设备页、流量监测页都走同一份推导，
// 任何一处都不允许自己再算一遍，避免「同一台设备两处结论不一致」。

// 校准周期上限（含，单位：天）。样例里的周期超过该上限会在构建期直接失败。
export const CALIBRATION_CYCLE_MIN_DAYS = 1
export const CALIBRATION_CYCLE_MAX_DAYS = 365

// 监测设备必须参与样例校验的四个关键字段：设备类型、安装位置、最近校准、校准周期。
export const DEVICE_TYPE_FIELD = '设备类型'
export const DEVICE_LOCATION_FIELD = '安装位置'
export const DEVICE_LAST_CALIBRATED_FIELD = '最近校准'
export const DEVICE_CYCLE_FIELD = '校准周期'

// 与 modules.ts 中 monitor_device 的状态保持字面量一致。
export const DEVICE_STATUS_PENDING_INSTALL = '待安装'
export const DEVICE_STATUS_RUNNING = '运行中'
export const DEVICE_STATUS_PENDING_CALIBRATION = '待校准'
export const DEVICE_STATUS_FAULT = '已故障'

// 校准相关字段都是中文字段名，读取时按宽松输入处理：字段可能缺失（undefined）。
export type DeviceRowLike = {
  status?: string | number | boolean
  [field: string]: string | number | boolean | undefined
}

export type CalibrationStatus = '待校准' | '正常'
export type DeviceEffectiveStatus =
  | typeof DEVICE_STATUS_PENDING_INSTALL
  | typeof DEVICE_STATUS_RUNNING
  | typeof DEVICE_STATUS_PENDING_CALIBRATION
  | typeof DEVICE_STATUS_FAULT

// 流量监测页读取设备校准结果时使用的结构。
export type DeviceCalibrationView = EntryRow & {
  effectiveStatus: DeviceEffectiveStatus
  calibrationConclusion: CalibrationStatus
  calibrationPending: boolean
}

export type CalibrationIssue = {
  device: string
  field: string
  value: string
  message: string
}

export function localToday(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function asText(value: string | number | boolean | undefined): string {
  if (value === undefined || value === null) {
    return ''
  }
  return String(value).trim()
}

// 解析 yyyy-mm-dd，按本地时区拆，避免 new Date('yyyy-mm-dd') 按 UTC 解析导致跨天。
export function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

function addDays(value: string, days: number): Date | null {
  const date = parseDate(value)
  if (!date) {
    return null
  }
  date.setDate(date.getDate() + days)
  return date
}

// 校准周期：只接受 1~365 的正整数天；缺失、非数字、越界一律返回 null。
export function parseCalibrationCycle(value: string | number | boolean | undefined): number | null {
  const text = asText(value)
  if (text === '') {
    return null
  }
  if (!/^\d+$/.test(text)) {
    return null
  }
  const days = Number(text)
  if (
    !Number.isInteger(days) ||
    days < CALIBRATION_CYCLE_MIN_DAYS ||
    days > CALIBRATION_CYCLE_MAX_DAYS
  ) {
    return null
  }
  return days
}

// 唯一口径：最近校准 + 校准周期上限是否已到。输入不完整时返回 null（无法下结论）。
export function calibrationConclusion(
  row: DeviceRowLike,
  refDate: string = localToday(),
): CalibrationStatus | null {
  const last = asText(row[DEVICE_LAST_CALIBRATED_FIELD])
  const cycle = parseCalibrationCycle(row[DEVICE_CYCLE_FIELD])
  const due = addDays(last, cycle ?? 0)
  const today = parseDate(refDate)
  if (!due || !today || cycle === null) {
    return null
  }
  return due.getTime() < today.getTime() ? '待校准' : '正常'
}

// 设备当前有效状态：不回写存储，只在读取时叠加校准结论。
// 显式的待安装/已故障优先（故障设备不能被校准结论覆盖）；
// 其余设备由「最近校准 + 周期上限」唯一推导，保证设备页和流量页同口径。
export function effectiveDeviceStatus(
  row: DeviceRowLike,
  refDate: string = localToday(),
): DeviceEffectiveStatus | null {
  const declared = asText(row.status)
  if (declared === DEVICE_STATUS_PENDING_INSTALL || declared === DEVICE_STATUS_FAULT) {
    return declared
  }
  const conclusion = calibrationConclusion(row, refDate)
  if (conclusion === null) {
    return null
  }
  return conclusion === '待校准' ? DEVICE_STATUS_PENDING_CALIBRATION : DEVICE_STATUS_RUNNING
}

// 给监测设备行叠加校准结论（纯派生，不修改入参、不触碰 localStorage）。
export function decorateDeviceCalibration(
  rows: EntryRow[],
  refDate: string = localToday(),
): DeviceCalibrationView[] {
  return rows.map((row) => {
    const effectiveStatus = effectiveDeviceStatus(row, refDate)
    const conclusion = calibrationConclusion(row, refDate)
    // 无法推导时回落到行内显式状态，结论不可计算就不算待校准，避免误报。
    const fallback = asText(row.status) as DeviceEffectiveStatus
    return {
      ...row,
      effectiveStatus: effectiveStatus ?? fallback,
      calibrationConclusion: conclusion ?? '正常',
      calibrationPending:
        (effectiveStatus ?? fallback) === DEVICE_STATUS_PENDING_CALIBRATION,
    }
  })
}

// 构建期样例校验：任何缺失或越界都定位到具体设备编号，一次性返回全部问题。
// 纯只读：不写入、不补造样例，允许失败后单独重跑。
export function validateMonitorDeviceSeeds(
  rows: EntryRow[],
  refDate: string = localToday(),
): CalibrationIssue[] {
  const issues: CalibrationIssue[] = []
  const today = parseDate(refDate)
  const seenIds = new Set<string>()

  for (const row of rows) {
    const device = asText(row['设备编号']) || `id=${asText(String(row.id)) || '未知'}`
    if (seenIds.has(device)) {
      issues.push({ device, field: '设备编号', value: device, message: '设备编号重复' })
    }
    seenIds.add(device)

    const required = [
      DEVICE_TYPE_FIELD,
      DEVICE_LOCATION_FIELD,
      DEVICE_LAST_CALIBRATED_FIELD,
      DEVICE_CYCLE_FIELD,
    ]
    for (const field of required) {
      if (asText(row[field]) === '') {
        issues.push({ device, field, value: '', message: `${field}缺失` })
      }
    }

    const lastText = asText(row[DEVICE_LAST_CALIBRATED_FIELD])
    if (lastText !== '') {
      const last = parseDate(lastText)
      if (!last) {
        issues.push({
          device,
          field: DEVICE_LAST_CALIBRATED_FIELD,
          value: lastText,
          message: '最近校准不是合法日期，应为 yyyy-mm-dd',
        })
      } else if (today && last.getTime() > today.getTime()) {
        issues.push({
          device,
          field: DEVICE_LAST_CALIBRATED_FIELD,
          value: lastText,
          message: `最近校准晚于 ${refDate}，不能为未来日期`,
        })
      }
    }

    const cycleText = asText(row[DEVICE_CYCLE_FIELD])
    if (cycleText !== '') {
      const cycle = parseCalibrationCycle(cycleText)
      if (cycle === null) {
        issues.push({
          device,
          field: DEVICE_CYCLE_FIELD,
          value: cycleText,
          message: `校准周期必须是 ${CALIBRATION_CYCLE_MIN_DAYS}~${CALIBRATION_CYCLE_MAX_DAYS} 天的正整数（越界或非数字）`,
        })
      }
    }

    // 样例里显式标记为「待校准」的设备，按同一口径推导也必须确实到期；
    // 待安装/已故障设备不参与到期判断，运行中设备是否到期交给运行时实时计算。
    const declared = asText(row.status)
    if (declared === DEVICE_STATUS_PENDING_CALIBRATION) {
      const conclusion = calibrationConclusion(row, refDate)
      if (conclusion === null) {
        issues.push({
          device,
          field: 'status',
          value: declared,
          message: '标记为待校准，但最近校准/校准周期无法推导出校准结论',
        })
      } else if (conclusion !== DEVICE_STATUS_PENDING_CALIBRATION) {
        issues.push({
          device,
          field: 'status',
          value: declared,
          message: `标记为待校准，但按最近校准+校准周期上限推导结论为「${conclusion}」`,
        })
      }
    }
  }

  return issues
}

import seedRows from './seed.json'
import type { EntryRow } from './types'

// 示例数据唯一数据源是 seed.json：构建校验脚本 scripts/validate-seed.mjs 直接读这份 JSON，
// 页面运行时也从这里播种，两边不会出现口径漂移。首次打开时播种，之后浏览器里的改动优先，
// 重置才会回到这份。
export const SEED_ROWS: Record<string, EntryRow[]> = seedRows as unknown as Record<string, EntryRow[]>

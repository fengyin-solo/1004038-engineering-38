<template>
  <section class="page" data-module="flow_monitor">
    <header class="page-head">
      <div>
        <h2>流量监测管理</h2>
        <p class="page-desc">维护流量监测点，围绕监测点编号、监测点位、监测时段、瞬时流量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记流量监测点</button>
        <button class="btn" type="button" @click="exportRows">导出流量监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无流量监测数据，可先登记流量监测点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条流量监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="calibration-panel">
      <h3 class="calibration-title">监测设备校准结论</h3>
      <p class="page-desc">
        与构建校验同一口径（src/data/calibration.js）：最近校准 + 校准周期不晚于今日即为「待校准」；只读展示，不改动设备数据。
      </p>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">待校准设备</span>
          <strong class="stat-value">{{ calibrationDueCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">校准有效</span>
          <strong class="stat-value">{{ calibrationOkCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">校准数据缺失</span>
          <strong class="stat-value">{{ calibrationMissingCount }}</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>设备编号</th>
            <th>设备类型</th>
            <th>安装位置</th>
            <th>最近校准</th>
            <th>校准周期</th>
            <th>校准到期日</th>
            <th>校准结论</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in calibrationRows" :key="item.id">
            <td>{{ item.设备编号 }}</td>
            <td>{{ item.设备类型 }}</td>
            <td>{{ item.安装位置 }}</td>
            <td>{{ item.最近校准 }}</td>
            <td>{{ item.校准周期 }}</td>
            <td>{{ item.校准到期日 }}</td>
            <td>{{ item.校准结论 }}</td>
          </tr>
          <tr v-if="!calibrationRows.length">
            <td colspan="7" class="empty-state">暂无监测设备校准数据</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listDeviceCalibration,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { DeviceCalibrationView } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('flow_monitor')
const columns = ["监测点编号", "监测点位", "监测时段", "瞬时流量", "累计流量", "水位标高", "流速", "数据状态"]
const actions = ["标记异常", "恢复在线", "申请校准"]
const statuses = ["在线", "离线", "数据异常", "已校准"]
const stats = [{"label": "在线测点", "value": 0}, {"label": "离线测点", "value": 0}, {"label": "异常测点", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const calibrationRows = ref<DeviceCalibrationView[]>([])
const calibrationDueCount = computed(
  () => calibrationRows.value.filter((item) => item.校准结论 === '待校准').length,
)
const calibrationOkCount = computed(
  () => calibrationRows.value.filter((item) => item.校准结论 === '校准有效').length,
)
const calibrationMissingCount = computed(
  () => calibrationRows.value.filter((item) => item.校准结论 === '数据缺失').length,
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '流量监测点登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '流量监测列表读取失败'
  }
}

function reloadCalibration() {
  calibrationRows.value = listDeviceCalibration()
}

onMounted(() => {
  reload()
  reloadCalibration()
})
</script>

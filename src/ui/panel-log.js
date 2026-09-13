/**
 * 面板五：日志
 * 统计摘要 / 筛选 / 日志列表 / 详情展开 / 清空 / 导出
 */
import { getLogs, getStats, clearLogs } from '../logger.js';
import { getStore } from '../store.js';
import { escapeHtml, downloadFile } from '../utils.js';
import { collapsible, bindCollapsibles, emptyState } from './widgets.js';
import { toastSuccess, toastError } from './toast.js';

let filter = 'all'; // all | error | warn | info

export function renderLogPanel(container) {
    container.innerHTML = buildHtml();
    bindCollapsibles(container);
    bind(container);
}

function buildHtml() {
    const stats = getStats();
    const logs = filteredLogs();
    const filters = [
        ['all', '全部'],
        ['error', '错误'],
        ['warn', '警告'],
        ['info', '信息'],
    ].map(([k, label]) => `<button class="l-filter ${filter === k ? 'active' : ''}" data-filter="${k}">${label}</button>`).join('');

    const rows = logs.length === 0
        ? emptyState('暂无日志')
        : logs.slice().reverse().map(logRow).join('');

    return `
        <div class="fw-panel">
            <div class="l-stats">
                <div class="l-stat l-total"><span class="l-stat-v">${stats.total}</span><span class="l-stat-k">总日志</span></div>
                <div class="l-stat l-error"><span class="l-stat-v">${stats.error}</span><span class="l-stat-k">错误</span></div>
                <div class="l-stat l-warn"><span class="l-stat-v">${stats.warn}</span><span class="l-stat-k">警告</span></div>
                <div class="l-stat l-info"><span class="l-stat-v">${stats.info}</span><span class="l-stat-k">信息</span></div>
            </div>

            ${collapsible('▶ 各任务最近一次 AI 收发', aiTraceHtml(), { defaultOpen: false })}

            <div class="l-filters">${filters}</div>
            <div class="l-actions">
                <button class="fw-btn fw-btn-danger" id="fw-log-clear">清空日志</button>
                <button class="fw-btn" id="fw-log-export">导出日志</button>
            </div>
            <div class="l-list">${rows}</div>
        </div>`;
}

/** 各任务最近一次发送/接收（按任务分组，发送与接收独立按钮展开收起） */
function aiTraceHtml() {
    const traces = getStore().ai_trace || {};
    const entries = Object.entries(traces);
    if (!entries.length) return emptyState('暂无记录（尚未发送，或已被下一轮用户输入清空）');
    return entries.map(([id, t]) => {
        const sent = (t.sent || [])
            .map((m) => `[${(m.role || 'user').toUpperCase()}]\n${m.content}`)
            .join('\n\n──────\n\n');
        const received = t.received ? t.received : '（等待返回…）';
        const time = t.time ? new Date(t.time).toLocaleTimeString() : '';
        return `
        <div class="fw-trace" data-task="${escapeHtml(id)}">
            <div class="fw-trace-head">
                <span class="fw-trace-task">「${escapeHtml(t.task || id)}」${time ? ` · ${time}` : ''}</span>
                <span class="fw-spacer"></span>
                <button class="fw-btn fw-btn-mini fw-trace-toggle" data-part="sent">📤 发送数据</button>
                <button class="fw-btn fw-btn-mini fw-trace-toggle" data-part="recv">📥 接收数据</button>
                <button class="fw-btn fw-btn-mini fw-trace-export" data-task="${escapeHtml(id)}">💾 导出接收数据</button>
            </div>
            <div class="fw-trace-part fw-trace-sent" style="display:none">
                <div class="fw-trace-label">📤 发送数据</div>
                <pre class="fw-pre">${escapeHtml(sent)}</pre>
            </div>
            <div class="fw-trace-part fw-trace-recv" style="display:none">
                <div class="fw-trace-label">📥 接收数据</div>
                <pre class="fw-pre">${escapeHtml(received)}</pre>
            </div>
        </div>`;
    }).join('');
}

function logRow(l) {
    const canExpand = (l.level === 'error' || l.level === 'warn') && l.detail;
    const expandBtn = canExpand ? `<button class="fw-btn fw-btn-mini l-expand" data-id="${l.time}-${l.round}">展开</button>` : '';
    const detailHtml = canExpand ? `
        <div class="l-detail" style="display:none">${detailBlock(l.detail)}</div>` : '';
    return `
        <div class="l-entry l-${l.level}">
            <span class="l-dot"></span>
            <div class="l-main">
                <div class="l-row">
                    <span class="l-round">[${l.round}]</span>
                    <span class="l-time">${l.time}</span>
                    <span class="l-src">${escapeHtml(l.source)}</span>
                    ${expandBtn}
                </div>
                <div class="l-msg">${escapeHtml(l.message)}</div>
                ${detailHtml}
            </div>
        </div>`;
}

function detailBlock(d) {
    if (!d) return '';
    const rows = [];
    if (d.type) rows.push(`<div><b>错误类型：</b>${escapeHtml(d.type)}</div>`);
    if (d.location) rows.push(`<div><b>发生位置：</b>${escapeHtml(d.location)}</div>`);
    if (d.snapshot) rows.push(`<div><b>状态快照：</b>${escapeHtml(d.snapshot)}</div>`);
    if (d.raw) rows.push(`<div><b>原始信息：</b><pre>${escapeHtml(d.raw)}</pre></div>`);
    if (d.suggest) rows.push(`<div><b>建议：</b>${escapeHtml(d.suggest)}</div>`);
    if (d.data) rows.push(`<div><b>完整数据：</b><pre>${escapeHtml(String(d.data))}</pre></div>`);
    return rows.join('');
}

function filteredLogs() {
    const logs = getLogs();
    if (filter === 'error') return logs.filter((l) => l.level === 'error' || l.level === 'warn');
    if (filter === 'warn') return logs.filter((l) => l.level === 'warn');
    if (filter === 'info') return logs.filter((l) => l.level === 'info');
    return logs;
}

function bind(container) {
    container.querySelectorAll('.fw-trace-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const trace = btn.closest('.fw-trace');
            const part = trace?.querySelector(btn.dataset.part === 'sent' ? '.fw-trace-sent' : '.fw-trace-recv');
            if (part) part.style.display = part.style.display === 'none' ? 'block' : 'none';
        });
    });

    // 导出单个任务的接收数据（AI 原始输出）
    container.querySelectorAll('.fw-trace-export').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.task;
            const t = getStore().ai_trace?.[id];
            if (!t || !t.received) {
                toastError('该任务尚无接收数据（尚未返回或被下一轮清空）');
                return;
            }
            downloadFile(`ananke-received-${id}.txt`, t.received);
            toastSuccess(`✅ 已导出「${t.task || id}」接收数据`);
        });
    });

    container.querySelectorAll('.l-filter').forEach((btn) => {
        btn.addEventListener('click', () => {
            filter = btn.dataset.filter;
            renderLogPanel(container);
        });
    });

    container.querySelectorAll('.l-expand').forEach((btn) => {
        btn.addEventListener('click', () => {
            const detail = btn.closest('.l-entry').querySelector('.l-detail');
            if (detail) detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
        });
    });

    const clearBtn = container.querySelector('#fw-log-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
        if (confirm('确定清空所有日志吗？')) {
            clearLogs();
            renderLogPanel(container);
        }
    });

    const exportBtn = container.querySelector('#fw-log-export');
    if (exportBtn) exportBtn.addEventListener('click', () => {
        const asJson = confirm('导出为 JSON 格式？\n「确定」= JSON，「取消」= TXT');
        const logs = getLogs();
        if (asJson) {
            downloadFile('ananke-log.json', JSON.stringify(logs, null, 2), 'application/json');
        } else {
            const text = logs.map((l) => `[${l.round}] ${l.time} [${l.source}] ${l.level} ${l.message}`).join('\n');
            downloadFile('ananke-log.txt', text);
        }
    });
}

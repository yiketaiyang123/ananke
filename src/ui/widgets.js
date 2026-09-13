/**
 * 命运编织者 · Ananke — 共享 UI 组件（折叠块 / 状态点 / 进度条）
 */
import { escapeHtml } from '../utils.js';

/** 折叠块 */
export function collapsible(title, contentHtml, { defaultOpen = false } = {}) {
    const cls = defaultOpen ? 'fw-coll fw-open' : 'fw-coll';
    return `
        <div class="${cls}">
            <button type="button" class="fw-coll-head">
                <span class="fw-coll-arrow">▶</span>
                <span class="fw-coll-title">${title}</span>
            </button>
            <div class="fw-coll-body">${contentHtml}</div>
        </div>`;
}

/** 为容器内所有折叠块绑定点击 */
export function bindCollapsibles(container) {
    container.querySelectorAll('.fw-coll-head').forEach((head) => {
        head.addEventListener('click', () => {
            head.parentElement.classList.toggle('fw-open');
        });
    });
}

/** 状态圆点 + 文案 */
export function statusBadge(status) {
    const map = {
        sleeping: { text: '沉睡中', color: '#8b8b99' },
        active: { text: '进行中', color: '#e8b84a' },
        triggered: { text: '已触发', color: '#7ac87a' },
        void: { text: '已失效', color: '#5c5c6a' },
        available: { text: '可用', color: '#7ac87a' },
        locked: { text: '冷却中', color: '#ef7b7b' },
    };
    const s = map[status] || { text: status || '?', color: '#8b8b99' };
    return `<span class="fw-badge"><span class="fw-dot" style="background:${s.color}"></span>${escapeHtml(s.text)}</span>`;
}

/** 进度条 */
export function progressBar(pct, label = '') {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    return `<div class="fw-progress"><div class="fw-progress-fill" style="width:${p}%"></div>${label ? `<span class="fw-progress-label">${escapeHtml(label)}</span>` : ''}</div>`;
}

/** 空态 */
export function emptyState(text) {
    return `<div class="fw-panel-empty">${escapeHtml(text)}</div>`;
}

/** 简单按钮 */
export function button(label, { id = '', cls = '', danger = false } = {}) {
    return `<button type="button" class="fw-btn ${danger ? 'fw-btn-danger' : ''} ${cls}" ${id ? `id="${id}"` : ''}>${label}</button>`;
}

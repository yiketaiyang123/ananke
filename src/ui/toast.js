/**
 * 命运编织者 · Ananke — 顶部提示（面板内轻量 toast）
 * 用于面板操作反馈，如「✅ 大纲已重写」。
 */

let toastHost = null;

function getHost() {
    if (!toastHost || !document.body.contains(toastHost)) {
        toastHost = document.createElement('div');
        toastHost.className = 'fw-toast-host';
        document.body.appendChild(toastHost);
    }
    return toastHost;
}

/**
 * 显示一条提示。
 * @param {string} message 提示文本
 * @param {'success'|'error'|'info'} kind 类型（决定样式）
 * @param {number} duration 展示毫秒数
 */
export function toast(message, kind = 'info', duration = 2500) {
    const host = getHost();
    const el = document.createElement('div');
    el.className = `fw-toast fw-toast-${kind}`;
    el.textContent = message;
    host.appendChild(el);

    // 触发进入动画
    requestAnimationFrame(() => el.classList.add('show'));

    setTimeout(() => {
        el.classList.remove('show');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
        setTimeout(() => el.remove(), 400); // 兜底移除
    }, duration);
}

export const toastSuccess = (m) => toast(m, 'success');
export const toastError = (m) => toast(m, 'error');

/* ---------------- 命运女神「思考中」全局提示（引用计数，并行任务共用） ---------------- */

let thinkingCount = 0;
let thinkingEl = null;

export function showThinking(text = '✦ 命运女神思考中…') {
    thinkingCount += 1;
    if (!thinkingEl || !document.body.contains(thinkingEl)) {
        thinkingEl = document.createElement('div');
        thinkingEl.className = 'fw-thinking';
        thinkingEl.innerHTML = `<span class="fw-thinking-spinner"></span><span>${text}</span>`;
        document.body.appendChild(thinkingEl);
    }
}

export function hideThinking() {
    thinkingCount = Math.max(0, thinkingCount - 1);
    if (thinkingCount === 0 && thinkingEl) {
        thinkingEl.remove();
        thinkingEl = null;
    }
}

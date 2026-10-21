/**
 * 命运编织者 · Ananke — 覆盖式模态框 + 左侧导航骨架
 * 打开：/ananke；关闭：× / 遮罩 / ESC
 */
import { renderPanel } from './panels.js';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../settings.js';
import { resetStore } from '../store.js';
import { toastSuccess } from './toast.js';

const PANELS = [
    { id: 'outline', icon: '📖', label: '大纲&伏笔', short: '大纲' },
    { id: 'event', icon: '📍', label: '事件&阶段', short: '事件' },
    { id: 'fate', icon: '🎲', label: '命运之轮', short: '命运' },
    { id: 'config', icon: '⚙️', label: '提示词&API', short: '配置' },
    { id: 'log', icon: '📜', label: '日志', short: '日志' },
];

let modalEl = null;
let activePanel = 'outline';

export function openModal() {
    if (modalEl && document.body.contains(modalEl)) {
        modalEl.remove();
    }
    modalEl = buildModal();
    document.body.appendChild(modalEl);
    switchPanel('outline'); // 默认面板一
    document.addEventListener('keydown', onKeydown);
}

export function closeModal() {
    if (modalEl) {
        modalEl.remove();
        modalEl = null;
    }
    document.removeEventListener('keydown', onKeydown);
}

export function isOpen() {
    return !!modalEl && document.body.contains(modalEl);
}

/** 刷新当前激活面板（供外部数据变化后调用；配置面板不自动刷新，避免打断编辑） */
export function refreshActivePanel() {
    if (modalEl && activePanel !== 'config') switchPanel(activePanel);
}

function onKeydown(e) {
    if (e.key === 'Escape') closeModal();
}

function buildModal() {
    const overlay = document.createElement('div');
    overlay.className = 'fw-overlay';
    overlay.innerHTML = `
        <div class="fw-modal" role="dialog" aria-label="命运编织者">
            <div class="fw-header">
                <div class="fw-title-row">
                    <span class="fw-title">命运编织者</span>
                    <span class="fw-version">v${DEFAULT_SETTINGS.version}</span>
                    <div class="fw-header-actions">
                        <button class="fw-btn fw-btn-mini" id="fw-toggle-enabled" title="激活/关闭插件">⚡ 运行中</button>
                        <button class="fw-btn fw-btn-mini fw-btn-danger" id="fw-reset-chat" title="重置当前聊天插件数据">重置数据</button>
                        <button class="fw-close" title="关闭">×</button>
                    </div>
                </div>
            </div>
            <div class="fw-body">
                <div class="fw-content"></div>
            </div>
            <div class="fw-tabbar">
                ${PANELS.map(p => `<button class="fw-tab" data-panel="${p.id}" title="${p.label}"><span class="fw-tab-icon">${p.icon}</span><span class="fw-tab-label">${p.short}</span></button>`).join('')}
            </div>
        </div>
    `;

    overlay.querySelector('.fw-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    overlay.querySelectorAll('.fw-tab').forEach((btn) => {
        btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
    });

    // 激活 / 关闭（全局总开关）
    const toggleBtn = overlay.querySelector('#fw-toggle-enabled');
    const syncToggle = () => {
        const on = getSettings().enabled !== false;
        toggleBtn.textContent = on ? '⚡ 运行中' : '⏸ 已关闭';
        toggleBtn.classList.toggle('fw-btn-danger', !on);
    };
    if (toggleBtn) {
        syncToggle();
        toggleBtn.addEventListener('click', () => {
            const s = getSettings();
            s.enabled = s.enabled === false; // 关闭中→开启；开启中→关闭
            saveSettings();
            syncToggle();
            toastSuccess(s.enabled === false ? '⏸ 插件已关闭' : '⚡ 插件已激活');
        });
    }

    // 重置当前聊天插件数据
    const resetBtn = overlay.querySelector('#fw-reset-chat');
    if (resetBtn) resetBtn.addEventListener('click', () => {
        if (!confirm('确定要重置当前聊天的所有插件数据吗？\n（大纲、摘要、任务链、地图、伏笔、命运牌、日志等全部清空，不可撤销）')) return;
        resetStore();
        toastSuccess('✅ 已重置当前聊天插件数据');
        switchPanel(activePanel);
    });

    return overlay;
}

function switchPanel(panelId) {
    activePanel = panelId;
    if (!modalEl) return;
    modalEl.querySelectorAll('.fw-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.panel === panelId);
    });
    const content = modalEl.querySelector('.fw-content');
    content.innerHTML = '';
    renderPanel(panelId, content);
}

/* ---------------- 打开入口：魔杖菜单 + 悬浮球 ---------------- */

const STAR_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2 L14 9 L21 12 L14 15 L12 22 L10 15 L3 12 L10 9 Z"/></svg>`;

/** 注入魔杖菜单入口（点击聊天框左侧魔术棒 → 选择「命运编织者」） */
export function injectWandEntry() {
    const html = `
        <div id="fw_open_wand" class="list-group-item flex-container flexGap5" title="打开命运编织者">
            <div class="fw-wand-icon">${STAR_SVG}</div>
            <span>命运编织者</span>
        </div>`;

    function mount() {
        const c = document.getElementById('extensionsMenu')
            || document.getElementById('sp_wand_container')
            || document.getElementById('WandMenu')
            || document.getElementById('wand_drawer');
        if (!c || document.getElementById('fw_open_wand')) return false;
        c.insertAdjacentHTML('beforeend', html);
        document.getElementById('fw_open_wand')?.addEventListener('click', () => openModal());
        return true;
    }

    if (!mount()) {
        // 容器尚未渲染 → 用 MutationObserver 等它出现（参考「构画」做法）
        const obs = new MutationObserver(() => { if (mount()) obs.disconnect(); });
        obs.observe(document.body, { childList: true, subtree: true });
    }
}

/** 注入悬浮球（可拖动；拖到角落自动半藏，点按开合面板） */
export function injectFab() {
    if (document.getElementById('fw-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'fw-fab';
    fab.innerHTML = `<button class="fw-fab-btn" title="命运编织者">${STAR_SVG}</button>`;
    document.body.appendChild(fab);
    const btn = fab.querySelector('.fw-fab-btn');

    const SIZE = 46;
    const place = (x, y) => {
        fab.style.left = `${x}px`;
        fab.style.top = `${y}px`;
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
    };
    // 初始：右下角
    place(window.innerWidth - SIZE - 18, window.innerHeight - SIZE - 88);

    let dragged = false;
    btn.addEventListener('click', () => {
        if (dragged) { dragged = false; return; }
        if (isOpen()) closeModal();
        else openModal();
    });

    let sx = 0, sy = 0, ox = 0, oy = 0, moving = false;
    const start = (e) => {
        moving = true; dragged = false;
        sx = e.touches ? e.touches[0].clientX : e.clientX;
        sy = e.touches ? e.touches[0].clientY : e.clientY;
        const r = fab.getBoundingClientRect();
        ox = r.left; oy = r.top;
        fab.classList.remove('fw-fab-hidden');
    };
    const move = (e) => {
        if (!moving) return;
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        if (Math.abs(cx - sx) > 3 || Math.abs(cy - sy) > 3) dragged = true;
        place(ox + cx - sx, oy + cy - sy);
    };
    const snap = () => {
        const r = fab.getBoundingClientRect();
        const m = 64, hide = 0.72;
        const nearL = r.left < m, nearR = r.right > window.innerWidth - m;
        const nearT = r.top < m, nearB = r.bottom > window.innerHeight - m;
        if (!nearL && !nearR && !nearT && !nearB) { fab.classList.remove('fw-fab-hidden'); return; }
        let x = r.left, y = r.top;
        if (nearL) x = -r.width * hide; else if (nearR) x = window.innerWidth - r.width * (1 - hide);
        if (nearT) y = -r.height * hide; else if (nearB) y = window.innerHeight - r.height * (1 - hide);
        fab.style.transition = 'left .2s ease, top .2s ease';
        place(x, y);
        setTimeout(() => { fab.style.transition = 'none'; }, 220);
        fab.classList.add('fw-fab-hidden');
    };
    const end = () => { if (moving) { moving = false; snap(); } };

    fab.addEventListener('mousedown', (e) => { e.preventDefault(); start(e); });
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    fab.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
}

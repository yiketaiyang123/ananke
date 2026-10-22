/**
 * 命运编织者 · Ananke — SillyTavern 第三方扩展入口
 * 大世界剧情助手：自动编织任务链 / 伏笔 / 命运牌。
 *
 * 前置拦截（参考 shujuku）：GENERATION_AFTER_COMMANDS 的 async 回调里
 * await 剧情 AI，结果写回 params.prompt，实现「没注入就不发主 AI」。
 */
import { ensureDefaultSettings, DEFAULT_SETTINGS } from './src/settings.js';
import { logInfo } from './src/logger.js';
import { openModal, isOpen, refreshActivePanel, injectWandEntry, injectFab } from './src/ui/modal.js';
import { initScheduler, onTaskDone } from './src/scheduler.js';
import { getEventSource, getEventTypes, getRegisterSlashCommand } from './src/runtime.js';

// 版本号从 settings 读取，避免与 manifest/settings 不一致（原先硬编码导致日志一直显示旧版本）
const VERSION = DEFAULT_SETTINGS.version;
const MODULE_NAME = '命运编织者 · Ananke';

function init() {
    ensureDefaultSettings();

    initScheduler();

    // 任务完成后，若面板打开则自动刷新
    onTaskDone(() => {
        if (isOpen()) refreshActivePanel();
    });

    // 打开方式 1：魔杖菜单入口 + 悬浮球（点击进入）
    try { injectWandEntry(); } catch (e) { console.warn('[Ananke] 注入魔杖入口失败', e); }
    try { injectFab(); } catch (e) { console.warn('[Ananke] 注入悬浮球失败', e); }

    // 打开方式 2：/ananke 命令（若壳里可用）
    const registerSlashCommand = getRegisterSlashCommand();
    if (typeof registerSlashCommand === 'function') {
        try {
            registerSlashCommand('ananke', () => openModal(), [], `打开「${MODULE_NAME}」面板`, true, true);
        } catch (e) {
            console.warn('[Ananke] 注册 /ananke 命令失败', e);
        }
    }

    logInfo('system', `🔧 ${MODULE_NAME} 初始化完成 v${VERSION}`);
    console.log(`[${MODULE_NAME}] 已加载 v${VERSION}`);
}

// 初始化：APP_READY + 轮询兜底 + 幂等（交底文档§3）
let done = false;
const fire = () => {
    if (done) return;
    done = true;
    try {
        init();
    } catch (e) {
        console.warn('[Ananke] 初始化失败', e);
    }
};

const es = getEventSource();
const et = getEventTypes();
if (es && et && et.APP_READY && typeof es.on === 'function') {
    es.on(et.APP_READY, fire);
}

const t0 = Date.now();
const iv = setInterval(() => {
    const ok = !!(window.extension_settings || window.SillyTavern);
    if (ok || Date.now() - t0 > 3500) {
        clearInterval(iv);
        fire();
    }
}, 250);

/**
 * 运行时取值层 —— 直接 import ST 核心（正确路径，参考「构画」插件）。
 * getContext 来自 extensions.js：完整 ctx（characters / loadWorldInfo / chatMetadata / saveChat / getRequestHeaders）。
 * 事件与保存来自 script.js。
 *
 * 路径：本文件在 extensions/third-party/<name>/src/ 下，
 *   extensions.js 在 scripts/ 下（4 个 ..），script.js 在 public/ 根（5 个 ..）。
 */
import { getContext, extension_settings } from '../../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../../script.js';

export function getContextObject() {
    return getContext();
}

export function getEventSource() {
    return eventSource;
}

export function getEventTypes() {
    return event_types;
}

export function getExtensionSettings() {
    return extension_settings;
}

export function saveSettingsPersist() {
    saveSettingsDebounced();
}

/** 当前聊天 metadata */
export function getChatMetadata() {
    try { return getContext()?.chatMetadata || null; } catch { return null; }
}

/** 当前聊天消息数组 */
export function getChat() {
    try { return getContext()?.chat || []; } catch { return []; }
}

/** 保存聊天级数据（交底文档§8 优先级，不 break，让所有可用方法都执行） */
export function saveChatPersist() {
    const ctx = getContext();
    try { if (ctx && typeof ctx.saveChat === 'function') ctx.saveChat(); } catch { /* ignore */ }
    try { if (typeof window.saveChatConditional === 'function') window.saveChatConditional(); } catch { /* ignore */ }
    try { if (typeof window.saveChat === 'function') window.saveChat(); } catch { /* ignore */ }
}

/** 注册 slash 命令函数（Tauri 壳可能没有，用 window 兜底） */
export function getRegisterSlashCommand() {
    try { return window.registerSlashCommand || null; } catch { return null; }
}

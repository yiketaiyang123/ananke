/**
 * 命运编织者 · Ananke — 全局配置
 * 存于 extension_settings['fate-weaver']，跨聊天共享。
 */
import { getExtensionSettings, saveSettingsPersist } from './runtime.js';
import { TASK1_DEFAULT_PROMPTS } from '../prompts/task1-outline.js';
import { TASK1_5_DEFAULT_PROMPTS } from '../prompts/task1_5-world.js';
import { TASK2_DEFAULT_PROMPTS } from '../prompts/task2-engine.js';
import { TASK2_5_DEFAULT_PROMPTS } from '../prompts/task2_5-map.js';
import { TASK3_DEFAULT_PROMPTS } from '../prompts/task3-fate.js';
import { TASK4_DEFAULT_PROMPTS } from '../prompts/task4-mission.js';

export const SETTINGS_KEY = 'fate-weaver';

/** 默认「最终注入指令」模板：$8 = 用户本轮输入（被 <本轮用户输入> 包裹，供美化匹配与区分主AI）；模板无 $8 时拼装回退前置用户输入 */
export const DEFAULT_FINAL_DIRECTIVE = `以下是用户的本轮输入：
<本轮用户输入>
$8
</本轮用户输入>

以下内容不是用户输入，而是由辅助创作系统提供的创作建议和素材，必须纳入你的创作之中。请将其自然融入本轮剧情，不要照抄原文。`;

/** 上一版默认指令（v1.9.x，用于升级迁移识别旧值，自动更新为新版） */
export const PREV_FINAL_DIRECTIVE = `以下是用户的本轮输入：
<本轮用户输入>
$8
</本轮用户输入>

以下内容非用户输入，而是由外部剧情辅助系统基于当前上下文生成的剧情发展建议素材，包含相关记忆索引与情节走向参考。请将其作为本轮叙事的参考素材自然融入接下来的剧情中:`;

/** 旧默认指令（v1.6.0，无用户输入复述，仅用于升级迁移识别旧值） */
export const OLD_DEFAULT_FINAL_DIRECTIVE = `以下内容非用户输入，而是由外部剧情辅助系统基于当前上下文生成的剧情发展建议素材，包含相关记忆索引与情节走向参考。请将其作为本轮叙事的参考素材自然融入接下来的剧情中:`;

/** 默认排除标签（发送给剧情 AI 的前文剧情里，这些标签内容会被剔除） */
export const DEFAULT_EXCLUDE_TAGS = 'thought,img,image';

/** 默认任务模板
 *  extractTags：标签摘取——从 AI 输出摘取这些 <标签> 内容，注入到用户输入后方
 *  storeTags：标签写入——从 AI 输出摘取这些 <标签> 内容，写入储存
 */
function defaultTask(id, name, frequency, historyTurns, minReplyLength, order, extractTags, storeTags) {
    return {
        id,
        name,
        enabled: true,
        stage: 0,                 // 0 = 所有阶段
        frequency,                // 每 N 轮调用一次
        historyTurns,             // 携带最近 N 轮历史
        minReplyLength,           // 低于此长度自动重试（0 = 不检查）
        maxRetries: 3,
        extractTags: extractTags || '',   // 标签摘取（注入），逗号分隔
        storeTags: storeTags || 'store',  // 标签写入（储存），逗号分隔
        exclude_tags: DEFAULT_EXCLUDE_TAGS, // 排除标签（前文剧情剔除）
        order: order || 1,        // 调取顺序：同值并行、不同值按升序顺序
        prompt_blocks: [],        // 对话块数组 [{ role: 'system'|'user'|'assistant', content: '' }]
    };
}

export const DEFAULT_SETTINGS = {
    version: '1.9.7',
    global_api: { mode: 'inherit', url: '', key: '', model: '' },
    apiPresets: [],          // API 预设快照 [{id,name,url,key,model}]
    apiPresetActiveId: '',   // 当前选中的预设 id（UI 回显用）
    final_directive: DEFAULT_FINAL_DIRECTIVE, // 最终注入指令（全局，作用于整段注入）
    tasks: [
        defaultTask('task1_5', '1A 世界摘要', 0, 5, 200, 1, '', 'store'),
        defaultTask('task1', '1B 阶段规划', 20, 5, 200, 2, '', 'store'),
        defaultTask('task2', '2A 剧情引擎', 1, 10, 200, 3, 'supplement', 'store'),
        defaultTask('task4', '2B 任务链生成', 0, 6, 200, 4, '', 'store'),
        defaultTask('task2_5', '2C 地图生成', 0, 6, 200, 5, 'map_inject', 'store'),
        defaultTask('task3', '3 命运牌', 4, 6, 200, 6, 'fate_inject', 'store'),
    ],
};

// 填充默认提示词（顺序：1A 世界摘要 → 1B 阶段规划 → 2A 剧情引擎 → 2B 任务链生成 → 2C 地图生成 → 3 命运牌）
DEFAULT_SETTINGS.tasks[0].prompt_blocks = structuredClone(TASK1_5_DEFAULT_PROMPTS);
DEFAULT_SETTINGS.tasks[1].prompt_blocks = structuredClone(TASK1_DEFAULT_PROMPTS);
DEFAULT_SETTINGS.tasks[2].prompt_blocks = structuredClone(TASK2_DEFAULT_PROMPTS);
DEFAULT_SETTINGS.tasks[3].prompt_blocks = structuredClone(TASK4_DEFAULT_PROMPTS);
DEFAULT_SETTINGS.tasks[4].prompt_blocks = structuredClone(TASK2_5_DEFAULT_PROMPTS);
DEFAULT_SETTINGS.tasks[5].prompt_blocks = structuredClone(TASK3_DEFAULT_PROMPTS);

/** 供面板四「恢复默认提示词」使用 */
export const DEFAULT_PROMPTS = {
    task1: TASK1_DEFAULT_PROMPTS,
    task1_5: TASK1_5_DEFAULT_PROMPTS,
    task2: TASK2_DEFAULT_PROMPTS,
    task2_5: TASK2_5_DEFAULT_PROMPTS,
    task3: TASK3_DEFAULT_PROMPTS,
    task4: TASK4_DEFAULT_PROMPTS,
};

/** 读取当前设置对象（引用，直接改再 saveSettings 即可持久化） */
export function getSettings() {
    return getExtensionSettings()[SETTINGS_KEY];
}

/** 首次加载时初始化默认设置 */
export function ensureDefaultSettings() {
    const es = getExtensionSettings();
    if (!es[SETTINGS_KEY]) {
        es[SETTINGS_KEY] = structuredClone(DEFAULT_SETTINGS);
        saveSettingsPersist();
    }
    // 兼容性：补齐缺失的顶层字段
    const s = es[SETTINGS_KEY];
    if (!Array.isArray(s.tasks)) s.tasks = structuredClone(DEFAULT_SETTINGS.tasks);

    // 版本迁移：升级时，用默认任务表刷新提示词，并补齐新增字段（extractTags/storeTags/final_directive 等）
    if (s.version !== DEFAULT_SETTINGS.version) {
        for (const def of DEFAULT_SETTINGS.tasks) {
            const idx = s.tasks.findIndex((t) => t.id === def.id);
            if (idx >= 0) {
                const old = s.tasks[idx];
                // 只补齐「缺失」字段（undefined），保留用户已自定义的 enabled/name/frequency 等
                for (const k of Object.keys(def)) {
                    if (old[k] === undefined) old[k] = structuredClone(def[k]);
                }
                old.prompt_blocks = structuredClone(def.prompt_blocks);
            } else {
                s.tasks.push(structuredClone(def));
            }
        }
        // 标准命名重排 + 同步名称/顺序（1A 世界摘要 → 1B 阶段规划 → 2A 剧情引擎 → 2B 任务链生成 → 2C 地图生成 → 3 命运牌）
        const STANDARD_ORDER = ['task1_5', 'task1', 'task2', 'task4', 'task2_5', 'task3'];
        for (const def of DEFAULT_SETTINGS.tasks) {
            const t = s.tasks.find((x) => x.id === def.id);
            if (t) { t.name = def.name; t.order = def.order; }
        }
        s.tasks.sort((a, b) => {
            const ai = STANDARD_ORDER.indexOf(a.id);
            const bi = STANDARD_ORDER.indexOf(b.id);
            if (ai >= 0 && bi >= 0) return ai - bi;
            if (ai >= 0) return -1;
            if (bi >= 0) return 1;
            return 0;
        });
        s.version = DEFAULT_SETTINGS.version;
        saveSettingsPersist();
    }

    // 迁移：最终注入指令从「每任务」提升为「全局」（幂等，基于字段是否存在）
    if (s.final_directive === undefined) {
        const t2 = s.tasks.find((t) => t.id === 'task2');
        const old = t2?.final_directive;
        s.final_directive = (old && old !== OLD_DEFAULT_FINAL_DIRECTIVE) ? old : DEFAULT_FINAL_DIRECTIVE;
    } else if (s.final_directive === OLD_DEFAULT_FINAL_DIRECTIVE || s.final_directive === PREV_FINAL_DIRECTIVE) {
        s.final_directive = DEFAULT_FINAL_DIRECTIVE;
    }
    for (const t of s.tasks) {
        if (t.final_directive !== undefined) delete t.final_directive;
    }

    if (!s.global_api) s.global_api = structuredClone(DEFAULT_SETTINGS.global_api);
    if (!s.apiPresets) s.apiPresets = [];
    return s;
}

/** 持久化全局设置（防抖） */
export function saveSettings() {
    saveSettingsPersist();
}

/** 深拷贝当前设置（供导出/备份） */
export function cloneSettings() {
    return structuredClone(getExtensionSettings()[SETTINGS_KEY]);
}

/* ---------------- API 预设管理 ---------------- */

export function loadApiPresets() {
    const arr = getSettings().apiPresets;
    return Array.isArray(arr) ? arr : [];
}

export function genPresetId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 新增/更新一个 API 预设（快照当前 url/key/model） */
export function upsertApiPreset(name, cfg, id) {
    const s = getSettings();
    const list = loadApiPresets();
    const snap = {
        name: String(name || '').trim() || '未命名',
        url: cfg?.url || '',
        key: cfg?.key || '',
        model: cfg?.model || '',
    };
    const existing = id ? list.find((p) => p.id === id) : null;
    if (existing) {
        Object.assign(existing, snap);
        s.apiPresetActiveId = existing.id;
        saveSettings();
        return existing.id;
    }
    snap.id = genPresetId();
    list.push(snap);
    s.apiPresets = list;
    s.apiPresetActiveId = snap.id;
    saveSettings();
    return snap.id;
}

export function deleteApiPreset(id) {
    const s = getSettings();
    s.apiPresets = loadApiPresets().filter((p) => p.id !== id);
    if (s.apiPresetActiveId === id) s.apiPresetActiveId = '';
    saveSettings();
}

/** 应用预设：把预设的 url/key/model 填回 global_api（当前生效） */
export function applyApiPreset(id) {
    const p = loadApiPresets().find((x) => x.id === id);
    if (!p) return false;
    const s = getSettings();
    s.global_api = { mode: 'inherit', url: p.url || '', key: p.key || '', model: p.model || '' };
    s.apiPresetActiveId = id;
    saveSettings();
    return true;
}

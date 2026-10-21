/**
 * 命运编织者 · Ananke — 聊天级状态（结构化 v2）
 * 存于 chatMetadata.extensions['fate-weaver']，随当前聊天保存。
 *
 * 设计：每个重对象（outline/task_chain/map）同时存「结构化关键字段」+「raw 原文」。
 *   - raw：喂给 AI（原文，AI 最熟悉）
 *   - 结构化字段：供插件维护状态（currentNode/当前位置）与面板渲染
 */
import { getChatMetadata, saveChatPersist } from './runtime.js';

export const STORE_KEY = 'fate-weaver';

export const CARD_NAMES = ['背叛', '贪婪', '嫉妒', '邂逅', '幸运', '恩赐', '因果'];

function defaultCardStatus() {
    const o = {};
    for (const name of CARD_NAMES) {
        o[name] = { status: 'available', cooldownLeft: 0 };
    }
    return o;
}

function defaultStore() {
    return {
        round: 0,                 // 对话轮次（回合数，从楼层推导）
        current_stage: 1,         // 当前阶段编号
        角色等级: 1,               // 主角当前等级（Task2 S3 的「主角当前：Lv X」解析）

        // Task 1 产出：大纲（结构化 + raw）
        outline: null,            // { raw, worldName, stages: [{num,title,levelRange,...}] }

        // Task 1.5 产出：世界观全景摘要（原文 + 结构化）
        world_summary: '',        // 世界观全景摘要完整原文
        world_summary_parsed: null, // 结构化：{worldName, overview, powerSystem, conflicts, index}

        // Task 4 产出：任务链（结构化 + raw）
        task_chain: null,         // { raw, id, name, status, currentNode }
        last_result: null,        // 上一任务完成信息 { name, 结局, 即时后果 }（S4 写入，冷却期面板显示）

        // 2A 发出、待本轮主 AI 回复后再执行的调度信号（延后生成，衔接更自然）
        // [{ type: 'MISSION_GEN'|'MAP_GEN', params: {...} }]，由 onGenerationEnded 消费
        pending_signals: [],

        // Task 2.5 产出：封闭地图（结构化 + raw）
        map: null,                // { raw, type: 'closed', name, 当前位置 }（进入后长期保留，供玩家返回时读取）

        // Task 2 每轮产出：当前开放场景（M2）；scene_type 决定面板二显示开放场景还是封闭地图
        open_scene: null,         // { raw, name }
        scene_type: 'open',       // 'open' = 开放场景(M2) / 'closed' = 封闭地图

        // Task 2 每轮维护的动态状态（冷却结束游戏日：任务链完成时由插件写入，用于自动递减冷却）
        clock: { gameDay: 1, 历法日期: '', 节拍: '铺垫', 冷却剩余: 0 },
        foreshadowing: [],        // [{ code, name, 阶段, 剩余时间, 状态 }]

        // 主角状态快照（Task 2 Step 1.5 从正文提取，插件解析维护）
        player_status: null,      // { 时间, 位置, 等级, 物品, 财富, 伤势, 声望 }
        // 已触发的世界事件时间线条目（防重复触发）
        timeline_events: [],      // [事件描述]
        // 任务完成记录（供阶段转换条件「完成N条任务」核对）
        task_history: [],         // [{ name, 结局, 完成游戏日 }]

        // 手动追加的世界书（面板四选择；超出角色卡世界书的内容）
        manual_worldbooks: [],    // [世界书名，与 ST 世界书文件同名]

        // Task 3 产出
        card_status: defaultCardStatus(),
        fate_history: [],         // [{round, card, strength, declaration, summary, causality}]
        fate_stats: { total: 0, ripple: 0, wave: 0, storm: 0, pos: 0, neg: 0, recent: [] },

        // 调试：各任务最近一次发送/接收（按 task.id 分组）
        ai_trace: {},            // { [taskId]: { task, sent, received, time } }
    };
}

/** 读取当前聊天状态（引用；改后调用 saveStore 持久化） */
export function getStore() {
    const cm = getChatMetadata();
    if (!cm || typeof cm !== 'object') {
        return defaultStore(); // 极端情况兜底（不持久化）
    }
    if (!cm.extensions) cm.extensions = {};
    if (!cm.extensions[STORE_KEY]) {
        cm.extensions[STORE_KEY] = defaultStore();
    }
    // 兼容补字段
    const s = cm.extensions[STORE_KEY];
    if (!s.clock) s.clock = defaultStore().clock;
    if (s.clock && s.clock.历法日期 === undefined) s.clock.历法日期 = '';
    if (!Array.isArray(s.foreshadowing)) s.foreshadowing = [];
    if (!Array.isArray(s.manual_worldbooks)) s.manual_worldbooks = [];
    if (s.player_status === undefined) s.player_status = null;
    if (!Array.isArray(s.timeline_events)) s.timeline_events = [];
    if (!Array.isArray(s.task_history)) s.task_history = [];
    if (!s.card_status) s.card_status = defaultCardStatus();
    if (!Array.isArray(s.fate_history)) s.fate_history = [];
    if (!s.fate_stats) s.fate_stats = defaultStore().fate_stats;
    // ai_trace 兼容：旧格式 {task, sent, received} → 新格式 {[taskId]: {...}}
    if (!s.ai_trace || typeof s.ai_trace !== 'object' || typeof s.ai_trace.task === 'string') s.ai_trace = {};
    return s;
}

/** 持久化聊天级状态 */
export function saveStore() {
    saveChatPersist();
}

/** 重置当前聊天状态 */
export function resetStore() {
    const cm = getChatMetadata();
    if (cm && typeof cm === 'object') {
        if (!cm.extensions) cm.extensions = {};
        cm.extensions[STORE_KEY] = defaultStore();
        saveStore();
    }
}

/* ---------------- 序列化辅助（生成喂给 AI 的文本） ---------------- */

/** 任务链 → 喂 AI 的完整文本（有 raw 用 raw；始终附带「冷却剩余」，供 Task2A 分支B 判定冷却是否结束） */
export function serializeTaskChain(store) {
    const tc = store.task_chain;
    const cool = Math.max(0, Number(store.clock?.冷却剩余) || 0);
    let body;
    if (!tc) {
        body = '任务状态：无活跃任务';
    } else if (tc.raw) {
        body = tc.raw;
    } else {
        const parts = [`[任务链 #${tc.id ?? '?'}] ${tc.name || ''}`, `状态：${tc.status || '?'}`];
        if (tc.currentNode) parts.push(`当前节点：${tc.currentNode}`);
        body = parts.join('\n');
    }
    // 冷却必须随「任务链数据」一起下发：无活跃任务时块内只有这一处能读到冷却
    return `${body}\n冷却剩余：${cool}游戏日`;
}

/** 地图 → 喂 AI 的完整文本 */
export function serializeMap(store) {
    const m = store.map;
    if (!m) return '(暂无地图)';
    if (m.raw) return m.raw;
    return `【地图·${m.name || '?'}】当前位置：${m.当前位置 || '?'}`;
}

/** 大纲当前阶段 → 喂 AI 的文本（只当前阶段，不读全部大纲） */
export function serializeOutlineCurrentStage(store) {
    const o = store.outline;
    if (!o) return '(尚未生成大纲)';
    const stage = o.stages?.find((s) => s.num === store.current_stage);
    if (stage) {
        const parts = [`第${stage.num}阶段 · ${stage.title}`, `等级区间：${stage.levelRange || ''}`];
        for (const key of ['核心矛盾', '副体系对照', '核心叙事主题', '地理活动范围', '可交互势力', 'NPC交互层级', '推荐投放资源', '推荐投放事件', '投放禁令', '矛盾线索许可', '阶段转换触发条件', '阶段串联事件', '事件推荐部署地图']) {
            if (stage[key]) parts.push(`▪ ${key}\n${stage[key]}`);
        }
        return parts.join('\n');
    }
    return String(o.raw || '').slice(0, 2000);
}

/** 伏笔队列 → 喂 AI 的文本 */
export function serializeForeshadowing(store) {
    const list = store.foreshadowing || [];
    if (!list.length) return '(伏笔队列为空)';
    return list.map((f) => `- ${f.name}：阶段${f.阶段 ?? '?'}，剩余${f.剩余时间 ?? '?'}，${f.状态 || ''}`).join('\n');
}

/** clock → 喂 AI 的文本（字段名对齐 Task2 提示词的格式定义） */
export function serializeClock(store) {
    const c = store.clock || {};
    return [
        `游戏日：第${c.gameDay ?? 1}天`,
        `历法日期：${c.历法日期 || '未初始化（由织机开局从经线纪元推导）'}`,
        `上轮节拍：${c.节拍 ?? '铺垫'}`,
        `冷却剩余：${c.冷却剩余 ?? 0}游戏日`,
    ].join('\n');
}

/** 任务链摘要 → 喂 Task 3 的文本（轻量） */
export function serializeTaskChainSummary(store) {
    const tc = store.task_chain;
    if (!tc) return '无活跃任务链';
    return `#${tc.id ?? '?'} ${tc.name || ''} | 状态：${tc.status || '?'} | 当前节点：${tc.currentNode || '?'}`;
}

/* ---------------- 楼层回退快照 ---------------- */

const HISTORY_KEY = 'fate-weaver-history';

/** 读取历史快照（独立于 store，回退时不会被一起回退） */
export function getHistory() {
    const cm = getChatMetadata();
    if (!cm || typeof cm !== 'object') return [];
    return Array.isArray(cm.extensions?.[HISTORY_KEY]) ? cm.extensions[HISTORY_KEY] : [];
}

/** 保存历史快照（最多 10 层） */
export function saveHistory(history) {
    const cm = getChatMetadata();
    if (!cm || typeof cm !== 'object') return;
    if (!cm.extensions) cm.extensions = {};
    cm.extensions[HISTORY_KEY] = history;
    saveChatPersist();
}

/** 当前 store 深拷贝快照（剔除调试 ai_trace） */
export function snapshotStore() {
    const snap = structuredClone(getStore());
    if (snap) delete snap.ai_trace;
    return snap;
}

/** 用快照覆盖当前 store（楼层回退时调用） */
export function restoreStore(snapshot) {
    const cm = getChatMetadata();
    if (!cm || typeof cm !== 'object') return;
    if (!cm.extensions) cm.extensions = {};
    cm.extensions[STORE_KEY] = structuredClone(snapshot);
    saveChatPersist();
}

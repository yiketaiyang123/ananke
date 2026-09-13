/**
 * 命运编织者 · Ananke — 提示词组装 + 占位符替换
 * buildLore 异步读取角色卡 + 世界书（ctx.loadWorldInfo 活状态，内嵌 character_book 兜底）。
 */
import { getChat, getContextObject } from './runtime.js';
import {
    getStore,
    serializeTaskChain,
    serializeMap,
    serializeOutlineCurrentStage,
    serializeForeshadowing,
    serializeClock,
    serializeTaskChainSummary,
} from './store.js';

/** 本轮捕获的当前用户输入（由 scheduler 在 interceptAndPlan 时注入；优先于 chat 历史 lastUserMessage） */
let activeUserInput = '';
export function setUserInput(v) { activeUserInput = String(v ?? ''); }

/** 最近一条用户消息 */
function lastUserMessage() {
    const chat = getChat();
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user) return String(chat[i].mes ?? '');
    }
    return '';
}

/** 最近 N 轮对话历史（角色名：内容） */
/** 剔除正文里指定的标签内容（思维链/图片等） */
function stripExcludedTags(text, excludeTags) {
    if (!excludeTags) return text;
    const tags = String(excludeTags).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    let out = String(text ?? '');
    for (const tag of tags) {
        try {
            out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
            out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
        } catch { /* 非法标签名忽略 */ }
    }
    return out;
}

function buildChatHistory(n, excludeTags) {
    n = Number(n) || 6;
    const chat = getChat();
    return chat.slice(-n)
        .map((m) => {
            const name = m?.is_user ? (m.name || '用户') : (m.name || '角色');
            return `${name}：${stripExcludedTags(m.mes, excludeTags)}`;
        })
        .join('\n');
}

/** 读取角色卡链接的世界书 + 手动追加的世界书 + 内嵌世界书条目（异步，活状态） */
async function buildWorldInfoText(ctx) {
    const char = ctx?.characters?.[ctx?.characterId] ?? {};
    const names = [];
    const primary = String(char.data?.extensions?.world || '').trim();
    if (primary) names.push(primary);
    // 手动追加的世界书（面板四选择，超出角色卡世界书的内容）
    for (const n of (getStore().manual_worldbooks || [])) {
        const name = String(n || '').trim();
        if (name && !names.includes(name)) names.push(name);
    }

    const entries = [];
    const seen = new Set();
    const pushEntry = (title, content) => {
        const key = `${title}\u0000${content || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push(`${title}：${content || ''}`);
    };

    // 1. 外链世界书（经 ctx.loadWorldInfo 读活状态，非角色卡里的陈旧快照）
    for (const name of names) {
        try {
            if (typeof ctx?.loadWorldInfo !== 'function') break;
            const data = await ctx.loadWorldInfo(name);
            if (!data?.entries) continue;
            for (const [uid, e] of Object.entries(data.entries)) {
                if (e?.disable) continue;
                const title = e.comment || (Array.isArray(e.key) ? e.key.join(',') : '') || `条目${uid}`;
                pushEntry(title, e.content || '');
            }
        } catch { /* 单个书读取失败忽略 */ }
    }

    // 2. 内嵌世界书兜底（仅当外链书没读到任何条目时）
    if (entries.length === 0) {
        const charBook = char.data?.character_book;
        if (Array.isArray(charBook?.entries)) {
            for (const e of charBook.entries) {
                if (e?.disabled) continue;
                const title = e.comment || (Array.isArray(e.key) ? e.key.join(',') : '') || '';
                pushEntry(title, e.content || '');
            }
        }
    }

    return entries.join('\n');
}

/** 用户/主角基础设定（persona） */
function buildUserPersona(ctx) {
    try {
        const pu = ctx?.powerUserSettings || {};
        return pu.persona_description || pu.persona || '';
    } catch { return ''; }
}

/** 角色卡文本 */
function buildCharacterCard(ctx) {
    try {
        const chara = ctx?.characters?.[ctx?.characterId];
        if (!chara) return '';
        const desc = chara.description || chara.data?.description || '';
        return `名称：${chara.name}\n描述：${desc}`;
    } catch { return ''; }
}

/** 背景设定：用户设定 + 角色卡 + 世界书（对应相似插件的 $U / $C / $1） */
async function buildLore() {
    const ctx = getContextObject();
    const parts = [];
    try {
        const persona = buildUserPersona(ctx);
        if (persona) parts.push(`【用户/主角设定】\n${persona}`);
    } catch { /* ignore */ }
    try {
        const chara = buildCharacterCard(ctx);
        if (chara) parts.push(`【角色卡】\n${chara}`);
    } catch { /* ignore */ }
    try {
        const wiText = await buildWorldInfoText(ctx);
        if (wiText) parts.push(`【世界书】\n${wiText}`);
    } catch { /* ignore */ }
    return parts.join('\n\n');
}

/** 前文剧情：仅历史 AI 输出，不含用户输入（对应相似插件的 $7），并剔除排除标签 */
function buildAiHistory(n, excludeTags) {
    const chat = getChat();
    return chat.slice(-(n * 2))
        .filter((m) => m && !m.is_user)
        .slice(-n)
        .map((m) => `${m.name || '角色'}：${stripExcludedTags(m.mes, excludeTags)}`)
        .join('\n');
}

/** 七张牌状态文本（匹配 Task3 提示词「数据格式定义」：上次使用轮次 / 上次出牌正负性 / 本阶段风暴次数） */
function cardStatusText() {
    const store = getStore();
    const cs = store.card_status;
    if (!cs) return '(无牌状态)';
    const hist = (store.fate_history || []).filter((e) => !e.silent);
    const lastByCard = {};
    for (const e of hist) if (e.card) lastByCard[e.card] = e.round;
    const lastEntry = hist[hist.length - 1];
    const stormThisStage = hist.filter((e) => e.strength?.includes('风暴') && e.stage === store.current_stage).length;
    return [
        '上次使用轮次：' + Object.keys(cs).map((name) => `${name}=${lastByCard[name] ? `第${lastByCard[name]}轮` : '未使用'}`).join(' | '),
        '上次出牌正负性：' + (lastEntry?.polarity || '无'),
        `本阶段风暴次数：${stormThisStage}`,
    ].join('\n');
}

/** 出牌历史文本（最近一次出牌，匹配 Task3 提示词「数据格式定义」；静默不计入） */
function fateHistoryText() {
    const h = (getStore().fate_history || []).filter((e) => !e.silent);
    if (!h.length) return '(尚无出牌记录)';
    const e = h[h.length - 1];
    return `牌面：${e.card}\n强度：${e.strength}\n轮次：第${e.round}轮\n干涉摘要：${e.summary || ''}`;
}

/** 主角当前状态（供 Task3 命运牌判断处境：阶段/时间/位置/等级/物品/财富/伤势/声望/任务进度） */
function buildPlayerStatus() {
    const store = getStore();
    const ps = store.player_status || {};
    const parts = [];
    parts.push(`当前阶段：第${store.current_stage || 1}阶段`);
    if (ps.时间) parts.push(`时间：${ps.时间}`);
    if (ps.位置) parts.push(`位置：${ps.位置}`);
    if (ps.等级) parts.push(`等级：${ps.等级}`);
    else parts.push(`等级：Lv ${store.角色等级 ?? 1}`);
    if (ps.物品) parts.push(`物品/装备：${ps.物品}`);
    if (ps.财富) parts.push(`财富：${ps.财富}`);
    if (ps.伤势) parts.push(`伤势/疲劳：${ps.伤势}`);
    if (ps.声望) parts.push(`声望：${ps.声望}`);
    parts.push(`游戏时间：第${store.clock?.gameDay ?? 1}游戏日 · 节拍：${store.clock?.节拍 || '铺垫'}`);
    if (store.task_chain) parts.push(`任务：${store.task_chain.name} · 事件${store.task_chain.currentNode || '?'}（${store.task_chain.status || '进行中'}）`);
    else parts.push('任务：无活跃任务（自由探索）');
    return parts.join('\n');
}

/** 已触发的世界事件时间线（供 Task2A Step 2.6 防重复触发） */
function timelineEventsText() {
    const list = getStore().timeline_events || [];
    if (!list.length) return '(尚未触发时间线事件)';
    return list.map((e) => `- ${e} [已触发]`).join('\n');
}

/** 任务完成记录（供 Task2A Step 6 核对「完成N条任务」等累计型阶段条件） */
function taskHistoryText() {
    const list = getStore().task_history || [];
    if (!list.length) return '(尚无任务完成记录)';
    return list.map((t) => `- ${t.name}（${t.结局 || '?'}）第${t.完成游戏日 ?? '?'}游戏日完成`).join('\n');
}

/** 收集所有占位符变量（异步：buildLore 需读世界书）；extraVars 供 Task4/2.5 的 mission_context/location_context */
async function collectVariables(task, extraVars = {}) {
    const store = getStore();
    const ctx = getContextObject();
    const excludeTags = task?.exclude_tags || '';
    const vars = {
        '{{round}}': String(store.round),
        '{{game_time}}': `第${store.clock?.gameDay ?? 1}游戏日`,
        '{{current_stage}}': String(store.current_stage),
        '{{user_input}}': activeUserInput || lastUserMessage(),
        '{{chat_history}}': buildChatHistory(task?.historyTurns || 6, excludeTags),
        '{{ai_history}}': buildAiHistory(task?.historyTurns || 6, excludeTags),
        '{{user_persona}}': buildUserPersona(ctx),
        '{{character_card}}': buildCharacterCard(ctx),
        '{{world_info}}': await buildWorldInfoText(ctx),
        '{{lore}}': await buildLore(),
        '{{world_summary}}': store.world_summary || store.outline?.worldSummary || '(尚未生成世界观摘要)',
        '{{Task_1A_output}}': store.world_summary || store.outline?.worldSummary || '(尚未生成世界观摘要)',
        '{{outline}}': store.outline?.raw || '(尚未生成大纲)',
        '{{outline_current_stage}}': serializeOutlineCurrentStage(store),
        '{{task_chain}}': serializeTaskChain(store),
        '{{map}}': serializeMap(store),
        '{{foreshadowing}}': serializeForeshadowing(store),
        '{{clock}}': serializeClock(store),
        '{{task_chain_summary}}': serializeTaskChainSummary(store),
        '{{card_status}}': cardStatusText(),
        '{{fate_history}}': fateHistoryText(),
        '{{player_status}}': buildPlayerStatus(),
        '{{timeline_events}}': timelineEventsText(),
        '{{task_history}}': taskHistoryText(),
    };
    Object.assign(vars, extraVars);
    return vars;
}

/** 组装 messages 数组（system/user 分离，供 chatCompletion 使用）；extraVars 为额外占位符 */
export async function buildMessagesForTask(task, extraVars = {}) {
    const vars = await collectVariables(task, extraVars);
    return (task.prompt_blocks || []).map((b) => {
        let content = b.content || '';
        for (const [k, v] of Object.entries(vars)) {
            content = content.split(k).join(v);
        }
        return { role: b.role || 'user', content };
    });
}

/** 组装完整提示词（纯文本，调试用） */
export async function buildPromptForTask(task) {
    const vars = await collectVariables(task);
    const text = (task.prompt_blocks || []).map((b) => {
        let content = b.content || '';
        for (const [k, v] of Object.entries(vars)) {
            content = content.split(k).join(v);
        }
        return `[${(b.role || 'user').toUpperCase()}]\n${content}`;
    }).join('\n\n');
    return text;
}

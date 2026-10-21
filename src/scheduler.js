/**
 * 命运编织者 · Ananke — Task 调度引擎（v2，前置拦截 + 按需触发）
 *
 * 每轮：Task 2（调度核心，读完整任务链+地图）→ 解析增量字段 + 信号
 *   → 信号 MISSION_GEN 触发 Task 4（任务链生成）
 *   → 信号 MAP_GEN 触发 Task 2.5（地图生成）
 *   → Task 3 每 4 轮触发
 *   → 合并注入（supplement + hook_inject + map_inject + fate_inject）写回 params.prompt
 */
import { getEventSource, getEventTypes, getChat } from './runtime.js';
import { getStore, saveStore, getHistory, saveHistory, snapshotStore, restoreStore } from './store.js';
import { getSettings, DEFAULT_FINAL_DIRECTIVE } from './settings.js';
import { setRound, logInfo, logWarn, logError } from './logger.js';
import { quietGenerate } from './llm.js';
import { buildMessagesForTask, setUserInput } from './prompt-builder.js';
import { parseTask1Output, parseTask15Output, parseTask2Output, parseTask3Output, parseTask4Output, parseTask25Output, markerNum } from './parser.js';
import { showThinking, hideThinking, toast } from './ui/toast.js';

const CARD_COOLDOWN = 4;
const TASK_COOLDOWN = 3; // 任务链完成后的冷却（游戏日）；插件权威维护，不依赖 AI 自报
const TASK_INTERVAL = 1000; // 任务之间的发送间隔（毫秒），避免连续 API 调用限流报错
// 各任务温度：结构化输出（解析/调度/编剧/地图）用低温度稳定格式，减少漏标签；命运牌偏创作保持高温度
const TASK_TEMPERATURE = { task1: 0.4, task1_5: 0.4, task2: 0.4, task4: 0.4, task2_5: 0.4, task3: 0.9 };
// 任务友好名（用于重试提示，如「剧情引擎错误，正在重新生成…」）
const TASK_LABEL = {
    task1_5: '世界摘要',
    task1: '阶段规划',
    task2: '剧情引擎',
    task4: '任务链生成',
    task2_5: '地图生成',
    task3: '命运牌',
};
let running = false;
let processingSignals = false; // 延后生成（本轮回复后）防重入
let doneListener = null;
let lastInterceptText = '';
let lastInterceptAt = 0;
let rollbackTimer = null; // 楼层回退 debounce 定时器

/** 延时（任务间隔用） */
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** 把 {tag, content} 注入块包回原生标签（方案①：保留标签，正则据此匹配，标签名可自定义） */
function wrapInject(inj) {
    if (!inj || !inj.content) return '';
    return `<${inj.tag}>\n${inj.content}\n</${inj.tag}>`;
}

export function onTaskDone(cb) { doneListener = cb; }

export function initScheduler() {
    installTavernHelperHook();

    const eventSource = getEventSource();
    const event_types = getEventTypes();
    if (!eventSource || !event_types || typeof eventSource.on !== 'function') {
        console.warn('[Ananke] 事件系统不可用，调度未启用');
        return;
    }
    if (event_types.GENERATION_AFTER_COMMANDS) {
        eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
    }
    if (event_types.GENERATION_ENDED) {
        eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    }
    // 楼层回退：删除消息 / 切换消息时，回退 store 到对应轮次
    if (event_types.MESSAGE_DELETED) {
        eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);
    }
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    }

    // 兜底：MutationObserver 观察聊天区楼层变化（不依赖事件名，删除变短即回退）
    installChatObserver();
}

/** 兜底监听：观察 #chat 楼层数变化，变短（删除）即触发回退，不依赖 MESSAGE_DELETED 事件名 */
function installChatObserver() {
    let prevLen = getChat().length;
    const observer = new MutationObserver(() => {
        const len = getChat().length;
        if (len < prevLen) {
            if (rollbackTimer) clearTimeout(rollbackTimer);
            rollbackTimer = setTimeout(() => { rollbackTimer = null; checkRollback(); }, 250);
        }
        prevLen = len;
    });
    const tryObserve = () => {
        const el = document.getElementById('chat');
        if (el) { observer.observe(el, { childList: true }); return true; }
        return false;
    };
    if (!tryObserve()) {
        let tries = 0;
        const iv = setInterval(() => { if (tryObserve() || ++tries > 20) clearInterval(iv); }, 500);
    }
}

/** 手动触发（面板操作：重写大纲/手动出牌/手动生成任务链/地图） */
export function triggerTaskNow(taskId) {
    const task = getTaskById(taskId);
    if (!task) return false;
    const fn = {
        task1: runTask1, task1_5: runTask15, task2: runTask2, task3: runTask3, task4: runTask4, task2_5: runTask25,
    }[taskId];
    (async () => {
        try {
            if (fn) await fn(task);
            else await runGenericTask(task);
            if (doneListener) { try { doneListener(taskId); } catch {} }
        } catch (e) {
            logError(taskId, `❌ 手动触发失败：${e?.message || e}`, { raw: String(e?.stack || e) });
        }
    })();
    return true;
}

function getTaskById(id) {
    return getSettings().tasks.find((t) => t.id === id);
}

/* ---------------- 前置拦截 ---------------- */

function readTextarea() {
    try { return document.getElementById('send_textarea')?.value || ''; } catch { return ''; }
}

/** 写回 #send_textarea 输入框（对齐 shujuku setSendTextareaValue_ACU：改值 + 触发 input） */
function writeTextarea(text) {
    try {
        const ta = document.getElementById('send_textarea');
        if (!ta) return false;
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    } catch { return false; }
}

async function onBeforeGeneration(type, params, dryRun) {
    if (dryRun || params?._ananke_processed || running) return;
    if (type === 'regenerate' || type === 'impersonate' || type === 'quiet' || type === 'summary') return;
    if (!getSettings().enabled) return; // 插件总开关关闭

    // 用户输入：优先 chat 最后一条用户消息；否则读输入框 / params.prompt（正常发送时用户消息可能尚未进 chat）
    const chat = getChat();
    const lastMsg = (chat && chat.length) ? chat[chat.length - 1] : null;
    let userInput = '';
    let writeBackToChat = false;
    if (lastMsg && lastMsg.is_user) {
        userInput = String(lastMsg.mes || '').trim();
        writeBackToChat = true;
    } else {
        // 对齐 shujuku：输入框优先（用户原始输入），params.prompt 仅兜底（可能是预构建完整 prompt）
        userInput = String(readTextarea() || params?.prompt || '').trim();
    }
    if (!userInput) return;

    // 去重：同一文本刚被 TavernHelper.generate 钩子处理过，GENERATION_AFTER_COMMANDS 跳过（避免双重 round/调用）
    if (Date.now() - lastInterceptAt < 30000 && userInput === lastInterceptText) return;

    params._ananke_processed = true;
    const finalMessage = await interceptAndPlan(userInput);
    if (finalMessage) {
        if (params) params.prompt = finalMessage;
        if (writeBackToChat && lastMsg) {
            // 策略1：消息已在 chat → 改 chat 消息对象
            lastMsg.mes = finalMessage;
            try { getEventSource().emit(getEventTypes().MESSAGE_UPDATED, chat.length - 1); } catch { /* ignore */ }
        } else {
            // 策略2：消息在输入框（正常发送）→ 同步改写输入框，否则 ST 读输入框时注入被覆盖
            writeTextarea(finalMessage);
        }
    }
}

function installTavernHelperHook() {
    tryInstallTavernHelperHook();
    if (!window._ananke_th_hooked) {
        let tries = 0;
        const iv = setInterval(() => {
            if (window._ananke_th_hooked || tries++ > 20) { clearInterval(iv); return; }
            tryInstallTavernHelperHook();
        }, 500);
    }
}

function tryInstallTavernHelperHook() {
    const TH = window.TavernHelper;
    if (!TH || typeof TH.generate !== 'function' || window._ananke_th_hooked) return;
    window._ananke_th_hooked = true;
    const original = TH.generate;
    TH.generate = async function (...args) {
        const options = args[0] || {};
        if (options.quiet_prompt || options.automatic_trigger) return original.apply(this, args);
        if (!getSettings().enabled) return original.apply(this, args); // 插件总开关关闭
        // 用户输入：user_input → prompt → injects[0].content（对齐 shujuku：injects 存在时优先）
        let userInput = String(options.user_input || options.prompt || '').trim();
        if (options.injects && options.injects[0] && options.injects[0].content) {
            userInput = String(options.injects[0].content || '').trim();
        }
        if (userInput && !running) {
            const finalMessage = await interceptAndPlan(userInput);
            if (finalMessage) {
                if (options.injects && options.injects[0] && options.injects[0].content) options.injects[0].content = finalMessage;
                else if (options.prompt) options.prompt = finalMessage;
                else options.user_input = finalMessage;
                options._ananke_processed = true;
            }
        }
        return original.apply(this, args);
    };
    console.log('[Ananke] TavernHelper.generate 钩子已安装');
}

/* ---------------- 核心调度 ---------------- */

async function interceptAndPlan(userInput) {
    if (running) return null; // 防重入：hook 与 GENERATION_AFTER_COMMANDS 双路径只执行一次
    running = true;
    lastInterceptText = String(userInput ?? '');
    lastInterceptAt = Date.now();
    setUserInput(userInput); // 把本轮当前输入注入，使 {{user_input}} 优先用当前输入而非 chat 历史
    const store = getStore();
    // round 从楼层推导：回合 = 完整来回（1 用户 + 1 AI = 2 层），删除/重发/regenerate 自动跟随楼层
    store.round = Math.ceil((getChat().length || 0) / 2);
    setRound(store.round);
    syncTaskCooldown(store); // 任务链冷却随游戏日推进自动递减（在 Task2 读取时钟之前）
    store.ai_trace = {};
    saveStore();

    showThinking();
    try {
        const injectParts = [];

        // 0. Task 1.5（经线·世界观摘要）+ Task 1（纬线·大纲）。纬线依赖经线输出，故先经线后纬线。
        if (!store.world_summary) {
            const task15 = getTaskById('task1_5');
            if (task15 && task15.enabled) {
                try {
                    await runTask15(task15);
                } catch (e) {
                    logError('task1_5', `❌ 世界观摘要生成失败：${e?.message || e}`);
                }
                await sleep(TASK_INTERVAL);
            }
        }
        if (!store.outline) {
            const task1 = getTaskById('task1');
            if (task1 && task1.enabled) {
                try {
                    await runTask1(task1);
                } catch (e) {
                    logError('task1', `❌ 大纲生成失败：${e?.message || e}`);
                }
                await sleep(TASK_INTERVAL);
            }
        }

        // 1. Task 2（调度核心；默认每轮，按 task2.frequency 调节；失败不阻断主 AI，但记录错误）
        const task2 = getTaskById('task2');
        if (task2 && task2.enabled && store.round % (Number(task2.frequency) || 1) === 0) {
            let r = null;
            try {
                r = await runTask2(task2);
            } catch (e) {
                logError('task2', `❌ 剧情引擎失败：${e?.message || e}`);
            }
            if (r) {
                applyIncrementalFields(store, r);
                if (r.stageChange && r.targetStage) { store.current_stage = r.targetStage; saveStore(); }

                // 2-场景：判定当前场景类型并更新「当前场景」
                //   · 封闭地图（MAP_GEN 信号 / supplement 含「◇ 地图·」板块）优先
                //   · 开放场景（M2 子节 / supplement 含「◇ 当前位置」）→ 每轮覆盖 store.open_scene
                //   封闭地图存于 store.map 长期保留，开放场景存于 store.open_scene 每轮刷新
                const suppContent = (r.injects || []).map((i) => i.content).join('\n');
                const hasMapSignal = (r.signals || []).some((s) => s.type === 'MAP_GEN');
                const closedNow = hasMapSignal || /◇\s*地图[·.·]/.test(suppContent);
                if (closedNow) {
                    store.scene_type = 'closed';
                    saveStore();
                } else if (r.openScene || /◇\s*当前位置/.test(suppContent)) {
                    const posM = suppContent.match(/◇\s*当前位置\s*\n([^\n]+)/);
                    store.open_scene = r.openScene
                        ? { raw: r.openScene.raw, name: r.openScene.name }
                        : { raw: suppContent, name: posM ? posM[1].trim() : '' };
                    store.scene_type = 'open';
                    saveStore();
                }

                for (const inj of (r.injects || [])) injectParts.push(wrapInject(inj));

                // 2. 调度信号：不立即生成，先入队；等本轮主 AI 回复完成后，再依据实际回复内容
                //    生成任务链 / 地图（衔接更自然，见 processPendingSignals）
                if (!Array.isArray(store.pending_signals)) store.pending_signals = [];
                for (const sig of (r.signals || [])) {
                    if (sig.type === 'MISSION_GEN') {
                        // 携带 Task 2A 生成的 K1 轻量引子数据（兼容标题后缀，如「K1 轻量引子（Task 2A 生成，传给 Task 2C）」）
                        let k1 = null;
                        if (r.sections) {
                            for (const key of Object.keys(r.sections)) {
                                if (/^K1\s*轻量(?:引子|任务钩子)/.test(key)) { k1 = r.sections[key]; break; }
                            }
                        }
                        if (k1) {
                            sig.params = sig.params || {};
                            sig.params['引子数据'] = k1;
                        }
                    }
                    store.pending_signals.push(sig);
                }
                if (store.pending_signals.length) {
                    saveStore();
                    const names = store.pending_signals.map((s) => (s.type === 'MISSION_GEN' ? '任务链' : '地图')).join(' + ');
                    logInfo('task2', `⏳ 已登记待生成：${names}（本轮回复完成后生成）`);
                }
            }
        }

        // 3. Task 3（命运牌；每 N 轮，N = task3.frequency；失败不阻断）
        const task3 = getTaskById('task3');
        if (task3 && task3.enabled && store.round % (Number(task3.frequency) || 4) === 0) {
            await sleep(TASK_INTERVAL);
            try {
                const r3 = await runTask3(task3);
                for (const inj of (r3?.injects || [])) injectParts.push(wrapInject(inj));
            } catch (e) {
                logError('task3', `❌ 命运牌失败：${e?.message || e}`);
            }
        }

        // 4. 合并注入（所有任务执行完毕后，才统一注入）
        const combined = injectParts.filter(Boolean).join('\n\n');
        if (!combined) return null;
        // 最终注入指令：全局字段（settings.final_directive）；$8 = 用户本轮输入唯一引用点（被 <本轮用户输入> 包裹）
        const directive = getSettings().final_directive || DEFAULT_FINAL_DIRECTIVE;
        const has8 = directive.includes('$8');
        const prefix = String(directive).split('$8').join(userInput);
        // 拼装顺序：最终注入栏位(prefix，含 <本轮用户输入>$8</本轮用户输入>) → AI 返回内容(已带原生标签，供正则匹配)
        // 模板含 $8 时不额外前置 userInput（对齐 ACU，避免重复输入）；模板无 $8 才回退前置用户输入
        return (has8 ? '' : userInput + '\n\n') + prefix + '\n\n' + combined;
    } catch (e) {
        logError('system', `💥 剧情引擎执行失败：${e?.message || e}`, { raw: String(e?.stack || e) });
        return null; // 失败不注入，但不阻断主 AI 生成
    } finally {
        hideThinking();
        running = false;
    }
}

function onGenerationEnded() {
    const store = getStore();
    tickCooldowns(store);
    saveSnapshotAfter();  // 每轮结束保存快照（key = 当前楼层数），供楼层回退
    saveStore();
    // 刷新当前激活面板（数据已更新；动态 import 避免与 ui 层的循环依赖）
    try {
        import('./ui/modal.js').then(({ refreshActivePanel }) => refreshActivePanel());
    } catch { /* ignore */ }
    // 延后生成：本轮主 AI 已回复 → 依据实际回复内容生成任务链 / 地图
    processPendingSignals();
}

/** 本轮主 AI 实际回复正文（剔除思维链；过长截断） */
function lastAiReplyText(maxLen = 2000) {
    const chat = getChat();
    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg || msg.is_user) continue;
        let text = String(msg.mes || '').trim();
        if (!text) continue;
        text = text.replace(/<thought\b[^>]*>[\s\S]*?<\/thought>/gi, '').trim();
        return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
    }
    return '';
}

/**
 * 消费「待生成的调度信号」：在本轮主 AI 回复完成后执行 2B / 2C，
 * 并把本轮实际回复作为上下文，让新生成的任务链 / 地图与已发生的剧情自然衔接。
 * 生成结果写入 store（task_chain / map），供下一轮 Task 2A 读取并注入。
 */
async function processPendingSignals() {
    if (processingSignals || running) return;
    const store = getStore();
    const pending = Array.isArray(store.pending_signals) ? store.pending_signals.slice() : [];
    if (!pending.length) return;

    processingSignals = true;
    store.pending_signals = []; // 先取走再清空：失败只记日志，不无限重试
    saveStore();

    const aiReply = lastAiReplyText();
    showThinking('✦ 命运女神正在根据本轮剧情编织后续…');
    try {
        for (const sig of pending) {
            await sleep(TASK_INTERVAL);
            try {
                if (sig.type === 'MISSION_GEN') {
                    await runTask4BySignal(sig, aiReply);
                } else if (sig.type === 'MAP_GEN') {
                    await runTask25BySignal(sig, aiReply);
                }
            } catch (e) {
                logError(sig.type || 'signal', `❌ 信号任务失败：${e?.message || e}`);
            }
        }
    } finally {
        hideThinking();
        processingSignals = false;
        try {
            import('./ui/modal.js').then(({ refreshActivePanel }) => refreshActivePanel());
        } catch { /* ignore */ }
    }
}

/** 每轮 AI 回复完成后保存快照（key = 当前楼层数 chat.length），供楼层回退 */
function saveSnapshotAfter() {
    const chat = getChat();
    const history = getHistory();
    const snap = snapshotStore();
    if (!snap) return;
    const chatLen = chat.length;
    const entry = { round: snap.round, chatLen, snapshot: snap };
    const idx = history.findIndex((h) => h.chatLen === chatLen);
    if (idx >= 0) history[idx] = entry;
    else history.push(entry);
    while (history.length > 20) history.shift();
    saveHistory(history);
}

function onMessageDeleted() {
    // 延迟回退：等删除操作稳定（避免逐条删除的中间态误触发）
    if (rollbackTimer) clearTimeout(rollbackTimer);
    rollbackTimer = setTimeout(() => { rollbackTimer = null; checkRollback(); }, 250);
}

function onChatChanged() {
    if (rollbackTimer) clearTimeout(rollbackTimer);
    rollbackTimer = setTimeout(() => { rollbackTimer = null; checkRollback(); }, 250);
}

/** 检测楼层回退：chat 缩短时，恢复到 chatLen ≤ 当前楼层的最近快照 */
function checkRollback() {
    const chat = getChat();
    const len = chat.length;
    const history = getHistory();
    if (!history.length) return;
    // ≤ 匹配：删除到奇数楼层（中间态）也能回退到最近的完整回合
    const candidates = history.filter((h) => h.chatLen <= len);
    if (!candidates.length) return;
    const target = candidates.sort((a, b) => b.chatLen - a.chatLen)[0];
    restoreStore(target.snapshot);
    getStore().pending_signals = []; // 回退后丢弃旧的待生成信号，避免基于过期楼层生成
    saveStore();
    setRound(Math.ceil(target.chatLen / 2));
    logInfo('system', `⏪ 楼层回退至 ${len}，已恢复到 ${target.chatLen} 楼时的数据`);
    // 恢复后刷新面板
    try {
        import('./ui/modal.js').then(({ refreshActivePanel }) => refreshActivePanel());
    } catch { /* ignore */ }
}

function tickCooldowns(store) {
    const cs = store.card_status;
    if (!cs) return;
    for (const name of Object.keys(cs)) {
        if (cs[name].status === 'locked') {
            cs[name].cooldownLeft -= 1;
            if (cs[name].cooldownLeft <= 0) cs[name] = { status: 'available', cooldownLeft: 0 };
        }
    }
}

/** 任务链完成时启动冷却（插件权威）：记录「冷却结束游戏日」，并立即写入 冷却剩余 */
function startTaskCooldown(store, days) {
    const d = Math.max(0, Number(days) || TASK_COOLDOWN);
    const now = Number(store.clock?.gameDay) || 0;
    store.clock.冷却剩余 = d;
    store.clock.冷却结束游戏日 = now + d;
    return d;
}

/** 任务链冷却随游戏日推进自动递减：冷却剩余 = max(0, 冷却结束游戏日 - 当前游戏日) */
function syncTaskCooldown(store) {
    const until = store.clock?.冷却结束游戏日;
    if (until === undefined || until === null) return; // 无冷却记录（或旧存档）→ 保持 AI 自报值
    const now = Number(store.clock?.gameDay) || 0;
    store.clock.冷却剩余 = Math.max(0, Number(until) - now);
}

/* ---------------- 各任务执行 ---------------- */

async function runTask1(task) {
    const messages = await buildMessagesForTask(task);
    recordTrace(task, messages);
    const output = await generateWithRetry(task, messages);
    recordTraceReceived(task, output);
    const outline = parseTask1Output(output, task.storeTags);
    const store = getStore();
    // 纬线不含世界名，从经线摘要补
    if (!outline.worldName && store.world_summary_parsed?.worldName) {
        outline.worldName = store.world_summary_parsed.worldName;
    }
    store.outline = outline;
    if (outline.stages.length) store.current_stage = outline.stages[0].num;
    saveStore();
    logInfo('task1', `📋 大纲已生成：共 ${outline.stages.length} 阶段`);
    return null;
}

/** Task 1.5：世界观全景摘要（独立生成，避免大纲输出过大截断） */
async function runTask15(task) {
    const messages = await buildMessagesForTask(task);
    recordTrace(task, messages);
    const output = await generateWithRetry(task, messages);
    recordTraceReceived(task, output);
    const parsed = parseTask15Output(output, task.storeTags);
    const store = getStore();
    store.world_summary = parsed.raw;          // 原文（喂给其他 Task 的 {{world_summary}}）
    store.world_summary_parsed = parsed;       // 结构化（供面板渲染）
    saveStore();
    logInfo('task1_5', '📖 世界观全景摘要已生成');
    return null;
}

async function runTask2(task) {
    const messages = await buildMessagesForTask(task);
    recordTrace(task, messages);
    const output = await generateWithRetry(task, messages);
    recordTraceReceived(task, output);
    const r = parseTask2Output(output, task.storeTags, task.extractTags);
    const sigTxt = (r.signals && r.signals.length) ? r.signals.map((s) => s.type).join(' + ') : '';
    logInfo('task2', `✅ 剧情引擎已运行${sigTxt ? `（信号：${sigTxt}）` : ''}`);
    return r;
}

async function runTask4BySignal(signal, aiReply = '') {
    const task = getTaskById('task4');
    if (!task) { logWarn('task4', '⚠️ 任务「2B 任务链生成」不存在，信号未执行'); return null; }
    if (!task.enabled) { logWarn('task4', '⚠️ 任务「2B 任务链生成」已停用，MISSION_GEN 信号被跳过（可在面板三启用）'); return null; }
    const missionContext = buildMissionContext(signal, aiReply);
    const messages = await buildMessagesForTask(task, { '{{mission_context}}': missionContext });
    recordTrace(task, messages);
    const output = await generateWithRetry(task, messages);
    recordTraceReceived(task, output);
    const r = parseTask4Output(output, task.storeTags, task.extractTags);
    if (r.task_chain && r.task_chain.name) {
        getStore().task_chain = r.task_chain;
        saveStore();
        logInfo('task4', `📖 任务链已生成：${r.task_chain.name}`);
    }
    return r;
}

async function runTask4(task) {
    const signal = { type: 'MISSION_GEN', params: { '种子来源': '推荐事件' } };
    return runTask4BySignal(signal);
}

async function runTask25BySignal(signal, aiReply = '') {
    const task = getTaskById('task2_5');
    if (!task) { logWarn('task2_5', '⚠️ 任务「2C 地图生成」不存在，信号未执行'); return null; }
    if (!task.enabled) { logWarn('task2_5', '⚠️ 任务「2C 地图生成」已停用，MAP_GEN 信号被跳过（可在面板三启用）'); return null; }
    const locationContext = buildLocationContext(signal, aiReply);
    const messages = await buildMessagesForTask(task, { '{{location_context}}': locationContext });
    recordTrace(task, messages);
    const output = await generateWithRetry(task, messages);
    recordTraceReceived(task, output);
    const r = parseTask25Output(output, task.storeTags, task.extractTags);
    if (r.map && r.map.raw) {
        getStore().map = r.map;
        getStore().scene_type = 'closed';
        saveStore();
        logInfo('task2_5', `📍 地图已生成：${r.map.name || '未知地点'}`);
    }
    return r;
}

async function runTask25(task) {
    const signal = { type: 'MAP_GEN', params: { '位置名称': '当前场景' } };
    return runTask25BySignal(signal);
}

async function runTask3(task) {
    const messages = await buildMessagesForTask(task);
    recordTrace(task, messages);
    const output = await generateWithRetry(task, messages);
    recordTraceReceived(task, output);
    const r = parseTask3Output(output, task.storeTags, task.extractTags);
    const store = getStore();
    if (r.pass) {
        recordSilent(store, r);
        saveStore();
        logInfo('task3', `⏭️ 命运牌静默（${r.silentReason || '节奏不合适'}）`);
    } else if (r.card && r.card.name) {
        applyFateCard(store, r.card);
        saveStore();
        logInfo('task3', `🎲 已出牌：${r.card.name}·${r.card.strength.name}级`);
    } else {
        logWarn('task3', '⚠️ 命运牌输出未解析出牌面，已跳过');
    }
    return r;
}

async function runGenericTask(task) {
    const messages = await buildMessagesForTask(task);
    recordTrace(task, messages);
    const output = await generateWithRetry(task, messages);
    recordTraceReceived(task, output);
    logInfo(task.id, `✅ 自定义任务「${task.name}」已运行`);
}

/* ---------------- 增量字段合并 ---------------- */

function applyIncrementalFields(store, r) {
    if (!r) return;
    const fields = r.fields || {};
    const sections = r.sections || {};

    // 1. 游戏时间 / 历法日期 / 叙事节拍（◇ 本轮状态 头部键值对）
    if (fields['游戏时间']) {
        const m = fields['游戏时间'].match(/第(\d+)游戏日/);
        if (m) store.clock.gameDay = Number(m[1]);
    }
    if (fields['历法日期']) {
        store.clock.历法日期 = fields['历法日期'].trim();
    }
    if (fields['叙事节拍']) {
        const m = fields['叙事节拍'].match(/^\s*(\S+)\s*→/);
        if (m) store.clock.节拍 = m[1].trim();
    }

    // 1.5 主角状态快照（▪ 主角状态快照）：维护结构化 player_status（时间/位置/等级/物品/财富/伤势/声望）
    const snap = sections['主角状态快照'];
    if (snap) {
        const field = (key) => {
            const m = String(snap).match(new RegExp(`${key}[：:]\\s*([^\\n]+)`));
            return m ? m[1].trim() : '';
        };
        store.player_status = {
            时间: field('时间'),
            位置: field('位置'),
            等级: field('等级'),
            物品: field('物品/装备') || field('物品'),
            财富: field('财富'),
            伤势: field('伤势/疲劳') || field('伤势'),
            声望: field('声望'),
        };
    }

    // 2. 任务链状态（▪ 任务链状态（有任务时维护））+ 旧格式 S2/S3/S4 兼容
    const findSection = (prefix) => {
        for (const key of Object.keys(sections)) if (key.startsWith(prefix)) return sections[key];
        return '';
    };
    const taskState = findSection('任务链状态');
    const s2 = findSection('S2 任务进度') || findSection('S2 任务链进度');
    const s3 = findSection('S3 无活跃');
    const s4 = findSection('S4 任务完成') || findSection('S4 任务塌缩');

    if (taskState) {
        const hasActive = /【活跃中】/.test(taskState);
        const hasDone = /【已完成】/.test(taskState);
        // 兼容 AI 漏写【无任务】标记、只写「任务状态：无活跃任务链」的情况
        const hasNone = /【无任务】/.test(taskState) || /无活跃任务链/.test(taskState);

        // 【活跃中】→ 更新当前事件 + 状态
        if (hasActive && store.task_chain) {
            const evM = taskState.match(/当前事件[：:]\s*([^\n|]+)/);
            if (evM) store.task_chain.currentNode = evM[1].trim();
            if (store.task_chain.status === '待激活' || !store.task_chain.status) {
                store.task_chain.status = '活跃中';
            }
        }

        // 【已完成】→ 记录完成 + 结局 + 伏笔 + 冷却
        if (hasDone) {
            const hadChain = !!store.task_chain; // 是否真正关闭了一条任务链（供冷却判定）
            const doneName = taskState.match(/任务[：:]\s*#?\s*\S+\s*([^\n]+)/);
            const doneEnd = taskState.match(/结局[：:]\s*([^\n]+)/);
            const doneEff = taskState.match(/即时后果[：:]\s*([^\n]+)/);
            store.last_result = {
                name: doneName ? doneName[1].trim() : (store.task_chain?.name || ''),
                结局: doneEnd ? doneEnd[1].trim() : '',
                即时后果: doneEff ? doneEff[1].trim() : '',
            };
            if (store.task_chain) {
                store.task_history.push({
                    name: store.task_chain.name || (doneName ? doneName[1].trim() : ''),
                    结局: doneEnd ? doneEnd[1].trim() : '',
                    完成游戏日: store.clock?.gameDay ?? null,
                });
                store.task_chain = null;
            }
            const nameM = taskState.match(/后续伏笔[：:]\s*([^\n]+)/);
            if (nameM) {
                const name = nameM[1].trim();
                if (name && name !== '无' && name !== '无负面伏笔' && !store.foreshadowing.some((f) => f.name === name)) {
                    store.foreshadowing.push({
                        code: `伏笔${store.foreshadowing.length + 1}`,
                        name,
                        阶段: 1,
                        剩余时间: null,
                        状态: '沉睡中',
                    });
                }
            }
            const coolM = taskState.match(/冷却计时[：:]\s*(?:重置为)?\s*(\d+)/);
            // 冷却：插件权威启动，不再依赖 AI 是否写出「冷却计时」（漏写会导致冷却保持 0 → 任务链连续触发）
            // 仅当「真正关闭了一条任务链」或「当前没有进行中的冷却」时启动，避免重复的【已完成】反复重置冷却
            const untilC = store.clock.冷却结束游戏日;
            const nowDay = Number(store.clock?.gameDay) || 0;
            const cooling = untilC !== undefined && untilC !== null && Number(untilC) > nowDay;
            if (hadChain || !cooling) {
                startTaskCooldown(store, coolM ? Number(coolM[1]) : TASK_COOLDOWN);
            }
        }

        // 【无任务】→ 冷却 + 等级
        if (hasNone) {
            // 插件已按「冷却结束游戏日」权威维护冷却时忽略 AI 自报值（否则被写回 0 会让任务链立刻再触发）
            if (store.clock.冷却结束游戏日 === undefined) {
                const coolM = taskState.match(/冷却剩余[：:]\s*(\d+)/);
                if (coolM) store.clock.冷却剩余 = Number(coolM[1]);
            }
            const lvM = taskState.match(/主角当前[：:]\s*Lv\s*(\d+)/);
            if (lvM) store.角色等级 = Number(lvM[1]);
        }
    } else {
        // 旧格式 S2/S3/S4 兼容
        if (s2 && store.task_chain) {
            const evM = s2.match(/^事件[：:]\s*([^\n]+)/m);
            if (evM) store.task_chain.currentNode = evM[1].trim();
            if (store.task_chain.status === '待激活' || !store.task_chain.status) {
                store.task_chain.status = '活跃中';
            }
        }
        if (s3) {
            if (store.clock.冷却结束游戏日 === undefined) {
                const coolM = s3.match(/冷却剩余[：:]\s*(\d+)/);
                if (coolM) store.clock.冷却剩余 = Number(coolM[1]);
            }
            const lvM = s3.match(/主角当前[：:]\s*Lv\s*(\d+)/);
            if (lvM) store.角色等级 = Number(lvM[1]);
            if (store.task_chain && (s3.includes('无活跃') || s3.includes('已完成') || s3.includes('已塌缩'))) {
                store.task_chain = null;
            }
        }
        if (s4) {
            const hadChain4 = !!store.task_chain;
            const doneName = s4.match(/任务[：:]\s*#?\s*\S+\s*([^\n]+)/);
            const doneEnd = s4.match(/结局[：:]\s*([^\n]+)/);
            const doneEff = s4.match(/即时后果[：:]\s*([^\n]+)/);
            store.last_result = {
                name: doneName ? doneName[1].trim() : (store.task_chain?.name || ''),
                结局: doneEnd ? doneEnd[1].trim() : '',
                即时后果: doneEff ? doneEff[1].trim() : '',
            };
            if (store.task_chain) {
                store.task_history.push({
                    name: store.task_chain.name || (doneName ? doneName[1].trim() : ''),
                    结局: doneEnd ? doneEnd[1].trim() : '',
                    完成游戏日: store.clock?.gameDay ?? null,
                });
                store.task_chain = null;
            }
            const nameM = s4.match(/后续伏笔[：:]\s*([^\n]+)/) || s4.match(/新增伏笔[：:]\s*#?\s*[^\s]*\s*(.+)/);
            if (nameM) {
                const name = nameM[1].trim();
                if (name && name !== '无' && name !== '无负面伏笔' && !store.foreshadowing.some((f) => f.name === name)) {
                    store.foreshadowing.push({
                        code: `伏笔${store.foreshadowing.length + 1}`,
                        name,
                        阶段: 1,
                        剩余时间: null,
                        状态: '沉睡中',
                    });
                }
            }
            const coolM = s4.match(/冷却计时[：:]\s*(?:重置为)?\s*(\d+)/);
            const until4 = store.clock.冷却结束游戏日;
            const now4 = Number(store.clock?.gameDay) || 0;
            const cooling4 = until4 !== undefined && until4 !== null && Number(until4) > now4;
            if (hadChain4 || !cooling4) {
                startTaskCooldown(store, coolM ? Number(coolM[1]) : TASK_COOLDOWN);
            }
        }
    }

    // 4.5 地图进度更新（▪ 地图进度更新，含标题后缀）：更新当前位置与探索状态
    const mupd = findSection('地图进度更新');
    if (mupd && store.map && store.map.type === 'closed') {
        const posM = mupd.match(/当前位置[：:]\s*([^\n]+)/);
        if (posM) store.map.当前位置 = posM[1].trim();
        const explored = new Set(store.map.explored || []);
        for (const line of String(mupd).split('\n')) {
            const em = line.trim().match(/^-\s*([①②③④⑤⑥⑦⑧⑨⑩]|\d+)\s*[\[（]?\s*(?:已探索|已清除)/);
            if (em) explored.add(markerNum(em[1]));
        }
        store.map.explored = Array.from(explored);
    }

    // 4.8 时间线事件（▪ 时间线事件）：记录已触发的世界事件，防止重复触发
    const tl = sections['时间线事件'];
    if (tl) {
        for (const line of String(tl).split('\n')) {
            const t = line.trim();
            if (!t.startsWith('-')) continue;
            const desc = t.replace(/^-\s*/, '').replace(/\[已触发\]/g, '').trim();
            if (desc && !store.timeline_events.includes(desc)) store.timeline_events.push(desc);
        }
    }

    // 5. 伏笔倒计时（▪ 伏笔倒计时）
    const fd = sections['伏笔倒计时'];
    if (fd) {
        for (const line of String(fd).split('\n')) {
            const m = line.match(/伏笔\s*#?\s*[\d#]+\s*[：:]\s*(.+?)\s*—\s*距下一阶段[：:]\s*(\S+)/);
            if (m) {
                const f = store.foreshadowing.find((x) => x.name === m[1].trim());
                if (f) f.剩余时间 = m[2].trim();
            }
        }
    }

    saveStore();
}

/* ---------------- 上下文组装 ---------------- */

function buildMissionContext(signal, aiReply = '') {
    const p = signal.params || {};
    const store = getStore();
    const lines = [];
    if (p['种子来源']) lines.push(`种子来源：${p['种子来源']}`);
    if (p['伏笔数据']) lines.push(`伏笔数据：${p['伏笔数据']}`);
    if (p['玩家当前位置']) lines.push(`玩家当前位置：${p['玩家当前位置']}`);
    if (p['玩家当前等级']) lines.push(`玩家当前等级：${p['玩家当前等级']}`);
    lines.push(`任务编号：#${store.round}`);
    if (p['阶段约束']) lines.push(`阶段约束：${p['阶段约束']}`);
    if (p['叙事节拍']) lines.push(`叙事节拍：${p['叙事节拍']}`);
    if (p['引子数据']) lines.push(`引子数据：\n${p['引子数据']}`);
    if (aiReply) {
        lines.push(
            '',
            '【本轮已发生的剧情（主 AI 实际回复，摘要）】',
            '以下是本轮主 AI 已经写出的正文。你续写的任务链必须与之自然衔接：',
            '引子在正文里如何出现、谁在场、玩家看到了什么，都以这段为准，不得与之矛盾。',
            aiReply,
        );
    }
    return lines.join('\n');
}

function buildLocationContext(signal, aiReply = '') {
    const p = signal.params || {};
    const lines = [];
    if (p['位置名称']) lines.push(`位置名称：${p['位置名称']}`);
    if (p['场景类型']) lines.push(`场景类型：${p['场景类型']}`);
    if (p['位置描述']) lines.push(`位置描述：${p['位置描述']}`);
    if (p['进入原因']) lines.push(`进入原因：${p['进入原因']}`);
    if (p['任务关联']) lines.push(`任务关联：${p['任务关联']}`);
    if (p['阶段约束']) lines.push(`阶段约束：${p['阶段约束']}`);
    if (aiReply) {
        lines.push(
            '',
            '【本轮已发生的剧情（主 AI 实际回复，摘要）】',
            '玩家是带着这段正文进入该场景的；地图布局要与这段描述一致，不得矛盾。',
            aiReply,
        );
    }
    return lines.join('\n') || '未知场景';
}

/* ---------------- 生成与记录 ---------------- */

/** 任务友好名（重试提示用） */
function taskLabel(task) {
    return TASK_LABEL[task.id] || task.name || '任务';
}

/**
 * 校验输出「标签 / 结构」是否完整：截断、漏标签、未闭合。
 * @returns {string|null} null = 通过；否则返回错误描述
 */
function validateStructure(task, output) {
    const text = String(output || '');
    if (!text.trim()) return '输出为空';

    // ① 存储标签
    const storeTag = String(task.storeTags || 'store').split(/[,，]/)[0].trim() || 'store';
    const openRe = new RegExp(`<${storeTag}\\b[^>]*>`, 'i');
    const fullRe = new RegExp(`<${storeTag}\\b[^>]*>([\\s\\S]*?)<\\/${storeTag}>`, 'i');
    if (!openRe.test(text)) return `缺少 <${storeTag}> 标签`;
    const m = text.match(fullRe);
    if (!m) return `<${storeTag}> 未闭合（疑似被截断）`;
    if (!m[1].trim()) return `<${storeTag}> 内容为空`;

    // ② 注入标签（摘取后注入主 AI）。Task 3 的 fate_inject 仅出牌时出现，不作硬性要求
    if (task.id !== 'task3' && task.extractTags) {
        const tags = String(task.extractTags).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        for (const t of tags) {
            if (!new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}>`, 'i').test(text)) {
                return `缺少 <${t}> 标签`;
            }
        }
    }
    return null;
}

async function generateWithRetry(task, messages) {
    const maxAttempts = Math.max(1, Number(task.maxRetries) || 3);
    const minLen = Number(task.minReplyLength) || 0;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const out = await quietGenerate(messages, `ananke-${task.id}`, { temperature: TASK_TEMPERATURE[task.id] ?? 0.4 });

            // ① 过短
            if (minLen > 0 && out.length < minLen) {
                lastErr = new Error(`回复过短（${out.length} < ${minLen}）`);
                logWarn(task.id, `⚠️ ${task.name} 回复过短，已重试（第${attempt}次）`);
                toast(`⚠️ ${taskLabel(task)}输出过短，正在重新生成…（第 ${attempt} 次）`, 'error', 3000);
                continue;
            }

            // ② 标签 / 结构错误（截断、漏标签、未闭合）→ 重发
            const structErr = validateStructure(task, out);
            if (structErr) {
                lastErr = new Error(`结构错误：${structErr}`);
                logWarn(task.id, `⚠️ ${task.name} 输出结构异常（${structErr}），正在重新生成（第${attempt}次）`);
                toast(`⚠️ ${taskLabel(task)}错误，正在重新生成…（第 ${attempt} 次）`, 'error', 3000);
                continue;
            }

            return out;
        } catch (e) {
            lastErr = e;
            logWarn(task.id, `⚠️ ${task.name} 调用失败，已重试（第${attempt}次）：${e?.message || e}`);
            toast(`⚠️ ${taskLabel(task)}调用失败，正在重试…（第 ${attempt} 次）`, 'error', 3000);
        }
    }
    toast(`⚠️ ${taskLabel(task)}重试 ${maxAttempts} 次仍未成功，本轮已跳过`, 'error', 4000);
    throw lastErr || new Error('生成失败');
}

function recordTrace(task, messages) {
    const store = getStore();
    if (!store.ai_trace || typeof store.ai_trace !== 'object') store.ai_trace = {};
    store.ai_trace[task.id] = { task: task.name, sent: messages, received: null, time: Date.now() };
    saveStore();
}

function recordTraceReceived(task, output) {
    const store = getStore();
    const entry = store.ai_trace && store.ai_trace[task.id];
    if (entry) { entry.received = output; saveStore(); }
}

/* ---------------- 命运牌 ---------------- */

/** 记录一次静默（不出牌）——不计入出牌统计 */
function recordSilent(store, r) {
    store.fate_history.push({
        round: store.round, card: null, strength: '',
        declaration: '', summary: '', causality: '',
        stage: store.current_stage, polarity: '',
        silent: true, silentReason: r.silentReason || '', comment: r.comment || '',
    });
    if (store.fate_history.length > 50) store.fate_history.splice(0, store.fate_history.length - 50);
}

function applyFateCard(store, card) {
    const name = card.name;
    const strengthName = card.strength.name || '';
    if (store.card_status && store.card_status[name]) {
        store.card_status[name] = { status: 'locked', cooldownLeft: CARD_COOLDOWN };
    }
    const polarity = ['幸运', '恩赐'].includes(name) ? '正面' : ['背叛', '贪婪', '嫉妒'].includes(name) ? '负面' : '中性';
    store.fate_history.push({
        round: store.round, card: name, strength: strengthName,
        declaration: card.declaration || '', summary: (card.content || '').replace(/\s+/g, ' '),
        causality: card.causality || '',
        stage: store.current_stage, polarity,
        npcs: card.npcs || [], foes: card.foes || [], branches: card.branches || [],
    });
    if (store.fate_history.length > 50) store.fate_history.splice(0, store.fate_history.length - 50);
    const st = store.fate_stats;
    st.total += 1;
    if (strengthName.includes('涟漪')) st.ripple += 1;
    else if (strengthName.includes('浪潮')) st.wave += 1;
    else if (strengthName.includes('风暴')) st.storm += 1;
    if (['幸运', '恩赐'].includes(name)) st.pos += 1;
    else if (['背叛', '贪婪', '嫉妒'].includes(name)) st.neg += 1;
    st.recent.push(name);
    if (st.recent.length > 3) st.recent.shift();
}

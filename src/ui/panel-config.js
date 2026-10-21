/**
 * 面板四：提示词 & API（任务管理中心）
 * 任务列表 / 基本配置 / API 配置 / 对话块编辑器 / Agent 控制 / 保存
 */
import { getSettings, saveSettings, DEFAULT_PROMPTS, DEFAULT_SETTINGS, DEFAULT_FINAL_DIRECTIVE, DEFAULT_EXCLUDE_TAGS, loadApiPresets, upsertApiPreset, deleteApiPreset, applyApiPreset } from '../settings.js';
import { escapeHtml, downloadFile } from '../utils.js';
import { fetchModels, testConnection } from '../api.js';
import { collapsible, bindCollapsibles, emptyState } from './widgets.js';
import { toastSuccess, toastError } from './toast.js';
import { getStore, saveStore } from '../store.js';

let selectedTaskId = null;
let editingBlocks = []; // 当前编辑的对话块（深拷贝）

export function renderConfigPanel(container) {
    container.innerHTML = buildHtml();
    bindCollapsibles(container);
    bind(container);
}

function currentTask() {
    const settings = getSettings();
    if (!settings.tasks.length) return null;
    if (!selectedTaskId || !settings.tasks.some((t) => t.id === selectedTaskId)) {
        selectedTaskId = settings.tasks[0].id;
    }
    return settings.tasks.find((t) => t.id === selectedTaskId) || settings.tasks[0];
}

/** 取某任务的默认标签/指令（空值兜底用，避免面板保存后把标签清空） */
function defaultTagsFor(task) {
    const def = DEFAULT_SETTINGS.tasks.find((t) => t.id === task.id);
    return {
        extract: def?.extractTags ?? '',
        store: def?.storeTags ?? 'store',
        exclude: def?.exclude_tags ?? '',
    };
}

/** 解析导入的提示词文本 → [{role, content}]（支持 JSON 数组 / [ROLE] 分块 TXT） */
function parsePromptText(text, name) {
    const t = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!t) return [];
    // JSON 格式：[{role, content}, ...]
    if (/\.json$/i.test(name || '') || /^\s*\[/.test(t)) {
        try {
            const arr = JSON.parse(t);
            if (Array.isArray(arr)) {
                return arr.filter((b) => b && b.role).map((b) => ({ role: String(b.role), content: String(b.content ?? '') }));
            }
        } catch { /* 非 JSON，尝试 TXT */ }
    }
    // TXT 格式：[ROLE]\n内容 ...
    const blocks = [];
    let cur = null;
    for (const line of t.split('\n')) {
        const m = line.match(/^\s*\[(system|user|assistant)\]\s*$/i);
        if (m) {
            if (cur) blocks.push(cur);
            cur = { role: m[1].toLowerCase(), content: '' };
        } else if (cur) {
            cur.content = (cur.content ? cur.content + '\n' : '') + line;
        }
    }
    if (cur) blocks.push(cur);
    return blocks.map((b) => ({ role: b.role, content: b.content.trim() }));
}

function buildHtml() {
    const settings = getSettings();
    const task = currentTask();

    const cards = settings.tasks.map((t) => `
        <div class="c-task-card ${t.id === (task?.id) ? 'active' : ''}" data-task="${t.id}">
            <div class="c-task-head">
                <span class="c-task-name">${escapeHtml(t.name)}</span>
                <span class="c-task-dot ${t.enabled ? 'on' : 'off'}"></span>
                <button class="fw-btn fw-btn-mini fw-btn-danger fw-task-del" data-task="${t.id}" title="删除任务">删除</button>
            </div>
            <div class="c-task-meta">${t.enabled ? '已启用' : '已禁用'} · 阶段${t.stage || '全'} · 每${t.frequency}轮 · 顺序${t.order ?? 1}</div>
        </div>`).join('');

    if (!task) {
        return `<div class="fw-panel">
            ${emptyState('暂无任务')}
            <button class="fw-btn" id="fw-task-add">添加任务</button>
        </div>`;
    }

    editingBlocks = structuredClone(task.prompt_blocks || []);

    const configForm = configFormHtml(task);
    const blocksHtml = blocksListHtml();

    return `
        <div class="fw-panel">
            <div class="fw-task-count">当前任务数量：${settings.tasks.length}</div>
            <div class="c-task-cards">${cards}</div>
            <div class="fw-toolbar">
                <button class="fw-btn" id="fw-task-add">添加任务</button>
                <button class="fw-btn fw-btn-danger" id="fw-task-delete-selected">删除任务</button>
            </div>

            ${collapsible('▶ API 配置（全局，三个 Task 共用）', globalApiHtml(settings), { defaultOpen: true })}
            ${collapsible('▶ 最终注入指令（全局，作用于整段注入）', globalDirectiveHtml(settings), { defaultOpen: false })}
            ${collapsible('▶ 世界书选择（手动追加，超出角色卡世界书的内容）', worldbookHtml(), { defaultOpen: false })}

            <div class="fw-section-title">当前任务：${escapeHtml(task.name)}</div>
            ${configForm}
            <div class="fw-section-title">提示词编辑</div>
            <div id="fw-prompt-blocks">${blocksHtml}</div>
            <div class="fw-toolbar">
                <button class="fw-btn" id="fw-block-add">+ 添加对话块</button>
                <button class="fw-btn" id="fw-block-reset">恢复默认提示词</button>
                <button class="fw-btn" id="fw-block-import">导入提示词</button>
                <button class="fw-btn" id="fw-block-export">导出提示词</button>
            </div>

            <div class="fw-toolbar">
                <button class="fw-btn fw-btn-primary" id="fw-task-save">保存当前任务</button>
                <button class="fw-btn" id="fw-task-save-all">保存全部</button>
            </div>
        </div>`;
}

function globalApiHtml(settings) {
    const g = settings.global_api || {};
    const presets = loadApiPresets();
    const presetOptions = presets.length
        ? presets.map((p) => `<option value="${p.id}" ${p.id === settings.apiPresetActiveId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')
        : '<option value="">（暂无预设）</option>';
    return `
        <div class="fw-form-row"><label>API 地址（OpenAI 兼容 base URL；火山引擎填 https://ark.cn-beijing.volces.com/api/v3）</label><input type="text" id="fw-global-url" value="${escapeHtml(g.url || '')}" placeholder="https://api.example.com/v1"></div>
        <div class="fw-form-row"><label>API Key</label><input type="password" id="fw-global-key" value="${escapeHtml(g.key || '')}" placeholder="sk-... / 火山引擎填 ARK_API_KEY"></div>
        <div class="fw-form-row"><label>模型（火山引擎填推理接入点 ID，如 ep-xxxx）</label>
            <div class="fw-toolbar">
                <input type="text" id="fw-global-model" value="${escapeHtml(g.model || '')}" placeholder="如 gpt-4o / deepseek-chat / ep-xxxx" style="flex:1">
                <button class="fw-btn fw-btn-mini" id="fw-fetch-models" type="button">获取模型</button>
            </div>
        </div>
        <div class="fw-model-list" id="fw-model-list" style="display:none"></div>
        <div class="fw-toolbar">
            <button class="fw-btn" id="fw-test-api" type="button">测试连接</button>
            <button class="fw-btn" id="fw-save-preset" type="button">另存为预设</button>
        </div>
        <div class="fw-form-row">
            <label>API 预设（多套 API 之间快切）</label>
            <div class="fw-toolbar">
                <select id="fw-preset-select" style="flex:1">${presetOptions}</select>
                <button class="fw-btn fw-btn-mini" id="fw-apply-preset" type="button">应用</button>
                <button class="fw-btn fw-btn-mini fw-btn-danger" id="fw-delete-preset" type="button">删除</button>
            </div>
        </div>`;
}

function globalDirectiveHtml(settings) {
    return `
        <div class="fw-form-row"><label>注入内容说明模板（可选：\$8 = 用户本轮输入占位符）</label><textarea id="fw-global-directive" rows="5">${escapeHtml(settings.final_directive || '')}</textarea></div>`;
}

/** 手动追加的世界书（聊天级；超出角色卡世界书的内容，合并进 {{world_info}}/{{lore}}） */
function worldbookHtml() {
    const store = getStore();
    const list = store.manual_worldbooks || [];
    const items = list.length
        ? list.map((name, i) => `<div class="fw-wb-row"><span class="fw-wb-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><button class="fw-btn fw-btn-mini fw-btn-danger fw-wb-del" data-i="${i}" type="button">删除</button></div>`).join('')
        : '<div class="fw-wb-empty">（暂无手动追加的世界书）</div>';
    return `
        <div class="fw-wb-list">${items}</div>
        <div class="fw-toolbar">
            <input type="text" id="fw-wb-input" placeholder="输入世界书名（与 ST 世界书文件同名）" style="flex:1">
            <button class="fw-btn" id="fw-wb-add" type="button">添加</button>
        </div>
        <div class="fw-wb-hint">追加的世界书会合并进 <code>{{world_info}}</code> / <code>{{lore}}</code>，供任务 1.5 生成世界观摘要。</div>`;
}

function configFormHtml(task) {
    const dt = defaultTagsFor(task);
    return `
        <div class="fw-section-title">基本配置</div>
        <div class="fw-form-grid">
            <div class="fw-form-row"><label>任务名称</label><input type="text" id="fw-task-name" value="${escapeHtml(task.name)}"></div>
            <div class="fw-form-row"><label>启用</label><label class="fw-check"><input type="checkbox" id="fw-task-enabled" ${task.enabled ? 'checked' : ''}> 启用该任务</label></div>
            <div class="fw-form-row"><label>阶段号（0=所有阶段）</label><input type="number" id="fw-task-stage" min="0" max="5" value="${task.stage ?? 0}"></div>
            <div class="fw-form-row"><label>调用频率（每 N 轮）</label><input type="number" id="fw-task-frequency" min="1" value="${task.frequency ?? 1}"></div>
            <div class="fw-form-row"><label>调取顺序（同值=一起调用，不同值=按顺序）</label><input type="number" id="fw-task-order" min="1" value="${task.order ?? 1}"></div>
            <div class="fw-form-row"><label>历史对话记录（轮）</label>
                <select id="fw-task-history">${[3, 5, 10, 15, 20].map((n) => `<option value="${n}" ${Number(task.historyTurns) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
            <div class="fw-form-row"><label>最小回复长度（0=不检查）</label><input type="number" id="fw-task-minlen" min="0" value="${task.minReplyLength ?? 200}"></div>
            <div class="fw-form-row"><label>最大尝试次数（含截断/漏标签时的重发）</label><input type="number" id="fw-task-maxretries" min="1" value="${task.maxRetries ?? 3}"></div>
            <div class="fw-form-row"><label>标签摘取（摘取&lt;标签&gt;内容注入用户输入后方，逗号分隔）</label><input type="text" id="fw-task-extract" value="${escapeHtml(task.extractTags || dt.extract)}" placeholder="${escapeHtml(dt.extract || 'supplement')}"></div>
            <div class="fw-form-row"><label>标签写入（摘取&lt;标签&gt;内容写入储存，逗号分隔）</label><input type="text" id="fw-task-store" value="${escapeHtml(task.storeTags || dt.store)}" placeholder="${escapeHtml(dt.store || 'store')}"></div>
            <div class="fw-form-row"><label>排除标签（前文剧情剔除，逗号分隔）</label><input type="text" id="fw-task-exclude" value="${escapeHtml(task.exclude_tags || dt.exclude)}" placeholder="${escapeHtml(dt.exclude || 'thought,img,image')}"></div>
        </div>
    `;
}

function blocksListHtml() {
    if (!editingBlocks.length) return emptyState('暂无对话块，点击「+ 添加对话块」');
    return editingBlocks.map((b, i) => `
        <div class="fw-block" data-idx="${i}">
            <div class="fw-block-head">
                <div class="fw-block-roles">
                    ${['system', 'user', 'assistant'].map((r) => `<button class="fw-role-btn ${b.role === r ? 'active' : ''}" data-idx="${i}" data-role="${r}">${r.toUpperCase()}</button>`).join('')}
                </div>
                <span class="fw-spacer"></span>
                <button class="fw-btn fw-btn-mini fw-block-move" data-idx="${i}" data-dir="-1">↑</button>
                <button class="fw-btn fw-btn-mini fw-block-move" data-idx="${i}" data-dir="1">↓</button>
                <button class="fw-btn fw-btn-mini fw-btn-danger fw-block-del" data-idx="${i}">删除</button>
            </div>
            <textarea class="fw-block-content" data-idx="${i}" rows="5" placeholder="提示词内容，支持 {{占位符}}">${escapeHtml(b.content || '')}</textarea>
        </div>`).join('');
}

function bind(container) {
    // 任务卡片选择
    container.querySelectorAll('.c-task-card').forEach((card) => {
        card.addEventListener('click', () => {
            selectedTaskId = card.dataset.task;
            renderConfigPanel(container);
        });
    });

    // 删除任务
    container.querySelectorAll('.fw-task-del').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止触发卡片选中
            const id = btn.dataset.task;
            const settings = getSettings();
            const t = settings.tasks.find((x) => x.id === id);
            if (!t) return;
            if (settings.tasks.length <= 1) { toastError('至少保留一个任务'); return; }
            if (confirm(`确定删除任务「${t.name}」吗？`)) {
                settings.tasks = settings.tasks.filter((x) => x.id !== id);
                if (selectedTaskId === id) selectedTaskId = null;
                saveSettings();
                toastSuccess('✅ 任务已删除');
                renderConfigPanel(container);
            }
        });
    });

    // 添加任务
    const addTask = container.querySelector('#fw-task-add');
    if (addTask) addTask.addEventListener('click', () => {
        const settings = getSettings();
        const id = `task${Date.now().toString(36)}`;
        settings.tasks.push({
            id, name: `自定义任务 ${settings.tasks.length + 1}`, enabled: true, stage: 0,
            frequency: 1, historyTurns: 6, minReplyLength: 0, maxRetries: 3,
            extractTags: '', storeTags: 'store', exclude_tags: DEFAULT_EXCLUDE_TAGS,
            order: settings.tasks.length + 1, prompt_blocks: [],
        });
        selectedTaskId = id;
        saveSettings();
        renderConfigPanel(container);
    });

    // 删除当前选中任务（工具栏「删除任务」按钮）
    const delSelected = container.querySelector('#fw-task-delete-selected');
    if (delSelected) delSelected.addEventListener('click', () => {
        const settings = getSettings();
        const t = currentTask();
        if (!t) return;
        if (settings.tasks.length <= 1) { toastError('至少保留一个任务'); return; }
        if (confirm(`确定删除任务「${t.name}」吗？`)) {
            settings.tasks = settings.tasks.filter((x) => x.id !== t.id);
            if (selectedTaskId === t.id) selectedTaskId = null;
            saveSettings();
            toastSuccess('✅ 任务已删除');
            renderConfigPanel(container);
        }
    });

    // 对话块操作
    container.querySelectorAll('.fw-role-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const i = Number(btn.dataset.idx);
            editingBlocks[i].role = btn.dataset.role;
            refreshBlocks(container);
        });
    });
    container.querySelectorAll('.fw-block-move').forEach((btn) => {
        btn.addEventListener('click', () => {
            const i = Number(btn.dataset.idx);
            const dir = Number(btn.dataset.dir);
            const j = i + dir;
            if (j < 0 || j >= editingBlocks.length) return;
            [editingBlocks[i], editingBlocks[j]] = [editingBlocks[j], editingBlocks[i]];
            refreshBlocks(container);
        });
    });
    container.querySelectorAll('.fw-block-del').forEach((btn) => {
        btn.addEventListener('click', () => {
            const i = Number(btn.dataset.idx);
            if (confirm('确定删除该对话块吗？')) {
                editingBlocks.splice(i, 1);
                refreshBlocks(container);
            }
        });
    });
    container.querySelectorAll('.fw-block-content').forEach((ta) => {
        ta.addEventListener('input', () => {
            const i = Number(ta.dataset.idx);
            editingBlocks[i].content = ta.value;
        });
    });

    const addBlock = container.querySelector('#fw-block-add');
    if (addBlock) addBlock.addEventListener('click', () => {
        editingBlocks.push({ role: 'user', content: '' });
        refreshBlocks(container);
    });

    const resetBlocks = container.querySelector('#fw-block-reset');
    if (resetBlocks) resetBlocks.addEventListener('click', () => {
        const task = currentTask();
        const defaults = DEFAULT_PROMPTS[task.id];
        if (!defaults) { toastError('该任务无默认提示词'); return; }
        if (confirm('确定恢复默认提示词吗？自定义修改将丢失')) {
            editingBlocks = structuredClone(defaults);
            refreshBlocks(container);
        }
    });

    // 导出提示词
    const exportBlocks = container.querySelector('#fw-block-export');
    if (exportBlocks) exportBlocks.addEventListener('click', () => {
        const task = currentTask();
        const blocks = editingBlocks || [];
        if (!blocks.length) { toastError('当前任务无提示词可导出'); return; }
        const asJson = confirm('导出为 JSON 格式？\n「确定」= JSON，「取消」= TXT');
        const fname = `ananke-prompt-${task.id}`;
        if (asJson) {
            downloadFile(`${fname}.json`, JSON.stringify(blocks, null, 2), 'application/json');
        } else {
            const text = blocks.map((b) => `[${(b.role || 'user').toUpperCase()}]\n${b.content}`).join('\n\n');
            downloadFile(`${fname}.txt`, text);
        }
        toastSuccess('✅ 提示词已导出');
    });

    // 导入提示词
    const importBlocks = container.querySelector('#fw-block-import');
    if (importBlocks) importBlocks.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.txt,application/json,text/plain';
        input.onchange = async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const blocks = parsePromptText(text, file.name);
                if (!blocks.length) { toastError('未解析到提示词内容'); return; }
                editingBlocks = blocks;
                refreshBlocks(container);
                toastSuccess(`✅ 已导入 ${blocks.length} 个对话块`);
            } catch (err) {
                toastError(`导入失败：${err?.message || err}`);
            }
        };
        input.click();
    });

    // 保存
    const save = container.querySelector('#fw-task-save');
    if (save) save.addEventListener('click', () => {
        saveCurrentTask(container);
    });
    const saveAll = container.querySelector('#fw-task-save-all');
    if (saveAll) saveAll.addEventListener('click', () => {
        saveCurrentTask(container);
        saveSettings();
        toastSuccess('✅ 全部配置已保存');
    });

    bindApiSection(container);
    bindWorldbook(container);
}

/** 世界书选择：添加 / 删除手动追加的世界书（聊天级） */
function bindWorldbook(container) {
    const store = getStore();
    const input = container.querySelector('#fw-wb-input');
    const addBtn = container.querySelector('#fw-wb-add');

    const add = () => {
        const name = input?.value?.trim();
        if (!name) { toastError('请输入世界书名'); return; }
        if (!Array.isArray(store.manual_worldbooks)) store.manual_worldbooks = [];
        if (store.manual_worldbooks.includes(name)) { toastError('该世界书已在列表中'); return; }
        store.manual_worldbooks.push(name);
        saveStore();
        toastSuccess(`✅ 已追加世界书「${name}」`);
        renderConfigPanel(container);
    };

    if (addBtn) addBtn.addEventListener('click', add);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

    container.querySelectorAll('.fw-wb-del').forEach((btn) => {
        btn.addEventListener('click', () => {
            const i = Number(btn.dataset.i);
            if (!Array.isArray(store.manual_worldbooks)) return;
            const removed = store.manual_worldbooks.splice(i, 1)[0];
            saveStore();
            toastSuccess(`✅ 已移除「${removed}」`);
            renderConfigPanel(container);
        });
    });
}

/** API 配置区：获取模型 / 测试连接 / 另存为预设 / 应用 / 删除 */
function bindApiSection(container) {
    const readApi = () => ({
        url: container.querySelector('#fw-global-url')?.value?.trim() || '',
        key: container.querySelector('#fw-global-key')?.value?.trim() || '',
        model: container.querySelector('#fw-global-model')?.value?.trim() || '',
    });

    const fetchBtn = container.querySelector('#fw-fetch-models');
    if (fetchBtn) fetchBtn.addEventListener('click', async () => {
        const { url, key } = readApi();
        if (!url || !key) { toastError('请先填写 API 地址和 Key'); return; }
        fetchBtn.disabled = true;
        fetchBtn.textContent = '加载中…';
        try {
            const models = await fetchModels(url, key);
            renderModelList(container, models);
            toastSuccess(`✅ 已加载 ${models.length} 个模型`);
        } catch (e) {
            toastError(`获取模型失败：${e?.message || e}`);
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.textContent = '获取模型';
        }
    });

    const testBtn = container.querySelector('#fw-test-api');
    if (testBtn) testBtn.addEventListener('click', async () => {
        const { url, key } = readApi();
        if (!url || !key) { toastError('请先填写 API 地址和 Key'); return; }
        testBtn.disabled = true;
        testBtn.textContent = '测试中…';
        try {
            const models = await testConnection(url, key);
            toastSuccess(`✅ 连接成功，可用模型 ${models.length} 个`);
        } catch (e) {
            toastError(`连接失败：${e?.message || e}`);
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = '测试连接';
        }
    });

    const savePreset = container.querySelector('#fw-save-preset');
    if (savePreset) savePreset.addEventListener('click', () => {
        const { url, key, model } = readApi();
        if (!url || !key) { toastError('请先填写 API 地址和 Key'); return; }
        const name = prompt('预设名称：', `预设${new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')}`);
        if (name == null) return;
        upsertApiPreset(name, { url, key, model });
        // 同步当前生效 API，避免重渲染后输入框回退旧值
        const settings = getSettings();
        settings.global_api = { mode: 'inherit', url, key, model };
        saveSettings();
        toastSuccess('✅ 已另存为预设');
        renderConfigPanel(container);
    });

    const applyPreset = container.querySelector('#fw-apply-preset');
    if (applyPreset) applyPreset.addEventListener('click', () => {
        const sel = container.querySelector('#fw-preset-select')?.value;
        if (!sel) { toastError('暂无预设可选'); return; }
        applyApiPreset(sel);
        toastSuccess('✅ 已应用预设');
        renderConfigPanel(container);
    });

    const delPreset = container.querySelector('#fw-delete-preset');
    if (delPreset) delPreset.addEventListener('click', () => {
        const sel = container.querySelector('#fw-preset-select')?.value;
        if (!sel) { toastError('暂无预设可选'); return; }
        if (confirm('确定删除该预设吗？')) {
            deleteApiPreset(sel);
            toastSuccess('✅ 预设已删除');
            renderConfigPanel(container);
        }
    });
}

/** 渲染模型列表（点击填入模型输入框） */
function renderModelList(container, models) {
    const host = container.querySelector('#fw-model-list');
    if (!host) return;
    host.style.display = 'block';
    host.innerHTML = models.map((m) => `<button class="fw-model-chip" type="button">${escapeHtml(m)}</button>`).join('');
    host.querySelectorAll('.fw-model-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const input = container.querySelector('#fw-global-model');
            if (input) input.value = chip.textContent;
        });
    });
}

function refreshBlocks(container) {
    const host = container.querySelector('#fw-prompt-blocks');
    if (host) host.innerHTML = blocksListHtml();
    // 重新绑定块操作
    container.querySelectorAll('.fw-role-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            editingBlocks[Number(btn.dataset.idx)].role = btn.dataset.role;
            refreshBlocks(container);
        });
    });
    container.querySelectorAll('.fw-block-move').forEach((btn) => {
        btn.addEventListener('click', () => {
            const i = Number(btn.dataset.idx);
            const j = i + Number(btn.dataset.dir);
            if (j < 0 || j >= editingBlocks.length) return;
            [editingBlocks[i], editingBlocks[j]] = [editingBlocks[j], editingBlocks[i]];
            refreshBlocks(container);
        });
    });
    container.querySelectorAll('.fw-block-del').forEach((btn) => {
        btn.addEventListener('click', () => {
            const i = Number(btn.dataset.idx);
            if (confirm('确定删除该对话块吗？')) { editingBlocks.splice(i, 1); refreshBlocks(container); }
        });
    });
    container.querySelectorAll('.fw-block-content').forEach((ta) => {
        ta.addEventListener('input', () => {
            editingBlocks[Number(ta.dataset.idx)].content = ta.value;
        });
    });
}

function saveCurrentTask(container) {
    const task = currentTask();
    if (!task) return;

    const val = (id) => container.querySelector(id)?.value;

    task.name = val('#fw-task-name') || task.name;
    task.enabled = container.querySelector('#fw-task-enabled')?.checked ?? task.enabled;
    task.stage = Number(val('#fw-task-stage')) || 0;
    task.frequency = Number(val('#fw-task-frequency')) || 1;
    task.order = Number(val('#fw-task-order')) || 1;
    task.historyTurns = Number(val('#fw-task-history')) || 6;
    task.minReplyLength = Number(val('#fw-task-minlen')) || 0;
    task.maxRetries = Number(val('#fw-task-maxretries')) || 3;
    const dt = defaultTagsFor(task);
    task.extractTags = val('#fw-task-extract') || dt.extract;
    task.storeTags = val('#fw-task-store') || dt.store;
    task.exclude_tags = val('#fw-task-exclude') || dt.exclude;
    task.prompt_blocks = structuredClone(editingBlocks);

    // 全局设置
    const settings = getSettings();
    settings.final_directive = val('#fw-global-directive') || DEFAULT_FINAL_DIRECTIVE;
    settings.global_api = {
        mode: settings.global_api?.mode || 'inherit',
        url: val('#fw-global-url') || '',
        key: val('#fw-global-key') || '',
        model: val('#fw-global-model') || '',
    };

    saveSettings();
    toastSuccess('✅ 配置已保存');
    renderConfigPanel(container);
}

/**
 * 面板一：大纲（方案 A · 命运织卷 羊皮卷轴风）
 * 卷首 / 世界档案 / 命运阶段轨道 + 章节卡 / 世界编年史 / 迷雾防剧透
 */
import { getStore, saveStore } from '../store.js';
import { triggerTaskNow } from '../scheduler.js';
import { parseTask1Output } from '../parser.js';
import { escapeHtml, downloadFile } from '../utils.js';
import { emptyState } from './widgets.js';
import { toastSuccess, toastError } from './toast.js';

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function cnNum(n) {
    const x = Number(n) || 0;
    if (x <= 10) return CN[x];
    return String(x);
}

/** 解析世界观核心摘要 → { 体系, 势力[], 暗线 } */
function parseWorldSummary(raw) {
    const r = { 体系: '', 势力: [], 暗线: '' };
    const text = String(raw || '');

    // 实力体系：新格式「体系名称：X」（1.3），兼容旧「实力体系：X」
    const m1 = text.match(/体系名称[：:]\s*([^|｜\n]+)/) || text.match(/实力体系[：:]\s*([^\n]+)/);
    if (m1) r.体系 = m1[1].trim();

    // 核心矛盾/暗线：新格式「矛盾 #N：名」（1.4），兼容旧「核心暗线：X」
    const m2 = text.match(/矛盾\s*#\s*\d*\s*[：:]\s*([^\n]+)/);
    if (m2) r.暗线 = m2[1].trim();
    if (!r.暗线) {
        const m2b = text.match(/核心暗线[：:]\s*([^\n]+)/);
        if (m2b) r.暗线 = m2b[1].trim();
    }

    // 主要势力：新格式「▸ 重要组织」下的 - 组织名（1.5），兼容旧「主要势力：- 势力」
    const orgBlock = text.match(/重要组织[\s\S]*?(?=\n\s*▸|\n\s*━━|$)/);
    if (orgBlock) {
        r.势力 = orgBlock[0].split('\n')
            .map((l) => l.trim())
            .filter((l) => l.startsWith('-'))
            .map((l) => l.replace(/^-\s*/, '').split(/[：:]/)[0].trim())
            .filter(Boolean);
    }
    if (!r.势力.length) {
        const m3 = text.match(/主要势力[：:]\s*([\s\S]*?)(?=\n核心暗线|$)/);
        if (m3) {
            r.势力 = m3[1].split('\n')
                .map((l) => l.trim().replace(/^[-•·▪◦]\s*/, ''))
                .filter(Boolean);
        }
    }
    return r;
}

/** 世界档案：经线 1.1~1.5 五折叠块（方案 A 纯净折叠，复用 a-kv 视觉） */
function renderArchive(parsed) {
    const b = (open, title, sub, body) => `
        <div class="a-arch${open ? ' open' : ''}">
            <button class="a-arch-head" type="button"><span class="a-arch-gem">✦</span><span class="a-arch-title">${title}</span><span class="a-arch-hint">${sub}</span></button>
            <div class="a-arch-body">${body}</div>
        </div>`;
    const kv = (k, v) => `<div class="a-arch-kv"><b>${escapeHtml(k)}：</b>${escapeHtml(v)}</div>`;

    if (!parsed) {
        return `<div class="a-empty">世界档案尚未生成（等待 Task1.5 世界全景摘要）</div>`;
    }

    // 1.1 世界基础（默认展开）
    const baseKvs = [];
    if (parsed.worldName) baseKvs.push(kv('世界名', parsed.worldName));
    if (parsed.era) baseKvs.push(kv('纪元', parsed.era));
    if (parsed.type) baseKvs.push(kv('类型', parsed.type));
    if (parsed.law) baseKvs.push(kv('世界法则', parsed.law));
    const s11 = b(true, '世界基础', '世界名 · 纪元 · 法则', baseKvs.join('') || '<span class="a-empty">—</span>');

    // 1.2 世界全景（默认收起）
    const s12 = b(false, '世界全景', '山河长卷', parsed.overview ? `<div class="a-arch-kv">${escapeHtml(parsed.overview)}</div>` : '<span class="a-empty">—</span>');

    // 1.3 实力体系（默认收起）
    const lvs = (parsed.powerSystem?.等级 || []).map((l) => `
        <div class="a-arch-lvl">
            <span class="a-arch-lvl-name">${escapeHtml(l.name || '')}</span>${l.lvLow ? `<span class="a-arch-lvl-range">Lv ${l.lvLow}-${l.lvHigh}</span>` : ''}
            ${l.战力 ? `<div class="a-arch-lvl-row"><b>战力</b>${escapeHtml(l.战力)}</div>` : ''}
            ${l.地位 ? `<div class="a-arch-lvl-row"><b>地位</b>${escapeHtml(l.地位)}</div>` : ''}
            ${l.突破 ? `<div class="a-arch-lvl-row"><b>突破</b>${escapeHtml(l.突破)}</div>` : ''}
        </div>`).join('');
    const s13 = b(false, '实力体系', '层级 · 突破', `
        ${parsed.powerSystem?.名称 ? kv('体系名称', parsed.powerSystem.名称) : ''}
        ${parsed.powerSystem?.来源 ? kv('力量来源', parsed.powerSystem.来源) : ''}
        ${lvs ? `<div class="a-arch-sub open"><button class="a-arch-sub-head">等级阶梯<span class="a-arch-sub-n">从低到高</span></button><div class="a-arch-sub-body">${lvs}</div></div>` : ''}
        ${parsed.powerSystem?.成长路径 ? `<div class="a-arch-sub"><button class="a-arch-sub-head">成长之路</button><div class="a-arch-sub-body"><div class="a-arch-kv">${escapeHtml(parsed.powerSystem.成长路径)}</div></div></div>` : ''}`);

    // 1.4 核心矛盾（默认展开）
    const confs = (parsed.conflicts || []).map((c) => {
        const desc = String(c.desc || '').split('\n').map((l) => l.trim()).filter(Boolean)
            .map((l) => `<div class="a-arch-conf-row">${escapeHtml(l)}</div>`).join('');
        return `<div class="a-arch-sub"><button class="a-arch-sub-head">${escapeHtml(c.name || '')}<span class="a-arch-sub-n">矛盾 #${c.num ?? '?'}</span></button><div class="a-arch-sub-body"><div class="a-arch-conf">${desc}</div></div></div>`;
    }).join('');
    const s14 = b(true, '核心矛盾', '命运暗流', confs + (parsed.conflictRelation ? kv('矛盾关联', parsed.conflictRelation) : ''));

    // 1.5 补充索引（默认收起）
    const idx = parsed.index || {};
    const sub = (name, items) => (items && items.length) ? `<div class="a-arch-sub"><button class="a-arch-sub-head">${name}<span class="a-arch-sub-n">${items.length}</span></button><div class="a-arch-sub-body">${items.map((x) => `<div class="a-arch-it">${escapeHtml(x)}</div>`).join('')}</div></div>` : '';
    const s15 = b(false, '补充索引', '组织 · 地点 · 生态 · 经济',
        sub('重要组织', idx.组织) + sub('关键地点', idx.地点) + sub('危险生态速查', idx.生态) +
        (idx.经济 ? `<div class="a-arch-sub"><button class="a-arch-sub-head">经济速查</button><div class="a-arch-sub-body"><div class="a-arch-kv">${escapeHtml(idx.经济)}</div></div></div>` : '') +
        sub('历史遗留', idx.历史遗留));

    return s11 + s12 + s13 + s14 + s15;
}

/** 解析世界事件时间线 → [{ date, event, use }]（新格式：- 时间：事件 → 用途：X） */
function parseTimeline(raw) {
    const items = [];
    const text = String(raw || '');
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        // 新格式：- {{时间}}：{{事件}} → 用途：{{用途}}
        const m = t.match(/^-\s*(.+?)[：:]\s*(.+)$/);
        if (m) {
            const date = m[1].trim();
            const rest = m[2].trim();
            const useIdx = rest.indexOf('→ 用途');
            let event = rest;
            let use = '';
            if (useIdx >= 0) {
                event = rest.slice(0, useIdx).trim();
                use = rest.slice(useIdx).replace(/^→\s*用途[：:]\s*/, '').trim();
            } else if (rest.includes('→')) {
                const idx = rest.indexOf('→');
                event = rest.slice(0, idx).trim();
                use = rest.slice(idx + 1).trim();
            }
            items.push({ date, event, use });
            continue;
        }
        // 旧格式兜底：2024.01.01 事件 → 用途
        const om = t.match(/^(\d{4}\.\d{1,2}\.\d{1,2})[：:\s]+(.+)$/);
        if (om) {
            const rest = om[2];
            const idx = rest.indexOf('→');
            items.push({ date: om[1], event: (idx >= 0 ? rest.slice(0, idx) : rest).trim(), use: idx >= 0 ? rest.slice(idx + 1).trim() : '' });
        }
    }
    return items;
}

/** 提取主题引言（首对中文/英文引号内容），返回 { quote, rest } */
function extractQuote(text) {
    const s = String(text || '');
    const m = s.match(/["“”「]([^"“”」]+)["“”」]/);
    if (m) return { quote: m[1].trim(), rest: s.replace(m[0], '').trim() };
    return { quote: '', rest: s.trim() };
}

export function renderOutlinePanel(container) {
    container.innerHTML = buildHtml();
    bind(container);
}

function buildHtml() {
    const store = getStore();
    const outline = store.outline;

    if (!outline) {
        return `<div class="fw-panel">
            ${emptyState('尚未生成大纲。可在下方点击「初始化大纲」，或让对话进行以自动生成。')}
            <div class="fw-toolbar"><button class="fw-btn" id="fw-outline-rewrite">初始化大纲</button></div>
        </div>`;
    }

    const currentStage = store.current_stage || 1;
    const worldName = outline.worldName || '未命名世界';
    const stageCount = outline.stages?.length || 0;
    const curStageObj = outline.stages?.find((s) => s.num === currentStage);
    const curStageLabel = curStageObj ? `第${cnNum(curStageObj.num)}章 · ${curStageObj.title}` : `第${cnNum(currentStage)}章`;
    const pct = stageCount ? Math.round(((currentStage - 1) / stageCount) * 100) : 0;

    // 世界档案：用结构化 world_summary_parsed 渲染
    const parsed = store.world_summary_parsed;
    const tl = parseTimeline(outline.timeline);

    const trackHtml = (outline.stages || []).map((s) => trackNode(s, currentStage)).join('');
    const chaptersHtml = (outline.stages || []).map((s) => chapterCard(s, currentStage)).join('');
    const timelineHtml = tl.length
        ? tl.map((it) => `
            <div class="a-tl-item">
                <b>${escapeHtml(it.date)}</b> ${escapeHtml(it.event)}
                ${it.use ? `<span class="a-tl-use">→ ${escapeHtml(it.use)}</span>` : ''}
            </div>`).join('')
        : '<div class="a-empty">暂无时间线</div>';

    const archiveHtml = renderArchive(parsed);

    return `
        <div class="fw-panel">
            <div class="fw-outline-reveal">
                <div class="fw-outline-content">
                    <div class="a-scroll">
                        <div class="a-ornament">✦ 命 运 织 线 ✦</div>
                        <div class="a-world">${escapeHtml(worldName)}</div>
                        <div class="a-sub">命运总纲 · ${stageCount ? cnNum(stageCount) + '幕史诗' : '未分幕'}</div>
                        <div class="a-meta">
                            <span>⏳ 当前：${escapeHtml(curStageLabel)}</span>
                            <span>进度 ${currentStage} / ${stageCount}</span>
                        </div>
                        <div class="a-progress"><i style="width:${pct}%"></i></div>

                        ${outline.principles ? `<div class="a-note">${escapeHtml(outline.principles)}</div>` : ''}

                        <div class="a-sec">
                            <div class="a-sec-title">📜 世界档案</div>
                            <div class="a-archive">${archiveHtml}</div>
                        </div>

                        <div class="a-sec">
                            <div class="a-sec-title">🧭 命运阶段</div>
                            <div class="a-track">${trackHtml}</div>
                            <div class="a-chapters">${chaptersHtml}</div>
                        </div>

                        <div class="a-sec">
                            <div class="a-sec-title">🕰 世界编年史</div>
                            <div class="a-tl">${timelineHtml}</div>
                        </div>

                        <div class="fw-toolbar">
                            <button class="fw-btn" id="fw-outline-rewrite">初始化大纲</button>
                            <button class="fw-btn" id="fw-outline-export">导出大纲</button>
                            <button class="fw-btn" id="fw-outline-import">导入大纲</button>
                        </div>
                    </div>
                </div>

                <div class="fw-mist" id="fw-mist">
                    <div class="fw-mist-fog fw-fog-a"></div>
                    <div class="fw-mist-fog fw-fog-b"></div>
                    <div class="fw-mist-fog fw-fog-c"></div>
                    <div class="fw-mist-core">
                        <div class="fw-mist-ornament">✦</div>
                        <div class="fw-mist-world">${escapeHtml(worldName)}</div>
                        <div class="fw-mist-sub">命运之卷 · 被迷雾遮蔽</div>
                        <div class="fw-mist-question" id="fw-mist-question">轻触迷雾，聆听命运的询问</div>
                        <div class="fw-mist-taps" id="fw-mist-taps">
                            <span class="fw-mist-tap" data-i="0">✦</span>
                            <span class="fw-mist-tap" data-i="1">✦</span>
                            <span class="fw-mist-tap" data-i="2">✦</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

function trackNode(stage, currentStage) {
    const state = stage.num < currentStage ? 'done' : stage.num === currentStage ? 'cur' : '';
    const mark = state === 'done' ? '✓' : state === 'cur' ? '◆' : String(stage.num);
    return `<div class="a-node ${state}"><div class="a-dot">${mark}</div><span>第${cnNum(stage.num)}章</span></div>`;
}

function chapterCard(stage, currentStage) {
    const state = stage.num < currentStage ? 'done' : stage.num === currentStage ? 'current' : 'locked';
    const stateIcon = state === 'done' ? '✓' : state === 'current' ? '⏳' : '🔒';
    const openCls = state === 'current' ? 'a-chapter-open' : '';
    return `
        <div class="a-chapter a-chapter-${state} ${openCls}">
            <button class="a-chapter-head" type="button">
                <span class="a-chapter-num">第${cnNum(stage.num)}章</span>
                <span class="a-chapter-title">${escapeHtml(stage.title)}</span>
                <span class="a-chapter-lv">${escapeHtml(stage.levelRange)}</span>
                <span class="a-chapter-state">${stateIcon}</span>
            </button>
            <div class="a-chapter-body">${chapterDetailHtml(stage)}</div>
        </div>`;
}

function chapterDetailHtml(stage) {
    const rows = [];

    if (stage['核心矛盾']) {
        rows.push(`<div class="a-block a-block-core"><div class="a-block-label">核心矛盾</div><div class="a-block-text">${escapeHtml(stage['核心矛盾'])}</div></div>`);
    }

    if (stage['核心叙事主题']) {
        const { quote, rest } = extractQuote(stage['核心叙事主题']);
        const inner = [];
        if (quote) inner.push(`<div class="a-quote">“${escapeHtml(quote)}”</div>`);
        if (rest) inner.push(`<div class="a-block-text">${escapeHtml(rest)}</div>`);
        if (inner.length) rows.push(`<div class="a-block"><div class="a-block-label">核心叙事主题</div>${inner.join('')}</div>`);
    }

    if (stage['地理活动范围'] || stage['事件推荐部署地图']) {
        rows.push(infoBlock('地理活动范围', stage['地理活动范围'] || stage['事件推荐部署地图']));
    }
    if (stage['可交互势力']) {
        rows.push(infoBlock('可交互势力', stage['可交互势力']));
    }
    if (stage['NPC交互层级']) {
        rows.push(infoBlock('NPC交互层级', stage['NPC交互层级']));
    }
    if (stage['推荐投放资源']) {
        rows.push(infoBlock('推荐投放资源', stage['推荐投放资源']));
    }
    if (stage['推荐投放事件']) {
        rows.push(infoBlock('推荐投放事件', stage['推荐投放事件']));
    }
    if (stage['阶段串联事件']) {
        rows.push(infoBlock('阶段串联事件', stage['阶段串联事件']));
    }

    if (stage['阶段转换触发条件']) {
        rows.push(`<div class="a-block"><div class="a-block-label">阶段转换触发条件</div><div class="a-cond">${escapeHtml(stage['阶段转换触发条件'])}</div></div>`);
    }
    if (stage['矛盾线索许可'] || stage['暗线揭露许可']) {
        rows.push(infoBlock('矛盾线索许可', stage['矛盾线索许可'] || stage['暗线揭露许可']));
    }

    if (stage['投放禁令']) {
        rows.push(`<div class="a-ban">🚫 ${escapeHtml(stage['投放禁令'])}</div>`);
    }

    return rows.join('') || '<div class="a-empty">（无详细内容）</div>';
}

function infoBlock(label, text) {
    return `<div class="a-block"><div class="a-block-label">${escapeHtml(label)}</div><div class="a-block-text">${escapeHtml(text)}</div></div>`;
}

/** 迷雾防剧透：连续点击 3 次，命运女神三连问后揭示大纲 */
function bindMist(container) {
    const mist = container.querySelector('#fw-mist');
    if (!mist) return;

    const question = mist.querySelector('#fw-mist-question');
    const taps = mist.querySelectorAll('.fw-mist-tap');
    const QUESTIONS = [
        '「勇士，你当真要窥见确切的命运吗？看清之后，前路便再无惊喜可言。」',
        '「命运之线一旦展开，便再也无法装作不知。你仍要掀开这层迷雾？」',
        '「最后问你一次——你确定，要把这卷织好的命运，完整地摊开在眼前吗？」',
    ];
    let count = 0;

    mist.addEventListener('click', () => {
        if (mist.classList.contains('fw-mist-reveal')) return;

        if (count < 3) {
            if (question) {
                question.textContent = QUESTIONS[count];
                question.classList.remove('fw-mist-q-in');
                void question.offsetWidth;
                question.classList.add('fw-mist-q-in');
            }
            if (taps[count]) taps[count].classList.add('on');
            count++;
        }

        if (count >= 3) {
            mist.classList.add('fw-mist-reveal');
            setTimeout(() => mist.remove(), 1400);
        }
    });
}

function bind(container) {
    bindMist(container);

    // 章节卡片折叠
    container.querySelectorAll('.a-chapter-head').forEach((head) => {
        head.addEventListener('click', () => {
            head.parentElement.classList.toggle('a-chapter-open');
        });
    });

    // 世界档案折叠（5 折叠块 + 二级子标题）
    container.querySelectorAll('.a-arch-head').forEach((head) => {
        head.addEventListener('click', () => head.parentElement.classList.toggle('open'));
    });
    container.querySelectorAll('.a-arch-sub-head').forEach((head) => {
        head.addEventListener('click', () => head.parentElement.classList.toggle('open'));
    });

    // 初始化大纲
    const rewrite = container.querySelector('#fw-outline-rewrite');
    if (rewrite) rewrite.addEventListener('click', () => {
        if (confirm('确定要重新生成完整大纲吗？（覆盖当前大纲）')) {
            rewrite.textContent = '⏳ 生成中...';
            rewrite.disabled = true;
            triggerTaskNow('task1');
            toastSuccess('已请求初始化大纲，生成中…');
        }
    });

    // 导出大纲
    const exp = container.querySelector('#fw-outline-export');
    if (exp) exp.addEventListener('click', () => {
        const store = getStore();
        downloadFile('ananke-outline.txt', store.outline?.raw || '(空)');
        toastSuccess('✅ 大纲已导出');
    });

    // 导入大纲
    const importBtn = container.querySelector('#fw-outline-import');
    if (importBtn) importBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.json,text/plain,application/json';
        input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                let outline = null;
                // 优先尝试 JSON 里的 outline 对象
                try {
                    const obj = JSON.parse(text);
                    if (obj?.stages) outline = obj;
                    else if (obj?.outline?.stages) outline = obj.outline;
                } catch { /* 非 JSON，走原文解析 */ }
                if (!outline) outline = parseTask1Output(text);
                if (!outline?.stages?.length) {
                    toastError('导入失败：无法从文件解析出大纲');
                    return;
                }
                const store = getStore();
                store.outline = outline;
                if (outline.stages.length && !store.current_stage) store.current_stage = outline.stages[0].num;
                saveStore();
                toastSuccess('✅ 大纲已导入');
                renderOutlinePanel(container);
            } catch (err) {
                toastError(`导入失败：${err?.message || err}`);
            }
        };
        input.click();
    });
}

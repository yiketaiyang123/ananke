/**
 * 面板二：事件 & 场景（v1.8 折叠式组合布局）
 * 状态横幅 / 任务链（任务梗概四段 + 事件链 + 最终结局，折叠）/ 场景（开放画卷 / 封闭星图）/ 伏笔 / 边界
 * 术语与字段以默认提示词为准：任务时限 · 事件链 · 事件 N · 任务梗概 · 最终结局 · 区域结构 · 敌对总览 · 区域元素
 */
import { getStore } from '../store.js';
import { escapeHtml } from '../utils.js';
import { parseMap, parseTaskChain } from '../parser.js';

const NUM = '①②③④⑤⑥⑦⑧⑨⑩';

const esc = (v) => escapeHtml(String(v ?? ''));
const escn = (v) => escapeHtml(String(v ?? '')).replace(/\n/g, '<br>');

export function renderEventPanel(container) {
    container.innerHTML = buildHtml(container.clientWidth || 520);
    bind(container);
}

/** 面板二当前要显示的场景：开放场景（open_scene，每轮更新）或封闭地图（map，长期保留） */
function currentScene(store) {
    const openAsScene = store.open_scene ? { ...store.open_scene, type: 'open' } : null;
    if (store.scene_type === 'open') return openAsScene;
    if (store.scene_type === 'closed') return store.map || null;
    return store.map || openAsScene; // 旧存档兜底
}

function buildHtml(availW) {
    const store = getStore();
    const chainHtml = store.task_chain ? taskChainHtml(parseTaskChain(store.task_chain)) : noTaskHtml(store);
    const sceneHtml = mapHtml(currentScene(store), store, availW);
    const reminderHtml = remindersHtml(store);
    return `
        <div class="fw-panel">
            ${statusBannerHtml(store)}
            ${chainHtml}
            ${sceneHtml}
            ${reminderHtml}
        </div>`;
}

const CN2 = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十' };
function cnNum(n) { return CN2[n] || n; }

/* ---------------- 状态横幅 ---------------- */

function statusBannerHtml(store) {
    const c = store.clock || {};
    const lv = store.角色等级;
    return `
        <div class="e-banner">
            <span class="e-chip">${esc(c.历法日期 || `第${c.gameDay ?? 1}游戏日`)}</span>
            <span class="e-chip">第<b>${c.gameDay ?? 1}</b>游戏日</span>
            <span class="e-chip">节拍 <b>${esc(c.节拍 || '铺垫')}</b></span>
            <span class="e-chip">第<b>${cnNum(store.current_stage || 1)}</b>章</span>
            ${lv ? `<span class="e-chip">主角 <b>Lv ${lv}</b></span>` : ''}
            <span class="e-chip">冷却 <b>${c.冷却剩余 ?? 0}</b></span>
        </div>`;
}

/* ---------------- 无任务状态 ---------------- */

function noTaskHtml(store) {
    const cool = store.clock?.冷却剩余;
    const lr = store.last_result;
    let doneNote = '';
    if (lr && (lr.name || lr.结局)) {
        doneNote = `
            <div class="fw-done-note"><span class="ic">✦</span><div>
                <b>${esc(lr.name || '')} · 已完成</b>${lr.结局 ? `（${esc(lr.结局)}）` : ''}${lr.即时后果 ? `<br>${esc(lr.即时后果)}` : ''}
            </div></div>`;
    }
    return `
        <div class="e-sec">
            <div class="e-sec-t">任务链</div>
            ${doneNote}
            <div class="e-empty">
                <div class="fw-empty-glyph">✧</div>
                <div class="e-empty-title">无活跃任务 · 自由探索</div>
                ${cool ? `<div class="e-note-sub">冷却剩余：${cool} 游戏日</div>` : ''}
                <div class="e-empty-sub">建议行动：休整 / 购物 / 社交 / 接委托</div>
            </div>
        </div>`;
}

/* ---------------- 任务链（折叠式） ---------------- */

function taskChainHtml(tc) {
    if (!tc) return '';
    const head = `
        <div class="fw-plaque">
            <span class="fw-badge">#${esc(tc.id ?? '?')}</span>
            <span class="fw-pname" title="${esc(tc.name || '')}">${esc(tc.name || '')}</span>
        </div>
        <div class="e-task-meta">
            <span class="e-chip">状态 <b>${esc(tc.status || '活跃中')}</b></span>
            <span class="e-chip">当前事件 <b>${esc(tc.currentNode || '—')}</b></span>
            ${tc.任务时限 ? `<span class="e-chip fw-deadline">任务时限 <b>${esc(tc.任务时限)}</b></span>` : ''}
        </div>
        ${tc.stage ? `<div class="fw-kv"><b>阶段归属</b>${esc(tc.stage)}</div>` : ''}`;

    return `
        <div class="e-sec">
            <div class="e-sec-t">任务链</div>
            ${head}
            ${synopsisHtml(tc.梗概)}
            ${eventChainHtml(tc)}
            ${endingsHtml(tc.结局)}
        </div>`;
}

/** 任务梗概四段 → 折叠（默认展开）+ 2×2 宫格 */
function synopsisHtml(梗概) {
    if (!梗概) return '';
    const segs = [
        ['表面故事', 梗概.表面故事],
        ['真实原委', 梗概.真实原委],
        ['关键NPC', 梗概.关键NPC],
        ['核心矛盾', 梗概.核心矛盾],
    ].filter(([, v]) => v);
    if (!segs.length) return '';
    const grid = segs.map(([tag, v]) => `<div class="fw-syn"><span class="tag">${esc(tag)}</span><p>${escn(v)}</p></div>`).join('');
    return `
        <details class="fold" open style="margin-top:10px;">
            <summary><span class="s-t">任务梗概</span><span class="s-sub">${segs.map(([t]) => esc(t)).join(' / ')}</span></summary>
            <div class="fold-body"><div class="fw-syn-grid">${grid}</div></div>
        </details>`;
}

/** 事件链 → 垂直命运之线，每个事件一个折叠 */
function eventChainHtml(tc) {
    const events = tc.事件 || [];
    if (!events.length) return '';
    const curNum = String(tc.currentNode || '').match(/(\d+)/)?.[1] || '';
    let curIdx = events.findIndex((e) => e.idx === curNum);
    if (curIdx < 0) curIdx = 0; // 兜底：第一个事件为当前

    const items = events.map((e, i) => {
        const state = i < curIdx ? 'done' : i === curIdx ? 'cur' : 'lock';
        const mark = state === 'done' ? '✓' : esc(e.idx);
        const open = state === 'cur' ? ' open' : '';
        const detail = eventDetailHtml(e);
        return `
        <div class="fw-event ${state}">
            <span class="fw-knot">${mark}</span>
            <details class="fold"${open}>
                <summary><span class="fw-evtype">事件${esc(e.idx)} · ${esc(e.类型)}</span><span class="fw-evnm">${esc(e.名称)}</span></summary>
                ${detail ? `<div class="fold-body">${detail}</div>` : ''}
            </details>
        </div>`;
    }).join('');

    return `<div class="fw-thread">${items}</div>`;
}

function eventDetailHtml(e) {
    const rows = [
        ['NPC动作', e.NPC动作], ['NPC立场', e.NPC立场], ['NPC情绪', e.NPC情绪],
        ['可透露', e.可透露], ['必隐藏', e.必隐藏], ['视觉线索', e.视觉线索],
        ['反转触发', e.反转触发], ['敌对', e.敌对],
    ];
    let h = rows.filter(([, v]) => v).map(([k, v]) => `<div class="fw-detail-row"><b>${k}</b>${escn(v)}</div>`).join('');
    if (e.分支 && e.分支.length) {
        h += `<div class="fw-detail-row"><b>分支</b>${e.分支.map((b) => `<span class="fw-br">→ ${escn(b)}</span>`).join('')}</div>`;
    }
    return h;
}

/** 最终结局 → 三个按钮 + 点击弹出覆盖层（点开后盖住另外两个选项） */
function endingsHtml(ends) {
    if (!ends || !ends.length) return '';
    const btns = ends.map((e, i) => {
        const cls = e.类型 === '真结局' ? 'true' : e.类型 === '失败结局' ? 'fail' : '';
        return `<button class="fw-end-btn ${cls}" data-i="${i}" type="button">
            <span class="et">${esc(e.类型)}</span>
            <span class="en" title="${esc(e.名称)}">${esc(e.名称)}</span>
        </button>`;
    }).join('');
    return `<div class="fw-end-grid">
        ${btns}
        <div class="fw-end-pop" hidden>
            <div class="pop-head"><span class="pop-title"></span><button class="pop-close" type="button" aria-label="关闭">×</button></div>
            <div class="pop-body"></div>
        </div>
    </div>`;
}

/** 结局详情（弹出层正文） */
function endingDetailHtml(e) {
    const after = e.后续影响;
    let body = '';
    if (e.触发条件) body += `<div class="line"><b>触发</b>${esc(e.触发条件)}</div>`;
    if (e.即时后果) body += `<div class="line"><b>后果</b>${esc(e.即时后果)}</div>`;
    if (after) {
        const hasAfter = after.触发时间 || after.伏笔内容 || (after.伏笔演化 && after.伏笔演化.length);
        if (hasAfter) {
            body += `<div class="after-hd">后续影响</div>`;
            if (after.触发时间) body += `<div class="line"><b>触发时间</b>${esc(after.触发时间)}</div>`;
            if (after.伏笔内容) body += `<div class="line"><b>伏笔内容</b>${escn(after.伏笔内容)}</div>`;
            if (after.伏笔演化 && after.伏笔演化.length) body += `<div class="line"><b>伏笔演化</b>${after.伏笔演化.map((x) => `<span class="fw-br">${escn(x)}</span>`).join('')}</div>`;
        }
    }
    return body || '<div class="line">（无详情）</div>';
}

/* ---------------- 场景（开放 / 封闭） ---------------- */

function mapHtml(map, store, availW) {
    if (!map) return '';
    if (map.type === 'open') return openSceneHtml(map);
    const parsed = parseMap(map);
    if (!parsed || !parsed.regions.length) return '';
    return closedMapHtml(parsed, map, store, availW);
}

function openSceneHtml(map) {
    const loc = parseLocation(map);
    const atm = toChips(loc.atmosphere);
    const fac = toChips(loc.facilities);
    return `
        <div class="e-sec">
            <div class="e-sec-t">场景 · 开放</div>
            <div class="fw-hero">
                <div class="fw-loc"><small>OPEN SCENE</small>${esc(loc.name || '未知地点')}</div>
                ${loc.direction ? `<div class="fw-dir"><span>⟐</span>${esc(loc.direction)}</div>` : ''}
                ${loc.overview ? `<div class="fw-ov">${esc(loc.overview)}</div>` : ''}
                <div class="fw-crow">
                    ${atm.length ? `<div class="fw-cblock"><div class="fw-lbl">氛 围</div><div class="fw-chips">${atm.map((a) => `<span class="fw-chip atm">${esc(a)}</span>`).join('')}</div></div>` : ''}
                    ${fac.length ? `<div class="fw-cblock"><div class="fw-lbl">设 施</div><div class="fw-chips">${fac.map((f) => `<span class="fw-chip">${esc(f)}</span>`).join('')}</div></div>` : ''}
                </div>
            </div>
        </div>`;
}

function closedMapHtml(parsed, map, store, availW) {
    const raw = map.raw || '';
    const pick = (re) => { const m = raw.match(re); return m ? m[1].trim() : ''; };
    const structure = pick(/结构[：:]\s*([^|\n]+)/);
    const entrance = pick(/入口[：:]\s*([^|\n]+)/);
    const exit = pick(/出口[：:]\s*([^|\n]+)/);
    const total = pick(/总区域数[：:]\s*([^\n（(]+)/);

    const head = `
        <div class="fw-maphead">
            <span class="fw-maptitle">${esc(parsed.name || '未知')}</span>
            ${structure ? `<span class="fw-mapmeta">结构：${esc(structure)}</span>` : ''}
        </div>
        <div class="fw-mapkv">
            ${entrance ? `<b>入口</b>${esc(entrance)}　` : ''}${exit ? `<b>出口</b>${esc(exit)}　` : ''}${total ? `<b>总区域数</b>${esc(total)}` : ''}
        </div>`;

    const { pos, width, height, scale } = layoutMap(parsed.regions, parsed.current, availW);
    const fs = Math.max(8, Math.round(10 * scale));
    const lbW = Math.round(104 * scale);

    let lines = '';
    for (const r of parsed.regions) {
        const fp = pos[r.num];
        if (!fp) continue;
        for (const link of r.links) {
            const tp = pos[link.to];
            if (!tp) continue;
            lines += line(fp.x, fp.y, tp.x, tp.y);
        }
    }

    let nodes = '';
    for (const r of parsed.regions) {
        const p = pos[r.num];
        if (!p) continue;
        const isCur = r.num === parsed.current;
        const isDone = (map.explored || []).includes(r.num) || (r.state || '').indexOf('已探索') >= 0;
        const cls = isCur ? 'cur' : (isDone ? 'done' : 'lock');
        const numTok = NUM[r.num - 1] || r.num;
        const linksTxt = r.links.length ? `<div class="pconn">${r.links.map((l) => `${l.dir}[${NUM[l.to - 1] || l.to}] ${esc(l.desc)}`).join('<br>')}</div>` : '';
        nodes += `<div class="pnode ${cls}" style="left:${p.x}px;top:${p.y}px">
            <span class="pdot"></span>
            <span class="plb" style="font-size:${fs}px;max-width:${lbW}px"><i>${numTok}</i>${esc(r.name)}</span>
            ${isCur ? '<span class="pcur-mark">当前位置</span>' : ''}
            <div class="ptip"><b>${numTok} ${esc(r.name)}</b>${r.state ? `<br><span class="pstate">[${esc(r.state)}] · ${esc(r.tag)}</span>` : ''}${r.detail ? `<br>${escn(r.detail)}` : ''}${linksTxt}</div>
        </div>`;
    }

    const regionCards = parsed.regions.map((r) => {
        const effState = (map.explored || []).includes(r.num) && (!r.state || r.state === '未探索') ? '已探索' : r.state;
        return `
        <div class="fw-rcard" title="${esc(r.detail || '')}">
            <div class="n"><i>${NUM[r.num - 1] || r.num}</i>${esc(r.name)} <span class="s">[${esc(effState)}]${r.tag ? ' · ' + esc(r.tag) : ''}</span></div>
            ${r.detail ? `<div class="det fw-clamp2">${escn(r.detail)}</div>` : ''}
            ${r.links.length ? `<div class="conn">${r.links.map((l) => `${l.dir}[${NUM[l.to - 1] || l.to}] ${esc(l.desc)}`).join(' · ')}</div>` : ''}
        </div>`;
    }).join('');

    const foldExtra = `
        <details class="fold" style="margin-top:12px;">
            <summary><span class="s-t">敌对总览 / 区域元素 / 边界提醒</span><span class="s-sub">敌对 ${parsed.foes.length} · 元素 ${parsed.elements.length} · 边界 ${parsed.bounds.length}</span></summary>
            <div class="fold-body">
                ${parsed.foes.length ? `<div class="fw-detail-row"><b>敌对总览</b>${parsed.foes.map((f) => `<span class="fw-br">· ${escn(f)}</span>`).join('')}</div>` : ''}
                ${parsed.elements.length ? `<div class="fw-detail-row"><b>区域元素</b>${parsed.elements.map((el) => `<span class="fw-br">· ${escn(el)}</span>`).join('')}</div>` : ''}
                ${parsed.bounds.length ? `<div class="fw-detail-row"><b>边界提醒</b>${parsed.bounds.map((b) => `<span class="fw-br">${escn(b)}</span>`).join('')}</div>` : ''}
            </div>
        </details>`;

    return `
        <div class="e-sec">
            <div class="e-sec-t">场景 · 封闭</div>
            ${head}
            <div class="e-drag-hint">地图可滚动 · 悬停节点看详情</div>
            <div class="amap-wrap"><div class="amap" style="width:${width}px;height:${height}px">
                <div class="amap-terrain"></div>
                <svg class="amap-lines" width="${width}" height="${height}">${lines}</svg>
                ${nodes}
                <div class="amap-compass"><span class="nd"></span></div>
                <div class="amap-legend"><span class="i cur"></span>当前位置<span class="i done"></span>已探索<span class="i lock"></span>未探索</div>
            </div></div>
            <div class="fw-rlist">${regionCards}</div>
            ${foldExtra}
            <div class="fw-toolbar"><button class="fw-btn fw-btn-mini" id="fw-event-map-zoom">重置视野</button></div>
        </div>`;
}

/* ---------------- 伏笔 + 边界 ---------------- */

function remindersHtml(store) {
    const foreshadowing = store.foreshadowing || [];
    const bounds = getBounds(store);
    let html = '';
    if (foreshadowing.length) {
        const rows = foreshadowing.map((f, i) => {
            const stamp = f.状态 === '已回收' ? 'done' : f.状态 === '待回收' ? 'wait' : 'sleep';
            return `<div class="fw-lrow"><span class="idx">${cnNum(i + 1)}</span><span class="nm" title="${esc(f.name)}">${esc(f.name)}</span><span class="fw-stamp ${stamp}">${esc(f.状态 || '沉睡中')}</span><span class="left">${f.剩余时间 ? esc(String(f.剩余时间)) : '—'}</span></div>`;
        }).join('');
        html += `
            <div class="e-sec">
                <div class="e-sec-t">伏笔记录</div>
                <div class="fw-ledger">
                    <div class="fw-ledger-head"><span class="c1">编号</span><span class="c2">伏笔</span><span class="c3">状态</span><span class="c4">剩余</span></div>
                    ${rows}
                </div>
            </div>`;
    }
    if (bounds.length) {
        html += `
            <div class="e-sec">
                <div class="e-sec-t">边界提醒</div>
                ${bounds.map((b) => `<div class="fw-warn"><span class="ic">🚫</span><div>${escn(b)}</div></div>`).join('')}
            </div>`;
    }
    return html;
}

function getBounds(store) {
    const m = store.map;
    if (!m || m.type !== 'closed') return [];
    const p = parseMap(m);
    return p ? (p.bounds || []) : [];
}

/* ---------------- 位置解析（开放场景） ---------------- */

function parseLocation(map) {
    const loc = { name: '', direction: '', overview: '', atmosphere: '', facilities: '' };
    if (!map) return loc;
    const raw = map.raw || '';
    if (map.name) loc.name = map.name;

    if (map.type === 'closed') {
        const ent = raw.match(/入口[：:]\s*([^|\n]+)/);
        const ext = raw.match(/出口[：:]\s*([^|\n]+)/);
        if (ent || ext) loc.direction = `${ent ? `入口：${ent[1].trim()}` : ''}${ent && ext ? ' | ' : ''}${ext ? `出口：${ext[1].trim()}` : ''}`;
    } else {
        const nameM = raw.match(/场景[：:]\s*([^\n]+)/) || raw.match(/【场景[·.]\s*([^】]+)】/);
        if (nameM && !loc.name) loc.name = nameM[1].trim();
        const dirM = raw.match(/方位[：:]\s*(.+)/);
        if (dirM) loc.direction = dirM[1].trim();
        const ovM = raw.match(/概述[：:]\s*(.+)/);
        if (ovM) loc.overview = ovM[1].trim();
        const atmM = raw.match(/氛围[：:]\s*(.+)/);
        if (atmM) loc.atmosphere = atmM[1].trim();
        const facBlock = raw.match(/设施[：:]\s*([\s\S]*?)(?=\n\s*氛围|$)/);
        if (facBlock) loc.facilities = facBlock[1].trim();
    }
    return loc;
}

function toChips(text) {
    return String(text || '').split(/[、，,;；\n]/).map((s) => s.trim()).filter(Boolean);
}

/* ---------------- 地图布局 ---------------- */

function layoutMap(regions, currentNum, availW) {
    const numMap = {};
    for (const r of regions) if (r.num) numMap[r.num] = r;
    const adj = {};
    for (const r of regions) adj[r.num] = [];
    for (const r of regions) {
        for (const l of r.links) {
            if (!numMap[l.to]) continue;
            adj[r.num].push(l.to);
            // 双向连接（dir 不以 ! 结尾）补反向边，保证 BFS 能从深处回溯
            if (!/!$/.test(l.dir || '')) {
                if (!adj[l.to]) adj[l.to] = [];
                adj[l.to].push(r.num);
            }
        }
    }

    // 分层：先以当前位置为根 BFS，再处理未连通的孤立分量（堆叠在下方，避免全部挤到 layer 99）
    const layerOf = {};
    const assigned = new Set();
    let cursor = -1;
    const bfs = (start) => {
        layerOf[start] = cursor + 1;
        assigned.add(start);
        const q = [start];
        while (q.length) {
            const n = q.shift();
            for (const t of (adj[n] || [])) {
                if (!assigned.has(t)) { assigned.add(t); layerOf[t] = layerOf[n] + 1; q.push(t); }
            }
        }
        cursor = Math.max(cursor, ...Object.values(layerOf));
    };
    if (numMap[currentNum]) bfs(currentNum);
    for (const r of regions) if (!assigned.has(r.num)) bfs(r.num);

    const layers = [];
    for (const r of regions) {
        const l = layerOf[r.num] ?? 0;
        if (!layers[l]) layers[l] = [];
        layers[l].push(r);
    }

    // 行距放宽到能容纳中文标签；padding 留白避免单列贴边被裁
    const maxPer = Math.max(1, ...layers.filter(Boolean).map((l) => l.length));
    const colW = 116, rowH = 92, pad = 72;
    const pos = {};
    for (let li = 0; li < layers.length; li++) {
        const layer = layers[li] || [];
        const startX = ((maxPer - layer.length) * colW) / 2 + pad;
        for (let ci = 0; ci < layer.length; ci++) {
            const r = layer[ci];
            pos[r.num] = { x: startX + ci * colW, y: pad + li * rowH };
        }
    }
    const naturalW = maxPer * colW + pad * 2;
    const naturalH = layers.length * rowH + pad * 2;

    // 只按宽度缩放（过高则交给 amap-wrap 滚动），保持标签可读
    // 预留 .fw-content 内边距(18×2) + .e-sec 内边距(12×2) + 边框，避免地图超宽
    const maxW = Math.max(180, (availW || 520) - 64);
    const scale = Math.min(1, maxW / naturalW);
    const fitPos = {};
    for (const k in pos) fitPos[k] = { x: pos[k].x * scale, y: pos[k].y * scale };
    return { pos: fitPos, width: naturalW * scale, height: naturalH * scale, scale };
}

function line(x1, y1, x2, y2) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(200,168,106,.5)" stroke-width="2"/>`;
}

/* ---------------- 绑定 ---------------- */

function bind(container) {
    // 最终结局：点击按钮 → 弹出覆盖层（盖住另外两个选项）
    const endGrid = container.querySelector('.fw-end-grid');
    if (endGrid) {
        const tc = parseTaskChain(getStore().task_chain);
        const ends = tc?.结局 || [];
        const pop = endGrid.querySelector('.fw-end-pop');
        const popTitle = endGrid.querySelector('.pop-title');
        const popBody = endGrid.querySelector('.pop-body');
        const popClose = endGrid.querySelector('.pop-close');
        const openPop = (i) => {
            const e = ends[Number(i)];
            if (!e || !pop) return;
            popTitle.textContent = `【${e.类型}】${e.名称}`;
            popTitle.className = 'pop-title ' + (e.类型 === '真结局' ? 'true' : e.类型 === '失败结局' ? 'fail' : '');
            popBody.innerHTML = endingDetailHtml(e);
            pop.hidden = false;
        };
        endGrid.querySelectorAll('.fw-end-btn').forEach((btn) => {
            btn.addEventListener('click', () => openPop(btn.dataset.i));
        });
        if (popClose) popClose.addEventListener('click', () => { pop.hidden = true; });
    }

    const zoom = container.querySelector('#fw-event-map-zoom');
    if (zoom) zoom.addEventListener('click', () => {
        container.querySelectorAll('.amap-wrap').forEach((w) => { w.scrollTo(0, 0); });
    });
}

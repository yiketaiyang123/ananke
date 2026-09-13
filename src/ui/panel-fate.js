/**
 * 面板三：命运之轮（命运长卷 · 时间线流 + 塔罗牌翻面）
 * 七张塔罗牌（点击翻面看效果）/ 竖向时间线（最近 5 条，可折叠）/ 出牌统计
 */
import { getStore, saveStore } from '../store.js';
import { triggerTaskNow } from '../scheduler.js';
import { escapeHtml } from '../utils.js';
import { collapsible, bindCollapsibles, emptyState } from './widgets.js';
import { toastSuccess } from './toast.js';

const CARDS = [
    { name: '背叛', icon: '🗡️', kind: '负', num: '①',
      dim: '信任崩塌 · 人际关系维度',
      essence: '被主角信任或不设防的存在反戈',
      anchor: '必须基于已存在的关系裂痕、利益冲突、或可推导的外部胁迫',
      express: '关键时刻倒戈、泄露情报、偷走关键道具、战斗中突然攻击主角' },
    { name: '贪婪', icon: '💰', kind: '负', num: '②',
      dim: '欲望吞噬 · 人性弱点维度',
      essence: '某角色被欲望驱使做出非理性行为，打破现有平衡',
      anchor: '必须有明确的「诱饵」——财宝/权力/禁忌知识/稀有资源，且须有合理来源',
      express: '抢夺战利品引发内讧、NPC因贪念触发陷阱/诅咒、盟友出卖情报' },
    { name: '嫉妒', icon: '💚', kind: '负', num: '③',
      dim: '嫉恨驱行 · 人性弱点维度',
      essence: '某角色因嫉恨做出破坏性行为（与背叛区别：嫉妒是情感驱动）',
      anchor: '必须存在「比较」的土壤——同门/竞争/单恋对象被吸引/主角获得对方渴望之物',
      express: '暗中使绊、散布谣言致误解、关键任务中故意失误、向敌人透露弱点' },
    { name: '邂逅', icon: '✨', kind: '中', num: '④',
      dim: '命定相遇 · 新连接维度',
      essence: '对剧情有重大影响潜力的角色以看似偶然的方式出现',
      anchor: '此人出现在此地必须有自己的理由（不是为主角而存在），身份实力须符合阶段权限',
      express: '酒馆偶遇、被同一敌人追杀、废墟中发现受伤陌生人、被卷入同一场意外' },
    { name: '幸运', icon: '🍀', kind: '正', num: '⑤',
      dim: '偶然眷顾 · 随机机遇维度',
      essence: '纯粹的、无法预见的好运降临',
      anchor: '概率上可以发生的事；禁止天降神器、禁止无代价逆天改命',
      express: '致命攻击被随身物品挡住、逃跑时发现隐藏通道、毒药恰好对体质无效' },
    { name: '恩赐', icon: '🎁', kind: '正', num: '⑥',
      dim: '意外援手 · 外部助力维度',
      essence: '来自外部的、未曾预料的善意（与幸运区别：背后一定有施予者）',
      anchor: '施予者须有动机——报恩/投资/怜悯/自己的算计',
      express: '陌生人出手相救、匿名线索、已故NPC遗物关键时刻被发现、敌对阵营中有人放水' },
    { name: '因果', icon: '⚖️', kind: '双', num: '⑦',
      dim: '旧账清算 · 过去的回响',
      essence: '过去的行为在此刻产生回响（唯一双面牌——善因善果，恶因恶果）',
      anchor: '【必须】能追溯到主角过去的一个具体行为或决策，否则禁止使用',
      express: '放走的敌人倒戈相助、救过的村民组织支援、羞辱过的小人物掌权后报复' },
];

export function renderFatePanel(container) {
    container.innerHTML = buildHtml();
    bindCollapsibles(container);
    bind(container);
}

function cnNum(n) { return ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n] || n; }

function buildHtml() {
    const store = getStore();
    const hist = store.fate_history || [];
    const plays = hist.filter((e) => !e.silent);
    const last = plays[plays.length - 1];
    const st = store.fate_stats || {};
    const stormThisStage = plays.filter((e) => e.strength?.includes('风暴') && e.stage === store.current_stage).length;

    const cards = CARDS.map((c) => {
        const cs = store.card_status?.[c.name] || { status: 'available', cooldownLeft: 0 };
        return cardHtml(c, cs.status === 'locked', cs.cooldownLeft || 0);
    }).join('');

    const recent = hist.slice(-5).reverse();
    const timeline = recent.length ? recent.map(nodeHtml).join('') : emptyState('命运之轮尚未转动');

    const banner = `
        <div class="f-banner">
            <span class="f-chip">阶段 <b>${cnNum(store.current_stage || 1)}</b></span>
            <span class="f-chip">距上次出牌 <b>${last ? `${store.round - last.round} 轮` : '—'}</b></span>
            <span class="f-chip">本阶段风暴 <b>${stormThisStage}/1</b></span>
            <span class="f-chip">总出牌 <b>${st.total || 0}</b></span>
        </div>`;

    const stats = `
        <div class="f-stats">
            <div class="f-stat"><span class="f-stat-k">总转动</span><span class="f-stat-v">${st.total || 0}</span></div>
            <div class="f-stat"><span class="f-stat-k">涟漪</span><span class="f-stat-v s-ripple">${st.ripple || 0}</span></div>
            <div class="f-stat"><span class="f-stat-k">浪潮</span><span class="f-stat-v s-wave">${st.wave || 0}</span></div>
            <div class="f-stat"><span class="f-stat-k">风暴</span><span class="f-stat-v s-storm">${st.storm || 0}</span></div>
            <div class="f-stat"><span class="f-stat-k">正/负</span><span class="f-stat-v">${st.pos || 0}/${st.neg || 0}</span></div>
        </div>`;

    return `
        <div class="fw-panel">
            <div class="f-scroll">
                <div class="f-orn">✦ 命 运 之 轮 ✦</div>
                ${banner}

                <div class="f-sec">
                    <div class="f-sec-t">七张命运牌 <span class="f-sec-hint">点牌翻面看效果</span></div>
                    <div class="f-cards">${cards}</div>
                </div>

                ${collapsible('◈ 命运长卷 · 最近 5 条记录', timeline, { defaultOpen: true })}

                <div class="f-sec">
                    <div class="f-sec-t">出牌统计</div>
                    ${stats}
                </div>

                <div class="fw-toolbar">
                    <button class="fw-btn fw-btn-primary" id="fw-fate-draw">手动出牌</button>
                    <button class="fw-btn fw-btn-danger" id="fw-fate-reset">重置统计</button>
                </div>
            </div>
        </div>`;
}

function cardHtml(c, locked, cd) {
    const kindLabel = c.kind === '负' ? '灾厄' : c.kind === '正' ? '恩赐' : c.kind === '中' ? '中性' : '双面';
    return `
        <div class="f-tarot f-kind-${c.kind} ${locked ? 'locked' : ''}">
            <div class="f-tarot-inner">
                <div class="f-tarot-face f-tarot-front">
                    <span class="f-tarot-num">${c.num}</span>
                    <div class="f-tarot-icon">${c.icon}</div>
                    <div class="f-tarot-name">${c.name}</div>
                    <div class="f-tarot-kind">${kindLabel}</div>
                    <div class="f-tarot-state">${locked ? `🔒 冷却${cd}轮` : '✦ 可用'}</div>
                </div>
                <div class="f-tarot-face f-tarot-back">
                    <div class="f-tarot-dim">${escapeHtml(c.dim)}</div>
                    <div class="f-tarot-line"><b>本质</b>${escapeHtml(c.essence)}</div>
                    <div class="f-tarot-line"><b>锚点</b>${escapeHtml(c.anchor)}</div>
                    <div class="f-tarot-line"><b>表现</b>${escapeHtml(c.express)}</div>
                </div>
            </div>
        </div>`;
}

function nodeHtml(e) {
    if (e.silent) {
        return `
            <div class="f-node f-node-silent">
                <span class="f-marker f-marker-silent"></span>
                <div class="f-node-card">
                    <div class="f-node-head">
                        <span class="f-node-round">第 ${e.round} 轮</span>
                        <span class="f-node-name">命运静默</span>
                    </div>
                    ${e.silentReason ? `<div class="f-node-reason">${escapeHtml(e.silentReason)}</div>` : ''}
                    ${e.comment ? `<div class="f-node-quote">「${escapeHtml(e.comment)}」</div>` : ''}
                </div>
            </div>`;
    }
    const kind = ['背叛', '贪婪', '嫉妒'].includes(e.card) ? '负' : ['幸运', '恩赐'].includes(e.card) ? '正' : e.card === '因果' ? '双' : '中';
    const lv = e.strength === '涟漪' ? 'Ⅰ' : e.strength === '浪潮' ? 'Ⅱ' : e.strength === '风暴' ? 'Ⅲ' : '';
    const sClass = e.strength === '风暴' ? 'storm' : e.strength === '浪潮' ? 'wave' : 'ripple';
    const extra = (e.npcs?.length || e.foes?.length || e.branches?.length) ? `
        <details class="f-node-extra">
            <summary>涉及角色 / 战斗 / 后续走向</summary>
            ${e.npcs?.length ? `<div class="f-npc">${e.npcs.map((n) => `<div class="f-npc-item"><b>${escapeHtml(n.name)}</b>${n['定位'] ? ` · ${escapeHtml(n['定位'])}` : ''}${n['实力'] ? ` · ${escapeHtml(n['实力'])}` : ''}${n['动机'] ? `<br>动机：${escapeHtml(n['动机'])}` : ''}${n['外貌特征'] ? `<br>外貌：${escapeHtml(n['外貌特征'])}` : ''}${n['言行风格'] ? `<br>言行：${escapeHtml(n['言行风格'])}` : ''}</div>`).join('')}</div>` : ''}
            ${e.foes?.length ? `<div class="f-foe">${e.foes.map((f) => `<div>· ${escapeHtml(f)}</div>`).join('')}</div>` : ''}
            ${e.branches?.length ? `<div class="f-branch">${e.branches.map((b) => `<div>⇢ ${escapeHtml(b)}</div>`).join('')}</div>` : ''}
        </details>` : '';
    return `
        <div class="f-node">
            <span class="f-marker f-marker-${sClass}"></span>
            <div class="f-node-card">
                <div class="f-node-head">
                    <span class="f-node-round">第 ${e.round} 轮</span>
                    <span class="f-node-name f-t-${kind}">${escapeHtml(e.card)}</span>
                    <span class="f-badge f-badge-${sClass}">${escapeHtml(e.strength)} ${lv}</span>
                    ${e.polarity ? `<span class="f-badge">${escapeHtml(e.polarity)}</span>` : ''}
                </div>
                ${e.declaration ? `<div class="f-node-quote">“${escapeHtml(e.declaration)}”</div>` : ''}
                ${e.summary ? `<div class="f-node-content">${escapeHtml(e.summary)}</div>` : ''}
                ${e.causality ? `<div class="f-node-cause">↳ 因果溯源：${escapeHtml(e.causality)}</div>` : ''}
                ${extra}
            </div>
        </div>`;
}

function bind(container) {
    const tarotCards = container.querySelectorAll('.f-tarot');
    tarotCards.forEach((card) => {
        card.addEventListener('click', () => {
            tarotCards.forEach((c) => c.classList.remove('selected'));
            card.classList.add('selected');
            card.classList.toggle('flipped');
        });
    });

    const drawBtn = container.querySelector('#fw-fate-draw');
    if (drawBtn) drawBtn.addEventListener('click', () => {
        if (confirm('确定要手动出牌吗？（忽略冷却）')) {
            triggerTaskNow('task3');
            toastSuccess('已请求出牌，生成中…');
        }
    });

    const resetBtn = container.querySelector('#fw-fate-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => {
        if (confirm('确定重置所有出牌统计吗？')) {
            const store = getStore();
            store.fate_stats = { total: 0, ripple: 0, wave: 0, storm: 0, pos: 0, neg: 0, recent: [] };
            saveStore();
            toastSuccess('✅ 统计已重置');
            renderFatePanel(container);
        }
    });
}

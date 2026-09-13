/**
 * 命运编织者 · Ananke — 输出解析器（v2）
 * 适配新标签：<store>/<supplement>/<hook_inject>/<map_inject>/<fate_inject>
 * 以及 Task 2 的增量字段 [字段名] 值 + [触发信号]。
 */

/* ---------------- 通用工具 ---------------- */

/** 剔除思维链 <thought>...</thought>（AI 可能在思考里引用/草拟标签，避免干扰真正的 <store>/<supplement> 提取） */
function stripThought(text) {
    return String(text ?? '')
        .replace(/<thought\b[^>]*>[\s\S]*?<\/thought>/gi, '')
        .replace(/<thought\b[^>]*>[\s\S]*$/gi, ''); // 未闭合的 thought 兜底剔除
}

/** 提取 <tag>...</tag> 之间的内容（不含标签本身；先剔除思维链） */
function extractTag(text, tag) {
    if (!tag) return '';
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = stripThought(text).match(re);
    return m ? m[1].trim() : '';
}

/** 提取多个逗号分隔标签的内容 → [{tag, content}]（保留标签名，供注入时原样包回；先剔除思维链） */
function extractAll(text, tags) {
    const clean = stripThought(text);
    const list = String(tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const tag of list) {
        const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
        const m = clean.match(re);
        if (m) out.push({ tag, content: m[1].trim() });
    }
    return out;
}

/** 兜底：若输出遗漏了 store 标签，自动把「思维链之后、第一个注入标签之前」的内容包成 <store>；已有 store 则不补 */
function ensureStoreTag(text, storeTag) {
    const raw = String(text ?? '');
    const tag = String(storeTag || 'store').trim();
    if (!tag || new RegExp(`<${tag}\\b[^>]*>`, 'i').test(raw)) return raw; // 已有，不补

    // 起点：思维链结束之后（无思维链则从头）
    let start = 0;
    const thought = raw.match(/<thought\b[^>]*>[\s\S]*?<\/thought>/i);
    if (thought) start = thought.index + thought[0].length;

    // 终点：第一个注入标签之前（无则到文本结束）
    const inject = raw.match(/<(supplement|hook_inject|map_inject|fate_inject)\b[^>]*>/i);
    const end = inject ? inject.index : raw.length;
    if (end <= start) return raw; // 没有可包区间，不补

    const content = raw.slice(start, end).replace(/\s+$/, '');
    if (!content.trim()) return raw; // 区间为空（连 store 内容都没有），不补

    return raw.slice(0, start) + `<${tag}>\n${content.trim()}\n</${tag}>` + raw.slice(end);
}

/** 按行首【标题】切块 → { 标题: 内容 } */
function splitByHeaders(text) {
    const blocks = {};
    let current = null;
    for (const line of String(text ?? '').split('\n')) {
        const m = line.match(/^\s*【(.+?)】\s*$/);
        if (m) {
            current = m[1].trim();
            blocks[current] = '';
        } else if (current !== null) {
            blocks[current] += line + '\n';
        }
    }
    return blocks;
}

/** 按行首 ▸ 小标题切块 → { 标题: 内容 } */
function splitByTriangle(text) {
    const blocks = {};
    let current = null;
    for (const line of String(text ?? '').split('\n')) {
        const m = line.match(/^\s*▸\s*(.+?)\s*$/);
        if (m) {
            current = m[1].trim();
            blocks[current] = '';
        } else if (current !== null) {
            blocks[current] += line + '\n';
        }
    }
    return blocks;
}

/** 按行首 [字段名]（可带同行内容）切块 → { 字段名: 内容 } */
function splitByBrackets(text) {
    const fields = {};
    let current = null;
    for (const line of String(text ?? '').split('\n')) {
        const m = line.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
        if (m) {
            current = m[1].trim();
            fields[current] = m[2].trim();
        } else if (current !== null) {
            const t = line.trim();
            if (t) fields[current] = (fields[current] ? fields[current] + '\n' : '') + t;
        }
    }
    return fields;
}

/** 按 ◆ 行切块（命运牌） */
function splitByDiamond(text) {
    const blocks = {};
    let current = null;
    for (const line of String(text ?? '').split('\n')) {
        const m = line.match(/^\s*◆\s*([^：:]+)[：:]\s*(.*)$/);
        if (m) {
            current = m[1].trim();
            blocks[current] = m[2].trim();
        } else if (current !== null) {
            const t = line.trim();
            if (t) blocks[current] = (blocks[current] ? blocks[current] + '\n' : '') + t;
        }
    }
    return blocks;
}

/* ---------------- 新层级标记体系（◈/◇/▪/-/键值对/🚫/□/※） ---------------- */

/** 按行首 ◈(篇)/◇(节) 切块 → [{marker, title, content}]；▪ 与 - 留在 content 内 */
function splitTiers(text) {
    const sections = [];
    let cur = null;
    for (const line of String(text ?? '').split('\n')) {
        const m = line.match(/^\s*(◈|◇)\s*(.+?)\s*$/);
        if (m) {
            if (cur) sections.push(cur);
            cur = { marker: m[1], title: m[2].trim(), content: '' };
        } else if (cur) {
            cur.content += line + '\n';
        }
    }
    if (cur) sections.push(cur);
    return sections;
}

/** 按行首 ▪ 切块（子节），在某个 ◇ 的 content 内调用 → [{title, content}] */
function splitSubsections(text) {
    const subs = [];
    let cur = null;
    for (const line of String(text ?? '').split('\n')) {
        const m = line.match(/^\s*▪\s*(.+?)\s*$/);
        if (m) {
            if (cur) subs.push(cur);
            cur = { title: m[1].trim(), content: '' };
        } else if (cur) {
            cur.content += line + '\n';
        }
    }
    if (cur) subs.push(cur);
    return subs;
}

/** 提取「字段：值」（全角或半角冒号，值到行尾） */
function pickKv(text, key) {
    const re = new RegExp(`${key}[：:]\\s*([^\\n]+)`);
    const m = String(text ?? '').match(re);
    return m ? m[1].trim() : '';
}

/** 提取 - 条目列表 */
function parseItems(text) {
    return String(text ?? '').split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('-'))
        .map((l) => l.replace(/^-\s*/, '').trim());
}

/* ---------------- Task 1：大纲（纬线·阶段规划与时间线） ---------------- */

/** task1 JSON store → 旧 prose 文本（供 parseTask1Output / 面板 / {{outline}} 复用） */
function jsonToProseTask1(j) {
    const out = [];
    const has = (v) => v !== undefined && v !== null && v !== '';
    const arr = (v) => (Array.isArray(v) ? v : (has(v) ? [v] : []));
    const kv = (o) => { for (const [k, v] of Object.entries(o || {})) if (has(v)) out.push(`${k}：${v}`); };
    const list = (a) => { for (const v of arr(a)) out.push(`- ${typeof v === 'string' ? v : JSON.stringify(v)}`); };

    out.push('◈ 命运总纲·纬线 —— 阶段规划与时间线');
    if (has(j['阶段总览'])) {
        out.push('', '◇ 阶段总览', '');
        kv(j['阶段总览']);
    }

    for (const s of arr(j['阶段'])) {
        if (typeof s === 'string') continue;
        out.push('', `◇ 第${s['序号'] ?? '?'}阶段：${s['标题'] || ''}`, '');
        if (has(s['等级区间'])) out.push(`等级区间：${s['等级区间']}`);
        if (has(s['副体系对照'])) out.push(`副体系对照：${s['副体系对照']}`);
        if (has(s['核心压力主题'])) out.push(`核心压力主题：${s['核心压力主题']}`);

        const theme = s['核心叙事主题'];
        if (has(theme)) {
            out.push('', '▪ 核心叙事主题', '');
            if (theme && typeof theme === 'object' && !Array.isArray(theme)) {
                if (has(theme['引言'])) out.push(`"${String(theme['引言']).replace(/["“”]/g, '')}"`);
                if (has(theme['详述'])) out.push(String(theme['详述']));
            } else out.push(String(theme));
        }

        for (const key of ['地理活动范围', '可交互势力', 'NPC交互层级', '推荐投放资源']) {
            const v = s[key];
            if (!has(v)) continue;
            out.push('', `▪ ${key}`, '');
            if (v && typeof v === 'object' && !Array.isArray(v)) kv(v);
            else out.push(String(v));
        }

        if (has(s['推荐投放事件'])) { out.push('', '▪ 推荐投放事件', ''); list(s['推荐投放事件']); }
        if (has(s['投放禁令'])) { out.push('', '🚫 投放禁令', ''); list(s['投放禁令']); }

        for (const key of ['矛盾线索许可', '阶段转换触发条件', '阶段串联事件', '终局条件', '终局引导事件']) {
            if (!has(s[key])) continue;
            out.push('', `▪ ${key}`, '');
            list(s[key]);
        }
    }

    const tl = j['世界事件时间线'];
    if (has(tl)) {
        out.push('', '◇ 世界事件时间线', '');
        if (tl && typeof tl === 'object' && !Array.isArray(tl)) {
            for (const [k, v] of Object.entries(tl)) {
                out.push('', `▪ ${k}`, '');
                list(v);
            }
        } else out.push(String(tl));
    }
    return out.join('\n');
}

export function parseTask1Output(text, storeTag = 'store') {
    const parts = extractAll(ensureStoreTag(text, storeTag), storeTag || 'store');
    const storeRaw = (parts[0]?.content) || text;

    // 优先按 JSON store 解析（新格式）；失败回退旧 prose 格式
    const json = tryParseJson(storeRaw);
    const store = json ? jsonToProseTask1(json) : storeRaw;
    const sections = splitTiers(store);

    const result = {
        raw: store,
        worldName: '',        // 纬线不含世界名，由 runTask1 从经线摘要补
        worldSummary: '',     // 兼容字段：世界观摘要已独立到 task1_5，此处留空
        principles: '',       // 兼容字段：纬线无基本原则
        stageCount: 0,
        timeline: '',
        stages: [],
    };

    for (const sec of sections) {
        const title = sec.title;
        const content = sec.content.trim();

        if (sec.marker === '◈') continue;

        if (/阶段总览/.test(title)) {
            const m = content.match(/阶段总数[：:]\s*(\d+)/);
            if (m) result.stageCount = Number(m[1]);
        } else if (/^第\s*([0-9一二三四五六七八九十]+)\s*阶段/.test(title)) {
            const numMatch = title.match(/^第\s*([0-9一二三四五六七八九十]+)\s*阶段/);
            const num = cnToNum(numMatch[1]);
            const stageTitle = title.replace(/^第\s*[0-9一二三四五六七八九十]+\s*阶段(?:[（(]终局[）)])?[：:]\s*/, '');
            result.stages.push(parseWeftStage(num, stageTitle, content));
        } else if (/世界事件时间线/.test(title)) {
            result.timeline = content;
        }
    }
    result.stages.sort((a, b) => a.num - b.num);
    return result;
}

/** 解析纬线单个阶段块（等级区间 + 核心矛盾 + ▪ 子节 + 🚫 禁令） */
function parseWeftStage(num, title, content) {
    const stage = { num, title, levelRange: '', '核心矛盾': '' };
    const lv = content.match(/等级区间[：:]\s*(.+)/);
    if (lv) stage.levelRange = lv[1].trim();
    const cm = content.match(/核心矛盾[：:]\s*(.+)/);
    if (cm) stage['核心矛盾'] = cm[1].trim();
    const sc = content.match(/副体系对照[：:]\s*(.+)/);
    if (sc) stage['副体系对照'] = sc[1].trim();

    // 分离 🚫 投放禁令块（独立特殊标记，非 ▪ 子节）
    let rest = content;
    const banMatch = content.match(/🚫\s*投放禁令\s*\n([\s\S]*?)(?=\n▪|\n🚫|$)/);
    if (banMatch) {
        stage['投放禁令'] = banMatch[1].trim();
        rest = content.replace(banMatch[0], '\n');
    }

    for (const sub of splitSubsections(rest)) {
        stage[normalizeKey(sub.title)] = sub.content.trim();
    }
    return stage;
}

/* ---------------- Task 1.5：世界观全景摘要（经线） ---------------- */

/** 解析等级列表：序号. 名称（可选 Lv 低-高）+ 战力表现/社会地位/突破条件；兼容无数值体系 */
function parseLevels(text) {
    const levels = [];
    let cur = null;
    for (const line of String(text ?? '').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        // 序号条目（兼容带 Lv 区间与不带——如「生命层级」类体系只有名称）
        const m = t.match(/^(\d+)[.、]\s*(.+)$/);
        if (m) {
            if (cur) levels.push(cur);
            const raw = m[2].trim();
            const lv = raw.match(/[（(]Lv\s*(\d+)\s*[-–~]\s*(\d+)[）)]/i);
            const name = lv ? raw.replace(/\s*[（(]Lv[^）)]*[）)]/i, '').trim() : raw;
            cur = { name, lvLow: lv ? Number(lv[1]) : '', lvHigh: lv ? Number(lv[2]) : '', 战力: '', 地位: '', 突破: '' };
            continue;
        }
        if (!cur) continue;
        const km = t.match(/^(战力表现|社会地位|突破条件)[：:]\s*(.*)$/);
        if (km) {
            const k = km[1] === '战力表现' ? '战力' : km[1] === '社会地位' ? '地位' : '突破';
            cur[k] = km[2].trim();
        }
    }
    if (cur) levels.push(cur);
    return levels;
}

/** 解析矛盾列表：矛盾 #N：名 + 描述段落 */
function parseConflicts(text) {
    const conflicts = [];
    let cur = null;
    for (const line of String(text ?? '').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        if (/^矛盾关联/.test(t)) break; // 关联行由 pickKv 单独提取
        const m = t.match(/^矛盾\s*#\s*(\d+)[：:]\s*(.*)$/);
        if (m) {
            if (cur) conflicts.push(cur);
            cur = { num: Number(m[1]), name: m[2].trim(), desc: '' };
            continue;
        }
        if (cur) cur.desc = (cur.desc ? cur.desc + '\n' : '') + t;
    }
    if (cur) conflicts.push(cur);
    return conflicts;
}

/** 解析世界观全景摘要（经线 1.1~1.5）→ 结构化 */
/** task1_5 JSON store → 旧 prose 文本（供 parseTask15Output / 面板 / {{world_summary}} 复用） */
function jsonToProseTask15(j) {
    const out = [];
    const has = (v) => v !== undefined && v !== null && v !== '';
    const arr = (v) => (Array.isArray(v) ? v : (has(v) ? [v] : []));
    const kv = (o) => { for (const [k, v] of Object.entries(o || {})) if (has(v)) out.push(`${k}：${v}`); };
    const levels = (list) => {
        for (const l of arr(list)) {
            if (!l || typeof l !== 'object') { out.push(String(l)); continue; }
            const lv = has(l['Lv']) ? `（Lv ${l['Lv']}）` : '';
            out.push(`${l['序号'] ?? '?'}. ${l['名称'] || ''}${lv}`);
            for (const k of ['战力表现', '社会地位', '突破条件']) if (has(l[k])) out.push(`${k}：${l[k]}`);
        }
    };

    out.push('◈ 命运总纲·经线 —— 世界全景摘要', '');
    if (has(j['世界基础'])) { out.push('◇ 1.1 世界基础', ''); kv(j['世界基础']); }
    if (has(j['世界全景'])) { out.push('', '◇ 1.2 世界全景', '', String(j['世界全景'])); }

    const ps = j['实力体系'];
    if (ps && typeof ps === 'object') {
        out.push('', '◇ 1.3 实力体系', '');
        const main = ps['主体系'];
        if (main && typeof main === 'object') {
            out.push(`▪ 主体系：${main['名称'] || ''}`, '');
            for (const k of ['体系名称', '力量来源', '覆盖面']) {
                if (k === '体系名称') out.push(`体系名称：${main['名称'] || main['体系名称'] || ''}`);
                else if (has(main[k])) out.push(`${k}：${main[k]}`);
            }
            out.push('', '等级划分（从低到高）：', '');
            levels(main['等级划分']);
            if (has(main['成长路径'])) out.push('', `成长路径：${main['成长路径']}`);
        }
        const sub = ps['副体系'];
        if (sub && typeof sub === 'object') {
            out.push('', `▪ 副体系：${sub['名称'] || ''}`, '');
            out.push(`体系名称：${sub['名称'] || sub['体系名称'] || ''}`);
            for (const k of ['力量来源', '与主体系关系', '等级对照']) if (has(sub[k])) out.push(`${k}：${sub[k]}`);
            out.push('', '等级划分（从低到高）：', '');
            levels(sub['等级划分']);
        }
    }

    const cf = arr(j['核心矛盾']);
    if (cf.length) {
        out.push('', '◇ 1.4 核心矛盾', '');
        for (const c of cf) {
            if (typeof c === 'string') { out.push(c); continue; }
            out.push(`矛盾 #${c['编号'] ?? '?'}：${c['名称'] || ''}`);
            if (has(c['描述'])) out.push(String(c['描述']));
        }
        if (has(j['矛盾关联'])) out.push('', `矛盾关联：${j['矛盾关联']}`);
    }

    const idx = j['补充索引'];
    if (idx && typeof idx === 'object') {
        out.push('', '◇ 1.5 补充索引', '');
        for (const k of ['重要组织', '关键地点', '危险生态速查', '经济速查', '历史遗留']) {
            const v = idx[k];
            if (!has(v)) continue;
            out.push('', `▪ ${k}`, '');
            if (Array.isArray(v)) for (const it of v) out.push(`- ${typeof it === 'string' ? it : JSON.stringify(it)}`);
            else out.push(String(v));
        }
    }
    return out.join('\n');
}

export function parseTask15Output(text, storeTag = 'store') {
    const parts = extractAll(ensureStoreTag(text, storeTag), storeTag || 'store');
    const storeRaw = (parts[0]?.content) || text;

    // 优先按 JSON store 解析（新格式）；失败回退旧 prose 格式
    const json = tryParseJson(storeRaw);
    const store = json ? jsonToProseTask15(json) : storeRaw;
    const sections = splitTiers(store);

    const result = {
        raw: store,
        title: '',
        worldName: '', era: '', 历法: '', type: '', law: '',
        overview: '',
        powerSystem: { 名称: '', 来源: '', 等级: [], 成长路径: '' },
        conflicts: [],
        conflictRelation: '',
        index: { 组织: [], 地点: [], 生态: [], 经济: '', 历史遗留: [] },
    };

    for (const sec of sections) {
        const title = sec.title;
        const content = sec.content.trim();

        if (sec.marker === '◈') { result.title = title; continue; }

        if (/^1\.1/.test(title)) {
            result.worldName = pickKv(content, '世界名');
            result.era = pickKv(content, '纪元');
            result.历法 = pickKv(content, '历法');
            result.type = pickKv(content, '类型');
            result.law = pickKv(content, '世界法则');
        } else if (/^1\.2/.test(title)) {
            result.overview = content;
        } else if (/^1\.3/.test(title)) {
            // 新格式：▪ 主体系 / ▪ 副体系 子节，等级划分/成长路径 为子节内的键值行
            const subs = splitSubsections(content);
            const mainSub = subs.find((s) => /主体系/.test(s.title));
            const subSub = subs.find((s) => /副体系/.test(s.title));
            const mainText = mainSub ? mainSub.content : content;
            result.powerSystem.名称 = pickKv(mainText, '体系名称');
            result.powerSystem.来源 = pickKv(mainText, '力量来源');
            result.powerSystem.等级 = parseLevels(mainText);
            result.powerSystem.成长路径 = pickKv(mainText, '成长路径');
            // 旧格式兜底：▪ 成长路径 子节
            if (!result.powerSystem.成长路径) {
                const old = subs.find((s) => /成长路径/.test(s.title));
                if (old) result.powerSystem.成长路径 = old.content.trim();
            }
            if (subSub) {
                result.powerSystem.副体系 = {
                    名称: pickKv(subSub.content, '体系名称'),
                    来源: pickKv(subSub.content, '力量来源'),
                    关系: pickKv(subSub.content, '与主体系关系'),
                    等级对照: pickKv(subSub.content, '等级对照'),
                    等级: parseLevels(subSub.content),
                };
            }
        } else if (/^1\.4/.test(title)) {
            result.conflicts = parseConflicts(content);
            result.conflictRelation = pickKv(content, '矛盾关联');
        } else if (/^1\.5/.test(title)) {
            for (const sub of splitSubsections(content)) {
                if (/重要组织/.test(sub.title)) result.index.组织 = parseItems(sub.content);
                else if (/关键地点/.test(sub.title)) result.index.地点 = parseItems(sub.content);
                else if (/危险生态/.test(sub.title)) result.index.生态 = parseItems(sub.content);
                else if (/经济/.test(sub.title)) result.index.经济 = sub.content.trim();
                else if (/历史遗留/.test(sub.title)) result.index.历史遗留 = parseItems(sub.content);
            }
        }
    }
    return result;
}

/** 按「第X卷」标题切分大纲内容（startMark/endMark 为卷名，如 第一卷/第二卷） */
function sliceVolume(text, startMark, endMark) {
    const s = String(text || '');
    const start = s.indexOf(startMark);
    if (start < 0) return '';
    const from = s.indexOf('\n', start) + 1;
    const end = endMark ? s.indexOf(endMark, start) : -1;
    let content = (end >= 0 ? s.slice(from, end) : s.slice(from)).trim();
    // 去掉卷标题的装饰线（═══）
    content = content.replace(/^═+\s*\n?/, '').replace(/\n?═+\s*$/, '');
    return content.trim();
}

/** 中文数字转阿拉伯（一→1 十→10 十一→11 二十→20） */
function cnToNum(s) {
    if (/^\d+$/.test(s)) return Number(s);
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (s === '十') return 10;
    if (s.includes('十')) {
        const parts = s.split('十');
        return (parts[0] ? map[parts[0]] : 1) * 10 + (parts[1] ? map[parts[1]] : 0);
    }
    return map[s] || 0;
}

/** 从原文扫描所有阶段块：标题支持 第N阶段/第一章/第N部分/第N幕（可带【】，中文或数字序号） */
function parseStages(text) {
    const stages = [];
    const lines = String(text ?? '').split('\n');
    let cur = null;
    for (const line of lines) {
        const t = line.trim();
        const m = t.match(/【?\s*第\s*([0-9一二三四五六七八九十]+)\s*(?:阶段|章|幕|部分)[：:]\s*([^】]+)】?\s*$/);
        if (m) {
            if (cur) stages.push(cur);
            cur = { num: cnToNum(m[1]), title: m[2].trim(), lines: [] };
            continue;
        }
        if (!cur) continue;
        // 其他【顶层标题】（如【世界观核心摘要】）结束当前阶段块
        if (t.startsWith('【') && t.endsWith('】') && !/第\s*[0-9一二三四五六七八九十]+\s*(阶段|章|幕|部分)/.test(t)) {
            stages.push(cur);
            cur = null;
            continue;
        }
        cur.lines.push(line);
    }
    if (cur) stages.push(cur);
    stages.sort((a, b) => a.num - b.num);
    return stages;
}

/** 规范化 ▸ 子块标题：去掉 emoji 前缀和括号后缀（如「🚫 投放禁令（xxx）」→「投放禁令」） */
function normalizeKey(k) {
    let key = String(k || '').trim();
    key = key.replace(/^[\u{1F000}-\u{1FAFF}\u2600-\u27BF\uFE0F\s]+/u, '');
    key = key.replace(/[（(].*?[）)]\s*$/, '');
    return key.trim();
}

function parseStageBlock(num, title, content) {
    const stage = { num, title, levelRange: '' };
    const lv = content.match(/等级区间[：:]\s*(.+)/);
    if (lv) stage.levelRange = lv[1].trim();
    const 矛盾 = content.match(/核心矛盾[：:]\s*(.+)/);
    if (矛盾) stage['核心矛盾'] = 矛盾[1].trim();
    const subs = splitByTriangle(content);
    for (const [k, v] of Object.entries(subs)) {
        stage[normalizeKey(k)] = v.trim();
    }
    return stage;
}

/* ---------------- Task 2：剧情引擎（增量） ---------------- */

/** 从「▪ 触发信号」子节解析信号（可能同发多个：MAP_GEN + MISSION_GEN，各自带附带数据） */
function parseSignals(text) {
    const signals = [];
    const content = String(text ?? '');
    for (const line of content.split('\n')) {
        const sm = line.trim().match(/^信号类型[：:]\s*(.+)$/);
        if (!sm) continue;
        const typeStr = sm[1].trim();
        // 本行声明的信号类型（占位符未替换时可能为 "MAP_GEN / MISSION_GEN"）
        const declared = ['MAP_GEN', 'MISSION_GEN'].filter((t) => typeStr.includes(t));
        if (!declared.length) continue;
        let pushed = 0;
        const pending = [];
        for (const type of declared) {
            const params = {};
            const blockRe = new RegExp(`${type}\\s*附带数据[：:]\\s*([\\s\\S]*?)(?=\\n\\s*(?:MAP_GEN|MISSION_GEN)\\s*附带数据|\\n\\s*▪|$)`);
            const bm = content.match(blockRe);
            if (bm) {
                let curKey = null;
                for (const rawLine of bm[1].split('\n')) {
                    const l = rawLine.trim();
                    if (!l) continue;
                    const pm = l.match(/^[-•]?\s*([^：:]+)[：:]\s*(.*)$/);
                    if (pm) {
                        curKey = pm[1].trim();
                        params[curKey] = pm[2].trim();
                    } else if (curKey) {
                        params[curKey] += '\n' + l; // 续行（如伏笔数据多行）
                    }
                }
                signals.push({ type, params });
                pushed++;
            } else {
                pending.push(type);
            }
        }
        // 兜底：本行只声明了一个信号类型、但 AI 漏写「附带数据」块时，仍按声明类型出信号（空参数），
        // 避免任务链/地图完全不触发；多类型且无块 = 占位符未替换，不臆测，跳过
        if (!pushed && pending.length === 1) {
            signals.push({ type: pending[0], params: {} });
        }
    }
    return signals;
}

/** 修复字符串字面量内的裸换行/制表符（模型输出长文本时的常见问题） */
function repairJsonStrings(s) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (esc) { out += c; esc = false; continue; }
        if (c === '\\') { out += c; esc = true; continue; }
        if (c === '"') { inStr = !inStr; out += c; continue; }
        if (inStr) {
            if (c === '\n') { out += '\\n'; continue; }
            if (c === '\r') continue;
            if (c === '\t') { out += '\\t'; continue; }
        }
        out += c;
    }
    return out;
}

/** 容错解析 JSON：去 markdown 代码围栏、截取首尾花括号、去尾逗号、修复字符串内裸换行；失败返回 null */
function tryParseJson(text) {
    let s = String(text ?? '').trim();
    if (!s) return null;
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    s = s.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1');
    try { return JSON.parse(s); } catch { /* 进入修复流程 */ }
    try { return JSON.parse(repairJsonStrings(s)); } catch { return null; }
}

/** 把 JSON 的「本轮状态/主角状态快照/…」转回旧 prose 文本，复用现有解析器与调度（转换由代码决定，AI 不必再记标记） */
function jsonToProse(json) {
    const j = json || {};
    const out = [];
    const has = (v) => v !== undefined && v !== null && v !== '';

    const pushKv = (obj) => {
        for (const [k, v] of Object.entries(obj || {})) {
            if (!has(v)) continue;
            if (Array.isArray(v)) { for (const it of v) out.push(`- ${it}`); }
            else if (typeof v === 'object') { out.push(`${k}：`); for (const [k2, v2] of Object.entries(v)) if (has(v2)) out.push(`- ${k2}：${v2}`); }
            else out.push(`${k}：${v}`);
        }
    };

    out.push('◇ 本轮状态', '');
    pushKv(j['本轮状态']);

    if (j['主角状态快照']) { out.push('', '▪ 主角状态快照', ''); pushKv(j['主角状态快照']); }

    // 任务链状态：状态枚举 → 旧【标记】
    if (j['任务链状态']) {
        out.push('', '▪ 任务链状态', '');
        const ts = j['任务链状态'] || {};
        const st = String(ts['状态'] || '');
        if (/活跃/.test(st)) out.push('【活跃中】');
        else if (/完成/.test(st)) out.push('【已完成】');
        else if (/无/.test(st)) out.push('【无任务】');
        for (const [k, v] of Object.entries(ts)) if (k !== '状态') pushKv({ [k]: v });
    }

    if (j['M2 开放式场景']) { out.push('', '▪ M2 开放式场景', ''); pushKv(j['M2 开放式场景']); }

    if (j['地图进度更新']) {
        out.push('', '▪ 地图进度更新', '');
        const mp = j['地图进度更新'] || {};
        if (has(mp['当前位置'])) out.push(`当前位置：${mp['当前位置']}`);
        for (const n of (mp['已探索'] || [])) out.push(`- ${n} [已探索]`);
        for (const n of (mp['已清除'] || [])) out.push(`- ${n} [已清除]`);
    }

    if (Array.isArray(j['伏笔倒计时']) && j['伏笔倒计时'].length) {
        out.push('', '▪ 伏笔倒计时', '');
        for (const f of j['伏笔倒计时']) out.push(`- 伏笔 #${f['编号'] || ''}：${f['名'] || ''} — 距下一阶段：${f['距下一阶段'] || ''}`);
    }

    if (Array.isArray(j['时间线事件']) && j['时间线事件'].length) {
        out.push('', '▪ 时间线事件', '');
        for (const t of j['时间线事件']) out.push(`- ${t['描述'] || ''} [已触发] — 用途：${t['用途'] || ''}`);
    }

    if (j['触发信号']) {
        out.push('', '▪ 触发信号', '');
        const sg = j['触发信号'] || {};
        const type = String(sg['type'] || '');
        out.push(`信号类型：${type}`);
        if (type && !type.includes('/')) {
            out.push(`${type} 附带数据：`);
            for (const [k, v] of Object.entries(sg)) if (k !== 'type' && has(v)) out.push(`- ${k}：${v}`);
        }
    }

    if (j['阶段转换标记']) {
        out.push('', '▪ 阶段转换标记', '');
        const sc = j['阶段转换标记'] || {};
        const t = String(sc['建议过渡'] || '');
        const m = t.match(/阶段?\s*([0-9一二三四五六七八九十]+)\s*[→至\-]\s*阶段?\s*([0-9一二三四五六七八九十]+)/);
        if (m) out.push(`建议从阶段${m[1]}过渡至阶段${m[2]}`);
        else if (has(t)) out.push(`建议过渡：${t}`);
        for (const [k, v] of Object.entries(sc)) if (k !== '建议过渡') pushKv({ [k]: v });
    }

    if (j['K1 轻量引子']) { out.push('', '▪ K1 轻量引子', ''); pushKv(j['K1 轻量引子']); }

    return out.join('\n');
}

export function parseTask2Output(text, storeTag = 'store', injectTag = 'supplement') {
    const storeParts = extractAll(ensureStoreTag(text, storeTag), storeTag || 'store');
    const store = storeParts[0]?.content || '';
    const injects = extractAll(text, injectTag || 'supplement');

    // 优先按 JSON store 解析（新格式）；失败回退旧 prose 格式
    const json = tryParseJson(store);
    if (json) {
        const r = parseTask2Prose(jsonToProse(json), injects);
        r.json = json;
        return r;
    }
    return parseTask2Prose(store, injects);
}

/** 旧 prose 格式：<store> 内 ◇ 本轮状态（头部键值对）+ 若干 ▪ 子节 */
function parseTask2Prose(store, injects) {
    const tiers = splitTiers(store);
    const head = tiers.find((s) => s.marker === '◇' && /本轮状态/.test(s.title));

    const fields = {};
    const sections = {};
    if (head) {
        const headText = head.content.replace(/\n\s*▪[\s\S]*$/, '');
        for (const line of headText.split('\n')) {
            const m = line.trim().match(/^([^：:]+)[：:]\s*(.*)$/);
            if (m) fields[m[1].trim()] = m[2].trim();
        }
        for (const sub of splitSubsections(head.content)) {
            sections[sub.title.trim()] = sub.content.trim();
        }
    }

    // 触发信号（▪ 触发信号 子节）
    const signals = parseSignals(sections['触发信号'] || '');

    // 阶段转换（▪ 阶段转换标记）
    let stageChange = false;
    let targetStage = null;
    const scText = sections['阶段转换标记'] || '';
    const tm = scText.match(/过渡至\s*阶段\s*([0-9一二三四五六七八九十]+)/)
        || scText.match(/第\s*([0-9一二三四五六七八九十]+)\s*阶段/);
    if (tm) {
        targetStage = cnToNum(tm[1]);
        stageChange = targetStage > 0;
    }

    // 开放场景（▪ M2 开放式场景）
    let openScene = null;
    const m2 = sections['M2 开放式场景'] || '';
    if (m2) {
        const nameM = m2.match(/场景[：:]\s*(.+)/);
        openScene = { name: nameM ? nameM[1].trim() : '', raw: m2 };
    }

    return { fields, sections, injects, signals, signal: signals[0] || null, stageChange, targetStage, openScene, store };
}

/* ---------------- Task 2.5：地图生成 ---------------- */

/** task2_5 JSON store → 旧 prose 文本（供 parseMap / 面板渲染复用） */
function jsonToProseTask25(j) {
    const out = [];
    const has = (v) => v !== undefined && v !== null && v !== '';
    const arr = (v) => (Array.isArray(v) ? v : (has(v) ? [v] : []));

    const m = j['地图'] || {};
    out.push(`◇ 地图·${m['地点名称'] || '未知地点'}`);
    out.push('');
    for (const k of ['入口来源', '结构', '入口', '出口']) if (has(m[k])) out.push(`${k}：${m[k]}`);
    if (has(m['总区域数'])) out.push(`总区域数：${m['总区域数']}`);
    out.push(`当前位置：${m['当前位置'] || '①'}`);

    const regions = arr(j['区域结构']);
    if (regions.length) {
        out.push('', '▪ 区域结构', '');
        for (const r of regions) {
            if (typeof r === 'string') { out.push(`- ${r}`); continue; }
            let line = `- ${r['编号'] || ''} ${r['名称'] || ''}`;
            if (has(r['状态'])) line += ` [${r['状态']}]`;
            if (has(r['用途'])) line += `（${r['用途']}）`;
            if (r['当前'] === true || String(r['当前']) === 'true') line += ' ← 【当前位置】';
            if (has(r['描述'])) line += ` — ${r['描述']}`;
            out.push(line);
            if (has(r['发现条件'])) out.push(`  发现条件：${r['发现条件']}`);
            for (const l of arr(r['连接'])) {
                const s = (typeof l === 'string') ? l : `${l['方向'] || ''}${has(l['目标']) ? ' ' + l['目标'] : ''}`;
                if (s.trim()) out.push(`  ${s.trim()}`);
            }
        }
    }

    const foes = arr(j['敌对总览']);
    if (foes.length) {
        out.push('', '▪ 敌对总览', '');
        for (const f of foes) {
            if (typeof f === 'string') { out.push(`- ${f}`); continue; }
            if (f['BOSS'] === true || String(f['BOSS']) === 'true') {
                out.push(`- BOSS ${f['名称'] || ''}：Lv ${f['Lv'] || ''}，${f['区域'] || ''}，${f['击败效果'] || ''}`);
            } else {
                out.push(`- ${f['名称'] || ''}×${f['数量'] || 1}：Lv ${f['Lv'] || ''}，分布在${f['区域'] || ''}`);
            }
        }
    }

    const els = arr(j['区域元素']);
    if (els.length) {
        out.push('', '▪ 区域元素', '');
        for (const e of els) {
            if (typeof e === 'string') { out.push(`- ${e}`); continue; }
            out.push(`- ${e['区域'] || ''} ${e['描述'] || ''}（${e['功能'] || ''}）`);
        }
    }
    return out.join('\n');
}

export function parseTask25Output(text, storeTag = 'store', injectTag = 'map_inject') {
    const storeParts = extractAll(ensureStoreTag(text, storeTag), storeTag || 'store');
    const storeRaw = storeParts[0]?.content || '';
    const injects = extractAll(text, injectTag || 'map_inject');

    // 优先按 JSON store 解析（新格式）；失败回退旧 prose 格式
    const json = tryParseJson(storeRaw);
    const store = json ? jsonToProseTask25(json) : storeRaw;

    const m = { raw: store, type: 'closed', name: '', 当前位置: '' };
    if (json) {
        const head = json['地图'] || {};
        m.name = head['地点名称'] || '';
        m.当前位置 = head['当前位置'] || '';
        return { map: m, injects, json };
    }
    // 新格式：◇ 地图·地点名；旧格式：【地图·地点名】
    const name = store.match(/【地图[·.·]?\s*([^】]+)】/) || store.match(/◇\s*地图[·.·]?\s*([^\n（(]+)/);
    if (name) m.name = name[1].trim();
    const pos = store.match(/当前位置[：:]\s*(.+)/);
    if (pos) m.当前位置 = pos[1].trim();

    return { map: m, injects };
}

/* ---------------- Task 3：命运牌 ---------------- */

/** 解析「▪ 涉及角色」子节 → [{name, 定位, 实力, 动机, 外貌特征, 言行风格}] */
function parseNpcs(subs) {
    const txt = Object.entries(subs).find(([k]) => /涉及角色/.test(k))?.[1] || '';
    if (!txt) return [];
    const npcs = [];
    let cur = null;
    for (const line of txt.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const headM = t.match(/^[-•]\s*(.+)$/);
        if (headM) {
            if (cur) npcs.push(cur);
            cur = { name: headM[1].trim() };
            continue;
        }
        if (!cur) continue;
        const km = t.match(/^([^：:]+)[：:]\s*(.*)$/);
        if (km) cur[km[1].trim()] = km[2].trim();
    }
    if (cur) npcs.push(cur);
    return npcs;
}

/** 解析「▪ 涉及战斗」子节 → [string] */
function parseFoes(subs) {
    const txt = Object.entries(subs).find(([k]) => /涉及战斗/.test(k))?.[1] || '';
    return txt.split('\n').map((l) => l.trim().replace(/^[-•]\s*/, '')).filter(Boolean);
}

/** 解析「▪ 后续可能走向」子节 → [string] */
function parseBranches(subs) {
    const txt = Object.entries(subs).find(([k]) => /后续可能走向|后续走向/.test(k))?.[1] || '';
    return txt.split('\n').map((l) => l.trim().replace(/^[-•]\s*/, '')).filter(Boolean);
}

/** task3 JSON store → 旧 prose 文本（供 parseTask3Output 的既有解析复用） */
function jsonToProseTask3(j) {
    const out = [];
    const has = (v) => v !== undefined && v !== null && v !== '';
    const arr = (v) => (Array.isArray(v) ? v : (has(v) ? [v] : []));

    const w = j['命运之轮'] || {};
    out.push('◇ 命运之轮', '');
    for (const k of ['轮次', '距上次出牌', '当前大纲阶段', '当前任务链']) {
        if (has(w[k])) out.push(`${k}：${w[k]}`);
    }

    const p = j['出牌情况'] || {};
    out.push('', '▪ 出牌情况', '');
    const decision = String(p['决策'] || '');
    if (/静默/.test(decision)) {
        out.push('决策：静默');
        if (has(p['静默原因'])) out.push(`静默原因：${p['静默原因']}`);
        if (has(p['评语'])) out.push('', `※ "${String(p['评语']).replace(/["“”]/g, '')}"`);
        return out.join('\n');
    }
    out.push(`决策：${decision || '出牌'}`);
    if (has(p['牌面'])) out.push(`牌面：${p['牌面']}${has(p['正负性']) ? `（${p['正负性']}）` : ''}`);
    if (has(p['干涉强度'])) out.push(`干涉强度：${p['干涉强度']}${has(p['强度等级']) ? `（${p['强度等级']}）` : ''}`);

    const decl = arr(p['命运宣言']);
    if (decl.length) {
        out.push('', '- 命运宣言：');
        for (const d of decl) out.push(`  "${String(d).replace(/["“”]/g, '')}"`);
    }
    if (has(p['干涉内容'])) out.push('', '- 干涉内容：', `  ${p['干涉内容']}`);
    if (has(p['因果溯源'])) out.push('', `- 因果溯源：${p['因果溯源']}`);

    const npcs = arr(j['涉及角色']);
    if (npcs.length) {
        out.push('', '▪ 涉及角色', '');
        for (const n of npcs) {
            if (typeof n === 'string') { out.push(`- ${n}`); continue; }
            out.push(`- ${n['名称'] || ''}`);
            for (const k of ['定位', '实力', '动机', '外貌特征', '言行风格']) {
                if (has(n[k])) out.push(`  ${k}：${n[k]}`);
            }
        }
    }

    const foes = arr(j['涉及战斗']);
    if (foes.length) {
        out.push('', '▪ 涉及战斗', '');
        for (const f of foes) {
            if (typeof f === 'string') { out.push(`- ${f}`); continue; }
            out.push(`- ${f['名称'] || ''}×${f['数量'] || 1}：Lv ${f['Lv'] || ''}，${f['特征'] || ''}`);
        }
    }

    const br = arr(j['后续可能走向']);
    if (br.length) {
        out.push('', '▪ 后续可能走向', '');
        for (const b of br) out.push(`- ${typeof b === 'string' ? b : JSON.stringify(b)}`);
    }
    return out.join('\n');
}

export function parseTask3Output(text, storeTag = 'store', injectTag = 'fate_inject') {
    const storeParts = extractAll(ensureStoreTag(text, storeTag), storeTag || 'store');
    const storeRaw = storeParts[0]?.content || '';
    const injects = extractAll(text, injectTag || 'fate_inject');

    // 优先按 JSON store 解析（新格式）；失败回退旧 prose 格式
    const json = tryParseJson(storeRaw);
    const store = json ? jsonToProseTask3(json) : storeRaw;

    const stripQuotes = (s) => String(s ?? '').replace(/[「」"“”]/g, '').trim();
    const stripEdgeQuotes = (s) => String(s ?? '').replace(/^["“”]+/, '').replace(/["“”]+$/, '').trim();

    // ▪ 子节 → { 标题: 内容 }
    const subs = {};
    for (const sub of splitSubsections(store)) subs[sub.title.trim()] = sub.content.trim();
    const playText = subs['出牌情况'] || subs['出牌情况（下方二选一）'] || '';
    const pick = (re, txt) => { const m = (txt || playText || store).match(re); return m ? m[1].trim() : ''; };

    // 静默检测：新格式「决策：静默」，兼容旧「静默/PASS」
    if (/决策\s*[：:]\s*静默/.test(playText || store) || /静默|PASS/i.test(store)) {
        const silentReason = pick(/静默原因\s*[：:]\s*([^\n]+)/, playText);
        const cm = (playText || store).match(/※\s*["“”]?\s*([^"“”\n]+)["“”]?/);
        const comment = cm ? cm[1].trim() : '';
        return { pass: true, card: null, injects: [], silentReason, comment };
    }

    const legacy = splitByDiamond(store);

    const name = stripQuotes(pick(/牌面\s*[：:]\s*([^（(\n]+)/) || legacy['牌面'] || '');
    const polarity = pick(/牌面\s*[：:]\s*[^（(\n]*[（(]([^）)]*)[）)]/);

    const strengthRaw = pick(/干涉强度\s*[：:]\s*([^（(\n]+)/);
    const strengthLevel = pick(/干涉强度\s*[：:]\s*[^（(\n]*[（(]([^）)]*)[）)]/);
    let strength = { name: strengthRaw, level: strengthLevel };
    if (!strength.name) {
        const lr = legacy['干涉强度'] || '';
        const sm = lr.match(/(\S+)\s*[（(](.+?)[）)]/);
        strength = { name: sm ? sm[1] : lr, level: sm ? sm[2] : '' };
    }

    // 命运宣言（- 命运宣言： 后跟引号行，直到 干涉内容）
    let declaration = '';
    const declBlock = playText.match(/命运宣言\s*[：:]\s*([\s\S]*?)(?=\n\s*-?\s*干涉内容|$)/);
    if (declBlock) declaration = declBlock[1].split('\n').map((l) => stripEdgeQuotes(l.trim())).filter(Boolean).join(' ');
    if (!declaration) declaration = stripEdgeQuotes(legacy['命运宣言'] || '');

    // 干涉内容
    let content = '';
    const contentBlock = playText.match(/干涉内容\s*[：:]\s*([\s\S]*?)(?=\n\s*-?\s*因果溯源|$)/);
    if (contentBlock) content = contentBlock[1].trim();
    if (!content) content = (legacy['干涉内容'] || '').trim();

    // 因果溯源
    const causality = pick(/因果溯源\s*[：:]\s*([^\n]+)/) || (legacy['因果溯源'] || '').trim();

    return {
        pass: false,
        card: { name, strength, declaration, content, causality, polarity, npcs: parseNpcs(subs), foes: parseFoes(subs), branches: parseBranches(subs) },
        injects,
    };
}

/* ---------------- Task 4：任务链生成 ---------------- */

/** task4 JSON store → 旧 prose 文本（供 parseTaskChain / serializeTaskChain 复用） */
function jsonToProseTask4(j) {
    const out = [];
    const has = (v) => v !== undefined && v !== null && v !== '';
    const arr = (v) => (Array.isArray(v) ? v : (has(v) ? [v] : []));

    const head = j['任务链'] || {};
    out.push(`◇ 任务链 #${head['编号'] || '?'}：${head['名称'] || ''}`);
    out.push('');
    if (has(head['状态'])) out.push(`状态：${head['状态']}`);
    if (has(head['任务时限'])) out.push(`任务时限：${head['任务时限']}`);
    if (has(head['阶段归属'])) out.push(`阶段归属：${head['阶段归属']}`);

    const s = j['任务梗概'];
    if (s) {
        out.push('', '▪ 任务梗概', '');
        if (has(s['表面故事'])) out.push(`表面故事：${s['表面故事']}`);
        if (has(s['真实原委'])) out.push(`真实原委：${s['真实原委']}`);
        let npcs = s['关键NPC'];
        if (npcs && !Array.isArray(npcs) && typeof npcs === 'object') {
            npcs = Object.entries(npcs).map(([k, v]) => ({ 名称: k, ...(typeof v === 'object' ? v : { 表面立场: v }) }));
        }
        npcs = arr(npcs);
        if (npcs.length) {
            out.push('关键NPC：');
            for (const n of npcs) {
                if (typeof n === 'string') { out.push(`- ${n}`); continue; }
                out.push(`- ${n['名称'] || ''}：`);
                for (const k of ['表面立场', '真实立场', '核心动机', '关键细节']) {
                    if (has(n[k])) out.push(`  ${k}：${n[k]}`);
                }
            }
        }
        if (has(s['核心矛盾'])) out.push(`核心矛盾：${s['核心矛盾']}`);
    }

    const evs = arr(j['事件链']);
    if (evs.length) {
        out.push('', '▪ 事件链', '');
        for (const e of evs) {
            out.push(`- 事件${e['序号'] ?? '?'} [${e['类型'] || '事件'}]：${e['名称'] || ''}`);
            out.push('');
            for (const k of ['事件安排', 'NPC立场', 'NPC动机', '视觉线索', '敌对']) {
                if (has(e[k])) out.push(`  ${k}：${e[k]}`);
            }
            for (const v of arr(e['可暴露信息'])) out.push(`  可暴露信息：${v}`);
            for (const v of arr(e['必须隐藏信息'])) out.push(`  必须隐藏信息：${v}`);
            const br = arr(e['分支条件']);
            if (br.length) {
                out.push('  分支条件：');
                for (const b of br) {
                    if (typeof b === 'string') out.push(`  - ${b}`);
                    else if (b && typeof b === 'object') out.push(`  - ${b['条件'] || ''} → ${b['去向'] || ''}`);
                }
            }
        }
    }

    let ends = j['最终结局'];
    if (ends && !Array.isArray(ends) && typeof ends === 'object') {
        ends = Object.entries(ends).map(([k, v]) => ({ 类型: k, ...(typeof v === 'object' ? v : { 名称: v }) }));
    }
    ends = arr(ends);
    if (ends.length) {
        out.push('', '▪ 最终结局', '');
        for (const en of ends) {
            out.push(`- 【${en['类型'] || '结局'}】：${en['名称'] || ''}`);
            out.push('');
            if (has(en['触发条件'])) out.push(`  触发条件：${en['触发条件']}`);
            if (has(en['即时后果'])) out.push(`  即时后果：${en['即时后果']}`);
            const af = en['后续影响'];
            if (af && typeof af === 'object') {
                out.push('  后续影响：');
                if (has(af['触发时间'])) out.push(`  - 触发时间：${af['触发时间']}`);
                if (has(af['伏笔内容'])) out.push(`  - 伏笔内容：${af['伏笔内容']}`);
                const evo = arr(af['伏笔演化']);
                if (evo.length) {
                    out.push('  - 伏笔演化：');
                    for (const e of evo) out.push(`    ${e}`);
                }
            } else if (has(af)) {
                out.push(`  后续影响：${af}`);
            }
        }
    }
    return out.join('\n');
}

export function parseTask4Output(text, storeTag = 'store', injectTag = '') {
    const storeParts = extractAll(ensureStoreTag(text, storeTag), storeTag || 'store');
    const storeRaw = storeParts[0]?.content || '';
    const injects = extractAll(text, injectTag || '');

    // 优先按 JSON store 解析（新格式）；失败回退旧 prose 格式
    const json = tryParseJson(storeRaw);
    const store = json ? jsonToProseTask4(json) : storeRaw;

    const tc = { raw: store, id: null, name: '', status: '', currentNode: '', 期限: '' };
    if (json) {
        const head = json['任务链'] || {};
        tc.id = head['编号'] || null;
        tc.name = head['名称'] || '';
        tc.status = head['状态'] || '';
        tc.currentNode = head['当前节点'] || '';
        tc.期限 = head['任务时限'] || head['任务期限'] || '';
        return { task_chain: tc, injects, json };
    }
    // 新格式：◇ 任务链 #N：名称；旧格式：[任务链 #N] 名称
    const head = store.match(/任务链\s*#\s*([^\s：:]+)[：:]\s*(.+)/) || store.match(/\[任务链\s*#\s*([^\]]+)\]\s*(.+)/);
    if (head) { tc.id = head[1]; tc.name = head[2].trim(); }
    const status = store.match(/状态[：:]\s*([^|\n]+)/);
    if (status) tc.status = status[1].trim();
    const node = store.match(/当前节点[：:]\s*([^\n]+)/);
    if (node) tc.currentNode = node[1].trim();
    const deadline = store.match(/任务时限[：:]\s*([^\n]+)/) || store.match(/任务期限[：:]\s*([^\n]+)/);
    if (deadline) tc.期限 = deadline[1].trim();

    return { task_chain: tc, injects };
}

/* ---------------- 通用标签提取（可自定义） ---------------- */

export function extractTaggedContent(output, tags) {
    const result = {};
    const list = String(tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    for (const tag of list) {
        try {
            const m1 = output.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
            if (m1) { result[tag] = m1[1].trim(); continue; }
            const m2 = output.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'i'));
            if (m2) result[tag] = m2[1].trim();
        } catch { /* 非法标签名忽略 */ }
    }
    return result;
}

/* ---------------- 地图结构化（供面板二冒险地图渲染） ---------------- */

const CN_MARKER = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10 };

/** 圈号/数字 → 阿拉伯数字（①→1，"2"→2，中文"十二"→12） */
export function markerNum(s) {
    if (CN_MARKER[s]) return CN_MARKER[s];
    if (/^\d+$/.test(String(s).trim())) return Number(String(s).trim());
    // 兜底：中文数字
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const t = String(s).trim();
    if (map[t]) return map[t];
    if (t.includes('十')) {
        const p = t.split('十');
        return (p[0] ? map[p[0]] : 1) * 10 + (p[1] ? map[p[1]] : 0);
    }
    return Number(t) || 0;
}

/** 解析地图原文 → { name, type, regions[{num,name,state,tag,detail,links[{dir,to,desc}]}], foes[], elements[], current } */
export function parseMap(map) {
    if (!map) return null;
    const raw = map.raw || '';
    const lines = String(raw).split('\n');
    const regions = [];
    const foes = [];
    const elements = [];
    const bounds = [];
    let cur = null;
    let inFoes = false;
    let inElements = false;
    let inBounds = false;
    let pendingLinks = []; // 独立连接行（↓/→/⇄/↕），关联到上一个区域、指向下一个区域

    const NUM = '([①②③④⑤⑥⑦⑧⑨⑩]|\\d+)';

    for (const line of lines) {
        const t = line.trim();
        if (!t) continue;

        // 区域标题：[-] ① 名称 [状态]（用途）[— 描述 / → 目标 / ← 当前位置]
        // 也支持「⇄ ④ 名称」这种「连接符 + 区域号」混合行（AI 偶发把侧连区域与连接符写在同一行）
        // 名称以 [ 、（、(、←、→、— 或行尾为界；[状态] 可选
        const hm = t.match(new RegExp(`^(?:-\\s*)?(?:([↓→←↑⇄↕])(!)?\\s*)?${NUM}\\s*[.、]?\\s*([^\\[（(←→—]+)\\s*(.*)$`));
        if (hm && !inFoes && !inElements && !inBounds && !/^(?:敌对|区域元素|边界)/.test(t)) {
            const num = markerNum(hm[3]);
            const name = hm[4].trim();
            let rest = hm[5].trim();
            let state = '';
            let tag = '';
            let detail = '';
            const links = [];
            let isCurrent = false;

            // [状态]
            const stM = rest.match(/^\[([^\]]+)\]/);
            if (stM) { state = stM[1].trim(); rest = rest.slice(stM[0].length).trim(); }
            // （用途）
            const tagM = rest.match(/^（([^）]*)）/);
            if (tagM) { tag = tagM[1].trim(); rest = rest.slice(tagM[0].length).trim(); }
            // ← 当前位置
            if (/^←\s*【?当前位置】?/.test(rest)) { isCurrent = true; rest = rest.replace(/^←\s*【?当前位置】?/, '').trim(); }
            // 行尾 → 目标（连接）
            const toM = rest.match(/^→\s*[\[（(]?\s*([①②③④⑤⑥⑦⑧⑨⑩]|\d+)\s*[\]）)]?\s*(.*)$/);
            if (toM) { links.push({ dir: '→', to: markerNum(toM[1]), desc: toM[2].replace(/^[—\-]\s*/, '').trim() }); rest = rest.slice(toM[0].length).trim(); }
            // 行尾 — 描述
            const dashM = rest.match(/^—\s*(.+)$/);
            if (dashM) { detail = dashM[1].trim(); rest = rest.slice(dashM[0].length).trim(); }
            if (rest) detail = detail ? detail + ' ' + rest : rest;

            const newRegion = { num, name, state, tag, detail, links, isCurrent };

            if (hm[1]) {
                // 侧连区域（行首带连接符，如「⇄ ④ 名称」）：连到上一个区域并单独入列，
                // 但不推进 cur，让后续独立连接行（如 ↓!）仍归上一个区域
                if (cur) cur.links.push({ dir: hm[1] + (hm[2] || ''), to: num, desc: '' });
                regions.push(newRegion);
            } else {
                // 主区域：先关联独立连接行到上一个区域，再推进 cur
                if (cur) {
                    for (const pl of pendingLinks) cur.links.push({ dir: pl.dir, to: pl.to || num, desc: pl.desc });
                    regions.push(cur);
                }
                pendingLinks = [];
                cur = newRegion;
            }
            inFoes = false; inElements = false; inBounds = false;
            continue;
        }

        // 独立连接行：↓/↓!/→/→!/←/↑/⇄/↕，可带目标 [②]/②
        if (/^(?:↓|→|←|↑|⇄|↕)/.test(t) && cur) {
            const lm = t.match(/^(↓|→|←|↑|⇄|↕)(!)?\s*(?:[\[（(]?\s*([①②③④⑤⑥⑦⑧⑨⑩]|\d+)\s*[\]）)]?)?\s*(.*)$/);
            if (lm) pendingLinks.push({ dir: lm[1] + (lm[2] || ''), to: lm[3] ? markerNum(lm[3]) : null, desc: (lm[4] || '').replace(/^[—\-]\s*/, '').trim() });
            continue;
        }

        // 区块头
        if (/敌对总览|【敌对/.test(t)) { inFoes = true; inElements = false; inBounds = false; pendingLinks = []; continue; }
        if (/区域元素|【区域元素/.test(t)) { inElements = true; inFoes = false; inBounds = false; pendingLinks = []; continue; }
        if (/边界提醒|🚫/.test(t)) { inBounds = true; inFoes = false; inElements = false; pendingLinks = []; continue; }

        // 区域描述行（含 发现条件 / ← 当前位置）
        if (cur && !inFoes && !inElements && !inBounds && !/^(?:结构|总区域|当前位置|入口|出口|入口来源)/.test(t)) {
            if (/←\s*【?当前位置】?/.test(t)) cur.isCurrent = true;
            cur.detail = cur.detail ? cur.detail + '\n' + t : t;
        }
        // 敌对/元素/边界条目
        if (inFoes && t.startsWith('-')) foes.push(t.replace(/^-\s*/, '').trim());
        if (inElements && t.startsWith('-')) elements.push(t.replace(/^-\s*/, '').trim());
        if (inBounds && (t.startsWith('-') || t.startsWith('※'))) bounds.push(t.replace(/^[-※]\s*/, '').trim());
    }
    if (cur) regions.push(cur);
    regions.sort((a, b) => (a.num || 0) - (b.num || 0));

    // 当前位置：显式字段优先，其次 ← 当前位置 标记，最后首区域（统一转数字）
    let current = markerNum(String(map.当前位置 || '').trim());
    if (!current) {
        const marked = regions.find((r) => r.isCurrent);
        current = marked ? marked.num : (regions[0] ? regions[0].num : 0);
    }

    return {
        name: map.name || '',
        type: map.type || 'closed',
        regions,
        foes,
        elements,
        bounds,
        current,
    };
}

/* ---------------- 任务链结构化（供面板二任务链节点图渲染） ---------------- */

/** 按【标题】切块（标题可同行带内容，也可独占一行后续行） */
export function splitSections(text) {
    const sections = {};
    let cur = null;
    for (const line of String(text ?? '').split('\n')) {
        const m = line.match(/^\s*【([^】]+)】\s*(.*)$/);
        if (m) {
            cur = m[1].trim();
            sections[cur] = m[2].trim();
        } else if (cur !== null) {
            const t = line.trim();
            if (t) sections[cur] = (sections[cur] ? sections[cur] + '\n' : '') + t;
        }
    }
    return sections;
}

/** 解析「任务梗概」子节 → { 表面故事, 真实原委, 关键NPC, 核心矛盾 }（四段键值对） */
function parseSynopsis(text) {
    const s = { 表面故事: '', 真实原委: '', 关键NPC: '', 核心矛盾: '' };
    let cur = null;
    for (const line of String(text || '').split('\n')) {
        const t = line.trim();
        const m = t.match(/^(表面故事|真实原委|关键NPC|核心矛盾)[：:]\s*(.*)$/);
        if (m) { cur = m[1]; s[cur] = m[2]; }
        else if (cur && t) s[cur] = (s[cur] ? s[cur] + '\n' : '') + t;
    }
    return s;
}

/** 解析「事件链」子节 → [{idx, 类型, 名称, NPC动作, NPC立场, NPC情绪, 可透露, 必隐藏, 视觉线索, 反转触发, 敌对, 分支[]}] */
function parseEvents(text) {
    const events = [];
    let cur = null;
    let mode = 'field'; // field | branch
    const FIELD_KEYS = new Set(['事件安排', 'NPC动作', 'NPC立场', 'NPC情绪', 'NPC动机', '可暴露信息', '可透露', '必须隐藏信息', '必隐藏', '视觉线索', '反转触发', '敌对', '触发条件', '预计回合数', '线索']);
    for (const line of String(text || '').split('\n')) {
        const t = line.trim();
        const m = t.match(/^-\s*事件\s*([0-9]+[A-Za-z]?)\s*\[([^\]]+)\]\s*[：:]\s*(.+)$/);
        if (m) {
            if (cur) events.push(cur);
            cur = { idx: m[1].trim(), 类型: m[2].trim(), 名称: m[3].trim(), NPC动作: '', NPC立场: '', NPC情绪: '', 可透露: '', 必隐藏: '', 视觉线索: '', 反转触发: '', 敌对: '', 触发条件: '', 预计回合数: '', 线索: '', 事件安排: '', NPC动机: '', 可暴露信息: '', 必须隐藏信息: '', 分支: [] };
            mode = 'field';
            continue;
        }
        if (!cur) continue;
        if (/^分支(?:条件)?[：:]/.test(t)) { mode = 'branch'; continue; }
        if (mode === 'branch') {
            if (t.startsWith('-')) cur.分支.push(t.replace(/^-\s*/, '').trim());
            else if (t.startsWith('时限')) cur.分支.push(t);
            continue;
        }
        const fm = t.match(/^([^\s：:]{2,12})[：:]\s*(.*)$/);
        if (fm) {
            const key = fm[1].trim(), val = fm[2].trim();
            if (FIELD_KEYS.has(key)) cur[key] = cur[key] ? cur[key] + '\n' + val : val;
        }
    }
    if (cur) events.push(cur);
    return events;
}

/** 解析「最终结局」子节 → [{类型, 名称, 触发条件, 即时后果, 后续影响:{触发时间, 伏笔内容, 伏笔演化[]}}] */
function parseEndings(text) {
    const ends = [];
    let cur = null;
    let mode = 'field'; // field | after
    for (const line of String(text || '').split('\n')) {
        const t = line.trim();
        const m = t.match(/^-\s*【(表结局|真结局|失败结局)】[：:]\s*(.+)$/);
        if (m) {
            if (cur) ends.push(cur);
            cur = { 类型: m[1].trim(), 名称: m[2].trim(), 触发条件: '', 即时后果: '', 后续影响: { 触发时间: '', 伏笔内容: '', 伏笔演化: [] } };
            mode = 'field';
            continue;
        }
        if (!cur) continue;
        if (/^后续影响/.test(t)) {
            const inline = t.match(/后续影响[：:]\s*(.+)$/);
            if (inline) cur.后续影响.伏笔内容 = inline[1].trim();
            mode = 'after';
            continue;
        }
        if (mode === 'after') {
            const tm = t.match(/^-\s*触发时间[：:]\s*(.+)$/);
            if (tm) { cur.后续影响.触发时间 = tm[1].trim(); continue; }
            const vm = t.match(/^-\s*伏笔内容[：:]\s*(.+)$/);
            if (vm) { cur.后续影响.伏笔内容 = vm[1].trim(); continue; }
            const em = t.match(/^阶段\s*([123])[（(][^）)]*[）)][：:]\s*(.+)$/);
            if (em) { cur.后续影响.伏笔演化.push(em[2].trim()); continue; }
            continue;
        }
        const fm = t.match(/^([^\s：:]{2,12})[：:]\s*(.*)$/);
        if (fm) {
            const key = fm[1].trim(), val = fm[2].trim();
            if (key === '触发条件') cur.触发条件 = val;
            else if (key === '即时后果') cur.即时后果 = val;
        }
    }
    if (cur) ends.push(cur);
    return ends;
}

/** 解析任务链原文 → 新结构（任务梗概四段 / 事件链 / 最终结局；术语与字段以默认提示词为准） */
export function parseTaskChain(tc) {
    if (!tc) return null;
    let raw = String(tc.raw || '');
    raw = raw.replace(/<\/?store\s*>/gi, '').trim();
    // 新格式：▪ 标题 子节；旧格式：【标题】——优先按 ▪ 切，兜底【】
    let sections = {};
    for (const sub of splitSubsections(raw)) sections[sub.title.trim()] = sub.content.trim();
    if (!Object.keys(sections).length) sections = splitSections(raw);

    // 头部信息（键值行）
    const pick = (re) => { const m = raw.match(re); return m ? m[1].trim() : ''; };
    const stage = pick(/阶段归属[：:]\s*([^\n]+)/);
    const 任务时限 = pick(/任务时限[：:]\s*([^\n]+)/) || pick(/任务期限[：:]\s*([^\n]+)/);

    const 梗概 = parseSynopsis(sections['任务梗概'] || sections['梗概'] || '');
    const 事件 = parseEvents(sections['事件链'] || sections['子任务链'] || '');
    const 结局 = parseEndings(sections['最终结局'] || '');

    return {
        id: tc.id, name: tc.name, status: tc.status, currentNode: tc.currentNode,
        stage, 任务时限,
        梗概, 事件, 结局,
    };
}

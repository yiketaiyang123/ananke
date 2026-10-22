/**
 * 命运编织者 · Ananke — 通用工具
 */

/** HTML 转义，防止注入 */
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 触发浏览器下载一个文本文件 */
export function downloadFile(filename, content, mime = 'text/plain') {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 简易唯一 id */
export function uid(prefix = 'fw') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 规范化标签名：容忍 <gametxt>、</gametxt>、gametxt,foo 等写法，只取第一个干净标签名 */
export function normalizeTagName(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const first = raw.split(/[,，\s]/)[0].trim();
    return first.replace(/^<\s*\/?\s*/, '').replace(/\s*\/?\s*>$/, '').trim();
}

/** 剔除正文里指定标签的内容（如 thought / img） */
export function stripTaggedBlocks(text, excludeTags) {
    if (!excludeTags) return String(text ?? '');
    const tags = String(excludeTags).split(/[,，]/).map(normalizeTagName).filter(Boolean);
    let out = String(text ?? '');
    for (const tag of tags) {
        try {
            out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
            out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
        } catch { /* 非法标签名忽略 */ }
    }
    return out;
}

/** 把「标签列表」拆成干净的标签名数组：content,gametxt / <content> / </gametxt> 都支持 */
export function splitTagNames(input) {
    return String(input || '')
        .split(/[,，\s]+/)
        .map(normalizeTagName)
        .filter(Boolean);
}

/**
 * 只保留 <tag>…</tag> 内的内容，支持多个候选标签（按给定顺序，命中第一个有内容的）。
 * 未配置标签 → 返回原文；其余情况都找不到 → 返回空串（该条不发送），
 * 避免把标签外的内容（系统提示、旁白、思维链）误发出去。
 * 标签名写法容错：content / <content> / </content> / content,gametxt 都识别。
 */
export function pickTaggedBody(text, tag) {
    const src = String(text ?? '');
    const names = Array.isArray(tag)
        ? tag.map(normalizeTagName).filter(Boolean)
        : splitTagNames(tag);
    if (!names.length) return src;

    for (const t of names) {
        try {
            const closed = src.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'));
            if (closed && String(closed[1]).trim()) return closed[1];
        } catch { /* 非法标签名忽略 */ }
    }
    // 兜底：开标签存在但未闭合，取标签之后的全部
    for (const t of names) {
        try {
            const open = src.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*)$`, 'i'));
            if (open) return open[1];
        } catch { /* 非法标签名忽略 */ }
    }
    return '';
}

/**
 * 一条历史消息的最终正文。
 * 优先级：先按 include_tag 提取 → 再按 exclude_tags 剔除 → 去空白后判空。
 * 返回空串时，调用方应跳过该条消息。
 */
export function filterMessageText(text, task) {
    const body = pickTaggedBody(text, task?.include_tag);
    if (!body || !String(body).trim()) return '';
    return stripTaggedBlocks(body, task?.exclude_tags);
}

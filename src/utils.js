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

/** 剔除正文里指定标签的内容（如 thought / img） */
export function stripTaggedBlocks(text, excludeTags) {
    if (!excludeTags) return String(text ?? '');
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

/**
 * 只保留 <tag>…</tag> 内的内容。
 * 未配置标签 → 返回原文；配置了但消息里找不到该标签 → 返回空串（该条不发送），
 * 避免把标签外的内容（系统提示、旁白、思维链）误发出去。
 */
export function pickTaggedBody(text, tag) {
    const src = String(text ?? '');
    const t = String(tag || '').trim();
    if (!t) return src;
    try {
        const closed = src.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'));
        if (closed) return closed[1];
        // 兜底：开标签存在但未闭合，取标签之后的全部
        const open = src.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*)$`, 'i'));
        return open ? open[1] : '';
    } catch {
        return '';
    }
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

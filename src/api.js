/**
 * 命运编织者 · Ananke — OpenAI 兼容 API 网络层
 * 走 SillyTavern 服务端代理 /api/backends/chat-completions/*，
 * 解决浏览器直连第三方 API 的 CORS / 混合内容 / 内网不可达问题（借鉴「构画」client）。
 */
import { getContextObject } from './runtime.js';

/** 规范化用户填的 base URL：去尾斜杠、剥离误粘的 /chat/completions、裸域名补路径 */
export function normalizeApiUrl(url) {
    const u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) return u;
    if (/\/chat\/completions$/i.test(u)) return u.replace(/\/chat\/completions$/i, '');
    if (/^https?:\/\/[^/?#]+$/i.test(u)) {
        // 火山引擎方舟(Ark) 的 OpenAI 兼容基址是 /api/v3，其余默认补 /v1
        if (/(volces\.com|ark\.cn)/i.test(u)) return `${u}/api/v3`;
        return `${u}/v1`;
    }
    return u;
}

/** 拿 ST 鉴权请求头，拿不到则降级为普通 JSON 头 */
function getHeaders() {
    const ctx = getContextObject();
    if (ctx && typeof ctx.getRequestHeaders === 'function') {
        try { return ctx.getRequestHeaders(); } catch { /* fallthrough */ }
    }
    return { 'Content-Type': 'application/json' };
}

/** 拉取 OpenAI 兼容模型列表 */
export async function fetchModels(url, key) {
    const res = await fetch('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
            chat_completion_source: 'openai',
            reverse_proxy: normalizeApiUrl(url),
            proxy_password: key,
        }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
    const data = await res.json();
    if (data?.error) throw new Error(data.error.message || data.error || '接口返回错误');
    const models = (data.data || data.models || [])
        .map((m) => (typeof m === 'string' ? m : m.id))
        .filter(Boolean)
        .sort();
    if (!models.length) throw new Error('接口未返回任何模型');
    return models;
}

/** 测试连接：能拉到模型列表即视为连接成功 */
export async function testConnection(url, key) {
    return await fetchModels(url, key);
}

/**
 * 调用 OpenAI 兼容 /chat/completions（经 ST 代理）。
 * @returns {Promise<string>} 生成的正文
 */
export async function chatCompletion({ url, key, model, messages, temperature = 0.9, maxTokens = 8000, stream = false, timeoutMs = 180000, thinking }) {
    const body = {
        chat_completion_source: 'openai',
        reverse_proxy: normalizeApiUrl(url),
        proxy_password: key,
        model: model || 'gpt-4o-mini',
        messages,
        stream,
        temperature,
        max_tokens: maxTokens,
        presence_penalty: 0,
        frequency_penalty: 0,
    };
    // 思考开关（火山引擎等支持 thinking.type：enabled/disabled/auto）。
    // 结构化任务关闭思考：否则 reasoning token 会吃掉大半输出预算，耗时也会成倍增加。
    if (thinking) body.thinking = thinking;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    try {
        const res = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
        }
        const data = await res.json();
        if (data?.error) throw new Error(data.error.message || data.error || 'API 返回错误');
        const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
        if (!content) throw new Error('模型没有返回正文');
        return String(content);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 命运编织者 · Ananke — LLM 调用封装
 * 走 ST 服务端代理（src/api.js），messages 结构（system/user 分离）。
 */
import { chatCompletion } from './api.js';
import { getSettings } from './settings.js';

/** 解析当前生效的 API 配置（global_api 的 url/key/model） */
function resolveApi() {
    const s = getSettings();
    const g = s.global_api || {};
    return { url: g.url || '', key: g.key || '', model: g.model || '' };
}

/**
 * 静默调用 API 生成文本。
 * @param {Array<{role:string, content:string}>} messages 消息数组
 * @param {string} label 生成名称（日志用）
 * @param {object} options { temperature, maxTokens, timeoutMs }
 * @returns {Promise<string>} 生成的文本
 */
export async function quietGenerate(messages, label = 'ananke', options = {}) {
    const { url, key, model } = resolveApi();
    if (!url || !key) {
        throw new Error('未配置 API：请在「提示词&API」面板填写 API 地址与 Key');
    }
    return await chatCompletion({
        url,
        key,
        model,
        messages,
        temperature: options.temperature ?? 0.9,
        maxTokens: options.maxTokens ?? 8000,
        timeoutMs: options.timeoutMs ?? 180000,
        thinking: options.thinking,
    });
}

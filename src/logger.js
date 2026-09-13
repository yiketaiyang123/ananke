/**
 * 命运编织者 · Ananke — 内存日志
 * 完全由插件生成，AI 不参与。重启清空，上限 500 条（静默截断）。
 */

const MAX_LOGS = 500;

export const LogLevel = {
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
};

/** 日志数组（内存，重启清空） */
const logs = [];

/** 当前轮次（M1 起由 scheduler 通过 setRound 更新） */
let currentRound = 0;

export function setRound(n) {
    currentRound = Number(n) || 0;
}

export function getRound() {
    return currentRound;
}

/**
 * 写入一条日志。
 * @param {string} level  LogLevel.INFO / WARN / ERROR
 * @param {string} source task1 / task2 / task3 / system
 * @param {string} message 人类可读摘要
 * @param {object|null} detail 详情（错误类型/位置/快照/原始信息/建议/完整数据）
 */
export function log(level, source, message, detail = null) {
    const entry = {
        round: currentRound,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        source,
        level,
        message,
        detail,
    };
    logs.push(entry);
    if (logs.length > MAX_LOGS) {
        logs.splice(0, logs.length - MAX_LOGS);
    }

    // 同步打印到浏览器控制台，方便调试
    const tag = `[Ananke:${source}]`;
    if (level === LogLevel.ERROR) console.error(tag, message, detail ?? '');
    else if (level === LogLevel.WARN) console.warn(tag, message, detail ?? '');
    else console.info(tag, message);
    return entry;
}

export const logInfo = (source, message, detail) => log(LogLevel.INFO, source, message, detail);
export const logWarn = (source, message, detail) => log(LogLevel.WARN, source, message, detail);
export const logError = (source, message, detail) => log(LogLevel.ERROR, source, message, detail);

export function getLogs() {
    return logs;
}

export function clearLogs() {
    logs.length = 0;
}

/** 统计摘要：总数 / 各级别数量 */
export function getStats() {
    const stats = { total: logs.length, info: 0, warn: 0, error: 0 };
    for (const l of logs) {
        if (l.level === LogLevel.INFO) stats.info++;
        else if (l.level === LogLevel.WARN) stats.warn++;
        else if (l.level === LogLevel.ERROR) stats.error++;
    }
    return stats;
}

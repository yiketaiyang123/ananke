/**
 * offline-parse-test.mjs
 * 用六份默认提示词里的「示例输出」（每个任务最后一块 assistant 内容），
 * 喂给插件自带的 parser.js，验证「提示词示例 → 解析器」是否兼容。
 * 不需要真实 LLM，也不需要外部文件，适合每次改提示词后跑一遍防回归。
 *
 * 用法：node tools/offline-parse-test.mjs
 */
import { parseTask2Output, parseTask4Output, parseTask25Output, parseTask3Output } from '../src/parser.js';
import { TASK2_DEFAULT_PROMPTS } from '../prompts/task2-engine.js';
import { TASK4_DEFAULT_PROMPTS } from '../prompts/task4-mission.js';
import { TASK2_5_DEFAULT_PROMPTS } from '../prompts/task2_5-map.js';
import { TASK3_DEFAULT_PROMPTS } from '../prompts/task3-fate.js';

const lastBlock = (blocks) => blocks[blocks.length - 1].content;

const out = [];
function check(name, cond, detail) {
  out.push({ name, pass: !!cond, detail: cond ? '' : String(detail) });
}

// 2A：剧情引擎
const r2 = parseTask2Output(lastBlock(TASK2_DEFAULT_PROMPTS));
check('2A 信号=MISSION_GEN', r2.signals?.[0]?.type === 'MISSION_GEN', JSON.stringify(r2.signals));
check('2A 游戏时间=第3游戏日', (r2.fields || {})['游戏时间'] === '第3游戏日', (r2.fields || {})['游戏时间']);
check('2A 有主角状态快照', !!r2.sections?.['主角状态快照'], Object.keys(r2.sections || {}).join(','));
check('2A 有 K1 轻量引子', !!r2.sections?.['K1 轻量引子'], Object.keys(r2.sections || {}).join(','));
check('2A 注入标签=supplement', r2.injects?.[0]?.tag === 'supplement', JSON.stringify(r2.injects?.map((i) => i.tag)));

// 2B：任务链生成
const r4 = parseTask4Output(lastBlock(TASK4_DEFAULT_PROMPTS));
check('2B 任务链名称=关隘粮案', r4.task_chain?.name === '关隘粮案', r4.task_chain?.name);
check('2B 状态=待激活', r4.task_chain?.status === '待激活', r4.task_chain?.status);
check('2B 事件链=3 条', r4.json?.['事件链']?.length === 3, r4.json?.['事件链']?.length);
check('2B 结局=3 条', r4.json?.['最终结局']?.length === 3, r4.json?.['最终结局']?.length);
check('2B 关键NPC=2 人', r4.json?.['任务梗概']?.['关键NPC']?.length === 2, r4.json?.['任务梗概']?.['关键NPC']?.length);

// 2C：地图生成（已无 map_inject）
const r25 = parseTask25Output(lastBlock(TASK2_5_DEFAULT_PROMPTS));
check('2C 地图=旧矿洞', r25.map?.name === '旧矿洞', r25.map?.name);
check('2C 无注入（map_inject 已删）', (r25.injects || []).length === 0, JSON.stringify(r25.injects));
check('2C 区域数=5', (r25.json?.['区域结构'] || []).length === 5, r25.json?.['区域结构']?.length);

// 3：命运牌
const r3 = parseTask3Output(lastBlock(TASK3_DEFAULT_PROMPTS));
check('3 非静默', r3.pass === false, r3.pass);
check('3 牌面=因果', r3.card?.name === '因果', r3.card?.name);
check('3 正负性=恶果', r3.card?.polarity === '恶果', r3.card?.polarity);
check('3 强度=涟漪/Ⅰ', r3.card?.strength?.name === '涟漪' && r3.card?.strength?.level === 'Ⅰ', JSON.stringify(r3.card?.strength));
check('3 有宣言', (r3.card?.declaration || '').length > 10, r3.card?.declaration);
check('3 有注入标签', r3.injects?.[0]?.tag === 'fate_inject', JSON.stringify(r3.injects?.map((i) => i.tag)));

console.table(out);
const failed = out.filter((x) => !x.pass);
console.log(failed.length === 0 ? 'PARSE_CHAIN_OK' : `PARSE_CHAIN_FAIL ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);

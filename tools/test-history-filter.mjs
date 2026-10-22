/**
 * test-history-filter.mjs
 * 验证「正文提取 → 排除标签」的处理顺序与边界。
 * 用法：node tools/test-history-filter.mjs
 */
import { pickTaggedBody, stripTaggedBlocks, filterMessageText } from '../src/utils.js';

const cases = [];
function eq(name, actual, expected) {
    cases.push({ name, pass: actual === expected, actual: JSON.stringify(actual), expected: JSON.stringify(expected) });
}

// 1. 提取：只保留标签内
eq('提取单标签', pickTaggedBody('<thought>x</thought><gametxt>正文A</gametxt>', 'gametxt'), '正文A');

// 2. 提取：找不到标签 → 空（该条不发）
eq('找不到标签返回空', pickTaggedBody('只有正文没有标签', 'gametxt'), '');

// 3. 未配置提取 → 原文
eq('未配置返回原文', pickTaggedBody('原文内容', ''), '原文内容');

// 4. 标签未闭合 → 取标签之后
eq('未闭合取后续', pickTaggedBody('前缀<gametxt>正文B', 'gametxt'), '正文B');

// 5. 先提取、再排除
eq('提取后排除', filterMessageText(
    '<thought>思考</thought><gametxt>a<thought>x</thought>b</gametxt>',
    { include_tag: 'gametxt', exclude_tags: 'thought' },
), 'ab');

// 6. 提取不到 → 空，即使原文有其他内容
eq('提取失败不回落全文', filterMessageText('<thought>x</thought>正文', { include_tag: 'gametxt' }), '');

// 7. 排除标签单独工作
eq('仅排除', filterMessageText('<thought>x</thought>正文C', { exclude_tags: 'thought' }), '正文C');

// 8. 多个排除标签分隔符
eq('逗号分隔', filterMessageText('<img>i</img><thought>t</thought>正文D', { exclude_tags: 'img,thought' }), '正文D');

// 9. 空结果判空
eq('全空', filterMessageText('<thought>x</thought>', { exclude_tags: 'thought' }), '');

// 10. 标签名写法容错：带尖括号 / 闭合标签
eq('填写 <gametxt>', pickTaggedBody('<gametxt>正文E</gametxt>', '<gametxt>'), '正文E');
eq('填写 </gametxt>', pickTaggedBody('<gametxt>正文F</gametxt>', '</gametxt>'), '正文F');
eq('排除标签带尖括号', filterMessageText('<thought>t</thought>正文G', { exclude_tags: '<thought>' }), '正文G');
eq('大小写不敏感', pickTaggedBody('<GameTxt>正文H</GameTxt>', 'gametxt'), '正文H');

console.table(cases);
const failed = cases.filter((c) => !c.pass);
console.log(failed.length === 0 ? 'HISTORY_FILTER_OK' : `HISTORY_FILTER_FAIL ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);

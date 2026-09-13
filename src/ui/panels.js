/**
 * 命运编织者 · Ananke — 五个面板渲染入口（分发）
 */
import { renderOutlinePanel } from './panel-outline.js';
import { renderEventPanel } from './panel-event.js';
import { renderFatePanel } from './panel-fate.js';
import { renderConfigPanel } from './panel-config.js';
import { renderLogPanel } from './panel-log.js';

export function renderPanel(panelId, container) {
    const renderers = {
        outline: renderOutlinePanel,
        event: renderEventPanel,
        fate: renderFatePanel,
        config: renderConfigPanel,
        log: renderLogPanel,
    };
    const fn = renderers[panelId];
    if (fn) fn(container);
    else container.innerHTML = `<div class="fw-panel-empty">未知面板</div>`;
}

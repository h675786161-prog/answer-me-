import './index-v2.js';

const BRIDGE_FLAG = '__answerMeChatCompletionBridgeV3';

function log(...args) {
    console.log('[💢 Answer Me · bridge]', ...args);
}

function bindChatCompletionBridge() {
    const ctx = globalThis.SillyTavern?.getContext?.();
    if (!ctx) return false;

    const source = ctx.eventSource;
    const events = ctx.eventTypes || ctx.event_types;
    if (!source || !events) return false;

    if (globalThis[BRIDGE_FLAG]) return true;

    const chatReadyEvent = events.CHAT_COMPLETION_SETTINGS_READY;
    const afterDataEvent = events.GENERATE_AFTER_DATA;
    if (!chatReadyEvent || !afterDataEvent) {
        console.warn('[💢 Answer Me · bridge] 缺少 Chat Completion / Generate 事件，无法桥接');
        return false;
    }

    source.on(chatReadyEvent, async (generateData) => {
        try {
            // Chat Completion 路径不会经过 GENERATE_AFTER_DATA。
            // Answer Me 核心监听的是后者，所以把酒馆已经组装好的 messages
            // 转成它需要的 { prompt } 形式再补发一个本地事件。
            const prompt = Array.isArray(generateData?.messages)
                ? structuredClone(generateData.messages)
                : (generateData?.prompt ?? '');

            await source.emit(afterDataEvent, { prompt }, false);
        } catch (error) {
            console.error('[💢 Answer Me · bridge] Chat Completion 赛马触发失败', error);
        }
    });

    globalThis[BRIDGE_FLAG] = true;
    log('Chat Completion 触发桥已绑定：CUSTOM / OpenAI 兼容站现在也会开赛。');
    return true;
}

if (!bindChatCompletionBridge()) {
    let tries = 0;
    const timer = setInterval(() => {
        tries += 1;
        if (bindChatCompletionBridge() || tries >= 60) {
            clearInterval(timer);
        }
    }, 500);
}

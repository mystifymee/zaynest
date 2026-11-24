import assert from "node:assert/strict";
import test from "node:test";
import { AbortController } from "abort-controller";
import { Bot } from "grammy";
import { exposeStartupRateLimit, TelegramStartupRateLimit, waitForStartupCooldown } from "../src/telegram-startup.js";

function stubStartup(limitedMethod: "getMe" | "deleteWebhook", retryAfter: number) {
    const bot = new Bot("123:synthetic");
    const requests: string[] = [];
    bot.api.config.use(async (_previous, method) => {
        requests.push(method);
        if (method === limitedMethod) {
            return {
                ok: false, error_code: 429, description: "Synthetic rate limit",
                parameters: { retry_after: retryAfter },
            };
        }
        assert.equal(method, "getMe");
        return { ok: true, result: { id: 1, is_bot: true, username: "test_bot", first_name: "Test" } } as never;
    });
    exposeStartupRateLimit(bot.api);
    return { bot, requests };
}

test("стартовый getMe на 429 прекращает повторы и задаёт паузу", async () => {
    const { bot, requests } = stubStartup("getMe", 32);
    await assert.rejects(bot.init(), error =>
        error instanceof TelegramStartupRateLimit && error.retryAfterSeconds === 60);
    assert.deepEqual(requests, ["getMe"]);
});

test("стартовый deleteWebhook на 429 сохраняет более длинную паузу Telegram", async () => {
    const { bot, requests } = stubStartup("deleteWebhook", 120);
    await bot.init();
    await assert.rejects(bot.start(), error =>
        error instanceof TelegramStartupRateLimit && error.retryAfterSeconds === 120);
    assert.deepEqual(requests, ["getMe", "deleteWebhook"]);
});

test("остановка процесса прерывает ожидание после 429", async () => {
    const controller = new AbortController();
    const waiting = waitForStartupCooldown(60, controller.signal);
    controller.abort();
    await waiting;
});

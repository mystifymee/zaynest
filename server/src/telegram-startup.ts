import type { Api } from "grammy";
import type { AbortSignal } from "abort-controller";

export class TelegramStartupRateLimit extends Error {
    readonly retryAfterSeconds: number;

    constructor(retryAfter: unknown) {
        super("Telegram rate limited bot startup");
        this.retryAfterSeconds = typeof retryAfter === "number" && Number.isSafeInteger(retryAfter)
            ? Math.max(60, retryAfter) : 60;
    }
}

export function exposeStartupRateLimit(api: Api) {
    api.config.use(async (previous, method, payload, signal) => {
        const result = await previous(method, payload, signal);
        if (!result.ok && result.error_code === 429 && (method === "getMe" || method === "deleteWebhook")) {
            // Surface the limit instead of letting grammY retry these startup calls indefinitely.
            throw new TelegramStartupRateLimit(result.parameters?.retry_after);
        }
        return result;
    });
}

export async function waitForStartupCooldown(seconds: number, signal: AbortSignal) {
    // Node timers only support delays up to 2^31-1 ms.
    const maxSecondsPerTimer = 2_147_483;
    for (let remaining = seconds; remaining > 0 && !signal.aborted;) {
        const delay = Math.min(remaining, maxSecondsPerTimer);
        await new Promise<void>(resolve => {
            const finish = () => {
                clearTimeout(timer);
                signal.removeEventListener("abort", finish);
                resolve();
            };
            const timer = setTimeout(finish, delay * 1000);
            signal.addEventListener("abort", finish);
        });
        remaining -= delay;
    }
}

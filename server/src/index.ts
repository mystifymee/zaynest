import "./env.js";
import { GrammyError } from "grammy";
import { AbortController } from "abort-controller";
import { createBot } from "./bot.js";
import { prisma } from "./db.js";
import { exposeStartupRateLimit, TelegramStartupRateLimit, waitForStartupCooldown } from "./telegram-startup.js";

const token = process.env.BOT_TOKEN;
const rawAdminId = process.env.ADMIN_TELEGRAM_ID ?? "";
const adminId = Number(rawAdminId);
if (!token || token.trim() !== token || !/^[1-9]\d*:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Укажите BOT_TOKEN в формате токена BotFather");
}
if (!/^[1-9]\d*$/.test(rawAdminId) || !Number.isSafeInteger(adminId)) {
    throw new Error("Укажите ADMIN_TELEGRAM_ID как положительный Telegram user ID");
}

const bot = createBot(token, prisma, adminId);
exposeStartupRateLimit(bot.api);
const startup = new AbortController();
let stopping: Promise<void> | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
        startup.abort();
        stopping ??= bot.stop().catch(() => {
            console.error("bot.stop_failed");
            process.exitCode = 1;
        });
    });
}

let databaseReady = false;
try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReady = true;
    if (!stopping) await bot.init(startup.signal);
    if (!stopping) await bot.start({
        allowed_updates: ["message", "callback_query"],
        onStart: () => { console.info("bot.started"); },
    });
} catch (error) {
    if (!stopping) {
        if (!databaseReady) {
            console.error("database.startup_failed");
        } else if (error instanceof TelegramStartupRateLimit) {
            console.error("telegram.startup_rate_limited", { retryAfterSeconds: error.retryAfterSeconds });
            // Keep the process alive during the cooldown so Docker cannot immediately retry.
            await waitForStartupCooldown(error.retryAfterSeconds, startup.signal);
        } else if (error instanceof GrammyError && error.error_code === 409) {
            console.error("telegram.polling_conflict");
        } else if (error instanceof GrammyError && error.error_code === 401) {
            console.error("telegram.token_rejected");
        } else {
            console.error("bot.start_failed");
        }
        if (!stopping) process.exitCode = 1;
    }
} finally {
    await stopping;
    await prisma.$disconnect().catch(() => {
        console.error("database.disconnect_failed");
        process.exitCode = 1;
    });
    if (stopping) console.info("bot.stopped");
}

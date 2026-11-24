import { randomUUID } from "node:crypto";
import { Bot, GrammyError, HttpError, InlineKeyboard, Keyboard, type Context } from "grammy";
import type { PrismaClient } from "./generated/prisma/client.js";
import { Prisma } from "./generated/prisma/client.js";
import { notifyAdmin, registerAdmin } from "./admin.js";
import { formatBookingDate, parseArea, parseName, parsePhone, services } from "./booking.js";
import type { Draft } from "./booking.js";
import { availableTimes, datePageSize, datePageStart, dateView, resolveSlot, shiftDay, timeView } from "./calendar.js";
import { confirmOrder } from "./order-store.js";
import { calculateCleaningPrice } from "./pricing.js";

const menu = new InlineKeyboard()
    .text(services.maintenance_cleaning.name, "maintenance_cleaning").row()
    .text(services.deep_cleaning.name, "deep_cleaning");
const contactKeyboard = new Keyboard().requestContact("Отправить телефон").resized().oneTime();
type CalendarDraft = Extract<Draft, { step: "date" | "time" | "confirm" }>;
const staleButton = "Кнопка устарела. Используйте последнее сообщение оформления.";

function bookingView(draft: CalendarDraft, key: string, now: Date) {
    if (draft.step === "date") {
        return dateView(datePageStart(draft.pageStart, now), key, now);
    }
    if (draft.step === "time") return timeView(draft.day, key, now);

    const service = services[draft.service];
    return {
        text: [
            "Проверьте данные заявки",
            `Услуга: ${service.name}`,
            `Площадь: ${draft.area} м²`,
            `Предварительная стоимость: ${calculateCleaningPrice(draft.area, service.price)} ₽`,
            `Имя: ${draft.name}`,
            `Телефон: ${draft.phone}`,
            `Дата уборки: ${formatBookingDate(new Date(draft.date))} (МСК)`,
            "Доступность уборки в это время уточнит администратор.",
        ].join("\n"),
        keyboard: new InlineKeyboard()
            .text("Отправить заявку", `confirm:${key}`).row()
            .text("Отменить", `cancel:${key}`),
    };
}

export function createBot(token: string, db: PrismaClient, adminId: number) {
    const bot = new Bot(token, { client: { timeoutSeconds: 40 } });

    async function saveDraft(telegramUserId: bigint, data: Draft, confirmationKey: string | null = null) {
        await db.bookingDraft.upsert({
            where: { telegramUserId },
            update: { data, confirmationKey },
            create: { telegramUserId, data, confirmationKey },
        });
    }

    async function advanceCalendar(telegramUserId: bigint, previousKey: string | null, data: CalendarDraft) {
        const confirmationKey = randomUUID();
        const result = await db.bookingDraft.updateMany({
            where: { telegramUserId, confirmationKey: previousKey },
            data: { data, confirmationKey },
        });
        return result.count ? confirmationKey : null;
    }

    async function replyWithBookingView(ctx: Context, draft: CalendarDraft, key: string, now: Date) {
        const { text, keyboard } = bookingView(draft, key, now);
        await ctx.reply(text, { reply_markup: keyboard });
    }

    bot.use(async (ctx, next) => {
        if (ctx.chat?.type !== "private" || !ctx.from) {
            if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Откройте личный чат с ботом." });
            return;
        }
        await next();
    });

    registerAdmin(bot, db, adminId);

    bot.command(["start", "cancel"], async ctx => {
        if (!ctx.from || !ctx.message) return;
        await db.bookingDraft.deleteMany({ where: { telegramUserId: BigInt(ctx.from.id) } });
        await ctx.reply(
            ctx.message.text.startsWith("/start")
                ? "Добро пожаловать в Zaynest! Выберите услугу."
                : "Оформление отменено. Выберите услугу.",
            { reply_markup: menu },
        );
    });

    bot.callbackQuery(["maintenance_cleaning", "deep_cleaning"], async ctx => {
        const service = ctx.callbackQuery.data as keyof typeof services;
        await ctx.answerCallbackQuery().catch(() => console.error("telegram.callback_ack_failed"));
        await saveDraft(BigInt(ctx.from.id), { step: "area", service });
        await ctx.reply("Укажите площадь квартиры в м² целым числом от 1 до 1000.", {
            reply_markup: { remove_keyboard: true },
        });
    });

    bot.callbackQuery("cal:noop", ctx => ctx.answerCallbackQuery());

    bot.callbackQuery(/^cal:([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}):(prev|next|earlier|later|back|day|time)(?::([\d:-]+))?$/, async ctx => {
        const [, key, action, value] = ctx.match;
        if (!key) return;
        const telegramUserId = BigInt(ctx.from.id);
        const row = await db.bookingDraft.findUnique({ where: { telegramUserId, confirmationKey: key } });
        const draft = row?.data as Draft | undefined;
        if (draft?.step !== "date" && draft?.step !== "time") {
            await ctx.answerCallbackQuery({ text: staleButton });
            return;
        }

        const now = new Date();
        const first = datePageStart(undefined, now);
        const { service, area, name, phone } = draft;
        const details = { service, area, name, phone };
        let next: CalendarDraft;
        let notice: string | undefined;
        if (draft.step === "date" && draft.pageStart) {
            const pageStart = datePageStart(draft.pageStart, now);
            if (action === "day" && value && value >= draft.pageStart
                && value < shiftDay(pageStart, datePageSize)) {
                if (availableTimes(value, now).length) {
                    next = { ...details, step: "time", day: value, pageStart };
                } else {
                    next = { ...details, step: "date", pageStart };
                    notice = "На этот день больше нет демонстрационного времени.";
                }
            } else if (action === "earlier" || action === "later") {
                const offset = action === "earlier" ? -datePageSize : datePageSize;
                const start = datePageStart(shiftDay(pageStart, offset), now);
                next = { ...details, step: "date", pageStart: start };
            } else {
                await ctx.answerCallbackQuery({ text: staleButton });
                return;
            }
        } else if (draft.step === "date" && !draft.pageStart) {
            // Older drafts still have a month calendar open.
            next = { ...details, step: "date", pageStart: first };
        } else if (draft.step === "time" && action === "back") {
            next = { ...details, step: "date", pageStart: datePageStart(draft.pageStart ?? draft.day, now) };
        } else if (draft.step === "time" && action === "time" && value) {
            const date = resolveSlot(draft.day, value, now);
            if (date) {
                next = { ...details, step: "confirm", date: date.toISOString() };
            } else {
                next = availableTimes(draft.day, now).length ? draft : { ...details, step: "date", pageStart: first };
                notice = "Это время недоступно. Выберите другое.";
            }
        } else {
            await ctx.answerCallbackQuery({ text: staleButton });
            return;
        }

        const nextKey = await advanceCalendar(telegramUserId, key, next);
        await ctx.answerCallbackQuery(nextKey ? (notice ?? {}) : staleButton)
            .catch(() => console.error("telegram.callback_ack_failed"));
        if (!nextKey) return;
        const { text, keyboard } = bookingView(next, nextKey, now);
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard });
        } catch (error) {
            if (!(error instanceof GrammyError || error instanceof HttpError)) throw error;
            await ctx.reply(text, { reply_markup: keyboard });
        }
    });

    bot.callbackQuery(/^(confirm|cancel):([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/, async ctx => {
        await ctx.answerCallbackQuery().catch(() => console.error("telegram.callback_ack_failed"));
        const telegramUserId = BigInt(ctx.from.id);
        const confirmationKey = ctx.match[2]!;
        if (ctx.match[1] === "cancel") {
            const deleted = await db.bookingDraft.deleteMany({ where: { telegramUserId, confirmationKey } });
            if (deleted.count) {
                await ctx.reply("Заявка отменена. Выберите услугу.", { reply_markup: menu });
            } else {
                await ctx.reply(staleButton);
            }
            return;
        }

        let result;
        try {
            result = await confirmOrder(db, telegramUserId, confirmationKey);
        } catch {
            console.error("database.order_confirmation_failed");
            await ctx.reply("Не удалось проверить сохранение заявки. Нажмите «Отправить заявку» ещё раз.");
            return;
        }
        if (result.kind === "stale") {
            await ctx.reply("Кнопка устарела. Продолжите текущую заявку или начните новую через /start.");
            return;
        }
        if (result.kind === "expired") {
            const row = await db.bookingDraft.findUnique({ where: { telegramUserId } });
            const draft = row?.data as Draft | undefined;
            if (draft?.step === "date" && row?.confirmationKey === null) {
                const now = new Date();
                const next = { ...draft, pageStart: datePageStart(undefined, now) };
                const key = await advanceCalendar(telegramUserId, null, next);
                if (key) {
                    await ctx.reply("Время уборки уже прошло.");
                    await replyWithBookingView(ctx, next, key, now);
                }
            }
            return;
        }

        if (result.kind === "created") {
            console.info("order.created", { orderId: result.id });
            await notifyAdmin(bot.api, adminId, result.id);
        }
        await ctx.reply(`Заявка №${result.id} сохранена.`);
    });

    bot.on(["message:text", "message:contact"], async ctx => {
        const telegramUserId = BigInt(ctx.from.id);
        const row = await db.bookingDraft.findUnique({ where: { telegramUserId } });
        if (!row) return;
        const draft = row.data as Draft;
        if (!draft) return;

        const { text, contact } = ctx.message;
        if (text?.startsWith("/")) return;
        switch (draft.step) {
            case "area": {
                if (!text) return;
                const area = parseArea(text);
                if (area === null) {
                    await ctx.reply("Введите площадь целым числом от 1 до 1000 м².");
                    return;
                }
                await saveDraft(telegramUserId, { ...draft, step: "name", area });
                const price = calculateCleaningPrice(area, services[draft.service].price);
                await ctx.reply(`Предварительная стоимость: ${price} ₽. Как вас зовут?`);
                break;
            }
            case "name": {
                if (!text) return;
                const name = parseName(text);
                if (!name) {
                    await ctx.reply("Введите имя от 2 до 50 символов. Можно использовать пробел, дефис и апостроф.");
                    return;
                }
                await saveDraft(telegramUserId, { ...draft, step: "phone", name });
                await ctx.reply("Отправьте свой контакт или введите номер с международным префиксом, например +7 или +90.", { reply_markup: contactKeyboard });
                break;
            }
            case "phone": {
                if (contact && contact.user_id !== ctx.from.id) {
                    await ctx.reply("Отправьте свой контакт или введите телефон вручную.");
                    return;
                }
                const phone = parsePhone(contact?.phone_number ?? text ?? "");
                if (!phone) {
                    await ctx.reply("Введите корректный номер с международным префиксом, например +7 или +90.");
                    return;
                }
                const now = new Date();
                const next = { ...draft, step: "date", phone, pageStart: datePageStart(undefined, now) } as const;
                const key = randomUUID();
                await saveDraft(telegramUserId, next, key);
                await ctx.reply("Телефон сохранён.", { reply_markup: { remove_keyboard: true } });
                await replyWithBookingView(ctx, next, key, now);
                break;
            }
            case "date":
            case "time":
            case "confirm": {
                if (!text) return;
                const now = new Date();
                const first = datePageStart(undefined, now);
                if ((draft.step === "date" && (!draft.pageStart || draft.pageStart < first || !row.confirmationKey))
                    || (draft.step === "time" && !availableTimes(draft.day, now).length)) {
                    const { service, area, name, phone } = draft;
                    const next = { step: "date", service, area, name, phone, pageStart: first } as const;
                    const key = await advanceCalendar(telegramUserId, row.confirmationKey, next);
                    if (key) await replyWithBookingView(ctx, next, key, now);
                } else if (row.confirmationKey) {
                    await replyWithBookingView(ctx, draft, row.confirmationKey, now);
                }
                break;
            }
        }
    });

    bot.catch(async ({ error, ctx }) => {
        const databaseError = error instanceof Prisma.PrismaClientKnownRequestError
            || error instanceof Prisma.PrismaClientUnknownRequestError
            || error instanceof Prisma.PrismaClientInitializationError;
        if (error instanceof GrammyError || error instanceof HttpError) {
            console.error("telegram.request_failed");
        } else {
            console.error(databaseError ? "database.request_failed" : "bot.update_failed");
            await ctx.reply("Не удалось выполнить действие. Попробуйте ещё раз.").catch(() => {
                console.error("telegram.error_reply_failed");
            });
        }
    });

    return bot;
}

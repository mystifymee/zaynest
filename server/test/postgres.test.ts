import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { InlineKeyboardMarkup, Update, UserFromGetMe } from "grammy/types";
import { PrismaPg } from "@prisma/adapter-pg";
import { notifyAdmin } from "../src/admin.js";
import { createBot } from "../src/bot.js";
import { currentMoscowDay, datePageStart, resolveSlot } from "../src/calendar.js";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { confirmOrder } from "../src/order-store.js";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) {
    throw new Error("Укажите TEST_DATABASE_URL отдельной тестовой базы с именем, оканчивающимся на _test.");
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const customer = 500_000_000 + Math.floor(Math.random() * 90_000_000);
const stranger = customer + 100_000_000;
const admin = customer + 200_000_000;
const me: UserFromGetMe = {
    id: 1, is_bot: true, first_name: "Test", username: "zaynest_test_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false,
    can_manage_bots: false, supports_join_request_queries: false,
};
let updateId = 1;
const future = new Date(Date.now() + 86_400_000);

function actor(id: number) {
    return { id, is_bot: false as const, first_name: "Тест" };
}

function message(id: number, text: string, group = false): Update {
    const chat = group ? { id: -1, type: "group" as const, title: "test" } : { id, type: "private" as const, first_name: "Тест" };
    return {
        update_id: updateId++,
        message: {
            message_id: updateId, from: actor(id), chat, date: 0, text,
            ...(text.startsWith("/") ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.length }] } : {}),
        },
    };
}

function callback(id: number, data: string, group = false, messageId?: number): Update {
    const sent = message(id, "Кнопка", group).message!;
    return {
        update_id: updateId++,
        callback_query: { id: String(updateId), from: actor(id), chat_instance: "test", data, message: { ...sent, date: 1, message_id: messageId ?? sent.message_id } },
    };
}

function testBot(failNotification = false, database = db, editError?: string) {
    const bot = createBot("123:synthetic", database, admin);
    bot.botInfo = me;
    const requests: { method: string; payload: Record<string, unknown> }[] = [];
    bot.api.config.use(async (_prev, method, payload) => {
        requests.push({ method, payload: payload as Record<string, unknown> });
        if (failNotification && method === "sendMessage" && "chat_id" in payload && payload.chat_id === admin) {
            return { ok: false, error_code: 403, description: "Synthetic Telegram rejection" };
        }
        if (method === "editMessageText" && editError) {
            return { ok: false, error_code: 400, description: editError };
        }
        return { ok: true, result: true } as never;
    });
    return { bot, requests };
}

function lastButton({ requests }: ReturnType<typeof testBot>, matches: (data: string) => boolean) {
    const keyboard = requests.findLast(request =>
        (request.payload.reply_markup as InlineKeyboardMarkup | undefined)?.inline_keyboard,
    )?.payload.reply_markup as InlineKeyboardMarkup | undefined;
    const button = keyboard?.inline_keyboard.flat().find(item => "callback_data" in item && matches(item.callback_data));
    assert.ok(button && "callback_data" in button);
    return button.callback_data;
}

test("PostgreSQL и обработчики Telegram", async t => {
    const id = BigInt(customer);
    const key = randomUUID();
    try {
        await t.test("конкурентное подтверждение, владение и уникальность ключа в БД", async () => {
            await db.bookingDraft.create({
                data: {
                    telegramUserId: id, confirmationKey: key,
                    data: { step: "confirm", service: "deep_cleaning", area: 50, name: "Тест", phone: "70000000000", date: future.toISOString() },
                },
            });
            assert.deepEqual(await confirmOrder(db, BigInt(stranger), key), { kind: "stale" });
            const results = await Promise.all(Array.from({ length: 8 }, () => confirmOrder(db, id, key)));
            assert.equal(results.filter(result => result.kind === "created").length, 1);
            assert.equal(results.filter(result => result.kind === "existing").length, 7);
            const order = await db.order.findUniqueOrThrow({ where: { confirmationKey: key } });
            assert.equal(order.status, "NEW");
            assert.equal(order.totalPrice, 7500);
            assert.equal(order.desiredDate.toISOString(), future.toISOString());
            const { id: _id, ...duplicate } = order;
            await assert.rejects(db.order.create({ data: duplicate }), { code: "P2002" });
            assert.equal(await db.bookingDraft.count({ where: { telegramUserId: id } }), 0);
        });

        await t.test("оформление после замены экземпляра бота и сбой уведомления", async () => {
            const first = testBot();
            await first.bot.handleUpdate(message(customer, "/start"));
            await first.bot.handleUpdate(callback(customer, "maintenance_cleaning"));
            await first.bot.handleUpdate(message(customer, "50"));
            await first.bot.handleUpdate(message(customer, "Тест"));
            await first.bot.handleUpdate({
                update_id: updateId++,
                message: {
                    message_id: updateId, from: actor(customer), chat: { id: customer, type: "private", first_name: "Тест" },
                    date: 0, contact: { user_id: stranger, first_name: "Тест", phone_number: "70000000000" },
                },
            });
            assert.equal((await db.bookingDraft.findUniqueOrThrow({ where: { telegramUserId: id } })).confirmationKey, null);
            await first.bot.handleUpdate(message(customer, "5559006781"));
            assert.ok(first.requests.some(request => String(request.payload.text).includes("международным префиксом")));
            await first.bot.handleUpdate(message(customer, "905559006781"));
            const calendarDraft = await db.bookingDraft.findUniqueOrThrow({ where: { telegramUserId: id } });
            assert.equal((calendarDraft.data as { pageStart: string }).pageStart, datePageStart(undefined, new Date()));
            const advance = lastButton(first, data => data.endsWith(":later"));
            const next = testBot(true);
            await next.bot.handleUpdate(callback(customer, advance));
            const earlier = lastButton(next, data => data.endsWith(":earlier"));
            const activePage = await db.bookingDraft.findUniqueOrThrow({ where: { telegramUserId: id } });
            await next.bot.handleUpdate(callback(customer, advance));
            await next.bot.handleUpdate(callback(customer, advance.replace(/^cal:(.*):later$/, "cancel:$1")));
            await next.bot.handleUpdate(callback(customer, earlier.replace(/:earlier$/, `:day:${currentMoscowDay(new Date())}`)));
            assert.equal((await db.bookingDraft.findUniqueOrThrow({ where: { telegramUserId: id } })).confirmationKey, activePage.confirmationKey);
            await next.bot.handleUpdate(callback(customer, earlier));

            // Pick a date on the next page, where all demo times are still in the future.
            await next.bot.handleUpdate(callback(customer, lastButton(next, data => data.endsWith(":later"))));
            const dayButton = lastButton(next, data => data.includes(":day:"));
            await next.bot.handleUpdate(callback(stranger, dayButton));
            await next.bot.handleUpdate(callback(customer, dayButton));
            const oldTime = lastButton(next, data => data.endsWith(":time:09:00"));
            await next.bot.handleUpdate(callback(customer, lastButton(next, data => data.endsWith(":back"))));
            await next.bot.handleUpdate(callback(customer, oldTime));
            const currentDayButton = lastButton(next, data => data.includes(":day:"));
            assert.equal(currentDayButton.split(":").at(-1), dayButton.split(":").at(-1));
            await next.bot.handleUpdate(callback(customer, currentDayButton));
            const time = lastButton(next, data => data.endsWith(":time:09:00"));
            await next.bot.handleUpdate(callback(customer, time.replace(/09:00$/, "09:15")));
            const validTime = lastButton(next, data => data.endsWith(":time:09:00"));
            await Promise.all([
                next.bot.handleUpdate(callback(customer, validTime)),
                next.bot.handleUpdate(callback(customer, validTime)),
            ]);
            const confirm = lastButton(next, data => data.startsWith("confirm:"));
            const selectedDay = currentDayButton.split(":").at(-1)!;
            const selectedDate = resolveSlot(selectedDay, "09:00", new Date())!;
            await next.bot.handleUpdate(callback(stranger, confirm));
            assert.equal(await db.order.count({ where: { telegramUserId: id } }), 1);
            await next.bot.handleUpdate(callback(customer, confirm));
            await next.bot.handleUpdate(callback(customer, confirm));
            const order = await db.order.findUniqueOrThrow({ where: { confirmationKey: confirm.slice("confirm:".length) } });
            assert.equal(order.desiredDate.toISOString(), selectedDate.toISOString());
            assert.equal(order.phone, "+905559006781");
            assert.equal(await db.order.count({ where: { telegramUserId: id } }), 2);
            const notifications = next.requests.filter(request => request.payload.chat_id === admin);
            assert.equal(notifications.length, 1);
            assert.match(String(notifications[0]?.payload.text), /^Новая заявка №\d+$/);
            assert.equal(next.requests.filter(request => request.payload.chat_id === customer
                && String(request.payload.text).includes("сохранена")).length, 2);
        });

        await t.test("собственный Telegram-контакт проходит ту же международную проверку", async () => {
            const owner = customer + 1;
            const telegramUserId = BigInt(owner);
            const { bot, requests } = testBot();
            await db.bookingDraft.create({
                data: { telegramUserId, data: { step: "phone", area: 20, name: "Тест", service: "deep_cleaning" } },
            });
            async function sendContact(phone_number: string) {
                await bot.handleUpdate({
                    update_id: updateId++,
                    message: {
                        message_id: updateId, from: actor(owner), chat: { id: owner, type: "private", first_name: "Тест" },
                        date: 0, contact: { user_id: owner, first_name: "Тест", phone_number },
                    },
                });
            }
            await sendContact("+900000000000");
            assert.ok(requests.some(request => String(request.payload.text).includes("международным префиксом")));
            assert.equal((await db.bookingDraft.findUniqueOrThrow({ where: { telegramUserId } })).confirmationKey, null);
            await sendContact("905559006781");
            const draft = await db.bookingDraft.findUniqueOrThrow({ where: { telegramUserId } });
            assert.equal((draft.data as { phone: string }).phone, "+905559006781");
            assert.ok(draft.confirmationKey);
        });

        await t.test("ошибка PostgreSQL даёт клиенту инструкцию повторить подтверждение", async () => {
            const unavailableUrl = new URL(url);
            unavailableUrl.pathname = `/missing_${randomUUID().replaceAll("-", "")}`;
            const unavailableDb = new PrismaClient({
                adapter: new PrismaPg({ connectionString: unavailableUrl.toString() }),
            });
            try {
                const { bot, requests } = testBot(false, unavailableDb);
                await bot.handleUpdate(callback(customer, `confirm:${randomUUID()}`));
                assert.ok(requests.some(request => String(request.payload.text).includes("Нажмите «Отправить заявку» ещё раз")));
                assert.equal(requests.some(request => request.payload.chat_id === admin), false);
            } finally {
                await unavailableDb.$disconnect();
            }
        });

        await t.test("просроченное подтверждение возвращает черновик к выбору даты", async () => {
            const owner = BigInt(stranger);
            const expiredKey = randomUUID();
            await db.bookingDraft.create({
                data: {
                    telegramUserId: owner, confirmationKey: expiredKey,
                    data: { step: "confirm", service: "deep_cleaning", area: 50, name: "Тест", phone: "70000000000", date: future.toISOString() },
                },
            });
            assert.deepEqual(await confirmOrder(db, owner, expiredKey, future), { kind: "expired" });
            const draft = await db.bookingDraft.findUniqueOrThrow({ where: { telegramUserId: owner } });
            assert.equal(draft.confirmationKey, null);
            assert.deepEqual(draft.data, { step: "date", service: "deep_cleaning", area: 50, name: "Тест", phone: "70000000000" });
            assert.equal(await db.order.count({ where: { confirmationKey: expiredKey } }), 0);
            const { bot, requests } = testBot();
            await bot.handleUpdate(message(stranger, "Продолжить"));
            const cancel = lastButton({ bot, requests }, data => data.startsWith("cancel:"));
            await bot.handleUpdate(callback(stranger, cancel));
            await bot.handleUpdate(callback(stranger, cancel));
            assert.equal(await db.bookingDraft.count({ where: { telegramUserId: owner } }), 0);
        });

        await t.test("команда, просмотр, смена статуса и повтор старой кнопки", async () => {
            const { bot, requests } = testBot();
            const order = await db.order.findUniqueOrThrow({ where: { confirmationKey: key } });
            const accept = `adm:status:${order.id}:NEW:ACCEPTED`;
            await bot.handleUpdate(message(stranger, "/orders"));
            await bot.handleUpdate(callback(stranger, `adm:order:${order.id}`));
            await bot.handleUpdate(callback(stranger, accept));
            await bot.handleUpdate(callback(admin, accept, true));
            await bot.handleUpdate(message(admin, "/orders", true));
            assert.equal(requests.some(request => /Заказы|Телефон/.test(String(request.payload.text))), false);
            assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, "NEW");

            requests.length = 0;
            await bot.handleUpdate(message(admin, "/orders"));
            assert.ok(requests.some(request => request.method === "sendMessage" && String(request.payload.text).startsWith("Заказы")));
            const panelId = 7531;
            await bot.handleUpdate(callback(admin, `adm:order:${order.id}`, false, panelId));
            assert.ok(requests.some(request => request.method === "editMessageText"
                && String(request.payload.text).includes("Телефон: 70000000000")));
            await bot.handleUpdate(callback(admin, "adm:list", false, panelId));
            assert.match(String(requests.findLast(request => request.method === "editMessageText")?.payload.text), /^Заказы/);
            await bot.handleUpdate(callback(admin, `adm:order:${order.id}`, false, panelId));
            await bot.handleUpdate(callback(admin, accept, false, panelId));
            await bot.handleUpdate(callback(admin, accept, false, panelId));
            await bot.handleUpdate(callback(admin, `adm:status:${order.id}:NEW:CANCELLED`, false, panelId));
            assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, "ACCEPTED");
            assert.ok(requests.some(request => request.method === "answerCallbackQuery" && request.payload.text === "Статус уже изменился."));
            assert.match(String(lastButton({ bot, requests }, data => data.endsWith(":COMPLETED"))), /:ACCEPTED:COMPLETED$/);
            await bot.handleUpdate(callback(admin, `adm:status:${order.id}:ACCEPTED:COMPLETED`, false, panelId));
            assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, "COMPLETED");
            assert.equal(requests.filter(request => request.method === "sendMessage").length, 1);
            const edits = requests.filter(request => request.method === "editMessageText");
            assert.equal(edits.length, 7);
            assert.ok(edits.every(request => request.payload.message_id === panelId && request.payload.reply_markup));

            const second = await db.order.findFirstOrThrow({ where: { telegramUserId: id, status: "NEW" } });
            await bot.handleUpdate(callback(admin, `adm:status:${second.id}:NEW:CANCELLED`));
            assert.equal((await db.order.findUniqueOrThrow({ where: { id: second.id } })).status, "CANCELLED");
        });
        await t.test("уведомление открывается в своём сообщении, пагинация редактирует тот же экран", async () => {
            const panel = testBot();
            const { bot, requests } = panel;
            const order = await db.order.findUniqueOrThrow({ where: { confirmationKey: key } });
            await db.order.createMany({
                data: Array.from({ length: 10 }, () => ({
                    service: "deep_cleaning", area: 50, totalPrice: 7500,
                    customerName: "Тест", phone: "70000000000", desiredDate: future,
                })),
            });
            await notifyAdmin(bot.api, admin, order.id);
            assert.equal(requests[0]?.payload.text, `Новая заявка №${order.id}`);
            const panelId = 8642;
            await bot.handleUpdate(callback(admin, lastButton(panel, data => data.startsWith("adm:order:")), false, panelId));
            await bot.handleUpdate(callback(admin, lastButton(panel, data => data === "adm:list"), false, panelId));
            await bot.handleUpdate(callback(admin, lastButton(panel, data => data.startsWith("adm:list:")), false, panelId));
            await bot.handleUpdate(callback(admin, lastButton(panel, data => data === "adm:list"), false, panelId));
            assert.equal(requests.filter(request => request.method === "sendMessage").length, 1);
            assert.deepEqual(requests.filter(request => request.method === "editMessageText")
                .map(request => request.payload.message_id), [panelId, panelId, panelId, panelId]);
        });

        await t.test("ошибки Telegram и старые кнопки не создают сообщений", async () => {
            const unchanged = testBot(false, db, "Bad Request: message is not modified");
            await unchanged.bot.handleUpdate(callback(admin, "adm:list"));
            assert.deepEqual(unchanged.requests.map(request => request.method), ["editMessageText", "answerCallbackQuery"]);
            assert.equal(unchanged.requests.at(-1)?.payload.text, undefined);

            const blocked = testBot(false, db, "Bad Request: message can't be edited");
            await blocked.bot.handleUpdate(callback(admin, "adm:list"));
            assert.deepEqual(blocked.requests.map(request => request.method), ["editMessageText", "answerCallbackQuery"]);
            assert.match(String(blocked.requests.at(-1)?.payload.text), /Откройте \/orders/);

            const stale = testBot();
            await stale.bot.handleUpdate(callback(admin, "adm:order:2147483647"));
            await stale.bot.handleUpdate(callback(admin, "adm:status:1:UNKNOWN:COMPLETED"));
            const inaccessible = callback(admin, "adm:list");
            if (inaccessible.callback_query?.message) inaccessible.callback_query.message.date = 0;
            await stale.bot.handleUpdate(inaccessible);
            assert.deepEqual(stale.requests.map(request => request.method), Array(3).fill("answerCallbackQuery"));
            assert.match(String(stale.requests[0]?.payload.text), /Заказ не найден/);
            assert.match(String(stale.requests[1]?.payload.text), /Кнопка устарела/);
            assert.match(String(stale.requests[2]?.payload.text), /сообщение недоступно/);
        });
    } finally {
        await db.$disconnect();
    }
});

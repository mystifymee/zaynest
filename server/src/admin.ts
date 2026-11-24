import { GrammyError, HttpError, InlineKeyboard, type Api, type Bot, type Context } from "grammy";
import type { Order, OrderStatus, PrismaClient } from "./generated/prisma/client.js";
import { formatBookingDate, services, type Service } from "./booking.js";

const nextStatuses: Record<OrderStatus, OrderStatus[]> = {
    NEW: ["ACCEPTED", "CANCELLED"],
    ACCEPTED: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
};

const labels: Record<OrderStatus, string> = {
    NEW: "Новый", ACCEPTED: "Принят", COMPLETED: "Выполнен", CANCELLED: "Отменён",
};

export function canAdminister(ctx: Context, adminId: number): boolean {
    return ctx.chat?.type === "private" && ctx.from?.id === adminId;
}

export async function notifyAdmin(api: Api, adminId: number, orderId: number) {
    try {
        await api.sendMessage(adminId, `Новая заявка №${orderId}`, {
            reply_markup: new InlineKeyboard().text("Открыть заказ", `adm:order:${orderId}`),
        });
    } catch {
        console.error("telegram.admin_notification_failed", { orderId });
    }
}

function orderDetails(order: Order) {
    const buttons = new InlineKeyboard();
    for (const status of nextStatuses[order.status]) {
        buttons.text(labels[status], `adm:status:${order.id}:${order.status}:${status}`).row();
    }
    buttons.text("К списку заказов", "adm:list");
    return {
        message: [
            `Заказ №${order.id} · ${labels[order.status]}`,
            `Услуга: ${services[order.service as Service]?.name ?? order.service}`,
            `Площадь: ${order.area} м²`,
            `Стоимость: ${order.totalPrice} ₽`,
            `Имя: ${order.customerName}`,
            `Телефон: ${order.phone}`,
            `Дата уборки: ${formatBookingDate(order.desiredDate)} (МСК)`,
            `Создан: ${formatBookingDate(order.createdAt)} (МСК)`,
        ].join("\n"),
        buttons,
    };
}

export function registerAdmin(bot: Bot, db: PrismaClient, adminId: number) {
    async function orderList(before?: number) {
        const pageSize = 10;
        const orders = await db.order.findMany({
            where: before === undefined ? {} : { id: { lt: before } },
            orderBy: { id: "desc" },
            select: { id: true, status: true, desiredDate: true },
            take: pageSize + 1,
        });
        const buttons = new InlineKeyboard();
        for (const order of orders.slice(0, pageSize)) {
            buttons.text(
                `№${order.id} · ${labels[order.status]} · ${formatBookingDate(order.desiredDate)}`,
                `adm:order:${order.id}`,
            ).row();
        }
        const last = orders[pageSize - 1];
        if (orders.length > pageSize && last) buttons.text("Старые заказы", `adm:list:${last.id}`).row();
        if (before !== undefined) buttons.text("К новым заказам", "adm:list");
        return { message: orders.length ? "Заказы · время московское" : "Заказов пока нет", buttons };
    }

    bot.command("orders", async ctx => {
        if (!canAdminister(ctx, adminId)) {
            await ctx.reply("Команда доступна администратору в личном чате.");
            return;
        }
        const { message, buttons } = await orderList();
        await ctx.reply(message, { reply_markup: buttons });
    });

    bot.callbackQuery(/^adm:/, async ctx => {
        if (!canAdminister(ctx, adminId)) {
            await ctx.answerCallbackQuery({ text: "Нет доступа" });
            return;
        }
        let notice: string | undefined;
        try {
            if (!ctx.callbackQuery.message?.date) {
                notice = "Это сообщение недоступно. Откройте /orders.";
                return;
            }
            const [, action, rawId, from, to, extra] = ctx.callbackQuery.data.split(":");
            const id = rawId && /^[1-9]\d{0,9}$/.test(rawId) ? Number(rawId) : 0;
            const validId = id > 0 && id <= 2_147_483_647;
            if (action === "list" && (rawId === undefined || validId) && from === undefined) {
                const { message, buttons } = await orderList(rawId === undefined ? undefined : id);
                await ctx.editMessageText(message, { reply_markup: buttons });
                return;
            }
            if (!validId || (action !== "order" && action !== "status") || extra !== undefined
                || (action === "order" && from !== undefined)) {
                notice = "Кнопка устарела. Откройте /orders.";
                return;
            }

            if (action === "status") {
                if (!from || !Object.hasOwn(nextStatuses, from) || !nextStatuses[from as OrderStatus].includes(to as OrderStatus)) {
                    notice = "Кнопка устарела. Откройте /orders.";
                    return;
                }
                const result = await db.order.updateMany({
                    where: { id, status: from as OrderStatus },
                    data: { status: to as OrderStatus },
                });
                if (!result.count) notice = "Статус уже изменился.";
            }

            const order = await db.order.findUnique({ where: { id } });
            if (!order) {
                notice = "Заказ не найден. Откройте /orders.";
                return;
            }
            const { message, buttons } = orderDetails(order);
            await ctx.editMessageText(message, { reply_markup: buttons });
        } catch (error) {
            if (error instanceof GrammyError && error.error_code === 400 && /message is not modified/i.test(error.description)) {
                return;
            }
            if (error instanceof GrammyError || error instanceof HttpError) {
                console.error("telegram.admin_edit_failed");
                notice = "Не удалось обновить сообщение. Откройте /orders.";
            } else {
                console.error("admin.navigation_failed");
                notice = "Не удалось выполнить действие. Попробуйте ещё раз.";
            }
        } finally {
            await ctx.answerCallbackQuery(notice ?? {}).catch(() => console.error("telegram.callback_ack_failed"));
        }
    });
}

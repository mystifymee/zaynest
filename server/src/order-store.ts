import type { PrismaClient } from "./generated/prisma/client.js";
import { services, type Draft } from "./booking.js";
import { calculateCleaningPrice } from "./pricing.js";

export function confirmOrder(db: PrismaClient, telegramUserId: bigint, confirmationKey: string, now = new Date()) {
    return db.$transaction(async tx => {
        const existingOrder = () => tx.order.findFirst({
            where: { telegramUserId, confirmationKey },
            select: { id: true },
        });
        const existing = await existingOrder();
        if (existing) return { kind: "existing", id: existing.id } as const;

        const where = { telegramUserId, confirmationKey };
        const row = await tx.bookingDraft.findUnique({ where });
        const draft = row?.data as Draft | undefined;
        if (draft?.step !== "confirm") {
            const order = await existingOrder();
            return order ? { kind: "existing", id: order.id } as const : { kind: "stale" } as const;
        }

        // Only the transaction that consumes this confirmation can create the order.
        const consumed = await tx.bookingDraft.deleteMany({ where });
        if (!consumed.count) {
            const order = await existingOrder();
            return order ? { kind: "existing", id: order.id } as const : { kind: "stale" } as const;
        }

        const desiredDate = new Date(draft.date);
        if (desiredDate <= now) {
            const { service, area, name, phone } = draft;
            await tx.bookingDraft.create({
                data: { telegramUserId, data: { step: "date", service, area, name, phone } },
            });
            return { kind: "expired" } as const;
        }

        const order = await tx.order.create({
            data: {
                telegramUserId, confirmationKey, desiredDate,
                service: draft.service, area: draft.area, customerName: draft.name, phone: draft.phone,
                totalPrice: calculateCleaningPrice(draft.area, services[draft.service].price),
            },
            select: { id: true },
        });
        return { kind: "created", id: order.id } as const;
    }, { isolationLevel: "ReadCommitted" });
}

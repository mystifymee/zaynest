BEGIN;

CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'ACCEPTED', 'COMPLETED', 'CANCELLED');

ALTER TABLE "Order"
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::"OrderStatus"),
    ALTER COLUMN "status" SET DEFAULT 'NEW',
    ADD COLUMN "telegramUserId" BIGINT,
    ADD COLUMN "confirmationKey" UUID;

CREATE UNIQUE INDEX "Order_confirmationKey_key" ON "Order"("confirmationKey");

CREATE TABLE "BookingDraft" (
    "telegramUserId" BIGINT NOT NULL,
    "data" JSONB NOT NULL,
    "confirmationKey" UUID,
    CONSTRAINT "BookingDraft_pkey" PRIMARY KEY ("telegramUserId")
);

CREATE UNIQUE INDEX "BookingDraft_confirmationKey_key" ON "BookingDraft"("confirmationKey");

COMMIT;

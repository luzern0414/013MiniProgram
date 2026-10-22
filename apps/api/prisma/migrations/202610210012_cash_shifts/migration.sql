-- Additive only. Historical financial rows retain every old value and a NULL shiftId.
BEGIN;
CREATE TABLE "CashShift" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'OPEN',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "openingFen" BIGINT NOT NULL,
  "openedById" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "createKey" TEXT NOT NULL,
  "createHash" TEXT NOT NULL,
  "closedById" TEXT,
  "closedAt" TIMESTAMP(3),
  "closeKey" TEXT,
  "closeHash" TEXT,
  "paymentCount" BIGINT,
  "refundCount" BIGINT,
  "paidFen" BIGINT,
  "refundFen" BIGINT,
  "netFen" BIGINT,
  "expectedFen" BIGINT,
  "countedFen" BIGINT,
  "differenceFen" BIGINT,
  "reason" TEXT,
  CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashShift_revision_check" CHECK ("revision" BETWEEN 0 AND 2000000000),
  CONSTRAINT "CashShift_opening_check" CHECK ("openingFen" BETWEEN 0 AND 2000000000),
  CONSTRAINT "CashShift_state_check" CHECK (
    ("state" = 'OPEN' AND "closedById" IS NULL AND "closedAt" IS NULL AND "closeKey" IS NULL AND "closeHash" IS NULL
      AND "paymentCount" IS NULL AND "refundCount" IS NULL AND "paidFen" IS NULL AND "refundFen" IS NULL
      AND "netFen" IS NULL AND "expectedFen" IS NULL AND "countedFen" IS NULL AND "differenceFen" IS NULL AND "reason" IS NULL)
    OR ("state" = 'CLOSED' AND "closedById" IS NOT NULL AND "closedAt" IS NOT NULL AND "closeKey" IS NOT NULL AND "closeHash" IS NOT NULL
      AND "paymentCount" IS NOT NULL AND "refundCount" IS NOT NULL AND "paidFen" IS NOT NULL AND "refundFen" IS NOT NULL
      AND "netFen" IS NOT NULL AND "expectedFen" IS NOT NULL AND "countedFen" IS NOT NULL AND "differenceFen" IS NOT NULL
      AND "paymentCount" >= 0 AND "refundCount" >= 0 AND "paidFen" >= 0 AND "refundFen" >= 0
      AND "countedFen" BETWEEN 0 AND 2000000000 AND "netFen" = "paidFen" - "refundFen"
      AND "expectedFen" = "openingFen" + "netFen" AND "differenceFen" = "countedFen" - "expectedFen"
      AND ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 500)
      AND ("differenceFen" = 0 OR "reason" IS NOT NULL))
  ),
  CONSTRAINT "CashShift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashShift_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashShift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CashShift_storeId_open_key" ON "CashShift"("storeId") WHERE "state" = 'OPEN';
CREATE UNIQUE INDEX "CashShift_storeId_createKey_key" ON "CashShift"("storeId", "createKey");
CREATE UNIQUE INDEX "CashShift_storeId_closeKey_key" ON "CashShift"("storeId", "closeKey");
CREATE INDEX "CashShift_storeId_state_openedAt_id_idx" ON "CashShift"("storeId", "state", "openedAt", "id");
ALTER TABLE "CashPayment" ADD COLUMN "shiftId" TEXT;
ALTER TABLE "CashRefund" ADD COLUMN "shiftId" TEXT;
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashRefund" ADD CONSTRAINT "CashRefund_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CashPayment_shiftId_idx" ON "CashPayment"("shiftId");
CREATE INDEX "CashRefund_shiftId_idx" ON "CashRefund"("shiftId");
COMMIT;

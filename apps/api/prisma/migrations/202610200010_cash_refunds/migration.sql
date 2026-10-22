-- Preserve the original receipt and all historical rows; only the new counter defaults to zero.
BEGIN;
ALTER TABLE "CashPayment" ADD COLUMN "refundedFen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_refundedFen_check"
  CHECK ("refundedFen" >= 0 AND "refundedFen" <= "amountFen");

CREATE TABLE "CashRefund" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "amountFen" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  CONSTRAINT "CashRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashRefund_amountFen_check" CHECK ("amountFen" > 0),
  CONSTRAINT "CashRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CashPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CashRefund_paymentId_idempotencyKey_key" ON "CashRefund"("paymentId", "idempotencyKey");
CREATE INDEX "CashRefund_paymentId_createdAt_id_idx" ON "CashRefund"("paymentId", "createdAt", "id");
CREATE INDEX "CashRefund_createdAt_idx" ON "CashRefund"("createdAt");

-- Extend existing valid states without rewriting history or weakening unpaid/fulfillment rules.
ALTER TABLE "Order" DROP CONSTRAINT "Order_status_valid";
ALTER TABLE "Order" ADD CONSTRAINT "Order_status_valid" CHECK (
  "status" IN ('PENDING_PAYMENT','AWAITING_ACCEPTANCE','PREPARING','READY','DELIVERING','COMPLETED','CANCELLED')
  AND "paymentStatus" IN ('UNPAID','PAID','CLOSED')
  AND "refundStatus" IN ('NONE','PARTIAL','PROCESSING','SUCCEEDED','FAILED')
  AND "mode" IN ('DINE_IN','PICKUP','DELIVERY')
);
ALTER TABLE "Order" DROP CONSTRAINT "Order_payment_state_valid";
ALTER TABLE "Order" ADD CONSTRAINT "Order_payment_state_valid" CHECK (
  ("status" = 'PENDING_PAYMENT' AND "paymentStatus" = 'UNPAID')
  OR ("status" = 'CANCELLED' AND "paymentStatus" = 'CLOSED')
  OR ("status" = 'CANCELLED' AND "paymentStatus" = 'PAID' AND "refundStatus" = 'SUCCEEDED')
  OR ("status" IN ('AWAITING_ACCEPTANCE','PREPARING','READY','DELIVERING','COMPLETED') AND "paymentStatus" = 'PAID')
);
COMMIT;

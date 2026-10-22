ALTER TABLE "Order" ADD COLUMN "paymentExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT (now() + '00:15:00'::interval);
UPDATE "Order" SET "paymentExpiresAt" = "createdAt" + '00:15:00'::interval;
CREATE INDEX "Order_unpaid_expiry_idx" ON "Order" ("paymentExpiresAt", "id") WHERE "status" = 'PENDING_PAYMENT' AND "paymentStatus" = 'UNPAID';

-- Additive only: no historical tables, rows or timestamp defaults are rewritten.
BEGIN;
CREATE TABLE "CashierDraft" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "selection" JSONB NOT NULL,
  "display" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createKey" TEXT NOT NULL,
  "createHash" TEXT NOT NULL,
  "orderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashierDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashierDraft_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "CashierDraft_state_check" CHECK ("state" IN ('DRAFT','CONVERTED','CANCELLED')),
  CONSTRAINT "CashierDraft_order_check" CHECK (("state" = 'CONVERTED') = ("orderId" IS NOT NULL)),
  CONSTRAINT "CashierDraft_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashierDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashierDraft_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashierDraft_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CashierDraft_storeId_createKey_key" ON "CashierDraft"("storeId", "createKey");
CREATE UNIQUE INDEX "CashierDraft_orderId_key" ON "CashierDraft"("orderId");
CREATE INDEX "CashierDraft_storeId_state_updatedAt_id_idx" ON "CashierDraft"("storeId", "state", "updatedAt", "id");
COMMIT;

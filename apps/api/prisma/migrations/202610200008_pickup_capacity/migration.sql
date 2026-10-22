CREATE TABLE "PickupPolicy" (
 "storeId" TEXT PRIMARY KEY REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "enabled" BOOLEAN NOT NULL DEFAULT false,
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision">=0),
 "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai' CHECK ("timezone"='Asia/Shanghai'),
 "leadMinutes" INTEGER NOT NULL DEFAULT 15 CHECK ("leadMinutes" BETWEEN 0 AND 1440),
 "maxAdvanceDays" INTEGER NOT NULL DEFAULT 14 CHECK ("maxAdvanceDays" BETWEEN 1 AND 90)
);
INSERT INTO "PickupPolicy" ("storeId") SELECT "id" FROM "Store";
CREATE TABLE "PickupSlot" (
 "id" TEXT PRIMARY KEY,
 "storeId" TEXT NOT NULL REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "startsAt" TIMESTAMP(3) NOT NULL,
 "endsAt" TIMESTAMP(3) NOT NULL,
 "capacity" INTEGER NOT NULL CHECK ("capacity" BETWEEN 1 AND 1000),
 "heldCount" INTEGER NOT NULL DEFAULT 0 CHECK ("heldCount">=0),
 "confirmedCount" INTEGER NOT NULL DEFAULT 0 CHECK ("confirmedCount">=0),
 "enabled" BOOLEAN NOT NULL DEFAULT true,
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision">=0),
 CHECK ("heldCount"+"confirmedCount" <= "capacity"),
 CHECK ("endsAt">"startsAt" AND "endsAt"-"startsAt" BETWEEN interval '5 minutes' AND interval '240 minutes'),
 CHECK (("startsAt"+interval '8 hours')::date=("endsAt"+interval '8 hours')::date)
);
CREATE INDEX "PickupSlot_storeId_startsAt_idx" ON "PickupSlot"("storeId","startsAt");
CREATE TABLE "PickupReservation" (
 "orderId" TEXT PRIMARY KEY REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "slotId" TEXT NOT NULL REFERENCES "PickupSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "state" TEXT NOT NULL CHECK ("state" IN ('HELD','CONFIRMED','RELEASED'))
);
CREATE INDEX "PickupReservation_slotId_idx" ON "PickupReservation"("slotId");
CREATE TABLE "PickupSequence" (
 "storeId" TEXT NOT NULL REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "serviceDate" TEXT NOT NULL CHECK ("serviceDate" ~ '^\d{4}-\d{2}-\d{2}$'),
 "lastNumber" INTEGER NOT NULL CHECK ("lastNumber">0),
 PRIMARY KEY ("storeId","serviceDate")
);
ALTER TABLE "Order" ADD COLUMN "pickupServiceDate" TEXT,
 ADD COLUMN "pickupOrdinal" INTEGER,
 ADD COLUMN "pickupWindow" JSONB,
 ADD CONSTRAINT "Order_pickupOrdinal_check" CHECK ("pickupOrdinal" IS NULL OR "pickupOrdinal">0),
 ADD CONSTRAINT "Order_pickupIdentity_check" CHECK (("pickupServiceDate" IS NULL)=("pickupOrdinal" IS NULL));
CREATE UNIQUE INDEX "Order_storeId_pickupServiceDate_pickupOrdinal_key" ON "Order"("storeId","pickupServiceDate","pickupOrdinal");

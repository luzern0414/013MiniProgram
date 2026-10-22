ALTER TABLE "User"
  ADD COLUMN "staffAccount" TEXT,
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "User_brandId_staffAccount_key" ON "User"("brandId", "staffAccount");

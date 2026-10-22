-- Additive only: no old rows, columns, order address snapshots or timestamps are rewritten.
BEGIN;
CREATE TABLE "CustomerAddressBook" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "CustomerAddressBook_revision_check" CHECK ("revision" BETWEEN 0 AND 2000000000),
  CONSTRAINT "CustomerAddressBook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CustomerAddress" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "point" JSONB,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "CustomerAddress_revision_check" CHECK ("revision" BETWEEN 0 AND 2000000000),
  CONSTRAINT "CustomerAddress_deleted_default_check" CHECK ("deletedAt" IS NULL OR NOT "isDefault"),
  CONSTRAINT "CustomerAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CustomerAddressBook"("userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomerAddress_userId_default_key" ON "CustomerAddress"("userId") WHERE "isDefault" AND "deletedAt" IS NULL;
CREATE INDEX "CustomerAddress_userId_deletedAt_isDefault_updatedAt_id_idx" ON "CustomerAddress"("userId", "deletedAt", "isDefault", "updatedAt", "id");
CREATE TABLE "CustomerAddressOperation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "addressId" TEXT NOT NULL,
  "resultAddressRevision" INTEGER NOT NULL,
  "resultBookRevision" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "CustomerAddressOperation_kind_check" CHECK ("kind" IN ('CREATE','UPDATE','DEFAULT','DELETE')),
  CONSTRAINT "CustomerAddressOperation_address_revision_check" CHECK ("resultAddressRevision" BETWEEN 0 AND 2000000000),
  CONSTRAINT "CustomerAddressOperation_book_revision_check" CHECK ("resultBookRevision" BETWEEN 0 AND 2000000000),
  CONSTRAINT "CustomerAddressOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CustomerAddressBook"("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomerAddressOperation_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "CustomerAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomerAddressOperation_userId_key_key" ON "CustomerAddressOperation"("userId", "key");
CREATE INDEX "CustomerAddressOperation_addressId_idx" ON "CustomerAddressOperation"("addressId");
COMMIT;

BEGIN;
ALTER TABLE "Category" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "allStores" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "CategoryStoreVisibility" (
  "categoryId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  CONSTRAINT "CategoryStoreVisibility_pkey" PRIMARY KEY ("categoryId", "storeId"),
  CONSTRAINT "CategoryStoreVisibility_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CategoryStoreVisibility_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CategoryStoreVisibility_storeId_idx" ON "CategoryStoreVisibility"("storeId");
CREATE TABLE "Unit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "brandId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Unit_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Unit_brandId_name_key" ON "Unit"("brandId", "name");
ALTER TABLE "Product" ADD COLUMN "unitId" TEXT;
-- Keep legacy text byte-for-byte. Distinct unit text belongs to the product store's brand.
INSERT INTO "Unit" ("id", "brandId", "name")
SELECT 'legacy_unit_' || md5(json_build_array(s."brandId", p."unit")::text), s."brandId", p."unit"
FROM "Product" p JOIN "Store" s ON s."id" = p."storeId"
GROUP BY s."brandId", p."unit";
UPDATE "Product" p SET "unitId" = u."id"
FROM "Store" s, "Unit" u
WHERE s."id" = p."storeId" AND u."brandId" = s."brandId" AND u."name" = p."unit";
CREATE INDEX "Product_unitId_idx" ON "Product"("unitId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "configurationRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Sku" ADD COLUMN     "combinationKey" TEXT,
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Modifier" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ProductSpecGroup" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductSpecGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSpecValue" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductSpecValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuSpecSelection" (
    "skuId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "valueId" TEXT NOT NULL,

    CONSTRAINT "SkuSpecSelection_pkey" PRIMARY KEY ("skuId","groupId")
);

-- CreateTable
CREATE TABLE "ProductAttributeGroup" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductAttributeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttributeOption" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductAttributeOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSpecGroup_productId_idx" ON "ProductSpecGroup"("productId");

-- CreateIndex
CREATE INDEX "ProductSpecValue_groupId_idx" ON "ProductSpecValue"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSpecValue_id_groupId_key" ON "ProductSpecValue"("id", "groupId");

-- CreateIndex
CREATE INDEX "SkuSpecSelection_valueId_groupId_idx" ON "SkuSpecSelection"("valueId", "groupId");

-- CreateIndex
CREATE INDEX "ProductAttributeGroup_productId_idx" ON "ProductAttributeGroup"("productId");

-- CreateIndex
CREATE INDEX "ProductAttributeOption_groupId_idx" ON "ProductAttributeOption"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_productId_combinationKey_key" ON "Sku"("productId", "combinationKey");

-- AddForeignKey
ALTER TABLE "ProductSpecGroup" ADD CONSTRAINT "ProductSpecGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSpecValue" ADD CONSTRAINT "ProductSpecValue_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductSpecGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuSpecSelection" ADD CONSTRAINT "SkuSpecSelection_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuSpecSelection" ADD CONSTRAINT "SkuSpecSelection_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductSpecGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuSpecSelection" ADD CONSTRAINT "SkuSpecSelection_valueId_groupId_fkey" FOREIGN KEY ("valueId", "groupId") REFERENCES "ProductSpecValue"("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeGroup" ADD CONSTRAINT "ProductAttributeGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeOption" ADD CONSTRAINT "ProductAttributeOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductAttributeGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain bounds on newly introduced fields, without truncating existing data.
ALTER TABLE "Product" ADD CONSTRAINT "Product_configurationRevision_valid" CHECK ("configurationRevision" >= 0);
ALTER TABLE "ProductSpecGroup" ADD CONSTRAINT "ProductSpecGroup_sort_valid" CHECK (sort BETWEEN 0 AND 100000);
ALTER TABLE "ProductSpecValue" ADD CONSTRAINT "ProductSpecValue_sort_valid" CHECK (sort BETWEEN 0 AND 100000);
ALTER TABLE "ProductAttributeGroup" ADD CONSTRAINT "ProductAttributeGroup_bounds_valid" CHECK (sort BETWEEN 0 AND 100000 AND "minSelections" >= 0 AND "maxSelections" >= "minSelections" AND "maxSelections" <= 10);
ALTER TABLE "ProductAttributeOption" ADD CONSTRAINT "ProductAttributeOption_sort_valid" CHECK (sort BETWEEN 0 AND 100000);

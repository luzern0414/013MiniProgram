ALTER TABLE "Sku" ADD CONSTRAINT "Sku_capacity_valid" CHECK ("stock"::bigint + "reserved"::bigint <= 2000000000);
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_capacity_valid" CHECK ("stock"::bigint + "reserved"::bigint <= 2000000000);

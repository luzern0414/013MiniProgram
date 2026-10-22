ALTER TABLE "Order" ALTER COLUMN "paymentExpiresAt" SET DEFAULT ((now() AT TIME ZONE 'UTC') + '00:15:00'::interval);

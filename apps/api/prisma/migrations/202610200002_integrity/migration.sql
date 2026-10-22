ALTER TABLE "Sku" ADD CONSTRAINT "Sku_money_stock_valid" CHECK ("priceFen" >= 0 AND "stock" >= 0 AND "reserved" >= 0);
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_money_stock_valid" CHECK ("priceFen" >= 0 AND "stock" >= 0 AND "reserved" >= 0);
ALTER TABLE "Store" ADD CONSTRAINT "Store_money_valid" CHECK ("deliveryFeeFen" >= 0 AND "minOrderFen" >= 0 AND "pickupMinutes" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_totals_valid" CHECK ("subtotalFen" >= 0 AND "deliveryFeeFen" >= 0 AND "packagingFeeFen" >= 0 AND "discountFen" >= 0 AND "totalFen" >= 0 AND "totalFen"::bigint = "subtotalFen"::bigint + "deliveryFeeFen"::bigint + "packagingFeeFen"::bigint - "discountFen"::bigint);
ALTER TABLE "Order" ADD CONSTRAINT "Order_status_valid" CHECK ("status" IN ('PENDING_PAYMENT','AWAITING_ACCEPTANCE','PREPARING','READY','DELIVERING','COMPLETED','CANCELLED') AND "paymentStatus" IN ('UNPAID','PAID','CLOSED') AND "refundStatus" IN ('NONE','PROCESSING','SUCCEEDED','FAILED') AND "mode" IN ('DINE_IN','PICKUP','DELIVERY'));
ALTER TABLE "Order" ADD CONSTRAINT "Order_payment_state_valid" CHECK (("status" = 'PENDING_PAYMENT' AND "paymentStatus" = 'UNPAID') OR ("status" = 'CANCELLED' AND "paymentStatus" = 'CLOSED') OR ("status" IN ('AWAITING_ACCEPTANCE','PREPARING','READY','DELIVERING','COMPLETED') AND "paymentStatus" = 'PAID'));
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_valid" CHECK ("amountFen" >= 0 AND "tenderedFen" >= "amountFen" AND "changeFen" >= 0 AND "changeFen" = "tenderedFen" - "amountFen");
ALTER TABLE "User" ADD CONSTRAINT "User_role_valid" CHECK ("role" IN ('CUSTOMER','OWNER','CLERK') AND "balanceFen" >= 0 AND "points" >= 0);
ALTER TABLE "Page" ADD CONSTRAINT "Page_version_valid" CHECK ("version" >= 0);

-- Removes the online-payment schema from databases created before Munshi went cash on delivery
-- (24 Oct 2026), so `prisma db push` runs without --accept-data-loss. Safe to run on every build:
-- it only touches payment objects and does nothing once they are gone (or on a fresh database).
DROP TABLE IF EXISTS "Payment";
DROP TYPE IF EXISTS "PaymentKind";
ALTER TABLE IF EXISTS "Shop" DROP COLUMN IF EXISTS "activationPaidAt";
ALTER TABLE IF EXISTS "Order" DROP COLUMN IF EXISTS "paymentStatus";
DROP TYPE IF EXISTS "PaymentStatus";

-- OrderStatus lost PAID: a paid order still waiting for the owner goes back to PLACED.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OrderStatus' AND e.enumlabel = 'PAID'
  ) THEN
    ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
    CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'ACCEPTED', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'REJECTED');
    ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus"
      USING (CASE WHEN "status"::text = 'PAID' THEN 'PLACED' ELSE "status"::text END)::"OrderStatus";
    ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PLACED';
    DROP TYPE "OrderStatus_old";
  END IF;
END $$;

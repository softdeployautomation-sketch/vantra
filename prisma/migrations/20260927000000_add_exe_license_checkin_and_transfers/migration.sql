-- Revocation-on-transfer task (2026-09-18): live check-in visibility +
-- full transfer history. Additive, backward-compatible -- no existing row
-- changes, lastCheckinAt/transfers all nullable/empty on old rows.

-- AlterTable
ALTER TABLE "ExeLicense" ADD COLUMN "lastCheckinAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExeLicenseTransfer" (
    "id" TEXT NOT NULL,
    "exeLicenseId" TEXT NOT NULL,
    "fromMachineId" TEXT NOT NULL,
    "fromMachineLabel" TEXT,
    "toMachineId" TEXT NOT NULL,
    "toMachineLabel" TEXT,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExeLicenseTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExeLicenseTransfer_exeLicenseId_transferredAt_idx" ON "ExeLicenseTransfer"("exeLicenseId", "transferredAt");

-- AddForeignKey
ALTER TABLE "ExeLicenseTransfer" ADD CONSTRAINT "ExeLicenseTransfer_exeLicenseId_fkey"
  FOREIGN KEY ("exeLicenseId") REFERENCES "ExeLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

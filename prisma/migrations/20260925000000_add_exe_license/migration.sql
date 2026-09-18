-- Server-side ExeLicense record + one-device machine binding (Task 44.2b, mirroring
-- SpaceWorker Task 47). Issuance stores an UNBOUND key (a purchase reference the EXE
-- must refuse); a claim re-signs it with the buyer's device machine_id and records the
-- binding here. New table only — additive and backward-compatible.

-- CreateTable
CREATE TABLE "ExeLicense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "licenseKey" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boundMachineId" TEXT,
    "boundMachineLabel" TEXT,
    "boundLicenseKey" TEXT,
    "boundAt" TIMESTAMP(3),

    CONSTRAINT "ExeLicense_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ExeLicense" ADD CONSTRAINT "ExeLicense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExeLicense" ADD CONSTRAINT "ExeLicense_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddIndex
CREATE UNIQUE INDEX "ExeLicense_paymentId_key" ON "ExeLicense"("paymentId");

-- AddIndex
CREATE UNIQUE INDEX "ExeLicense_licenseKey_key" ON "ExeLicense"("licenseKey");

-- AddIndex
CREATE INDEX "ExeLicense_userId_idx" ON "ExeLicense"("userId");
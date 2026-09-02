-- AlterTable: User gains billing fields
ALTER TABLE "User" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "User" ADD COLUMN "premiumExpiresAt" TIMESTAMP(3);

-- AlterTable: Deployment widened for the "separated" install method + per-device Site.
-- trmmDeploymentUid becomes nullable (separated installs have no TRMM Deployment);
-- multiple NULLs are still allowed under the existing UNIQUE constraint.
ALTER TABLE "Deployment" ALTER COLUMN "trmmDeploymentUid" DROP NOT NULL;
ALTER TABLE "Deployment" ADD COLUMN "installMethod" TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE "Deployment" ADD COLUMN "trmmSiteId" INTEGER;
ALTER TABLE "Deployment" ADD COLUMN "deviceName" TEXT;
-- MSI+PDF third option: true only when the generator call actually succeeds.
ALTER TABLE "Deployment" ADD COLUMN "msiReady" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: Payment ledger for OpenNode charges.
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openNodeChargeId" TEXT,
    "amountUsd" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'initial',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_openNodeChargeId_key" ON "Payment"("openNodeChargeId");
CREATE INDEX "Payment_userId_status_idx" ON "Payment"("userId", "status");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
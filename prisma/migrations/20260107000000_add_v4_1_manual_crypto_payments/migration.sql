-- V4.1 — Manual crypto payments (BTC + USDT-TRC20) + admin panel.

-- AlterTable: Payment gains V4.1 crypto columns. All nullable/defaulted so the
-- existing OpenNode rows (method="opennode") remain valid unchanged.
ALTER TABLE "Payment" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'opennode';
ALTER TABLE "Payment" ADD COLUMN "walletAddress" TEXT;
ALTER TABLE "Payment" ADD COLUMN "priceAtOrderUsd" DOUBLE PRECISION;
ALTER TABLE "Payment" ADD COLUMN "expectedAmountCrypto" DOUBLE PRECISION;
ALTER TABLE "Payment" ADD COLUMN "txHash" TEXT;
ALTER TABLE "Payment" ADD COLUMN "actualAmountUsd" DOUBLE PRECISION;
ALTER TABLE "Payment" ADD COLUMN "confirmations" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Payment" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "reviewNote" TEXT;

-- CreateIndex: unique txHash blocks reusing a customer-submitted hash across orders
-- (multiple NULLs still allowed under the UNIQUE constraint).
CREATE UNIQUE INDEX "Payment_txHash_key" ON "Payment"("txHash");

-- CreateIndex: admin payments-list filter
CREATE INDEX "Payment_method_verificationStatus_idx" ON "Payment"("method", "verificationStatus");

-- CreateTable: PaymentVerificationAttempt — audit trail of every on-chain attempt.
CREATE TABLE "PaymentVerificationAttempt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentVerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentVerificationAttempt_paymentId_createdAt_idx" ON "PaymentVerificationAttempt"("paymentId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentVerificationAttempt" ADD CONSTRAINT "PaymentVerificationAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: AdminSetting — singleton config row (wallet addresses etc).
CREATE TABLE "AdminSetting" (
    "id" TEXT NOT NULL,
    "btcAddress" TEXT,
    "usdtTrc20Address" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSetting_pkey" PRIMARY KEY ("id")
);
-- Second USDT wallet address, on the Ethereum (ERC20) chain — independent from
-- the existing usdtTrc20Address. Nullable, admin-configurable at runtime like
-- every other wallet/price field.
ALTER TABLE "AdminSetting" ADD COLUMN "usdtErc20Address" TEXT;

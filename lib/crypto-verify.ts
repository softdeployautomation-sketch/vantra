import "server-only";

// Live-verified public on-chain verification for manual crypto payments.
//
// USDT-TRC20: Tronscan public API (no auth). Real quirk caught live — Tronscan
//   returns HTTP 200 for BOTH a found and a not-found/malformed hash, so
//   "not found" must be detected by checking the response SHAPE
//   (typeof data.confirmed !== "boolean"), never by HTTP status.
//
// BTC: blockchain.info public API (no auth). The rawtx endpoint carries
//   out[] + block_height but NO confirmations — a SECOND call to
//   /q/getblockcount (plain-text tip, not JSON) computes
//   confirmations = tip - block_height + 1. A bad hash DOES return a real 404.
//
// Live price source (one call for both) — coingecko; BTC-only fallback is
//   blockchain.info/ticker; USDT fallback-of-last-resort is a hardcoded 1.0.

export const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const FETCH_TIMEOUT_MS = 10_000;

export interface CryptoVerifyResult {
  ok: boolean;
  reason?:
    | "not_found"
    | "not_confirmed"
    | "wrong_contract"
    | "address_mismatch"
    | "fetch_error";
  confirmations: number;
  actualAmountCrypto: number;
  toAddressMatched: boolean;
}

export async function getLivePrices(): Promise<{ btcUsd: number; usdtUsd: number }> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,tether&vs_currencies=usd",
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    const d = await r.json();
    return { btcUsd: d.bitcoin.usd, usdtUsd: d.tether.usd };
  } catch {
    try {
      const r = await fetch("https://blockchain.info/ticker", {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const d = await r.json();
      return { btcUsd: d.USD.last, usdtUsd: 1.0 };
    } catch {
      throw new Error("Could not fetch a live BTC/USD price from any source.");
    }
  }
}

export async function verifyUsdtPayment(
  txHash: string,
  expectedWalletAddress: string,
): Promise<CryptoVerifyResult> {
  try {
    const r = await fetch(
      `https://apilist.tronscan.org/api/transaction-info?hash=${txHash}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    const data = await r.json().catch(() => null);
    // Tronscan returns HTTP 200 for both success AND not-found/malformed —
    // check the shape, not the status.
    if (!data || typeof data.confirmed !== "boolean")
      return { ok: false, reason: "not_found", confirmations: 0, actualAmountCrypto: 0, toAddressMatched: false };
    if (!data.confirmed || data.contractRet !== "SUCCESS")
      return { ok: false, reason: "not_confirmed", confirmations: 0, actualAmountCrypto: 0, toAddressMatched: false };
    const transfer = data.trc20TransferInfo?.[0];
    if (!transfer)
      return { ok: false, reason: "not_found", confirmations: 0, actualAmountCrypto: 0, toAddressMatched: false };
    if (transfer.contract_address !== USDT_TRC20_CONTRACT)
      return { ok: false, reason: "wrong_contract", confirmations: 1, actualAmountCrypto: 0, toAddressMatched: false };
    const actualAmountCrypto = parseInt(transfer.amount_str, 10) / 10 ** transfer.decimals;
    const toAddressMatched = transfer.to_address === expectedWalletAddress;
    if (!toAddressMatched)
      return { ok: false, reason: "address_mismatch", confirmations: 1, actualAmountCrypto, toAddressMatched: false };
    return { ok: true, confirmations: 1, actualAmountCrypto, toAddressMatched: true };
  } catch {
    return { ok: false, reason: "fetch_error", confirmations: 0, actualAmountCrypto: 0, toAddressMatched: false };
  }
}

export async function verifyBtcPayment(
  txHash: string,
  expectedWalletAddress: string,
): Promise<CryptoVerifyResult> {
  try {
    const r = await fetch(`https://blockchain.info/rawtx/${txHash}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) return { ok: false, reason: "not_found", confirmations: 0, actualAmountCrypto: 0, toAddressMatched: false };
    const tx = await r.json();
    const matching = (tx.out ?? []).filter(
      (o: { addr: string; value: number }) => o.addr === expectedWalletAddress,
    );
    const toAddressMatched = matching.length > 0;
    const actualAmountCrypto =
      matching.reduce((sum: number, o: { value: number }) => sum + o.value, 0) / 1e8;
    const tipRes = await fetch("https://blockchain.info/q/getblockcount", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const tip = parseInt((await tipRes.text()).trim(), 10);
    const confirmations = tx.block_height ? tip - tx.block_height + 1 : 0;
    if (!toAddressMatched)
      return { ok: false, reason: "address_mismatch", confirmations, actualAmountCrypto, toAddressMatched: false };
    if (confirmations < 1)
      return { ok: false, reason: "not_confirmed", confirmations, actualAmountCrypto, toAddressMatched: true };
    return { ok: true, confirmations, actualAmountCrypto, toAddressMatched: true };
  } catch {
    return { ok: false, reason: "fetch_error", confirmations: 0, actualAmountCrypto: 0, toAddressMatched: false };
  }
}
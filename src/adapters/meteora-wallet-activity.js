import { METEORA_DLMM_PROGRAM_ID } from '../core/paper-engine.js';
import { enrichWalletEvent } from '../core/wallet-intelligence.js';

const EVENT_CPI_DISCRIMINATOR = Uint8Array.from([228, 69, 165, 46, 81, 203, 154, 29]);
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(value) {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Uint8Array.from(value);
  if (typeof value !== 'string' || !value.length) return new Uint8Array();
  let number = 0n;
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) throw new Error('Invalid base58 instruction data');
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) { bytes.push(Number(number & 255n)); number >>= 8n; }
  bytes.reverse();
  for (let i=0; i<value.length && value[i] === '1'; i++) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

const keyString = key => String(key?.pubkey ?? key?.toBase58?.() ?? key ?? '');
const rawNumber = value => {
  try { return BigInt(value?.toString?.() ?? value ?? 0); } catch { return 0n; }
};

/**
 * Decode Anchor CPI event payloads only when the calling program is the
 * canonical Meteora DLMM program. This is event decoding, not proof of a
 * quote-side LP addition; that requires the verified PositionV2 resolver below.
 */
export function decodeMeteoraLiquidityEvents(transaction, eventCoder, {
  programId = METEORA_DLMM_PROGRAM_ID
} = {}) {
  if (!transaction?.meta || transaction.meta.err || transaction.blockTime == null || !eventCoder?.decode) return [];
  const message = transaction.transaction?.message ?? transaction.message ?? {};
  const staticKeys = message.staticAccountKeys ?? message.accountKeys ?? [];
  const allKeys = [
    ...staticKeys.map(keyString),
    ...(transaction.meta.loadedAddresses?.writable ?? []).map(keyString),
    ...(transaction.meta.loadedAddresses?.readonly ?? []).map(keyString)
  ];
  const events = [];
  for (const group of transaction.meta.innerInstructions ?? []) {
    for (const [innerInstructionIndex, instruction] of (group.instructions ?? []).entries()) {
      if (allKeys[Number(instruction.programIdIndex)] !== programId || !instruction.data) continue;
      let bytes;
      try { bytes = decodeBase58(instruction.data); } catch { continue; }
      if (bytes.length < 16 || !EVENT_CPI_DISCRIMINATOR.every((v,i)=>bytes[i]===v)) continue;
      let decoded;
      try { decoded = eventCoder.decode(Buffer.from(bytes.slice(8)).toString('base64')); } catch { continue; }
      if (!decoded || !['addLiquidity','removeLiquidity','addLiquidityByStrategy','addLiquidityOneSide','removeLiquidityByRange'].includes(decoded.name)) continue;
      const data = decoded.data ?? {};
      events.push({
        eventType: /removeLiquidity/i.test(decoded.name) ? 'remove-liquidity' : 'add-liquidity',
        walletAddress: String(data.from?.toBase58?.() ?? data.from ?? ''),
        positionAddress: String(data.position?.toBase58?.() ?? data.position ?? ''),
        poolAddress: String(data.lbPair?.toBase58?.() ?? data.lbPair ?? ''),
        amountsRaw: Array.isArray(data.amounts) ? data.amounts.map(rawNumber).map(String) : [],
        instructionIndex: Number(group.index ?? -1),
        innerInstructionIndex,
        programId,
        blockTime: Number(transaction.blockTime) * 1000,
        slot: Number(transaction.slot ?? 0),
        success: true,
        decodedEventName: decoded.name
      });
    }
  }
  return events;
}

/**
 * Read-only Meteora wallet monitor. Inject resolvePosition() backed by a verified
 * PositionV2 account read and a trusted ranked-wallet feed. It deliberately
 * refuses to infer quote-side exposure from raw logs alone.
 */
export function createMeteoraWalletActivityAdapter({
  helius,
  eventCoder,
  resolvePosition = null,
  meteoraOnchain = null,
  rankedWallets = [],
  quoteMintPricesUsd = {},
  minQuoteDepositUsd = 25,
  programId = METEORA_DLMM_PROGRAM_ID,
  clock = Date.now
} = {}) {
  if (!helius?.readOnly || typeof helius.getTransaction !== 'function') throw new Error('A read-only Helius adapter is required');
  const positionResolver = typeof resolvePosition === 'function'
    ? resolvePosition
    : (meteoraOnchain?.readOnly === true && typeof meteoraOnchain.getPosition === 'function'
      ? async ({ positionAddress, poolAddress, walletAddress }) => {
          const positions = await meteoraOnchain.getPosition(poolAddress, walletAddress);
          const position = positions.find(item => item.publicKey === positionAddress);
          if (!position) return null;
          return {
            ...position,
            owner: position.ownerAddress,
            poolAddress: position.poolAddress,
            xMint: position.xMint,
            yMint: position.yMint,
            decimalsX: position.decimalsX,
            decimalsY: position.decimalsY
          };
        }
      : null);
  if (typeof positionResolver !== 'function') throw new Error('A read-only Meteora PositionV2 resolver is required');
  const ranked = rankedWallets;
  const decimalsFor = mint => mint === 'So11111111111111111111111111111111111111112' ? 9 : 6;

  async function getVerifiedEvents(signature, walletAddress) {
    const transaction = await helius.getTransaction(signature);
    const decoded = decodeMeteoraLiquidityEvents(transaction, eventCoder, { programId });
    const output = [];
    for (const event of decoded) {
      if (event.walletAddress !== walletAddress || !event.positionAddress || !event.poolAddress) continue;
      const position = await positionResolver({
        positionAddress: event.positionAddress,
        poolAddress: event.poolAddress,
        walletAddress,
        minContextSlot: event.slot
      });
      if (!position || position.owner !== walletAddress || position.poolAddress !== event.poolAddress) continue;
      const quoteSides = [
        { mint: position.xMint, index: 0 },
        { mint: position.yMint, index: 1 }
      ].filter(x => Object.hasOwn(quoteMintPricesUsd, x.mint));
      if (quoteSides.length !== 1) continue;
      const quote = quoteSides[0];
      const raw = rawNumber(event.amountsRaw[quote.index]);
      const decimals = Number(position[quote.index === 0 ? 'decimalsX' : 'decimalsY'] ?? decimalsFor(quote.mint));
      const amount = Number(raw) / 10 ** decimals;
      const quoteAmountUsd = amount * Number(quoteMintPricesUsd[quote.mint]);
      if (!(quoteAmountUsd >= minQuoteDepositUsd)) continue;
      const enriched = enrichWalletEvent({
        ...event,
        timestamp: event.blockTime,
        quoteSide: true,
        quoteMint: quote.mint,
        quoteAmountUsd,
        verified: true,
        success: true,
        walletGroup: position.walletGroup ?? walletAddress
      }, ranked);
      output.push(enriched);
    }
    return output;
  }

  async function backfillWallet(walletAddress, { limit = 50, before } = {}) {
    const signatures = await helius.getSignaturesForAddress(walletAddress, { limit, before, commitment: 'confirmed' });
    const results = [];
    for (const item of [...signatures].reverse()) {
      if (item.err || !item.signature) continue;
      try { results.push(...await getVerifiedEvents(item.signature, walletAddress)); } catch { /* retry on later backfill */ }
    }
    return results;
  }

  async function watchWallets(walletAddresses, { onEvent = () => {}, onError = () => {} } = {}) {
    const subscriptions = [];
    for (const walletAddress of [...new Set(walletAddresses)]) {
      const sub = await helius.subscribeLogs(walletAddress, {
        onNotification: async notification => {
          const signature = notification?.value?.signature;
          if (!signature || notification?.value?.err) return;
          try {
            const events = await getVerifiedEvents(signature, walletAddress);
            for (const event of events) onEvent(event);
          } catch (error) { onError(error, walletAddress, signature); }
        },
        onError: error => onError(error, walletAddress)
      });
      subscriptions.push(sub);
    }
    return {
      subscriptions,
      close: () => subscriptions.forEach(subscription => subscription.close())
    };
  }

  return {
    provider: 'meteora-dlmm-wallet-activity',
    readOnly: true,
    decodeMeteoraLiquidityEvents: transaction => decodeMeteoraLiquidityEvents(transaction, eventCoder, { programId }),
    getVerifiedEvents,
    backfillWallet,
    watchWallets,
    executionEnabled: false
  };
}

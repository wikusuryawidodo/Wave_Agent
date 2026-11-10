/**
 * Read-only Meteora DLMM adapter using the official SDK.
 * It intentionally exposes no transaction builder, signer, or send method.
 */
export function createMeteoraOnchainAdapter({ rpcUrl=process.env.SOLANA_RPC_URL,
  commitment='confirmed', fetchImpl=fetch } = {}) {
  let runtime;
  async function load() {
    if (!runtime) {
      const [{default:DLMM},{Connection,PublicKey}] = await Promise.all([
        import('@meteora-ag/dlmm'), import('@solana/web3.js')
      ]);
      runtime={DLMM,Connection,PublicKey,
        connection:new Connection(rpcUrl || 'https://api.mainnet-beta.solana.com', {commitment,fetch:fetchImpl})};
    }
    return runtime;
  }
  return {
    chain:'solana', protocol:'meteora-dlmm-onchain', readOnly:true,
    async discoverPools({ limit=100 }={}) {
      const {DLMM,connection}=await load();
      const pairs=await DLMM.getLbPairs(connection);
      return pairs.slice(0,limit).map(p=>({
        address:(p.publicKey ?? p.pubkey ?? p.lbPair ?? p).toBase58?.() ??
          String(p.publicKey ?? p.pubkey ?? p.lbPair ?? p),
        raw:p
      }));
    },
    async getPool(poolAddress,{binsEachSide=20}={}) {
      const {DLMM,Connection,PublicKey,connection}=await load();
      const pool=await DLMM.create(connection,new PublicKey(poolAddress),{cluster:'mainnet-beta'});
      const [active,feeInfo,dynamicFee,bins]=await Promise.all([
        pool.getActiveBin(),
        Promise.resolve(pool.getFeeInfo()),
        Promise.resolve(pool.getDynamicFee()),
        pool.getBinsAroundActiveBin(binsEachSide)
      ]);
      const activeBinId=Number(active.binId);
      const rawBins=Array.isArray(bins) ? bins : (bins.bins ?? []);
      const normalizedBins=rawBins.map(b=>normalizeSdkBin(b,activeBinId));
      const slot=await connection.getSlot(commitment);
      return { chain:'solana',protocol:'meteora-dlmm-onchain',poolAddress,
        activeBinId, activeBinPrice:Number(active.price), binStep:Number(pool.lbPair?.binStep ?? pool.lbPairAccount?.binStep),
        feeInfo:jsonSafe(feeInfo), dynamicFee:String(dynamicFee), slot,
        bins:normalizedBins, raw:{active,feeInfo,dynamicFee,bins} };
    },
    async getPosition(poolAddress,ownerAddress) {
      const {DLMM,PublicKey,connection}=await load();
      const pool=await DLMM.create(connection,new PublicKey(poolAddress),{cluster:'mainnet-beta'});
      const owner=new PublicKey(ownerAddress);
      const result=await pool.getPositionsByUserAndLbPair(owner);
      const xMint=pool.lbPair?.tokenXMint?.toBase58?.() ?? String(pool.lbPair?.tokenXMint ?? '');
      const yMint=pool.lbPair?.tokenYMint?.toBase58?.() ?? String(pool.lbPair?.tokenYMint ?? '');
      const readDecimals=async mint=>{
        if(!mint)return null;
        try {
          const parsed=await connection.getParsedAccountInfo(new PublicKey(mint),commitment);
          const decimals=parsed.value?.data?.parsed?.info?.decimals;
          return Number.isInteger(Number(decimals)) ? Number(decimals) : null;
        } catch { return null; }
      };
      const [decimalsX,decimalsY]=await Promise.all([readDecimals(xMint),readDecimals(yMint)]);
      return (result.userPositions ?? []).map(p=>({
        publicKey:p.publicKey?.toBase58?.() ?? String(p.publicKey),
        ownerAddress:ownerAddress,
        poolAddress,
        xMint,
        yMint,
        decimalsX,
        decimalsY,
        lowerBinId:Number(p.positionData?.lowerBinId),
        upperBinId:Number(p.positionData?.upperBinId),
        totalXAmount:String(p.positionData?.totalXAmount ?? ''),
        totalYAmount:String(p.positionData?.totalYAmount ?? ''),
        feeX:jsonSafe(p.positionData?.feeX ?? p.positionData?.feeInfo),
        feeY:jsonSafe(p.positionData?.feeY),
        raw:jsonSafe(p)
      }));
    }
  };
}
function normalizeSdkBin(b,activeBinId) {
  const d=b.bin ?? b;
  const val=(...keys)=>{for(const k of keys) if(d[k] != null) return String(d[k]); return null;};
  return { binId:Number(d.binId ?? d.bin_id ?? b.binId),
    price:Number(d.price ?? b.price ?? 0),
    amountX:val('amountX','amount_x'), amountY:val('amountY','amount_y'),
    liquiditySupply:val('liquiditySupply','liquidity_supply'),
    feeXPerTokenStored:val('feeAmountXPerTokenStored','fee_amount_x_per_token_stored'),
    feeYPerTokenStored:val('feeAmountYPerTokenStored','fee_amount_y_per_token_stored'),
    distanceFromActive:Number(d.binId ?? d.bin_id ?? b.binId)-activeBinId,
    raw:jsonSafe(b) };
}
function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value,(_,v)=>{
    if(typeof v==='bigint') return v.toString();
    if(v && typeof v.toString==='function' && v.constructor?.name==='BN') return v.toString();
    return v;
  }));
}

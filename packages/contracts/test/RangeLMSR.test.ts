import { ethers } from "hardhat";
import { expect } from "chai";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

const PRECISION = 10n ** 18n;
const USDC_DECIMALS = 6n;
const USDC_UNIT = 10n ** USDC_DECIMALS;

// ABI snippets reused in multiple tests
const ERC20_MINI_ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

const OUTCOME_TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
];

async function deployMockUSDC(deployer: SignerWithAddress) {
  const Token = await ethers.getContractFactory(
    "contracts/mocks/MockUSDC.sol:MockUSDC",
    deployer
  );
  const contract = await Token.deploy();
  await contract.waitForDeployment();
  return contract;
}

/**
 * Returns a fresh endTime far enough ahead to survive cumulative evm_increaseTime
 * calls without needing to snapshot/restore.
 */
function futureEndTime(offsetSeconds = 86400 * 365): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}

function encodeRangeTrade(isBuy: boolean, rangeIndex: bigint, amount: bigint, minOutput = 0n) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bool isBuy,uint256 rangeIndex,uint256 amount,uint256 minOutput)"],
    [[isBuy, rangeIndex, amount, minOutput]]
  );
}

async function deployRangeStack(
  deployer: SignerWithAddress,
  usdcAddr: string,
  numRanges = 4,
  seedLiquidityUsdc = 100n * USDC_UNIT,
  feeBps = 0n,
  protocolFeeBps = 0n
) {
  const RangeOutcomeTokenFactory = await ethers.getContractFactory("RangeOutcomeToken");
  const rangeTokenImpl = await RangeOutcomeTokenFactory.deploy();
  await rangeTokenImpl.waitForDeployment();

  const RangeLMSRFactory = await ethers.getContractFactory("RangeLMSR");
  const rangeLmsrImpl = await RangeLMSRFactory.deploy();
  await rangeLmsrImpl.waitForDeployment();

  const FactoryFactory = await ethers.getContractFactory("RangeMarketFactory");
  const factory = await FactoryFactory.deploy(
    await rangeTokenImpl.getAddress(),
    await rangeLmsrImpl.getAddress(),
    usdcAddr,
    deployer.address,   // feeWallet
    protocolFeeBps,
    100n,               // claimsBufferBps
    deployer.address    // treasury
  );
  await factory.waitForDeployment();

  // Mint & approve seed liquidity
  const usdcContract = await ethers.getContractAt(ERC20_MINI_ABI, usdcAddr, deployer);
  await (usdcContract as any).mint(deployer.address, seedLiquidityUsdc * 20n);
  await (usdcContract as any).approve(await factory.getAddress(), seedLiquidityUsdc);

  const labels = Array.from({ length: numRanges }, (_, i) => `Range-${i}`);
  const endTime = futureEndTime();

  const tx = await (factory as any).createRangeMarket(
    "Test Range Market",
    endTime,
    seedLiquidityUsdc,
    feeBps,
    labels
  );
  const receipt = await tx.wait();

  // Parse event
  let poolAddress = "";
  let rangeTokenAddresses: string[] = [];
  for (const log of receipt!.logs) {
    try {
      const parsed = (factory as any).interface.parseLog(log as any);
      if (parsed?.name === "RangeMarketCreated") {
        poolAddress = parsed.args.cpmmPool;
        rangeTokenAddresses = [...parsed.args.rangeTokens];
        break;
      }
    } catch { /* ignore non-matching logs */ }
  }
  if (!poolAddress) throw new Error("RangeMarketCreated event not found");

  const pool = await ethers.getContractAt("RangeLMSR", poolAddress);
  const tokens = await Promise.all(
    rangeTokenAddresses.map((addr) => ethers.getContractAt(OUTCOME_TOKEN_ABI, addr))
  );

  // marketId is 0-indexed; rangeMarketCount was incremented during createRangeMarket
  const marketId = (await (factory as any).rangeMarketCount()) - 1n;

  return { factory, pool, tokens, poolAddress, rangeTokenAddresses, usdcContract, marketId };
}

async function deployVault(
  deployer: SignerWithAddress,
  usdcAddr: string,
  rangeFactoryAddress: string
) {
  const PoolRegistryFactory = await ethers.getContractFactory("PoolRegistry", deployer);
  const poolRegistry = await PoolRegistryFactory.deploy();
  await poolRegistry.waitForDeployment();
  await (poolRegistry as any).setFactory(rangeFactoryAddress, true);

  const RangeAdapterFactory = await ethers.getContractFactory("RangeLMSRAdapter", deployer);
  const rangeAdapter = await RangeAdapterFactory.deploy();
  await rangeAdapter.waitForDeployment();

  const UserEscrowFactory = await ethers.getContractFactory("UserEscrow", deployer);
  const escrowImpl = await UserEscrowFactory.deploy();
  await escrowImpl.waitForDeployment();

  const VaultFactory = await ethers.getContractFactory("Vault", deployer);
  const vault = await VaultFactory.deploy(
    usdcAddr,
    deployer.address,
    await escrowImpl.getAddress(),
    await poolRegistry.getAddress()
  );
  await vault.waitForDeployment();

  await (vault as any).setAdapter(await rangeAdapter.getAddress(), true);

  return { vault, escrowImpl, poolRegistry, rangeAdapter };
}

async function executeRangeTrade(
  vault: any,
  rangeAdapter: any,
  poolAddress: string,
  user: string,
  isBuy: boolean,
  rangeIndex: bigint,
  amount: bigint,
  minOutput = 0n
) {
  return (vault as any).executeTrade(
    await rangeAdapter.getAddress(),
    poolAddress,
    user,
    encodeRangeTrade(isBuy, rangeIndex, amount, minOutput)
  );
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("RangeLMSR — full LMSR range market stack", function () {
  this.timeout(120_000);

  let deployer: SignerWithAddress;
  let trader: SignerWithAddress;
  let usdcAddr: string;
  let usdcContract: Awaited<ReturnType<typeof ethers.getContractAt>>;

  before(async () => {
    [deployer, trader] = await ethers.getSigners();
    const usdc = await deployMockUSDC(deployer);
    usdcAddr = await usdc.getAddress();
    usdcContract = await ethers.getContractAt(ERC20_MINI_ABI, usdcAddr, deployer);
    // Seed both signers with plenty of USDC
    await (usdcContract as any).mint(deployer.address, 1_000_000n * USDC_UNIT);
    await (usdcContract as any).mint(trader.address, 1_000_000n * USDC_UNIT);
  });

  // ─── 1. Deployment ───────────────────────────────────────────────────────

  it("deploys RangeMarketFactory with correct config", async function () {
    const { factory } = await deployRangeStack(deployer, usdcAddr);
    expect(await (factory as any).admin()).to.equal(deployer.address);
    expect(await (factory as any).collateral()).to.equal(usdcAddr);
  });

  // ─── 2. Initial equal probabilities ──────────────────────────────────────

  it("creates market with equal initial prices", async function () {
    const numRanges = 4;
    const { pool } = await deployRangeStack(deployer, usdcAddr, numRanges);
    const prices: bigint[] = await (pool as any).getPrices();
    expect(prices.length).to.equal(numRanges);
    const expected = PRECISION / BigInt(numRanges);
    for (const p of prices) {
      // Allow 1 % relative tolerance
      const delta = expected / 100n;
      expect(p).to.be.closeTo(expected, delta);
    }
  });

  // ─── 3. Buy raises selected range probability ─────────────────────────────

  it("buy raises selected range probability", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr);
    const pricesBefore: bigint[] = await (pool as any).getPrices();

    await (usdcContract as any).approve(await (pool as any).getAddress(), 10n * USDC_UNIT);
    await (pool as any).buy(0n, 10n * USDC_UNIT);

    const pricesAfter: bigint[] = await (pool as any).getPrices();
    expect(pricesAfter[0]).to.be.gt(pricesBefore[0]);
  });

  // ─── 4. Probabilities sum to 1 after trades ───────────────────────────────

  it("probabilities always sum to ~1e18 after trades", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr);

    await (usdcContract as any).approve(await (pool as any).getAddress(), 50n * USDC_UNIT);
    await (pool as any).buy(1n, 20n * USDC_UNIT);
    await (pool as any).buy(2n, 15n * USDC_UNIT);
    await (pool as any).buy(3n, 10n * USDC_UNIT);

    const prices: bigint[] = await (pool as any).getPrices();
    const total = prices.reduce((a, b) => a + b, 0n);
    expect(total).to.be.closeTo(PRECISION, PRECISION / 1000n);
  });

  // ─── 5. Sell lowers range probability ────────────────────────────────────

  it("sell lowers range probability", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();

    const buyAmount = 20n * USDC_UNIT;
    await (usdcContract as any).approve(poolAddr, buyAmount);
    await (pool as any).buy(0n, buyAmount);

    const pricesMid: bigint[] = await (pool as any).getPrices();

    // Get the outcome token for range 0 via rangeTokens(0)
    const tokenAddr: string = await (pool as any).rangeTokens(0n);
    const token = await ethers.getContractAt(OUTCOME_TOKEN_ABI, tokenAddr, deployer);
    const bal: bigint = await (token as any).balanceOf(deployer.address);
    expect(bal).to.be.gt(0n);

    await (token as any).approve(poolAddr, bal / 2n);
    await (pool as any).sell(0n, bal / 2n);

    const pricesAfter: bigint[] = await (pool as any).getPrices();
    expect(pricesAfter[0]).to.be.lt(pricesMid[0]);
  });

  // ─── 6. quoteBuy ─────────────────────────────────────────────────────────

  it("quoteBuy returns correct shares estimate for USDC input", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr);
    const usdcIn = USDC_UNIT / 100n; // $0.01 at the initial 25c price ~= 0.04 tokens
    const sharesOut: bigint = await (pool as any).quoteBuy(0n, usdcIn);
    const expectedShares = (usdcIn * PRECISION) / (USDC_UNIT / 4n);
    expect(sharesOut).to.be.closeTo(expectedShares, expectedShares / 100n);
  });

  it("buy spends the budget at the probability price instead of refunding most of it", async function () {
    const { pool, usdcContract } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();
    const usdcIn = USDC_UNIT / 100n; // $0.01
    const quotedShares: bigint = await (pool as any).quoteBuy(0n, usdcIn);
    const expectedShares = (usdcIn * PRECISION) / (USDC_UNIT / 4n);

    await (usdcContract as any).approve(poolAddr, usdcIn);
    const poolBalanceBefore: bigint = await (usdcContract as any).balanceOf(poolAddr);
    await (pool as any).buy(0n, usdcIn);
    const poolBalanceAfter: bigint = await (usdcContract as any).balanceOf(poolAddr);

    const tokenAddr: string = await (pool as any).rangeTokens(0n);
    const token = await ethers.getContractAt(OUTCOME_TOKEN_ABI, tokenAddr, deployer);
    const bal: bigint = await (token as any).balanceOf(deployer.address);

    expect(bal).to.equal(quotedShares);
    expect(bal).to.be.closeTo(expectedShares, expectedShares / 100n);
    expect(poolBalanceAfter - poolBalanceBefore).to.be.closeTo(usdcIn, 1n);
  });

  // ─── 7. buyFor – recipient receives tokens ────────────────────────────────

  it("buyFor routes purchase to recipient and returns shares", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();

    const usdcIn = USDC_UNIT / 100n;
    const quotedShares: bigint = await (pool as any).quoteBuy(0n, usdcIn);
    await (usdcContract as any).approve(poolAddr, usdcIn);
    await (pool as any).buyFor(0n, usdcIn, trader.address);

    const tokenAddr: string = await (pool as any).rangeTokens(0n);
    const token = await ethers.getContractAt(OUTCOME_TOKEN_ABI, tokenAddr);
    const bal: bigint = await (token as any).balanceOf(trader.address);
    expect(bal).to.equal(quotedShares);
  });

  it("buyFor reverts when minSharesOut is above the LMSR quote", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();
    const usdcIn = USDC_UNIT / 100n;
    const quotedShares: bigint = await (pool as any).quoteBuy(0n, usdcIn);

    await (usdcContract as any).approve(poolAddr, usdcIn);
    await expect(
      (pool as any)["buyFor(uint256,uint256,address,uint256)"](
        0n,
        usdcIn,
        trader.address,
        quotedShares + 1n
      )
    ).to.be.revertedWith("Slippage: insufficient shares");
  });

  it("quoteSell returns the net USDC available for a range sell", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();

    await (usdcContract as any).approve(poolAddr, 10n * USDC_UNIT);
    await (pool as any).buy(0n, 10n * USDC_UNIT);

    const tokenAddr: string = await (pool as any).rangeTokens(0n);
    const token = await ethers.getContractAt(OUTCOME_TOKEN_ABI, tokenAddr, deployer);
    const balance: bigint = await (token as any).balanceOf(deployer.address);
    const sharesToSell = balance / 2n;

    const quote: bigint = await (pool as any).quoteSell(0n, sharesToSell);
    const usdcBefore: bigint = await (usdcContract as any).balanceOf(deployer.address);
    await (pool as any)["sell(uint256,uint256,uint256)"](0n, sharesToSell, quote);
    const usdcAfter: bigint = await (usdcContract as any).balanceOf(deployer.address);

    expect(usdcAfter - usdcBefore).to.equal(quote);
  });

  it("quoteSell works for tiny positions in a low-liquidity market", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr, 4, 1n * USDC_UNIT);
    const poolAddr = await (pool as any).getAddress();
    const buyAmount = USDC_UNIT / 100n; // $0.01

    await (usdcContract as any).approve(poolAddr, buyAmount);
    await (pool as any).buy(1n, buyAmount);

    const tokenAddr: string = await (pool as any).rangeTokens(1n);
    const token = await ethers.getContractAt(OUTCOME_TOKEN_ABI, tokenAddr, deployer);
    const balance: bigint = await (token as any).balanceOf(deployer.address);

    const quote: bigint = await (pool as any).quoteSell(1n, balance);
    expect(quote).to.be.gt(0n);
  });

  it("sellFor reverts when minUsdcOut is above the LMSR quote", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();

    await (usdcContract as any).approve(poolAddr, 10n * USDC_UNIT);
    await (pool as any).buyFor(0n, 10n * USDC_UNIT, trader.address);

    const tokenAddr: string = await (pool as any).rangeTokens(0n);
    const token = await ethers.getContractAt(OUTCOME_TOKEN_ABI, tokenAddr, trader);
    const balance: bigint = await (token as any).balanceOf(trader.address);
    const sharesToSell = balance / 2n;
    const quote: bigint = await (pool as any).quoteSell(0n, sharesToSell);

    await expect(
      (pool as any)["sellFor(uint256,uint256,address,uint256)"](
        0n,
        sharesToSell,
        trader.address,
        quote + 1n
      )
    ).to.be.revertedWith("Slippage: insufficient output");
  });

  it("routes a range sell through Vault using the range adapter", async function () {
    const { pool, factory, tokens } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();
    const { vault, rangeAdapter } = await deployVault(deployer, usdcAddr, await (factory as any).getAddress());
    const vaultAddr = await (vault as any).getAddress();

    const depositAmount = 100n * USDC_UNIT;
    const buyAmount = 10n * USDC_UNIT;
    await (usdcContract as any).connect(trader).approve(vaultAddr, depositAmount);
    await (vault as any).connect(trader).deposit(depositAmount);

    await executeRangeTrade(vault, rangeAdapter, poolAddr, trader.address, true, 2n, buyAmount);

    const token = tokens[2] as any;
    const tokenBalanceBefore: bigint = await token.balanceOf(trader.address);
    const sharesToSell = tokenBalanceBefore / 2n;
    const quote: bigint = await (pool as any).quoteSell(2n, sharesToSell);
    const escrowBalanceBefore: bigint = await (vault as any).balanceOf(trader.address);

    await executeRangeTrade(vault, rangeAdapter, poolAddr, trader.address, false, 2n, sharesToSell, quote);

    expect(await token.balanceOf(trader.address)).to.equal(tokenBalanceBefore - sharesToSell);
    expect(await (vault as any).balanceOf(trader.address)).to.equal(escrowBalanceBefore + quote);
  });

  it("routes range sell slippage reverts through Vault with the pool revert reason", async function () {
    const { pool, factory, tokens } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();
    const { vault, rangeAdapter } = await deployVault(deployer, usdcAddr, await (factory as any).getAddress());
    const vaultAddr = await (vault as any).getAddress();

    const depositAmount = 100n * USDC_UNIT;
    const buyAmount = 10n * USDC_UNIT;
    await (usdcContract as any).connect(trader).approve(vaultAddr, depositAmount);
    await (vault as any).connect(trader).deposit(depositAmount);

    await executeRangeTrade(vault, rangeAdapter, poolAddr, trader.address, true, 1n, buyAmount);

    const token = tokens[1] as any;
    const sharesToSell: bigint = (await token.balanceOf(trader.address)) / 2n;
    const quote: bigint = await (pool as any).quoteSell(1n, sharesToSell);

    await expect(
      executeRangeTrade(vault, rangeAdapter, poolAddr, trader.address, false, 1n, sharesToSell, quote + 1n)
    ).to.be.revertedWith("Slippage: insufficient output");
  });

  // ─── 8. Resolution blocks further trading ────────────────────────────────

  it("resolution sets winning range and blocks further trading", async function () {
    const { pool, factory, marketId } = await deployRangeStack(deployer, usdcAddr);

    // Advance time past market end (market endTime is ~1 year from now but
    // we simply call resolve directly from admin — factory checks resolved state)
    await (factory as any).resolveRangeMarket(marketId, 1n);

    // Further buys should revert (market is resolved)
    await (usdcContract as any).approve(await (pool as any).getAddress(), 10n * USDC_UNIT);
    await expect((pool as any).buy(0n, 10n * USDC_UNIT)).to.be.reverted;
  });

  // ─── 9. Redemption – winning tokens pay USDC ─────────────────────────────

  it("redeemRange pays out USDC for winning tokens", async function () {
    const { pool, factory, marketId } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();

    // Buy winning range (2)
    const buyAmount = 20n * USDC_UNIT;
    await (usdcContract as any).approve(poolAddr, buyAmount);
    await (pool as any).buy(2n, buyAmount);

    await (factory as any).resolveRangeMarket(marketId, 2n);

    const balBefore: bigint = await (usdcContract as any).balanceOf(deployer.address);
    await (factory as any).redeemRange(marketId, 2n);
    const balAfter: bigint = await (usdcContract as any).balanceOf(deployer.address);
    expect(balAfter).to.be.gt(balBefore);
  });

  // ─── 10. Redemption – losing tokens revert ───────────────────────────────

  it("redeemRange reverts for losing range tokens", async function () {
    const { pool, factory, marketId } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();

    // Buy losing range (0)
    const buyAmount = 20n * USDC_UNIT;
    await (usdcContract as any).approve(poolAddr, buyAmount);
    await (pool as any).buy(0n, buyAmount);

    await (factory as any).resolveRangeMarket(marketId, 2n); // 2 wins

    await expect((factory as any).redeemRange(marketId, 0n)).to.be.reverted;
  });

  // ─── 11. Low-liquidity: prices still move ────────────────────────────────

  it("low-liquidity scenario: prices still move with small b", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr, 4, 10n * USDC_UNIT);
    const pricesBefore: bigint[] = await (pool as any).getPrices();
    const poolAddr = await (pool as any).getAddress();

    await (usdcContract as any).approve(poolAddr, 5n * USDC_UNIT);
    await (pool as any).buy(0n, 5n * USDC_UNIT);

    const pricesAfter: bigint[] = await (pool as any).getPrices();
    expect(pricesAfter[0]).to.be.gt(pricesBefore[0]);
  });

  // ─── 12. Invalid range index reverts ─────────────────────────────────────

  it("invalid range index reverts on buy", async function () {
    const { pool } = await deployRangeStack(deployer, usdcAddr);
    const poolAddr = await (pool as any).getAddress();
    await (usdcContract as any).approve(poolAddr, 10n * USDC_UNIT);
    await expect((pool as any).buy(99n, 10n * USDC_UNIT)).to.be.reverted;
  });

  // ─── 13. Factory isPool ───────────────────────────────────────────────────

  it("factory.isPool registers the deployed pool", async function () {
    const { factory, poolAddress } = await deployRangeStack(deployer, usdcAddr);
    expect(await (factory as any).isPool(poolAddress)).to.equal(true);
  });
});

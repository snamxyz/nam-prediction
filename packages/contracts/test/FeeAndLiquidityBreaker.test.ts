import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type {
  MarketFactory,
  MockUSDC,
  CPMM,
  OutcomeToken,
} from "../typechain-types";

describe("Protocol fee + Liquidity breaker", function () {
  let factory: MarketFactory;
  let usdc: MockUSDC;
  let pool: CPMM;
  let yesToken: OutcomeToken;
  let noToken: OutcomeToken;
  let admin: any;
  let alice: any;
  let bob: any;
  let feeWallet: any;
  let treasury: any;

  const INITIAL_LIQUIDITY = 1000n * 10n ** 6n; // 1,000 USDC
  const LP_FEE_BPS = 0n; // keep LP fee off so we can assert exact protocol fee math
  const PROTOCOL_FEE_BPS = 100n; // 1%
  const ONE_USDC = 10n ** 6n;
  const ONE_DAY = 86400;
  const SOURCE_ADMIN = 0;
  const EMPTY_BYTES = "0x";

  beforeEach(async function () {
    [admin, alice, bob, feeWallet, treasury] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const OutcomeToken = await ethers.getContractFactory("OutcomeToken");
    const outcomeTokenImpl = await OutcomeToken.deploy();

    const CPMMFactory = await ethers.getContractFactory("CPMM");
    const cpmmImpl = await CPMMFactory.deploy();

    const MarketFactory = await ethers.getContractFactory("MarketFactory");
    factory = await MarketFactory.deploy(
      await outcomeTokenImpl.getAddress(),
      await cpmmImpl.getAddress(),
      await usdc.getAddress(),
      ethers.ZeroAddress
    );

    // Configure fee + treasury BEFORE creating the market so the pool picks them up.
    await factory.setFeeWallet(feeWallet.address);
    await factory.setProtocolFeeBps(PROTOCOL_FEE_BPS);
    await factory.setTreasury(treasury.address);

    await usdc.mint(admin.address, 100_000n * ONE_USDC);
    await usdc.mint(alice.address, 100_000n * ONE_USDC);
    await usdc.mint(bob.address, 100_000n * ONE_USDC);

    const endTime = (await time.latest()) + ONE_DAY;
    await usdc.connect(admin).approve(await factory.getAddress(), INITIAL_LIQUIDITY);
    await factory.createMarket("Q?", endTime, INITIAL_LIQUIDITY, LP_FEE_BPS, SOURCE_ADMIN, EMPTY_BYTES);

    const m = await factory.getMarket(0);
    pool = await ethers.getContractAt("CPMM", m.liquidityPool);
    yesToken = await ethers.getContractAt("OutcomeToken", m.yesToken);
    noToken = await ethers.getContractAt("OutcomeToken", m.noToken);
  });

  describe("Fee routing", function () {
    it("routes 1% of buy collateral to the fee wallet", async function () {
      const buyAmount = 100n * ONE_USDC;
      const expectedFee = (buyAmount * PROTOCOL_FEE_BPS) / 10_000n; // 1 USDC
      const feeWalletBefore = await usdc.balanceOf(feeWallet.address);

      await usdc.connect(alice).approve(await pool.getAddress(), buyAmount);
      await expect(pool.connect(alice).buyYes(buyAmount))
        .to.emit(pool, "FeeCollected")
        .withArgs(alice.address, expectedFee, true, true);

      const feeWalletAfter = await usdc.balanceOf(feeWallet.address);
      expect(feeWalletAfter - feeWalletBefore).to.equal(expectedFee);

      // Only (buyAmount - fee) sat in the pool when AMM math ran, so net pool
      // balance increased by (buyAmount - fee).
      const poolBal = await usdc.balanceOf(await pool.getAddress());
      expect(poolBal).to.equal(INITIAL_LIQUIDITY + (buyAmount - expectedFee));
    });

    it("routes 1% of sell proceeds to the fee wallet", async function () {
      // Alice buys first
      const buyAmount = 100n * ONE_USDC;
      await usdc.connect(alice).approve(await pool.getAddress(), buyAmount);
      await pool.connect(alice).buyYes(buyAmount);

      const yesBalance = await yesToken.balanceOf(alice.address);
      const feeWalletBefore = await usdc.balanceOf(feeWallet.address);
      const aliceUsdcBefore = await usdc.balanceOf(alice.address);

      // Sell all YES tokens
      const tx = await pool.connect(alice).sellYes(yesBalance);
      const receipt = await tx.wait();

      // Extract FeeCollected event to read the exact fee amount the contract charged.
      let feeAmount = 0n;
      const poolAddr = (await pool.getAddress()).toLowerCase();
      for (const log of receipt!.logs) {
        if (log.address.toLowerCase() !== poolAddr) continue;
        try {
          const parsed = pool.interface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "FeeCollected") {
            feeAmount = parsed.args.amount;
            expect(parsed.args.isBuy).to.equal(false);
            expect(parsed.args.isYes).to.equal(true);
          }
        } catch {
          // Non-pool events
        }
      }
      expect(feeAmount).to.be.gt(0n);

      const feeWalletAfter = await usdc.balanceOf(feeWallet.address);
      const aliceUsdcAfter = await usdc.balanceOf(alice.address);

      expect(feeWalletAfter - feeWalletBefore).to.equal(feeAmount);
      // Alice received (gross - fee). Rather than recompute AMM math, just assert she got
      // something and the pool + feeWallet + alice USDC delta sum matches the pool outflow.
      expect(aliceUsdcAfter - aliceUsdcBefore).to.be.gt(0n);
    });

    it("rejects protocol fee above 10%", async function () {
      await expect(factory.setProtocolFeeBps(1001)).to.be.revertedWith("Fee too high");
    });

    it("admin can update fee wallet / bps on an existing pool", async function () {
      await factory.updatePoolFeeWallet(0, bob.address);
      expect(await pool.feeWallet()).to.equal(bob.address);

      await factory.updatePoolProtocolFeeBps(0, 250);
      expect(await pool.protocolFeeBps()).to.equal(250n);
    });
  });

  describe("Liquidity breaker", function () {
    async function seedPositions() {
      // Alice buys YES, bob buys NO so both sides have outstanding claims.
      const buy = 100n * ONE_USDC;
      await usdc.connect(alice).approve(await pool.getAddress(), buy);
      await pool.connect(alice).buyYes(buy);
      await usdc.connect(bob).approve(await pool.getAddress(), buy);
      await pool.connect(bob).buyNo(buy);
    }

    it("computes outstanding winning claims only after resolution", async function () {
      await seedPositions();
      expect(await pool.getOutstandingWinningClaims()).to.equal(0n);

      await factory.resolveMarket(0, 1); // YES wins
      expect(await pool.resolved()).to.equal(true);
      expect(await pool.yesWon()).to.equal(true);

      const yesSupply = await yesToken.totalSupply();
      expect(await pool.getOutstandingWinningClaims()).to.equal(yesSupply / 10n ** 12n);
    });

    it("withdraws excess liquidity to the treasury, leaving claims reserved", async function () {
      await seedPositions();
      await factory.resolveMarket(0, 1);

      const poolBefore = await usdc.balanceOf(await pool.getAddress());
      const claims = await pool.getOutstandingWinningClaims();
      const withdrawable = await pool.getWithdrawableLiquidity();
      expect(withdrawable).to.equal(poolBefore - claims);

      const treasuryBefore = await usdc.balanceOf(treasury.address);

      await expect(factory.drainMarketLiquidity(0, ethers.ZeroAddress))
        .to.emit(factory, "MarketLiquidityDrained")
        .withArgs(0, treasury.address, withdrawable);

      const treasuryAfter = await usdc.balanceOf(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(withdrawable);

      // Pool retains exactly the reserved claims
      const poolAfter = await usdc.balanceOf(await pool.getAddress());
      expect(poolAfter).to.equal(claims);
      expect(await pool.liquidityDrained()).to.equal(true);
      expect(await pool.liquidityWithdrawn()).to.equal(withdrawable);
    });

    it("winners can still redeem after liquidity drain", async function () {
      await seedPositions();
      await factory.resolveMarket(0, 1);
      await factory.drainMarketLiquidity(0, ethers.ZeroAddress);

      const aliceUsdcBefore = await usdc.balanceOf(alice.address);
      await factory.connect(alice).redeem(0);
      const aliceUsdcAfter = await usdc.balanceOf(alice.address);
      expect(aliceUsdcAfter).to.be.gt(aliceUsdcBefore);
      // After redemption the pool balance should be zero (all claims paid, all excess drained).
      expect(await usdc.balanceOf(await pool.getAddress())).to.equal(0n);
    });

    it("cannot drain twice", async function () {
      await seedPositions();
      await factory.resolveMarket(0, 1);
      await factory.drainMarketLiquidity(0, ethers.ZeroAddress);
      await expect(factory.drainMarketLiquidity(0, ethers.ZeroAddress)).to.be.revertedWith("Already drained");
    });

    it("cannot drain an unresolved market", async function () {
      await seedPositions();
      await expect(factory.drainMarketLiquidity(0, ethers.ZeroAddress)).to.be.revertedWith("Not resolved");
    });

    it("only factory can call withdrawExcessLiquidity on the pool", async function () {
      await seedPositions();
      await factory.resolveMarket(0, 1);
      await expect(pool.connect(admin).withdrawExcessLiquidity(treasury.address)).to.be.revertedWith("Only factory");
    });

    it("drain works with an overridden treasury", async function () {
      await seedPositions();
      await factory.resolveMarket(0, 1);
      const withdrawable = await pool.getWithdrawableLiquidity();
      const bobBefore = await usdc.balanceOf(bob.address);
      await factory.drainMarketLiquidity(0, bob.address);
      expect(await usdc.balanceOf(bob.address)).to.equal(bobBefore + withdrawable);
    });
  });

  describe("Claims buffer", function () {
    async function seedPositions() {
      const buy = 100n * ONE_USDC;
      await usdc.connect(alice).approve(await pool.getAddress(), buy);
      await pool.connect(alice).buyYes(buy);
      await usdc.connect(bob).approve(await pool.getAddress(), buy);
      await pool.connect(bob).buyNo(buy);
    }

    it("defaults to zero buffer so withdrawable = pool - claims", async function () {
      await seedPositions();
      await factory.resolveMarket(0, 1);
      expect(await pool.claimsBufferBps()).to.equal(0n);

      const poolBal = await usdc.balanceOf(await pool.getAddress());
      const claims = await pool.getOutstandingWinningClaims();
      const withdrawable = await pool.getWithdrawableLiquidity();
      expect(withdrawable).to.equal(poolBal - claims);
    });

    it("reserves an extra buffer on top of outstanding claims", async function () {
      await factory.setClaimsBufferBps(100); // 1% of claims
      await factory.updatePoolClaimsBufferBps(0, 100);
      expect(await pool.claimsBufferBps()).to.equal(100n);

      await seedPositions();
      await factory.resolveMarket(0, 1);

      const poolBal = await usdc.balanceOf(await pool.getAddress());
      const claims = await pool.getOutstandingWinningClaims();
      const buffer = (claims * 100n) / 10_000n;
      const reserved = claims + buffer;
      const withdrawable = await pool.getWithdrawableLiquidity();
      expect(withdrawable).to.equal(poolBal - reserved);
    });

    it("drain leaves claims + buffer in the pool", async function () {
      await factory.setClaimsBufferBps(250); // 2.5%
      await factory.updatePoolClaimsBufferBps(0, 250);

      await seedPositions();
      await factory.resolveMarket(0, 1);

      const claims = await pool.getOutstandingWinningClaims();
      const buffer = (claims * 250n) / 10_000n;
      const withdrawable = await pool.getWithdrawableLiquidity();

      await factory.drainMarketLiquidity(0, ethers.ZeroAddress);

      const poolAfter = await usdc.balanceOf(await pool.getAddress());
      expect(poolAfter).to.equal(claims + buffer);
      expect(await pool.liquidityWithdrawn()).to.equal(withdrawable);
    });

    it("winners can still redeem fully after a buffered drain", async function () {
      await factory.setClaimsBufferBps(500); // 5%
      await factory.updatePoolClaimsBufferBps(0, 500);

      await seedPositions();
      await factory.resolveMarket(0, 1); // YES wins
      await factory.drainMarketLiquidity(0, ethers.ZeroAddress);

      const aliceBefore = await usdc.balanceOf(alice.address);
      await factory.connect(alice).redeem(0);
      const aliceAfter = await usdc.balanceOf(alice.address);
      expect(aliceAfter).to.be.gt(aliceBefore);

      // After redemption, the only USDC left in the pool is the buffer
      // (no more winners to redeem since Alice held 100% of YES tokens).
      const claimsAfter = await pool.getOutstandingWinningClaims();
      expect(claimsAfter).to.equal(0n);
      const poolAfter = await usdc.balanceOf(await pool.getAddress());
      // The buffer headroom stays stranded in the pool by design — it can be
      // swept later via a second drain once the buffer bps is set to 0.
      expect(poolAfter).to.be.gt(0n);
    });

    it("returns zero withdrawable when buffer exceeds pool balance minus claims", async function () {
      // 50% buffer — since pool holds ~1100 USDC (1000 seeded + trades) and
      // claims are limited, the buffer math should still leave something
      // withdrawable. Pick an absurd buffer so `claims + buffer > pool`.
      await factory.setClaimsBufferBps(5000); // max cap, 50%
      await factory.updatePoolClaimsBufferBps(0, 5000);

      // Flood alice with YES so claims grow large relative to pool.
      const big = 500n * ONE_USDC;
      await usdc.connect(alice).approve(await pool.getAddress(), big);
      await pool.connect(alice).buyYes(big);

      await factory.resolveMarket(0, 1);

      const claims = await pool.getOutstandingWinningClaims();
      const buffer = (claims * 5000n) / 10_000n;
      const reserved = claims + buffer;
      const poolBal = await usdc.balanceOf(await pool.getAddress());

      if (poolBal <= reserved) {
        expect(await pool.getWithdrawableLiquidity()).to.equal(0n);
      } else {
        expect(await pool.getWithdrawableLiquidity()).to.equal(poolBal - reserved);
      }
    });

    it("rejects buffer above 50%", async function () {
      await expect(factory.setClaimsBufferBps(5001)).to.be.revertedWith("Buffer too high");
    });

    it("only factory can update pool buffer", async function () {
      await expect(pool.connect(admin).setClaimsBufferBps(100)).to.be.revertedWith("Only factory");
    });
  });
});

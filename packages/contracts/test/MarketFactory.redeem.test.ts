import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type {
  MarketFactory,
  MockUSDC,
  CPMM,
  OutcomeToken,
  Vault,
  UserEscrow,
} from "../typechain-types";

describe("MarketFactory.redeem — delegated payout via CPMM", function () {
  let factory: MarketFactory;
  let usdc: MockUSDC;
  let vault: Vault;
  let pool: CPMM;
  let yesToken: OutcomeToken;
  let noToken: OutcomeToken;

  let admin: any;
  let alice: any;
  let bob: any;
  let carol: any;

  const INITIAL_LIQUIDITY = 1000n * 10n ** 6n; // 1,000 USDC
  const FEE_BPS = 200n; // 2%
  const ONE_USDC = 10n ** 6n;
  const ONE_DAY = 86400;
  const SOURCE_ADMIN = 0;
  const EMPTY_BYTES = "0x";

  beforeEach(async function () {
    [admin, alice, bob, carol] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const OutcomeTokenFactory = await ethers.getContractFactory("OutcomeToken");
    const outcomeTokenImpl = await OutcomeTokenFactory.deploy();

    const CPMMFactory = await ethers.getContractFactory("CPMM");
    const cpmmImpl = await CPMMFactory.deploy();

    const MarketFactoryFactory = await ethers.getContractFactory("MarketFactory");
    factory = await MarketFactoryFactory.deploy(
      await outcomeTokenImpl.getAddress(),
      await cpmmImpl.getAddress(),
      await usdc.getAddress(),
      ethers.ZeroAddress
    );

    const UserEscrowFactory = await ethers.getContractFactory("UserEscrow");
    const escrowImpl = await UserEscrowFactory.deploy();

    const VaultFactory = await ethers.getContractFactory("Vault");
    vault = await VaultFactory.deploy(
      await usdc.getAddress(),
      admin.address, // operator
      await escrowImpl.getAddress()
    );

    await vault.setMarketFactory(await factory.getAddress());
    await factory.setVault(await vault.getAddress());

    // Mint USDC to everyone we'll use
    await usdc.mint(admin.address, 100_000n * ONE_USDC);
    await usdc.mint(alice.address, 100_000n * ONE_USDC);
    await usdc.mint(bob.address, 100_000n * ONE_USDC);
    await usdc.mint(carol.address, 100_000n * ONE_USDC);

    // Create a market
    const endTime = (await time.latest()) + ONE_DAY;
    await usdc.connect(admin).approve(await factory.getAddress(), INITIAL_LIQUIDITY);
    await factory.createMarket(
      "Will redemption work?",
      endTime,
      INITIAL_LIQUIDITY,
      FEE_BPS,
      SOURCE_ADMIN,
      EMPTY_BYTES
    );

    const market = await factory.getMarket(0);
    pool = await ethers.getContractAt("CPMM", market.liquidityPool);
    yesToken = await ethers.getContractAt("OutcomeToken", market.yesToken);
    noToken = await ethers.getContractAt("OutcomeToken", market.noToken);
  });

  /// Alice deposits & buys YES via the vault so she holds YES in her EOA and has an escrow.
  async function aliceBuysYes(usdcAmount: bigint) {
    await usdc.connect(alice).approve(await vault.getAddress(), usdcAmount);
    await vault.connect(alice).deposit(usdcAmount);
    await vault
      .connect(admin)
      .executeBuyYes(await pool.getAddress(), usdcAmount, 0n, alice.address);
  }

  /// Bob deposits & buys NO via the vault.
  async function bobBuysNo(usdcAmount: bigint) {
    await usdc.connect(bob).approve(await vault.getAddress(), usdcAmount);
    await vault.connect(bob).deposit(usdcAmount);
    await vault
      .connect(admin)
      .executeBuyNo(await pool.getAddress(), usdcAmount, 0n, bob.address);
  }

  it("pays YES winner's redemption into their vault escrow", async function () {
    await aliceBuysYes(100n * ONE_USDC);
    await bobBuysNo(100n * ONE_USDC);

    await factory.resolveMarket(0, 1); // YES wins

    const aliceYes = await yesToken.balanceOf(alice.address);
    expect(aliceYes).to.be.gt(0n);
    const expectedUsdc = aliceYes / 10n ** 12n;

    const escrowBefore = await vault.balanceOf(alice.address);

    await expect(factory.connect(alice).redeem(0))
      .to.emit(factory, "Redeemed")
      .withArgs(0, alice.address, expectedUsdc);

    // Winning tokens burned from EOA
    expect(await yesToken.balanceOf(alice.address)).to.equal(0n);

    // Payout landed in the user's escrow, not the EOA
    const escrowAfter = await vault.balanceOf(alice.address);
    expect(escrowAfter - escrowBefore).to.equal(expectedUsdc);
    expect(await vault.totalVaultBalance()).to.equal(expectedUsdc);
  });

  it("pays NO winner's redemption into their vault escrow", async function () {
    await aliceBuysYes(100n * ONE_USDC);
    await bobBuysNo(100n * ONE_USDC);

    await factory.resolveMarket(0, 2); // NO wins

    const bobNo = await noToken.balanceOf(bob.address);
    expect(bobNo).to.be.gt(0n);
    const expectedUsdc = bobNo / 10n ** 12n;

    const escrowBefore = await vault.balanceOf(bob.address);

    await expect(factory.connect(bob).redeem(0))
      .to.emit(factory, "Redeemed")
      .withArgs(0, bob.address, expectedUsdc);

    expect(await noToken.balanceOf(bob.address)).to.equal(0n);

    const escrowAfter = await vault.balanceOf(bob.address);
    expect(escrowAfter - escrowBefore).to.equal(expectedUsdc);
    expect(await vault.totalVaultBalance()).to.equal(expectedUsdc);
  });

  it("falls back to the user's EOA when no escrow is registered", async function () {
    // Carol buys YES directly on the pool — never touches the vault, so no escrow is created.
    const buyAmount = 100n * ONE_USDC;
    await usdc.connect(carol).approve(await pool.getAddress(), buyAmount);
    await pool.connect(carol).buyYes(buyAmount);

    const carolYes = await yesToken.balanceOf(carol.address);
    expect(carolYes).to.be.gt(0n);
    expect(await vault.escrowOf(carol.address)).to.equal(ethers.ZeroAddress);

    await factory.resolveMarket(0, 1); // YES wins

    const expectedUsdc = carolYes / 10n ** 12n;
    const eoaBefore = await usdc.balanceOf(carol.address);

    await expect(factory.connect(carol).redeem(0))
      .to.emit(factory, "Redeemed")
      .withArgs(0, carol.address, expectedUsdc);

    expect(await yesToken.balanceOf(carol.address)).to.equal(0n);
    expect(await usdc.balanceOf(carol.address)).to.equal(eoaBefore + expectedUsdc);
    expect(await vault.balanceOf(carol.address)).to.equal(0n);
  });

  it("reverts when the caller has no winning tokens", async function () {
    await aliceBuysYes(100n * ONE_USDC);
    await bobBuysNo(100n * ONE_USDC);

    await factory.resolveMarket(0, 1); // YES wins

    // Bob has only NO tokens on a YES-winning market → nothing to redeem.
    await expect(factory.connect(bob).redeem(0)).to.be.revertedWith(
      "No winning tokens"
    );
  });

  it("reverts before the market is resolved", async function () {
    await aliceBuysYes(100n * ONE_USDC);

    await expect(factory.connect(alice).redeem(0)).to.be.revertedWith(
      "Not resolved"
    );
  });

  it("blocks direct calls to CPMM.redeemFor from non-factory addresses", async function () {
    await aliceBuysYes(100n * ONE_USDC);
    await factory.resolveMarket(0, 1);

    await expect(
      pool.connect(alice).redeemFor(alice.address, true)
    ).to.be.revertedWith("Only factory");
  });

  it("emits a Redemption event on the pool with the resolved payout target", async function () {
    await aliceBuysYes(100n * ONE_USDC);
    await factory.resolveMarket(0, 1);

    const aliceYes = await yesToken.balanceOf(alice.address);
    const expectedUsdc = aliceYes / 10n ** 12n;
    const escrow = await vault.escrowOf(alice.address);
    expect(escrow).to.not.equal(ethers.ZeroAddress);

    await expect(factory.connect(alice).redeem(0))
      .to.emit(pool, "Redemption")
      .withArgs(0, alice.address, escrow, aliceYes, expectedUsdc);
  });
});

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Collateral address (USDC on Base mainnet)
  const USDC_ADDRESS =
    process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  // UMA Optimistic Oracle V3 on Base (address(0) disables UMA features)
  const UMA_ORACLE_ADDRESS =
    process.env.UMA_ORACLE_V3_ADDRESS || "0x0000000000000000000000000000000000000000";

  // Operator address for Vault (backend wallet that executes trades)
  const OPERATOR_ADDRESS =
    process.env.OPERATOR_ADDRESS || deployer.address;

  // 1. Deploy OutcomeToken implementation (skip if OUTCOME_TOKEN_IMPL set)
  let outcomeTokenAddr = process.env.OUTCOME_TOKEN_IMPL || "";
  if (outcomeTokenAddr) {
    console.log("Reusing OutcomeToken impl:", outcomeTokenAddr);
  } else {
    console.log("Deploying OutcomeToken implementation...");
    const OutcomeToken = await ethers.getContractFactory("OutcomeToken");
    const outcomeTokenImpl = await OutcomeToken.deploy();
    await outcomeTokenImpl.waitForDeployment();
    outcomeTokenAddr = await outcomeTokenImpl.getAddress();
    console.log("  OutcomeToken impl:", outcomeTokenAddr);
  }

  // 2. Deploy CPMM implementation (skip if CPMM_IMPL set)
  let cpmmAddr = process.env.CPMM_IMPL || "";
  if (cpmmAddr) {
    console.log("Reusing CPMM impl:", cpmmAddr);
  } else {
    console.log("Deploying CPMM implementation...");
    const CPMM = await ethers.getContractFactory("CPMM");
    const cpmmImpl = await CPMM.deploy();
    await cpmmImpl.waitForDeployment();
    cpmmAddr = await cpmmImpl.getAddress();
    console.log("  CPMM impl:", cpmmAddr);
  }

  // 3. Deploy MarketFactory (skip if MARKET_FACTORY set)
  const MarketFactory = await ethers.getContractFactory("MarketFactory");
  let factory;
  let factoryAddr = process.env.MARKET_FACTORY || "";
  if (factoryAddr) {
    console.log("Reusing MarketFactory:", factoryAddr);
    factory = MarketFactory.attach(factoryAddr) as any;
  } else {
    console.log("Deploying MarketFactory...");
    factory = await MarketFactory.deploy(outcomeTokenAddr, cpmmAddr, USDC_ADDRESS, UMA_ORACLE_ADDRESS);
    await factory.waitForDeployment();
    factoryAddr = await factory.getAddress();
    console.log("  MarketFactory:", factoryAddr);
  }

  // 4. Deploy UserEscrow implementation (skip if USER_ESCROW_IMPL set)
  let escrowImplAddr = process.env.USER_ESCROW_IMPL || "";
  if (escrowImplAddr) {
    console.log("Reusing UserEscrow impl:", escrowImplAddr);
  } else {
    console.log("Deploying UserEscrow implementation...");
    const UserEscrow = await ethers.getContractFactory("UserEscrow");
    const escrowImpl = await UserEscrow.deploy();
    await escrowImpl.waitForDeployment();
    escrowImplAddr = await escrowImpl.getAddress();
    console.log("  UserEscrow impl:", escrowImplAddr);
  }

  // 5. Deploy Vault (router) (skip if VAULT set)
  const Vault = await ethers.getContractFactory("Vault");
  let vault;
  let vaultAddr = process.env.VAULT || "";
  if (vaultAddr) {
    console.log("Reusing Vault:", vaultAddr);
    vault = Vault.attach(vaultAddr) as any;
  } else {
    console.log("Deploying Vault (router)...");
    vault = await Vault.deploy(USDC_ADDRESS, OPERATOR_ADDRESS, escrowImplAddr);
    await vault.waitForDeployment();
    vaultAddr = await vault.getAddress();
    console.log("  Vault:", vaultAddr);
  }

  // 6. Point Vault's pool whitelist at the MarketFactory
  console.log("Setting MarketFactory on Vault...");
  const setFactoryTx = await vault.setMarketFactory(factoryAddr);
  await setFactoryTx.wait();
  console.log("  MarketFactory set on Vault");

  // 7. Register Vault with MarketFactory so future markets wire their CPMMs to it
  console.log("Setting vault on MarketFactory...");
  const setVaultTx = await factory.setVault(vaultAddr);
  await setVaultTx.wait();
  console.log("  Vault set on factory");

  // 8. Configure protocol fee + treasury on the factory (picked up by every new pool)
  const FEE_WALLET = process.env.FEE_WALLET || "";
  const TRADE_FEE_BPS = process.env.TRADE_FEE_BPS || "100"; // default 1%
  const TREASURY = process.env.TREASURY || FEE_WALLET;

  if (FEE_WALLET) {
    console.log("Setting fee wallet on MarketFactory...");
    const tx = await factory.setFeeWallet(FEE_WALLET);
    await tx.wait();
    console.log("  Fee wallet:", FEE_WALLET);

    console.log("Setting protocol fee bps on MarketFactory...");
    const tx2 = await factory.setProtocolFeeBps(Number(TRADE_FEE_BPS));
    await tx2.wait();
    console.log("  Protocol fee bps:", TRADE_FEE_BPS);
  } else {
    console.log("FEE_WALLET not set — skipping protocol fee configuration");
  }

  if (TREASURY) {
    console.log("Setting treasury on MarketFactory...");
    const tx = await factory.setTreasury(TREASURY);
    await tx.wait();
    console.log("  Treasury:", TREASURY);
  } else {
    console.log("TREASURY not set — liquidity drain will require explicit treasury override");
  }

  // 9. Configure claims buffer bps (headroom kept in pool on top of outstanding claims)
  const CLAIMS_BUFFER_BPS = process.env.CLAIMS_BUFFER_BPS || "100"; // default 1%
  console.log("Setting claims buffer bps on MarketFactory...");
  const txBuffer = await factory.setClaimsBufferBps(Number(CLAIMS_BUFFER_BPS));
  await txBuffer.wait();
  console.log("  Claims buffer bps:", CLAIMS_BUFFER_BPS);

  // Print summary
  console.log("\n=== Deployment Summary ===");
  console.log("Network:              Base Mainnet (Chain ID: 8453)");
  console.log("OutcomeToken Impl:   ", outcomeTokenAddr);
  console.log("CPMM Impl:           ", cpmmAddr);
  console.log("MarketFactory:       ", factoryAddr);
  console.log("UserEscrow Impl:     ", escrowImplAddr);
  console.log("Vault (router):      ", vaultAddr);
  console.log("Collateral (USDC):   ", USDC_ADDRESS);
  console.log("UMA Oracle V3:       ", UMA_ORACLE_ADDRESS);
  console.log("Operator:            ", OPERATOR_ADDRESS);
  console.log("Admin:               ", deployer.address);
  console.log("\nUpdate .env with:");
  console.log(`  MARKET_FACTORY_ADDRESS=${factoryAddr}`);
  console.log(`  NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=${factoryAddr}`);
  console.log(`  VAULT_ADDRESS=${vaultAddr}`);
  console.log(`  NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddr}`);
  console.log(`  USER_ESCROW_IMPL=${escrowImplAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

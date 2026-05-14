import { ethers } from "hardhat";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const WRITE_DELAY_MS = Number(process.env.DEPLOY_WRITE_DELAY_MS || "15000");

async function pauseAfterDeploy() {
  if (WRITE_DELAY_MS > 0) await delay(WRITE_DELAY_MS);
}

async function waitForWrite(tx: any) {
  await tx.wait();
  if (WRITE_DELAY_MS > 0) await delay(WRITE_DELAY_MS);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const USDC_ADDRESS =
    process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const UMA_ORACLE_ADDRESS =
    process.env.UMA_ORACLE_V3_ADDRESS || "0x0000000000000000000000000000000000000000";
  const OPERATOR_ADDRESS = process.env.OPERATOR_ADDRESS || deployer.address;
  const FORCE_NEW_VAULT = process.env.FORCE_NEW_VAULT === "true";

  let outcomeTokenAddr = process.env.OUTCOME_TOKEN_IMPL || "";
  if (outcomeTokenAddr) {
    console.log("Reusing OutcomeToken impl:", outcomeTokenAddr);
  } else {
    const OutcomeToken = await ethers.getContractFactory("OutcomeToken");
    const outcomeTokenImpl = await OutcomeToken.deploy();
    await outcomeTokenImpl.waitForDeployment();
    outcomeTokenAddr = await outcomeTokenImpl.getAddress();
    console.log("OutcomeToken impl:", outcomeTokenAddr);
    await pauseAfterDeploy();
  }

  let cpmmAddr = process.env.CPMM_IMPL || "";
  if (cpmmAddr) {
    console.log("Reusing CPMM impl:", cpmmAddr);
  } else {
    const CPMM = await ethers.getContractFactory("CPMM");
    const cpmmImpl = await CPMM.deploy();
    await cpmmImpl.waitForDeployment();
    cpmmAddr = await cpmmImpl.getAddress();
    console.log("CPMM impl:", cpmmAddr);
    await pauseAfterDeploy();
  }

  const MarketFactory = await ethers.getContractFactory("MarketFactory");
  let factory;
  let factoryAddr = process.env.MARKET_FACTORY || "";
  if (factoryAddr) {
    console.log("Reusing MarketFactory:", factoryAddr);
    factory = MarketFactory.attach(factoryAddr) as any;
  } else {
    factory = await MarketFactory.deploy(outcomeTokenAddr, cpmmAddr, USDC_ADDRESS, UMA_ORACLE_ADDRESS);
    await factory.waitForDeployment();
    factoryAddr = await factory.getAddress();
    console.log("MarketFactory:", factoryAddr);
    await pauseAfterDeploy();
  }

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  let poolRegistry;
  let poolRegistryAddr = process.env.POOL_REGISTRY_ADDRESS || "";
  if (poolRegistryAddr) {
    console.log("Reusing PoolRegistry:", poolRegistryAddr);
    poolRegistry = PoolRegistry.attach(poolRegistryAddr) as any;
  } else {
    poolRegistry = await PoolRegistry.deploy();
    await poolRegistry.waitForDeployment();
    poolRegistryAddr = await poolRegistry.getAddress();
    console.log("PoolRegistry:", poolRegistryAddr);
    await pauseAfterDeploy();
  }

  let binaryAdapterAddr = process.env.BINARY_CPMM_ADAPTER_ADDRESS || "";
  if (binaryAdapterAddr) {
    console.log("Reusing BinaryCPMMAdapter:", binaryAdapterAddr);
  } else {
    const BinaryCPMMAdapter = await ethers.getContractFactory("BinaryCPMMAdapter");
    const adapter = await BinaryCPMMAdapter.deploy();
    await adapter.waitForDeployment();
    binaryAdapterAddr = await adapter.getAddress();
    console.log("BinaryCPMMAdapter:", binaryAdapterAddr);
    await pauseAfterDeploy();
  }

  let rangeAdapterAddr = process.env.RANGE_LMSR_ADAPTER_ADDRESS || "";
  if (rangeAdapterAddr) {
    console.log("Reusing RangeLMSRAdapter:", rangeAdapterAddr);
  } else {
    const RangeLMSRAdapter = await ethers.getContractFactory("RangeLMSRAdapter");
    const adapter = await RangeLMSRAdapter.deploy();
    await adapter.waitForDeployment();
    rangeAdapterAddr = await adapter.getAddress();
    console.log("RangeLMSRAdapter:", rangeAdapterAddr);
    await pauseAfterDeploy();
  }

  let escrowImplAddr = FORCE_NEW_VAULT ? "" : (process.env.USER_ESCROW_IMPL || "");
  if (escrowImplAddr) {
    console.log("Reusing UserEscrow impl:", escrowImplAddr);
  } else {
    const UserEscrow = await ethers.getContractFactory("UserEscrow");
    const escrowImpl = await UserEscrow.deploy();
    await escrowImpl.waitForDeployment();
    escrowImplAddr = await escrowImpl.getAddress();
    console.log("UserEscrow impl:", escrowImplAddr);
    await pauseAfterDeploy();
  }

  const Vault = await ethers.getContractFactory("Vault");
  let vault;
  let vaultAddr = FORCE_NEW_VAULT ? "" : (process.env.VAULT || process.env.VAULT_ADDRESS || "");
  if (vaultAddr) {
    console.log("Reusing Vault:", vaultAddr);
    vault = Vault.attach(vaultAddr) as any;
  } else {
    vault = await Vault.deploy(USDC_ADDRESS, OPERATOR_ADDRESS, escrowImplAddr, poolRegistryAddr);
    await vault.waitForDeployment();
    vaultAddr = await vault.getAddress();
    console.log("Vault:", vaultAddr);
    await pauseAfterDeploy();
  }

  if (WRITE_DELAY_MS > 0) await delay(WRITE_DELAY_MS);

  console.log("Registering factories and adapters...");
  let tx = await poolRegistry.setFactory(factoryAddr, true);
  await waitForWrite(tx);
  if (process.env.RANGE_FACTORY_ADDRESS) {
    tx = await poolRegistry.setFactory(process.env.RANGE_FACTORY_ADDRESS, true);
    await waitForWrite(tx);
  }
  tx = await vault.setPoolRegistry(poolRegistryAddr);
  await waitForWrite(tx);
  tx = await vault.setAdapter(binaryAdapterAddr, true);
  await waitForWrite(tx);
  tx = await vault.setAdapter(rangeAdapterAddr, true);
  await waitForWrite(tx);

  console.log("Setting vault on MarketFactory...");
  tx = await factory.setVault(vaultAddr);
  await waitForWrite(tx);

  const FEE_WALLET = process.env.FEE_WALLET || "";
  const TRADE_FEE_BPS = process.env.TRADE_FEE_BPS || "100";
  const TREASURY = process.env.TREASURY || FEE_WALLET;

  if (FEE_WALLET) {
    tx = await factory.setFeeWallet(FEE_WALLET);
    await waitForWrite(tx);
    tx = await factory.setProtocolFeeBps(Number(TRADE_FEE_BPS));
    await waitForWrite(tx);
  }

  if (TREASURY) {
    tx = await factory.setTreasury(TREASURY);
    await waitForWrite(tx);
  }

  const CLAIMS_BUFFER_BPS = process.env.CLAIMS_BUFFER_BPS || "100";
  tx = await factory.setClaimsBufferBps(Number(CLAIMS_BUFFER_BPS));
  await waitForWrite(tx);

  console.log("\n=== Deployment Summary ===");
  console.log("OutcomeToken Impl:       ", outcomeTokenAddr);
  console.log("CPMM Impl:               ", cpmmAddr);
  console.log("MarketFactory:           ", factoryAddr);
  console.log("PoolRegistry:            ", poolRegistryAddr);
  console.log("BinaryCPMMAdapter:       ", binaryAdapterAddr);
  console.log("RangeLMSRAdapter:        ", rangeAdapterAddr);
  console.log("UserEscrow Impl:         ", escrowImplAddr);
  console.log("Vault:                   ", vaultAddr);
  console.log("Collateral (USDC):       ", USDC_ADDRESS);
  console.log("UMA Oracle V3:           ", UMA_ORACLE_ADDRESS);
  console.log("Operator:                ", OPERATOR_ADDRESS);
  console.log("\nUpdate .env with:");
  console.log(`  MARKET_FACTORY_ADDRESS=${factoryAddr}`);
  console.log(`  NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=${factoryAddr}`);
  console.log(`  POOL_REGISTRY_ADDRESS=${poolRegistryAddr}`);
  console.log(`  BINARY_CPMM_ADAPTER_ADDRESS=${binaryAdapterAddr}`);
  console.log(`  RANGE_LMSR_ADAPTER_ADDRESS=${rangeAdapterAddr}`);
  console.log(`  VAULT_ADDRESS=${vaultAddr}`);
  console.log(`  USER_ESCROW_IMPL=${escrowImplAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

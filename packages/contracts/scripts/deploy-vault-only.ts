import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying vault with account:", deployer.address);

  const USDC_ADDRESS =
    process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const OPERATOR_ADDRESS = process.env.OPERATOR_ADDRESS || deployer.address;
  const MARKET_FACTORY = process.env.MARKET_FACTORY || process.env.MARKET_FACTORY_ADDRESS;
  const RANGE_FACTORY = process.env.RANGE_FACTORY_ADDRESS;

  if (!MARKET_FACTORY) throw new Error("Set MARKET_FACTORY or MARKET_FACTORY_ADDRESS");

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  let poolRegistryAddr = process.env.POOL_REGISTRY_ADDRESS || "";
  let poolRegistry;
  if (poolRegistryAddr) {
    poolRegistry = PoolRegistry.attach(poolRegistryAddr) as any;
  } else {
    poolRegistry = await PoolRegistry.deploy();
    await poolRegistry.waitForDeployment();
    poolRegistryAddr = await poolRegistry.getAddress();
  }

  const BinaryCPMMAdapter = await ethers.getContractFactory("BinaryCPMMAdapter");
  const binaryAdapter = await BinaryCPMMAdapter.deploy();
  await binaryAdapter.waitForDeployment();
  const binaryAdapterAddr = await binaryAdapter.getAddress();

  const RangeLMSRAdapter = await ethers.getContractFactory("RangeLMSRAdapter");
  const rangeAdapter = await RangeLMSRAdapter.deploy();
  await rangeAdapter.waitForDeployment();
  const rangeAdapterAddr = await rangeAdapter.getAddress();

  const UserEscrow = await ethers.getContractFactory("UserEscrow");
  const escrowImpl = await UserEscrow.deploy();
  await escrowImpl.waitForDeployment();
  const escrowImplAddr = await escrowImpl.getAddress();

  const Vault = await ethers.getContractFactory("Vault");
  const vault = await Vault.deploy(USDC_ADDRESS, OPERATOR_ADDRESS, escrowImplAddr, poolRegistryAddr);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();

  let tx = await poolRegistry.setFactory(MARKET_FACTORY, true);
  await tx.wait();
  if (RANGE_FACTORY) {
    tx = await poolRegistry.setFactory(RANGE_FACTORY, true);
    await tx.wait();
  }
  tx = await vault.setAdapter(binaryAdapterAddr, true);
  await tx.wait();
  tx = await vault.setAdapter(rangeAdapterAddr, true);
  await tx.wait();

  const factory = await ethers.getContractAt("MarketFactory", MARKET_FACTORY);
  tx = await factory.setVault(vaultAddr);
  await tx.wait();

  console.log("\n=== New Vault Deployment ===");
  console.log("PoolRegistry:", poolRegistryAddr);
  console.log("BinaryCPMMAdapter:", binaryAdapterAddr);
  console.log("RangeLMSRAdapter:", rangeAdapterAddr);
  console.log("UserEscrow Impl:", escrowImplAddr);
  console.log("Vault:", vaultAddr);
  console.log("\nUpdate env with:");
  console.log(`  POOL_REGISTRY_ADDRESS=${poolRegistryAddr}`);
  console.log(`  BINARY_CPMM_ADAPTER_ADDRESS=${binaryAdapterAddr}`);
  console.log(`  RANGE_LMSR_ADAPTER_ADDRESS=${rangeAdapterAddr}`);
  console.log(`  USER_ESCROW_IMPL=${escrowImplAddr}`);
  console.log(`  VAULT=${vaultAddr}`);
  console.log(`  VAULT_ADDRESS=${vaultAddr}`);
  console.log(`  NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

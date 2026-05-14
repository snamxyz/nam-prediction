import "dotenv/config";
import { ethers } from "hardhat";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const [deployer] = await ethers.getSigners();
  const VAULT_ADDRESS = process.env.NEW_VAULT_ADDRESS || process.env.VAULT_ADDRESS || process.env.VAULT;
  const MARKET_FACTORY = process.env.MARKET_FACTORY || process.env.MARKET_FACTORY_ADDRESS;
  const RANGE_FACTORY = process.env.RANGE_FACTORY_ADDRESS;
  const POOL_REGISTRY = process.env.POOL_REGISTRY_ADDRESS;
  const BINARY_ADAPTER = process.env.BINARY_CPMM_ADAPTER_ADDRESS;
  const RANGE_ADAPTER = process.env.RANGE_LMSR_ADAPTER_ADDRESS;

  if (!VAULT_ADDRESS) throw new Error("Set NEW_VAULT_ADDRESS");
  if (!MARKET_FACTORY) throw new Error("Set MARKET_FACTORY or MARKET_FACTORY_ADDRESS");
  if (!POOL_REGISTRY) throw new Error("Set POOL_REGISTRY_ADDRESS");

  console.log("Configuring with account:", deployer.address);
  console.log("Vault:", VAULT_ADDRESS);
  console.log("MarketFactory:", MARKET_FACTORY);

  const vault = await ethers.getContractAt("Vault", VAULT_ADDRESS);
  const factory = await ethers.getContractAt("MarketFactory", MARKET_FACTORY);
  const registry = await ethers.getContractAt("PoolRegistry", POOL_REGISTRY);

  console.log("Setting PoolRegistry on Vault...");
  let tx = await vault.setPoolRegistry(POOL_REGISTRY);
  await tx.wait();
  console.log("  Done:", tx.hash);

  console.log("Registering factories in PoolRegistry...");
  tx = await registry.setFactory(MARKET_FACTORY, true);
  await tx.wait();
  if (RANGE_FACTORY) {
    tx = await registry.setFactory(RANGE_FACTORY, true);
    await tx.wait();
  }

  if (BINARY_ADAPTER) {
    console.log("Authorizing BinaryCPMMAdapter...");
    tx = await vault.setAdapter(BINARY_ADAPTER, true);
    await tx.wait();
  }

  if (RANGE_ADAPTER) {
    console.log("Authorizing RangeLMSRAdapter...");
    tx = await vault.setAdapter(RANGE_ADAPTER, true);
    await tx.wait();
  }

  await delay(10_000);

  console.log("Setting Vault on MarketFactory...");
  tx = await factory.setVault(VAULT_ADDRESS);
  await tx.wait();
  console.log("  Done:", tx.hash);

  console.log("\nVault configuration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

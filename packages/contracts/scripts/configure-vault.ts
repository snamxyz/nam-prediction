import "dotenv/config";
import { ethers } from "hardhat";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const [deployer] = await ethers.getSigners();
  const VAULT_ADDRESS = process.env.NEW_VAULT_ADDRESS || process.env.VAULT_ADDRESS || process.env.VAULT;
  const MARKET_FACTORY = process.env.MARKET_FACTORY || process.env.MARKET_FACTORY_ADDRESS;

  if (!VAULT_ADDRESS) throw new Error("Set NEW_VAULT_ADDRESS");
  if (!MARKET_FACTORY) throw new Error("Set MARKET_FACTORY or MARKET_FACTORY_ADDRESS");

  console.log("Configuring with account:", deployer.address);
  console.log("Vault:", VAULT_ADDRESS);
  console.log("MarketFactory:", MARKET_FACTORY);

  const vault = await ethers.getContractAt("Vault", VAULT_ADDRESS);
  const factory = await ethers.getContractAt("MarketFactory", MARKET_FACTORY);

  console.log("Setting MarketFactory on Vault...");
  const setFactoryTx = await vault.setMarketFactory(MARKET_FACTORY);
  await setFactoryTx.wait();
  console.log("  Done:", setFactoryTx.hash);

  await delay(10_000);

  console.log("Setting Vault on MarketFactory...");
  const setVaultTx = await factory.setVault(VAULT_ADDRESS);
  await setVaultTx.wait();
  console.log("  Done:", setVaultTx.hash);

  console.log("\nVault configuration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

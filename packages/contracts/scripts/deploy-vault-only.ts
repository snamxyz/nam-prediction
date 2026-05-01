import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying vault with account:", deployer.address);

  const USDC_ADDRESS =
    process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const OPERATOR_ADDRESS = process.env.OPERATOR_ADDRESS || deployer.address;
  const MARKET_FACTORY = process.env.MARKET_FACTORY || process.env.MARKET_FACTORY_ADDRESS;

  if (!MARKET_FACTORY) {
    throw new Error("Set MARKET_FACTORY or MARKET_FACTORY_ADDRESS");
  }

  console.log("Reusing MarketFactory:", MARKET_FACTORY);
  console.log("Collateral (USDC):", USDC_ADDRESS);
  console.log("Operator:", OPERATOR_ADDRESS);

  const UserEscrow = await ethers.getContractFactory("UserEscrow");
  console.log("Deploying UserEscrow implementation...");
  const escrowImpl = await UserEscrow.deploy();
  await escrowImpl.waitForDeployment();
  const escrowImplAddr = await escrowImpl.getAddress();
  console.log("  UserEscrow impl:", escrowImplAddr);

  const Vault = await ethers.getContractFactory("Vault");
  console.log("Deploying Vault...");
  const vault = await Vault.deploy(USDC_ADDRESS, OPERATOR_ADDRESS, escrowImplAddr);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("  Vault:", vaultAddr);

  console.log("Setting MarketFactory on Vault...");
  const setFactoryTx = await vault.setMarketFactory(MARKET_FACTORY);
  await setFactoryTx.wait();
  console.log("  Done:", setFactoryTx.hash);

  console.log("Setting Vault on MarketFactory...");
  const factory = await ethers.getContractAt("MarketFactory", MARKET_FACTORY);
  const setVaultTx = await factory.setVault(vaultAddr);
  await setVaultTx.wait();
  console.log("  Done:", setVaultTx.hash);

  console.log("\n=== New Vault Deployment ===");
  console.log("UserEscrow Impl:", escrowImplAddr);
  console.log("Vault:", vaultAddr);
  console.log("\nUpdate env with:");
  console.log(`  USER_ESCROW_IMPL=${escrowImplAddr}`);
  console.log(`  VAULT=${vaultAddr}`);
  console.log(`  VAULT_ADDRESS=${vaultAddr}`);
  console.log(`  NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

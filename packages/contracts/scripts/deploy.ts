import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Collateral address (USDC on Base mainnet)
  const USDC_ADDRESS =
    process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b4CF1daEdda";

  // UMA Optimistic Oracle V3 on Base (address(0) disables UMA features)
  const UMA_ORACLE_ADDRESS =
    process.env.UMA_ORACLE_V3_ADDRESS || "0x0000000000000000000000000000000000000000";

  // 1. Deploy OutcomeToken implementation
  console.log("Deploying OutcomeToken implementation...");
  const OutcomeToken = await ethers.getContractFactory("OutcomeToken");
  const outcomeTokenImpl = await OutcomeToken.deploy();
  await outcomeTokenImpl.waitForDeployment();
  const outcomeTokenAddr = await outcomeTokenImpl.getAddress();
  console.log("  OutcomeToken impl:", outcomeTokenAddr);

  // 2. Deploy CPMM implementation
  console.log("Deploying CPMM implementation...");
  const CPMM = await ethers.getContractFactory("CPMM");
  const cpmmImpl = await CPMM.deploy();
  await cpmmImpl.waitForDeployment();
  const cpmmAddr = await cpmmImpl.getAddress();
  console.log("  CPMM impl:", cpmmAddr);

  // 3. Deploy MarketFactory
  console.log("Deploying MarketFactory...");
  const MarketFactory = await ethers.getContractFactory("MarketFactory");
  const factory = await MarketFactory.deploy(outcomeTokenAddr, cpmmAddr, USDC_ADDRESS, UMA_ORACLE_ADDRESS);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("  MarketFactory:", factoryAddr);

  // Print summary
  console.log("\n=== Deployment Summary ===");
  console.log("Network:              Base Mainnet (Chain ID: 8453)");
  console.log("OutcomeToken Impl:   ", outcomeTokenAddr);
  console.log("CPMM Impl:           ", cpmmAddr);
  console.log("MarketFactory:       ", factoryAddr);
  console.log("Collateral (USDC):   ", USDC_ADDRESS);
  console.log("UMA Oracle V3:       ", UMA_ORACLE_ADDRESS);
  console.log("Admin:               ", deployer.address);
  console.log("\nUpdate .env with:");
  console.log(`  MARKET_FACTORY_ADDRESS=${factoryAddr}`);
  console.log(`  NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=${factoryAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

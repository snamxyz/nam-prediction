import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("[DeployRange] Deploying with account:", deployer.address);

  const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
  const FEE_WALLET = process.env.FEE_WALLET || deployer.address;
  const TREASURY = process.env.TREASURY || deployer.address;
  const PROTOCOL_FEE_BPS = Number(process.env.PROTOCOL_FEE_BPS) || 0;
  const CLAIMS_BUFFER_BPS = Number(process.env.CLAIMS_BUFFER_BPS) || 100;
  const POOL_REGISTRY_ADDRESS = process.env.POOL_REGISTRY_ADDRESS;

  // 1. Deploy RangeOutcomeToken implementation
  const RangeOutcomeToken = await ethers.getContractFactory("RangeOutcomeToken");
  const rangeTokenImpl = await RangeOutcomeToken.deploy();
  await rangeTokenImpl.waitForDeployment();
  console.log("[DeployRange] RangeOutcomeToken impl:", await rangeTokenImpl.getAddress());

  // 2. Deploy RangeLMSR implementation
  const RangeLMSR = await ethers.getContractFactory("RangeLMSR");
  const rangeLmsrImpl = await RangeLMSR.deploy();
  await rangeLmsrImpl.waitForDeployment();
  console.log("[DeployRange] RangeLMSR impl:", await rangeLmsrImpl.getAddress());

  // 3. Deploy RangeMarketFactory
  const RangeMarketFactory = await ethers.getContractFactory("RangeMarketFactory");
  const factory = await RangeMarketFactory.deploy(
    await rangeTokenImpl.getAddress(),
    await rangeLmsrImpl.getAddress(),
    USDC_ADDRESS,
    FEE_WALLET,
    PROTOCOL_FEE_BPS,
    CLAIMS_BUFFER_BPS,
    TREASURY
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("[DeployRange] RangeMarketFactory:", factoryAddress);

  // 4. Register the range factory once so all new range pools are accepted by Vault.
  if (POOL_REGISTRY_ADDRESS) {
    const registry = await ethers.getContractAt("PoolRegistry", POOL_REGISTRY_ADDRESS);
    const tx = await registry.setFactory(factoryAddress, true);
    await tx.wait();
    console.log("[DeployRange] Registered range factory in PoolRegistry:", POOL_REGISTRY_ADDRESS);
  } else if (VAULT_ADDRESS) {
    console.log("[DeployRange] Vault configured at:", VAULT_ADDRESS);
    console.log("[DeployRange] Set RANGE_FACTORY_ADDRESS=" + factoryAddress + " in your .env");
    console.log("[DeployRange] Register this factory in PoolRegistry before trading.");
  }

  console.log("\n[DeployRange] Summary:");
  console.log("  RANGE_FACTORY_ADDRESS=" + factoryAddress);
  console.log("  RANGE_TOKEN_IMPL=" + (await rangeTokenImpl.getAddress()));
  console.log("  RANGE_LMSR_IMPL=" + (await rangeLmsrImpl.getAddress()));
  if (POOL_REGISTRY_ADDRESS) console.log("  POOL_REGISTRY_ADDRESS=" + POOL_REGISTRY_ADDRESS);
}

main().catch((err) => {
  console.error("[DeployRange] Error:", err);
  process.exit(1);
});

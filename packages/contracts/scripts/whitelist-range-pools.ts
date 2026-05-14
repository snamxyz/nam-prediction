import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const registryAddress = process.env.POOL_REGISTRY_ADDRESS;
  const rangeFactoryAddress = process.env.RANGE_FACTORY_ADDRESS;

  if (!registryAddress) throw new Error("Set POOL_REGISTRY_ADDRESS");
  if (!rangeFactoryAddress) throw new Error("Set RANGE_FACTORY_ADDRESS");
  if (!ethers.isAddress(registryAddress)) throw new Error("POOL_REGISTRY_ADDRESS is invalid");
  if (!ethers.isAddress(rangeFactoryAddress)) throw new Error("RANGE_FACTORY_ADDRESS is invalid");

  const registry = await ethers.getContractAt("PoolRegistry", registryAddress);
  const rangeFactory = await ethers.getContractAt("RangeMarketFactory", rangeFactoryAddress);

  const alreadyRegistered = await registry.isFactory(rangeFactoryAddress);
  if (!alreadyRegistered) {
    const tx = await registry.setFactory(rangeFactoryAddress, true);
    await tx.wait();
    console.log("Registered range factory in PoolRegistry:", tx.hash);
  } else {
    console.log("Range factory already registered.");
  }

  const count = await rangeFactory.rangeMarketCount();
  console.log("Range markets:", count.toString());

  for (let i = 0n; i < count; i++) {
    const market = await rangeFactory.getMarket(i);
    if (market.pool === ethers.ZeroAddress) continue;
    const registered = await registry.isPool(market.pool);
    console.log(`  market ${i}: ${market.pool} registered=${registered}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import 'dotenv/config';
import { ethers } from "hardhat";

const FACTORY_ADDRESS = process.env.MARKET_FACTORY!;
const FEE_WALLET = process.env.FEE_WALLET || "";
const TRADE_FEE_BPS = Number(process.env.TRADE_FEE_BPS || "100");
const TREASURY = process.env.TREASURY || FEE_WALLET;
const CLAIMS_BUFFER_BPS = Number(process.env.CLAIMS_BUFFER_BPS || "100");

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Configuring with account:", deployer.address);
  console.log("Factory:", FACTORY_ADDRESS);

  const factory = await ethers.getContractAt("MarketFactory", FACTORY_ADDRESS);

  if (FEE_WALLET) {
    console.log("Setting fee wallet:", FEE_WALLET);
    const tx = await factory.setFeeWallet(FEE_WALLET);
    await tx.wait();
    console.log("  Done:", tx.hash);
    await delay(5000);

    console.log("Setting protocol fee bps:", TRADE_FEE_BPS);
    const tx2 = await factory.setProtocolFeeBps(TRADE_FEE_BPS);
    await tx2.wait();
    console.log("  Done:", tx2.hash);
    await delay(5000);
  }

  if (TREASURY) {
    console.log("Setting treasury:", TREASURY);
    const tx = await factory.setTreasury(TREASURY);
    await tx.wait();
    console.log("  Done:", tx.hash);
    await delay(5000);
  }

  console.log("Setting claims buffer bps:", CLAIMS_BUFFER_BPS);
  const tx = await factory.setClaimsBufferBps(CLAIMS_BUFFER_BPS);
  await tx.wait();
  console.log("  Done:", tx.hash);

  console.log("\nFactory configuration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

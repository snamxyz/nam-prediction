import "dotenv/config";
import { ethers } from "hardhat";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EXECUTE_TRADE_SIGNATURE = "executeTrade(address,address,address,bytes)";

function readAddress(name: string, required = false): string | undefined {
  const value = process.env[name];
  if (!value) {
    if (required) throw new Error(`Set ${name}`);
    return undefined;
  }
  if (!ethers.isAddress(value)) throw new Error(`${name} is not a valid address`);
  return value;
}

function readSharesIn(): bigint | undefined {
  const value = process.env.RANGE_SHARES_IN;
  if (!value) return undefined;
  return ethers.parseUnits(value, 18);
}

async function main() {
  const vaultAddress = readAddress("VAULT_ADDRESS", true)!;
  const poolAddress = readAddress("RANGE_POOL_ADDRESS");
  const userAddress = readAddress("RANGE_USER_ADDRESS");
  const rangeIndex = BigInt(process.env.RANGE_INDEX ?? "0");
  const sharesIn = readSharesIn();

  const selector = ethers.id(EXECUTE_TRADE_SIGNATURE).slice(0, 10);
  const code = await ethers.provider.getCode(vaultAddress);
  if (code === "0x") throw new Error(`No bytecode found at VAULT_ADDRESS ${vaultAddress}`);

  const selectorPresent = code.toLowerCase().includes(selector.slice(2).toLowerCase());
  console.log("Vault:", vaultAddress);
  console.log("Required selector:", `${selector} (${EXECUTE_TRADE_SIGNATURE})`);
  console.log("Selector present in deployed Vault bytecode:", selectorPresent);

  if (!selectorPresent) {
    console.error(
      "Deployed Vault bytecode does not contain the generic executeTrade selector. " +
      "Redeploy Vault or point VAULT_ADDRESS at a current deployment before adapter-routed trades."
    );
    process.exitCode = 1;
    return;
  }

  const vault = await ethers.getContractAt("Vault", vaultAddress);
  console.log("Vault admin:", await vault.admin());
  console.log("Vault operator:", await vault.operator());
  console.log("Vault poolRegistry:", await vault.poolRegistry());
  if (process.env.RANGE_LMSR_ADAPTER_ADDRESS) {
    console.log(
      "Range adapter authorized:",
      await vault.authorizedAdapters(process.env.RANGE_LMSR_ADAPTER_ADDRESS)
    );
  }

  if (poolAddress) {
    console.log("Range pool:", poolAddress);
    const registryAddress = await vault.poolRegistry();
    const registry = await ethers.getContractAt("PoolRegistry", registryAddress);
    console.log("PoolRegistry.isPool(pool):", await registry.isPool(poolAddress));

    const pool = await ethers.getContractAt("RangeLMSR", poolAddress);
    console.log("Range pool resolved:", await pool.resolved());
    console.log("Range pool collateral balance:", ethers.formatUnits(await pool.getCollateralBalance(), 6), "USDC");

    if (sharesIn) {
      const quote = await pool.quoteSell(rangeIndex, sharesIn);
      console.log("quoteSell:", ethers.formatUnits(quote, 6), "USDC");
    }

    if (userAddress) {
      const escrow = await vault.escrowOf(userAddress);
      console.log("User:", userAddress);
      console.log("User escrow:", escrow);
      if (escrow !== ZERO_ADDRESS) {
        console.log("User vault balance:", ethers.formatUnits(await vault.balanceOf(userAddress), 6), "USDC");
      }

      const tokenAddress = await pool.getRangeToken(rangeIndex);
      const token = await ethers.getContractAt(
        ["function balanceOf(address account) view returns (uint256)"],
        tokenAddress
      );
      console.log("Range token:", tokenAddress);
      console.log("User range token balance:", ethers.formatUnits(await token.balanceOf(userAddress), 18));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

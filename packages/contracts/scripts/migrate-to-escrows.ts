import { ethers } from "hardhat";

/**
 * migrate-to-escrows.ts
 *
 * Helper for migrating from the legacy pooled Vault (single `balances` ledger)
 * to the new per-user-escrow Vault (this release).
 *
 * The old Vault intentionally has NO admin path to move user funds — each
 * depositor must sign their own `withdraw(amount)` call and then re-`deposit`
 * into the new Vault (which deploys their personal escrow).
 *
 * This script does two things:
 *   1) Snapshots the old Vault: enumerates users with a non-zero balance by
 *      walking `Deposit` events, reads the current on-chain balance for each,
 *      and writes a report to `out/migration-report.json`.
 *   2) For each user with a balance, derives the escrow address that will be
 *      deployed on first deposit into the new Vault (via `predictEscrow`), so
 *      an off-chain bookkeeping system can pre-register it.
 *
 * Required env:
 *   OLD_VAULT_ADDRESS   — the legacy pooled Vault
 *   NEW_VAULT_ADDRESS   — the new escrow-router Vault
 *   OLD_VAULT_FROM_BLOCK (optional) — block to start scanning from (default 0)
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface MigrationRow {
  user: string;
  oldBalance: string; // 6 decimals, raw string
  predictedEscrow: string;
  newEscrowAlreadyDeployed: boolean;
}

async function main() {
  const oldVaultAddr = process.env.OLD_VAULT_ADDRESS;
  const newVaultAddr = process.env.NEW_VAULT_ADDRESS;
  const fromBlock = BigInt(process.env.OLD_VAULT_FROM_BLOCK || "0");

  if (!oldVaultAddr || !newVaultAddr) {
    throw new Error("Set OLD_VAULT_ADDRESS and NEW_VAULT_ADDRESS env vars");
  }

  console.log(`Old vault: ${oldVaultAddr}`);
  console.log(`New vault: ${newVaultAddr}`);
  console.log(`Scanning from block: ${fromBlock}`);

  // Minimal ABI — both old and new Vault share the same event signatures for
  // Deposit/Withdraw; the new Vault additionally exposes `escrowOf` and `predictEscrow`.
  const oldVaultAbi = [
    "event Deposit(address indexed user, uint256 amount)",
    "function balances(address) view returns (uint256)",
  ];
  const newVaultAbi = [
    "function escrowOf(address) view returns (address)",
    "function predictEscrow(address) view returns (address)",
  ];

  const provider = ethers.provider;
  const oldVault = new ethers.Contract(oldVaultAddr, oldVaultAbi, provider);
  const newVault = new ethers.Contract(newVaultAddr, newVaultAbi, provider);

  // Gather all distinct depositors from Deposit event history
  console.log("Fetching Deposit events...");
  const filter = oldVault.filters.Deposit();
  const logs = await oldVault.queryFilter(filter, Number(fromBlock), "latest");
  const users = new Set<string>();
  for (const log of logs) {
    const evLog = log as ethers.EventLog;
    if (evLog.args && evLog.args.length > 0) {
      users.add((evLog.args[0] as string).toLowerCase());
    }
  }
  console.log(`Found ${users.size} distinct depositor(s).`);

  const rows: MigrationRow[] = [];
  let nonZeroCount = 0;

  for (const u of users) {
    const oldBal = (await oldVault.balances(u)) as bigint;
    if (oldBal === 0n) continue;
    nonZeroCount++;

    const predicted = (await newVault.predictEscrow(u)) as string;
    const existing = (await newVault.escrowOf(u)) as string;
    const alreadyDeployed =
      existing.toLowerCase() !== "0x0000000000000000000000000000000000000000";

    rows.push({
      user: u,
      oldBalance: oldBal.toString(),
      predictedEscrow: predicted,
      newEscrowAlreadyDeployed: alreadyDeployed,
    });
  }

  rows.sort((a, b) => (BigInt(b.oldBalance) > BigInt(a.oldBalance) ? 1 : -1));

  const totalOld = rows.reduce((acc, r) => acc + BigInt(r.oldBalance), 0n);

  const outPath = resolve(__dirname, "..", "out", "migration-report.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        oldVault: oldVaultAddr,
        newVault: newVaultAddr,
        scannedAt: new Date().toISOString(),
        totalDepositorsSeen: users.size,
        depositorsWithBalance: nonZeroCount,
        totalPendingBalance: totalOld.toString(),
        rows,
      },
      null,
      2
    )
  );

  console.log(`\n=== Migration Snapshot ===`);
  console.log(`Depositors with balance : ${nonZeroCount}`);
  console.log(`Total pending (raw USDC): ${totalOld.toString()}`);
  console.log(`Report written to       : ${outPath}`);
  console.log("\nEach listed user must:");
  console.log("  1. Call oldVault.withdraw(balance) from their wallet");
  console.log("  2. Call usdc.approve(newVault, amount) and newVault.deposit(amount)");
  console.log("The newVault will deploy each user's personal escrow on first deposit.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

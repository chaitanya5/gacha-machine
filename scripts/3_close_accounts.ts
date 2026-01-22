// scripts/deploy.ts
import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as fs from "fs/promises";
import * as path from "path";
import {
  encryptWithKey,
  sleep,
  getConfigurationFromNetwork,
  keypairFromPrivateKey,
  createAnchorProgramAndClient,
} from "./utils";
import { GachaClient } from "./gacha-client";

async function closeAllStates(
  client: GachaClient,
  admin: Keypair,
  gachaMachineCount: anchor.BN
) {
  try {
    const closeTx = await client.closeAllAccounts(admin, gachaMachineCount);
    console.log(`All accounts closed to claim rent! Tx: ${closeTx}`);
  } catch (error) {
    console.error(`Failed to call the closeAll instruction`, error.message);
  }
}

async function main(
  adminPrivateKey: string,
  gachaMachineCount: string,
  network: string
) {
  // --- SETUP ---
  console.log("🚀 Starting deployment script...");

  const { encryptionKey } = getConfigurationFromNetwork(network);
  const admin = keypairFromPrivateKey(adminPrivateKey);
  const { program, client } = createAnchorProgramAndClient(network, admin);

  const gcmCount = new anchor.BN(gachaMachineCount);

  // -- CLOSE ALL ACCOUNTS ---
  await closeAllStates(client, admin, gcmCount);

  console.log(
    "\n✅ Gacha Initialized,\n✅ Payment configuration added,\n✅ Encrypted Keys Populated, \n✅ Gacha Finalized!"
  );
}

// Pass admin private key and the network
const args = process.argv.slice(2);
const [adminPrivateKey, gachaMachineCount, network] = args;

main(adminPrivateKey, gachaMachineCount, network).catch((err) => {
  console.error(err);
  process.exit(1);
});

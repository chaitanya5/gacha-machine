import * as anchor from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import {
  safeAsync,
  keypairFromPrivateKey,
  getConfigurationFromNetwork,
  anchorProviderFromWallet,
  createAnchorProgramAndClient,
  handleTransaction,
  retryWithBackoff,
  PaymentType,
  validateSolBalance,
  validateSplBalance,
} from "./utils.js";
import {
  Keypair,
  Connection,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

async function loadSbProgram(provider) {
  const sbProgramId = await sb.getProgramId(provider.connection);
  const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);
  if (!sbIdl) {
    throw new Error("Failed to fetch Switchboard on-demand IDL");
  }
  return new anchor.Program(sbIdl, provider);
}

/**
 * Setup queue function adapted from utils.ts
 */
async function setupQueue(program) {
  const queueAccount = await sb.getDefaultQueue(
    program.provider.connection.rpcEndpoint
  );
  return queueAccount.pubkey;
}

/**
 * Setup Switchboard environment
 */

export async function setupSwitchboardEnvironment(connection, keypair) {
  const provider = anchorProviderFromWallet(connection, keypair);
  const sbProgram = await loadSbProgram(provider);
  const queue = await setupQueue(sbProgram);

  return { sbProgram, queue };
}

/**
 * Create commit instruction for Switchboard
 */
export async function createCommitInstruction(randomness, queue) {
  return randomness.commitIx(queue);
}

/**
 * Create reveal instruction for Switchboard
 */
export async function createRevealInstruction(randomness) {
  return await retryWithBackoff(
    async () => {
      console.log("Creating reveal instruction...");
      return await randomness.revealIx();
    },
    5,
    1000
  );
}

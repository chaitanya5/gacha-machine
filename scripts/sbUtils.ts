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
} from "./utils";
import {
  Keypair,
  Connection,
  PublicKey,
  Commitment,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

async function loadSbProgram(
  provider: anchor.Provider
): Promise<anchor.Program> {
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
async function setupQueue(program: anchor.Program): Promise<PublicKey> {
  const queueAccount = await sb.getDefaultQueue(
    program.provider.connection.rpcEndpoint
  );
  return queueAccount.pubkey;
}

/**
 * Setup Switchboard environment
 */

export async function setupSwitchboardEnvironment(
  connection: Connection,
  keypair: Keypair
): Promise<{ sbProgram: anchor.Program; queue: PublicKey }> {
  const provider = anchorProviderFromWallet(connection, keypair);
  const sbProgram = await loadSbProgram(provider);
  const queue = await setupQueue(sbProgram);

  return { sbProgram, queue };
}

/**
 * Create commit instruction for Switchboard
 */
export async function createCommitInstruction(
  randomness: sb.Randomness,
  queue: PublicKey
): Promise<anchor.web3.TransactionInstruction> {
  return randomness.commitIx(queue);
}

/**
 * Create reveal instruction for Switchboard
 */
export async function createRevealInstruction(
  randomness: sb.Randomness
): Promise<anchor.web3.TransactionInstruction> {
  return await retryWithBackoff(
    async () => {
      console.log("Creating reveal instruction...");
      return await randomness.revealIx();
    },
    5,
    1000
  );
}

// scripts/user-interactions_sol_and_spl.ts

// Set up axios timeout override BEFORE importing Switchboard modules
import axios from "axios";

// Override axios.create to ensure all instances use 7-second timeout
const originalCreate = axios.create;
axios.create = function (config = {}) {
  return originalCreate({
    timeout: 7000, // 7 seconds
    ...config,
  });
};

// Also set global default
axios.defaults.timeout = 7000;

import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  Connection,
  PublicKey,
  Commitment,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { GachaClient } from "./gacha-client";

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
  setupSwitchboardEnvironment,
  createCommitInstruction,
  createRevealInstruction,
} from "./sbUtils";
import * as sb from "@switchboard-xyz/on-demand";

/**
 * Create randomness account with retry logic
 */
async function createRandomnessAccount(
  connection: Connection,
  keypair: Keypair
): Promise<{ randomness: sb.Randomness }> {
  return await retryWithBackoff(
    async () => {
      console.log("🔄 Creating Switchboard randomness account...");

      const randomnessKp = Keypair.generate();
      console.log(
        `Created new randomness keypair: ${randomnessKp.publicKey.toBase58()}`
      );

      // Setup Switchboard environment to get the queue
      const { sbProgram, queue } = await setupSwitchboardEnvironment(
        connection,
        keypair
      );

      const [randomness, createIx] = await sb.Randomness.create(
        sbProgram,
        randomnessKp,
        queue
      );

      // Send the create randomness account transaction using handleTransaction
      const createSig = await handleTransaction(
        connection,
        [createIx],
        keypair,
        [randomnessKp, keypair]
      );

      console.log(
        `✅ Randomness account created: ${randomness.pubkey.toBase58()}`
      );
      console.log(`📝 Create transaction: ${createSig}`);
      return { randomness };
    },
    3,
    2000
  );
}

/**
 * Execute pull with Switchboard commit instruction
 */
async function executePullWithSwitchboard(
  connection: Connection,
  user: Keypair,
  client: GachaClient,
  paymentType: PaymentType,
  paymentMint: PublicKey,
  paymentConfig: PublicKey,
  userPaymentAccount: PublicKey,
  adminRecipientAccount: PublicKey,
  randomness: sb.Randomness,
  gachaState: any
): Promise<string> {
  console.log("🎯 Executing Switchboard commit and pull instructions together");

  // Setup Switchboard environment
  const { sbProgram, queue } = await setupSwitchboardEnvironment(
    connection,
    user
  );

  // Create commit instruction with retry logic
  console.log("🎲 Creating Switchboard commit instruction...");
  const commitIx = await createCommitInstruction(randomness, queue);
  console.log("✅ Commit instruction created successfully");

  // Get the pull instruction using the dedicated function
  const pullIx = await client.pullInstruction(
    user.publicKey,
    paymentType,
    paymentMint,
    paymentConfig,
    userPaymentAccount,
    adminRecipientAccount,
    randomness.pubkey
  );

  // const pullIx = await createPullInstruction(
  //   client.program,
  //   user.publicKey,
  //   paymentType,
  //   paymentMint,
  //   paymentConfig,
  //   userPaymentAccount,
  //   adminRecipientAccount,
  //   randomness.pubkey
  // );

  // Execute both commit and pull instructions in the same transaction
  const [pullTx, pullError] = await safeAsync(
    handleTransaction(connection, [commitIx, pullIx], user, [user])
  );

  if (pullError) {
    console.error(`❌ Pull failed:`, pullError);
    throw pullError;
  }

  console.log(`✅ Pull successful! Transaction: ${pullTx}`);
  return pullTx;
}

async function getPaymentDetails(
  user: Keypair,
  currency: string,
  config,
  connection: Connection
): Promise<{
  paymentMint: PublicKey;
  paymentAmount: number;
  paymentType: PaymentType;
  userPaymentAccount: PublicKey;
  isValid: boolean;
}> {
  let paymentMint: PublicKey;
  let paymentAmount: number;
  let paymentType: PaymentType;
  let userPaymentAccount: PublicKey;
  let isValid: boolean;

  // Determine payment type and get currency config
  if (currency.toLowerCase() === "sol") {
    paymentType = PaymentType.SOL;
    paymentMint = SystemProgram.programId; // System program ID for SOL
    paymentAmount = parseFloat(config.SOL?.cost || "0.1"); // Default 0.1 SOL

    // Validate SOL balance
    const solValidation = await validateSolBalance(
      connection,
      user,
      paymentAmount
    );
    userPaymentAccount = solValidation.userPaymentAccount;
    isValid = solValidation.isValid;
  } else {
    paymentType = PaymentType.SPL;
    let currencyConfig: any;
    let decimals: number;

    if (currency.toLowerCase() === "usdc") {
      currencyConfig = config.usdc;
      decimals = parseInt(currencyConfig.decimals || "6");
    } else if (currency.toLowerCase() === "usdt") {
      currencyConfig = config.usdt;
      decimals = parseInt(currencyConfig.decimals || "6");
    } else {
      throw new Error(
        `Unsupported currency: ${currency}. Supported: SOL, USDC, USDT`
      );
    }

    paymentMint = new PublicKey(currencyConfig.mint);
    paymentAmount = parseFloat(currencyConfig.cost);

    // Validate SPL token balance
    const splValidation = await validateSplBalance(
      connection,
      user,
      currency.toUpperCase(),
      paymentMint,
      paymentAmount,
      decimals
    );
    userPaymentAccount =
      splValidation.userPaymentAccount.address ||
      splValidation.userPaymentAccount;
    isValid = splValidation.isValid;
  }

  return {
    paymentMint,
    paymentAmount,
    paymentType,
    userPaymentAccount,
    isValid,
  };
}

/**
 * Main pull gacha function that supports both SOL and SPL payments
 */
export async function pullGacha(
  userPrivateKey: string,
  currency: string,
  network: string
): Promise<void> {
  // Convert private key to keypair
  const user = keypairFromPrivateKey(userPrivateKey);
  console.log(`\n🎲 ${user.publicKey.toBase58()} is pulling the gacha...`);
  console.log(`User wallet: ${user.publicKey.toBase58()}`);

  const config = getConfigurationFromNetwork(network);
  const { connection, program, client } = createAnchorProgramAndClient(
    network,
    user
  );

  const {
    paymentMint,
    paymentAmount,
    paymentType,
    userPaymentAccount,
    isValid,
  } = await getPaymentDetails(user, currency, config, connection);

  if (!isValid) {
    return;
  }

  // Get gacha state
  const [gachaState, gachaError] = await safeAsync(client.getGachaState());
  if (gachaError) {
    console.error(`❌ Failed to get gacha state:`, gachaError);
    throw gachaError;
  }

  // Get paymentConfig for this mint
  const paymentConfigPDA = client.findPaymentConfigPDA(paymentMint.toBase58());

  // Verify if this paymentConfig is present inside the gachaState
  const paymentConfigExists = gachaState.paymentConfigs.some(
    (config: any) => config.toString() === paymentConfigPDA.toString()
  );

  if (!paymentConfigExists) {
    throw new Error(
      `Payment method ${currency} not configured for this gacha machine`
    );
  }

  const { adminRecipientAccount } = await client.getPaymentConfig(
    paymentMint.toBase58()
  );

  // Create Switchboard randomness account
  const [randomnessResult, randomnessError] = await safeAsync(
    createRandomnessAccount(connection, user)
  );
  if (randomnessError) {
    console.error(`❌ Failed to create randomness account:`, randomnessError);
    throw randomnessError;
  }

  const { randomness } = randomnessResult;

  // Execute pull with Switchboard commit instruction
  const [pullTx, pullError] = await safeAsync(
    executePullWithSwitchboard(
      connection,
      user,
      client,
      paymentType,
      paymentMint,
      paymentConfigPDA,
      userPaymentAccount,
      new PublicKey(adminRecipientAccount),
      randomness,
      gachaState
    )
  );

  if (pullError) {
    console.error(`❌ Pull failed:`, pullError);
    throw pullError;
  }

  // Get current pull count for settle command
  const pullCount = new anchor.BN(gachaState.pullCount);

  console.log(`✅ Pull successful! Transaction: ${pullTx}`);
  console.log(
    `💰 ${paymentAmount} ${currency.toUpperCase()} transferred to admin account`
  );
  console.log(`🎫 Player state created. Use settle() to reveal your prize!`);
  console.log(`🔑 Randomness Account: ${randomness.pubkey.toBase58()}`);
  console.log(
    `💡 Save this randomness account address for settling with Switchboard!`
  );
  console.log(
    `📝 Settle command: npx ts-node user-interactions_sol_and_spl.ts settle "${userPrivateKey}" ${pullCount.toString()} ${randomness.pubkey.toBase58()}`
  );
}

/**
 * Settle gacha function
 */
async function settleGacha(
  userPrivateKey: string,
  nonce: string,
  randomnessAccountAddress: string,
  network: string
): Promise<void> {
  const user = keypairFromPrivateKey(userPrivateKey);
  console.log(`\n🎁 Settling gacha for user: ${user.publicKey.toBase58()}`);

  const { connection, program, client } = createAnchorProgramAndClient(
    network,
    user
  );

  const randomnessAccount = new PublicKey(randomnessAccountAddress);
  console.log(`🔑 Using randomness account: ${randomnessAccount.toBase58()}`);

  // Setup Switchboard environment for reveal
  const [sbResult, sbError] = await safeAsync(
    setupSwitchboardEnvironment(connection, user)
  );
  if (sbError) {
    console.error(`❌ Failed to setup Switchboard environment:`, sbError);
    throw sbError;
  }

  const { sbProgram } = sbResult;
  const randomness = new sb.Randomness(sbProgram as any, randomnessAccount);

  // Create reveal instruction with retry logic
  console.log("🔓 Creating Switchboard reveal instruction...");
  const [revealIx, revealError] = await safeAsync(
    createRevealInstruction(randomness)
  );
  if (revealError) {
    console.error(`❌ Failed to create reveal instruction:`, revealError);
    throw revealError;
  }
  console.log("✅ Reveal instruction created successfully");

  // Create settle instruction
  const [settleIx, settleIxError] = await safeAsync(
    createSettleInstruction(
      program,
      user.publicKey,
      new anchor.BN(nonce),
      randomnessAccount
    )
  );

  if (settleIxError) {
    console.error(`❌ Failed to create settle instruction:`, settleIxError);
    throw settleIxError;
  }

  // Send transaction with both reveal and settle instructions
  const [settleTx, settleError] = await safeAsync(
    handleTransaction(connection, [revealIx, settleIx], user, [user])
  );

  if (settleError) {
    console.error(`❌ Settle failed:`, settleError);
    throw settleError;
  }

  console.log(`✅ Settle successful! Transaction: ${settleTx}`);
}

/**
 * Creates the settle instruction for the gacha machine.
 */
async function createSettleInstruction(
  gachaProgram: any,
  userPublicKey: PublicKey,
  nonce: anchor.BN,
  randomnessAccount: PublicKey
): Promise<anchor.web3.TransactionInstruction> {
  const [gachaStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("gacha_state")],
    gachaProgram.programId
  );
  const [playerStatePDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("player_state"),
      userPublicKey.toBuffer(),
      nonce.toBuffer("le", 8),
    ],
    gachaProgram.programId
  );
  return await gachaProgram.methods
    .settle()
    .accountsPartial({
      playerState: playerStatePDA,
      gachaState: gachaStatePDA,
      user: userPublicKey,
      randomnessAccountData: randomnessAccount,
    })
    .instruction();
}

/**
 * Main function to handle CLI commands
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage:");
    console.log(
      "  Pull: npx ts-node user-interactions_sol_and_spl.ts pull <network> <currency> <private_key>"
    );
    console.log(
      "  Settle: npx ts-node user-interactions_sol_and_spl.ts settle <private_key> <nonce> <randomness_account> [network]"
    );
    console.log("");
    console.log("Examples:");
    console.log(
      "  npx ts-node user-interactions_sol_and_spl.ts pull devnet SOL 2k3u2Ksn8ztvx..."
    );
    console.log(
      "  npx ts-node user-interactions_sol_and_spl.ts pull devnet USDC 2k3u2Ksn8ztvx..."
    );
    console.log(
      "  npx ts-node user-interactions_sol_and_spl.ts pull devnet USDT 2k3u2Ksn8ztvx..."
    );
    console.log(
      "  npx ts-node user-interactions_sol_and_spl.ts settle 2k3u2Ksn8ztvx... 0 8xY... devnet"
    );
    return;
  }

  const command = args[0];

  try {
    if (command === "pull") {
      if (args.length < 4) {
        console.error(
          "❌ Pull command requires: network, currency, private_key"
        );
        return;
      }

      const [, privateKey, currency, network] = args;
      await pullGacha(privateKey, currency, network);
    } else if (command === "settle") {
      if (args.length < 4) {
        console.error(
          "❌ Settle command requires: private_key, nonce, randomness_account, [network]"
        );
        return;
      }

      const [, privateKey, nonce, randomnessAccount, network] = args;
      await settleGacha(privateKey, nonce, randomnessAccount, network);
    } else {
      console.error(`❌ Unknown command: ${command}`);
      console.log("Available commands: pull, settle");
    }
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

// Run main if this script is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Unhandled error:", error);
    process.exit(1);
  });
}

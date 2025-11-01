// lib/utils.ts
import * as CryptoJS from "crypto-js";
import * as anchor from "@coral-xyz/anchor";

import {
  Keypair,
  Connection,
  PublicKey,
  Commitment,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  mintTo,
  getMint,
} from "@solana/spl-token";
import bs58 from "bs58";

// IMPORT CONFIGURATION
import gachaIDL from "../target/idl/gacha_machine.json";
import { GachaMachine } from "../target/types/gacha_machine"; // Give it to Client
import { GachaClient } from "./gacha-client";

import sharedConfig from "../config/shared.json";
if (!sharedConfig) throw new Error("Missing Configuration File");

// Transaction options
const TX_OPTS = {
  commitment: "finalized" as Commitment,
  skipPreflight: false,
  maxRetries: 0,
};

// Payment type enum
export enum PaymentType {
  SOL = "SOL",
  SPL = "SPL",
}

/**
 * Utility function to wrap promises and return [data, null] on success or [null, error] on failure
 */
export async function safeAsync<T>(
  promise: Promise<T>
): Promise<[T | null, Error | null]> {
  try {
    const result = await promise;
    return [result, null];
  } catch (error) {
    return [null, error instanceof Error ? error : new Error(String(error))];
  }
}

/**
 * Encrypts a string using AES with a provided key.
 * @param text The string to encrypt (e.g., a URL).
 * @param key The secret encryption key.
 * @returns The Base64-encoded ciphertext.
 */
export function encryptWithKey(text: string, key: string): string {
  const ciphertext = CryptoJS.AES.encrypt(text, key).toString();
  console.log("ciphertext", ciphertext);
  return ciphertext;
}

/**
 * Decrypts an AES-encrypted string with a provided key.
 * @param ciphertext The Base64-encoded ciphertext.
 * @param key The secret encryption key used for encryption.
 * @returns The original decrypted string.
 */
export function decryptWithKey(ciphertext: string, key: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  const originalText = bytes.toString(CryptoJS.enc.Utf8);
  return originalText;
}

/**
 * Converts a private key string (base58 or hex) to a Keypair object.
 * @param privateKeyString The private key as a string (base58 encoded or hex)
 * @returns The Keypair object
 */
export function keypairFromPrivateKey(privateKeyString: string): Keypair {
  try {
    // Try to parse as hex string first (newer format)
    if (privateKeyString.length === 64) {
      // 64 character hex string (32 bytes * 2 chars per byte) - this is a seed, not full private key
      const seed = Buffer.from(privateKeyString, "hex");
      return Keypair.fromSeed(seed);
    }

    // Try to parse as base58 (Phantom wallet format - full 64-byte private key)
    const secretKey = bs58.decode(privateKeyString);
    return Keypair.fromSecretKey(secretKey);
  } catch {
    try {
      // Try to parse as array format (full 64-byte private key)
      const secretKeyArray = JSON.parse(privateKeyString);
      return Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
    } catch {
      throw new Error(`Invalid private key format. Supported formats:
        - 64-character hex string (32-byte seed, e.g., "572442716e8f532cdcd07ae52a3c15d0375e6f9ff21035e63f9bb72fab703b12")
        - Base58 string (64-byte private key, e.g., "2k3u2Ksn8ztvxkgU6T73reHVY7fAem7WNjxW1ycZZseuXaexkrhbbCfmnZKsUZS9vsob27QdiBTfVn8dyV3bTtHM")
        - JSON array format (64-byte private key, e.g., "[1,2,3,...]")`);
    }
  }
}

// Helper function to pause execution
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Helper to get RPC URL from network name
export const getConfigurationFromNetwork = (network: string) => {
  const programId = sharedConfig[network].programId;
  const encryptionKey = sharedConfig[network].encryptionKey;
  const rpcUrl = sharedConfig[network].rpcUrl;
  const SOL = sharedConfig[network].SOL;
  const usdt = sharedConfig[network].USDT;
  const usdc = sharedConfig[network].USDC;

  // console.log(
  //   "programId, encryptionKey,rpcUrl,SOL,usdt,usdc",
  //   programId,
  //   encryptionKey,
  //   rpcUrl,
  //   SOL,
  //   usdt,
  //   usdc
  // );

  return {
    programId,
    encryptionKey,
    rpcUrl,
    SOL,
    usdt,
    usdc,
  };
};

// Anchor provider from wallet and connection
export function anchorProviderFromWallet(
  connection: Connection,
  user: Keypair
): anchor.AnchorProvider {
  const wallet = {
    publicKey: user.publicKey,
    signTransaction: async (tx: any) => {
      tx.partialSign(user);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach((tx) => tx.partialSign(user));
      return txs;
    },
  };
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
}

// Helper to create anchor program and client
export function createAnchorProgramAndClient(
  network: string,
  user: Keypair
): {
  connection: Connection;
  program: anchor.Program;
  client: GachaClient;
} {
  const { rpcUrl, programId, encryptionKey } =
    getConfigurationFromNetwork(network);
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = anchorProviderFromWallet(connection, user);
  anchor.setProvider(provider);

  // Overwrite the address from the config
  gachaIDL.address = programId;
  const program = new anchor.Program(gachaIDL as GachaMachine, provider);
  const client = new GachaClient(
    program as unknown as anchor.Program<GachaMachine>,
    provider
  );

  return { connection, program, client };
}

/**
 * Enhanced transaction handler with retries and better error handling
 */
export async function handleTransaction(
  connection: Connection,
  instructions: anchor.web3.TransactionInstruction[],
  payer: Keypair,
  signers: Keypair[]
): Promise<string> {
  const tx = new anchor.web3.Transaction().add(...instructions);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = payer.publicKey;

  // Sign transaction
  tx.sign(...signers);

  // Send and confirm
  const rawTransaction = tx.serialize();
  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: TX_OPTS.skipPreflight || false,
    maxRetries: TX_OPTS.maxRetries || 0,
  });

  // Confirm transaction
  await connection.confirmTransaction({
    signature,
    ...(await connection.getLatestBlockhash()),
  });

  return signature;
}

/**
 * Retry wrapper with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (i === maxRetries) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, i);
      console.log(`Attempt ${i + 1} failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Validate user balance for SOL payments
 */
export async function validateSolBalance(
  connection: Connection,
  user: Keypair,
  requiredAmount: number
): Promise<{ userPaymentAccount: PublicKey; isValid: boolean }> {
  const balance = await connection.getBalance(user.publicKey);
  const requiredLamports = requiredAmount * LAMPORTS_PER_SOL;

  console.log(`User SOL Account: ${user.publicKey.toBase58()}`);
  console.log(`Current SOL balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  console.log(`Required SOL amount: ${requiredAmount} SOL`);

  const isValid = balance >= requiredLamports;

  if (!isValid) {
    console.log(
      `❌ Insufficient SOL balance. User needs at least ${requiredAmount} SOL to proceed.`
    );
    console.log("💡 You need to acquire SOL tokens to proceed.");
  }

  return { userPaymentAccount: user.publicKey, isValid };
}

/**
 * Validate user balance for SPL token payments
 */
export async function validateSplBalance(
  connection: Connection,
  user: Keypair,
  currency: string,
  paymentMint: PublicKey,
  requiredAmount: number,
  decimals: number
): Promise<{ userPaymentAccount: any; isValid: boolean }> {
  const userPaymentAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    user,
    paymentMint,
    user.publicKey
  );

  console.log(
    `User ${currency} Account: ${userPaymentAccount.address.toBase58()}`
  );
  console.log(
    `Current ${currency} balance: ${
      Number(userPaymentAccount.amount) / Math.pow(10, decimals)
    } ${currency}`
  );

  const requiredAmountWithDecimals = BigInt(
    requiredAmount * Math.pow(10, decimals)
  );
  const isValid = userPaymentAccount.amount >= requiredAmountWithDecimals;

  if (!isValid) {
    console.log(
      `❌ Insufficient ${currency} balance. User needs at least ${requiredAmount} ${currency} to proceed.`
    );
    console.log(`💡 You need to acquire ${currency} tokens to proceed.`);
  }

  return { userPaymentAccount, isValid };
}

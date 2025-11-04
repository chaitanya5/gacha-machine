// scripts/deploy.ts
import anchor from "@coral-xyz/anchor";
const { BN } = anchor;
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
} from "./utils.js";
// import { GachaClient } from "./gacha-client.js";
import urls from "../config/urls.json" with { type: 'json' };

async function addPaymentConfig(client, admin) {
  const { usdt, usdc, SOL } = getConfigurationFromNetwork(network);

  // Get current gacha state to check existing payment configs
  const currentGachaState = await client.getGachaState();

  // Add SOL, USDT, USDC
  const currencies = [SOL, usdt, usdc];
  for (const currency of currencies) {
    const paymentMint = new PublicKey(currency.mint);
    console.log(
      `Adding ${
        currency.ticker
      } with Mint: ${paymentMint.toBase58()} to Gacha Machine`
    );

    // Derive payment config PDA
    const [paymentConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("payment_config"),
        client.gachaStatePDA.toBuffer(),
        paymentMint.toBuffer(),
      ],
      client.program.programId
    );

    // Check if payment config already exists
    const paymentConfigExists = currentGachaState.paymentConfigs.some(
      (existingConfig) => existingConfig.toString() === paymentConfig.toString()
    );

    if (paymentConfigExists) {
      console.log(
        `Payment config for ${currency.ticker} already exists, skipping...`
      );
      continue;
    }

    try {
      let adminRecipientAccount;

      // Check if this is SOL payment (System Program ID)
      if (paymentMint.equals(SystemProgram.programId)) {
        // For SOL payments, use admin wallet directly
        adminRecipientAccount = admin.publicKey;
        console.log(
          `Admin SOL Account (Wallet): ${adminRecipientAccount.toBase58()}`
        );
      } else {
        // For SPL tokens, create/get associated token account
        const adminATAAccount = await getOrCreateAssociatedTokenAccount(
          client.provider.connection,
          admin,
          paymentMint,
          admin.publicKey
        );
        adminRecipientAccount = adminATAAccount.address;
        console.log(`Admin Token Account: ${adminRecipientAccount.toBase58()}`);
      }

      const paymentTx = await client.addPayment(
        admin,
        paymentConfig,
        paymentMint,
        new BN(
          parseFloat(currency.cost) * Math.pow(10, parseInt(currency.decimals))
        ),
        adminRecipientAccount
      );
      console.log(
        `Payment config for ${currency.ticker} successful! Tx: ${paymentTx}`
      );
    } catch (error) {
      console.error(
        `Failed to add payment config for ${currency.ticker}:`,
        error.message
      );
      console.log("Skipping this payment method and continuing...");
    }
  }
}

async function initializeInstruction(client, admin) {
  try {
    const gachaState = await client.getGachaState();
    console.log("Gacha machine already initialized.", gachaState);
  } catch (error) {
    const initTx = await client.initialize(
      admin
      // adminUsdtAccount.address,
      // pullPrice
    );
    console.log(`Initialization successful! Tx: ${initTx}`);
  }
}

async function populateKeys(client, admin, encryptionKey) {
  // --- CONFIGURATION ---
  // const URLS_FILE_PATH = path.join(__dirname, "../config/urls.json");
  // const urls = JSON.parse(await fs.readFile(URLS_FILE_PATH, "utf-8"));

  console.log(`Found ${urls.length} URLs to add.`);

  const currentState = await client.getGachaState();
  const existingEncryptedKeys = currentState.encryptedKeys;
  console.log(
    `${existingEncryptedKeys.length} keys already present in the contract.`
  );

  // Encrypt all URLs first
  const allEncryptedUrls = urls.map((url) =>
    encryptWithKey(url, encryptionKey)
  );

  console.log("existingEncryptedKeys", existingEncryptedKeys);
  console.log("allEncryptedUrls", allEncryptedUrls);

  // Filter out URLs that are already added to the gacha
  const keysToAdd = allEncryptedUrls.filter(
    (encryptedUrl) => !existingEncryptedKeys.includes(encryptedUrl)
  );

  console.log(
    `${keysToAdd.length} new keys to add out of ${urls.length} total URLs.`
  );

  // Add the filtered keys
  for (let i = 0; i < keysToAdd.length; i++) {
    const encryptedUrl = keysToAdd[i];
    const originalIndex = allEncryptedUrls.indexOf(encryptedUrl);

    console.log(
      `Adding key ${i + 1}/${keysToAdd.length} (original URL ${
        originalIndex + 1
      }): ${encryptedUrl}...`
    );
    try {
      const addKeyTx = await client.addKey(admin, encryptedUrl);
      console.log(` -> Success! Tx: ${addKeyTx}`);
    } catch (err) {
      console.error(` -> Failed to add key ${i + 1}:`, err.message);
      // Optional: break or continue on failure
    }

    // Avoid RPC rate limits on devnet
    await sleep(500); // 0.5 second delay
  }
}

async function main(adminPrivateKey, network) {
  // --- SETUP ---
  console.log("🚀 Starting deployment script...", adminPrivateKey, network);

  const { encryptionKey } = getConfigurationFromNetwork(network);
  const admin = keypairFromPrivateKey(adminPrivateKey);
  const { program, client } = createAnchorProgramAndClient(network, admin);

  // --- DEPLOY AND INITIALIZE ---
  console.log("\nStep 1: Initializing Gacha Machine...");
  await initializeInstruction(client, admin);

  // --- ADD PAYMENT CONFIG ---
  console.log(
    "\nStep 2: Adding USDT, USDC, SOL payment methods to the Gacha Machine..."
  );
  await addPaymentConfig(client, admin);

  // // --- POPULATE KEYS ---
  console.log("\nStep 3: Reading and encrypting URLs...");
  await populateKeys(client, admin, encryptionKey);

  // --- FINALIZE ---
  console.log("\nStep 3: Finalizing the Gacha Machine...");
  const finalState = await client.getGachaState();
  if (!finalState.isFinalized) {
    const finalizeTx = await client.finalize(admin);
    console.log(`Finalization successful! Tx: ${finalizeTx}`);
  } else {
    console.log("Gacha machine already finalized.");
  }

  console.log(
    "\n✅ Gacha Initialized,\n✅ Payment configuration added,\n✅ Encrypted Keys Populated, \n✅ Gacha Finalized!"
  );
}

// Pass admin private key and the network
const args = process.argv.slice(2);
const [adminPrivateKey, network] = args;

main(adminPrivateKey, network).catch((err) => {
  console.error(err);
  process.exit(1);
});

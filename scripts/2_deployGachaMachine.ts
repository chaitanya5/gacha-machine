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

async function createGachaMachine(
  client: GachaClient,
  admin: Keypair,
  gachaMachineCount: number
) {
  let gcmCount: anchor.BN;
  try {
    // Check if gacha machine is already initialized or not
    gcmCount = new anchor.BN(gachaMachineCount);
    const gachaState = await client.getGachaState(gcmCount);
    const gachaStatePDA = client.findGachaStatePDA(gcmCount);
    const metadataPDA = client.findMetadataPDAWithGachaCount(gcmCount);

    console.log(
      "Gacha Machine already initialized for this count at:",
      gachaStatePDA.toBase58()
    );
    console.log(
      "Gacha Metadata already initialized for this count at:",
      metadataPDA.toBase58()
    );
    console.log("Gacha Machine Details:", gachaState);
  } catch (error) {
    const initTx = await client.createGacha(admin);
    const gachaStatePDA = client.findGachaStatePDA(gcmCount);
    const metadataPDA = client.findMetadataPDAWithGachaCount(gcmCount);
    console.log("New Gacha Machine Initialized!:", gachaStatePDA.toBase58());
    console.log("New Gacha Metadata Initialized!:", metadataPDA.toBase58());
    console.log(`Gacha Machine Initialization successful! Tx: ${initTx}`);
  }
}

async function addPaymentConfig(
  client: GachaClient,
  admin: Keypair,
  gachaMachineCount: number
) {
  const { usdt, usdc, SOL } = getConfigurationFromNetwork(network);

  // Get current gacha state to check existing payment configs
  const gachaStatePDA = client.findGachaStatePDA(
    new anchor.BN(gachaMachineCount)
  );

  // Add SOL, USDT, USDC
  const currencies = [SOL, usdt, usdc];
  for (const currency of currencies) {
    const paymentMint = new PublicKey(currency.mint);
    console.log(
      `\nAdding ${
        currency.ticker
      } with Mint: ${paymentMint.toBase58()} to Gacha Machine`
    );

    let paymentConfigExists: boolean;
    let paymentConfig;

    try {
      paymentConfig = await client.getPaymentConfig(gachaStatePDA, paymentMint);
      paymentConfigExists = true;
    } catch (error) {
      paymentConfigExists = false;
    }

    if (paymentConfigExists) {
      console.log(
        `Payment config for ${currency.ticker} already exists, skipping...`
      );
      continue;
    }

    try {
      let adminRecipientAccount: PublicKey;

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
        new anchor.BN(gachaMachineCount),
        paymentMint,
        new anchor.BN(
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

async function getEncryptedUrlsData(client: GachaClient) {
  // --- CONFIGURATION ---
  const URLS_FILE_PATH = path.join(__dirname, "../config/urls.json");
  const urls: string[] = JSON.parse(await fs.readFile(URLS_FILE_PATH, "utf-8"));
  console.log(`Found ${urls.length} URLs to add.`);
  const BATCHSIZE = client.maxKeys;

  // If items less than BATCHSIZE, we don't need resizing the account
  const REPS = urls.length < BATCHSIZE ? 0 : Math.ceil(urls.length / BATCHSIZE);
  if (REPS > 10) {
    console.error(
      `Maximum ${BATCHSIZE * 10} elements allowed per Gacha Machine\n`
    );
    process.exit(1);
  }
  console.log(`Number of times we resize the metadata account: ${REPS}.`);
  return {
    urls,
    REPS,
  };
}

async function closeAllStates(
  client: GachaClient,
  admin: Keypair,
  gachaMachineCount: number
) {
  let gcmCount: anchor.BN;
  try {
    gcmCount = new anchor.BN(gachaMachineCount);
    const closeTx = await client.closeAllAccounts(admin, gcmCount);
    console.log(`All accounts closed to claim rent! Tx: ${closeTx}`);
  } catch (error) {
    console.error(`Failed to call the closeAll instruction`, error.message);
  }
}

async function resizeAndInitializeMetadataAccount(
  client: GachaClient,
  admin: Keypair,
  gachaMachineCount: number
) {
  const { urls, REPS } = await getEncryptedUrlsData(client);

  let gcmCount: anchor.BN;
  gcmCount = new anchor.BN(gachaMachineCount);

  try {
    console.log(
      `Gacha Metadata PDA: ${client.findMetadataPDAWithGachaCount(gcmCount)}`
    );

    for (let i = 0; i < REPS; i++) {
      const resizeTx = await client.resizeMetadata(admin, gcmCount);
      console.log(`Gacha Metadata Resize-> Success! Tx: ${resizeTx}`);
    }

    const initTx = await client.initializeMetadata(admin, gcmCount);
    console.log(`Gacha Metadata Initialization-> Success! Tx: ${initTx}`);
  } catch (error) {
    console.log(`Metadata Initialization Failed! Aborting !!`);
    process.exit(1);
  }
}

async function populateKeys(
  client: GachaClient,
  admin: Keypair,
  encryptionKey: string,
  gachaMachineCount: number
) {
  const { urls, REPS } = await getEncryptedUrlsData(client);
  const gcmCount = new anchor.BN(gachaMachineCount);

  const currentState = await client.getMetadataState(gcmCount);
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
    (encryptedUrl) =>
      !existingEncryptedKeys.includes(stringToNumberArray(encryptedUrl))
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
      const addKeyTx = await client.addKey(admin, gcmCount, encryptedUrl);
      console.log(` -> Success! Tx: ${addKeyTx}`);
    } catch (err) {
      console.error(` -> Failed to add key ${i + 1}:`, err.message);
      // Optional: break or continue on failure
    }

    // Avoid RPC rate limits on devnet
    await sleep(500); // 0.5 second delay
  }
}

const stringToUint8Array = (text: string): Uint8Array => {
  return new TextEncoder().encode(text);
};

const stringToNumberArray = (text: string): number[] => {
  return Array.from(new TextEncoder().encode(text));
};

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

  // --- INITIALIZE NEW GACHA MACHINE ---
  console.log("\nStep 1: Initializing Gacha Machine...\n");
  const gachaStatePDA = await createGachaMachine(
    client,
    admin,
    gachaMachineCount as unknown as number
  );

  // --- ADD PAYMENT CONFIG ---
  console.log("\nStep 2: Adding payment methods to the Gacha Machine...");
  await addPaymentConfig(client, admin, gachaMachineCount as unknown as number);

  // // --- INITIALIZE METADATA ACCOUNTS ---
  // await resizeAndInitializeMetadataAccount(
  //   client,
  //   admin,
  //   gachaMachineCount as unknown as number
  // );

  // -- CLOSE ALL ACCOUNTS ---
  await closeAllStates(client, admin, gachaMachineCount as unknown as number);

  // // // --- POPULATE KEYS ---
  // console.log("\nStep 3: Reading and encrypting URLs...");
  // await populateKeys(
  //   client,
  //   admin,
  //   encryptionKey,
  //   gachaMachineCount as unknown as number
  // );

  // // --- FINALIZE ---
  // console.log("\nStep 3: Finalizing the Gacha Machine...");
  // const finalState = await client.getGachaState();
  // if (!finalState.isFinalized) {
  //   const finalizeTx = await client.finalize(admin);
  //   console.log(`Finalization successful! Tx: ${finalizeTx}`);
  // } else {
  //   console.log("Gacha machine already finalized.");
  // }

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

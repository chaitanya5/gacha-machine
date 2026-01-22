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
  gachaMachineCount: anchor.BN
) {
  try {
    // Check if gacha machine is already initialized or not
    const gachaState = await client.getGachaState(gachaMachineCount);
    const gachaStatePDA = client.findGachaStatePDA(gachaMachineCount);
    const metadataPDA = client.findMetadataPDAWithGachaCount(gachaMachineCount);

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
    const gachaStatePDA = client.findGachaStatePDA(gachaMachineCount);
    const metadataPDA = client.findMetadataPDAWithGachaCount(gachaMachineCount);
    console.log("New Gacha Machine Initialized!:", gachaStatePDA.toBase58());
    console.log("New Gacha Metadata Initialized!:", metadataPDA.toBase58());
    console.log(`Gacha Machine Initialization successful! Tx: ${initTx}`);
  }
}

async function addPaymentConfig(
  client: GachaClient,
  admin: Keypair,
  gachaMachineCount: anchor.BN
) {
  const { usdt, usdc, SOL } = getConfigurationFromNetwork(network);

  // Get current gacha state to check existing payment configs
  const gachaStatePDA = client.findGachaStatePDA(gachaMachineCount);

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
        gachaMachineCount,
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

async function resizeAndInitializeMetadataAccount(
  client: GachaClient,
  admin: Keypair,
  gachaMachineCount: anchor.BN
) {
  const metadataPDA = client.findMetadataPDAWithGachaCount(gachaMachineCount);

  try {
    await client.getMetadataState(gachaMachineCount);
    console.log(
      "Gacha Metadata already initialized for this count at:",
      metadataPDA.toBase58()
    );
  } catch (error) {
    try {
      console.log(`Initializing Gacha Metadata PDA: ${metadataPDA.toBase58()}`);

      // Starting from 1 (runs 9 times) because account already has 10 * 1024 when created
      for (let i = 1; i < 10; i++) {
        console.log(`Resizing ${i} of ${10 - 1} times`);
        const resizeTx = await client.resizeMetadata(
          admin,
          gachaMachineCount,
          10 * 1024 * (i + 1)
        );
        console.log(`Gacha Metadata Resize-> Success! Tx: ${resizeTx}`);
      }

      const initTx = await client.initializeMetadata(admin, gachaMachineCount);
      console.log(`Gacha Metadata Initialization-> Success! Tx: ${initTx}`);
    } catch (error) {
      console.log(`Metadata Initialization Failed! Aborting !!`, error);
      process.exit(1);
    }
  }
}

async function populateKeys2(
  client: GachaClient,
  admin: Keypair,
  encryptionKey: string,
  gachaMachineCount: anchor.BN
) {
  const { urls, REPS } = await getEncryptedUrlsData(client);
  const currentState = await client.getMetadataState(gachaMachineCount);

  const BATCH_SIZE = 50;

  for (let batchStart = 0; batchStart < urls.length; batchStart += BATCH_SIZE) {
    const batch = urls.slice(batchStart, batchStart + BATCH_SIZE);
    console.log(
      `Adding keys ${batchStart} to ${batchStart + batch.length - 1}`
    );
    await client.addKeys(admin, gachaMachineCount, batch);
  }
}
// async function populateKeys(
//   client: GachaClient,
//   admin: Keypair,
//   encryptionKey: string,
//   gachaMachineCount: anchor.BN
// ) {
//   const { urls, REPS } = await getEncryptedUrlsData(client);

//   const currentState = await client.getMetadataState(gachaMachineCount);
//   const existingEncryptedKeys = currentState.encryptedKeys;
//   // const existingEncryptedKeys = currentState.encryptedKeys.map((key) =>
//   //   bytesArrayToString(key)
//   // );
//   console.log(
//     `${existingEncryptedKeys.length} keys already present in the contract.`
//   );

//   const existingEncryptedKeysCL = currentState.encryptedKeys.map((key) =>
//     bytesArrayToString(key)
//   );
//   existingEncryptedKeysCL.forEach((key) => console.log(key + "\n"));

//   // console.log(
//   //   existingEncryptedKeysmap((key) => bytesArrayToString(key)) + "\n"
//   // );

//   // Encrypt all URLs first
//   const allEncryptedUrls = urls.map((url) =>
//     encryptWithKey(url, encryptionKey)
//   );

//   // console.log("existingEncryptedKeys", existingEncryptedKeys);
//   console.log("allEncryptedUrls", allEncryptedUrls);

//   // Filter out URLs that are already added to the gacha
//   const keysToAdd = allEncryptedUrls.filter(
//     (encryptedUrl) =>
//       !existingEncryptedKeys.includes(stringToNumberArray(encryptedUrl))
//   );

//   console.log(
//     `${keysToAdd.length} new keys to add out of ${urls.length} total URLs.`
//   );
//   await sleep(10000); // 0.5 second delay

//   // Add the filtered keys
//   for (let i = 0; i < keysToAdd.length; i++) {
//     const encryptedUrl = keysToAdd[i];
//     const originalIndex = allEncryptedUrls.indexOf(encryptedUrl);

//     console.log(
//       `Adding key ${i + 1}/${keysToAdd.length} (original URL ${
//         originalIndex + 1
//       }): ${encryptedUrl}...`
//     );
//     try {
//       const addKeyTx = await client.addKey(
//         admin,
//         gachaMachineCount,
//         encryptedUrl
//       );
//       console.log(` -> Success! Tx: ${addKeyTx}`);
//     } catch (err) {
//       console.error(` -> Failed to add key ${i + 1}:`, err);
//       // Optional: break or continue on failure
//     }

//     // Avoid RPC rate limits on devnet
//     await sleep(100); // 0.5 second delay
//   }
// }

const bytesArrayToString = (bytes: number[]): string => {
  return Buffer.from(bytes).toString("utf8");
};

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

  const gcmCount = new anchor.BN(gachaMachineCount);

  // --- INITIALIZE NEW GACHA MACHINE ---
  console.log("\nStep 1: Initializing Gacha Machine...\n");
  const gachaStatePDA = await createGachaMachine(client, admin, gcmCount);

  // // --- ADD PAYMENT CONFIG ---
  // console.log("\nStep 2: Adding payment methods to the Gacha Machine...");
  await addPaymentConfig(client, admin, gcmCount);

  // --- INITIALIZE METADATA ACCOUNTS ---
  await resizeAndInitializeMetadataAccount(client, admin, gcmCount);

  // --- POPULATE KEYS ---
  // console.log("\nStep 3: Reading and encrypting URLs...");
  // await populateKeys2(client, admin, encryptionKey, gcmCount);

  // --- FINALIZE ---
  // console.log("\nStep 3: Finalizing the Gacha Machine...");
  // const finalState = await client.getGachaState(gcmCount);
  // if (!finalState.isFinalized) {
  //   const finalizeTx = await client.finalize(admin, gcmCount);
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

// U2FsdGVkX1+xiioqIhv3NtcsyDlqEOWCCbgvSMC3t89ra5cM8VtwHigpjUh0+NcIVaD1XEmAPPuQkTkZY40RKA==

// U2FsdGVkX18WwSz4UHggpL50e4RTzwwXUdGaXIcEmX7MfjXsKhEJhAsSvGo+z5rLkxwavfhR1FZgOFVUuOqpHw==

// U2FsdGVkX1/me7NZsToGEaMPqAji03oH84kqDxPfZOqopGSlOVK0Lapl9RqsMcFLv+rA3mJqaWKpQXS6l6A9ug==

// U2FsdGVkX1++NhR34/WbhL+LI51gK1B0M5f3b/f5/lmZoP6vOR8ct9xXC7Hk63tAy/FGwPc90ovUO0FeWhTvIQ==

// U2FsdGVkX1/9C6Di5ToO5EIKTFpOKKOBe2GXwOcm/PceMzEhJxcjQCE0p3C5XrRvG8WeAlCEr25cPS19HQOVxw==

// U2FsdGVkX18u7CAGXmz+ZmYyHWs86qL/pnApV3N+DysBgjd0jQuXw6XD/pcuiUZZY2qL0tJvhVndn4ps/aBEGQ==

// U2FsdGVkX1/WoS9pUdSeutHZMlRBHXYdBQgoHDSj6Bl2VH62Pw2Pv9YMYQm592ikv5wCk+gHb1S3ZQgOgqNf2g==

// U2FsdGVkX198nhlucCiOSIVW9AM0VkV27wWy1iBY6Y8RX2yLjHC5GU0mP+GTOJcoEokcFDimsEXIqFmNT5/xhQ==

// llEncryptedUrls [
//   'U2FsdGVkX199RowgHi0drFjEpHiqGWhJIoVnKGCafkkgegyuxYmL1HiqfXbxl2kQSfMVeu6CyTY9jsSO3FKu/w==',
//   'U2FsdGVkX1/jtI8PptKbyOuKAsSk48lC05d9Gut5Uv0f/N1Uw4fDz+laNXVhIR+XFLjBGj6KiObFrV5dzFzwsw==',
//   'U2FsdGVkX19uGHu6P1B/wJHp2buW//VDrjXKVx9cbh+vDkTyUPtQpgGr4SyTFx/wdKtJArYerwq+Ag1r36nK0Q==',
//   'U2FsdGVkX1/0pPzwm4PiNCbOK2Xj6BS+U0lhuzlksdKrMks9uQW2FcMlKrd4atzZOgfXhowqzkIH5sTC/9w/Gw==',
//   'U2FsdGVkX18fnBcLrEVPPGP6aqYxBZSzhZckb5PrHJERQAYFi4idfyZW5sIlE5XRmDXlOBOFUNZ9fHjkHgYSqA==',
//   'U2FsdGVkX19vo0u3PCXRmajc55ruHdYy3hLlblOJIUPS225SN/yhAfcZ1Ka1MVMWZDVuKpqG9TqKltxlQhhU8w==',
//   'U2FsdGVkX19h83IetA2zx+2dX2jYxJgpLHR8+8iFI4wzG3jB6cW4V/qTS4dVFAV1rK7QE6noHRI8CzhJW2J34A==',
//   'U2FsdGVkX19vMXlxTLVCsPZkcObSpaz5Xbz+yHnTji18PCUUOIfJfYeEPPUXj66kgs27siuFeaTjgpVzLw6OAg=='
// ]
// 8 new keys to add out of 8 total URLs.
// ^C

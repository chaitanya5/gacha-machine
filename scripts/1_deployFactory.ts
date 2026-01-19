import { Keypair } from "@solana/web3.js";
import {
  getConfigurationFromNetwork,
  keypairFromPrivateKey,
  createAnchorProgramAndClient,
} from "./utils";
import { GachaClient } from "./gacha-client";

async function initializeFactory(client: GachaClient, admin: Keypair) {
  try {
    // Check if factory is already initialized or not
    const gachaFactory = await client.getGachaFactoryState();
    const gachaFactoryPDA = client.gachaFactoryPDA;
    console.log(
      "Gacha Factory already initialized for this program at:",
      gachaFactoryPDA.toBase58()
    );
    console.log("Gacha Factory Details:", gachaFactory);
  } catch (error) {
    const initTx = await client.initializeFactory(admin);
    const gachaFactoryPDA = client.gachaFactoryPDA;
    console.log("New Factory Initialized!:", gachaFactoryPDA.toBase58());
    console.log(`Factory Initialization successful! Tx: ${initTx}`);
  }
}

async function main(adminPrivateKey: string, network: string) {
  // --- SETUP ---
  console.log("🚀 Starting deployment script...");

  const { encryptionKey } = getConfigurationFromNetwork(network);
  const admin = keypairFromPrivateKey(adminPrivateKey);
  const { program, client } = createAnchorProgramAndClient(network, admin);

  // --- INITIALIZE FACTORY ---
  console.log("\nStep 1: Initializing Gacha Factory...");
  await initializeFactory(client, admin);

  console.log("\n✅ Gacha Factory Initialized!");
}

// Pass admin private key and the network
const args = process.argv.slice(2);
const [adminPrivateKey, network] = args;

main(adminPrivateKey, network).catch((err) => {
  console.error(err);
  process.exit(1);
});

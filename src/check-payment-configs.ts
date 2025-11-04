// scripts/check-payment-configs.ts
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createAnchorProgramAndClient,
  keypairFromPrivateKey,
} from "./utils.js";

async function checkPaymentConfigs(network: string) {
  const dummyKeypair = Keypair.generate();
  const { client } = createAnchorProgramAndClient(network, dummyKeypair);

  try {
    const state = await client.getGachaState();
    console.log(
      "Payment configs PDAs:",
      state.paymentConfigs.map((p: any) => p.toString())
    );

    for (const configPda of state.paymentConfigs) {
      try {
        const config = await client.program.account.paymentConfig.fetch(
          configPda
        );
        console.log(`Config ${configPda}:`);
        console.log(`  - mint: ${config.mint}`);
        console.log(`  - price: ${config.price}`);
        console.log(`  - admin recipient: ${config.adminRecipientAccount}`);
        console.log("");
      } catch (e: any) {
        console.log(`Failed to fetch config ${configPda}: ${e.message}`);
      }
    }
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

const args = process.argv.slice(2);
const [network] = args;

checkPaymentConfigs(network).catch(console.error);

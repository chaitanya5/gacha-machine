// scripts/check-payment-configs.ts
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createAnchorProgramAndClient,
  keypairFromPrivateKey,
  getConfigurationFromNetwork,
} from "./utils";

async function checkPaymentConfigs(
  gachaMachineCount: anchor.BN,
  network: string
) {
  const dummyKeypair = Keypair.generate();
  const { client } = createAnchorProgramAndClient(network, dummyKeypair);

  try {
    const state = await client.getGachaState(gachaMachineCount);
    // console.log(
    //   "Payment configs PDAs:",
    //   state.paymentConfigs.map((p: any) => p.toString())
    // );
    const { usdt, usdc, SOL } = getConfigurationFromNetwork(network);

    // Get current gacha state to check existing payment configs
    const gachaStatePDA = client.findGachaStatePDA(gachaMachineCount);

    // Add SOL, USDT, USDC
    const currencies = [SOL, usdt, usdc];
    for (const currency of currencies) {
      const paymentMint = new PublicKey(currency.mint);

      const paymentConfigPDA = client.findPaymentConfigPDA(
        gachaStatePDA,
        paymentMint
      );
      let paymentConfig;

      try {
        paymentConfig = await client.getPaymentConfig(
          gachaStatePDA,
          paymentMint
        );
        console.log(`Payment Config PDA ${paymentConfigPDA.toBase58()}:`);
        console.log(`  - mint: ${paymentConfig.mint}`);
        console.log(`  - price: ${paymentConfig.price}`);
        console.log(
          `  - admin recipient: ${paymentConfig.adminRecipientAccount}`
        );
        console.log("");
      } catch (error) {
        console.log(
          `PaymentConfig for ${paymentConfigPDA.toBase58()} not yet initialized`
        );
      }
    }
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

const args = process.argv.slice(2);
const [gachaMachineCount, network] = args;

checkPaymentConfigs(new anchor.BN(gachaMachineCount), network).catch(
  console.error
);

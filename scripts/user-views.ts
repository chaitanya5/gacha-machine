// scripts/user-views-no-anchor.ts
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createAnchorProgramAndClient,
  decryptWithKey,
  getConfigurationFromNetwork,
} from "./utils";

async function viewGachaState(network: string) {
  console.log(`\n📊 Viewing Gacha State...`);

  const dummyKeypair = Keypair.generate();
  const { client } = createAnchorProgramAndClient(network, dummyKeypair);

  try {
    const gachaState = await client.getGachaState();
    console.log("=== GACHA STATE ===", gachaState);

    console.log("=== GACHA STATE ===");
    console.log(`🏛️  Gacha State Address: ${client.gachaStatePDA.toBase58()}`);
    console.log(`👑 Admin: ${gachaState.admin}`);
    console.log(`🎯 Total Pulls: ${Number(gachaState.pullCount)}`);
    console.log(`🎯 Total Settles: ${Number(gachaState.settleCount)}`);
    console.log(`🔒 Is Finalized: ${gachaState.isFinalized}`);
    console.log(`🗝️  Total Encrypted Keys: ${gachaState.encryptedKeys.length}`);
    console.log(`🏗️  Bump: ${gachaState.bump}`);

    if (gachaState.encryptedKeys.length > 0) {
      console.log(
        `\n📝 All Encrypted Keys (${gachaState.encryptedKeys.length} total):`
      );
      for (let i = 0; i < gachaState.encryptedKeys.length; i++) {
        const key = gachaState.encryptedKeys[i];
        console.log(`   ${i + 1}. ${key}`);
      }
    }

    if (gachaState.remainingIndices && gachaState.remainingIndices.length > 0) {
      console.log(
        `\n🔢 All Remaining Indices (${gachaState.remainingIndices.length} total):`
      );
      console.log(`   [${gachaState.remainingIndices.join(", ")}]`);
    }

    return gachaState;
  } catch (error) {
    console.error(`❌ Failed to get gacha state:`, error);
  }
}

async function viewPlayerState(
  userPublicKey: string,
  nonce?: number,
  network: string = "mainnet"
) {
  console.log(`\n👤 Viewing Player State...`);

  // Parse public key
  const user = new PublicKey(userPublicKey);
  console.log(`User wallet: ${user.toBase58()}`);

  const dummyKeypair = Keypair.generate();
  const { connection, program, client } = createAnchorProgramAndClient(
    network,
    dummyKeypair
  );
  let playerState;
  try {
    if (nonce !== undefined) {
      // View specific player state by nonce
      const [playerStatePDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player_state"),
          user.toBuffer(),
          new anchor.BN(nonce).toBuffer("le", 8),
        ],
        client.program.programId
      );

      console.log(`🔍 Looking for player state with nonce: ${nonce}`);
      console.log(`📍 Player State PDA: ${playerStatePDA.toBase58()}`);

      try {
        // Use the gacha client's getPlayerState method
        playerState = await client.getPlayerState(user, new anchor.BN(nonce));

        console.log("\n=== PLAYER STATE ===");
        console.log(`👤 User: ${playerState.user}`);
        console.log(`🎲 Nonce: ${playerState.nonce.toString()}`);
        console.log(`🔗 Gacha State: ${playerState.gachaState}`);
        console.log(`🔗 Randomness Account: ${playerState.randomnessAccount}`);
        console.log(`🔗 Payment Mint: ${playerState.paymentMint}`);
        console.log(`🎯 Is Settled: ${playerState.isSettled}`);
        console.log(`🏗️  Bump: ${playerState.bump}`);
        console.log(`🎰 Pull Slot: ${playerState.pullSlot.toString()}`);
        console.log(`🎲 Result Index: ${playerState.resultIndex}`);

        if (playerState.isSettled) {
          console.log(
            `🎉 Prize unlocked! The encrypted key was emitted as an event during settle.`
          );
          console.log(
            `💡 Check the settle transaction logs for the encrypted key, then use:`
          );
          console.log(
            `    npx ts-node user-views-no-anchor.ts decrypt <encryptedKey>`
          );
        } else {
          console.log(
            `⏳ Prize not yet revealed. Use settle command to reveal.`
          );
          console.log(
            `💡 Run: npx ts-node user-interaction.ts settle "<privateKey>" ${playerState.nonce.toString()}`
          );
        }
      } catch (fetchError) {
        console.error("❌ Failed to fetch player state:", fetchError);
        console.log("This pull may not exist or hasn't been created yet.");
      }
    } else {
      // Search for all player states for this user
      console.log("🔍 Searching for all player states for this user...");

      // Get current gacha state to know the pull count range
      const gachaState = await client.getGachaState();
      const totalPulls = gachaState.pullCount;

      console.log(`📊 Checking nonces 0 to ${totalPulls - 1}...`);

      let foundStates = 0;

      for (let i = 0; i < totalPulls; i++) {
        const playerStatePDA = client.findPlayerStatePDA(
          user,
          new anchor.BN(i)
        );

        try {
          // Use the gacha client's getPlayerState method
          playerState = await client.getPlayerState(user, new anchor.BN(i));

          if (foundStates === 0) {
            console.log("\n=== FOUND PLAYER STATES ===");
          }
          foundStates++;

          console.log(`\n${foundStates}. Nonce ${i}:`);
          console.log(`   🔗 Gacha State: ${playerState.gachaState}`);
          console.log(`   📍 PDA: ${playerStatePDA.toBase58()}`);
          console.log(`   🎯 Is Settled: ${playerState.isSettled}`);
          console.log(`   🎲 Result Index: ${playerState.resultIndex}`);
          console.log(`   🎲 Nonce: ${playerState.nonce.toString()}`);
          console.log(
            `   🔗 Randomness Account: ${playerState.randomnessAccount}`
          );
          console.log(`   🔗 Payment Mint: ${playerState.paymentMint}`);
          console.log(`   🏗️  Bump: ${playerState.bump}`);

          if (playerState.isSettled) {
            console.log(
              `   🎉 Prize: Revealed (check settle transaction logs)`
            );
          } else {
            console.log(`   ⏳ Prize: Not yet revealed`);
          }
        } catch (error) {
          // Silently skip if account doesn't exist or can't be decoded
        }
      }

      if (foundStates === 0) {
        console.log("❌ No player states found for this user.");
        console.log("💡 This user hasn't made any gacha pulls yet.");
      } else {
        console.log(`\n✅ Found ${foundStates} player state(s) for this user.`);
        console.log(
          `💡 Use 'npx ts-node user-views-no-anchor.ts playerstate <publicKey> <nonce>' to view details of a specific pull.`
        );
      }
    }

    return playerState;
  } catch (error) {
    console.error(`❌ Failed to get player state:`, error);
  }
}

async function decryptPrize(
  encryptedKey: string,
  encryptionKey: string
): Promise<void> {
  console.log(`\n🔓 Decrypting Prize...`);

  try {
    const decryptedUrl = decryptWithKey(encryptedKey, encryptionKey);
    console.log(`🎉 Your prize: ${decryptedUrl}`);
  } catch (error) {
    console.error(`❌ Decryption failed:`, error);
  }
}

// Export functions for use in other scripts
export { viewGachaState, viewPlayerState };

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "gachastate":
    case "gacha":
      const [, gachaNetwork] = args;
      await viewGachaState(gachaNetwork);
      break;

    case "playerstate":
    case "player":
      if (args.length < 2) {
        console.log(
          "Usage: npx ts-node user-views.ts playerstate <publicKey> [nonce] [network]"
        );
        console.log("  - Without nonce: Shows all player states for the user");
        console.log(
          "  - With nonce: Shows specific player state for that pull"
        );
        console.log("  - Network: mainnet (default) or devnet");
        return;
      }
      const [, publickey, arg2, arg3] = args;

      // Determine if arg2 is a nonce (number) or network (string)
      let parsedNonce: number | undefined;
      let playerNetwork: string;

      if (arg2 && !isNaN(parseInt(arg2))) {
        // arg2 is a nonce
        parsedNonce = parseInt(arg2);
        playerNetwork = arg3 || "mainnet";
      } else {
        // arg2 is a network or undefined
        parsedNonce = undefined;
        playerNetwork = arg2 || "mainnet";
      }

      await viewPlayerState(publickey, parsedNonce, playerNetwork);
      break;

    case "decrypt":
      if (args.length < 2) {
        console.log(
          "Usage: npx ts-node user-views.ts decrypt <encryptedKey> <encryptionKey>"
        );
        return;
      }
      const [, encryptedKey, encryptionKey] = args;
      await decryptPrize(encryptedKey, encryptionKey);
      break;

    default:
      console.log("🔍 Gacha Machine Account Viewer");
      console.log("\nAvailable commands:");
      console.log("- gachastate (or gacha): View the main gacha state account");
      console.log(
        "- playerstate <publicKey> [nonce] (or player): View player state(s)"
      );
      console.log("  Without nonce: Shows all pulls for the user");
      console.log("  With nonce: Shows specific pull details");
      console.log("- decrypt <encryptedKey>: Decrypt a prize key");
      console.log("\nExamples:");
      console.log("  npx ts-node user-views.ts gachastate devnet");
      console.log(
        '  npx ts-node user-views.ts playerstate "FmGZkU9f1tqBRy1VxCMkERpJCT8Q4N5QyRwTkQb6CHzH" mainnet'
      );
      console.log(
        '  npx ts-node user-views.ts playerstate "FmGZkU9f1tqBRy1VxCMkERpJCT8Q4N5QyRwTkQb6CHzH" 0 devnet'
      );
      console.log(
        '  npx ts-node user-views.ts decrypt "your-encrypted-key-here" mainnet'
      );
      break;
  }
}

// Run CLI if this script is executed directly
if (require.main === module) {
  main().catch(console.error);
}

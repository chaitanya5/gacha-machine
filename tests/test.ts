import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GachaMachine } from "../target/types/gacha_machine";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { createMint, createAccount, mintTo } from "@solana/spl-token";

describe("gacha-machine", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.GachaMachine as Program<GachaMachine>;

  // Test Accounts
  let admin: Keypair;
  let user: Keypair;

  let gachaFactory: PublicKey;
  let gachaState: PublicKey;
  let metadata: PublicKey;
  let gachaFactoryAccount;
  let gachaStateAccount;
  let metadataAccount;

  let adminLamports;
  let MAX_KEYS = 1000;

  before(async () => {
    // Initialize test accounts
    admin = Keypair.generate();
    user = Keypair.generate();

    // Airdrop SOL to test accounts
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        admin.publicKey,
        10 * LAMPORTS_PER_SOL
      )
    );

    adminLamports = await provider.connection.getBalance(admin.publicKey);
    console.log("adminLamports airdropped", adminLamports);

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user.publicKey,
        10 * LAMPORTS_PER_SOL
      )
    );

    // Derive PDA for gacha factory
    [gachaFactory] = PublicKey.findProgramAddressSync(
      [Buffer.from("gacha_factory")],
      program.programId
    );
  });

  describe("factory initialization", () => {
    it("should initialize gacha factory successfully", async () => {
      await program.methods
        .initializeGachaFactory()
        .accountsPartial({
          gachaFactory,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      const gachaFactoryAccount = await program.account.gachaFactory.fetch(
        gachaFactory
      );

      expect(gachaFactoryAccount.admin.toString()).to.equal(
        admin.publicKey.toString()
      );
      expect(gachaFactoryAccount.gachaCount).to.equal(0);
    });
  });

  describe("machine and metadata initialization", () => {
    it("should create and resize a gacha machine successfully", async () => {
      gachaFactoryAccount = await program.account.gachaFactory.fetch(
        gachaFactory
      );

      [gachaState] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("gacha_state"),
          gachaFactory.toBuffer(),
          new anchor.BN(gachaFactoryAccount.gachaCount).toBuffer("le", 4),
        ],
        program.programId
      );

      [metadata] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          gachaFactory.toBuffer(),
          gachaState.toBuffer(),
        ],
        program.programId
      );

      // 1. Create the gacha machine and the small metadata account
      await program.methods
        .createGacha()
        .accounts({
          gachaFactory,
          gachaState,
          metadata,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      // Verify the initial small size
      let metadataAccountInfo = await provider.connection.getAccountInfo(
        metadata
      );
      console.log("initialAccountInfo", metadataAccountInfo.data.length);
      expect(metadataAccountInfo.data.length).to.equal(10240);

      // 2. Resize the metadata account to its full size
      // Starting from 1 (runs 9 times) because account already has 10 * 1024 when created
      for (let i = 1; i < 10; i++) {
        await program.methods
          .resizeMetadata(10 * 1024 * (i + 1))
          .accountsPartial({
            gachaFactory,
            gachaState,
            metadata,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        // Verify the initial small size
        metadataAccountInfo = await provider.connection.getAccountInfo(
          metadata
        );
        console.log("metadataAccountInfo", i, metadataAccountInfo.data.length);
      }

      // Verify the initial small size
      metadataAccountInfo = await provider.connection.getAccountInfo(metadata);
      console.log("metadataAccountInfo", metadataAccountInfo.data.length);

      // 1. Initialize the metadata account
      await program.methods
        .initializeMetadata()
        .accountsPartial({
          gachaFactory,
          gachaState,
          metadata,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      // Fetch and verify final state
      gachaStateAccount = await program.account.gachaState.fetch(gachaState);
      expect(gachaStateAccount.gachaFactory.toString()).to.equal(
        gachaFactory.toString()
      );

      metadataAccount = await program.account.gachaMachineMetadata.fetch(
        metadata
      );
      // console.log("metadataAccount", metadataAccount);
      expect(metadataAccount.gachaState.toString()).to.equal(
        gachaState.toString()
      );

      // Verify the final resized account
      metadataAccountInfo = await provider.connection.getAccountInfo(metadata);

      console.log("metadata account size", metadataAccountInfo);
      // const expectedSize = 8 + 10344; // 8 for discriminator + struct size
      // expect(metadataAccountInfo.data.length).to.equal(expectedSize);
    });
    it("should add keys into the gacha metadata account and finalize the gacha machine", async () => {
      const BATCH_SIZE = 50;
      const keys: string[] = [];
      for (let i = 0; i < MAX_KEYS; i++) {
        keys.push(`key${i}`);
      }

      // for (let i = 0; i < MAX_KEYS; i++) {
      //   if (i % 100 === 0) console.log(`${i} keys added`);
      for (
        let batchStart = 0;
        batchStart < keys.length;
        batchStart += BATCH_SIZE
      ) {
        const batch = keys.slice(batchStart, batchStart + BATCH_SIZE);
        console.log(
          `Adding keys ${batchStart} to ${batchStart + batch.length - 1}`
        );

        await program.methods
          // .addKey(`key${i}`)
          .addKeys(batch)
          .accountsPartial({
            gachaFactory,
            gachaState,
            metadata,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
      }

      await program.methods
        .finalize()
        .accountsPartial({
          gachaFactory,
          gachaState,
          metadata,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const metadataAccount = await program.account.gachaMachineMetadata.fetch(
        metadata
      );
      // gachaState: anchor.web3.PublicKey;
      //     encryptedKeys: number[][];
      //     remainingIndices: number[];
      //     decryptionKey: number[];
      //     keysCount: number;
      //     remainingCount: number;
      //     bump: number;
      //   padding: number[];

      console.log(
        "metadata account",
        bytesToString(metadataAccount.encryptedKeys[MAX_KEYS / 2])
      );
      console.log("metadata account", metadataAccount.remainingIndices);
    });

    it("should close all state accounts in the program", async () => {
      adminLamports = await provider.connection.getBalance(admin.publicKey);
      console.log("adminLamports before", adminLamports);

      await program.methods
        .closeAll()
        .accountsPartial({
          gachaFactory,
          gachaState,
          metadata,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      adminLamports = await provider.connection.getBalance(admin.publicKey);
      console.log("adminLamports after", adminLamports);

      // const metadataAccount = await program.account.gachaMachineMetadata.fetch(
      //   metadata
      // );
      // console.log(
      //   "metadata account",
      //   bytesToString(metadataAccount.encryptedKeys[58])
      // );
    });
  });
});

const bytesToString = (bytes: number[]): string => {
  return Buffer.from(bytes).toString("utf8");
};

const stringToUint8Array = (text: string): Uint8Array => {
  return new TextEncoder().encode(text);
};

const stringToNumberArray = (text: string): number[] => {
  return Array.from(new TextEncoder().encode(text));
};

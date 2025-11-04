// lib/gacha_client.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
// import { GachaMachine } from "./GachaMachine"; // Give it to Client
// import { GachaMachine } from "../target/types/gacha_machine"; // Give it to Client

// import { GachaMachine } from "../../target/types/GachaMachine"; // Adjust path to your Anchor types
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PaymentType } from "./utils.js";

export class GachaClient {
  program;
  provider;
  gachaStatePDA;

  constructor(program, provider) {
    this.program = program;
    this.provider = provider;

    // Derive the main GachaState PDA
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gacha_state")],
      this.program.programId
    );
    this.gachaStatePDA = pda;
  }

  // ========================================
  // Utilities
  // ========================================

  findPaymentConfigPDA(paymentMint) {
    const [paymentConfigPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("payment_config"),
        this.gachaStatePDA.toBuffer(),
        new PublicKey(paymentMint).toBuffer(),
      ],
      this.program.programId
    );
    return paymentConfigPDA;
  }

  findPlayerStatePDA(user, nonce) {
    const [playerStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_state"), user.toBuffer(), nonce.toBuffer("le", 8)],
      this.program.programId
    );
    return playerStatePDA;
  }
  // ========================================
  // Fetch Methods
  // ========================================

  async getGachaState() {
    const gachaState = await this.program.account.gachaState.fetch(
      this.gachaStatePDA
    );
    return {
      admin: gachaState.admin.toBase58(),
      bump: gachaState.bump,
      isFinalized: gachaState.isFinalized,
      isPaused: gachaState.isPaused,
      pullCount: gachaState.pullCount.toNumber(),
      settleCount: gachaState.settleCount.toNumber(),
      encryptedKeys: gachaState.encryptedKeys,
      remainingIndices: gachaState.remainingIndices,
      paymentConfigs: gachaState.paymentConfigs.map((config) =>
        config.toBase58()
      ),
    };
  }

  async getPaymentConfig(paymentMint) {
    const paymentConfigPDA = this.findPaymentConfigPDA(paymentMint);
    const paymentConfig = await this.program.account.paymentConfig.fetch(
      paymentConfigPDA
    );

    return {
      gacha_state: paymentConfig.gachaState.toBase58(),
      mint: paymentConfig.mint.toBase58(),
      price: paymentConfig.price.toNumber(),
      adminRecipientAccount: paymentConfig.adminRecipientAccount.toBase58(),
      bump: paymentConfig.bump,
    };
  }

  async getPlayerState(user, nonce) {
    const [playerStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_state"), user.toBuffer(), nonce.toBuffer("le", 8)],
      this.program.programId
    );
    const playerState = await this.program.account.playerState.fetch(
      playerStatePDA
    );
    return {
      user: playerState.user.toBase58(),
      gachaState: playerState.gachaState.toBase58(),
      randomnessAccount: playerState.randomnessAccount.toBase58(),
      paymentMint: playerState.paymentMint.toBase58(),
      isSettled: playerState.isSettled,
      resultIndex: playerState.resultIndex,
      winningEncryptedKey: playerState.winningEncryptedKey,
      bump: playerState.bump,
      pullSlot: playerState.pullSlot.toNumber(),
      nonce: playerState.nonce.toNumber(),
    };
  }

  // ========================================
  // Admin Instructions
  // ========================================

  async initialize(admin) {
    return this.program.methods
      .initialize()
      .accountsPartial({
        gachaState: this.gachaStatePDA,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
  }

  async addPayment(
    admin,
    paymentConfig,
    paymentMint,
    paymentPrice,
    paymentRecipientAccount
  ) {
    return this.program.methods
      .addPaymentConfig(paymentMint, paymentPrice, paymentRecipientAccount)
      .accounts({
        // paymentConfig,
        // admin,
        gachaState: this.gachaStatePDA,
      })
      .signers([admin])
      .rpc();
  }

  async addKey(admin, encryptedKey) {
    return this.program.methods
      .addKey(encryptedKey)
      .accounts({
        gachaState: this.gachaStatePDA,
      })
      .signers([admin])
      .rpc();
  }

  async finalize(admin) {
    return this.program.methods
      .finalize()
      .accounts({
        gachaState: this.gachaStatePDA,
      })
      .signers([admin])
      .rpc();
  }

  // ========================================
  // User Instructions
  // ========================================

  async pullInstruction(
    user,
    paymentType,
    paymentMint,
    paymentConfig,
    userPaymentAccount,
    adminRecipientAccount,
    randomnessAccount
  ) {
    const instruction = this.program.methods.pull().accountsPartial({
      user: user,
      paymentMint: paymentMint,
      paymentConfig: paymentConfig,
      userPaymentAccount: userPaymentAccount,
      adminRecipientAccount: adminRecipientAccount,
      randomnessAccountData: randomnessAccount,
    });
    // Add token program only for SPL payments
    if (paymentType === PaymentType.SPL) {
      instruction.remainingAccounts([
        {
          pubkey: TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
      ]);
    }
    return await instruction.instruction();

    // return this.program.methods
    //   .pull()
    //   .accounts({
    //     // playerState: playerStatePDA,
    //     // gachaState: this.gachaStatePDA,
    //     // usdtMint: usdtMint,
    //     // userTokenAccount: userTokenAccount,
    //     // adminTokenAccount: adminTokenAccount,
    //     randomnessAccountData: randomnessAccount,
    //     // systemProgram: SystemProgram.programId,
    //   })
    //   .signers([user])
    //   .rpc();
  }

  async settle(user, nonce, randomnessAccount) {
    const [playerStatePDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        user.publicKey.toBuffer(),
        nonce.toBuffer("le", 8),
      ],
      this.program.programId
    );

    return this.program.methods.settle().accounts({}).signers([user]).rpc();
  }
}

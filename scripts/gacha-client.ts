// lib/gacha_client.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
// import { GachaMachine } from "./GachaMachine"; // Give it to Client
import { GachaMachine } from "../target/types/gacha_machine"; // Give it to Client

// import { GachaMachine } from "../../target/types/GachaMachine"; // Adjust path to your Anchor types
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PaymentType } from "./utils";

export class GachaClient {
  program: Program<GachaMachine>;
  provider: anchor.AnchorProvider;
  gachaStatePDA: PublicKey;

  constructor(program: Program<GachaMachine>, provider: anchor.AnchorProvider) {
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

  findPaymentConfigPDA(paymentMint: string) {
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

  findPlayerStatePDA(user: PublicKey, nonce: anchor.BN) {
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
      pullCount: gachaState.pullCount,
      settleCount: gachaState.settleCount,
      encryptedKeys: gachaState.encryptedKeys,
      remainingIndices: gachaState.remainingIndices,
      paymentConfigs: gachaState.paymentConfigs.map((config) =>
        config.toBase58()
      ),
    };
  }

  async getPaymentConfig(paymentMint: string) {
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

  async getPlayerState(user: PublicKey, nonce: anchor.BN) {
    const [playerStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_state"), user.toBuffer(), nonce.toBuffer("le", 8)],
      this.program.programId
    );

    console.log("playerStatePDA", playerStatePDA);
    const playerState = await this.program.account.playerState.fetch(
      // playerStatePDA
      "AwFX9i87Tn13uAE1eFKxcpDKxb14oqgyRzycYhscZZ9b"
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
      nonce: playerState.nonce,
    };
  }

  // ========================================
  // Admin Instructions
  // ========================================

  async initialize(admin: Keypair) {
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
    admin: Keypair,
    paymentConfig: PublicKey,
    paymentMint: PublicKey,
    paymentPrice: anchor.BN,
    paymentRecipientAccount: PublicKey
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

  async addKey(admin: Keypair, encryptedKey: string) {
    return this.program.methods
      .addKey(encryptedKey)
      .accounts({
        gachaState: this.gachaStatePDA,
      })
      .signers([admin])
      .rpc();
  }

  async finalize(admin: Keypair) {
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
    user: PublicKey,
    paymentType: PaymentType,
    paymentMint: PublicKey,
    paymentConfig: PublicKey,
    userPaymentAccount: PublicKey,
    adminRecipientAccount: PublicKey,
    randomnessAccount: PublicKey
  ): Promise<anchor.web3.TransactionInstruction> {
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

  async settle(user: Keypair, nonce: anchor.BN, randomnessAccount: PublicKey) {
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

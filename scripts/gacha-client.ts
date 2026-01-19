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
  gachaFactoryPDA: PublicKey;
  maxKeys: number = 90;

  constructor(program: Program<GachaMachine>, provider: anchor.AnchorProvider) {
    this.program = program;
    this.provider = provider;

    // Derive the main GachaState PDA
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gacha_factory")],
      this.program.programId
    );
    this.gachaFactoryPDA = pda;
  }

  // ========================================
  // Utilities
  // ========================================

  findGachaStatePDA(gachaCount: anchor.BN) {
    const [gachaStatePDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("gacha_state"),
        this.gachaFactoryPDA.toBuffer(),
        gachaCount.toBuffer("le", 4),
      ],
      this.program.programId
    );
    return gachaStatePDA;
  }

  findMetadataPDAWithGachaCount(gachaCount: anchor.BN) {
    const gachaStatePDA = this.findGachaStatePDA(gachaCount);
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        this.gachaFactoryPDA.toBuffer(),
        gachaStatePDA.toBuffer(),
      ],
      this.program.programId
    );
    return metadataPDA;
  }

  findMetadataPDA(gachaState: PublicKey) {
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        this.gachaFactoryPDA.toBuffer(),
        gachaState.toBuffer(),
      ],
      this.program.programId
    );
    return metadataPDA;
  }

  findPaymentConfigPDA(gachaState: PublicKey, paymentMint: PublicKey) {
    const [paymentConfigPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("payment_config"),
        this.gachaFactoryPDA.toBuffer(),
        gachaState.toBuffer(),
        paymentMint.toBuffer(),
      ],
      this.program.programId
    );
    return paymentConfigPDA;
  }

  findPlayerStatePDA(gachaState: PublicKey, user: PublicKey, nonce: anchor.BN) {
    const [playerStatePDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        Buffer.from("gacha_state"),
        user.toBuffer(),
        nonce.toBuffer("le", 8),
      ],
      this.program.programId
    );
    return playerStatePDA;
  }
  // ========================================
  // Fetch Methods
  // ========================================

  async getGachaFactoryState() {
    const gachaFactory = await this.program.account.gachaFactory.fetch(
      this.gachaFactoryPDA
    );
    return {
      admin: gachaFactory.admin.toBase58(),
      gachaCount: gachaFactory.gachaCount,
      bump: gachaFactory.bump,
    };
  }

  async getGachaState(gachaCount: anchor.BN) {
    const gachaStatePDA = this.findGachaStatePDA(gachaCount);

    const gachaState = await this.program.account.gachaState.fetch(
      gachaStatePDA
    );
    return {
      gachaFactory: gachaState.gachaFactory.toBase58(),
      admin: gachaState.admin.toBase58(),
      pullCount: gachaState.pullCount,
      settleCount: gachaState.settleCount,
      bump: gachaState.bump,
      isFinalized: gachaState.isFinalized,
      isPaused: gachaState.isPaused,
      isHalted: gachaState.isHalted,
    };
  }

  async getLastGachaState() {
    const { gachaCount } = await this.getGachaFactoryState();
    const gachaStatePDA = this.findGachaStatePDA(new anchor.BN(gachaCount));

    const gachaState = await this.program.account.gachaState.fetch(
      gachaStatePDA
    );
    return [
      gachaStatePDA,
      {
        gachaFactory: gachaState.gachaFactory.toBase58(),
        admin: gachaState.admin.toBase58(),
        pullCount: gachaState.pullCount,
        settleCount: gachaState.settleCount,
        bump: gachaState.bump,
        isFinalized: gachaState.isFinalized,
        isPaused: gachaState.isPaused,
        isHalted: gachaState.isHalted,
      },
    ];
  }

  async getMetadataState(gachaCount: anchor.BN) {
    const gachaStatePDA = this.findGachaStatePDA(gachaCount);
    const metadataPDA = this.findMetadataPDA(gachaStatePDA);

    const metadataState = await this.program.account.gachaMachineMetadata.fetch(
      metadataPDA
    );
    return {
      gachaState: metadataState.gachaState.toBase58(),
      encryptedKeys: metadataState.encryptedKeys,
      remainingIndices: metadataState.remainingIndices,
      decryptionKey: metadataState.decryptionKey,
      keysCount: metadataState.keysCount,
      remainingCount: metadataState.remainingCount,
      bump: metadataState.bump,
      padding: metadataState.padding,

      // paymentConfigs: metadataState.paymentConfigs.map((config) =>
      //   config.toBase58()
      // ),
    };
  }

  async getPaymentConfig(gachaState: PublicKey, paymentMint: PublicKey) {
    const paymentConfigPDA = this.findPaymentConfigPDA(gachaState, paymentMint);
    const paymentConfig = await this.program.account.paymentConfig.fetch(
      paymentConfigPDA
    );

    return {
      gachaState: paymentConfig.gachaState.toBase58(),
      mint: paymentConfig.mint.toBase58(),
      price: paymentConfig.price.toNumber(),
      adminRecipientAccount: paymentConfig.adminRecipientAccount.toBase58(),
      bump: paymentConfig.bump,
    };
  }

  async getPlayerState(
    gachaState: PublicKey,
    user: PublicKey,
    nonce: anchor.BN
  ) {
    const playerStatePDA = this.findPlayerStatePDA(gachaState, user, nonce);

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
      nonce: playerState.nonce,
    };
  }

  // ========================================
  // Admin Instructions
  // ========================================

  async initializeFactory(admin: Keypair) {
    return this.program.methods
      .initializeGachaFactory()
      .accounts({
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();
  }

  async createGacha(admin: Keypair) {
    const { gachaCount } = await this.getGachaFactoryState();
    const gachaStatePDA = this.findGachaStatePDA(new anchor.BN(gachaCount));
    const metadataPDA = this.findMetadataPDA(gachaStatePDA);

    return this.program.methods
      .createGacha()
      .accounts({
        gachaFactory: this.gachaFactoryPDA,
        gachaState: gachaStatePDA,
        metadata: metadataPDA,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
  }

  async initializeMetadata(admin: Keypair, gachaCount: anchor.BN) {
    // const { gachaCount } = await this.getGachaFactoryState();
    const gachaStatePDA = this.findGachaStatePDA(gachaCount);

    return this.program.methods
      .initializeMetadata()
      .accounts({
        gachaState: gachaStatePDA,
      })
      .signers([admin])
      .rpc();
  }

  async resizeMetadata(admin: Keypair, gachaCount: anchor.BN) {
    // const { gachaCount } = await this.getGachaFactoryState();
    const gachaStatePDA = this.findGachaStatePDA(gachaCount);

    return this.program.methods
      .resizeMetadata()
      .accounts({
        gachaState: gachaStatePDA,
      })
      .signers([admin])
      .rpc();
  }

  async closeAllAccounts(admin: Keypair, gachaCount: anchor.BN) {
    // const { gachaCount } = await this.getGachaFactoryState();
    const gachaStatePDA = this.findGachaStatePDA(gachaCount);

    return this.program.methods
      .closeAll()
      .accounts({
        gachaState: gachaStatePDA,
        // metadata: this.findMetadataPDA(gachaStatePDA),
        // admin: admin.publicKey,
        // systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
  }

  async addPayment(
    admin: Keypair,
    gachaCount: anchor.BN,
    paymentMint: PublicKey,
    paymentPrice: anchor.BN,
    paymentRecipientAccount: PublicKey
  ) {
    const gachaStatePDA = this.findGachaStatePDA(new anchor.BN(gachaCount));

    return this.program.methods
      .addPaymentConfig(paymentMint, paymentPrice, paymentRecipientAccount)
      .accounts({
        // paymentConfig,
        // admin,
        gachaState: gachaStatePDA,
      })
      .signers([admin])
      .rpc();
  }

  async addKey(admin: Keypair, gachaCount: anchor.BN, encryptedKey: string) {
    const gachaStatePDA = this.findGachaStatePDA(new anchor.BN(gachaCount));
    const metadataPDA = this.findMetadataPDA(gachaStatePDA);

    return this.program.methods
      .addKey(encryptedKey)
      .accounts({
        gachaState: gachaStatePDA,
        // metadata: metadataPDA,
      })
      .signers([admin])
      .rpc();
  }

  async finalize(admin: Keypair, gachaCount: anchor.BN) {
    const gachaStatePDA = this.findGachaStatePDA(new anchor.BN(gachaCount));
    const metadataPDA = this.findMetadataPDA(gachaStatePDA);

    return this.program.methods
      .finalize()
      .accounts({
        gachaState: gachaStatePDA,
        // metadata: metadataPDA,
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
    //     // gachaState: gachaStatePDA,
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

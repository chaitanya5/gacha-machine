/// States module for the Gacha Machine program
///
/// Contains all account structures and their implementations used to store
/// program state on-chain.
use anchor_lang::prelude::*;

/// Main state account for a gacha machine
///
/// Stores all configuration, keys, and operational state for a gacha instance.
/// Uses PDAs for deterministic addressing and supports dynamic resizing.
#[account]
pub struct GachaState {
    /// Public key of the admin who controls this gacha machine
    pub admin: Pubkey,
    /// PDA bump seed for this account
    pub bump: u8,
    /// Whether the machine has been finalized (no more keys can be added)
    pub is_finalized: bool,
    /// Whether pulls are paused (admin control)
    pub is_paused: bool,
    /// Whether settlements are halted (emergency control)
    pub is_halted: bool,
    /// Total number of pulls performed
    pub pull_count: u64,
    /// Total number of settlements completed
    pub settle_count: u64,
    /// Pool of encrypted reward keys
    pub encrypted_keys: Vec<String>,
    /// Remaining indices for fair randomization (Fisher-Yates approach)
    pub remaining_indices: Vec<u16>,
    /// List of valid payment configuration accounts
    pub payment_configs: Vec<Pubkey>,
}

/// Calculate initial size for GachaState account allocation
impl GachaState {
    pub const INITIAL_SIZE: usize = 32 // admin pubkey
    + 1 // bump
    + 1 // is_finalized
    + 1 // is_paused
    + 1 // is_halted
    + 8 // pull_count
    + 8 // settle_count
    + 4 // encrypted_keys vector discriminator (empty initially)
    + 4 // remaining_indices vector discriminator (empty initially)
    + 4; // payment_configs vector discriminator (empty initially)
}

/// Player state for tracking individual pulls and settlements
///
/// Each pull creates a unique PlayerState account that persists until settlement.
/// Contains all information needed to verify and complete the reward process.
#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    /// Public key of the user who performed the pull
    pub user: Pubkey,
    /// Reference to the gacha machine used
    pub gacha_state: Pubkey,
    /// Switchboard randomness account used for this pull
    pub randomness_account: Pubkey,
    /// Payment mint used for this pull
    pub payment_mint: Pubkey,
    /// Whether this pull has been settled
    pub is_settled: bool,
    /// Index of the winning key (set during settlement)
    pub result_index: u16,
    /// The actual encrypted key won (set during settlement)
    #[max_len(120)]
    pub winning_encrypted_key: String,
    /// PDA bump seed for this account
    pub bump: u8,
    /// Slot when the pull was performed (for randomness validation)
    pub pull_slot: u64,
    /// Nonce from gacha machine (for PDA derivation)
    pub nonce: u64,
}

/// Configuration for a payment method accepted by the gacha machine
///
/// Defines how users can pay for pulls, including the token type, price, and destination.
/// Supports both native SOL and SPL tokens.
#[account]
#[derive(InitSpace)]
pub struct PaymentConfig {
    /// Reference to the gacha machine this config belongs to
    pub gacha_state: Pubkey,
    /// Token mint (SystemProgram::id() for SOL, mint pubkey for SPL tokens)
    pub mint: Pubkey,
    /// Price in lamports (for SOL) or smallest token units (for SPL)
    pub price: u64,
    /// Destination account for payments (admin pubkey for SOL, ATA for SPL)
    pub admin_recipient_account: Pubkey,
    /// PDA bump seed for this account
    pub bump: u8,
}

use crate::constants::KEY_LEN;
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
    /// Number of payment configuration accounts associated with this gacha machine
    pub payment_config_count: u8,
    /// Whether the machine has been finalized (no more keys can be added)
    pub is_finalized: bool,
    /// Whether pulls are paused (admin control)
    pub is_paused: bool,
    /// Whether settlements are halted (emergency control)
    pub is_halted: bool,
    /// Total number of pulls performed
    pub pull_count: u16,
    /// Total number of settlements completed
    pub settle_count: u16,
    /// Track the "actual" length of your arrays
    pub keys_count: u16,
    pub remaining_count: u16,
    /// Pool of encrypted reward keys stored as fixed-size byte arrays
    pub encrypted_keys: [[u8; KEY_LEN]; 10],
    // Decryption Key, will be revealed after all pulls(max_len: 120 )
    pub decryption_key: [u8; 100],
    /// Remaining indices for fair randomization (Fisher-Yates approach)
    pub remaining_indices: [u16; 10],
    // pub remaining_indices: Vec<u16>,
    /// List of valid payment configuration accounts
    pub payment_configs: [Pubkey; 3],
}

/// Calculate initial size for GachaState account allocation
impl GachaState {
    pub const INITIAL_SIZE: usize = 32 // admin pubkey (Pubkey = 32 bytes)
    + 1 // bump (u8 = 1 byte)
    + 1 // payment_config_count (u8 = 1 byte)
    + 1 // is_finalized (bool = 1 byte)
    + 1 // is_paused (bool = 1 byte)
    + 1 // is_halted (bool = 1 byte)
    + 2 // pull_count (u16 = 2 bytes)
    + 2 // settle_count (u16 = 2 bytes)
    + 2 // keys_count (u16 = 2 bytes)
    + 2 // remaining_count (u16 = 2 bytes)
    + (10 * 120) // encrypted_keys: 10 keys, each 120 bytes
    + 100 // decryption_key: fixed-size array of 100 bytes
    + (10 * 2) // remaining_indices: 10 indices, each u16 (2 bytes)
    + (3 * 32) // payment_configs: 3 Pubkeys, each 32 bytes
    // + 4 // encrypted_keys vector discriminator (empty initially; elements are [u8; KEY_LEN] when present)
    + 4 + KEY_LEN * 10 // encrypted_keys vector (discriminator + max_len) * total_len
    + 4 + 120 // decryption_key (discriminator + max_len)
    + 2 * 10 // remaining_indices vector discriminator (empty initially)
    + 32 * 3 // payment_configs vector discriminator (empty initially)
    + 128;
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
    pub winning_encrypted_key: [u8; KEY_LEN],
    /// PDA bump seed for this account
    pub bump: u8,
    /// Slot when the pull was performed (for randomness validation)
    pub pull_slot: u64,
    /// Nonce from gacha machine (for PDA derivation)
    pub nonce: u16,
}

/// Configuration for a payment method accepted by the gacha machine
///
/// Defines how users can pay for pulls, including the token type, price, and destination.
/// Supports both native SOL and SPL tokens.
#[account]
#[derive(InitSpace)]
pub struct PaymentConfig {
    /// Reference to the gacha machine this config belongs to (Pubkey = 32 bytes)
    pub gacha_state: Pubkey,
    /// Token mint (SystemProgram::id() for SOL, mint pubkey for SPL tokens) (Pubkey = 32 bytes)
    pub mint: Pubkey,
    /// Price in lamports (for SOL) or smallest token units (for SPL) (u64 = 8 bytes)
    pub price: u64,
    /// Destination account for payments (admin pubkey for SOL, ATA for SPL) (Pubkey = 32 bytes)
    pub admin_recipient_account: Pubkey,
    /// PDA bump seed for this account (u8 = 1 byte)
    pub bump: u8,
}

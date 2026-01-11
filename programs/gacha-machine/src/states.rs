use crate::constants::*;
/// States module for the Gacha Machine program
///
/// Contains all account structures and their implementations used to store
/// program state on-chain.
use anchor_lang::prelude::*;

/// Gacha Factory initializes a new GachaState account
#[account]
#[derive(InitSpace)]
pub struct GachaFactory {
    /// Public key of the admin who controls this gacha machine
    pub admin: Pubkey,
    /// Total number of gacha machines created
    pub gacha_count: u32,
    /// PDA bump seed for this account
    pub bump: u8,
}

/// Main state account for a gacha machine
///
/// Stores all configuration, keys, and operational state for a gacha instance.
/// Uses PDAs for deterministic addressing and supports dynamic resizing.
#[account]
#[derive(InitSpace)]
pub struct GachaState {
    /// Gacha Factory
    pub gacha_factory: Pubkey,
    /// Public key of the admin who controls this gacha machine
    pub admin: Pubkey,
    /// Total number of pulls performed
    pub pull_count: u16,
    /// Total number of settlements completed
    pub settle_count: u16,
    /// PDA bump seed for this account
    pub bump: u8,
    /// Whether the machine has been finalized (no more keys can be added)
    pub is_finalized: bool,
    /// Whether pulls are paused (admin control)
    pub is_paused: bool,
    /// Whether settlements are halted (emergency control)
    pub is_halted: bool,
}

/// Player state for tracking individual pulls and settlements
///
/// Each pull creates a unique PlayerState account that persists until settlement.
/// Contains all information needed to verify and complete the reward process.
#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    /// Slot when the pull was performed (for randomness validation)
    pub pull_slot: u64,
    /// Public key of the user who performed the pull
    pub user: Pubkey,
    /// Reference to the gacha machine used
    pub gacha_state: Pubkey,
    /// Switchboard randomness account used for this pull
    pub randomness_account: Pubkey,
    /// Payment mint used for this pull
    pub payment_mint: Pubkey,
    /// Index of the winning key (set during settlement)
    pub result_index: u16,
    /// Nonce from gacha machine (for PDA derivation)
    pub nonce: u16,
    /// Whether this pull has been settled
    pub is_settled: bool,
    /// PDA bump seed for this account
    pub bump: u8,
    /// The actual encrypted key won (set during settlement)
    #[max_len(MAX_KEY_LEN)]
    pub winning_encrypted_key: String,
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

/// Gacha Machine Metadata
///
/// Contains list of all keys and randomized pickup sets for each Gacha Machine
// #[account]
#[account(zero_copy)]
// #[repr(packed)]
// #[zero_copy]
// #[derive(InitSpace)]
pub struct GachaMachineMetadata {
    /// Reference to the gacha machine this config belongs to
    pub gacha_state: Pubkey,
    /// Pool of encrypted reward keys stored as fixed-size byte arrays
    pub encrypted_keys: [[u8; MAX_KEY_LEN]; MAX_KEYS],
    /// Remaining indices for fair randomization (Fisher-Yates approach)
    pub remaining_indices: [u16; MAX_KEYS],
    // Decryption Key, will be revealed after all pulls(max_len: 120 )
    pub decryption_key: [u8; MAX_KEY_LEN],
    /// Track the "actual" length of encrypted_keys
    pub keys_count: u16,
    /// Track the "actual" length of remaining_indices
    pub remaining_count: u16,
    /// PDA bump seed for this account
    pub bump: u8,
    pub _padding: [u8; 7],
}

// Here is the size calculation for the `GachaMachineMetadata` struct:
// `MAX_KEYS` is 100 and `MAX_KEY_LEN` is 100
// *   `gacha_state: Pubkey`: 32 bytes
// *   `encrypted_keys: [[u8; 100]; 100]`: (1 byte * 100) * 100 = 10,000 bytes
// *   `remaining_indices: [u16; 100]`: 2 bytes * 100 = 200 bytes
// *   `decryption_key: [u8; 100]`: 1 byte * 100 = 100 bytes
// *   `keys_count: u16`: 2 bytes
// *   `remaining_count: u16`: 2 bytes
// *   `bump: u8`: 1 byte
// *   `_padding: [u8; 7]`: 7 bytes

// **Total Struct Size:** 32 + 10,000 + 200 + 100 + 2 + 2 + 1 + 7 = **10,344 bytes**.

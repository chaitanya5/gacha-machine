use anchor_lang::prelude::*;
/// Constants module for the Gacha Machine program
///
/// Contains all program-wide constants and configuration values.

/// Maximum number of keys that can be stored in a gacha machine
#[constant]
pub const MAX_KEYS: usize = 90;

/// Maximum length of each key
#[constant]
pub const MAX_KEY_LEN: usize = 100;

/// Batch size (1024 KB CPI). Calculate the metadata account size accordingly
#[constant]
pub const BATCH_SIZE: usize = 90;

/// Maximum slot difference allowed for randomness validation
/// This ensures randomness data is recent and valid
#[constant]
pub const MAX_SLOT_DIFFERENCE: u64 = 20;

/// Seeds for PDA derivation

/// Seed for gacha factory PDA
#[constant]
pub const GACHA_FACTORY: &[u8] = b"gacha_factory";

/// Seed for gacha state PDA
#[constant]
pub const GACHA_STATE: &[u8] = b"gacha_state";

/// Seed for payment config PDA
#[constant]
pub const PAYMENT_CONFIG: &[u8] = b"payment_config";

/// Seed for metadata PDA
#[constant]
pub const METADATA: &[u8] = b"metadata";

/// Seed for player state PDA
#[constant]
pub const PLAYER_STATE: &[u8] = b"player_state";

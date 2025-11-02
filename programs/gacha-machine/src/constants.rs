/// Constants module for the Gacha Machine program
///
/// Contains all program-wide constants and configuration values.

/// Maximum number of keys that can be stored in a gacha machine
pub const MAX_KEYS: usize = 500;

/// Maximum slot difference allowed for randomness validation
/// This ensures randomness data is recent and valid
pub const MAX_SLOT_DIFFERENCE: u64 = 20;

/// Seeds for PDA derivation

/// Seed for gacha state PDA
pub const GACHA_STATE: &[u8] = b"gacha_state";

/// Seed for payment config PDA
pub const PAYMENT_CONFIG: &[u8] = b"payment_config";

/// Seed for player state PDA
pub const PLAYER_STATE: &[u8] = b"player_state";

/// Events module for the Gacha Machine program
/// Contains all event structures that are emitted by the program instructions
/// for off-chain tracking and monitoring.
use anchor_lang::prelude::*;

/// Emitted when a new gacha machine is initialized
#[event]
pub struct GachaInitialized {
    pub admin: Pubkey,
    pub gacha_state: Pubkey,
}

/// Emitted when a key is added to the gacha machine
#[event]
pub struct KeyAdded {
    pub admin: Pubkey,
    pub key: String,
    pub total_keys: u16,
    pub gacha_state: Pubkey,
}

/// Emitted when the gacha machine is finalized
#[event]
pub struct GachaFinalized {
    pub admin: Pubkey,
    pub total_keys: u16,
    pub gacha_state: Pubkey,
}

/// Emitted when the gacha machine is paused or unpaused
#[event]
pub struct GachaPaused {
    pub admin: Pubkey,
    pub paused: bool,
    pub gacha_state: Pubkey,
}

/// Emitted when the gacha machine is halted or unhalted
#[event]
pub struct GachaHalted {
    pub admin: Pubkey,
    pub halted: bool,
    pub gacha_state: Pubkey,
}

/// Emitted when admin privileges are transferred
#[event]
pub struct AdminTransferred {
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
    pub gacha_state: Pubkey,
}

/// Emitted when a payment configuration is added
#[event]
pub struct PaymentConfigAdded {
    pub admin: Pubkey,
    pub payment_mint: Pubkey,
    pub payment_price: u64,
    pub payment_recipient_account: Pubkey,
    pub gacha_state: Pubkey,
}

/// Emitted when a payment configuration is removed
#[event]
pub struct PaymentConfigRemoved {
    pub admin: Pubkey,
    pub payment_mint: Pubkey,
    pub gacha_state: Pubkey,
}

/// Emitted when a user performs a pull
#[event]
pub struct GachaPulled {
    pub user: Pubkey,
    pub nonce: u64,
    pub payment_mint: Pubkey,
    pub price: u64,
    pub gacha_state: Pubkey,
}

/// Emitted when a pull is settled with a result
#[event]
pub struct GachaResult {
    pub user: Pubkey,
    pub key_index: u16,
    pub encrypted_key: String,
    pub gacha_state: Pubkey,
}

/// Emitted when decryption key is released
#[event]
pub struct DecryptionKeyReleased {
    pub admin: Pubkey,
    pub decryption_key: String,
    pub gacha_state: Pubkey,
}

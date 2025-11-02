/// Error definitions for the Gacha Machine program
///
/// Contains all custom error types that can be returned by the program instructions.
use anchor_lang::prelude::*;

/// Custom error codes for the gacha machine program
#[error_code]
pub enum GachaError {
    #[msg("The gacha machine is out of keys.")]
    GachaIsEmpty,
    #[msg("This pull request has already been settled.")]
    AlreadySettled,
    #[msg("No keys were added to the pool before finalizing.")]
    NoKeysInPool,
    #[msg("Cannot add an empty key.")]
    EmptyKeyProvided,
    #[msg("The gacha machine has not been finalized by the admin yet.")]
    GachaNotFinalized,
    #[msg("The gacha machine has already been finalized and cannot be modified.")]
    GachaAlreadyFinalized,
    #[msg("Not enough keys available for more pulls.")]
    NotEnoughKeys,
    #[msg("The provided Switchboard account is invalid or owned by the wrong program.")]
    InvalidSwitchboardAccount,
    #[msg("Randomness has not been resolved by the oracle yet.")]
    RandomnessNotResolved,
    #[msg("The randomness seed is for a past slot and is no longer valid for a new pull.")]
    RandomnessNotCurrent,
    #[msg("Cannot settle in the same slot as the pull. Please wait for the next slot.")]
    SlotNotPassed,
    #[msg("The gacha machine is currently paused by the admin to prevent further pulling.")]
    GachaPaused,
    #[msg("The gacha machine is currently paused by the admin to prevent further settling.")]
    GachaHalted,
    #[msg("The key pool has reached its maximum capacity.")]
    KeyPoolFull,
    #[msg("The selected key index was out of bounds. This should not happen.")]
    IndexOutOfBounds,
    #[msg("The randomness value from the oracle was invalid.")]
    InvalidRandomnessValue,
    #[msg("The randomness account is invalid")]
    InvalidRandomnessAccount,
    #[msg("The payment config account is invalid")]
    InvalidPaymentConfig,
    #[msg("Incorrect account/program owner")]
    IncorrectOwner,
    #[msg("Mismatched accounts found")]
    AccountMismatch,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Invalid Mint account")]
    MintMismatch,
    #[msg("Token Program Missing")]
    TokenProgramMissing,
}

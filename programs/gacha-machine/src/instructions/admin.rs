use anchor_lang::prelude::*;

use crate::{constants::*, contexts::*, errors::GachaError, events::*, helpers::*};

/// ========================================
/// Admin Instructions
/// ========================================

/// Initialize the gacha factory
/// This is the factory that creates gacha machines.
pub fn initialize_gacha_factory(ctx: Context<InitializeGachaFactory>) -> Result<()> {
    let gacha_factory = &mut ctx.accounts.gacha_factory;

    // Set the admin as the signer of this transaction
    gacha_factory.admin = ctx.accounts.admin.key();
    gacha_factory.gacha_count = 0;
    gacha_factory.bump = ctx.bumps.gacha_factory;

    emit!(GachaFactoryInitialized {
        admin: ctx.accounts.admin.key(),
        gacha_factory: gacha_factory.key(),
    });
    Ok(())
}

/// Creates a new gacha machine
///
/// This instruction creates a new gacha machine within the factory.
///
/// Args:
/// - ctx: Context containing gacha_state PDA and admin accounts
///
/// Returns: Result indicating success or failure
pub fn create_gacha(ctx: Context<CreateGacha>) -> Result<()> {
    let gacha_state = &mut ctx.accounts.gacha_state;
    let gacha_factory = &mut ctx.accounts.gacha_factory;

    // Initialize Gacha Machine State
    gacha_state.admin = ctx.accounts.admin.key();
    gacha_state.gacha_factory = gacha_factory.key();
    gacha_state.bump = ctx.bumps.gacha_state;
    gacha_state.is_finalized = false;
    gacha_state.is_paused = false;
    gacha_state.is_halted = false;
    gacha_state.pull_count = 0;
    gacha_state.settle_count = 0;

    // Update count in Gacha Factory
    gacha_factory.gacha_count += 1;

    emit!(GachaInitialized {
        admin: ctx.accounts.admin.key(),
        gacha_state: gacha_state.key(),
    });
    Ok(())
}

/// Add a new payment configuration to the gacha machine
///
/// Payment configs define what tokens can be used to pay for pulls,
/// their prices, and where payments are sent. Supports both SOL and SPL tokens.
///
/// Args:
/// - ctx: Context containing payment_config PDA, gacha_state, and admin
/// - payment_mint: The mint address (SystemProgram::id() for SOL, mint pubkey for SPL)
/// - payment_price: Price in lamports (for SOL) or smallest token units (for SPL)
/// - payment_recipient_account: Where payments are sent (admin pubkey for SOL, ATA for SPL)
///
/// Returns: Result indicating success or failure
pub fn add_payment_config(
    ctx: Context<AddPaymentConfig>,
    payment_mint: Pubkey,
    payment_price: u64,
    payment_recipient_account: Pubkey,
) -> Result<()> {
    let payment_config = &mut ctx.accounts.payment_config;
    let gacha_state = &mut ctx.accounts.gacha_state;

    // Initialize the payment configuration
    payment_config.gacha_state = gacha_state.key();
    payment_config.mint = payment_mint;
    payment_config.price = payment_price;
    payment_config.admin_recipient_account = payment_recipient_account;
    payment_config.bump = ctx.bumps.payment_config;

    // Add this config to the gacha machine's list of accepted payments
    // gacha_state.payment_configs.push(payment_config.key());

    emit!(PaymentConfigAdded {
        admin: ctx.accounts.admin.key(),
        payment_mint,
        payment_price,
        payment_recipient_account,
        gacha_state: gacha_state.key()
    });
    Ok(())
}

/// Remove a payment configuration from the gacha machine
///
/// Completely removes a payment method from the gacha machine and closes the account
/// to reclaim rent. Updates the gacha state to remove the reference.
///
/// Args:
/// - ctx: Context containing payment_config to remove and gacha_state to update
/// - payment_mint: The mint address of the config to remove
///
/// Returns: Result indicating success or failure
pub fn remove_payment_config(
    ctx: Context<RemovePaymentConfig>,
    payment_mint: Pubkey,
) -> Result<()> {
    emit!(PaymentConfigRemoved {
        admin: ctx.accounts.admin.key(),
        payment_mint,
        gacha_state: ctx.accounts.gacha_state.key()
    });

    Ok(())
}

/// Add an encrypted key to the gacha machine's reward pool
///
/// Keys represent rewards that users can win. They are stored encrypted
/// and only revealed when a user wins them through the settle process.
///
/// Args:
/// - ctx: Context containing gacha_state to add the key to
/// - encrypted_key: The encrypted reward key as a string
///
/// Returns: Result indicating success or failure
///
/// Constraints:
/// - Machine must not be finalized
/// - Key cannot be empty
/// - Must not exceed MAX_KEYS limit
pub fn add_key(ctx: Context<AddKey>, encrypted_key: String) -> Result<()> {
    let gacha_state = &mut ctx.accounts.gacha_state;
    let metadata = &mut ctx.accounts.metadata.load_mut()?;

    // Validation: ensure machine is in the correct state for adding keys
    require!(!gacha_state.is_finalized, GachaError::GachaAlreadyFinalized);
    require!(
        !encrypted_key.is_empty() && encrypted_key.len() <= MAX_KEY_LEN,
        GachaError::InvalidKeyLength
    );
    require!(
        metadata.keys_count < MAX_KEYS as u16,
        GachaError::KeyPoolFull
    );

    let current_index = metadata.keys_count as usize;
    let key_arr = string_to_fixed_bytes::<MAX_KEY_LEN>(&encrypted_key); // Use the helper function

    // Add the fixed-size key to the pool
    metadata.encrypted_keys[current_index] = key_arr;
    metadata.keys_count += 1;

    emit!(KeyAdded {
        admin: ctx.accounts.admin.key(),
        key: encrypted_key,
        total_keys: metadata.keys_count,
        gacha_state: gacha_state.key()
    });

    Ok(())
}

/// Finalize the gacha machine to enable pulling
///
/// Once finalized, no more keys can be added and users can start pulling.
/// This creates the remaining_indices vector used for fair randomization.
///
/// Args:
/// - ctx: Context containing gacha_state to finalize
///
/// Returns: Result indicating success or failure
///
/// Constraints:
/// - Machine must not already be finalized
/// - At least one key must be in the pool
pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
    let gacha_state = &mut ctx.accounts.gacha_state;
    let metadata = &mut ctx.accounts.metadata.load_mut()?;

    // Validation: ensure machine is ready for finalization
    require!(!gacha_state.is_finalized, GachaError::GachaAlreadyFinalized);
    require!(metadata.keys_count > 0, GachaError::NoKeysInPool);

    let keys_count = metadata.keys_count;
    // Create indices array for randomized selection (Fisher-Yates shuffle implementation)
    // We iterate only up to n_usize to fill [0, 1, 2, ... n-1]
    for (i, slot) in metadata
        .remaining_indices
        .iter_mut()
        .take(keys_count as usize)
        .enumerate()
    {
        *slot = i as u16;
    }

    metadata.remaining_count = keys_count;
    gacha_state.is_finalized = true;

    emit!(GachaFinalized {
        admin: ctx.accounts.admin.key(),
        total_keys: keys_count,
        gacha_state: ctx.accounts.gacha_state.key()
    });

    Ok(())
}

/// Set the paused state of the gacha machine
///
/// When paused, users cannot perform pull operations.
/// Settling existing pulls is still allowed.
///
/// Args:
/// - ctx: Context containing gacha_state to modify
/// - paused: Whether to pause (true) or unpause (false) the machine
///
/// Returns: Result indicating success or failure
pub fn set_paused(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
    ctx.accounts.gacha_state.is_paused = paused;

    emit!(GachaPaused {
        admin: ctx.accounts.admin.key(),
        paused,
        gacha_state: ctx.accounts.gacha_state.key()
    });

    Ok(())
}

/// Set the halted state of the gacha machine
///
/// When halted, users cannot perform settle operations.
/// This is an emergency stop for the settlement process.
///
/// Args:
/// - ctx: Context containing gacha_state to modify
/// - halted: Whether to halt (true) or unhalt (false) the machine
///
/// Returns: Result indicating success or failure
pub fn set_halted(ctx: Context<AdminAction>, halted: bool) -> Result<()> {
    ctx.accounts.gacha_state.is_halted = halted;

    emit!(GachaHalted {
        admin: ctx.accounts.admin.key(),
        halted,
        gacha_state: ctx.accounts.gacha_state.key()
    });

    Ok(())
}

/// Transfer admin privileges to a new account
///
/// Changes the admin of the gacha machine to a new public key.
/// Only the current admin can perform this operation.
///
/// Args:
/// - ctx: Context containing gacha_state to modify
/// - new_admin: Public key of the new admin
///
/// Returns: Result indicating success or failure
pub fn transfer_admin(ctx: Context<AdminAction>, new_admin: Pubkey) -> Result<()> {
    let previous_admin = ctx.accounts.gacha_state.admin;
    ctx.accounts.gacha_state.admin = new_admin;

    emit!(AdminTransferred {
        previous_admin,
        new_admin,
        gacha_state: ctx.accounts.gacha_state.key()
    });
    Ok(())
}

/// Release decryption key
///
/// Admin uploads the decryption key.
/// Admin does this operation when all the pulls are settled.
///
/// Args:
/// - ctx: Context containing gacha_state to modify
/// - decryption_key: Decryption key for the list of encrypted NFTs(Ensure max_len = 120)
///
/// Returns: Result indicating success or failure
pub fn release_decryption_key(ctx: Context<AdminAction>, decryption_key: String) -> Result<()> {
    let metadata = &mut ctx.accounts.metadata.load_mut()?;

    // Validation: ensure decryption key is not empty and its length is valid
    require!(
        !decryption_key.is_empty() && decryption_key.len() <= MAX_KEY_LEN,
        GachaError::InvalidKeyLength
    );

    // Validation: ensure gacha machine is complete
    require_eq!(
        ctx.accounts.gacha_state.settle_count,
        metadata.keys_count,
        GachaError::GachaNotComplete
    );

    let key_arr = string_to_fixed_bytes::<MAX_KEY_LEN>(&decryption_key);
    // Add the key to the pool
    metadata.decryption_key = key_arr;

    emit!(DecryptionKeyReleased {
        admin: ctx.accounts.admin.key(),
        decryption_key: decryption_key,
        gacha_state: ctx.accounts.gacha_state.key()
    });

    Ok(())
}

/// Resize the metadata account to its full size before initializing it
///
/// This instruction is called before `initialize_metadata` to expand the metadata
/// account from its small initial size to its full size.
pub fn resize_metadata(_ctx: Context<ResizeMetadata>) -> Result<()> {
    Ok(())
}

/// Initialize the metadata account
///
/// This instruction is called after optional `resize_metadata` which will initiate the account
pub fn initialize_metadata(ctx: Context<InitializeMetadata>) -> Result<()> {
    let metadata = &mut ctx.accounts.metadata.load_mut()?;
    metadata.gacha_state = ctx.accounts.gacha_state.key();
    metadata.keys_count = 0;
    metadata.remaining_count = 0;
    metadata.bump = ctx.bumps.metadata;
    Ok(())
}


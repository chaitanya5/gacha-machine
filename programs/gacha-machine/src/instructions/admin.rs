use anchor_lang::prelude::*;

use crate::{constants::*, contexts::*, errors::GachaError, events::*};

/// ========================================
/// Admin Instructions
/// ========================================

/// Initialize a new gacha machine
///
/// This instruction creates a new gacha machine with the caller as admin.
/// The machine starts in an unfinalized state where keys can be added.
///
/// Args:
/// - ctx: Context containing gacha_state PDA and admin accounts
///
/// Returns: Result indicating success or failure
pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let gacha_state = &mut ctx.accounts.gacha_state;

    // Set the admin as the signer of this transaction
    gacha_state.admin = ctx.accounts.admin.key();
    gacha_state.bump = ctx.bumps.gacha_state;
    gacha_state.is_finalized = false;
    gacha_state.pull_count = 0;
    gacha_state.settle_count = 0;
    gacha_state.keys_count = 0;
    gacha_state.settle_count = 0;
    gacha_state.is_paused = false;
    gacha_state.payment_config_count = 0;

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

    msg!("AddPaymentConfig: Start");
    msg!(
        "AddPaymentConfig: Current payment_config_count: {}",
        gacha_state.payment_config_count
    );
    msg!(
        "AddPaymentConfig: Payment configs array length: {}",
        gacha_state.payment_configs.len()
    );

    // Initialize the payment configuration
    payment_config.gacha_state = gacha_state.key();
    payment_config.mint = payment_mint;
    payment_config.price = payment_price;
    payment_config.admin_recipient_account = payment_recipient_account;
    payment_config.bump = ctx.bumps.payment_config;

    let payment_config_count = gacha_state.payment_config_count;

    // Bounds check
    require!(
        (gacha_state.payment_config_count as usize) < gacha_state.payment_configs.len(),
        GachaError::KeyPoolFull // Or define a new error for payment config overflow
    );
    msg!("AddPaymentConfig: Passed bounds check");

    // Check for duplicate
    for i in 0..payment_config_count {
        if gacha_state.payment_configs[i as usize] == payment_config.key() {
            msg!(
                "AddPaymentConfig: Duplicate payment config found at index {}",
                i
            );
            return Err(error!(GachaError::InvalidPaymentConfig));
        }
    }
    msg!("AddPaymentConfig: No duplicates found");

    // Add this config to the gacha machine's list of accepted payments
    gacha_state.payment_configs[payment_config_count as usize] = payment_config.key();
    gacha_state.payment_config_count += 1;

    msg!(
        "AddPaymentConfig: Successfully added payment config. New payment_config_count: {}",
        gacha_state.payment_config_count
    );

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
    let gacha_state = &mut ctx.accounts.gacha_state;
    let payment_config = &ctx.accounts.payment_config;

    // Only search the first payment_config_count slots
    if let Some(index) = (0..gacha_state.payment_config_count)
        .find(|&i| gacha_state.payment_configs[i as usize] == payment_config.key())
    {
        let last = gacha_state.payment_config_count - 1;
        // Move the last valid config into the removed slot (unless it's already the last)
        if index != last {
            gacha_state.payment_configs[index as usize] =
                gacha_state.payment_configs[last as usize];
        }
        gacha_state.payment_configs[last as usize] = Pubkey::default();
        gacha_state.payment_config_count -= 1;
    } else {
        return Err(error!(GachaError::InvalidPaymentConfig));
    }

    emit!(PaymentConfigRemoved {
        admin: ctx.accounts.admin.key(),
        payment_mint,
        gacha_state: gacha_state.key()
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

    // Validation: ensure machine is in the correct state for adding keys
    require!(!gacha_state.is_finalized, GachaError::GachaAlreadyFinalized);
    require!(!encrypted_key.is_empty(), GachaError::EmptyKeyProvided);
    require!(
        gacha_state.keys_count < MAX_KEYS as u16,
        GachaError::KeyPoolFull
    );

    // Convert String to fixed-size byte array [u8; KEY_LEN] and copy (pad with zeros if needed,
    // truncate if the provided string is longer than KEY_LEN).
    let key_bytes = encrypted_key.as_bytes();
    let current_index = gacha_state.keys_count as usize;

    let mut key_arr = [0u8; KEY_LEN];
    let copy_len = std::cmp::min(KEY_LEN, key_bytes.len());
    if copy_len > 0 {
        key_arr[..copy_len].copy_from_slice(&key_bytes[..copy_len]);
    }

    // Add the fixed-size key to the pool
    gacha_state.encrypted_keys[current_index] = key_arr;
    gacha_state.keys_count += 1;

    emit!(KeyAdded {
        admin: ctx.accounts.admin.key(),
        key: encrypted_key,
        total_keys: gacha_state.encrypted_keys.len() as u16,
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

    // Validation: ensure machine is ready for finalization
    require!(!gacha_state.is_finalized, GachaError::GachaAlreadyFinalized);
    // require!(
    //     !gacha_state.encrypted_keys.is_empty(),
    //     GachaError::NoKeysInPool
    // );

    // Create indices array for randomized selection (Fisher-Yates shuffle implementation)
    // let total_keys = gacha_state.encrypted_keys.len() as u16;
    let keys_count = gacha_state.keys_count;
    let n_usize = keys_count as usize;

    // Fixed-size array replacement for .collect()
    // We iterate only up to n_usize to fill [0, 1, 2, ... n-1]
    for (i, slot) in gacha_state
        .remaining_indices
        .iter_mut()
        .take(n_usize)
        .enumerate()
    {
        *slot = i as u16;
    }

    // gacha_state.remaining_indices = (0..keys_count).collect();
    gacha_state.is_finalized = true;
    gacha_state.remaining_count = keys_count;

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
    let gacha_state = &mut ctx.accounts.gacha_state;

    // Validation: ensure gacha machine is complete
    require_eq!(
        gacha_state.settle_count,
        gacha_state.encrypted_keys.len() as u16,
        GachaError::GachaNotComplete
    );

    // Ensure the decryption key is not empty and less than 100 characters
    require!(
        decryption_key.len() > 0 && decryption_key.len() <= KEY_LEN,
        GachaError::KeyTooLong
    );

    // Convert the decryption key into the fixed-size representation with zero padding.
    let key_bytes = decryption_key.as_bytes();
    let mut win_fixed: [u8; KEY_LEN] = [0u8; KEY_LEN];
    let copy_len = std::cmp::min(KEY_LEN, key_bytes.len());
    if copy_len > 0 {
        win_fixed[..copy_len].copy_from_slice(&key_bytes[..copy_len]);
    }

    // Add the key to the pool
    gacha_state.decryption_key = win_fixed;

    emit!(DecryptionKeyReleased {
        admin: ctx.accounts.admin.key(),
        decryption_key: decryption_key,
        gacha_state: gacha_state.key()
    });

    Ok(())
}

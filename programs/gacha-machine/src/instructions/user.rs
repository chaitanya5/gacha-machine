use anchor_lang::prelude::*;
use anchor_lang::system_program;
use switchboard_on_demand::accounts::RandomnessAccountData;

use crate::{constants::*, contexts::*, errors::GachaError, events::*, helpers::*};

/// ========================================
/// User Instructions
/// ========================================

/// Perform a gacha pull
///
/// Users pay the required amount and create a pull request that will be settled
/// in a future transaction using verifiable randomness from Switchboard oracles.
///
/// Process:
/// 1. Validate gacha machine state (not paused, finalized, has keys)
/// 2. Validate payment configuration and randomness account
/// 3. Process payment (SOL or SPL tokens)
/// 4. Create player state for later settlement
/// 5. Increment pull counter
///
/// Args:
/// - ctx: Context containing all required accounts for the pull operation
///
/// Returns: Result indicating success or failure
pub fn pull(ctx: Context<Pull>) -> Result<()> {
    let clock = Clock::get()?;

    // ============ GACHA MACHINE VALIDATIONS ============
    // Ensure the machine is in a valid state for pulling
    require!(!ctx.accounts.gacha_state.is_paused, GachaError::GachaPaused);
    require!(
        ctx.accounts.gacha_state.is_finalized,
        GachaError::GachaNotFinalized
    );
    require!(
        ctx.accounts.gacha_state.pull_count < ctx.accounts.gacha_state.encrypted_keys.len() as u64,
        GachaError::NotEnoughKeys
    );

    // ============ PAYMENT VALIDATION ============
    // Verify the payment config is valid for this gacha machine
    require!(
        ctx.accounts
            .gacha_state
            .payment_configs
            .contains(&ctx.accounts.payment_config.key()),
        GachaError::InvalidPaymentConfig
    );

    // ============ RANDOMNESS VALIDATION ============
    // Ensure the randomness account is current and valid
    let randomness_account = &ctx.accounts.randomness_account_data;
    let randomness_data = RandomnessAccountData::parse(randomness_account.data.borrow())
        .map_err(|_| GachaError::InvalidRandomnessAccount)?;
    require!(
        clock.slot >= randomness_data.seed_slot
            && clock.slot - randomness_data.seed_slot <= MAX_SLOT_DIFFERENCE,
        GachaError::RandomnessNotReady
    );

    // ============ PAYMENT PROCESSING ============
    // Process payment based on payment method (SOL vs SPL token)
    if ctx.accounts.payment_config.mint == system_program::ID {
        process_sol_payment(&ctx, &ctx.accounts.payment_config)?;
    } else {
        process_spl_payment(&ctx, &ctx.accounts.payment_config)?;
    }

    // ============ PLAYER STATE SETUP ============
    // Initialize the player state for later settlement
    let player_state = &mut ctx.accounts.player_state;
    player_state.user = ctx.accounts.user.key();
    player_state.gacha_state = ctx.accounts.gacha_state.key();
    player_state.randomness_account = randomness_account.key();
    player_state.payment_mint = ctx.accounts.payment_config.mint.key();
    player_state.is_settled = false;
    player_state.pull_slot = clock.slot;
    player_state.nonce = ctx.accounts.gacha_state.pull_count;
    player_state.bump = ctx.bumps.player_state;

    // Increment the pull counter
    ctx.accounts.gacha_state.pull_count += 1;

    emit!(GachaPulled {
        user: ctx.accounts.user.key(),
        nonce: player_state.nonce,
        payment_mint: ctx.accounts.payment_config.mint,
        price: ctx.accounts.payment_config.price,
        gacha_state: ctx.accounts.gacha_state.key(),
    });

    Ok(())
}

/// Settle a gacha pull to determine the reward
///
/// Uses verifiable randomness to fairly select a reward from the remaining pool.
/// Can only be called after the pull transaction and in a different slot.
///
/// Process:
/// 1. Validate settlement conditions (not settled, not halted, slot passed)
/// 2. Extract randomness from Switchboard oracle
/// 3. Use randomness to select from remaining indices
/// 4. Remove selected index and assign reward to player
/// 5. Mark as settled and increment settle counter
///
/// Args:
/// - ctx: Context containing player_state, gacha_state, and randomness account
///
/// Returns: Result indicating success or failure
pub fn settle(ctx: Context<Settle>) -> Result<()> {
    let gacha_state = &mut ctx.accounts.gacha_state;
    let player_state = &mut ctx.accounts.player_state;
    let clock = Clock::get()?;

    // ============ SETTLEMENT VALIDATIONS ============
    // Ensure this pull hasn't been settled
    require!(!player_state.is_settled, GachaError::AlreadySettled);
    require!(gacha_state.is_finalized, GachaError::GachaNotFinalized);
    require!(!gacha_state.is_halted, GachaError::GachaHalted);
    require!(
        clock.slot > player_state.pull_slot,
        GachaError::SlotNotPassed
    );

    // Check if there are still rewards available
    let remaining_count = gacha_state.remaining_indices.len();
    require!(remaining_count > 0, GachaError::GachaIsEmpty);

    // ============ RANDOMNESS EXTRACTION ============
    // Get the resolved randomness from the Switchboard oracle
    let randomness_data =
        RandomnessAccountData::parse(ctx.accounts.randomness_account_data.data.borrow())
            .map_err(|_| GachaError::InvalidRandomnessAccount)?;

    require_eq!(
        randomness_data.seed_slot,
        player_state.pull_slot,
        GachaError::RandomnessExpired
    );

    let random_value_bytes = randomness_data
        .get_value(clock.slot)
        .map_err(|_| GachaError::RandomnessNotResolved)?;

    // Convert randomness bytes to u64 for indexing
    let random_u64 = u64::from_le_bytes(
        random_value_bytes[0..8]
            .try_into()
            .map_err(|_| GachaError::InvalidRandomnessValue)?,
    );

    // ============ REWARD SELECTION ============
    // Use Fisher-Yates shuffle approach: select random index from remaining
    let selected_index_in_remaining = random_u64 as usize % remaining_count;
    let final_key_index = gacha_state
        .remaining_indices
        .swap_remove(selected_index_in_remaining);

    // Get the actual encrypted key from the pool
    let encrypted_key_from_pool = gacha_state
        .encrypted_keys
        .get(final_key_index as usize)
        .ok_or(GachaError::IndexOutOfBounds)?
        .clone();

    // ============ SETTLEMENT COMPLETION ============
    // Update player state with the result
    player_state.is_settled = true;
    player_state.result_index = final_key_index;
    player_state.winning_encrypted_key = encrypted_key_from_pool;

    // Increment the settlement counter
    gacha_state.settle_count += 1;

    emit!(GachaResult {
        user: player_state.user,
        key_index: final_key_index,
        encrypted_key: player_state.winning_encrypted_key.clone(),
        gacha_state: ctx.accounts.gacha_state.key(),
    });

    Ok(())
}

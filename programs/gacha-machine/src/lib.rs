//! Gacha Machine Program
//!
//! A Solana program that implements a gacha (lottery) system where users can:
//! - Pull from a pool of encrypted keys using SOL or SPL tokens as payment
//! - Receive randomized rewards determined by Switchboard oracles
//!
//! The program supports multiple payment configurations, admin controls for pausing/halting,
//! and uses verifiable randomness for fair reward distribution.

#![allow(deprecated)]
#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use switchboard_on_demand::{
    accounts::RandomnessAccountData, get_switchboard_on_demand_program_id,
};

declare_id!("9v8BjHdGcmAqEyZGt6zgC94R3AmVTbK4hT6w7TFzgaSs");

/// Maximum number of keys that can be stored in a gacha machine
const MAX_KEYS: usize = 500;
/// Maximum slot difference allowed for randomness validation
const MAX_SLOT_DIFFERENCE: u64 = 20;

#[program]
pub mod gacha_machine {
    use anchor_lang::system_program;

    use super::*;

    // ========================================
    // Admin Instructions
    // ========================================

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
        gacha_state.is_paused = false;

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
        gacha_state.payment_configs.push(payment_config.key());

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

        // Find and remove the payment config from the gacha_state's payment_configs vector
        if let Some(index) = gacha_state
            .payment_configs
            .iter()
            .position(|&x| x == payment_config.key())
        {
            gacha_state.payment_configs.remove(index);
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
            gacha_state.encrypted_keys.len() < MAX_KEYS,
            GachaError::KeyPoolFull
        );

        // Add the key to the pool
        gacha_state.encrypted_keys.push(encrypted_key.clone());

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
        require!(
            !gacha_state.encrypted_keys.is_empty(),
            GachaError::NoKeysInPool
        );

        // Create indices array for randomized selection (Fisher-Yates shuffle implementation)
        let total_keys = gacha_state.encrypted_keys.len() as u16;
        gacha_state.remaining_indices = (0..total_keys).collect();
        gacha_state.is_finalized = true;

        emit!(GachaFinalized {
            admin: ctx.accounts.admin.key(),
            total_keys,
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

    // ========================================
    // User Instructions
    // ========================================

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
            ctx.accounts.gacha_state.pull_count
                <= ctx.accounts.gacha_state.encrypted_keys.len() as u64,
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
            GachaError::RandomnessNotCurrent
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
}

// ========================================
// Payment Helper Functions
// ========================================

/// Processes SOL payment for gacha pulls
///
/// Handles native SOL transfers from user to admin recipient.
/// Validates account ownership, balances, and executes the transfer.
///
/// Args:
/// - ctx: Pull context containing all payment-related accounts
/// - payment_config: Config specifying price and recipient
///
/// Returns: Result indicating success or failure of the payment
fn process_sol_payment(ctx: &Context<Pull>, payment_config: &PaymentConfig) -> Result<()> {
    // ============ OWNERSHIP VERIFICATION ============
    // Verify both accounts are owned by the System Program (native SOL accounts)
    require_keys_eq!(
        *ctx.accounts.user_payment_account.owner,
        anchor_lang::system_program::ID,
        GachaError::IncorrectOwner
    );
    require_keys_eq!(
        *ctx.accounts.admin_recipient_account.owner,
        anchor_lang::system_program::ID,
        GachaError::IncorrectOwner
    );

    // ============ ACCOUNT MATCHING ============
    // Ensure the user's payment account is actually their own account
    require_keys_eq!(
        ctx.accounts.user_payment_account.key(),
        ctx.accounts.user.key(),
        GachaError::AccountMismatch
    );
    // Ensure the admin recipient matches the config
    require_keys_eq!(
        ctx.accounts.admin_recipient_account.key(),
        payment_config.admin_recipient_account,
        GachaError::AccountMismatch
    );

    // ============ BALANCE VERIFICATION ============
    // Ensure user has enough SOL (lamports) for the payment
    require!(
        ctx.accounts.user_payment_account.lamports() >= payment_config.price,
        GachaError::InsufficientFunds
    );

    // ============ TRANSFER EXECUTION ============
    // Execute the SOL transfer using system program CPI
    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        anchor_lang::system_program::Transfer {
            from: ctx.accounts.user_payment_account.to_account_info(),
            to: ctx.accounts.admin_recipient_account.to_account_info(),
        },
    );
    anchor_lang::system_program::transfer(cpi_context, payment_config.price)?;

    Ok(())
}

/// Processes SPL token payment for gacha pulls
///
/// Handles SPL token transfers from user's token account to admin's token account.
/// Validates token account ownership, mint matching, balance sufficiency, and executes transfer.
///
/// Args:
/// - ctx: Pull context containing all payment-related accounts
/// - payment_config: Config specifying mint, price, and recipient
///
/// Returns: Result indicating success or failure of the payment
fn process_spl_payment(ctx: &Context<Pull>, payment_config: &PaymentConfig) -> Result<()> {
    // ============ PROGRAM VERIFICATION ============
    // Ensure token program is provided for SPL token operations
    let token_program = ctx
        .accounts
        .token_program
        .as_ref()
        .ok_or(GachaError::TokenProgramMissing)?;

    // ============ OWNERSHIP VERIFICATION ============
    // Verify all accounts are owned by the Token Program
    require_keys_eq!(
        *ctx.accounts.user_payment_account.owner,
        token_program.key(),
        GachaError::IncorrectOwner
    );
    require_keys_eq!(
        *ctx.accounts.admin_recipient_account.owner,
        token_program.key(),
        GachaError::IncorrectOwner
    );
    require_keys_eq!(
        *ctx.accounts.payment_mint.owner,
        token_program.key(),
        GachaError::IncorrectOwner
    );

    // ============ ACCOUNT MATCHING ============
    // Ensure the mint account matches the payment config
    require_keys_eq!(
        ctx.accounts.payment_mint.key(),
        payment_config.mint,
        GachaError::MintMismatch
    );
    // Ensure the admin recipient matches the config
    require_keys_eq!(
        ctx.accounts.admin_recipient_account.key(),
        payment_config.admin_recipient_account,
        GachaError::AccountMismatch
    );

    // ============ BALANCE VERIFICATION ============
    // Parse the user's token account and check balance
    let user_token_account = anchor_spl::token::TokenAccount::try_deserialize(
        &mut ctx.accounts.user_payment_account.data.borrow().as_ref(),
    )?;

    require!(
        user_token_account.amount >= payment_config.price,
        GachaError::InsufficientFunds
    );

    // ============ TRANSFER EXECUTION ============
    // Execute the SPL token transfer using token program CPI
    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.user_payment_account.to_account_info(),
        to: ctx.accounts.admin_recipient_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    anchor_spl::token::transfer(cpi_ctx, payment_config.price)?;

    Ok(())
}

// ========================================
// Account Structs
// ========================================

/// Accounts required for initializing a new gacha machine
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The gacha machine state account (PDA)
    #[account(
        init,
        payer = admin,
        space = 8 + GachaState::INITIAL_SIZE,
        seeds = [b"gacha_state".as_ref()],
        bump
    )]
    pub gacha_state: Account<'info, GachaState>,
    /// The admin account that will own the gacha machine
    #[account(mut)]
    pub admin: Signer<'info>,
    /// System program for account creation
    pub system_program: Program<'info, System>,
}

/// Accounts required for adding a payment configuration
#[derive(Accounts)]
#[instruction(payment_mint: Pubkey)]
pub struct AddPaymentConfig<'info> {
    /// The payment config account to create (PDA)
    #[account(
        init,
        payer = admin,
        space = 8 + PaymentConfig::INIT_SPACE,
        seeds = [b"payment_config".as_ref(), gacha_state.key().as_ref(), payment_mint.as_ref()],
        bump
    )]
    pub payment_config: Account<'info, PaymentConfig>,
    /// The gacha machine state to add the config to
    #[account(
        mut,
        has_one = admin,
        // Reallocate to accommodate new payment config reference(old heap + new account)
        realloc = gacha_state.to_account_info().data_len() + 32,
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub gacha_state: Account<'info, GachaState>,
    /// Admin account (must match gacha_state.admin)
    #[account(mut)]
    pub admin: Signer<'info>,
    /// System program for account operations
    pub system_program: Program<'info, System>,
}

/// Accounts required for removing a payment configuration
#[derive(Accounts)]
#[instruction(payment_mint: Pubkey)]
pub struct RemovePaymentConfig<'info> {
    /// The payment config account to close
    #[account(
        mut,
        close = admin,
        seeds = [b"payment_config", gacha_state.key().as_ref(), payment_mint.as_ref()],
        bump = payment_config.bump,
    )]
    pub payment_config: Account<'info, PaymentConfig>,

    /// The gacha machine state to update
    #[account(
        mut,
        has_one = admin @ GachaError::IncorrectOwner
    )]
    pub gacha_state: Account<'info, GachaState>,

    /// Admin account (must match gacha_state.admin)
    #[account(mut)]
    pub admin: Signer<'info>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Accounts required for adding a key to the gacha machine
#[derive(Accounts)]
#[instruction(encrypted_key: String)]
pub struct AddKey<'info> {
    /// The gacha machine state to add the key to
    #[account(
        mut,
        has_one = admin,
        // Reallocate to accommodate new key (4 bytes for string length + key data)
        realloc = gacha_state.to_account_info().data_len() + 4 + encrypted_key.len(),
        realloc::payer = admin,
        realloc::zero = false,
        constraint = gacha_state.encrypted_keys.len() < MAX_KEYS @ GachaError::KeyPoolFull
    )]
    pub gacha_state: Account<'info, GachaState>,
    /// Admin account (must match gacha_state.admin)
    #[account(mut)]
    pub admin: Signer<'info>,
    /// System program for reallocation
    pub system_program: Program<'info, System>,
}

/// Accounts required for finalizing the gacha machine
#[derive(Accounts)]
pub struct Finalize<'info> {
    /// The gacha machine state to finalize
    #[account(
        mut,
        has_one = admin,
        // Reallocate to accommodate remaining_indices vector (2 bytes per index)
        realloc = gacha_state.to_account_info().data_len() + (gacha_state.encrypted_keys.len() * 2),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub gacha_state: Account<'info, GachaState>,
    /// Admin account (must match gacha_state.admin)
    #[account(mut)]
    pub admin: Signer<'info>,
    /// System program for reallocation
    pub system_program: Program<'info, System>,
}

/// Accounts required for admin actions (pause, halt, transfer)
#[derive(Accounts)]
pub struct AdminAction<'info> {
    /// The gacha machine state to modify
    #[account(mut, has_one = admin)]
    pub gacha_state: Account<'info, GachaState>,
    /// Admin account (must match gacha_state.admin)
    pub admin: Signer<'info>,
}

/// Accounts required for performing a gacha pull
#[derive(Accounts)]
pub struct Pull<'info> {
    /// Player state account to create for this pull (PDA)
    #[account(
        init,
        payer = user,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [b"player_state", user.key().as_ref(), &gacha_state.pull_count.to_le_bytes()],
        bump
    )]
    pub player_state: Account<'info, PlayerState>,

    /// The gacha machine state
    #[account(mut, seeds = [b"gacha_state".as_ref()], bump = gacha_state.bump)]
    pub gacha_state: Account<'info, GachaState>,

    /// Payment configuration for this pull
    #[account(
        seeds = [b"payment_config".as_ref(), gacha_state.key().as_ref(), payment_config.mint.key().as_ref()],
        bump = payment_config.bump
    )]
    pub payment_config: Account<'info, PaymentConfig>,

    /// User performing the pull
    #[account(mut)]
    pub user: Signer<'info>,

    /// Payment mint account (validated in instruction logic)
    /// CHECK: Payment mint is validated by comparing with payment_config.mint
    pub payment_mint: AccountInfo<'info>,

    /// User's payment account (SOL account or token account)
    /// CHECK: Validated in payment processing functions for owner, balance, and mint
    #[account(mut)]
    pub user_payment_account: AccountInfo<'info>,

    /// Admin's recipient account for payments
    /// CHECK: Validated in payment processing functions for owner and matching config
    #[account(mut)]
    pub admin_recipient_account: AccountInfo<'info>,

    /// Switchboard randomness account for verifiable randomness
    /// CHECK: Validated to be owned by Switchboard program
    #[account(
        owner = get_switchboard_on_demand_program_id()
    )]
    pub randomness_account_data: AccountInfo<'info>,

    /// System program for SOL transfers
    pub system_program: Program<'info, System>,
    /// Token program for SPL token transfers (optional)
    pub token_program: Option<Program<'info, Token>>,
}

/// Accounts required for settling a gacha pull
#[derive(Accounts)]
pub struct Settle<'info> {
    /// Player state account for this settlement
    #[account(
        mut,
        seeds = [b"player_state".as_ref(), user.key().as_ref(), &player_state.nonce.to_le_bytes()],
        bump = player_state.bump,
        has_one = user,
        has_one = gacha_state
    )]
    pub player_state: Account<'info, PlayerState>,
    /// The gacha machine state
    #[account(mut, seeds = [b"gacha_state".as_ref()], bump = gacha_state.bump)]
    pub gacha_state: Account<'info, GachaState>,
    /// User who performed the original pull
    pub user: Signer<'info>,

    /// Switchboard randomness account (must match the one used in pull)
    /// CHECK: Address must match player_state.randomness_account and be owned by Switchboard
    #[account(
        address = player_state.randomness_account,
        owner = get_switchboard_on_demand_program_id()
    )]
    pub randomness_account_data: AccountInfo<'info>,
}

// ========================================
// State & Events
// ========================================

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

// ========================================
// Events
// ========================================

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

// ========================================
// Errors
// ========================================

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

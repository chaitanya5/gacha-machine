#![allow(deprecated)]
#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use switchboard_on_demand::accounts::RandomnessAccountData;

declare_id!("EVqTXLBT5rkZekJQqRqVSHqHhterrAHQyQFgmtXEVzLs");

const MAX_KEYS: usize = 500;

#[program]
pub mod gacha_machine {
    use anchor_lang::system_program;

    use super::*;

    // ========================================
    // Admin Instructions
    // ========================================

    pub fn initialize(
        ctx: Context<Initialize>,
        // admin_usdt_account: Pubkey,
        // pull_price: u64,
    ) -> Result<()> {
        let gacha_state = &mut ctx.accounts.gacha_state;
        gacha_state.admin = *ctx.accounts.admin.key;
        // gacha_state.admin_usdt_account = admin_usdt_account;
        gacha_state.bump = ctx.bumps.gacha_state;
        // gacha_state.pull_price = pull_price;
        gacha_state.is_finalized = false;
        gacha_state.pull_count = 0;
        gacha_state.settle_count = 0;
        gacha_state.is_paused = false;

        emit!(GachaInitialized {
            admin: *ctx.accounts.admin.key,
            gacha_state: gacha_state.key(),
        });
        Ok(())
    }

    pub fn add_payment_config(
        ctx: Context<AddPaymentConfig>,
        payment_mint: Pubkey,
        payment_price: u64,
        payment_recipient_account: Pubkey,
    ) -> Result<()> {
        let payment_config = &mut ctx.accounts.payment_config;
        let gacha_state = &mut ctx.accounts.gacha_state;

        payment_config.gacha_state = gacha_state.key();
        payment_config.mint = payment_mint;
        payment_config.price = payment_price;
        payment_config.admin_recipient_account = payment_recipient_account;
        payment_config.bump = ctx.bumps.payment_config;

        gacha_state.payment_configs.push(payment_config.key());

        emit!(PaymentConfigAdded {
            payment_mint: payment_mint,
            payment_price: payment_price,
            payment_recipient_account: payment_recipient_account
        });
        Ok(())
    }

    pub fn add_key(ctx: Context<AddKey>, encrypted_key: String) -> Result<()> {
        let gacha_state = &mut ctx.accounts.gacha_state;
        require!(!gacha_state.is_finalized, GachaError::GachaAlreadyFinalized);
        require!(!encrypted_key.is_empty(), GachaError::EmptyKeyProvided);
        require!(
            gacha_state.encrypted_keys.len() < MAX_KEYS,
            GachaError::KeyPoolFull
        );

        gacha_state.encrypted_keys.push(encrypted_key.clone());

        emit!(KeyAdded {
            key_index: (gacha_state.encrypted_keys.len() - 1) as u16,
            key_preview: encrypted_key,
        });
        Ok(())
    }

    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        let gacha_state = &mut ctx.accounts.gacha_state;
        require!(!gacha_state.is_finalized, GachaError::GachaAlreadyFinalized);
        require!(
            !gacha_state.encrypted_keys.is_empty(),
            GachaError::NoKeysInPool
        );

        let total_keys = gacha_state.encrypted_keys.len() as u16;
        gacha_state.remaining_indices = (0..total_keys).collect();
        gacha_state.is_finalized = true;

        emit!(GachaFinalized { total_keys });
        msg!(
            "Gacha Machine finalized with {} keys. Open for business!",
            total_keys
        );
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
        ctx.accounts.gacha_state.is_paused = paused;
        emit!(GachaPausedStateChanged { paused });
        Ok(())
    }

    // pub fn update_price(ctx: Context<AdminAction>, new_price: u64) -> Result<()> {
    //     ctx.accounts.gacha_state.pull_price = new_price;
    //     emit!(PriceUpdated { new_price });
    //     Ok(())
    // }

    pub fn transfer_admin(ctx: Context<AdminAction>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.gacha_state.admin = new_admin;
        emit!(AdminTransferred { new_admin });
        Ok(())
    }

    // ========================================
    // User Instructions
    // ========================================

    pub fn pull(ctx: Context<Pull>) -> Result<()> {
        let clock = Clock::get()?;

        // Gatcha Validations
        require!(!ctx.accounts.gacha_state.is_paused, GachaError::GachaPaused);
        require!(
            ctx.accounts.gacha_state.is_finalized,
            GachaError::GachaNotFinalized
        );
        require!(
            !ctx.accounts.gacha_state.remaining_indices.is_empty(),
            GachaError::GachaIsEmpty
        );

        // Payment Config Validation - verify the payment_config is valid for this gacha machine
        require!(
            ctx.accounts
                .gacha_state
                .payment_configs
                .contains(&ctx.accounts.payment_config.key()),
            GachaError::InvalidPaymentConfig
        );

        let randomness_account = &ctx.accounts.randomness_account_data;
        // require_keys_eq!(randomness_account.owner, SWITCHBOARD_ON_DEMAND_PID, GachaError::InvalidSwitchboardAccount);

        let randomness_data = RandomnessAccountData::parse(randomness_account.data.borrow())
            .map_err(|_| GachaError::InvalidRandomnessAccount)?;
        require!(
            randomness_data.seed_slot == clock.slot - 1,
            GachaError::RandomnessNotCurrent
        );

        // Process payment based on payment method
        if ctx.accounts.payment_config.mint == system_program::ID {
            process_sol_payment(&ctx, &ctx.accounts.payment_config)?;
        } else {
            process_spl_payment(&ctx, &ctx.accounts.payment_config)?;
        }

        // Set up player state
        let player_state = &mut ctx.accounts.player_state;
        player_state.user = ctx.accounts.user.key();
        player_state.gacha_state = ctx.accounts.gacha_state.key();
        player_state.randomness_account = randomness_account.key();
        player_state.payment_mint = ctx.accounts.payment_config.mint.key();
        player_state.is_settled = false;
        player_state.pull_slot = clock.slot;
        player_state.nonce = ctx.accounts.gacha_state.pull_count;
        player_state.bump = ctx.bumps.player_state;

        ctx.accounts.gacha_state.pull_count += 1;

        Ok(())
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let gacha_state = &mut ctx.accounts.gacha_state;
        let player_state = &mut ctx.accounts.player_state;
        let clock = Clock::get()?;

        require!(!player_state.is_settled, GachaError::AlreadySettled);
        require!(gacha_state.is_finalized, GachaError::GachaNotFinalized);
        require!(
            clock.slot > player_state.pull_slot,
            GachaError::SlotNotPassed
        );

        let remaining_count = gacha_state.remaining_indices.len();
        require!(remaining_count > 0, GachaError::GachaIsEmpty);

        let randomness_data =
            RandomnessAccountData::parse(ctx.accounts.randomness_account_data.data.borrow())
                .map_err(|_| GachaError::InvalidRandomnessAccount)?;

        let random_value_bytes = randomness_data
            .get_value(clock.slot)
            .map_err(|_| GachaError::RandomnessNotResolved)?;

        let random_u64 = u64::from_le_bytes(
            random_value_bytes[0..8]
                .try_into()
                .map_err(|_| GachaError::InvalidRandomnessValue)?,
        );

        let selected_index_in_remaining = random_u64 as usize % remaining_count;
        let final_key_index = gacha_state
            .remaining_indices
            .swap_remove(selected_index_in_remaining);

        let encrypted_key_from_pool = gacha_state
            .encrypted_keys
            .get(final_key_index as usize)
            .ok_or(GachaError::IndexOutOfBounds)?
            .clone();

        player_state.is_settled = true;
        player_state.result_index = final_key_index;
        player_state.winning_encrypted_key = encrypted_key_from_pool;

        gacha_state.settle_count += 1;

        emit!(GachaResult {
            user: player_state.user,
            key_index: final_key_index,
            encrypted_key: player_state.winning_encrypted_key.clone(),
        });

        Ok(())
    }
}

// ========================================
// Payment Helper Functions
// ========================================

/// Processes SOL payment for gacha pulls
/// Validates account ownership, balances, and executes the SOL transfer
fn process_sol_payment(ctx: &Context<Pull>, payment_config: &PaymentConfig) -> Result<()> {
    // 1. Verify owners are the System Program
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

    // 2. Verify account keys match expectations
    // The user's payment account MUST be the signer themselves
    require_keys_eq!(
        ctx.accounts.user_payment_account.key(),
        ctx.accounts.user.key(),
        GachaError::AccountMismatch
    );
    // The admin recipient account MUST match the one in the config
    require_keys_eq!(
        ctx.accounts.admin_recipient_account.key(),
        payment_config.admin_recipient_account,
        GachaError::AccountMismatch
    );

    // 3. Verify balance (lamports)
    require!(
        ctx.accounts.user_payment_account.lamports() >= payment_config.price,
        GachaError::InsufficientFunds
    );

    // 4. Perform the transfer
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
/// Validates token account ownership, mint matching, balance sufficiency, and executes the token transfer
fn process_spl_payment(ctx: &Context<Pull>, payment_config: &PaymentConfig) -> Result<()> {
    let token_program = ctx
        .accounts
        .token_program
        .as_ref()
        .ok_or(GachaError::TokenProgramMissing)?;

    // 1. Verify owners are the Token Program
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

    // 2. Verify account keys match expectations
    // The mint account passed in MUST match the one in the config
    require_keys_eq!(
        ctx.accounts.payment_mint.key(),
        payment_config.mint,
        GachaError::MintMismatch
    );
    // The admin recipient account MUST match the one in the config
    require_keys_eq!(
        ctx.accounts.admin_recipient_account.key(),
        payment_config.admin_recipient_account,
        GachaError::AccountMismatch
    );

    // 3. Verify user has sufficient token balance
    let user_token_account = anchor_spl::token::TokenAccount::try_deserialize(
        &mut ctx.accounts.user_payment_account.data.borrow().as_ref(),
    )?;

    require!(
        user_token_account.amount >= payment_config.price,
        GachaError::InsufficientFunds
    );

    // 4. Perform the transfer using CPI
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

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + GachaState::INITIAL_SIZE,
        seeds = [b"gacha_state".as_ref()],
        bump
    )]
    pub gacha_state: Account<'info, GachaState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(payment_mint: Pubkey)]
pub struct AddPaymentConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + PaymentConfig::INIT_SPACE,
        seeds = [b"payment_config".as_ref(), gacha_state.key().as_ref(), payment_mint.as_ref()],
        bump
    )]
    pub payment_config: Account<'info, PaymentConfig>,
    #[account(
        mut,
        has_one = admin,
        // old heap size + payment_config
        realloc = gacha_state.to_account_info().data_len() + 32,
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub gacha_state: Account<'info, GachaState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(encrypted_key: String)]
pub struct AddKey<'info> {
    #[account(
        mut,
        has_one = admin,
        // old heap size + 4(string prefix) + the key's length
        realloc = gacha_state.to_account_info().data_len() + 4 + encrypted_key.len(),
        realloc::payer = admin,
        realloc::zero = false,
        constraint = gacha_state.encrypted_keys.len() < MAX_KEYS @ GachaError::KeyPoolFull
    )]
    pub gacha_state: Account<'info, GachaState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(
        mut,
        has_one = admin,
        // old heap size + the key's length * 2 for u16.
        realloc = gacha_state.to_account_info().data_len() + (gacha_state.encrypted_keys.len() * 2),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub gacha_state: Account<'info, GachaState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(mut, has_one = admin)]
    pub gacha_state: Account<'info, GachaState>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct Pull<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [b"player_state", user.key().as_ref(), &gacha_state.pull_count.to_le_bytes()],
        bump
    )]
    pub player_state: Account<'info, PlayerState>,

    #[account(mut, seeds = [b"gacha_state".as_ref()], bump = gacha_state.bump)]
    pub gacha_state: Account<'info, GachaState>,

    #[account(
        seeds = [b"payment_config".as_ref(), gacha_state.key().as_ref(), payment_config.mint.key().as_ref()],
        bump = payment_config.bump
    )]
    pub payment_config: Account<'info, PaymentConfig>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Payment mint is validated in instruction logic by comparing with payment_config.mint
    pub payment_mint: AccountInfo<'info>,

    /// CHECK: User payment account is validated in instruction logic for owner, balance, and mint matching
    #[account(mut)]
    pub user_payment_account: AccountInfo<'info>,

    /// CHECK: Admin recipient account is validated in instruction logic for owner and mint matching
    #[account(mut)]
    pub admin_recipient_account: AccountInfo<'info>,

    /// CHECK: Verified in instruction logic
    pub randomness_account_data: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Option<Program<'info, Token>>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [b"player_state".as_ref(), user.key().as_ref(), &player_state.nonce.to_le_bytes()],
        bump = player_state.bump,
        has_one = user,
        has_one = gacha_state
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(mut, seeds = [b"gacha_state".as_ref()], bump = gacha_state.bump)]
    pub gacha_state: Account<'info, GachaState>,
    pub user: Signer<'info>,

    #[account(address = player_state.randomness_account)]
    /// CHECK: Address is checked against player_state
    pub randomness_account_data: AccountInfo<'info>,
}

// ========================================
// State & Events
// ========================================

#[account]
pub struct GachaState {
    pub admin: Pubkey,
    // pub admin_usdt_account: Pubkey,
    pub bump: u8,
    pub is_finalized: bool,
    pub is_paused: bool,
    // pub pull_price: u64,
    pub pull_count: u64,
    pub settle_count: u64,
    pub encrypted_keys: Vec<String>,
    pub remaining_indices: Vec<u16>,
    pub payment_configs: Vec<Pubkey>,
}

// Implement initital size for the GachaState
impl GachaState {
    pub const INITIAL_SIZE: usize = 32 + 1 + 1 + 1 + 8 + 8 + 8
    + 4 // only the encrypted_keys vector, realloc'd later
    + 4 // only the remaining_indices vector, realloc'd later
    + 4; // Payment Config vector
}

#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub user: Pubkey,
    pub gacha_state: Pubkey,
    pub randomness_account: Pubkey,
    pub payment_mint: Pubkey,
    pub is_settled: bool,
    pub result_index: u16,
    #[max_len(120)]
    pub winning_encrypted_key: String,
    pub bump: u8,
    pub pull_slot: u64,
    pub nonce: u64,
}

#[account]
#[derive(InitSpace)]
pub struct PaymentConfig {
    pub gacha_state: Pubkey,
    pub mint: Pubkey, // The SPL token mint, or SystemProgram::id() for SOL
    pub price: u64,
    pub admin_recipient_account: Pubkey, // Admin's ATA for SPL, or Admin's Pubkey for SOL
    pub bump: u8,
}

#[event]
pub struct GachaResult {
    pub user: Pubkey,
    pub key_index: u16,
    pub encrypted_key: String,
}

#[event]
pub struct GachaInitialized {
    pub admin: Pubkey,
    pub gacha_state: Pubkey,
}

#[event]
pub struct KeyAdded {
    pub key_index: u16,
    pub key_preview: String,
}

#[event]
pub struct GachaFinalized {
    pub total_keys: u16,
}

#[event]
pub struct GachaPausedStateChanged {
    pub paused: bool,
}

#[event]
pub struct PriceUpdated {
    pub new_price: u64,
}

#[event]
pub struct AdminTransferred {
    pub new_admin: Pubkey,
}

#[event]
pub struct PaymentConfigAdded {
    payment_mint: Pubkey,
    payment_price: u64,
    payment_recipient_account: Pubkey,
}

// ========================================
// Errors
// ========================================

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
    #[msg("The provided Switchboard account is invalid or owned by the wrong program.")]
    InvalidSwitchboardAccount,
    #[msg("Randomness has not been resolved by the oracle yet.")]
    RandomnessNotResolved,
    #[msg("The randomness seed is for a past slot and is no longer valid for a new pull.")]
    RandomnessNotCurrent,
    #[msg("Cannot settle in the same slot as the pull. Please wait for the next slot.")]
    SlotNotPassed,
    #[msg("The gacha machine is currently paused by the admin.")]
    GachaPaused,
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

// (Simplified example - requires full Anchor/Rust boilerplate)

// pub fn transfer_assets(
//     ctx: Context<TransferAssets>,
//     amount: u64,
// ) -> Result<()> {
//     // Check if a SPL token mint is provided in the context
//     if let Some(token_program) = &ctx.accounts.spl_token_program {
//         // SPL Token Transfer Logic
//         // ... use the SPL Token program via CPI ...
//         // `spl_token::transfer(CpiContext::new(
//         //     token_program.to_account_info(),
//         //     CpiContext::new(
//         //         ctx.accounts.sender_token_account.to_account_info(),
//         //         ctx.accounts.recipient_token_account.to_account_info(),
//         //         ctx.accounts.mint.to_account_info(),
//         //     ),
//         // ), amount)?;`
//     } else {
//         // SOL Transfer Logic
//         // `solana_program::system_program::transfer(
//         //     &ctx.accounts.from,
//         //     &ctx.accounts.to,
//         //     amount,
//         // )?;`
//     }
//     Ok(())
// }

// #[derive(Accounts)]
// pub struct TransferAssets<'info> {
//     // Accounts for SOL transfer
//     #[account(mut)]
//     pub from: Signer<'info>,
//     /// CHECK: account to be funded with SOL
//     #[account(mut)]
//     pub to: UncheckedAccount<'info>,
//     pub system_program: Program<'info, System>,

//     // Accounts for SPL Token transfer
//     pub spl_token_program: Option<Program<'info, TokenProgram>>,
//     #[account(mut)]
//     pub sender_token_account: Option<Account<'info, TokenAccount>>,
//     #[account(mut)]
//     pub recipient_token_account: Option<Account<'info, TokenAccount>>,
//     pub mint: Option<Account<'info, Mint>>,
// }

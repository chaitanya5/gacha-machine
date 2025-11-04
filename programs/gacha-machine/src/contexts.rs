use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use switchboard_on_demand::get_switchboard_on_demand_program_id;

use crate::{
    constants::*,
    errors::GachaError,
    states::{GachaState, PaymentConfig, PlayerState},
};

/// ========================================
/// Account Structs
/// ========================================

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
        owner = get_switchboard_on_demand_program_id() @ GachaError::InvalidRandomnessOwner
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
        address = player_state.randomness_account @ GachaError::InvalidRandomnessPlayerAccount,
        owner = get_switchboard_on_demand_program_id() @ GachaError::InvalidRandomnessOwner
    )]
    pub randomness_account_data: AccountInfo<'info>,
}

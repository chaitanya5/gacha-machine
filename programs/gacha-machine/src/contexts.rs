use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use switchboard_on_demand::get_switchboard_on_demand_program_id;

use crate::{constants::*, errors::*, states::*};

/// ========================================
/// Account Structs
/// ========================================

/// Accounts required for initializing a new gacha factory
#[derive(Accounts)]
pub struct InitializeGachaFactory<'info> {
    /// The gacha factory state account (PDA)
    #[account(
        init,
        payer = admin,
        space = 8 + GachaFactory::INIT_SPACE,
        seeds = [GACHA_FACTORY],
        bump
    )]
    pub gacha_factory: Account<'info, GachaFactory>,
    /// The admin account that will own the gacha factory
    #[account(mut)]
    pub admin: Signer<'info>,
    /// System program for account creation
    pub system_program: Program<'info, System>,
}

/// Accounts required for initializing a new gacha machine
#[derive(Accounts)]
pub struct CreateGacha<'info> {
    /// The gacha factory state account (PDA)
    #[account(
        has_one = admin,
        seeds = [GACHA_FACTORY],
        bump
    )]
    pub gacha_factory: Account<'info, GachaFactory>,
    /// The gacha machine state account (PDA)
    #[account(
        init,
        payer = admin,
        space = 8 + GachaState::INIT_SPACE,
        seeds = [GACHA_STATE, gacha_factory.key().as_ref(), gacha_factory.gacha_count.to_le_bytes().as_ref()],
        bump
    )]
    pub gacha_state: Account<'info, GachaState>,
    /// Metadata account PDA created with maximum CPI size
    #[account(
        init,
        payer = admin,
        // space = 10200,
        space = 10 * (1024 as usize),
        seeds = [METADATA, gacha_factory.key().as_ref(), gacha_state.key().as_ref()],
        bump,
    )]
    pub metadata: AccountLoader<'info, GachaMachineMetadata>,

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
    /// The gacha factory state account (PDA)
    #[account(
        has_one = admin,
        seeds = [GACHA_FACTORY],
        bump
    )]
    pub gacha_factory: Account<'info, GachaFactory>,
    /// The gacha machine state to add the config to
    #[account(
        has_one = gacha_factory,
    )]
    pub gacha_state: Account<'info, GachaState>,
    /// The payment config account to create (PDA)
    #[account(
        init,
        payer = admin,
        space = 8 + PaymentConfig::INIT_SPACE,
        seeds = [PAYMENT_CONFIG, gacha_factory.key().as_ref(), gacha_state.key().as_ref(), payment_mint.as_ref()],
        bump
    )]
    pub payment_config: Account<'info, PaymentConfig>,
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
    /// The gacha factory state account (PDA)
    #[account(
        has_one = admin,
        seeds = [GACHA_FACTORY],
        bump
    )]
    pub gacha_factory: Account<'info, GachaFactory>,

    /// The gacha machine state to add the config to
    #[account(
        has_one = gacha_factory,
    )]
    pub gacha_state: Account<'info, GachaState>,

    /// The payment config account to close
    #[account(
        mut,
        close = admin,
        seeds = [PAYMENT_CONFIG, gacha_factory.key().as_ref(), gacha_state.key().as_ref(), payment_mint.as_ref()],
        bump = payment_config.bump,
    )]
    pub payment_config: Account<'info, PaymentConfig>,

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
    /// The gacha factory state account (PDA)
    #[account(
        has_one = admin,
        seeds = [GACHA_FACTORY],
        bump = gacha_factory.bump,
    )]
    pub gacha_factory: Account<'info, GachaFactory>,

    /// The gacha machine state to add the config to
    #[account(
        has_one = gacha_factory,
    )]
    pub gacha_state: Account<'info, GachaState>,

    /// The Metadata account to create (PDA)
    #[account(
        mut,
        seeds = [METADATA, gacha_factory.key().as_ref(), gacha_state.key().as_ref()],
        bump = metadata.load()?.bump,
    )]
    pub metadata: AccountLoader<'info, GachaMachineMetadata>,

    /// Admin account (must match gacha_state.admin)
    #[account(mut)]
    pub admin: Signer<'info>,
    /// System program for reallocation
    pub system_program: Program<'info, System>,
}

/// Accounts required for finalizing the gacha machine
#[derive(Accounts)]
pub struct Finalize<'info> {
    /// The gacha factory state account (PDA)
    #[account(
        has_one = admin,
        seeds = [GACHA_FACTORY],
        bump = gacha_factory.bump
    )]
    pub gacha_factory: Account<'info, GachaFactory>,

    /// The gacha machine state to add the config to
    #[account(
        mut,
        has_one = gacha_factory,
    )]
    pub gacha_state: Account<'info, GachaState>,

    /// The Metadata account to create (PDA)
    #[account(
        mut,
        seeds = [METADATA, gacha_factory.key().as_ref(), gacha_state.key().as_ref()],
        bump = metadata.load()?.bump,
    )]
    pub metadata: AccountLoader<'info, GachaMachineMetadata>,

    /// Admin account
    #[account(mut)]
    pub admin: Signer<'info>,
}

/// Accounts required for admin actions (pause, halt, transfer)
#[derive(Accounts)]
pub struct AdminAction<'info> {
    /// The gacha factory state account (PDA)
    #[account(
        has_one = admin,
        seeds = [GACHA_FACTORY],
        bump
    )]
    pub gacha_factory: Account<'info, GachaFactory>,

    /// The gacha machine state to modify
    #[account(
        mut,
        has_one = gacha_factory
    )]
    pub gacha_state: Account<'info, GachaState>,

    /// The Metadata account to create (PDA)
    #[account(
        mut,
        seeds = [METADATA, gacha_factory.key().as_ref(), gacha_state.key().as_ref()],
        bump = metadata.load()?.bump,
    )]
    pub metadata: AccountLoader<'info, GachaMachineMetadata>,

    /// Admin account (must match gacha_state.admin)
    pub admin: Signer<'info>,
}

/// Accounts required for performing a gacha pull
#[derive(Accounts)]
pub struct Pull<'info> {
    /// The gacha factory state account (PDA)
    #[account(
        seeds = [GACHA_FACTORY],
        bump
    )]
    pub gacha_factory: Account<'info, GachaFactory>,
    /// The gacha machine state
    #[account(
        mut,
        has_one = gacha_factory,
    )]
    pub gacha_state: Account<'info, GachaState>,

    /// Payment configuration for this pull
    #[account(
        has_one = gacha_state,
        seeds = [PAYMENT_CONFIG, gacha_factory.key().as_ref(), gacha_state.key().as_ref(), payment_config.mint.key().as_ref()],
        bump = payment_config.bump,
    )]
    pub payment_config: Account<'info, PaymentConfig>,

    /// The metadata account
    #[account(
        has_one = gacha_state,
        seeds = [METADATA, gacha_factory.key().as_ref(), gacha_state.key().as_ref()],
        // bump,
        bump = metadata.load()?.bump,
    )]
    pub metadata: AccountLoader<'info, GachaMachineMetadata>,

    /// Player state account to create for this pull (PDA)
    #[account(
        init,
        payer = user,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [PLAYER_STATE, GACHA_STATE, user.key().as_ref(), &gacha_state.pull_count.to_le_bytes()],
        bump
    )]
    pub player_state: Account<'info, PlayerState>,

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
    /// The gacha factory state account (PDA)
    #[account(
        seeds = [GACHA_FACTORY],
        bump
    )]
    pub gacha_factory: Account<'info, GachaFactory>,

    /// The gacha machine state
    #[account(
        mut,
        has_one = gacha_factory,
    )]
    pub gacha_state: Account<'info, GachaState>,

    /// The metadata account
    #[account(
        mut,
        has_one = gacha_state,
        seeds = [METADATA, gacha_factory.key().as_ref(), gacha_state.key().as_ref()],
        bump = metadata.load()?.bump,
    )]
    pub metadata: AccountLoader<'info, GachaMachineMetadata>,

    /// Player state account for this settlement
    #[account(
        mut,
        has_one = user,
        has_one = gacha_state,
        seeds = [PLAYER_STATE, GACHA_STATE, user.key().as_ref(), &player_state.nonce.to_le_bytes()],
        bump = player_state.bump,
    )]
    pub player_state: Account<'info, PlayerState>,

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

/// Accounts required for resizing the metadata account
#[derive(Accounts)]
pub struct ResizeMetadata<'info> {
    /// The gacha factory state account (PDA)
    #[account(
        has_one = admin,
        seeds = [GACHA_FACTORY],
        bump
    )]
    pub gacha_factory: Account<'info, GachaFactory>,

    /// The gacha machine state to modify
    #[account(
        has_one = gacha_factory
    )]
    pub gacha_state: Account<'info, GachaState>,

    #[account(
        mut,
        seeds = [METADATA, gacha_factory.key().as_ref(), gacha_state.key().as_ref()],
        bump,
        // realloc = 10000,
        realloc = 10 * (1024 as usize),
        realloc::payer = admin,
        realloc::zero = true,
    )]
    pub metadata: AccountLoader<'info, GachaMachineMetadata>,

    /// Admin account (must match gacha_state.admin)
    #[account(mut)]
    pub admin: Signer<'info>,

    /// System program for reallocation
    pub system_program: Program<'info, System>,
}

/// Accounts required for setting the metadata account
#[derive(Accounts)]
pub struct InitializeMetadata<'info> {
    /// The gacha factory state account (PDA)
    #[account(
        has_one = admin,
        seeds = [GACHA_FACTORY],
        bump
    )]
    pub gacha_factory: Account<'info, GachaFactory>,

    /// The gacha machine state to modify
    #[account(
        has_one = gacha_factory
    )]
    pub gacha_state: Account<'info, GachaState>,

    #[account(
        mut,
        seeds = [METADATA, gacha_factory.key().as_ref(), gacha_state.key().as_ref()],
        bump,
        // realloc = 10200,
        // realloc::payer = admin,
        // realloc::zero = true,
    )]
    pub metadata: AccountLoader<'info, GachaMachineMetadata>,

    /// Admin account (must match gacha_state.admin)
    #[account(mut)]
    pub admin: Signer<'info>,

    /// System program for reallocation
    pub system_program: Program<'info, System>,
}

/// Accounts required for closing all the accounts
#[derive(Accounts)]
pub struct CloseAllAccounts<'info> {
    /// The gacha factory state account (PDA)
    #[account(
        mut,
        close = admin,
        has_one = admin,
        seeds = [GACHA_FACTORY],
        bump,
    )]
    pub gacha_factory: Account<'info, GachaFactory>,

    /// The gacha machine state to modify
    #[account(
        mut,
        close = admin,
        has_one = gacha_factory
    )]
    pub gacha_state: Account<'info, GachaState>,

    #[account(
        mut,
        close = admin,
        seeds = [METADATA, gacha_factory.key().as_ref(), gacha_state.key().as_ref()],
        bump,
        // realloc = 10200,
        // realloc::payer = admin,
        // realloc::zero = true,
    )]
    pub metadata: AccountLoader<'info, GachaMachineMetadata>,

    /// Admin account (must match gacha_state.admin)
    #[account(mut)]
    pub admin: Signer<'info>,

    /// System program for reallocation
    pub system_program: Program<'info, System>,
}

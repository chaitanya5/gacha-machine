// Gacha Machine Program
//
// A Solana program that implements a gacha (lottery) system where users can:
// - Pull from a pool of encrypted keys using SOL or SPL tokens as payment
// - Receive randomized rewards determined by Switchboard oracles
//
// The program supports multiple payment configurations, admin controls for pausing/halting,
// and uses verifiable randomness for fair reward distribution.

#![allow(deprecated)]
#![allow(unexpected_cfgs)]

pub mod constants;
pub mod contexts;
pub mod errors;
pub mod events;
pub mod helpers;
pub mod instructions;
pub mod states;

use anchor_lang::prelude::*;

pub use constants::*;
pub use contexts::*;
pub use errors::*;
pub use events::*;
pub use helpers::*;
pub use states::*;

declare_id!("Bev1vGX4L4n9osJkdhG1Nig4K1mS3ELhDUwrpwVFybh4");

#[program]
pub mod gacha_machine {
    use super::*;

    pub fn initialize_gacha_factory(ctx: Context<InitializeGachaFactory>) -> Result<()> {
        instructions::initialize_gacha_factory(ctx)
    }

    pub fn create_gacha(ctx: Context<CreateGacha>) -> Result<()> {
        instructions::create_gacha(ctx)
    }

    pub fn initialize_metadata(ctx: Context<InitializeMetadata>) -> Result<()> {
        instructions::initialize_metadata(ctx)
    }

    pub fn resize_metadata(ctx: Context<ResizeMetadata>, new_size: u32) -> Result<()> {
        instructions::resize_metadata(ctx, new_size)
    }

    pub fn add_payment_config(
        ctx: Context<AddPaymentConfig>,
        payment_mint: Pubkey,
        payment_price: u64,
        payment_recipient_account: Pubkey,
    ) -> Result<()> {
        instructions::add_payment_config(
            ctx,
            payment_mint,
            payment_price,
            payment_recipient_account,
        )
    }

    pub fn remove_payment_config(
        ctx: Context<RemovePaymentConfig>,
        payment_mint: Pubkey,
    ) -> Result<()> {
        instructions::remove_payment_config(ctx, payment_mint)
    }

    pub fn add_keys(ctx: Context<AddKey>, encrypted_keys: Vec<String>) -> Result<()> {
        instructions::add_keys(ctx, encrypted_keys)
    }

    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        instructions::finalize(ctx)
    }

    pub fn set_paused(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
        instructions::set_paused(ctx, paused)
    }

    pub fn set_halted(ctx: Context<AdminAction>, halted: bool) -> Result<()> {
        instructions::set_halted(ctx, halted)
    }

    pub fn transfer_admin(ctx: Context<AdminAction>, new_admin: Pubkey) -> Result<()> {
        instructions::transfer_admin(ctx, new_admin)
    }

    pub fn release_decryption_key(ctx: Context<AdminAction>, decryption_key: String) -> Result<()> {
        instructions::release_decryption_key(ctx, decryption_key)
    }

    pub fn pull(ctx: Context<Pull>) -> Result<()> {
        instructions::pull(ctx)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::settle(ctx)
    }

    pub fn close_all(_ctx: Context<CloseAllAccounts>) -> Result<()> {
        Ok(())
    }
}

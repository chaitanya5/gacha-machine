use crate::{contexts::*, errors::GachaError, states::PaymentConfig};

use anchor_lang::prelude::*;

/// ========================================
/// Payment Helper Functions
/// ========================================

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
pub fn process_sol_payment(ctx: &Context<Pull>, payment_config: &PaymentConfig) -> Result<()> {
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
pub fn process_spl_payment(ctx: &Context<Pull>, payment_config: &PaymentConfig) -> Result<()> {
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

/// Helper to convert string to a fixed-size byte array
pub fn string_to_fixed_bytes<const N: usize>(input: &str) -> [u8; N] {
    let mut arr = [0u8; N]; // Create a fixed-size array initialized with zeros
    let bytes = input.as_bytes();
    let copy_len = std::cmp::min(N, bytes.len());
    if copy_len > 0 {
        arr[..copy_len].copy_from_slice(&bytes[..copy_len]); // Copy the bytes
    }
    arr
}

/// Helper to convert bytes to a UTF-8 string, trimming trailing zeros
pub fn bytes_to_string(input: &[u8]) -> Result<String> {
    // Find the position of the last non-zero byte
    let trimmed_len = input
        .iter()
        .rposition(|&b| b != 0)
        .map(|pos| pos + 1)
        .unwrap_or(0);

    // Convert the trimmed slice to a UTF-8 string
    String::from_utf8(input[..trimmed_len].to_vec())
        .map_err(|_| error!(GachaError::InvalidUtf8String))
}

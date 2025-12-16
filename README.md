# Solana Gacha Machine

A decentralized lottery/gacha system built on Solana that enables users to purchase randomized rewards using SOL, USDT, or USDC. The program uses Switchboard oracles for verifiable randomness and stores encrypted reward URLs that can be revealed after purchase.

## Project Structure

```
gacha-machine/
├── programs/gacha-machine/src/    # Solana program source code
├── scripts/                      # Deployment and utility scripts
├── config/                       # Configuration files
│   ├── shared.json               # Network configurations and pricing
│   └── urls.json                 # Encrypted reward URLs
├── tests/                        # Test files
└── README.md                     # This file
```

## Prerequisites

- **Rust** 1.91
- **Solana** 2.2.12
- **Anchor CLI** 0.31.1
- **Node.js** 22.15.1
- **pnpm**

## Configuration

The `/config` folder contains:
- **`shared.json`**: Network configurations, encryption keys, payment token details, and pricing
- **`urls.json`**: Array of NFT addresses that will be encrypted and added to the gacha machine

Edit these files according to your needs before deployment.

**Note**
The Gacha program requires a fixed pull price across all accepted currencies to maintain consistency with the frontend. For example, a $100 Gacha machine should be configured with 100 USDT and 0.78 SOL. If a higher tier is needed, such as a $200 machine, a separate Solana program must be deployed and configured with prices of 200 USDT and 1.55 SOL.

## Installation
**Install dependencies:**
```bash
pnpm install
```
## Compilation

Build the Solana rust program:

```bash
anchor build
```

## Deployment
Ensure that you have the necessary Solana tools installed and configured. A file based solana wallet, funded with SOL(airdrop wallet for devnet). This wallet may/maynot act as the Gacha Machine program's admin.

```bash
# Fund the new wallet (devnet)
solana airdrop 2 <NEW_PUBLIC_KEY> --url devnet
```

### Generate New Keypair.
Create a new Solana keypair for a fresh deployment. This will be the Gacha Machine program's public key different from the file based wallet.

```bash
# Generate new keypair
solana-keygen new -f -o target/deploy/gacha_machine-keypair.json

# Sync the program with the new generated wallet above
anchor keys sync

# Rebuild as the the program code changed after keys got synced
anchor build

```

## Program Deployment

### 1. Deploy the Program

```bash
# For mainnet
anchor deploy --provider.cluster mainnet

# For devnet
anchor deploy --provider.cluster devnet
```

### 2. Run the Deployment Script
The `deploy.ts` script automates the complete setup process:

```bash
# For mainnet  
npx ts-node scripts/deploy.ts <ADMIN_PRIVATE_KEY> mainnet
```

**What the deploy script does:**
- Initializes the gacha machine program after deployment
- Adds payment configurations for SOL, USDT, and USDC from `config/shared.json`
- Encrypts and populates NFT addresses from `config/urls.json` to the program
- Finalizes the gacha machine for user interactions

Replace `<ADMIN_PRIVATE_KEY>` with your admin wallet's private key (base58 encoded).

## Post-Deployment Management

### Closing the Program(Optional)
When all the keys are pulled and settled, we can close and reclaim rent from the program accounts.
But the program can stay for bookkeeping purposes.

```bash
# Close gacha state account(optional)
solana program close --bypass-warning -u mainnet-beta GPUXs6YnTGNcK8ciwYsbs3ePRbHd7PfecghYSUzYCnfj
```

## Security Considerations
- Keep encryption keys secure and never expose them
- Use strong, randomly generated admin keypairs
- Test thoroughly on devnet before mainnet deployment
- Monitor program accounts for unusual activity

## Author
Created by [chaitanya5](https://github.com/chaitanya5)

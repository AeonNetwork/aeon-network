// Central configuration. Everything can be overridden from .env so the same
// build runs locally, on a VPS, or with paid RPC/API plans.

// Load the project's .env by its own path. `--env-file` resolves against the working directory,
// which a process manager started at boot may not set; variables already set are kept.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* no .env: environment variables only */
}

const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const PORT = Number(env.PORT || 3000);

// Robinhood Chain (Arbitrum Orbit L2, gas token ETH).
// Mainnet chain ID 4663 is confirmed by DefiLlama's chain registry.
export const NETWORKS = {
  mainnet: {
    key: 'mainnet',
    name: 'Robinhood Chain',
    chainId: Number(env.RH_MAINNET_CHAIN_ID || 4663),
    rpc: [
      ...list(env.RH_MAINNET_RPC),
      env.ALCHEMY_API_KEY && `https://robinhood-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`,
      'https://rpc.mainnet.chain.robinhood.com',
    ].filter(Boolean),
    publicRpc: env.RH_MAINNET_PUBLIC_RPC || 'https://rpc.mainnet.chain.robinhood.com',
    explorer: env.RH_MAINNET_EXPLORER || 'https://robinhoodchain.blockscout.com',
    // DefiLlama's name for this chain (ecosystem, TVL, DEX, fees data).
    llamaChain: 'Robinhood Chain',
    // Covered by the hosted Blockscout PRO API (api.blockscout.com/{chainId}).
    blockscoutPro: true,
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  testnet: {
    key: 'testnet',
    name: 'Robinhood Chain Testnet',
    chainId: Number(env.RH_TESTNET_CHAIN_ID || 46630),
    rpc: [
      ...list(env.RH_TESTNET_RPC),
      env.ALCHEMY_API_KEY && `https://robinhood-testnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`,
      'https://rpc.testnet.chain.robinhood.com',
    ].filter(Boolean),
    publicRpc: env.RH_TESTNET_PUBLIC_RPC || 'https://rpc.testnet.chain.robinhood.com',
    explorer: env.RH_TESTNET_EXPLORER || 'https://explorer.testnet.chain.robinhood.com',
    faucet: env.RH_TESTNET_FAUCET || 'https://faucet.testnet.chain.robinhood.com',
    llamaChain: null,
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
};

export const DEFAULT_NETWORK = env.DEFAULT_NETWORK === 'testnet' ? 'testnet' : 'mainnet';

// The indexer reads blocks over RPC to build live activity stats.
// Robinhood Chain produces ~10 blocks per second, so the default "sample"
// mode reads only the newest block each tick (fits free RPC plans). "full"
// reads every block plus token Transfer logs — use it with a paid RPC.
export const INDEXER = {
  networks: list(env.INDEXER_NETWORKS || 'mainnet,testnet').filter((n) => NETWORKS[n]),
  mode: env.INDEXER_MODE === 'full' ? 'full' : 'sample',
  intervalMs: Number(env.INDEXER_INTERVAL_MS || (env.INDEXER_MODE === 'full' ? 1000 : 3000)),
  batchSize: Number(env.INDEXER_BATCH || 20),
  maxLag: Number(env.INDEXER_MAX_LAG || 400),
};

// Blockscout explorer API. A PRO key (proapi_…) uses the hosted multichain
// API at api.blockscout.com/{chainId}; otherwise the chain's own explorer.
export const BLOCKSCOUT = {
  key: env.BLOCKSCOUT_API_KEY || '',
  enabled: env.BLOCKSCOUT !== 'false',
  get pro() {
    return this.key.startsWith('proapi_');
  },
  // Live feed fallback (blocks/txs) when the RPC is unreachable.
  feedIntervalMs: Number(env.BLOCKSCOUT_FEED_MS || 15_000),
};

// CoinGecko is only used for the ETH/USD rate (fee and balance values).
export const COINGECKO = {
  key: env.COINGECKO_API_KEY || '',
  pro: env.COINGECKO_PLAN === 'pro',
  get base() {
    return this.pro ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
  },
};

// AI providers, tried in AI_PROVIDERS order; a provider that is rate-limited
// or down hands the question to the next one.
const PROVIDERS = {
  anthropic: { label: 'Claude', key: env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || '', model: env.AI_MODEL || 'claude-opus-5-5' },
  gemini: {
    label: 'Gemini',
    key: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-3.5-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  // Same Gemini key, lighter model: the free tier counts quota per model, so this doubles capacity.
  'gemini-lite': {
    label: 'Gemini Lite',
    key: env.GEMINI_API_KEY || '',
    model: env.GEMINI_LITE_MODEL || 'gemini-3.5-flash-lite',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  openrouter: {
    label: 'OpenRouter',
    key: env.OPENROUTER_API_KEY || '',
    model: env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free',
    baseURL: 'https://openrouter.ai/api/v1',
  },
};
const order = list(env.AI_PROVIDERS || 'anthropic,gemini,gemini-lite,openrouter').filter((p) => PROVIDERS[p]?.key);

export const AI = {
  providers: order.map((name) => ({ name, ...PROVIDERS[name] })),
  get enabled() {
    return this.providers.length > 0;
  },
  // Anthropic-specific options
  effort: env.AI_EFFORT || 'medium',
  webSearch: env.AI_WEB_SEARCH !== 'false',
  maxRequests: Number(env.AI_MAX_REQUESTS || 15),
  windowMs: Number(env.AI_WINDOW_MINUTES || 10) * 60_000,
  dailyLimit: Number(env.AI_DAILY_LIMIT || 400),
};

export const CACHE_DIR = env.CACHE_DIR || '.cache';

// The Aeon community token (Robinhood Chain mainnet, launched on Pons) and holder perks.
export const AEON_TOKEN = {
  network: 'mainnet',
  address: '0xb4fc414ac279bb3136e3cf7ec5084846af3bb459',
  launchedOn: 'Pons',
  // Wallet that launched the token on Pons; its launch buy was sent to 0x…dEaD.
  creator: '0xa22b97201Dda33bF5946CF991757Af904532d4A1',
  creatorBuyTx: '0x185257d8d417a49e78f12152842613c0308eec3f9db276f415d164176fe3af33',
  creatorBurnTx: '0x0d6c18b2022a8c06680e79e2ae8e55161bfdf6a5561641890d2644e420f81f0a',
  // Any team wallets are disclosed here (comma-separated) and shown on the token page.
  teamWallets: (env.AEON_TEAM_WALLETS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Known contracts among the holders.
  labels: { '0x8d9948e74653e10ac992f2649cbe873a9517b0b0': 'Pons bonding curve', '0x000000000000000000000000000000000000dead': 'Burn address' },
  holderMin: Number(env.AEON_HOLDER_MIN || 1_000_000),
  holderAiMultiplier: 4,
  // HMAC key for holder passes; set AEON_PASS_SECRET in .env to keep passes valid across restarts.
  passSecret: env.AEON_PASS_SECRET || '',
};

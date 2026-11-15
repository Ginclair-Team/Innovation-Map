// Site-level settings that are not data.
export const CREDIT = {
  label: 'ginclair.com/ginhouse',
  url: 'https://ginclair.com/ginhouse',
};

export const SITE_TITLE = 'India Innovation Density Map';

/** Sequential ramp, cream through salmon to deep brown. One hue family, lightness falls monotonically. */
export const RAMP = ['#FBEBDD', '#F9D2BC', '#F4AE95', '#E98670', '#CC5F49', '#9A3F2D', '#5E2618'];

export const LAYERS = ['composite', 'startups', 'fdi_usd_m', 'funding_usd_m'] as const;

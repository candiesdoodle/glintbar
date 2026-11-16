export type CurrencyConfig = {
  from: string;
  to: string;
  /** The amount the user typed; kept between sessions. */
  amount: number;
  /** Extra currencies listed in the card. */
  favorites: string[];
};

export const DEFAULT_CURRENCY: CurrencyConfig = { from: "USD", to: "EUR", amount: 100, favorites: ["GBP", "JPY", "INR", "CNY", "CAD"] };

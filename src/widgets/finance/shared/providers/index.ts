import { dodo } from "./dodo";
import { gumroad } from "./gumroad";
import { lemonsqueezy } from "./lemonsqueezy";
import { paddle } from "./paddle";
import { polar } from "./polar";
import { shopify } from "./shopify";
import { stripe } from "./stripe";
import type { RevenueProvider } from "../revenue";

export { dodo, gumroad, lemonsqueezy, paddle, polar, shopify, stripe };

/** Every store, in picker order. */
export const PROVIDERS: RevenueProvider[] = [stripe, polar, dodo, shopify, lemonsqueezy, paddle, gumroad];

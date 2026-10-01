import { calc } from "./cart.mjs";

export const checkout = (items) => `total=${calc(items)}`;

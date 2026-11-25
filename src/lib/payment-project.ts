// Every Stripe object this store creates is tagged with this project name, so a Stripe account
// shared by several websites only processes its own payments and refunds here.
// Change it if you run more than one copy of this store on the same Stripe account.
export const PAYMENT_PROJECT = 'defou-shop';

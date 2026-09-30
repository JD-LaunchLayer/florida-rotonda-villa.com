// Secrets are set with `wrangler secret put` and are not part of wrangler.jsonc.
// This augments the generated Env interface.
interface Env {
  EMAIL_API_KEY?: string;
  EMAIL_API_URL?: string;
  BANK_ACCOUNT_NAME?: string;
  BANK_SORT_CODE?: string;
  BANK_ACCOUNT_NUMBER?: string;
  APPROVAL_SECRET?: string;
  ALLOW_LOCALHOST?: string;
}

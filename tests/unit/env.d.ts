declare module "cloudflare:test" {
  // Wrangler Env surface for SELF / bindings inside the Workers test pool.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- required module augmentation
  interface ProvidedEnv extends Env {}
}

type SiteVerifyResponse = {
  success?: boolean;
};

export async function verifyTurnstile(opts: {
  secret: string;
  token: string | undefined;
  ip: string | null;
}): Promise<boolean> {
  if (!opts.token) {
    return false;
  }
  const body = new URLSearchParams();
  body.set("secret", opts.secret);
  body.set("response", opts.token);
  if (opts.ip) {
    body.set("remoteip", opts.ip);
  }
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) {
    return false;
  }
  const data = (await response.json()) as SiteVerifyResponse;
  return data.success === true;
}

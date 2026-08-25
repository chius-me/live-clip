import { sha256Hex } from "../shared/crypto";
import { generateEditSecret, generateRoomId, isValidRoomId } from "../shared/ids";
import { isAllowedOrigin } from "../shared/origin";
import { Room } from "../durable-objects/room";
import { isProduction } from "./env";
import { htmlResponse, jsonResponse, withSecurityHeaders } from "./headers";
import { verifyTurnstile } from "./turnstile";

export { Room };

type CreateRoomBody = {
  turnstileToken?: string;
};

function clientIp(request: Request): string | null {
  return request.headers.get("CF-Connecting-IP");
}

function turnstileSecret(env: Env): string | undefined {
  const extra = env as Env & { TURNSTILE_SECRET?: string };
  return extra.TURNSTILE_SECRET || undefined;
}

function turnstilePage(siteKey: string): string {
  const escaped = siteKey.replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LiveClip</title>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #d8d5ce; color: #161615; }
      main { max-width: 28rem; margin: 20vh auto; padding: 1.5rem; background: #e8e6df; border: 1px solid #9e9a90; }
      h1 { font-size: 0.9rem; margin: 0 0 0.75rem; letter-spacing: 0.16em; font-family: ui-monospace, monospace; }
      p { font-size: 0.9rem; color: #3a3936; }
      button { margin-top: 1rem; padding: 0.5rem 0.8rem; background: #8d5a2b; color: #f0eee8; border: 1px solid #8d5a2b; }
    </style>
  </head>
  <body>
    <main>
      <h1>LIVECLIP</h1>
      <p>验证后创建新的实时文档。</p>
      <form id="form">
        <div class="cf-turnstile" data-sitekey="${escaped}"></div>
        <button type="submit">创建文档</button>
      </form>
      <p id="err" hidden></p>
    </main>
    <script>
      const form = document.getElementById("form");
      const err = document.getElementById("err");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const token = document.querySelector("[name=cf-turnstile-response]")?.value;
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ turnstileToken: token }),
        });
        if (!res.ok) {
          err.hidden = false;
          err.textContent = "创建失败，请重试。";
          return;
        }
        const data = await res.json();
        location.assign("/p/" + data.roomId + "#" + data.editSecret);
      });
    </script>
  </body>
</html>`;
}

async function createRoom(env: Env): Promise<{ roomId: string; editSecret: string }> {
  const roomId = generateRoomId();
  const editSecret = generateEditSecret();
  const editSecretHash = await sha256Hex(editSecret);
  const stub = env.ROOMS.getByName(roomId);
  await stub.init(editSecretHash);
  return { roomId, editSecret };
}

async function handleCreate(
  request: Request,
  env: Env,
): Promise<{ roomId: string; editSecret: string } | Response> {
  const secret = turnstileSecret(env);
  if (secret) {
    let token: string | undefined;
    if (request.method === "POST") {
      try {
        const body = (await request.json()) as CreateRoomBody;
        token = body.turnstileToken;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
    }
    const ok = await verifyTurnstile({ secret, token, ip: clientIp(request) });
    if (!ok) {
      return jsonResponse({ error: "Turnstile verification failed" }, 403);
    }
  }
  return createRoom(env);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "liveclip", now: Date.now() });
  }

  if (url.pathname === "/" && request.method === "GET") {
    if (turnstileSecret(env) && env.TURNSTILE_SITE_KEY) {
      return htmlResponse(turnstilePage(env.TURNSTILE_SITE_KEY));
    }
    const created = await handleCreate(request, env);
    if (created instanceof Response) {
      return created;
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/p/${created.roomId}#${created.editSecret}`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (url.pathname === "/api/rooms" && request.method === "POST") {
    const created = await handleCreate(request, env);
    if (created instanceof Response) {
      return created;
    }
    return jsonResponse({
      roomId: created.roomId,
      editSecret: created.editSecret,
      readPath: `/p/${created.roomId}`,
      editPath: `/p/${created.roomId}#${created.editSecret}`,
    });
  }

  const wsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
  if (wsMatch && request.method === "GET") {
    const roomId = wsMatch[1];
    if (!isValidRoomId(roomId)) {
      return jsonResponse({ error: "Invalid room id" }, 400);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ error: "Expected WebSocket upgrade" }, 426);
    }
    if (!isAllowedOrigin(request.headers.get("Origin"), request.url, env.ALLOWED_ORIGINS)) {
      return jsonResponse({ error: "Invalid origin" }, 403);
    }
    const stub = env.ROOMS.getByName(roomId);
    return stub.fetch(request);
  }

  if (!env.ASSETS) {
    return jsonResponse({ error: "Not found" }, 404);
  }
  return withSecurityHeaders(await env.ASSETS.fetch(request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: "unhandled",
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
      const message = isProduction(env)
        ? "Internal error"
        : error instanceof Error
          ? error.message
          : "Internal error";
      return jsonResponse({ error: message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

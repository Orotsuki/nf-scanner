import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://orotsuki.github.io";

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin && origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Vary": "Origin",
  };
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("Origin");
  return !origin || origin === ALLOWED_ORIGIN;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Vary": "Origin",
    },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

async function usernameEmail(username: string): Promise<string> {
  const normalized = username.trim().toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  return `u-${hex}@auth.nfscanner.app`;
}

function usernameFromUser(user: User): string {
  return typeof user.user_metadata?.username === "string"
    ? user.user_metadata.username
    : user.email?.split("@")[0] ?? user.id;
}

function isAdmin(user: User): boolean {
  return user.app_metadata?.role === "admin";
}

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return { error: json({ error: "Não autenticado." }, 401) };
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    return { error: json({ error: "Não autenticado." }, 401) };
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return { error: json({ error: "Sessão inválida." }, 401) };
  }

  if (!isAdmin(data.user)) {
    return { error: json({ error: "Acesso restrito ao administrador." }, 403) };
  }

  return { supabase, adminUser: data.user };
}

function validateUsername(username: string): string | null {
  const normalized = username.trim().toLowerCase();

  if (!/^[\p{L}\p{N}._-]{3,30}$/u.test(normalized)) {
    return null;
  }

  return normalized;
}

async function listUsers(supabase: ReturnType<typeof serviceClient>) {
  const users: User[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) throw error;

    users.push(...data.users);

    if (data.users.length < perPage) break;
    page += 1;
  }

  return users.map((user) => ({
    id: user.id,
    username: usernameFromUser(user),
    role: user.app_metadata?.role === "admin" ? "admin" : "user",
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at ?? null,
  }));
}

Deno.serve(async (req) => {
  if (!originAllowed(req)) {
    return new Response(JSON.stringify({ error: "Origem não autorizada." }), {
      status: 403,
      headers: {
        ...corsHeaders(req),
        "Content-Type": "application/json",
      },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  const { supabase, adminUser } = auth;

  try {
    if (req.method === "GET") {
      return json({ users: await listUsers(supabase) });
    }

    const body = await req.json().catch(() => ({}));

    if (req.method === "POST") {
      const action = typeof body?.action === "string" ? body.action : "";

      if (action === "create") {
        const username = validateUsername(
          typeof body?.username === "string" ? body.username : "",
        );

        const password = typeof body?.password === "string" ? body.password : "";

        if (!username) {
          return json({
            error: "O usuário deve ter de 3 a 30 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.",
          }, 400);
        }

        if (password.length < 12 || password.length > 72) {
          return json({ error: "A senha deve ter entre 12 e 72 caracteres." }, 400);
        }

        const email = await usernameEmail(username);

        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            username,
          },
          app_metadata: {
            role: "user",
          },
        });

        if (error) {
          const normalized = error.message.toLowerCase();
          if (normalized.includes("already") || normalized.includes("registered")) {
            return json({ error: "Este usuário já existe." }, 409);
          }
          return json({ error: error.message }, 400);
        }

        return json({
          success: true,
          user: {
            id: data.user.id,
            username,
            role: "user",
            created_at: data.user.created_at,
            last_sign_in_at: null,
          },
        });
      }

      if (action === "reset_password") {
        const userId = typeof body?.userId === "string" ? body.userId : "";
        const password = typeof body?.password === "string" ? body.password : "";

        if (!userId) return json({ error: "Usuário inválido." }, 400);
        if (password.length < 12 || password.length > 72) {
          return json({ error: "A senha deve ter entre 12 e 72 caracteres." }, 400);
        }

        const { data: target, error: targetError } = await supabase.auth.admin.getUserById(userId);

        if (targetError || !target.user) {
          return json({ error: "Usuário não encontrado." }, 404);
        }

        if (target.user.app_metadata?.role === "admin" && target.user.id !== adminUser.id) {
          return json({ error: "A senha de outro administrador não pode ser alterada por esta tela." }, 403);
        }

        const { error } = await supabase.auth.admin.updateUserById(userId, {
          password,
        });

        if (error) return json({ error: error.message }, 400);

        return json({ success: true });
      }

      return json({ error: "Ação inválida." }, 400);
    }

    if (req.method === "DELETE") {
      const userId = typeof body?.userId === "string" ? body.userId : "";

      if (!userId) return json({ error: "Usuário inválido." }, 400);
      if (userId === adminUser.id) {
        return json({ error: "O administrador atual não pode remover a própria conta." }, 400);
      }

      const { data: target, error: targetError } = await supabase.auth.admin.getUserById(userId);

      if (targetError || !target.user) {
        return json({ error: "Usuário não encontrado." }, 404);
      }

      if (target.user.app_metadata?.role === "admin") {
        return json({ error: "Uma conta de administrador não pode ser removida por esta tela." }, 403);
      }

      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);

      return json({ success: true });
    }

    return json({ error: "Método não permitido." }, 405);
  } catch {
    return json({ error: "Não foi possível concluir a operação." }, 500);
  }
});

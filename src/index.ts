import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

const subjects = createSubjects({
  user: object({
    id: string(),
  }),
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    
    // Lógica de redirección demo
    if (url.pathname === "/") {
      const redirectUrl = new URL(url);
      redirectUrl.pathname = "/authorize";
      redirectUrl.searchParams.set("redirect_uri", url.origin + "/callback");
      redirectUrl.searchParams.set("client_id", "your-client-id");
      redirectUrl.searchParams.set("response_type", "code");
      return Response.redirect(redirectUrl.toString());
    } else if (url.pathname === "/callback") {
      return Response.json({
        message: "OAuth flow complete!",
        params: Object.fromEntries(url.searchParams.entries()),
      });
    }

    // Implementación de OpenAuth con Email usando Resend
    return issuer({
      storage: CloudflareStorage({ namespace: env.AUTH_STORAGE }),
      subjects,
      providers: {
        password: PasswordProvider(
          PasswordUI({
            sendCode: async (email, code) => {
              try {
                const response = await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${env.RESEND_API_KEY}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    from: "santiago@casals.ar",
                    to: email,
                    subject: "Tu código de verificación",
                    text: `Código: ${code}\nVálido por 5 minutos`,
                    html: `<p>Código: <strong>${code}</strong></p>`
                  }),
                });

                if (!response.ok) {
                  const errorText = await response.text();
                  console.error("Error enviando email:", errorText);
                  throw new Error(`Error en Resend: ${errorText}`);
                }
              } catch (error) {
                console.error("Error enviando email:", error);
                throw error;
              }
            },
            copy: {
              input_code: "Ingresa tu código",
            },
          })
        ),
      },
      theme: {
        title: "myAuth",
        primary: "#0051c3",
        favicon: "https://workers.cloudflare.com//favicon.ico",
        logo: {
          dark: "https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/db1e5c92-d3a6-4ea9-3e72-155844211f00/public",
          light:
            "https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/fa5a3023-7da9-466b-98a7-4ce01ee6c700/public",
        },
      },
      success: async (ctx, value) => {
        return ctx.subject("user", {
          id: await getOrCreateUser(env, value.email),
        });
      },
    }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;


async function getOrCreateUser(env: Env, email: string): Promise<string> {
  const result = await env.AUTH_DB.prepare(
    `
		INSERT INTO user (email)
		VALUES (?)
		ON CONFLICT (email) DO UPDATE SET email = email
		RETURNING id;
		`,
  )
    .bind(email)
    .first<{ id: string }>();
  if (!result) {
    throw new Error(`Unable to process user: ${email}`);
  }
  console.log(`Found or created user ${result.id} with email ${email}`);
  return result.id;
}

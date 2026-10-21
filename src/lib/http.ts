import { z, ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers });

/** Enveloppe commune des routes : transforme les erreurs en réponses JSON propres. */
export function handle<C = unknown>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message } }, e.status);
      if (e instanceof ZodError) {
        return json(
          { error: { code: "invalid_request", message: "Requête invalide.", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
          400,
        );
      }
      console.error(e);
      return json({ error: { code: "server_error", message: "Erreur interne du serveur." } }, 500);
    }
  };
}

export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Le corps de la requête doit être du JSON valide.");
  }
  return schema.parse(raw);
}

export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(params);
}

/** Identifiant dans l'URL : un identifiant invalide est traité comme une ressource introuvable. */
export async function idParam(ctx: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "not_found", "Ressource introuvable.");
  return id;
}

export const notFound = (what = "Ressource") => new HttpError(404, "not_found", `${what} introuvable.`);

/** Échappe % et _ pour une recherche ILIKE. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;

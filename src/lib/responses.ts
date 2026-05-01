export const notFound = (msg = "not_found") =>
  Response.json({ error: msg }, { status: 404 });

export const badRequest = (msg: string) =>
  Response.json({ error: msg }, { status: 400 });

export const serverError = (msg = "internal_error") =>
  Response.json({ error: msg }, { status: 500 });

export const conflict = (msg: string) =>
  Response.json({ error: msg }, { status: 409 });

export const serviceUnavailable = (msg: string) =>
  Response.json({ error: msg }, { status: 503 });

export const badGateway = (msg: string, detail?: unknown) =>
  Response.json({ error: msg, ...(detail !== undefined && { detail }) }, { status: 502 });

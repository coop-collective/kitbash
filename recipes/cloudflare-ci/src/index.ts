export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'schema'").first();
    return Response.json({ ok: true, schema: row });
  },
} satisfies ExportedHandler<Env>;

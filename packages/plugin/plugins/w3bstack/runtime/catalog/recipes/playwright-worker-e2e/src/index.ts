export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health") {
      await env.DB.prepare("SELECT id FROM notes LIMIT 1").all();
      return Response.json({ ok: true });
    }
    if (path !== "/api/notes") return new Response("not found", { status: 404 });
    if (request.method === "POST") {
      const body = (await request.text()).trim();
      if (!body || body.length > 200) return new Response("invalid note", { status: 400 });
      await env.DB.prepare("INSERT INTO notes (id, body) VALUES (?, ?)").bind(crypto.randomUUID(), body).run();
      return new Response(null, { status: 201 });
    }
    return Response.json((await env.DB.prepare("SELECT body FROM notes ORDER BY rowid").all()).results);
  },
} satisfies ExportedHandler<Env>;

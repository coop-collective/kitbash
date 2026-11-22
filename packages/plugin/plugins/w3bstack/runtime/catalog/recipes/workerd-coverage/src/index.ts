export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/notes") return new Response("not found", { status: 404 });
    if (request.method === "POST") {
      const body = (await request.text()).trim();
      if (!body) return new Response("empty note", { status: 400 });
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO notes (id, body) VALUES (?, ?)").bind(id, body).run();
      return Response.json({ id, body }, { status: 201 });
    }
    const { results } = await env.DB.prepare("SELECT id, body FROM notes ORDER BY id").all();
    return Response.json(results);
  },
} satisfies ExportedHandler<Env>;

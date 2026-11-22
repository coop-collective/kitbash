export default {
  async fetch(_request, env) {
    const enabled = await env.FLAGS.getBooleanValue("new-projects", false, {
      targetingKey: "fixture-member",
    });
    return Response.json({ enabled });
  },
};

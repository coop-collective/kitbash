import { expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
it('health', async()=>{expect((await SELF.fetch('http://localhost/api/health')).status).toBe(200)});

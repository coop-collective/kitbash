## 1.0.0

- First release (Canvalytics WP A3), hono-d1: signed batched `track`, `fact`, `log`, `identify`, `flush`; middleware; relay; snippet under 1 KB.
- `scrub.ts` is core's scrub, byte for byte; signing and ids are vendored with the same vectors.
- Browser-path batches (relay, `$identify`) carry `X-Canvalytics-Trust: client`.

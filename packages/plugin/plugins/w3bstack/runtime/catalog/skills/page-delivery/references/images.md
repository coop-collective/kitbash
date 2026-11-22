# Measure image delivery without degrading artwork

Start with the browser's requested images on representative routes and viewport/DPR combinations. Inventory source files separately: hidden legacy images may never transfer. Record the deployed revision, cache state, encoded response bytes, image decode failures, rendered dimensions and currentSrc. Keep authenticated captures local and sanitized.

Choose by content:

- SVG drawings already scale across devices. Cloudflare Images transformations do not resize SVG; do not add a paid runtime pipeline merely because the site uses Cloudflare. Check current provider documentation before choosing a service.
- For requested raster images, compare responsive widths, sizes/srcset, DPR and art direction. Reserve dimensions to prevent layout shifts. Compare lossless and perceptual formats at actual rendered sizes; retain an appropriate fallback and social-preview compatibility.
- An unused raster conversion does not improve a page. No change is a valid result.

## SVG build-time experiment

Do not accept an optimizer's default preset without visual validation. ID/defs cleanup, group collapse, transform flattening, curve approximation and coordinate precision can change clipped or hand-drawn artwork. Start with a narrow explicit plugin configuration and pin the tested tool version. Preserve viewBox, references, strokes, dashes and accessibility metadata.

Compare gzip and Brotli bytes, not only source length. Keep original bytes when the candidate offers no compressed saving. Hash the final optimized bytes and regenerate the deployment's asset manifest. Run optimization at build time unless a runtime need is measured.

Validate XML and browser decoding first. Duplicate SVG attributes can produce invisible drawings; fix the source generator and regenerate its output. Report that repair separately from a compression comparison.

## Quality and release evidence

Compare originals and candidates with browser rasterization at representative scales and DPRs. Record changed pixels/channels and mean/max deltas with their units. Inspect the worst differences visually, then inspect complete desktop/mobile pages for clipping, layout, color and stroke quality. Tiny antialiasing differences are not pixel identity; a low average alone can hide a small missing feature. Reject structural differences even if the file is smaller.

Preserve authorization for every image and transformation URL. Content hashes do not make private assets public. Test the deployed host's gate, MIME, GET/HEAD, conditional responses and cold/warm caching. Do not widen a public brand/icon exception to include application artwork. Distinguish browser caching from CDN caching.

Report asset counts, compressed bytes before/after, quality checks, build identity and limits. Controlled encoding savings establish a transfer reduction, not a measured Core Web Vitals or latency improvement. Recheck actual deployed requests before claiming delivery savings.

References: [Cloudflare Images limits](https://developers.cloudflare.com/images/get-started/limits/), [SVGO default preset](https://svgo.dev/docs/preset-default/). Provider and optimizer behavior must be checked against the versions used in the project.

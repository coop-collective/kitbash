// Wrangler (and the vitest pool) load *.html as text modules by default.
declare module "*.html" {
  const text: string;
  export default text;
}

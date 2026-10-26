// For tests that fetch from a local server: allow private addresses, then the usual test setup.
process.env.FETCH_ALLOW_PRIVATE_NETWORKS = 'true';
await import('./env.ts');

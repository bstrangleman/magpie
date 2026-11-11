import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { signS3, syncCloud } from '../services/cloud.ts';
import { signedInClient, type Client } from './helpers.ts';

/** A stand-in storage server: keeps what is PUT, and records every request. */
const files = new Map<string, Buffer>();
const requests: { method: string; path: string; auth: string }[] = [];
let failWith = 0;
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const path = decodeURIComponent(req.url!);
    requests.push({ method: req.method!, path, auth: req.headers.authorization ?? '' });
    if (failWith) return void res.writeHead(failWith).end('<Error><Code>AccessDenied</Code><Message>Not allowed</Message></Error>');
    if (req.method === 'PUT') files.set(path, Buffer.concat(chunks));
    if (req.method === 'DELETE') files.delete(path);
    res.writeHead(req.method === 'DELETE' ? 204 : 201).end();
  });
});
let origin = '';
let admin: Client;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await signedInClient('Admin');
});
after(() => server.close());

const s3 = { kind: 's3', url: '', bucket: 'bucket', region: 'auto', prefix: 'magpie', user: 'KEY', secret: 'SECRET', includeDatabase: true };
const stored = () => [...files.keys()].sort();

describe('cloud backups', () => {
  test('signs requests the way S3 documents it', () => {
    // The "GET Object" example from the Signature Version 4 documentation.
    const headers = signS3(
      { method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', body: Buffer.alloc(0), headers: { range: 'bytes=0-9' } },
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' },
      new Date('2013-05-24T00:00:00Z'),
    );
    assert.equal(
      headers.authorization,
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    assert.equal(headers.host, undefined, 'fetch sets Host itself');
  });

  test('only the administrator can see or change the destination', async () => {
    const other = await signedInClient('Other');
    assert.equal((await other.get('/api/cloud-backup')).status, 403);
    assert.equal((await other.post('/api/cloud-backup', { ...s3, url: origin })).status, 403);
    assert.equal((await other.post('/api/cloud-backup/sync')).status, 403);
    assert.equal((await admin.get('/api/cloud-backup')).data.kind, 'none');
  });

  test('rejects incomplete settings', async () => {
    assert.equal((await admin.post('/api/cloud-backup', { ...s3, url: 'not a url' })).status, 400);
    assert.equal((await admin.post('/api/cloud-backup', { ...s3, url: origin, secret: '' })).status, 400);
    assert.equal((await admin.post('/api/cloud-backup', { ...s3, url: origin, bucket: '' })).status, 400);
    assert.equal((await admin.get('/api/cloud-backup')).data.kind, 'none');
  });

  test('copies backups to S3 storage, and deletes follow', async () => {
    const me = (await admin.get('/api/me')).data;
    await admin.post('/api/bookmarks', { url: 'https://a.example' });
    const first = (await admin.post('/api/backups')).data;

    const save = await admin.post('/api/cloud-backup', { ...s3, url: origin });
    assert.equal(save.status, 200);
    assert.equal(save.data.status.error, null);
    assert.equal(save.data.hasSecret, true);
    assert.equal(save.data.secret, undefined, 'the secret is never sent back');
    // Saving tried the connection (a test file, removed again) and copied the existing backup.
    assert.equal(stored().length, 1);
    assert.match(stored()[0]!, new RegExp(`^/bucket/magpie/${me.id}/magpie-.*\\.json$`));
    assert.equal(JSON.parse(files.get(stored()[0]!)!.toString()).bookmarks.length, 1);
    assert.match(requests.at(-1)!.auth, /^AWS4-HMAC-SHA256 Credential=KEY\/\d{8}\/auto\/s3\/aws4_request/);
    assert.equal(save.data.status.files, 1);

    // A new backup is copied; nothing is uploaded twice.
    await admin.post('/api/backups');
    await syncCloud();
    assert.equal(stored().length, 2);
    const puts = requests.filter((r) => r.method === 'PUT' && r.path.endsWith('.json')).length;
    await syncCloud();
    assert.equal(requests.filter((r) => r.method === 'PUT' && r.path.endsWith('.json')).length, puts);

    // Deleting a backup deletes its copy.
    await admin.del(`/api/backups/${first.id}`);
    await syncCloud();
    assert.equal(stored().length, 1);
    assert.equal((await admin.get('/api/cloud-backup')).data.status.files, 1);
  });

  test('reports a failed upload and retries it', async () => {
    failWith = 403;
    await admin.post('/api/backups');
    const failed = (await admin.post('/api/cloud-backup/sync')).data;
    assert.match(failed.status.error, /403.*Not allowed/);
    assert.ok(failed.status.lastSuccessAt, 'keeps the time of the last good copy');
    assert.equal(stored().length, 1);

    failWith = 0;
    const retried = (await admin.post('/api/cloud-backup/sync')).data;
    assert.equal(retried.status.error, null);
    assert.equal(stored().length, 2);
  });

  test('copies to a WebDAV folder, keeping the saved password', async () => {
    files.clear();
    const save = await admin.post('/api/cloud-backup', { kind: 'webdav', url: `${origin}/dav/Magpie/`, user: 'me', secret: 'pw' });
    assert.equal(save.data.status.error, null);
    // A new destination gets every backup again.
    assert.equal(stored().length, 2);
    assert.ok(stored().every((p) => p.startsWith('/dav/Magpie/')));
    assert.equal(requests.at(-1)!.auth, `Basic ${Buffer.from('me:pw').toString('base64')}`);

    // Saving again without a password keeps the stored one.
    const again = await admin.post('/api/cloud-backup', { kind: 'webdav', url: `${origin}/dav/Magpie`, user: 'me' });
    assert.equal(again.data.status.error, null);
    assert.equal(requests.at(-1)!.auth, `Basic ${Buffer.from('me:pw').toString('base64')}`);

    // Turned off: nothing more is sent.
    assert.equal((await admin.post('/api/cloud-backup', { kind: 'none' })).data.kind, 'none');
    const count = requests.length;
    await admin.post('/api/backups');
    await syncCloud();
    assert.equal(requests.length, count);
  });
});

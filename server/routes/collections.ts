import { Hono } from 'hono';
import { z } from 'zod';
import { PHOSPHOR_PREFIX, type Sidebar } from '../../shared/types.ts';
import type { AppEnv } from '../lib/auth.ts';
import { intParam, parse } from '../lib/http.ts';
import { getCounts } from '../services/bookmarks.ts';
import {
  createCollection,
  createGroup,
  deleteCollection,
  deleteGroup,
  listCollections,
  listGroups,
  moveCollection,
  updateCollection,
  updateGroup,
} from '../services/collections.ts';
import { deleteTag, listTags, renameTag } from '../services/tags.ts';

const id = z.number().int().positive();
const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Invalid colour').nullable();
// An emoji, or a Phosphor icon name such as "ph:camera".
const icon = z
  .string()
  .max(64)
  .refine((v) => !v.startsWith(PHOSPHOR_PREFIX) || /^ph:[a-z0-9]+(-[a-z0-9]+)*$/.test(v), 'Invalid icon name')
  .nullable();

export const collectionRoutes = new Hono<AppEnv>()
  .get('/sidebar', (c) => {
    const userId = c.var.user.id;
    return c.json<Sidebar>({
      counts: getCounts(userId),
      groups: listGroups(userId),
      collections: listCollections(userId),
      tags: listTags(userId),
    });
  })
  .post('/collections', async (c) => {
    const body = parse(
      z.object({
        name: z.string().max(200),
        icon: icon.optional(),
        color: color.optional(),
        parentId: id.nullish(),
        groupId: id.nullish(),
      }),
      await c.req.json(),
    );
    return c.json(createCollection(c.var.user.id, body), 201);
  })
  .patch('/collections/:id', async (c) => {
    const body = parse(
      z.object({ name: z.string().max(200).optional(), icon: icon.optional(), color: color.optional(), collapsed: z.boolean().optional() }),
      await c.req.json(),
    );
    return c.json(updateCollection(c.var.user.id, intParam(c.req.param('id')), body));
  })
  .post('/collections/:id/move', async (c) => {
    const body = parse(
      z.object({ parentId: id.nullable(), groupId: id.nullish(), prevId: id.nullish(), nextId: id.nullish() }),
      await c.req.json(),
    );
    return c.json(moveCollection(c.var.user.id, intParam(c.req.param('id')), body));
  })
  .delete('/collections/:id', (c) => {
    deleteCollection(c.var.user.id, intParam(c.req.param('id')));
    return c.json({ ok: true });
  })
  .post('/groups', async (c) => {
    const body = parse(z.object({ name: z.string().max(100) }), await c.req.json());
    return c.json(createGroup(c.var.user.id, body.name), 201);
  })
  .patch('/groups/:id', async (c) => {
    const body = parse(
      z.object({ name: z.string().max(100).optional(), collapsed: z.boolean().optional(), prevId: id.nullish(), nextId: id.nullish() }),
      await c.req.json(),
    );
    return c.json(updateGroup(c.var.user.id, intParam(c.req.param('id')), body));
  })
  .delete('/groups/:id', (c) => {
    deleteGroup(c.var.user.id, intParam(c.req.param('id')));
    return c.json({ ok: true });
  })
  .get('/tags', (c) => c.json(listTags(c.var.user.id)))
  .patch('/tags/:id', async (c) => {
    const body = parse(z.object({ name: z.string().max(64) }), await c.req.json());
    renameTag(c.var.user.id, intParam(c.req.param('id')), body.name);
    return c.json({ ok: true });
  })
  .delete('/tags/:id', (c) => {
    deleteTag(c.var.user.id, intParam(c.req.param('id')));
    return c.json({ ok: true });
  });

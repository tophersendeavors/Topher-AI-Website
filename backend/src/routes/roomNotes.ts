// Room Notes routes — studio-wide production notes, scoped to a project + room.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NOTE_STATUSES, NOTE_TARGET_TYPES, NOTE_VISIBILITIES } from "@toburt/shared";
import type { NoteStatus, NoteTargetType } from "@toburt/shared";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { listNotes, createNote, updateNote, deleteNote } from "../roomNotes/store.js";

const targetType = z.enum(NOTE_TARGET_TYPES as unknown as [NoteTargetType, ...NoteTargetType[]]);
const status = z.enum(NOTE_STATUSES as unknown as [NoteStatus, ...NoteStatus[]]);
const visibility = z.enum(NOTE_VISIBILITIES as unknown as [string, ...string[]]);

const createBody = z.object({
  room: z.string().max(40).optional(),
  body: z.string().min(1).max(4000),
  targetType: targetType.optional(),
  targetRef: z.string().max(200).nullish(),
  targetLabel: z.string().max(200).nullish(),
  visibility: visibility.optional(),
  selectedUserIds: z.array(z.string().uuid()).max(50).optional(),
  assigneeId: z.string().uuid().nullish(),
  status: status.optional(),
});

export default async function roomNotesRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/notes", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const q = req.query as { room?: string; targetType?: NoteTargetType; targetRef?: string; status?: NoteStatus };
    const notes = await listNotes(projectId, user.id, {
      room: q.room,
      targetType: q.targetType,
      targetRef: q.targetRef,
      status: q.status,
    });
    return { notes };
  });

  app.post("/projects/:projectId/notes", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const body = createBody.parse(req.body);
    const note = await createNote(projectId, user.id, body as never);
    return { note };
  });

  app.patch("/projects/:projectId/notes/:noteId", async (req) => {
    const user = await requireUser(req);
    const { projectId, noteId } = req.params as { projectId: string; noteId: string };
    await assertProjectMember(user.id, projectId);
    const body = createBody.partial().parse(req.body);
    const note = await updateNote(projectId, noteId, body as never);
    return { note };
  });

  app.delete("/projects/:projectId/notes/:noteId", async (req) => {
    const user = await requireUser(req);
    const { projectId, noteId } = req.params as { projectId: string; noteId: string };
    await assertProjectMember(user.id, projectId);
    await deleteNote(projectId, noteId);
    return { ok: true };
  });
}

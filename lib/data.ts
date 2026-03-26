import {
  AppState,
  BranchRecord,
  CreateBranchInput,
  CreateCommitInput,
  PageState,
  RevisionRecord,
  SaveWorkingStateInput,
} from "@/lib/types";
import { createDefaultPageState, normalizePageState } from "@/lib/utils";
import { getPool, hasDbEnv } from "@/lib/db";

type DocumentRow = {
  id: string;
  created_at: string;
  updated_at: string;
};

type BranchRow = {
  id: string;
  document_id: string;
  name: string;
  head_revision_id: string | null;
  created_at: string;
  updated_at: string;
  working_state: PageState;
};

type RevisionRow = {
  id: string;
  document_id: string;
  branch_id: string;
  message: string;
  snapshot: PageState;
  created_at: string;
};

type LoadOptions = {
  branchId?: string;
  userId?: string;
};

function mapBranch(row: BranchRow): BranchRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    name: row.name,
    headRevisionId: row.head_revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    workingState: normalizePageState(row.working_state),
  };
}

function mapRevision(row: RevisionRow): RevisionRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    branchId: row.branch_id,
    message: row.message,
    snapshot: normalizePageState(row.snapshot),
    createdAt: row.created_at,
  };
}

async function verifyDocumentOwnership(documentId: string, userId: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id FROM documents WHERE id = $1 AND user_id = $2`,
    [documentId, userId],
  );
  if (rows.length === 0) {
    throw new Error("Document not found.");
  }
}

async function ensureSeedData(userId: string): Promise<DocumentRow> {
  const pool = getPool();

  const { rows: existing } = await pool.query<DocumentRow>(
    `SELECT id, created_at, updated_at FROM documents WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId],
  );

  if (existing.length > 0) {
    return existing[0];
  }

  const { rows: inserted } = await pool.query<DocumentRow>(
    `INSERT INTO documents (user_id) VALUES ($1) RETURNING id, created_at, updated_at`,
    [userId],
  );

  const document = inserted[0];
  const defaultState = createDefaultPageState();

  await pool.query(
    `INSERT INTO branches (document_id, name, working_state) VALUES ($1, $2, $3)`,
    [document.id, "main", JSON.stringify(defaultState)],
  );

  return document;
}

export async function loadDocument(options: LoadOptions = {}): Promise<AppState> {
  if (!hasDbEnv()) {
    const defaultState = createDefaultPageState();

    return {
      document: {
        id: "local-preview-document",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      branches: [
        {
          id: "local-preview-main",
          documentId: "local-preview-document",
          name: "main",
          headRevisionId: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          workingState: defaultState,
        },
      ],
      activeBranchId: "local-preview-main",
      pageState: defaultState,
      revisions: [],
    };
  }

  const pool = getPool();
  const document = await ensureSeedData(options.userId!);

  const { rows: branches } = await pool.query<BranchRow>(
    `SELECT id, document_id, name, head_revision_id, created_at, updated_at, working_state
     FROM branches
     WHERE document_id = $1
     ORDER BY created_at ASC`,
    [document.id],
  );

  if (!branches.length) {
    throw new Error("Unable to load branches.");
  }

  const mappedBranches = branches.map(mapBranch);
  const activeBranch =
    mappedBranches.find((branch) => branch.id === options.branchId) || mappedBranches[0];

  const revisions = await listRevisions(document.id, activeBranch.id, options.userId!);

  return {
    document: {
      id: document.id,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
    },
    branches: mappedBranches,
    activeBranchId: activeBranch.id,
    pageState: activeBranch.workingState,
    revisions,
  };
}

export async function saveWorkingState(input: SaveWorkingStateInput): Promise<PageState> {
  if (!hasDbEnv()) {
    return normalizePageState(input.pageState);
  }

  await verifyDocumentOwnership(input.documentId, input.userId);

  const pool = getPool();
  const pageState = normalizePageState(input.pageState);

  await pool.query(
    `UPDATE branches SET working_state = $1 WHERE id = $2 AND document_id = $3`,
    [JSON.stringify(pageState), input.branchId, input.documentId],
  );

  await pool.query(
    `UPDATE documents SET updated_at = NOW() WHERE id = $1`,
    [input.documentId],
  );

  return pageState;
}

export async function createCommit(input: CreateCommitInput): Promise<RevisionRecord> {
  const message = input.message.trim();

  if (!message) {
    throw new Error("A commit message is required.");
  }

  const pageState = await saveWorkingState(input);

  if (!hasDbEnv()) {
    return {
      id: crypto.randomUUID(),
      documentId: input.documentId,
      branchId: input.branchId,
      message,
      snapshot: pageState,
      createdAt: new Date().toISOString(),
    };
  }

  const pool = getPool();

  const { rows } = await pool.query<RevisionRow>(
    `INSERT INTO revisions (document_id, branch_id, message, snapshot)
     VALUES ($1, $2, $3, $4)
     RETURNING id, document_id, branch_id, message, snapshot, created_at`,
    [input.documentId, input.branchId, message, JSON.stringify(pageState)],
  );

  const revision = rows[0];

  await pool.query(
    `UPDATE branches SET head_revision_id = $1 WHERE id = $2`,
    [revision.id, input.branchId],
  );

  return mapRevision(revision);
}

export async function createBranch(input: CreateBranchInput): Promise<BranchRecord> {
  const newBranchName = input.newBranchName.trim();

  if (!newBranchName) {
    throw new Error("A branch name is required.");
  }

  const pageState = normalizePageState(input.pageState);

  if (!hasDbEnv()) {
    return {
      id: crypto.randomUUID(),
      documentId: input.documentId,
      name: newBranchName,
      headRevisionId: input.sourceRevisionId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workingState: pageState,
    };
  }

  await verifyDocumentOwnership(input.documentId, input.userId);

  const pool = getPool();

  const { rows: existing } = await pool.query(
    `SELECT id FROM branches WHERE document_id = $1 AND LOWER(name) = LOWER($2)`,
    [input.documentId, newBranchName],
  );

  if (existing.length > 0) {
    throw new Error("Branch name already exists.");
  }

  const { rows } = await pool.query<BranchRow>(
    `INSERT INTO branches (document_id, name, head_revision_id, working_state)
     VALUES ($1, $2, $3, $4)
     RETURNING id, document_id, name, head_revision_id, created_at, updated_at, working_state`,
    [input.documentId, newBranchName, input.sourceRevisionId || null, JSON.stringify(pageState)],
  );

  return mapBranch(rows[0]);
}

export async function listRevisions(
  documentId: string,
  branchId: string,
  userId?: string,
): Promise<RevisionRecord[]> {
  if (!hasDbEnv()) {
    return [];
  }

  if (userId) {
    await verifyDocumentOwnership(documentId, userId);
  }

  const pool = getPool();

  const { rows } = await pool.query<RevisionRow>(
    `SELECT id, document_id, branch_id, message, snapshot, created_at
     FROM revisions
     WHERE document_id = $1 AND branch_id = $2
     ORDER BY created_at DESC`,
    [documentId, branchId],
  );

  return rows.map(mapRevision);
}

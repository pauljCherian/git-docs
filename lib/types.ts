export type TodoItem = {
  id: string;
  text: string;
  completed: boolean;
  order: number;
  updatedAt: string;
};

export type PageState = {
  todos: TodoItem[];
};

export type DocumentRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type BranchRecord = {
  id: string;
  documentId: string;
  name: string;
  headRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
  workingState: PageState;
};

export type RevisionRecord = {
  id: string;
  documentId: string;
  branchId: string;
  message: string;
  snapshot: PageState;
  createdAt: string;
};

export type AppState = {
  document: DocumentRecord;
  branches: BranchRecord[];
  activeBranchId: string;
  pageState: PageState;
  revisions: RevisionRecord[];
};

export type SaveWorkingStateInput = {
  documentId: string;
  branchId: string;
  pageState: PageState;
  userId: string;
};

export type CreateCommitInput = SaveWorkingStateInput & {
  message: string;
};

export type CreateBranchInput = {
  documentId: string;
  sourceBranchId: string;
  newBranchName: string;
  pageState: PageState;
  sourceRevisionId?: string | null;
  userId: string;
};

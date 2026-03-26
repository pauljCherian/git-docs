"use client";

import { startTransition as reactStartTransition, useOptimistic, useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { AppState, BranchRecord, PageState, RevisionRecord, TodoItem } from "@/lib/types";
import { nowIso } from "@/lib/utils";
import { diffTodos, DiffEntry } from "@/lib/diff";

type UserInfo = {
  name?: string | null;
  image?: string | null;
};

type TodoAppProps = {
  initialData: AppState;
  dbConfigured: boolean;
  user: UserInfo | null;
};

type StatusTone = "neutral" | "success" | "error";

type StatusMessage = {
  tone: StatusTone;
  text: string;
};

async function postJson<TBody, TResult>(url: string, body: TBody): Promise<TResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as TResult & { ok?: boolean; message?: string };

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Request failed.");
  }

  return payload;
}

async function fetchRevisions(documentId: string, branchId: string) {
  const params = new URLSearchParams({ documentId, branchId });
  const response = await fetch(`/api/revisions?${params.toString()}`);
  const payload = (await response.json()) as {
    ok: boolean;
    message?: string;
    revisions: RevisionRecord[];
  };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || "Unable to load revisions.");
  }

  return payload.revisions;
}

function clonePageState(pageState: PageState): PageState {
  return {
    todos: pageState.todos.map((todo) => ({ ...todo })),
  };
}

export function TodoApp({ initialData, dbConfigured, user }: TodoAppProps) {
  const [pageState, setPageState] = useState<PageState>(clonePageState(initialData.pageState));
  const [branches, setBranches] = useState<BranchRecord[]>(initialData.branches);
  const [activeBranchId, setActiveBranchId] = useState(initialData.activeBranchId);
  const [commitMessage, setCommitMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [revisions, setRevisions] = useState<RevisionRecord[]>(initialData.revisions);
  const [status, setStatus] = useState<StatusMessage>({
    tone: "neutral",
    text: dbConfigured
      ? "Working tree ready. Sync when you want to persist changes."
      : "Preview mode: set DATABASE_URL to enable Sync, Commit, and Branch persistence.",
  });
  const [expandedRevisionId, setExpandedRevisionId] = useState<string | null>(null);
  const [pendingAction, startTransition] = useTransition();
  const [optimisticTodos, updateOptimisticTodos] = useOptimistic(
    pageState.todos,
    (_, nextTodos: TodoItem[]) => nextTodos,
  );

  const activeBranch =
    branches.find((branch) => branch.id === activeBranchId) ?? branches[0];

  const lastSnapshot = revisions[0]?.snapshot.todos ?? activeBranch.workingState.todos;
  const hasChanges = diffTodos(lastSnapshot, pageState.todos).length > 0;

  function updateStatus(tone: StatusTone, text: string) {
    setStatus({ tone, text });
  }

  function applyLocalPageState(nextState: PageState) {
    const nextClone = clonePageState(nextState);
    setPageState(nextClone);
    setBranches((current) =>
      current.map((branch) =>
        branch.id === activeBranchId
          ? { ...branch, workingState: clonePageState(nextClone), updatedAt: nowIso() }
          : branch,
      ),
    );
  }

  function setTodos(nextTodos: TodoItem[]) {
    const normalizedTodos = nextTodos.map((todo, index) => ({
      ...todo,
      order: index,
      updatedAt: todo.updatedAt || nowIso(),
    }));

    reactStartTransition(() => {
      updateOptimisticTodos(normalizedTodos);
      applyLocalPageState({
        ...pageState,
        todos: normalizedTodos,
      });
    });
  }

  function addTodo() {
    const todo: TodoItem = {
      id: crypto.randomUUID(),
      text: "",
      completed: false,
      order: optimisticTodos.length,
      updatedAt: nowIso(),
    };

    setTodos([...optimisticTodos, todo]);
    updateStatus("neutral", "New todo added locally.");
  }

  function updateTodo(id: string, text: string) {
    setTodos(
      optimisticTodos.map((todo) =>
        todo.id === id ? { ...todo, text, updatedAt: nowIso() } : todo,
      ),
    );
  }

  function toggleTodo(id: string) {
    setTodos(
      optimisticTodos.map((todo) =>
        todo.id === id
          ? { ...todo, completed: !todo.completed, updatedAt: nowIso() }
          : todo,
      ),
    );
  }

  function removeTodo(id: string) {
    setTodos(optimisticTodos.filter((todo) => todo.id !== id));
  }

  function moveTodo(id: string, direction: -1 | 1) {
    const index = optimisticTodos.findIndex((todo) => todo.id === id);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= optimisticTodos.length) {
      return;
    }

    const reordered = [...optimisticTodos];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);
    setTodos(reordered);
  }

  function syncCurrentState() {
    startTransition(async () => {
      try {
        const payload = await postJson<
          { documentId: string; branchId: string; pageState: PageState },
          { ok: boolean; pageState: PageState }
        >("/api/sync", {
          documentId: initialData.document.id,
          branchId: activeBranch.id,
          pageState,
        });

        const nextState = clonePageState(payload.pageState);
        applyLocalPageState(nextState);
        updateStatus("success", `Synced branch "${activeBranch.name}" to the cloud.`);
      } catch (error) {
        updateStatus(
          "error",
          error instanceof Error ? error.message : "Sync failed.",
        );
      }
    });
  }

  function commitCurrentState() {
    startTransition(async () => {
      try {
        const payload = await postJson<
          { documentId: string; branchId: string; pageState: PageState; message: string },
          { ok: boolean; revision: RevisionRecord }
        >("/api/commit", {
          documentId: initialData.document.id,
          branchId: activeBranch.id,
          pageState,
          message: commitMessage,
        });

        setRevisions((current) => [payload.revision, ...current]);
        setBranches((current) =>
          current.map((branch) =>
            branch.id === activeBranch.id
              ? {
                  ...branch,
                  headRevisionId: payload.revision.id,
                  updatedAt: nowIso(),
                  workingState: clonePageState(pageState),
                }
              : branch,
          ),
        );
        setCommitMessage("");
        updateStatus(
          "success",
          `Committed "${payload.revision.message}" on ${activeBranch.name}.`,
        );
      } catch (error) {
        updateStatus(
          "error",
          error instanceof Error ? error.message : "Commit failed.",
        );
      }
    });
  }

  function createNewBranch() {
    startTransition(async () => {
      try {
        const sourceRevisionId =
          revisions[0]?.branchId === activeBranch.id ? revisions[0].id : activeBranch.headRevisionId;

        const payload = await postJson<
          {
            documentId: string;
            sourceBranchId: string;
            newBranchName: string;
            pageState: PageState;
            sourceRevisionId: string | null;
          },
          { ok: boolean; branch: BranchRecord }
        >("/api/branch", {
          documentId: initialData.document.id,
          sourceBranchId: activeBranch.id,
          newBranchName: branchName,
          pageState,
          sourceRevisionId: sourceRevisionId || null,
        });

        const nextBranch = payload.branch;
        setBranches((current) => [...current, nextBranch]);
        setActiveBranchId(nextBranch.id);
        setPageState(clonePageState(nextBranch.workingState));
        setRevisions([]);
        setBranchName("");
        updateStatus("success", `Created and switched to branch "${nextBranch.name}".`);
      } catch (error) {
        updateStatus(
          "error",
          error instanceof Error ? error.message : "Branch creation failed.",
        );
      }
    });
  }

  function switchBranch(branchId: string) {
    const nextBranch = branches.find((branch) => branch.id === branchId);

    if (!nextBranch) {
      return;
    }

    startTransition(async () => {
      try {
        const nextRevisions = await fetchRevisions(initialData.document.id, branchId);
        setActiveBranchId(branchId);
        setPageState(clonePageState(nextBranch.workingState));
        updateOptimisticTodos(nextBranch.workingState.todos);
        setRevisions(nextRevisions);
        updateStatus("neutral", `Switched to branch "${nextBranch.name}".`);
      } catch (error) {
        updateStatus(
          "error",
          error instanceof Error ? error.message : "Unable to switch branches.",
        );
      }
    });
  }

  return (
    <main className="shell">
      {user ? (
        <div className="user-bar">
          {user.image ? (
            <img src={user.image} alt="" className="user-avatar" />
          ) : null}
          <span className="user-name">{user.name || "User"}</span>
          <button type="button" className="ghost" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      ) : null}

      <section className="hero">
        <div>
          <p className="eyebrow">Git-inspired planning</p>
          <h1>Keep one todo list, branch ideas freely, and commit progress clearly.</h1>
          <p className="lede">
            This page treats your todo list like a working tree. Draft locally, commit
            meaningful snapshots, and sync your current branch to the database.
          </p>
        </div>
        <div className="status-panel">
          <span className={`status-dot tone-${status.tone}`} />
          <div>
            <strong>Workspace status</strong>
            <p>{status.text}</p>
          </div>
        </div>
      </section>

      {!dbConfigured ? (
        <section className="banner">
          <strong>Preview mode only.</strong>
          <span>
            Set `DATABASE_URL` in your environment to enable persistence.
          </span>
        </section>
      ) : null}

      <section className="grid">
        <div className="panel editor-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Working tree</p>
              <h2>Todo editor</h2>
            </div>
            <div className="branch-chip">{activeBranch.name}</div>
          </div>

          <div className="todos-header">
            <div>
              <p className="panel-kicker">Todo list</p>
              <h3>Track next actions</h3>
            </div>
            <button type="button" className="secondary" onClick={addTodo}>
              Add task
            </button>
          </div>

          <div className="todos">
            {optimisticTodos.length ? (
              optimisticTodos.map((todo, index) => (
                <div key={todo.id} className="todo-row">
                  <button
                    type="button"
                    className={todo.completed ? "checkbox checked" : "checkbox"}
                    onClick={() => toggleTodo(todo.id)}
                    aria-label={`Toggle ${todo.text || `task ${index + 1}`}`}
                  >
                    {todo.completed ? "Done" : "Todo"}
                  </button>
                  <input
                    value={todo.text}
                    onChange={(event) => updateTodo(todo.id, event.target.value)}
                    placeholder="Describe the task"
                  />
                  <div className="todo-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => moveTodo(todo.id, -1)}
                      disabled={index === 0}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => moveTodo(todo.id, 1)}
                      disabled={index === optimisticTodos.length - 1}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      onClick={() => removeTodo(todo.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <p>No todos yet.</p>
                <span>Add a task to get your working tree moving.</span>
              </div>
            )}
          </div>

          <div className="action-grid">
            <label className="field">
              <span>Commit message</span>
              <input
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Summarize this snapshot"
              />
            </label>
            <label className="field">
              <span>New branch</span>
              <input
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                placeholder="explore-idea"
              />
            </label>
          </div>

          <div className="toolbar">
            <button type="button" className="primary" onClick={syncCurrentState}>
              Sync
            </button>
            <button
              type="button"
              className="secondary"
              onClick={commitCurrentState}
              disabled={!commitMessage.trim() || !hasChanges}
            >
              Commit
            </button>
            <button
              type="button"
              className="secondary"
              onClick={createNewBranch}
              disabled={!branchName.trim()}
            >
              Branch
            </button>
            {pendingAction ? <span className="pending-tag">Saving…</span> : null}
          </div>
        </div>

        <aside className="stack">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Branches</p>
                <h2>Version streams</h2>
              </div>
            </div>
            <div className="branch-list">
              {branches.map((branch) => (
                <button
                  type="button"
                  key={branch.id}
                  className={
                    branch.id === activeBranchId ? "branch-item active" : "branch-item"
                  }
                  onClick={() => switchBranch(branch.id)}
                >
                  <span>{branch.name}</span>
                  <small>{branch.headRevisionId ? "Committed" : "No commits yet"}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="panel history-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">History</p>
                <h2>Commit log</h2>
              </div>
            </div>
            <div className="history-list">
              {revisions.length ? (
                revisions.map((revision, revIndex) => {
                  const isExpanded = expandedRevisionId === revision.id;
                  const previousRevision = revisions[revIndex + 1];
                  const olderTodos = previousRevision ? previousRevision.snapshot.todos : [];
                  const entries = isExpanded ? diffTodos(olderTodos, revision.snapshot.todos) : [];

                  return (
                    <article
                      key={revision.id}
                      className={`history-card${isExpanded ? " expanded" : ""}`}
                      onClick={() =>
                        setExpandedRevisionId(isExpanded ? null : revision.id)
                      }
                    >
                      <strong>{revision.message}</strong>
                      <span>{new Date(revision.createdAt).toLocaleString()}</span>
                      <p>{revision.snapshot.todos.length} todos</p>
                      {isExpanded ? (
                        entries.length > 0 ? (
                          <div className="diff-view" onClick={(e) => e.stopPropagation()}>
                            {entries.map((entry: DiffEntry) => (
                              <div key={entry.todo.id} className={`diff-entry diff-${entry.type}`}>
                                <span className="diff-badge">{entry.type}</span>
                                <span>{entry.todo.text || "(empty)"}</span>
                                {entry.type === "modified" && entry.changes?.textChanged ? (
                                  <div className="diff-detail">
                                    <del>{entry.previousTodo?.text}</del>{" "}
                                    <ins>{entry.todo.text}</ins>
                                  </div>
                                ) : null}
                                {entry.type === "modified" && entry.changes?.completedChanged ? (
                                  <span className="diff-detail">
                                    {entry.todo.completed ? "Marked complete" : "Marked incomplete"}
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="diff-empty">
                            {previousRevision ? "No changes in this commit." : "Initial commit — all todos are new."}
                          </p>
                        )
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <div className="empty-state">
                  <p>No commits yet.</p>
                  <span>Create a commit to capture this branch.</span>
                </div>
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

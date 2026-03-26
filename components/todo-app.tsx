"use client";

import { startTransition as reactStartTransition, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
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

type TerminalEntry =
  | { type: "input"; text: string; branch: string }
  | { type: "output"; text: string };

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
  const [revisions, setRevisions] = useState<RevisionRecord[]>(initialData.revisions);
  const [status, setStatus] = useState<StatusMessage>({
    tone: "neutral",
    text: dbConfigured
      ? "Working tree ready. Sync when you want to persist changes."
      : "Preview mode: set DATABASE_URL to enable Sync, Commit, and Branch persistence.",
  });
  const [expandedRevisionId, setExpandedRevisionId] = useState<string | null>(null);
  const [terminalHistory, setTerminalHistory] = useState<TerminalEntry[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);
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

  function commitCurrentState(message: string) {
    startTransition(async () => {
      try {
        const payload = await postJson<
          { documentId: string; branchId: string; pageState: PageState; message: string },
          { ok: boolean; revision: RevisionRecord }
        >("/api/commit", {
          documentId: initialData.document.id,
          branchId: activeBranch.id,
          pageState,
          message,
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

  function createNewBranch(name: string) {
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
          newBranchName: name,
          pageState,
          sourceRevisionId: sourceRevisionId || null,
        });

        const nextBranch = payload.branch;
        setBranches((current) => [...current, nextBranch]);
        setActiveBranchId(nextBranch.id);
        setPageState(clonePageState(nextBranch.workingState));
        setRevisions([]);
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

  // Terminal logic

  function fakeHash() {
    return Math.random().toString(16).slice(2, 9);
  }

  function appendToTerminal(lines: string | string[]) {
    const entries: TerminalEntry[] = (Array.isArray(lines) ? lines : [lines]).map((text) => ({
      type: "output" as const,
      text,
    }));
    setTerminalHistory((prev) => [...prev, ...entries]);
  }

  function executeCommand(rawInput: string) {
    const trimmed = rawInput.trim();
    if (!trimmed) return;

    setTerminalHistory((prev) => [
      ...prev,
      { type: "input", text: trimmed, branch: activeBranch.name },
    ]);
    setCommandHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);
    setCurrentInput("");

    const cmd = trimmed.toLowerCase();

    if (cmd === "clear") {
      setTerminalHistory([]);
      return;
    }

    if (cmd === "help") {
      appendToTerminal([
        "Available commands:",
        "  git status              Show working tree status",
        "  git add .               Stage changes (auto-tracked)",
        "  git commit -m \"msg\"     Commit with message",
        "  git push                Sync branch to remote",
        "  git checkout -b <name>  Create and switch to new branch",
        "  git checkout <name>     Switch to existing branch",
        "  git branch              List all branches",
        "  git log                 Show commit history",
        "  clear                   Clear terminal",
        "  help                    Show this message",
      ]);
      return;
    }

    if (cmd === "git status") {
      const entries = diffTodos(lastSnapshot, pageState.todos);
      if (entries.length === 0) {
        appendToTerminal([
          `On branch ${activeBranch.name}`,
          "nothing to commit, working tree clean",
        ]);
      } else {
        const lines = [
          `On branch ${activeBranch.name}`,
          "Changes not staged for commit:",
          '  (use "git commit -m <message>" to record changes)',
          "",
        ];
        for (const entry of entries) {
          const label = entry.type === "added" ? "new file" : entry.type === "removed" ? "deleted" : "modified";
          lines.push(`    ${label}:   ${entry.todo.text || "(empty)"}`);
        }
        appendToTerminal(lines);
      }
      return;
    }

    if (cmd === "git add ." || cmd === "git add -a") {
      appendToTerminal("All todos are automatically tracked. Nothing to stage manually.");
      return;
    }

    if (cmd === "git push") {
      const h1 = fakeHash();
      const h2 = fakeHash();
      appendToTerminal([
        "Enumerating objects: 3, done.",
        "Counting objects: 100% (3/3), done.",
        "Writing objects: 100% (3/3), 312 bytes | 312.00 KiB/s, done.",
        `To origin/${activeBranch.name}`,
        `   ${h1}..${h2}  ${activeBranch.name} -> ${activeBranch.name}`,
      ]);
      syncCurrentState();
      return;
    }

    // git commit -m "message" or git commit -m 'message' or git commit -m message
    const commitMatch = trimmed.match(/^git\s+commit\s+-m\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/i);
    if (cmd.startsWith("git commit")) {
      if (!commitMatch) {
        appendToTerminal("Aborting commit due to empty commit message.");
        return;
      }
      const message = commitMatch[1] ?? commitMatch[2] ?? commitMatch[3];
      if (!hasChanges) {
        appendToTerminal([
          `On branch ${activeBranch.name}`,
          "nothing to commit, working tree clean",
        ]);
        return;
      }
      const changeCount = diffTodos(lastSnapshot, pageState.todos).length;
      appendToTerminal([
        `[${activeBranch.name} ${fakeHash()}] ${message}`,
        ` ${changeCount} todo${changeCount !== 1 ? "s" : ""} changed`,
      ]);
      commitCurrentState(message);
      return;
    }

    // git checkout -b <name>
    const checkoutNewMatch = trimmed.match(/^git\s+checkout\s+-b\s+(\S+)$/i);
    if (checkoutNewMatch) {
      const name = checkoutNewMatch[1];
      appendToTerminal(`Switched to a new branch '${name}'`);
      createNewBranch(name);
      return;
    }

    // git checkout <name>
    const checkoutMatch = trimmed.match(/^git\s+checkout\s+(\S+)$/i);
    if (checkoutMatch) {
      const name = checkoutMatch[1];
      const target = branches.find((b) => b.name === name);
      if (!target) {
        appendToTerminal(`error: pathspec '${name}' did not match any branch known to git.`);
        return;
      }
      appendToTerminal(`Switched to branch '${name}'`);
      switchBranch(target.id);
      return;
    }

    if (cmd === "git log") {
      if (revisions.length === 0) {
        appendToTerminal(`No commits on branch '${activeBranch.name}' yet.`);
        return;
      }
      const lines: string[] = [];
      for (const rev of revisions.slice(0, 10)) {
        lines.push(`commit ${rev.id.slice(0, 7)}`);
        lines.push(`Date:   ${new Date(rev.createdAt).toLocaleString()}`);
        lines.push("");
        lines.push(`    ${rev.message}`);
        lines.push("");
      }
      appendToTerminal(lines);
      return;
    }

    if (cmd === "git branch") {
      const lines = branches.map(
        (b) => `${b.id === activeBranchId ? "* " : "  "}${b.name}`,
      );
      appendToTerminal(lines);
      return;
    }

    appendToTerminal(`git: '${trimmed}' is not a git command. See 'help'.`);
  }

  function handleTerminalKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand(currentInput);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const nextIndex =
        historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setCurrentInput(commandHistory[nextIndex]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setCurrentInput("");
      } else {
        setHistoryIndex(nextIndex);
        setCurrentInput(commandHistory[nextIndex]);
      }
    }
  }

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalHistory]);

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

          <div className="terminal" onClick={() => terminalInputRef.current?.focus()}>
            <div className="terminal-header">
              <span className="terminal-dot red" />
              <span className="terminal-dot yellow" />
              <span className="terminal-dot green" />
              <span className="terminal-title">todo-git ~ {activeBranch.name}</span>
            </div>
            <div className="terminal-body">
              <div className="terminal-welcome">
                Welcome to git-todos. Type &apos;help&apos; for available commands.
              </div>
              {terminalHistory.map((entry, i) => (
                <div key={i} className={entry.type === "input" ? "terminal-input-line" : "terminal-output-line"}>
                  {entry.type === "input" ? (
                    <>
                      <span className="terminal-prompt">~/todos ({entry.branch}) $</span>{" "}
                      <span className="terminal-command">{entry.text}</span>
                    </>
                  ) : (
                    <span>{entry.text}</span>
                  )}
                </div>
              ))}
              <div className="terminal-input-row">
                <span className="terminal-prompt">~/todos ({activeBranch.name}) $</span>
                <input
                  ref={terminalInputRef}
                  type="text"
                  className="terminal-input"
                  value={currentInput}
                  onChange={(e) => {
                    setCurrentInput(e.target.value);
                    setHistoryIndex(-1);
                  }}
                  onKeyDown={handleTerminalKeyDown}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={pendingAction}
                />
              </div>
              <div ref={terminalEndRef} />
            </div>
            {pendingAction ? <div className="terminal-pending">Running...</div> : null}
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

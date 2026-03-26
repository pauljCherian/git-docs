import { TodoItem } from "@/lib/types";

export type DiffEntry = {
  type: "added" | "removed" | "modified";
  todo: TodoItem;
  previousTodo?: TodoItem;
  changes?: {
    textChanged: boolean;
    completedChanged: boolean;
  };
};

export function diffTodos(older: TodoItem[], newer: TodoItem[]): DiffEntry[] {
  const olderMap = new Map(older.map((t) => [t.id, t]));
  const newerMap = new Map(newer.map((t) => [t.id, t]));
  const result: DiffEntry[] = [];

  for (const todo of older) {
    if (!newerMap.has(todo.id)) {
      result.push({ type: "removed", todo });
    }
  }

  for (const todo of newer) {
    const prev = olderMap.get(todo.id);
    if (!prev) {
      result.push({ type: "added", todo });
    } else {
      const textChanged = prev.text !== todo.text;
      const completedChanged = prev.completed !== todo.completed;
      if (textChanged || completedChanged) {
        result.push({
          type: "modified",
          todo,
          previousTodo: prev,
          changes: { textChanged, completedChanged },
        });
      }
    }
  }

  return result;
}

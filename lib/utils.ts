import { PageState, TodoItem } from "@/lib/types";

export function nowIso() {
  return new Date().toISOString();
}

export function sortTodos(todos: TodoItem[]) {
  return [...todos].sort((left, right) => left.order - right.order);
}

export function normalizePageState(pageState: PageState): PageState {
  return {
    todos: sortTodos(pageState.todos).map((todo, index) => ({
      ...todo,
      text: todo.text.trim(),
      order: index,
      updatedAt: todo.updatedAt || nowIso(),
    })),
  };
}

export function createDefaultPageState(): PageState {
  const timestamp = nowIso();

  return {
    todos: [
      {
        id: crypto.randomUUID(),
        text: "Add your first task",
        completed: false,
        order: 0,
        updatedAt: timestamp,
      },
    ],
  };
}

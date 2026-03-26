import { TodoApp } from "@/components/todo-app";
import { loadDocument } from "@/lib/data";
import { hasDbEnv } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = hasDbEnv() ? await auth() : null;

  if (hasDbEnv() && !session?.user?.id) {
    redirect("/auth/signin");
  }

  const initialData = await loadDocument({
    userId: session?.user?.id,
  });

  return (
    <TodoApp
      initialData={initialData}
      dbConfigured={hasDbEnv()}
      user={session?.user ? { name: session.user.name, image: session.user.image } : null}
    />
  );
}

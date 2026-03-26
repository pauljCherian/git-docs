import { signIn } from "@/lib/auth";

export default function SignInPage() {
  return (
    <main className="shell">
      <section className="hero" style={{ gridTemplateColumns: "1fr", textAlign: "center" }}>
        <div>
          <p className="eyebrow">Welcome back</p>
          <h1>Sign in to Git Docs</h1>
          <p className="lede">
            Track your todos with git-inspired workflows. Branch ideas, commit progress,
            and keep a clear history.
          </p>
        </div>
      </section>

      <div style={{ display: "flex", justifyContent: "center", marginTop: "24px" }}>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="primary" style={{ fontSize: "1.1rem", padding: "14px 32px" }}>
            Sign in with GitHub
          </button>
        </form>
      </div>
    </main>
  );
}

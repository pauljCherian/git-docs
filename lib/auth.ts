import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user, profile }) {
      if (!process.env.DATABASE_URL || !profile?.id) return true;

      const { getPool } = await import("@/lib/db");
      const pool = getPool();
      await pool.query(
        `INSERT INTO users (github_id, email, name, avatar_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (github_id) DO UPDATE SET
           email = EXCLUDED.email,
           name = EXCLUDED.name,
           avatar_url = EXCLUDED.avatar_url`,
        [profile.id, user.email, user.name, user.image],
      );
      return true;
    },
    async jwt({ token, profile }) {
      if (profile?.id && process.env.DATABASE_URL) {
        const { getPool } = await import("@/lib/db");
        const pool = getPool();
        const { rows } = await pool.query(
          `SELECT id FROM users WHERE github_id = $1`,
          [profile.id],
        );
        if (rows[0]) token.userId = rows[0].id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});

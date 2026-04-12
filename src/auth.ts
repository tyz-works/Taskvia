import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    signIn({ user }) {
      // ALLOWED_EMAIL が設定されていれば、そのアカウントのみ許可
      const allowed = (process.env.ALLOWED_EMAIL ?? "").trim();
      if (allowed && user.email !== allowed) return false;
      return true;
    },
  },
});

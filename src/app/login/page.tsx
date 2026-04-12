import { loginAction } from "../actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 p-8 rounded-2xl w-full max-w-sm shadow-xl">
        <h1 className="text-white text-2xl font-bold mb-2 text-center">
          Taskvia
        </h1>
        <p className="text-gray-400 text-sm text-center mb-8">
          Agent Approval Board
        </p>
        <form action={loginAction} className="space-y-4">
          <input
            type="password"
            name="password"
            placeholder="アクセストークン"
            autoFocus
            autoComplete="current-password"
            className="w-full bg-gray-800 text-white placeholder-gray-500 px-4 py-3 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && (
            <p className="text-red-400 text-sm">
              トークンが違います。再度お試しください。
            </p>
          )}
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white py-3 rounded-lg font-medium transition-colors"
          >
            ログイン
          </button>
        </form>
      </div>
    </div>
  );
}

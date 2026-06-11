import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/Button";

export function SignInPage() {
  const { signIn, signUp, configured } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password);
      nav("/studio", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="absolute inset-x-0 top-0 h-72 bg-ember-glow opacity-80 pointer-events-none" />
      <div className="panel-strong relative w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-gradient-to-br from-ember-500 to-ember-700 text-white font-semibold shadow-ember">
            T
          </div>
          <div>
            <div className="label-eyebrow">TOBURT Studios</div>
            <h1 className="font-serif text-2xl text-bone-50">Writers' Room OS</h1>
          </div>
        </div>

        {!configured && (
          <div className="mb-4 rounded-md border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-200/90">
            Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> in <code>frontend/.env</code> to
            enable real auth. Until then you can browse the UI shell freely.
          </div>
        )}

        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="label-eyebrow mb-1 block">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={!configured}
            />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={!configured}
            />
          </div>
          {error && (
            <div className="rounded-md border border-red-700/50 bg-red-950/30 p-2 text-sm text-red-200">
              {error}
            </div>
          )}
          <Button type="submit" disabled={!configured || busy} className="w-full">
            <Sparkles className="h-4 w-4" />
            {mode === "signin" ? "Enter the writers' room" : "Create account"}
          </Button>
          <button
            type="button"
            className="text-xs text-bone-400 hover:text-bone-200"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? "Don't have an account? Create one →"
              : "Already have an account? Sign in →"}
          </button>
        </form>
      </div>
    </div>
  );
}

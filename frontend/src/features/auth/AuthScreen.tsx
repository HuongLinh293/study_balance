import { useEffect, useState } from "react";
import { ArrowRight, GoogleLogo } from "@phosphor-icons/react";
import { auth, messageFor } from "../../lib/api";

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const register = mode === "register";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleAuth = params.get("google_auth");
    if (googleAuth) {
      const url = new URL(window.location.href);
      url.searchParams.delete("google_auth");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);

      if (googleAuth === "success") {
        onSignedIn();
        return;
      }
      if (googleAuth === "denied") {
        setError("Bạn đã hủy đăng nhập bằng Google.");
      } else if (googleAuth === "invalid_state") {
        setError("Phiên đăng nhập Google đã hết hạn. Hãy thử lại.");
      } else {
        setError("Đăng nhập Google không thành công. Hãy thử lại.");
      }
    }

    auth
      .googleConfig()
      .then((cfg) => {
        setGoogleConfigured(cfg.configured);
      })
      .catch(() => {});
  }, [onSignedIn]);

  const handleGoogleAuth = () => {
    setBusy(true);
    window.location.href = "/api/user/auth/google/start";
  };

  return (
    <main className="auth-screen">
      <section className="auth-card paper-grid">
        <div className="brand auth-brand">
          <span className="brand-symbol">
            <span />
            <span />
          </span>
          <span>
            study<span className="brand-light">balance</span>
          </span>
        </div>
        <h1>{register ? "Bắt đầu góc học tập." : "Chào mừng trở lại."}</h1>
        <p className="modal-intro">
          {register
            ? "Tạo tài khoản để lưu môn học, công việc và lịch học của bạn."
            : "Đăng nhập để tiếp tục kế hoạch của bạn."}
        </p>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (register) await auth.register(name.trim(), email, password);
              else await auth.login(email, password);
              onSignedIn();
            } catch (err) {
              setError(messageFor(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {register && (
            <label>
              Tên hiển thị
              <input
                required
                maxLength={60}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Mật khẩu
            <input
              required
              type="password"
              minLength={register ? 8 : 1}
              maxLength={128}
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {register && <small>Tối thiểu 8 ký tự.</small>}
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button dark full" type="submit" disabled={busy}>
            {busy ? "Đang xử lý…" : register ? "Tạo tài khoản" : "Đăng nhập"}
            <ArrowRight size={17} />
          </button>
        </form>

        {googleConfigured && (
          <>
            <div className="auth-divider">
              <span>hoặc</span>
            </div>
            <button
              type="button"
              className="button full google-auth-btn"
              disabled={busy}
              onClick={handleGoogleAuth}
            >
              <GoogleLogo size={18} weight="bold" />
              {register ? "Đăng ký bằng Google" : "Đăng nhập bằng Google"}
            </button>
          </>
        )}

        <button
          className="text-button auth-switch"
          onClick={() => {
            setMode(register ? "login" : "register");
            setError("");
          }}
        >
          {register ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}
        </button>
      </section>
    </main>
  );
}
export function LoadingScreen({ text = "Đang tải góc học tập…" }: { text?: string }) {
  return (
    <main className="auth-screen" aria-busy="true">
      <p className="loading-text">{text}</p>
    </main>
  );
}

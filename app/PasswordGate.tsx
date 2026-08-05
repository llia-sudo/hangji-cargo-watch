"use client";

import { FormEvent, useState } from "react";

export default function PasswordGate() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "密码验证失败");
      window.location.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "暂时无法登录，请稍后重试");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="password-page">
      <section className="password-card" aria-labelledby="password-title">
        <div className="password-brand">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <span>航迹 <small>CARGO WATCH</small></span>
        </div>
        <div className="password-route" aria-hidden="true">
          <span /><i /><b>▲</b><i /><span />
        </div>
        <p className="eyebrow">PRIVATE ORDER WORKSPACE</p>
        <h1 id="password-title">输入访问密码</h1>
        <p>订单、船期和客户信息受到保护。验证后，本设备将在 7 天内保持登录。</p>

        <form onSubmit={submit}>
          <label htmlFor="access-password">访问密码</label>
          <div className="password-field">
            <input
              id="access-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
              maxLength={128}
              aria-describedby={error ? "password-error" : undefined}
            />
            <button type="button" onClick={() => setShowPassword((current) => !current)}>
              {showPassword ? "隐藏" : "显示"}
            </button>
          </div>
          {error && <p className="password-error" id="password-error" role="alert">{error}</p>}
          <button className="password-submit" type="submit" disabled={submitting}>
            {submitting ? "正在验证…" : "进入订单看板"}
          </button>
        </form>

        <small className="password-footnote">连续输错将暂时锁定登录，以保护订单数据。</small>
      </section>
    </main>
  );
}

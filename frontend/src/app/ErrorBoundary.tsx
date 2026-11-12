import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defence: an unexpected rendering error shows a way out instead of
 * a blank page. Data is on the server, so reloading is always safe.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="auth-screen" role="alert">
        <div className="form">
          <p className="loading-text">Đã có lỗi khi hiển thị trang. Dữ liệu của bạn vẫn được lưu trên máy chủ.</p>
          <button className="button dark full" onClick={() => location.reload()}>
            Tải lại trang
          </button>
        </div>
      </main>
    );
  }
}

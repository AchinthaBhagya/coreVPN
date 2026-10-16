import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AuthCallback from "@/pages/AuthCallback";
import { ThemeProvider } from "@/context/ThemeContext";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ refresh: refreshMock }),
}));

function renderCallback(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/dashboard" element={<div>DASHBOARD_OK</div>} />
          <Route path="/portal" element={<div>PORTAL_OK</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthCallback", () => {
  it("refreshes the session and forwards a staff user to the dashboard", async () => {
    refreshMock.mockResolvedValue({ id: "u1", isClient: false });
    renderCallback("/auth/callback?status=success&next=/dashboard");
    expect(await screen.findByText("DASHBOARD_OK")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the portal for a client when no next is supplied", async () => {
    refreshMock.mockResolvedValue({ id: "c1", isClient: true });
    renderCallback("/auth/callback?status=success");
    expect(await screen.findByText("PORTAL_OK")).toBeInTheDocument();
  });

  it("maps a pending-approval error to a friendly message", async () => {
    renderCallback("/auth/callback?error=pending_approval");
    expect(await screen.findByText(/awaiting approval by an administrator/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("shows the no-account guidance when Google has no matching user", async () => {
    renderCallback("/auth/callback?error=no_account");
    expect(await screen.findByText(/please create an account first/i)).toBeInTheDocument();
  });

  it("reports a session that could not be established", async () => {
    refreshMock.mockResolvedValue(null);
    renderCallback("/auth/callback?status=success");
    expect(await screen.findByText(/could not establish your session/i)).toBeInTheDocument();
  });
});

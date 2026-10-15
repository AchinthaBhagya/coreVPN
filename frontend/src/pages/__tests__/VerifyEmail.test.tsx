import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import VerifyEmail from "@/pages/VerifyEmail";
import { api, ApiError } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function renderVerify(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VerifyEmail />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VerifyEmail", () => {
  it("verifies the token and offers a link to sign in", async () => {
    mockedApi.post.mockResolvedValue({ verified: true, activated: true });
    renderVerify("/verify-email?token=abcdef1234567890");

    expect(await screen.findByText(/email verified/i)).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/verify-email", { token: "abcdef1234567890" });
    expect(screen.getByRole("link", { name: /continue to sign in/i })).toBeInTheDocument();
  });

  it("shows the server message when the token is rejected", async () => {
    mockedApi.post.mockRejectedValue(new ApiError("This verification link is invalid or has expired", 400));
    renderVerify("/verify-email?token=expiredtoken000");

    expect(await screen.findByText(/verification failed/i)).toBeInTheDocument();
    expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
  });

  it("reports a missing token without calling the API", async () => {
    renderVerify("/verify-email");
    expect(await screen.findByText(/missing its token/i)).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("requests a new verification email", async () => {
    mockedApi.post.mockRejectedValue(new ApiError("This verification link is invalid or has expired", 400));
    renderVerify("/verify-email?token=expiredtoken000");
    await screen.findByText(/verification failed/i);

    mockedApi.post.mockResolvedValue({ requested: true });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/you@company.com/i), "again@example.com");
    await user.click(screen.getByRole("button", { name: /send a new verification email/i }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/auth/resend-verification", { email: "again@example.com" }),
    );
  });
});

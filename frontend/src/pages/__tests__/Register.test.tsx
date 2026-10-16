import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Register from "@/pages/Register";
import { ThemeProvider } from "@/context/ThemeContext";
import { api } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function renderRegister() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <Register />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.get.mockResolvedValue({ google: false });
});

describe("Register", () => {
  it("defaults to a customer account and hides the company field for team members", async () => {
    renderRegister();
    const user = userEvent.setup();

    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByLabelText(/company name/i)).toBeInTheDocument();

    await user.click(screen.getByText("Team member"));
    expect(screen.queryByLabelText(/company name/i)).not.toBeInTheDocument();
  });

  it("only shows the Google button when the provider is enabled", async () => {
    mockedApi.get.mockResolvedValue({ google: true });
    renderRegister();
    expect(await screen.findByText(/continue with google/i)).toBeInTheDocument();
  });

  it("hides the Google button when the provider is disabled", async () => {
    renderRegister();
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/auth/providers"));
    expect(screen.queryByText(/continue with google/i)).not.toBeInTheDocument();
  });

  it("submits a customer registration and confirms the verification email", async () => {
    mockedApi.post.mockResolvedValue({ accountType: "CLIENT", mailSent: true });
    renderRegister();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/first name/i), "Ada");
    await user.type(screen.getByLabelText(/last name/i), "Lovelace");
    await user.type(screen.getByLabelText(/email address/i), "ada@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "Str0ng!Pass123");
    await user.type(screen.getByLabelText(/confirm password/i), "Str0ng!Pass123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [path, payload] = mockedApi.post.mock.calls[0];
    expect(path).toBe("/auth/register");
    expect(payload).toMatchObject({ accountType: "CLIENT", email: "ada@example.com" });

    expect(await screen.findByText(/almost there/i)).toBeInTheDocument();
  });

  it("tells a team member their account awaits approval", async () => {
    mockedApi.post.mockResolvedValue({ accountType: "STAFF", mailSent: false });
    renderRegister();
    const user = userEvent.setup();

    await user.click(screen.getByText("Team member"));
    await user.type(screen.getByLabelText(/first name/i), "Lin");
    await user.type(screen.getByLabelText(/last name/i), "Dev");
    await user.type(screen.getByLabelText(/email address/i), "lin@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "Str0ng!Pass123");
    await user.type(screen.getByLabelText(/confirm password/i), "Str0ng!Pass123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/awaiting approval/i)).toBeInTheDocument();
    const [, payload] = mockedApi.post.mock.calls[0];
    expect(payload).toMatchObject({ accountType: "STAFF", companyName: null });
  });

  it("blocks submission when the passwords do not match", async () => {
    renderRegister();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/first name/i), "Ada");
    await user.type(screen.getByLabelText(/last name/i), "Lovelace");
    await user.type(screen.getByLabelText(/email address/i), "ada@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "Str0ng!Pass123");
    await user.type(screen.getByLabelText(/confirm password/i), "Different!123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});

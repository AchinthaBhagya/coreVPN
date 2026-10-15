/**
 * Vitest setup: adds @testing-library/jest-dom matcher support
 * (toBeInTheDocument, toHaveClass, ...) and unmounts React trees between tests.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

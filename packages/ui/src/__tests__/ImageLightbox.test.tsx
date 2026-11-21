import { expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ImageLightboxHost, openLightbox, useLightbox } from "../ImageLightbox";

it("opens large, steps with ←/→ and closes with Esc or a backdrop click", () => {
  render(<ImageLightboxHost />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => openLightbox([{ src: "data:image/png;base64,AA", alt: "图片 1" }, { src: "data:image/png;base64,BB", alt: "图片 2" }], 1));
  expect(screen.getByRole("dialog", { name: "图片 2" })).toBeInTheDocument();
  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(screen.getByRole("dialog", { name: "图片 1" })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => openLightbox([{ src: "x.png", alt: "单张" }]));
  expect(screen.queryByText(/\/ 1/)).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("dialog"));
  expect(useLightbox.getState().images).toHaveLength(0);
});

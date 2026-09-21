/**
 * Minimal CSF3-compatible story runtime for the AI inbox components.
 *
 * Why not full Storybook? Storybook is not currently a dependency of this
 * package, and adding it pulls in @storybook/react + a long list of peer deps.
 * This file provides:
 *
 *   1. `Meta<Props>` + `StoryObj<Props>` types compatible with CSF3.
 *   2. `composeStories(meta)` helper that returns `{ default, [name]: storyFn }`.
 *   3. `renderStory(meta, story)` helper used by the local vitest tests to
 *      mount a story in jsdom and assert it renders without throwing.
 *
 * 当后续接入真正的 Storybook 时,只需替换 type 来源即可。
 */
import React, { type ComponentType, type ReactElement } from "react";
import { render } from "@testing-library/react";

export interface StoryContext<Args = Record<string, unknown>> {
  args: Args;
}

export type StoryRenderer<Args> = (context: StoryContext<Args>) => ReactElement;

export interface Story<Args = Record<string, unknown>> {
  args?: Partial<Args>;
  render?: StoryRenderer<Args>;
  name?: string;
  parameters?: StoryParameters;
}

export interface Meta<Args = Record<string, unknown>> {
  title: string;
  component: ComponentType<Args>;
  args?: Partial<Args>;
  parameters?: StoryParameters;
  decorators?: Array<(storyFn: () => ReactElement) => ReactElement>;
}

export type StoryObj<Args = Record<string, unknown>> = Story<Args>;

export interface StoryParameters {
  layout?: "centered" | "fullscreen";
  description?: string;
}

/**
 * Merge args, invoke decorators, then render the component (or custom render fn).
 * Returns the container DOM node for assertions.
 */
export function renderStory(meta: Meta<unknown>, story: Story<unknown>): HTMLElement {
  const Component = meta.component as ComponentType<unknown>;
  const args = { ...(meta.args ?? {}), ...(story.args ?? {}) };
  const ctx: StoryContext<unknown> = { args };

  let tree: ReactElement = story.render
    ? story.render(ctx)
    : React.createElement(Component, args as unknown as Record<string, unknown>);

  for (const decorator of meta.decorators ?? []) {
    tree = decorator(() => tree);
  }

  const { container } = render(tree);
  return container;
}

export { cleanup } from "@testing-library/react";

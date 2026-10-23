import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { DEMO_CROP_SRC, DEMO_PROFILE, ProfileEditor, type EditableProfile } from "./ProfileEditor.tsx";

const meta = {
  title: "Components/Profiles/Profile Editor",
  component: ProfileEditor,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Edit your own profile on one panel of recessed fields. A new photo goes onto a crop bench: drag or use the arrow keys to move it, zoom with a ribbed slider or plus and minus, and see it at the sizes teammates will. The handle is checked as you type (try admin or support), the bio counts down, and problems show inline with the failed square. A save bar snaps up from the bottom only while there are changes, with Discard and the one orange Save, then confirms once saved.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof ProfileEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Two edits made: the save bar is up and the new handle is being checked. */
export const Dirty: Story = { args: { defaultChanges: { title: "Staff engineer, agent safety", handle: "priya_s" } } };

/** A taken handle and an empty name, shown inline. */
export const Invalid: Story = { args: { defaultChanges: { name: "", handle: "admin" } } };

/** The crop bench, open on a new photo. */
export const Crop: Story = { args: { defaultCropSrc: DEMO_CROP_SRC } };

export const Loading: Story = { args: { loading: true } };

export const Error: Story = { args: { error: "Your profile didn't load, so nothing can be edited yet. Try again.", onRetry: () => {} } };

/** The saved profile comes from useCachedLoader; saving writes it back into the cache. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    // Seed the cache once, before anything subscribes, so the first frame shows a cached copy
    useState(() => primeCache("story:me", DEMO_PROFILE, Date.now() - 12 * 60_000));
    const q = useCachedLoader<EditableProfile>("story:me", () => new Promise((ok) => setTimeout(() => ok({ ...DEMO_PROFILE, title: "Staff engineer, agent platform and safety" }), 1300)), { maxAge: 60_000 });
    return (
      <ProfileEditor
        profile={q.data}
        loading={q.status === "loading"}
        onSave={(next) =>
          new Promise<void>((ok) =>
            setTimeout(() => {
              primeCache("story:me", next);
              ok();
            }, 800),
          )
        }
      />
    );
  },
};

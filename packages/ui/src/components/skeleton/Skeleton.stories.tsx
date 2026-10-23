import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton, SkeletonCircle, SkeletonRegion, SkeletonText } from "./Skeleton.tsx";

const meta = {
  title: "Components/Loading/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Placeholder parts in unpainted primer gray. Every skeleton shares one light sweep fixed to the viewport, so a loading screen reads as one surface. Wrap a group in SkeletonRegion so assistive tech hears \"Loading\" once. Data components in this library take a `loading` prop and draw their own skeleton with these parts.",
      },
    },
  },
  args: { width: 240, height: 12 },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A member row and a card, the way data components compose them. */
export const Composed: Story = {
  render: () => (
    <SkeletonRegion label="Loading members">
      <div className="kb-part" style={{ width: 420, padding: 20, display: "grid", gap: 16 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <SkeletonCircle size={32} />
            <div style={{ flex: 1 }}>
              <Skeleton width="40%" height={11} />
              <Skeleton width="65%" height={9} style={{ marginTop: 7 }} />
            </div>
            <Skeleton width={64} height={22} radius="control" />
          </div>
        ))}
        <SkeletonText lines={3} />
      </div>
    </SkeletonRegion>
  ),
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "../../shared/index.ts";
import { ReactionBar } from "./ReactionBar.tsx";

const meta = {
  title: "Components/Buttons/Reaction Bar",
  component: ReactionBar,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Like, comment, repost and share molded as one pill. Like and repost are push-latch switches that stay sunk into the pill while on (`aria-pressed`); icons pop and fill, and counts roll digit by digit. Share copies the link and confirms in place.",
      },
    },
  },
  args: { size: "md", liked: false, reposted: false },
  argTypes: { size: { control: "inline-radio", options: ["sm", "md"] } },
} satisfies Meta<typeof ReactionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Latched: Story = {
  args: { liked: true, reposted: true, counts: { likes: 12_840, comments: 312, reposts: 1_907, shares: 266 } },
};

export const Small: Story = {
  args: { size: "sm", counts: { likes: 38, comments: 4, reposts: 7, shares: 0 } },
};

export const InAPost: Story = {
  render: (args) => (
    <article className="kb-part" style={{ width: 460, padding: 16 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Avatar name="Atlas Release" size={32} />
        <div>
          <div style={{ fontWeight: 600 }}>Atlas release notes</div>
          <div style={{ color: "var(--kb-ink-3)", fontSize: "var(--kb-text-sm)" }}>2 hours ago</div>
        </div>
      </header>
      <p style={{ margin: "0 0 14px" }}>
        Atlas 2.3 is out. Tool calls now stream their arguments as they are written, and long runs resume where
        they left off after a deploy.
      </p>
      <ReactionBar {...args} size="sm" />
    </article>
  ),
};

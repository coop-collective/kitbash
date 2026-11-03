import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { useCachedLoader } from "../../shared/index.ts";
import { DEMO_PERSON, ProfileCard, ProfileLink, type PersonProfile } from "./ProfileCard.tsx";

const meta = {
  title: "Components/Profiles/Profile Card",
  component: ProfileCard,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A compact card for a person: avatar with presence, name, handle, role, status message, and their local time on an hour rail (working hours molded solid, a gunmetal tick for now) so you can tell whether it's a good moment to message. ProfileLink is the inline name that opens it: after a short hover delay, at once on keyboard focus, and on click; Escape closes it.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof ProfileCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Late evening for them, focusing with notifications paused. */
export const OutsideHours: Story = {
  args: {
    person: { ...DEMO_PERSON, id: "u_kenji", name: "Kenji Ito", handle: "kenji", role: "Support lead", timeZone: "Pacific/Auckland", presence: "focus", statusMessage: "Writing the Q4 escalation playbook", workHours: [8, 16] },
  },
};

/** The inline trigger in running text, opened. Hover a name for half a second, or Tab to it. */
export const InText: Story = {
  render: () => (
    <div style={{ width: 520, minHeight: 330, fontSize: 14, lineHeight: 1.6 }}>
      <div>
        <ProfileLink defaultOpen /> and{" "}
        <ProfileLink person={{ ...DEMO_PERSON, id: "u_marcus", name: "Marcus Webb", handle: "marcus", role: "Engineering manager", timeZone: "Europe/London", presence: "away", statusMessage: undefined }} /> approved the refund agent's new permissions 3 hours ago.
      </div>
    </div>
  ),
};

export const Loading: Story = { args: { loading: true } };

export const Error: Story = { args: { error: "The directory service timed out. Try again in a moment.", onRetry: () => {} } };

const people: Record<string, PersonProfile> = {
  u_priya: DEMO_PERSON,
  u_tomas: { ...DEMO_PERSON, id: "u_tomas", name: "Tomás Herrera", handle: "tomas", role: "Product designer", timeZone: "America/Mexico_City", presence: "online", statusMessage: "On the invite flow redesign", workHours: [9, 17] },
};

/** The card's data loads through useCachedLoader only when it opens; the second open is instant from cache. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    const [openId, setOpenId] = useState<string | null>(null);
    const q = useCachedLoader<PersonProfile>(openId ? `story:person:${openId}` : null, () => new Promise((ok) => setTimeout(() => ok(people[openId ?? ""] ?? DEMO_PERSON), 1100)), { maxAge: 5 * 60_000 });
    return (
      <div style={{ width: 520, minHeight: 330, fontSize: 14, lineHeight: 1.6 }}>
        Assigned by{" "}
        {Object.values(people).map((p, i) => (
          <span key={p.id}>
            {i ? " and " : ""}
            <ProfileLink
              person={openId === p.id ? q.data : undefined}
              loading={openId === p.id && !q.data}
              onOpenChange={(o) => setOpenId(o ? p.id : null)}
              open={openId === p.id}
            >
              {p.name}
            </ProfileLink>
          </span>
        ))}
        . Hover a name.
      </div>
    );
  },
};
